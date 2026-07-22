import type { Hono } from 'hono';

import type { Env } from '../auth/actor.js';
import { ackArrival, confirmVisit } from '../domain/confirm.js';
import { cancelScheduledReminders, fireDueReminders } from '../domain/reminders.js';
import { pool } from '../db/pool.js';

function errBody(e: unknown) {
  const err = e as { code?: string; status?: number; message?: string; detail?: string };
  const status = err.status ?? (err.code === 'NOT_FOUND' ? 404 : 409);
  return {
    status: (status >= 400 && status < 600 ? status : 409) as 403 | 404 | 409,
    body: {
      error: 'confirm_error',
      code: err.code ?? 'CONFIRM_ERROR',
      detail: err.detail ?? err.message ?? 'confirm failed',
    },
  };
}

export function registerConfirmRoutes(v1: Hono<Env>) {
  v1.post('/requests/:id/ack-arrival', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'contractor' && actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await ackArrival(client, {
        serviceRequestId: c.req.param('id'),
        actorRole:
          actor.role === 'contractor'
            ? 'contractor'
            : actor.role === 'system'
              ? 'system'
              : 'ops',
        actorId: actor.sub,
      });
      await client.query('COMMIT');
      return c.json(result);
    } catch (e) {
      await client.query('ROLLBACK');
      const { status, body } = errBody(e);
      return c.json(body, status);
    } finally {
      client.release();
    }
  });

  v1.post('/requests/:id/confirm-visit', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'agent' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await confirmVisit(client, {
        serviceRequestId: c.req.param('id'),
        actorRole:
          actor.role === 'agent' ? 'agent' : actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
      });
      await client.query('COMMIT');
      return c.json(result);
    } catch (e) {
      await client.query('ROLLBACK');
      const { status, body } = errBody(e);
      if ((e as { code?: string }).code === 'OWNED_BY_OPS') {
        return c.json(body, 403);
      }
      return c.json(body, status);
    } finally {
      client.release();
    }
  });

  v1.get('/requests/:id/charges', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const { rows } = await pool.query(
      `SELECT * FROM charges WHERE service_request_id = $1 ORDER BY created_at ASC`,
      [c.req.param('id')],
    );
    return c.json({ items: rows });
  });

  v1.get('/requests/:id/reminders', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system' && actor.role !== 'agent') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const { rows } = await pool.query(
      `SELECT * FROM reminder_jobs
       WHERE service_request_id = $1
       ORDER BY fire_at ASC`,
      [c.req.param('id')],
    );
    return c.json({ items: rows });
  });

  /** System worker stub — fire due reminders → job_events. */
  v1.post('/system/fire-reminders', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'system' && actor.role !== 'ops') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fireDueReminders(client);
      await client.query('COMMIT');
      return c.json(result);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  /** Ops helper: cancel scheduled reminders (reschedule path uses this too). */
  v1.post('/requests/:id/cancel-reminders', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    await cancelScheduledReminders(pool, c.req.param('id'));
    return c.json({ ok: true });
  });
}
