import { Hono } from 'hono';

import { type Env, requireActor } from './auth/actor.js';
import { pool } from './db/pool.js';
import { memberPublicRequest } from './serializers/member.js';
import { STATUSES } from './status/transitions.js';

export function buildApp() {
  const app = new Hono<Env>();

  app.get('/api/ready', async (c) => {
    try {
      await pool.query('SELECT 1');
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  const v1 = new Hono<Env>();
  v1.use('*', requireActor);

  v1.get('/health', (c) => {
    const actor = c.get('actor');
    return c.json({
      ok: true,
      service: 'strech-dispatch-api',
      stage: 2,
      actor_role: actor.role,
    });
  });

  v1.get('/meta/statuses', (c) => {
    return c.json({ items: STATUSES });
  });

  /** Minimal read used by later pool UI; empty until Stage 3 seeds. */
  v1.get('/pool', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'agent' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const { rows } = await pool.query(
      `SELECT id, homeowner_id, property_id, category_id, status,
              preferred_window_start, preferred_window_end,
              assigned_contractor_id, appointment_id, promise_by,
              confirmed_at, confirmation_code, created_at, updated_at,
              CASE WHEN $1 = 'ops' OR $1 = 'system' THEN details ELSE '{}'::jsonb END AS details
       FROM service_requests
       WHERE status = 'dispatching'
       ORDER BY created_at ASC
       LIMIT 100`,
      [actor.role],
    );
    return c.json({ items: rows });
  });

  /** Member-safe projection for INV-2 tests / Stage 3+. */
  v1.get('/requests/:id/member-view', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'member' && actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const id = c.req.param('id');
    const { rows } = await pool.query(`SELECT * FROM service_requests WHERE id = $1`, [id]);
    if (!rows[0]) return c.json({ error: 'not_found' }, 404);

    if (actor.role === 'member' && rows[0].homeowner_id !== actor.sub) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const view = memberPublicRequest(rows[0]);
    if ('assigned_contractor_id' in view) {
      return c.json({ error: 'inv2_violation' }, 500);
    }
    return c.json(view);
  });

  app.route('/v1', v1);
  return app;
}
