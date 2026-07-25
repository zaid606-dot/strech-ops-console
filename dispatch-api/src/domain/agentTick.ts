import type pg from 'pg';

import { loadAgentPolicy } from './agentPolicyStore.js';
import { buildAgentWorkQueue, type WorkItem, type WorkReason } from './agentWork.js';
import { confirmVisit } from './confirm.js';
import { AGENT_ACTOR_ID, type AgentPolicySettings } from './policy.js';
import { expirePendingOffers, startOfferWave } from './offers.js';

export type TickAction = {
  service_request_id: string;
  reason: WorkReason;
  action: string;
  ok: boolean;
  detail?: string;
  code?: string;
};

async function escalate(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    reasonCode: string;
    note: string;
  },
) {
  await client.query(
    `INSERT INTO cases (service_request_id, type, reason_code, owner_role, blocks_close, meta)
     VALUES ($1, 'escalation', $2, 'ops', false, '{}'::jsonb)`,
    [opts.serviceRequestId, opts.reasonCode],
  );
  await client.query(
    `UPDATE service_requests
     SET dispatch_owner = 'ops', updated_at = now()
     WHERE id = $1`,
    [opts.serviceRequestId],
  );
  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     SELECT id, status, status, 'agent', $2, $3, clock_timestamp()
     FROM service_requests WHERE id = $1`,
    [opts.serviceRequestId, AGENT_ACTOR_ID, opts.note],
  );
}

async function handleItem(
  client: pg.PoolClient,
  item: WorkItem,
  settings: AgentPolicySettings,
): Promise<TickAction> {
  const id = item.service_request_id;
  try {
    switch (item.reason) {
      case 'needs_offer_wave': {
        const result = await startOfferWave(client, {
          serviceRequestId: id,
          strategy: settings.offer.strategy,
          batchSize: settings.offer.batch_size,
          ttlSeconds: settings.offer.ttl_seconds,
          maxWaves: settings.offer.max_waves_before_ops,
          actorRole: 'agent',
          actorId: AGENT_ACTOR_ID,
        });
        if (result.escalated) {
          return {
            service_request_id: id,
            reason: item.reason,
            action: 'escalate_pool',
            ok: true,
            detail: 'no candidates / max waves',
          };
        }
        return {
          service_request_id: id,
          reason: item.reason,
          action: 'offer_wave',
          ok: true,
          detail: `offers=${result.offers.length}`,
        };
      }
      case 'ready_to_confirm': {
        if (!settings.confirm.auto_confirm_visit) {
          await escalate(client, {
            serviceRequestId: id,
            reasonCode: 'ready_to_confirm',
            note: 'auto_confirm_visit=false — escalated for human confirm',
          });
          return {
            service_request_id: id,
            reason: item.reason,
            action: 'escalate_confirm',
            ok: true,
            detail: 'auto_confirm_visit off',
          };
        }
        if (settings.confirm.require_contractor_ack && !item.arrival_acked_at) {
          return {
            service_request_id: id,
            reason: item.reason,
            action: 'wait_ack',
            ok: true,
            detail: 'ack required',
          };
        }
        await confirmVisit(client, {
          serviceRequestId: id,
          actorRole: 'agent',
          actorId: AGENT_ACTOR_ID,
        });
        return {
          service_request_id: id,
          reason: item.reason,
          action: 'confirm_visit',
          ok: true,
        };
      }
      case 'awaiting_arrival': {
        await client.query(
          `INSERT INTO job_events
             (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
           SELECT id, status, status, 'agent', $2, $3, clock_timestamp()
           FROM service_requests WHERE id = $1`,
          [id, AGENT_ACTOR_ID, 'nudge: awaiting contractor ack_arrival'],
        );
        return {
          service_request_id: id,
          reason: item.reason,
          action: 'nudge_ack',
          ok: true,
        };
      }
      case 'sla_breach_soon':
      case 'stuck':
      case 'stale_confirmed':
      case 'pool_exhaust': {
        await escalate(client, {
          serviceRequestId: id,
          reasonCode: item.reason,
          note: `agent escalate: ${item.reason}`,
        });
        return {
          service_request_id: id,
          reason: item.reason,
          action: 'escalate',
          ok: true,
        };
      }
      default:
        return {
          service_request_id: id,
          reason: item.reason,
          action: 'noop',
          ok: true,
        };
    }
  } catch (e) {
    const err = e as { code?: string; message?: string; status?: number };
    if (err.code === 'OWNED_BY_OPS' || err.status === 403) {
      await escalate(client, {
        serviceRequestId: id,
        reasonCode: 'agent_forbidden',
        note: `agent 403 → escalate (${err.code ?? 'forbidden'})`,
      });
      return {
        service_request_id: id,
        reason: item.reason,
        action: 'escalate_forbidden',
        ok: false,
        code: err.code,
        detail: err.message,
      };
    }
    return {
      service_request_id: id,
      reason: item.reason,
      action: 'error',
      ok: false,
      code: err.code,
      detail: err.message,
    };
  }
}

export async function runAgentTick(
  client: pg.PoolClient,
  opts: {
    triggeredByRole: 'ops' | 'agent' | 'system';
    triggeredById: string;
    limit?: number;
  },
) {
  await expirePendingOffers(client);
  const policy = await loadAgentPolicy(client);
  const queue = await buildAgentWorkQueue(client, policy.settings);
  const limit = opts.limit ?? 25;
  const slice = queue.slice(0, limit);
  const actions: TickAction[] = [];

  for (const item of slice) {
    // One savepoint per item so one failure doesn't abort the whole tick
    const sp = `tick_${item.service_request_id.replace(/-/g, '').slice(0, 12)}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      const action = await handleItem(client, item, policy.settings);
      actions.push(action);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (e) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      const err = e as { message?: string; code?: string };
      actions.push({
        service_request_id: item.service_request_id,
        reason: item.reason,
        action: 'error',
        ok: false,
        code: err.code,
        detail: err.message,
      });
    }
  }

  const log = await client.query(
    `INSERT INTO agent_tick_log
       (triggered_by_role, triggered_by_id, finished_at, items_seen, actions)
     VALUES ($1, $2, now(), $3, $4::jsonb)
     RETURNING *`,
    [
      opts.triggeredByRole,
      opts.triggeredById,
      slice.length,
      JSON.stringify(actions),
    ],
  );

  return {
    policy_version: policy.version,
    items_seen: slice.length,
    queue_size: queue.length,
    actions,
    tick: log.rows[0],
  };
}
