import type { Hono } from 'hono';

import type { Env } from '../auth/actor.js';
import {
  ackCompletion,
  captureCharge,
  closeRequest,
  createRefund,
  moneySnapshot,
  openDispute,
  runCaptureWorker,
  submitReview,
} from '../domain/money.js';
import { pool } from '../db/pool.js';
import { IllegalTransitionError } from '../status/transitions.js';

function errBody(e: unknown) {
  if (e instanceof IllegalTransitionError) {
    return {
      status: 409 as const,
      body: { error: 'illegal_transition', code: e.code, detail: e.message },
    };
  }
  const err = e as { code?: string; status?: number; message?: string; detail?: string };
  const status = err.status ?? (err.code === 'NOT_FOUND' ? 404 : 409);
  return {
    status: (status >= 400 && status < 600 ? status : 409) as 403 | 404 | 409 | 422,
    body: {
      error: 'money_error',
      code: err.code ?? 'MONEY_ERROR',
      detail: err.detail ?? err.message ?? 'money action failed',
    },
  };
}

export function registerMoneyRoutes(v1: Hono<Env>) {
  v1.get('/requests/:id/money', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const snap = await moneySnapshot(pool, c.req.param('id'));
    return c.json(snap);
  });

  v1.post('/requests/:id/capture', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden', code: 'OPS_ONLY' }, 403);
    }
    let body: { force_fail?: boolean } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await captureCharge(client, {
        serviceRequestId: c.req.param('id'),
        actorRole: actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
        forceFail: Boolean(body.force_fail),
      });
      await client.query('COMMIT');
      return c.json(result);
    } catch (e) {
      await client.query('ROLLBACK');
      const { status, body: b } = errBody(e);
      return c.json(b, status);
    } finally {
      client.release();
    }
  });

  v1.post('/system/run-captures', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await runCaptureWorker(client, {
        actorRole: actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
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

  v1.post('/requests/:id/ack-completion', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'member' && actor.role !== 'ops') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await ackCompletion(client, {
        serviceRequestId: c.req.param('id'),
        actorRole: actor.role === 'member' ? 'member' : 'ops',
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

  v1.post('/requests/:id/review', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'member' && actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: { rating?: number; comment?: string; timeout?: boolean } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await submitReview(client, {
        serviceRequestId: c.req.param('id'),
        actorRole:
          actor.role === 'member' ? 'member' : actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
        rating: body.rating,
        comment: body.comment,
        timeout: body.timeout,
      });
      await client.query('COMMIT');
      return c.json(result);
    } catch (e) {
      await client.query('ROLLBACK');
      const { status, body: b } = errBody(e);
      return c.json(b, status);
    } finally {
      client.release();
    }
  });

  v1.post('/requests/:id/dispute', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'member' && actor.role !== 'ops') {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: { reason?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await openDispute(client, {
        serviceRequestId: c.req.param('id'),
        actorRole: actor.role === 'member' ? 'member' : 'ops',
        actorId: actor.sub,
        reason: body.reason?.trim() || 'dispute',
      });
      await client.query('COMMIT');
      return c.json(result);
    } catch (e) {
      await client.query('ROLLBACK');
      const { status, body: b } = errBody(e);
      return c.json(b, status);
    } finally {
      client.release();
    }
  });

  v1.post('/requests/:id/refund', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops') {
      return c.json({ error: 'forbidden', code: 'OPS_ONLY' }, 403);
    }
    let body: { amount_cents?: number; reason?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    if (typeof body.amount_cents !== 'number') {
      return c.json({ error: 'validation_error', detail: 'amount_cents required' }, 422);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await createRefund(client, {
        serviceRequestId: c.req.param('id'),
        actorRole: 'ops',
        actorId: actor.sub,
        amountCents: body.amount_cents,
        reason: body.reason?.trim() || 'ops refund',
      });
      await client.query('COMMIT');
      return c.json(result, 201);
    } catch (e) {
      await client.query('ROLLBACK');
      const { status, body: b } = errBody(e);
      return c.json(b, status);
    } finally {
      client.release();
    }
  });

  v1.post('/requests/:id/close', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: { note?: string; waive_payout_hold?: boolean } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await closeRequest(client, {
        serviceRequestId: c.req.param('id'),
        actorRole: actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
        note: body.note,
        waivePayoutHold: Boolean(body.waive_payout_hold),
      });
      await client.query('COMMIT');
      return c.json(result);
    } catch (e) {
      await client.query('ROLLBACK');
      const { status, body: b } = errBody(e);
      return c.json(b, status);
    } finally {
      client.release();
    }
  });
}
