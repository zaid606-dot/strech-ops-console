import type { Hono } from 'hono';

import type { Env } from '../auth/actor.js';
import { agentSafeCase, listCases, resolveCase } from '../domain/cases.js';
import {
  approveScopeChange,
  cancelRequest,
  flagFieldIssue,
  markNoShow,
  openEmergency,
  openPartsHold,
  openScopeChange,
  redispatch,
  unassign,
} from '../domain/recovery.js';
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
      error: 'case_error',
      code: err.code ?? 'CASE_ERROR',
      detail: err.detail ?? err.message ?? 'case action failed',
    },
  };
}

export function registerCaseRoutes(v1: Hono<Env>) {
  v1.get('/cases', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system' && actor.role !== 'agent') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const items = await listCases(pool, {
      status: c.req.query('status') ?? 'open',
      type: c.req.query('type') ?? undefined,
      serviceRequestId: c.req.query('service_request_id') ?? undefined,
    });
    if (actor.role === 'agent') {
      return c.json({ items: items.map((r) => agentSafeCase(r as Record<string, unknown>)) });
    }
    return c.json({ items });
  });

  v1.post('/cases/:id/resolve', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden', code: 'OPS_ONLY' }, 403);
    }
    let body: { resolution?: 'resolved' | 'dismissed'; note?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Block agent path already; also refuse if somehow emergency resolved by non-ops — ops only above
      const peek = await client.query(`SELECT type FROM cases WHERE id = $1`, [c.req.param('id')]);
      if (!peek.rowCount) {
        await client.query('ROLLBACK');
        return c.json({ error: 'not_found' }, 404);
      }
      const result = await resolveCase(client, {
        caseId: c.req.param('id'),
        actorRole: actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
        resolution: body.resolution === 'dismissed' ? 'dismissed' : 'resolved',
        note: body.note,
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

  v1.post('/cases/:id/approve-scope', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops') {
      return c.json({ error: 'forbidden', code: 'SCOPE_APPROVE_OPS_ONLY' }, 403);
    }
    let body: { amount_cents?: number } = {};
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
      const result = await approveScopeChange(client, {
        caseId: c.req.param('id'),
        actorRole: 'ops',
        actorId: actor.sub,
        amountCents: body.amount_cents,
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

  v1.post('/requests/:id/no-show', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system' && actor.role !== 'agent') {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: { party?: string; note?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const party = body.party === 'homeowner' ? 'homeowner' : 'contractor';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await markNoShow(client, {
        serviceRequestId: c.req.param('id'),
        party,
        actorRole: actor.role === 'agent' ? 'agent' : actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
        note: body.note,
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

  v1.post('/requests/:id/cancel', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'member' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: { reason?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const reason = body.reason?.trim() || 'cancelled';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await cancelRequest(client, {
        serviceRequestId: c.req.param('id'),
        actorRole:
          actor.role === 'member' ? 'member' : actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
        reason,
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

  v1.post('/requests/:id/redispatch', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: { note?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await redispatch(client, {
        serviceRequestId: c.req.param('id'),
        actorRole: actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
        note: body.note,
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

  v1.post('/requests/:id/unassign', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: { note?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await unassign(client, {
        serviceRequestId: c.req.param('id'),
        actorRole: actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
        note: body.note,
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

  v1.post('/requests/:id/parts-hold', async (c) => {
    const actor = c.get('actor');
    if (
      actor.role !== 'ops' &&
      actor.role !== 'agent' &&
      actor.role !== 'contractor' &&
      actor.role !== 'system'
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: { deferred_items?: string[]; note?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await openPartsHold(client, {
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
        deferredItems: body.deferred_items ?? [],
        note: body.note,
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

  v1.post('/requests/:id/scope-change', async (c) => {
    const actor = c.get('actor');
    if (
      actor.role !== 'ops' &&
      actor.role !== 'agent' &&
      actor.role !== 'contractor' &&
      actor.role !== 'system'
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: { description?: string; proposed_amount_cents?: number } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    if (!body.description?.trim()) {
      return c.json({ error: 'validation_error', detail: 'description required' }, 422);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await openScopeChange(client, {
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
        description: body.description.trim(),
        proposedAmountCents: body.proposed_amount_cents,
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

  v1.post('/requests/:id/flag', async (c) => {
    const actor = c.get('actor');
    if (
      actor.role !== 'ops' &&
      actor.role !== 'agent' &&
      actor.role !== 'contractor' &&
      actor.role !== 'system'
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: { kind?: string; note?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    if (body.kind !== 'late' && body.kind !== 'cant_find') {
      return c.json({ error: 'validation_error', detail: 'kind must be late|cant_find' }, 422);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await flagFieldIssue(client, {
        serviceRequestId: c.req.param('id'),
        kind: body.kind,
        actorRole:
          actor.role === 'contractor'
            ? 'contractor'
            : actor.role === 'agent'
              ? 'agent'
              : actor.role === 'system'
                ? 'system'
                : 'ops',
        actorId: actor.sub,
        note: body.note,
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

  /** Global emergency ingress (H9). */
  v1.post('/emergency', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden', code: 'AGENT_FORBIDDEN' }, 403);
    }
    let body: {
      service_request_id?: string;
      property_id?: string;
      homeowner_id?: string;
      signal_type?: string;
      payload?: Record<string, unknown>;
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    if (!body.signal_type?.trim()) {
      return c.json({ error: 'validation_error', detail: 'signal_type required' }, 422);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await openEmergency(client, {
        serviceRequestId: body.service_request_id,
        propertyId: body.property_id,
        homeownerId: body.homeowner_id,
        signalType: body.signal_type.trim(),
        payload: body.payload,
        actorRole: actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
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

  /** Contractor panic / per-request emergency. */
  v1.post('/requests/:id/emergency', async (c) => {
    const actor = c.get('actor');
    if (
      actor.role !== 'ops' &&
      actor.role !== 'system' &&
      actor.role !== 'contractor'
    ) {
      return c.json({ error: 'forbidden', code: 'AGENT_FORBIDDEN' }, 403);
    }
    let body: { signal_type?: string; payload?: Record<string, unknown> } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (actor.role === 'contractor') {
        const sr = await client.query(
          `SELECT assigned_contractor_id FROM service_requests WHERE id = $1`,
          [c.req.param('id')],
        );
        if (!sr.rowCount || sr.rows[0].assigned_contractor_id !== actor.sub) {
          await client.query('ROLLBACK');
          return c.json({ error: 'forbidden' }, 403);
        }
      }
      const result = await openEmergency(client, {
        serviceRequestId: c.req.param('id'),
        signalType: body.signal_type?.trim() || 'contractor_panic',
        payload: body.payload,
        actorRole: actor.role === 'contractor' ? 'contractor' : actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
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
}
