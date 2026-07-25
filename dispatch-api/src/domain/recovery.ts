import type pg from 'pg';

import { openCase } from './cases.js';
import { createServiceRequest } from './requests.js';
import { cancelScheduledReminders } from './reminders.js';
import { transitionStatus } from '../status/transitions.js';

async function lockRequest(client: pg.PoolClient, id: string) {
  const { rows, rowCount } = await client.query(
    `SELECT * FROM service_requests WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND', status: 404 });
  }
  return rows[0];
}

async function voidPendingCharge(client: pg.PoolClient, serviceRequestId: string) {
  await client.query(
    `UPDATE charges
     SET status = 'voided', updated_at = now()
     WHERE service_request_id = $1 AND status = 'pending'`,
    [serviceRequestId],
  );
}

async function withdrawPendingOffers(client: pg.PoolClient, serviceRequestId: string) {
  await client.query(
    `UPDATE dispatch_offers
     SET status = 'withdrawn', resolved_at = now()
     WHERE service_request_id = $1 AND status = 'pending'`,
    [serviceRequestId],
  );
}

export async function markNoShow(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    party: 'contractor' | 'homeowner';
    actorRole: 'ops' | 'system' | 'agent';
    actorId: string;
    note?: string;
  },
) {
  const sr = await lockRequest(client, opts.serviceRequestId);
  if (sr.status !== 'confirmed') {
    throw Object.assign(new Error('invalid_status'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `no-show requires confirmed, got ${sr.status}`,
    });
  }

  await cancelScheduledReminders(client, opts.serviceRequestId);
  await voidPendingCharge(client, opts.serviceRequestId);

  const cse = await openCase(client, {
    serviceRequestId: opts.serviceRequestId,
    type: 'no_show',
    reasonCode: opts.party === 'contractor' ? 'contractor_no_show' : 'member_no_show',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    meta: { party: opts.party },
    note: opts.note ?? `no_show (${opts.party})`,
  });

  await client.query(
    `UPDATE service_requests
     SET dispatch_owner = 'ops', updated_at = now()
     WHERE id = $1`,
    [opts.serviceRequestId],
  );

  const result = await transitionStatus(client, {
    serviceRequestId: opts.serviceRequestId,
    to: 'no_show',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: opts.note ?? `no_show (${opts.party})`,
  });

  return { status: result.to, case: cse };
}

export async function cancelRequest(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'ops' | 'member' | 'system';
    actorId: string;
    reason: string;
  },
) {
  const sr = await lockRequest(client, opts.serviceRequestId);
  const cancellable = ['dispatching', 'booked', 'confirmed', 'checked_in'];
  if (!cancellable.includes(sr.status)) {
    throw Object.assign(new Error('cannot_cancel'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `cannot cancel from ${sr.status} — use dispute/refund after complete`,
    });
  }

  await cancelScheduledReminders(client, opts.serviceRequestId);
  await withdrawPendingOffers(client, opts.serviceRequestId);
  if (sr.status === 'confirmed' || sr.status === 'checked_in') {
    await voidPendingCharge(client, opts.serviceRequestId);
  }

  // Clear assignment on booked+
  if (sr.status === 'booked' || sr.status === 'confirmed' || sr.status === 'checked_in') {
    await client.query(
      `UPDATE service_requests
       SET assigned_contractor_id = NULL,
           appointment_id = NULL,
           dispatch_owner = 'ops',
           updated_at = now()
       WHERE id = $1`,
      [opts.serviceRequestId],
    );
  }

  await openCase(client, {
    serviceRequestId: opts.serviceRequestId,
    type: 'cancel_request',
    reasonCode: 'cancelled',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    meta: { reason: opts.reason },
    note: `cancel: ${opts.reason}`,
  });

  const result = await transitionStatus(client, {
    serviceRequestId: opts.serviceRequestId,
    to: 'cancelled',
    actorRole: opts.actorRole === 'member' ? 'member' : opts.actorRole,
    actorId: opts.actorId,
    note: `cancel: ${opts.reason}`,
  });

  return { status: result.to };
}

export async function redispatch(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'ops' | 'system';
    actorId: string;
    note?: string;
  },
) {
  const sr = await lockRequest(client, opts.serviceRequestId);
  if (sr.status !== 'no_show') {
    throw Object.assign(new Error('invalid_status'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `redispatch requires no_show, got ${sr.status}`,
    });
  }

  await client.query(
    `UPDATE service_requests
     SET assigned_contractor_id = NULL,
         appointment_id = NULL,
         arrival_acked_at = NULL,
         confirmed_at = NULL,
         dispatch_owner = 'agent',
         updated_at = now()
     WHERE id = $1`,
    [opts.serviceRequestId],
  );

  const result = await transitionStatus(client, {
    serviceRequestId: opts.serviceRequestId,
    to: 'dispatching',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: opts.note ?? 'redispatch → pool',
  });

  return { status: result.to };
}

export async function unassign(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'ops' | 'system';
    actorId: string;
    note?: string;
  },
) {
  const sr = await lockRequest(client, opts.serviceRequestId);
  if (sr.status !== 'booked') {
    throw Object.assign(new Error('invalid_status'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `unassign requires booked, got ${sr.status}`,
    });
  }

  await withdrawPendingOffers(client, opts.serviceRequestId);
  await client.query(
    `UPDATE service_requests
     SET assigned_contractor_id = NULL,
         appointment_id = NULL,
         arrival_acked_at = NULL,
         dispatch_owner = 'agent',
         updated_at = now()
     WHERE id = $1`,
    [opts.serviceRequestId],
  );

  const result = await transitionStatus(client, {
    serviceRequestId: opts.serviceRequestId,
    to: 'dispatching',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: opts.note ?? 'unassign → pool',
  });

  return { status: result.to };
}

export async function openPartsHold(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'ops' | 'agent' | 'contractor' | 'system';
    actorId: string;
    deferredItems: string[];
    note?: string;
  },
) {
  const sr = await lockRequest(client, opts.serviceRequestId);
  if (sr.status !== 'checked_in') {
    throw Object.assign(new Error('invalid_status'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `parts_hold requires checked_in, got ${sr.status}`,
    });
  }

  const items = opts.deferredItems.filter((s) => s.trim());
  if (!items.length) {
    throw Object.assign(new Error('deferred_required'), {
      code: 'VALIDATION_ERROR',
      status: 422,
      detail: 'deferred_items required',
    });
  }

  const cse = await openCase(client, {
    serviceRequestId: opts.serviceRequestId,
    type: 'parts_hold',
    reasonCode: 'needs_part',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    meta: { deferred_items: items },
    note: opts.note ?? `parts_hold: ${items.join(', ')}`,
  });

  // Child follow-up request (H14) — same property/category, enters pool
  const homeowner = await client.query(
    `SELECT membership_tier FROM homeowners WHERE id = $1`,
    [sr.homeowner_id],
  );
  const child = await createServiceRequest(client, {
    homeownerId: sr.homeowner_id,
    propertyId: sr.property_id,
    categoryId: sr.category_id,
    membershipTier: (homeowner.rows[0]?.membership_tier as string) ?? 'Comfort',
    preferredWindowStart: sr.preferred_window_start,
    preferredWindowEnd: sr.preferred_window_end,
    details: {
      parent_request_id: sr.id,
      deferred_items: items,
      follow_up: true,
    },
    actorRole:
      opts.actorRole === 'contractor' ? 'system' : (opts.actorRole as 'ops' | 'agent' | 'system'),
    actorId: opts.actorId,
    note: `follow-up child of ${sr.confirmation_code ?? sr.id}`,
  });

  await client.query(
    `UPDATE service_requests SET parent_request_id = $2 WHERE id = $1`,
    [child.id, sr.id],
  );

  // Parent stays checked_in
  return {
    status: sr.status as string,
    case: cse,
    child_request_id: child.id,
    child_confirmation_code: child.confirmation_code,
  };
}

export async function openScopeChange(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'ops' | 'agent' | 'contractor' | 'system';
    actorId: string;
    description: string;
    proposedAmountCents?: number;
  },
) {
  const sr = await lockRequest(client, opts.serviceRequestId);
  if (!['confirmed', 'checked_in'].includes(sr.status)) {
    throw Object.assign(new Error('invalid_status'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `scope_change requires confirmed|checked_in, got ${sr.status}`,
    });
  }

  const cse = await openCase(client, {
    serviceRequestId: opts.serviceRequestId,
    type: 'scope_change',
    reasonCode: 'scope_change',
    moneyImpact: 'amend_charge',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    meta: {
      description: opts.description,
      proposed_amount_cents: opts.proposedAmountCents ?? null,
      approval: 'pending',
    },
    note: `scope_change: ${opts.description}`,
  });

  await client.query(
    `UPDATE service_requests SET dispatch_owner = 'ops', updated_at = now() WHERE id = $1`,
    [opts.serviceRequestId],
  );

  return { case: cse, status: sr.status };
}

/** Ops-only: approve scope change and amend pending charge amount (Stage 8 stub of H5 step 2). */
export async function approveScopeChange(
  client: pg.PoolClient,
  opts: {
    caseId: string;
    actorRole: 'ops';
    actorId: string;
    amountCents: number;
  },
) {
  const locked = await client.query(`SELECT * FROM cases WHERE id = $1 FOR UPDATE`, [
    opts.caseId,
  ]);
  if (!locked.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND', status: 404 });
  }
  const cse = locked.rows[0];
  if (cse.type !== 'scope_change' || cse.status !== 'open') {
    throw Object.assign(new Error('invalid_case'), {
      code: 'INVALID_CASE',
      status: 409,
    });
  }
  if (opts.amountCents < 0) {
    throw Object.assign(new Error('bad_amount'), {
      code: 'VALIDATION_ERROR',
      status: 422,
    });
  }

  await client.query(
    `UPDATE charges
     SET amount_cents = $2, updated_at = now(), note = coalesce(note,'') || ' | scope amend'
     WHERE service_request_id = $1 AND status = 'pending'`,
    [cse.service_request_id, opts.amountCents],
  );

  await client.query(
    `UPDATE cases
     SET meta = meta || $2::jsonb,
         status = 'resolved',
         resolved_at = now()
     WHERE id = $1`,
    [
      opts.caseId,
      JSON.stringify({
        approval: 'approved',
        approved_amount_cents: opts.amountCents,
      }),
    ],
  );

  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     SELECT id, status, status, 'ops', $2, $3, clock_timestamp()
     FROM service_requests WHERE id = $1`,
    [
      cse.service_request_id,
      opts.actorId,
      `scope_change approved → charge ${opts.amountCents}¢`,
    ],
  );

  return { ok: true, amount_cents: opts.amountCents };
}

