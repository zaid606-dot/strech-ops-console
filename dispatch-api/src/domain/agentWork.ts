import type pg from 'pg';

import type { AgentPolicySettings } from './policy.js';
import { expirePendingOffers } from './offers.js';

export type WorkReason =
  | 'needs_offer_wave'
  | 'awaiting_arrival'
  | 'ready_to_confirm'
  | 'stale_confirmed'
  | 'pool_exhaust'
  | 'sla_breach_soon'
  | 'stuck';

export type WorkItem = {
  service_request_id: string;
  status: string;
  confirmation_code: string | null;
  promise_by: string | null;
  arrival_acked_at: string | null;
  updated_at: string;
  reason: WorkReason;
  priority: number;
};

/**
 * Build agent attention queue (excludes emergency cases + ops-owned jobs).
 */
export async function buildAgentWorkQueue(
  client: pg.Pool | pg.PoolClient,
  settings: AgentPolicySettings,
): Promise<WorkItem[]> {
  await expirePendingOffers(client);

  const { rows } = await client.query(
    `SELECT sr.id, sr.status, sr.confirmation_code, sr.promise_by,
            sr.arrival_acked_at, sr.updated_at, sr.confirmed_at,
            EXISTS (
              SELECT 1 FROM dispatch_offers o
              WHERE o.service_request_id = sr.id AND o.status = 'pending'
            ) AS has_pending_offer,
            EXISTS (
              SELECT 1 FROM cases c
              WHERE c.service_request_id = sr.id
                AND c.status = 'open' AND c.type = 'emergency'
            ) AS is_emergency,
            EXISTS (
              SELECT 1 FROM cases c
              WHERE c.service_request_id = sr.id
                AND c.status = 'open'
                AND c.reason_code = 'pool_exhaust'
            ) AS pool_exhaust
     FROM service_requests sr
     WHERE sr.dispatch_owner = 'agent'
       AND sr.status IN ('dispatching', 'booked', 'confirmed')
     ORDER BY sr.updated_at ASC
     LIMIT 200`,
  );

  const slaMinutes = settings.sla.promise_by_escalate_minutes;
  const stuckMinutes = settings.stuck.no_progress_minutes;
  const now = Date.now();
  const items: WorkItem[] = [];

  for (const row of rows) {
    if (row.is_emergency) continue;

    const base = {
      service_request_id: row.id as string,
      status: row.status as string,
      confirmation_code: row.confirmation_code as string | null,
      promise_by: row.promise_by as string | null,
      arrival_acked_at: row.arrival_acked_at as string | null,
      updated_at: row.updated_at as string,
    };

    if (row.pool_exhaust) {
      items.push({ ...base, reason: 'pool_exhaust', priority: 10 });
      continue;
    }

    const promiseBy = row.promise_by ? new Date(row.promise_by).getTime() : null;
    if (
      promiseBy != null &&
      promiseBy - now <= slaMinutes * 60 * 1000 &&
      (row.status === 'dispatching' || row.status === 'booked')
    ) {
      items.push({ ...base, reason: 'sla_breach_soon', priority: 20 });
      continue;
    }

    const updatedAt = new Date(row.updated_at).getTime();
    const stuckMs = stuckMinutes * 60 * 1000;
    if (
      (row.status === 'booked' || row.status === 'confirmed') &&
      now - updatedAt >= stuckMs
    ) {
      items.push({
        ...base,
        reason: row.status === 'confirmed' ? 'stale_confirmed' : 'stuck',
        priority: 30,
      });
      continue;
    }

    if (row.status === 'dispatching' && !row.has_pending_offer) {
      items.push({ ...base, reason: 'needs_offer_wave', priority: 40 });
      continue;
    }

    if (row.status === 'booked') {
      if (row.arrival_acked_at) {
        items.push({ ...base, reason: 'ready_to_confirm', priority: 50 });
      } else {
        items.push({ ...base, reason: 'awaiting_arrival', priority: 60 });
      }
    }
  }

  items.sort((a, b) => a.priority - b.priority);
  return items;
}
