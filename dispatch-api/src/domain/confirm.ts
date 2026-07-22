import type pg from 'pg';

import { visitAmountCents } from './pricing.js';
import { scheduleReminders } from './reminders.js';
import { transitionStatus } from '../status/transitions.js';

export async function ackArrival(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'contractor' | 'ops' | 'system';
    actorId: string;
  },
) {
  const locked = await client.query(
    `SELECT * FROM service_requests WHERE id = $1 FOR UPDATE`,
    [opts.serviceRequestId],
  );
  if (!locked.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND', status: 404 });
  }
  const sr = locked.rows[0];

  if (sr.status !== 'booked') {
    throw Object.assign(new Error('not_booked'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `ack_arrival requires booked, got ${sr.status}`,
    });
  }
  if (!sr.appointment_id) {
    throw Object.assign(new Error('no_appointment'), {
      code: 'NO_APPOINTMENT',
      status: 409,
    });
  }
  if (opts.actorRole === 'contractor' && sr.assigned_contractor_id !== opts.actorId) {
    throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN', status: 403 });
  }
  if (sr.arrival_acked_at) {
    return { ok: true as const, already: true as const, arrival_acked_at: sr.arrival_acked_at };
  }

  const upd = await client.query(
    `UPDATE service_requests
     SET arrival_acked_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING arrival_acked_at`,
    [opts.serviceRequestId],
  );

  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     VALUES ($1, $2, $2, $3, $4, $5, clock_timestamp())`,
    [
      opts.serviceRequestId,
      sr.status,
      opts.actorRole,
      opts.actorId,
      'ack_arrival',
    ],
  );

  return {
    ok: true as const,
    already: false as const,
    arrival_acked_at: upd.rows[0].arrival_acked_at,
  };
}

export async function confirmVisit(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'ops' | 'agent' | 'system';
    actorId: string;
  },
) {
  const locked = await client.query(
    `SELECT sr.*, p.timezone, h.membership_tier, a.slot_start, a.slot_end
     FROM service_requests sr
     JOIN properties p ON p.id = sr.property_id
     JOIN homeowners h ON h.id = sr.homeowner_id
     LEFT JOIN appointments a ON a.id = sr.appointment_id
     WHERE sr.id = $1
     FOR UPDATE OF sr`,
    [opts.serviceRequestId],
  );
  if (!locked.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND', status: 404 });
  }
  const sr = locked.rows[0];

  if (sr.dispatch_owner === 'ops' && opts.actorRole === 'agent') {
    throw Object.assign(new Error('owned_by_ops'), { code: 'OWNED_BY_OPS', status: 403 });
  }
  if (sr.status !== 'booked') {
    throw Object.assign(new Error('not_booked'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `confirm_visit requires booked, got ${sr.status}`,
    });
  }
  if (!sr.appointment_id || !sr.slot_start) {
    throw Object.assign(new Error('no_appointment'), {
      code: 'NO_APPOINTMENT',
      status: 409,
    });
  }
  if (!sr.arrival_acked_at) {
    throw Object.assign(new Error('ack_required'), {
      code: 'ACK_REQUIRED',
      status: 409,
      detail: 'ack_arrival required before confirm_visit',
    });
  }

  const amount = visitAmountCents(sr.category_id, sr.membership_tier);
  const charge = await client.query(
    `INSERT INTO charges
       (service_request_id, amount_cents, status, membership_tier, category_id, note)
     VALUES ($1, $2, 'pending', $3, $4, $5)
     RETURNING *`,
    [
      opts.serviceRequestId,
      amount,
      sr.membership_tier,
      sr.category_id,
      amount === 0 ? 'included visit ($0)' : 'visit charge pending capture',
    ],
  );

  const timezone = (sr.timezone as string) || 'America/New_York';
  const reminders = await scheduleReminders(client, {
    serviceRequestId: opts.serviceRequestId,
    slotStart: new Date(sr.slot_start),
    timezone,
  });

  await client.query(
    `UPDATE service_requests
     SET confirmed_at = now(), updated_at = now()
     WHERE id = $1`,
    [opts.serviceRequestId],
  );

  await transitionStatus(client, {
    serviceRequestId: opts.serviceRequestId,
    to: 'confirmed',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: 'confirm_visit',
  });

  // Member notification stub (no Twilio) — timeline note only
  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     SELECT id, status, status, 'system', $2, $3, clock_timestamp()
     FROM service_requests WHERE id = $1`,
    [
      opts.serviceRequestId,
      '00000000-0000-4000-8000-000000000001',
      `member notified (stub): Strech Pro · ${sr.confirmation_code} · ${new Date(sr.slot_start).toISOString()}`,
    ],
  );

  return {
    status: 'confirmed' as const,
    charge: charge.rows[0],
    reminders,
    confirmation_code: sr.confirmation_code,
    member_notify: {
      pro_label: 'Strech Pro',
      confirmation_code: sr.confirmation_code,
      slot_start: sr.slot_start,
      slot_end: sr.slot_end,
    },
  };
}