export async function flagFieldIssue(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    kind: 'late' | 'cant_find';
    actorRole: 'ops' | 'agent' | 'contractor' | 'system';
    actorId: string;
    note?: string;
  },
) {
  const sr = await lockRequest(client, opts.serviceRequestId);
  if (!['confirmed', 'checked_in'].includes(sr.status)) {
    throw Object.assign(new Error('invalid_status'), {
      code: 'INVALID_STATUS',
      status: 409,
    });
  }

  const cse = await openCase(client, {
    serviceRequestId: opts.serviceRequestId,
    type: 'escalation',
    reasonCode: opts.kind,
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: opts.note ?? opts.kind,
    meta: { kind: opts.kind },
  });

  if (opts.kind === 'cant_find') {
    await client.query(
      `UPDATE service_requests SET dispatch_owner = 'ops', updated_at = now() WHERE id = $1`,
      [opts.serviceRequestId],
    );
  }

  return { case: cse, status: sr.status };
}

export async function openEmergency(
  client: pg.PoolClient,
  opts: {
    serviceRequestId?: string;
    propertyId?: string;
    homeownerId?: string;
    signalType: string;
    payload?: Record<string, unknown>;
    actorRole: 'ops' | 'system' | 'contractor';
    actorId: string;
  },
) {
  let serviceRequestId = opts.serviceRequestId;

  if (!serviceRequestId) {
    if (opts.propertyId) {
      const found = await client.query(
        `SELECT id FROM service_requests
         WHERE property_id = $1
           AND status IN ('confirmed', 'checked_in', 'booked', 'dispatching')
         ORDER BY updated_at DESC LIMIT 1`,
        [opts.propertyId],
      );
      serviceRequestId = found.rows[0]?.id;
    }
    if (!serviceRequestId && opts.homeownerId) {
      const found = await client.query(
        `SELECT id FROM service_requests
         WHERE homeowner_id = $1
           AND status IN ('confirmed', 'checked_in', 'booked', 'dispatching')
         ORDER BY updated_at DESC LIMIT 1`,
        [opts.homeownerId],
      );
      serviceRequestId = found.rows[0]?.id;
    }
  }

  if (!serviceRequestId) {
    throw Object.assign(new Error('no_request'), {
      code: 'NO_ACTIVE_REQUEST',
      status: 404,
      detail: 'emergency requires service_request_id or active property/homeowner job',
    });
  }

  const sr = await lockRequest(client, serviceRequestId);

  const cse = await openCase(client, {
    serviceRequestId,
    type: 'emergency',
    reasonCode: opts.signalType,
    blocksClose: true,
    moneyImpact: 'hold_payout',
    ownerRole: 'ops',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    meta: {
      signal_type: opts.signalType,
      payload: opts.payload ?? {},
      property_id: opts.propertyId ?? sr.property_id,
    },
    note: `emergency: ${opts.signalType}`,
  });

  await client.query(
    `UPDATE service_requests
     SET dispatch_owner = 'ops',
         details = details || $2::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      serviceRequestId,
      JSON.stringify({ 'safety.emergency': true, 'safety.signal': opts.signalType }),
    ],
  );

  return { case: cse, service_request_id: serviceRequestId };
}
