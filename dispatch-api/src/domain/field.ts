import type pg from 'pg';

import { transitionStatus } from '../status/transitions.js';

async function loadAssignedRequest(
  client: pg.PoolClient,
  serviceRequestId: string,
) {
  const locked = await client.query(
    `SELECT sr.*, p.address_line1, p.city, p.state, p.zip, p.timezone,
            a.slot_start, a.slot_end
     FROM service_requests sr
     JOIN properties p ON p.id = sr.property_id
     LEFT JOIN appointments a ON a.id = sr.appointment_id
     WHERE sr.id = $1
     FOR UPDATE OF sr`,
    [serviceRequestId],
  );
  if (!locked.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND', status: 404 });
  }
  return locked.rows[0];
}

function assertContractor(sr: { assigned_contractor_id: string | null }, actorId: string) {
  if (!sr.assigned_contractor_id || sr.assigned_contractor_id !== actorId) {
    throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN', status: 403 });
  }
}

/** Stay confirmed; timeline-only en_route signal. */
export async function markEnRoute(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'contractor' | 'ops' | 'agent' | 'system';
    actorId: string;
    note?: string;
  },
) {
  const sr = await loadAssignedRequest(client, opts.serviceRequestId);
  if (opts.actorRole === 'contractor') assertContractor(sr, opts.actorId);
  if (sr.status !== 'confirmed') {
    throw Object.assign(new Error('not_confirmed'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `en-route requires confirmed, got ${sr.status}`,
    });
  }

  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     VALUES ($1, $2, $2, $3, $4, $5, clock_timestamp())`,
    [
      opts.serviceRequestId,
      sr.status,
      opts.actorRole,
      opts.actorId,
      opts.note ?? 'en_route',
    ],
  );

  return { status: sr.status as string, signal: 'en_route' as const };
}

export async function checkIn(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'contractor' | 'ops' | 'agent' | 'system';
    actorId: string;
    note?: string;
  },
) {
  const sr = await loadAssignedRequest(client, opts.serviceRequestId);
  if (opts.actorRole === 'contractor') assertContractor(sr, opts.actorId);
  if (sr.status !== 'confirmed') {
    throw Object.assign(new Error('not_confirmed'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `check-in requires confirmed, got ${sr.status}`,
    });
  }

  const result = await transitionStatus(client, {
    serviceRequestId: opts.serviceRequestId,
    to: 'checked_in',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: opts.note ?? 'check_in',
  });

  return { status: result.to, from: result.from };
}

export async function completeJob(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'contractor' | 'ops' | 'agent' | 'system';
    actorId: string;
    summary: string;
  },
) {
  if (!opts.summary?.trim()) {
    throw Object.assign(new Error('summary_required'), {
      code: 'VALIDATION_ERROR',
      status: 422,
      detail: 'summary required',
    });
  }
  const sr = await loadAssignedRequest(client, opts.serviceRequestId);
  if (opts.actorRole === 'contractor') assertContractor(sr, opts.actorId);
  if (sr.status !== 'checked_in') {
    throw Object.assign(new Error('not_checked_in'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `complete requires checked_in, got ${sr.status}`,
    });
  }

  const result = await transitionStatus(client, {
    serviceRequestId: opts.serviceRequestId,
    to: 'completed',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: `complete: ${opts.summary.trim().slice(0, 500)}`,
  });

  // Capture/payout deferred to Stage 9 — timeline note only
  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     SELECT id, status, status, 'system', $2, $3, clock_timestamp()
     FROM service_requests WHERE id = $1`,
    [
      opts.serviceRequestId,
      '00000000-0000-4000-8000-000000000001',
      'complete received — capture/payout deferred to Stage 9',
    ],
  );

  return { status: result.to, from: result.from };
}

export async function listContractorJobs(
  client: pg.Pool | pg.PoolClient,
  contractorId: string,
) {
  const { rows } = await client.query(
    `SELECT sr.id AS request_id, sr.status, sr.category_id, sr.confirmation_code,
            sr.property_id, sr.details,
            a.id AS appointment_id, a.slot_start, a.slot_end,
            p.address_line1, p.city, p.state, p.zip
     FROM service_requests sr
     JOIN appointments a ON a.id = sr.appointment_id
     JOIN properties p ON p.id = sr.property_id
     WHERE sr.assigned_contractor_id = $1
       AND sr.status IN ('booked', 'confirmed', 'checked_in')
     ORDER BY a.slot_start ASC
     LIMIT 100`,
    [contractorId],
  );

  return rows.map((r) => {
    const details =
      r.details && typeof r.details === 'object'
        ? Object.fromEntries(
            Object.entries(r.details as Record<string, unknown>).filter(
              ([k]) => !k.startsWith('safety.') && !k.startsWith('medical.'),
            ),
          )
        : {};
    return {
      appointment: {
        id: r.appointment_id,
        service_request_id: r.request_id,
        slot_start: r.slot_start,
        slot_end: r.slot_end,
        status: r.status,
      },
      request: {
        id: r.request_id,
        status: r.status,
        category_id: r.category_id,
        confirmation_code: r.confirmation_code,
        property_id: r.property_id,
        details,
      },
      property: {
        address_line1: r.address_line1,
        city: r.city,
        state: r.state,
        zip: r.zip,
      },
    };
  });
}

