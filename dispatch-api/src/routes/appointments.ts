import type { Hono } from 'hono';

import type { Env } from '../auth/actor.js';
import { directBookAppointment } from '../domain/offers.js';
import { pool } from '../db/pool.js';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}

function errBody(e: unknown) {
  const err = e as { code?: string; status?: number; message?: string };
  const status = err.status ?? (err.code === 'NOT_FOUND' ? 404 : 409);
  return {
    status: status >= 400 && status < 600 ? status : 409,
    body: {
      error: 'appointment_error',
      code: err.code ?? 'APPOINTMENT_ERROR',
      detail: err.message ?? 'appointment failed',
    },
  };
}

/** Ops desk: POST /v1/appointments — direct-book a dispatching request. */
export function registerAppointmentRoutes(v1: Hono<Env>) {
  v1.post('/appointments', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }

    let body: {
      service_request_id?: string;
      contractor_id?: string;
      slot_start?: string;
      slot_end?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (!body.service_request_id || !isUuid(body.service_request_id)) {
      return c.json(
        { error: 'validation_error', detail: 'service_request_id required' },
        422,
      );
    }
    if (!body.contractor_id || !isUuid(body.contractor_id)) {
      return c.json({ error: 'validation_error', detail: 'contractor_id required' }, 422);
    }
    if (!body.slot_start || !body.slot_end) {
      return c.json(
        { error: 'validation_error', detail: 'slot_start and slot_end required' },
        422,
      );
    }
    const start = new Date(body.slot_start);
    const end = new Date(body.slot_end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return c.json({ error: 'validation_error', detail: 'invalid slot range' }, 422);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await directBookAppointment(client, {
        serviceRequestId: body.service_request_id,
        contractorId: body.contractor_id,
        slotStart: start.toISOString(),
        slotEnd: end.toISOString(),
        actorRole: actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
      });
      await client.query('COMMIT');
      return c.json(row, 201);
    } catch (e) {
      await client.query('ROLLBACK');
      const { status, body: b } = errBody(e);
      if ((e as { code?: string }).code === 'NOT_FOUND') {
        return c.json(b, 404);
      }
      return c.json(b, status as 409);
    } finally {
      client.release();
    }
  });
}
