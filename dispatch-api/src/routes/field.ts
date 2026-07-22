import type { Hono } from 'hono';

import type { Env } from '../auth/actor.js';
import {
  applyFieldSms,
  checkIn,
  completeJob,
  listContractorJobs,
  markEnRoute,
  memberProgress,
} from '../domain/field.js';
import { pool } from '../db/pool.js';
import { IllegalTransitionError } from '../status/transitions.js';

function errBody(e: unknown) {
  if (e instanceof IllegalTransitionError) {
    return {
      status: 409 as const,
      body: {
        error: 'illegal_transition',
        code: e.code,
        detail: e.message,
      },
    };
  }
  const err = e as { code?: string; status?: number; message?: string; detail?: string };
  const status = err.status ?? (err.code === 'NOT_FOUND' ? 404 : 409);
  return {
    status: (status >= 400 && status < 600 ? status : 409) as 403 | 404 | 409 | 422,
    body: {
      error: 'field_error',
      code: err.code ?? 'FIELD_ERROR',
      detail: err.detail ?? err.message ?? 'field action failed',
    },
  };
}

export function registerFieldRoutes(v1: Hono<Env>) {
  v1.get('/contractors/me/jobs', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'contractor') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const items = await listContractorJobs(pool, actor.sub);
    return c.json({ items });
  });

  v1.post('/requests/:id/en-route', async (c) => {
    const actor = c.get('actor');
    if (
      actor.role !== 'contractor' &&
      actor.role !== 'ops' &&
      actor.role !== 'agent' &&
      actor.role !== 'system'
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }
    let note: string | undefined;
    try {
      const body = await c.req.json();
      note = typeof body?.note === 'string' ? body.note : undefined;
    } catch {
      /* empty */
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await markEnRoute(client, {
        serviceRequestId: c.req.param('id'),
        actorRole:
          actor.role === 'contractor'
            ? 'contractor'
            : actor.role === 'agent'
              ? 'agent'
              : actor.role === 'system'
                ? 'system'
                : 'ops',
        actorId: actor.sub,
        note,
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

  v1.post('/requests/:id/check-in', async (c) => {
    const actor = c.get('actor');
    if (
      actor.role !== 'contractor' &&
      actor.role !== 'ops' &&
      actor.role !== 'agent' &&
      actor.role !== 'system'
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }
    let note: string | undefined;
    try {
      const body = await c.req.json();
      note = typeof body?.note === 'string' ? body.note : undefined;
    } catch {
      /* empty */
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await checkIn(client, {
        serviceRequestId: c.req.param('id'),
        actorRole:
          actor.role === 'contractor'
            ? 'contractor'
            : actor.role === 'agent'
              ? 'agent'
              : actor.role === 'system'
                ? 'system'
                : 'ops',
        actorId: actor.sub,
        note,
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

  v1.post('/requests/:id/complete', async (c) => {
    const actor = c.get('actor');
    if (
      actor.role !== 'contractor' &&
      actor.role !== 'ops' &&
      actor.role !== 'agent' &&
      actor.role !== 'system'
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }
    let summary = '';
    try {
      const body = await c.req.json();
      summary = typeof body?.summary === 'string' ? body.summary : '';
    } catch {
      summary = '';
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await completeJob(client, {
        serviceRequestId: c.req.param('id'),
        actorRole:
          actor.role === 'contractor'
            ? 'contractor'
            : actor.role === 'agent'
              ? 'agent'
              : actor.role === 'system'
                ? 'system'
                : 'ops',
        actorId: actor.sub,
        summary,
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

  /** SMS inbound stub — allowlisted parser only. */
  v1.post('/field/sms-inbound', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'agent' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: { body?: string; from?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    if (!body.body || typeof body.body !== 'string') {
      return c.json({ error: 'validation_error', detail: 'body required' }, 422);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await applyFieldSms(client, {
        body: body.body,
        fromPhone: body.from,
        actorRole:
          actor.role === 'agent' ? 'agent' : actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
      });
      if (result.escalate && result.reason === 'ambiguous') {
        // Open escalation if we can resolve a single confirmed/checked_in by recent activity — skip for stub
      }
      await client.query('COMMIT');
      return c.json(result, result.applied ? 200 : 422);
    } catch (e) {
      await client.query('ROLLBACK');
      const { status, body: b } = errBody(e);
      return c.json(b, status);
    } finally {
      client.release();
    }
  });

  v1.get('/requests/:id/member-progress', async (c) => {
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
    const progress = await memberProgress(pool, id);
    return c.json(progress);
  });
}