export type SmsParseResult =
  | { ok: true; intent: 'en_route' | 'check_in' | 'complete'; token: string }
  | { ok: false; reason: 'ambiguous' | 'unknown' };

/** Allowlisted field SMS parser (H11) — never invents intents. */
export function parseFieldSms(body: string): SmsParseResult {
  const text = body.trim().toUpperCase().replace(/\s+/g, ' ');
  const m = text.match(/^(OTW|ON MY WAY|ARRIVED|DONE|COMPLETE)\s+([A-Z0-9-]{4,20})$/);
  if (!m) {
    if (/OTW|ARRIVED|DONE|COMPLETE|ON MY WAY/.test(text)) {
      return { ok: false, reason: 'ambiguous' };
    }
    return { ok: false, reason: 'unknown' };
  }
  const verb = m[1];
  const token = m[2];
  if (verb === 'OTW' || verb === 'ON MY WAY') {
    return { ok: true, intent: 'en_route', token };
  }
  if (verb === 'ARRIVED') return { ok: true, intent: 'check_in', token };
  return { ok: true, intent: 'complete', token };
}

export async function applyFieldSms(
  client: pg.PoolClient,
  opts: {
    body: string;
    actorRole: 'system' | 'agent' | 'ops';
    actorId: string;
    fromPhone?: string;
  },
) {
  const parsed = parseFieldSms(opts.body);
  if (!parsed.ok) {
    return {
      applied: false as const,
      escalate: true as const,
      reason: parsed.reason,
      detail: 'unparsed_inbound_message',
    };
  }

  const found = await client.query(
    `SELECT id, assigned_contractor_id, status, confirmation_code
     FROM service_requests
     WHERE upper(confirmation_code) = $1
     LIMIT 1`,
    [parsed.token],
  );
  if (!found.rowCount) {
    return {
      applied: false as const,
      escalate: true as const,
      reason: 'unknown_token' as const,
      detail: 'no request for token',
    };
  }
  const sr = found.rows[0];
  const fieldActor =
    opts.actorRole === 'ops'
      ? ({ role: 'ops' as const, id: opts.actorId })
      : ({ role: opts.actorRole, id: opts.actorId });

  if (parsed.intent === 'en_route') {
    const result = await markEnRoute(client, {
      serviceRequestId: sr.id,
      actorRole: fieldActor.role,
      actorId: fieldActor.id,
      note: `sms en_route (${opts.fromPhone ?? 'unknown'})`,
    });
    return { applied: true as const, escalate: false as const, ...result, request_id: sr.id };
  }
  if (parsed.intent === 'check_in') {
    const result = await checkIn(client, {
      serviceRequestId: sr.id,
      actorRole: fieldActor.role,
      actorId: fieldActor.id,
      note: `sms check_in (${opts.fromPhone ?? 'unknown'})`,
    });
    return { applied: true as const, escalate: false as const, ...result, request_id: sr.id };
  }
  const result = await completeJob(client, {
    serviceRequestId: sr.id,
    actorRole: fieldActor.role,
    actorId: fieldActor.id,
    summary: `sms DONE (${opts.fromPhone ?? 'unknown'})`,
  });
  return { applied: true as const, escalate: false as const, ...result, request_id: sr.id };
}

/** Member-facing progress projection (INV-2 — no contractor PII). */
export async function memberProgress(
  client: pg.Pool | pg.PoolClient,
  serviceRequestId: string,
) {
  const { rows: events } = await client.query(
    `SELECT to_status, note, created_at, actor_role
     FROM job_events
     WHERE service_request_id = $1
     ORDER BY created_at ASC, id ASC`,
    [serviceRequestId],
  );

  const steps = [
    { key: 'confirmed', label: 'Visit confirmed', done: false, at: null as string | null },
    { key: 'en_route', label: 'On the way', done: false, at: null as string | null },
    { key: 'arrived', label: 'Arrived', done: false, at: null as string | null },
    { key: 'completed', label: 'Work completed', done: false, at: null as string | null },
  ];

  for (const ev of events) {
    if (ev.to_status === 'confirmed' && !steps[0].done) {
      steps[0].done = true;
      steps[0].at = ev.created_at;
    }
    if (
      typeof ev.note === 'string' &&
      /en_route/i.test(ev.note) &&
      !steps[1].done
    ) {
      steps[1].done = true;
      steps[1].at = ev.created_at;
    }
    if (ev.to_status === 'checked_in' && !steps[2].done) {
      steps[2].done = true;
      steps[2].at = ev.created_at;
    }
    if (ev.to_status === 'completed' && !steps[3].done) {
      steps[3].done = true;
      steps[3].at = ev.created_at;
    }
  }

  return { steps };
}
