import type { Hono } from 'hono';

import type { Env } from '../auth/actor.js';
import {
  acceptOffer,
  declineOffer,
  expirePendingOffers,
  startOfferWave,
} from '../domain/offers.js';
import { scoreCandidates } from '../domain/scoring.js';
import { pool } from '../db/pool.js';

function errBody(e: unknown) {
  const err = e as { code?: string; status?: number; message?: string };
  const status = err.status ?? (err.code === 'NOT_FOUND' ? 404 : 409);
  return {
    status: status >= 400 && status < 600 ? status : 409,
    body: {
      error: 'offer_error',
      code: err.code ?? 'OFFER_ERROR',
      detail: err.message ?? 'offer failed',
    },
  };
}

export function registerOfferRoutes(v1: Hono<Env>) {
  v1.get('/contractors/available', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'agent' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const categoryId = c.req.query('category_id');
    const zip = c.req.query('zip');
    const windowStart = c.req.query('window_start');
    if (!categoryId || !zip || !windowStart) {
      return c.json(
        { error: 'validation_error', detail: 'category_id, zip, window_start required' },
        422,
      );
    }
    const windowEnd =
      c.req.query('window_end') ??
      new Date(new Date(windowStart).getTime() + 4 * 60 * 60 * 1000).toISOString();

    await expirePendingOffers(pool);
    const items = await scoreCandidates(pool, {
      categoryId,
      zip,
      windowStart: new Date(windowStart),
      windowEnd: new Date(windowEnd),
    });
    return c.json({ items });
  });

  v1.get('/offers', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'agent' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    await expirePendingOffers(pool);
    const requestId = c.req.query('service_request_id');
    const status = c.req.query('status') ?? 'pending';
    const params: unknown[] = [];
    let sql = `
      SELECT o.*, c.full_name, sr.confirmation_code, sr.status AS request_status
      FROM dispatch_offers o
      JOIN contractors c ON c.id = o.contractor_id
      JOIN service_requests sr ON sr.id = o.service_request_id
      WHERE 1=1`;
    if (requestId) {
      params.push(requestId);
      sql += ` AND o.service_request_id = $${params.length}`;
    }
    if (status !== 'all') {
      params.push(status);
      sql += ` AND o.status = $${params.length}`;
    }
    sql += ` ORDER BY o.created_at DESC LIMIT 200`;
    const { rows } = await pool.query(sql, params);
    return c.json({ items: rows });
  });

  v1.post('/requests/:id/offer-wave', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'agent' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: {
      strategy?: 'sequential' | 'parallel_batch';
      batch_size?: number;
      ttl_seconds?: number;
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await startOfferWave(client, {
        serviceRequestId: c.req.param('id'),
        strategy: body.strategy ?? 'parallel_batch',
        batchSize: body.batch_size ?? 3,
        ttlSeconds: body.ttl_seconds ?? 600,
        actorRole: actor.role === 'system' ? 'system' : actor.role === 'agent' ? 'agent' : 'ops',
        actorId: actor.sub,
      });
      await client.query('COMMIT');
      return c.json(result, result.escalated ? 200 : 201);
    } catch (e) {
      await client.query('ROLLBACK');
      const { status, body: b } = errBody(e);
      if ((e as { code?: string }).code === 'OWNED_BY_OPS') {
        return c.json(b, 403);
      }
      if ((e as { code?: string }).code === 'NOT_FOUND') {
        return c.json(b, 404);
      }
      return c.json(b, status as 409);
    } finally {
      client.release();
    }
  });

  v1.post('/offers/:id/accept', async (c) => {
    const actor = c.get('actor');
    if (
      actor.role !== 'ops' &&
      actor.role !== 'contractor' &&
      actor.role !== 'agent' &&
      actor.role !== 'system'
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }

    let asContractorId: string | undefined;
    try {
      const body = await c.req.json();
      asContractorId = body?.contractor_id;
    } catch {
      /* empty */
    }

    // Ops console stand-in: ops may accept on behalf of contractor_id in body
    const actorRole =
      actor.role === 'ops' && asContractorId
        ? ('ops' as const)
        : actor.role === 'contractor'
          ? ('contractor' as const)
          : actor.role === 'agent'
            ? ('agent' as const)
            : actor.role === 'system'
              ? ('system' as const)
              : ('ops' as const);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await acceptOffer(client, {
        offerId: c.req.param('id'),
        actorRole,
        actorId: actor.sub,
        asContractorId: actor.role === 'ops' ? asContractorId : undefined,
      });
      await client.query('COMMIT');
      return c.json(result);
    } catch (e) {
      // Side-effect errors (withdraw/expire) must COMMIT so the offer leaves pending
      if ((e as { persist?: boolean }).persist) {
        await client.query('COMMIT');
      } else {
        await client.query('ROLLBACK');
      }
      const { status, body } = errBody(e);
      return c.json(body, status as 409);
    } finally {
      client.release();
    }
  });

  v1.post('/offers/:id/decline', async (c) => {
    const actor = c.get('actor');
    if (
      actor.role !== 'ops' &&
      actor.role !== 'contractor' &&
      actor.role !== 'system' &&
      actor.role !== 'agent'
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await declineOffer(client, {
        offerId: c.req.param('id'),
        actorRole: actor.role,
        actorId: actor.sub,
      });
      await client.query('COMMIT');
      return c.json(result);
    } catch (e) {
      await client.query('ROLLBACK');
      const { status, body } = errBody(e);
      return c.json(body, status as 409);
    } finally {
      client.release();
    }
  });

  /** Ops seed: vetted contractor + availability slots matching a zip/category. */
  v1.post('/ops/seed-contractor', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    let body: {
      category_id?: string;
      zip?: string;
      full_name?: string;
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const category = body.category_id ?? 'hvac';
    const zip = body.zip ?? '78701';
    const start = new Date();
    start.setDate(start.getDate() + 2);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(12, 0, 0, 0);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cRow = await client.query(
        `INSERT INTO contractors (
           full_name, phone, email, rating, categories, service_zips,
           vetting_status, vetted_at, insurance_expires_at
         ) VALUES ($1,$2,$3,4.8,$4,$5,'approved', now(), now() + interval '1 year')
         RETURNING *`,
        [
          body.full_name ?? `Pro ${Date.now().toString(36)}`,
          '+15555550100',
          `pro+${Date.now()}@strech.local`,
          [category],
          [zip],
        ],
      );
      const slot = await client.query(
        `INSERT INTO availability_slots (contractor_id, slot_start, slot_end)
         VALUES ($1,$2,$3) RETURNING *`,
        [cRow.rows[0].id, start.toISOString(), end.toISOString()],
      );
      // Extra slot day+3
      const start2 = new Date(start);
      start2.setDate(start2.getDate() + 1);
      const end2 = new Date(start2);
      end2.setHours(12, 0, 0, 0);
      await client.query(
        `INSERT INTO availability_slots (contractor_id, slot_start, slot_end)
         VALUES ($1,$2,$3)`,
        [cRow.rows[0].id, start2.toISOString(), end2.toISOString()],
      );
      await client.query('COMMIT');
      return c.json({ contractor: cRow.rows[0], slot: slot.rows[0] }, 201);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
}
