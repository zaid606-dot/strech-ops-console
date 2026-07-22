import type pg from 'pg';

import { computePromiseBy } from './sla.js';

function confirmationCode(): string {
  const n = Math.random().toString(36).slice(2, 6).toUpperCase();
  const t = Date.now().toString(36).toUpperCase().slice(-4);
  return `SR-${t}${n}`;
}

export type CreateRequestInput = {
  homeownerId: string;
  propertyId: string;
  categoryId: string;
  membershipTier: string;
  preferredWindowStart?: string | null;
  preferredWindowEnd?: string | null;
  details?: Record<string, unknown>;
  actorRole: 'member' | 'ops' | 'system' | 'agent';
  actorId: string;
  note?: string;
};

/**
 * Create a service request in dispatching + initial job_event.
 * Must run inside an open transaction.
 */
export async function createServiceRequest(
  client: pg.PoolClient,
  input: CreateRequestInput,
) {
  const createdAt = new Date();
  const promiseBy = computePromiseBy(
    createdAt,
    input.categoryId,
    input.membershipTier,
  );
  const code = confirmationCode();

  // Drop safety.* from member-supplied details (H17); ops can add later via ops-only APIs
  const raw = input.details ?? {};
  const details = Object.fromEntries(
    Object.entries(raw).filter(([k]) => !k.startsWith('safety.')),
  );

  const inserted = await client.query(
    `INSERT INTO service_requests (
       homeowner_id, property_id, category_id, status, details,
       preferred_window_start, preferred_window_end,
       promise_by, confirmation_code, dispatch_owner, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'dispatching', $4::jsonb,
       $5, $6,
       $7, $8, 'agent', $9, $9
     )
     RETURNING *`,
    [
      input.homeownerId,
      input.propertyId,
      input.categoryId,
      JSON.stringify(details),
      input.preferredWindowStart ?? null,
      input.preferredWindowEnd ?? null,
      promiseBy.toISOString(),
      code,
      createdAt.toISOString(),
    ],
  );

  const row = inserted.rows[0];

  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     VALUES ($1, NULL, 'dispatching', $2, $3, $4, clock_timestamp())`,
    [
      row.id,
      input.actorRole,
      input.actorId,
      input.note ?? 'request created — entered dispatch pool',
    ],
  );

  return row;
}
