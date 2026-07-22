import type { Hono } from 'hono';

import type { Env } from '../auth/actor.js';
import { loadAgentPolicy, updateAgentPolicy } from '../domain/agentPolicyStore.js';
import { runAgentTick } from '../domain/agentTick.js';
import { buildAgentWorkQueue } from '../domain/agentWork.js';
import { pool } from '../db/pool.js';

export function registerAgentRoutes(v1: Hono<Env>) {
  v1.get('/agent/policy', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'agent' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const policy = await loadAgentPolicy(pool);
    return c.json(policy);
  });

  v1.patch('/agent/policy', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops') {
      return c.json({ error: 'forbidden', code: 'POLICY_WRITE_OPS_ONLY' }, 403);
    }
    let body: Record<string, unknown> = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const policy = await updateAgentPolicy(client, {
        patch: {
          offer: body.offer as never,
          confirm: body.confirm as never,
          field: body.field as never,
          sla: body.sla as never,
          stuck: body.stuck as never,
        },
        updatedBy: actor.sub,
      });
      await client.query('COMMIT');
      return c.json(policy);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  v1.get('/agent/work', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'agent' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const policy = await loadAgentPolicy(pool);
    const items = await buildAgentWorkQueue(pool, policy.settings);
    return c.json({ items, policy_version: policy.version });
  });

  v1.get('/agent/ticks', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const { rows } = await pool.query(
      `SELECT * FROM agent_tick_log ORDER BY started_at DESC LIMIT 30`,
    );
    return c.json({ items: rows });
  });

  v1.get('/agent/escalations', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system' && actor.role !== 'agent') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const { rows } = await pool.query(
      `SELECT c.*, sr.confirmation_code, sr.status AS request_status
       FROM cases c
       JOIN service_requests sr ON sr.id = c.service_request_id
       WHERE c.status = 'open' AND c.type = 'escalation'
       ORDER BY c.created_at DESC
       LIMIT 100`,
    );
    return c.json({ items: rows });
  });

  /** Run one agent tick (ops “Run tick now” or system worker). Mutations use agent actor. */
  v1.post('/agent/tick', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'agent' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    let limit = 25;
    try {
      const body = await c.req.json();
      if (typeof body?.limit === 'number') limit = Math.min(50, Math.max(1, body.limit));
    } catch {
      /* empty */
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await runAgentTick(client, {
        triggeredByRole:
          actor.role === 'agent' ? 'agent' : actor.role === 'system' ? 'system' : 'ops',
        triggeredById: actor.sub,
        limit,
      });
      await client.query('COMMIT');
      return c.json(result);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
}
