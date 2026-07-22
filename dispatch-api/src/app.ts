import { Hono } from 'hono';

import { type Env, requireActor } from './auth/actor.js';
import { createServiceRequest } from './domain/requests.js';
import { pool } from './db/pool.js';
import { registerConfirmRoutes } from './routes/confirm.js';
import { registerOfferRoutes } from './routes/offers.js';
import { memberPublicRequest } from './serializers/member.js';
import { STATUSES } from './status/transitions.js';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}

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

  registerOfferRoutes(v1);
  registerConfirmRoutes(v1);

  v1.get('/health', (c) => {
    const actor = c.get('actor');
    return c.json({
      ok: true,
      service: 'strech-dispatch-api',
      stage: 5,
      actor_role: actor.role,
    });
  });

  v1.get('/meta/statuses', (c) => {
    return c.json({ items: STATUSES });
  });

  v1.get('/board', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const statuses = [
      'dispatching',
      'booked',
      'confirmed',
      'checked_in',
      'needs_review',
      'no_show',
      'disputed',
    ];
    const { rows } = await pool.query(
      `SELECT * FROM service_requests
       WHERE status = ANY ($1::service_request_status[])
       ORDER BY updated_at DESC
       LIMIT 300`,
      [statuses],
    );
    const queues: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    for (const s of statuses) {
      queues[s] = [];
      counts[s] = 0;
    }
    for (const row of rows) {
      const s = row.status as string;
      if (!queues[s]) continue;
      queues[s].push(row);
      counts[s] += 1;
    }
    return c.json({ queues, counts });
  });

  v1.get('/overview', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'dispatching')::int AS dispatching,
         COUNT(*) FILTER (WHERE status = 'booked')::int AS booked,
         COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
         COUNT(*) FILTER (WHERE status = 'checked_in')::int AS checked_in,
         COUNT(*) FILTER (WHERE promise_by < now() AND status IN ('dispatching','booked'))::int AS sla_breach
       FROM service_requests`,
    );
    return c.json(rows[0]);
  });

  v1.get('/pool', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'agent' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const category = c.req.query('category_id');
    const zip = c.req.query('zip');

    const params: unknown[] = [actor.role];
    let sql = `
      SELECT sr.id, sr.homeowner_id, sr.property_id, sr.category_id, sr.status,
             sr.preferred_window_start, sr.preferred_window_end,
             sr.assigned_contractor_id, sr.appointment_id, sr.promise_by,
             sr.confirmed_at, sr.confirmation_code, sr.created_at, sr.updated_at,
             CASE WHEN $1 = 'ops' OR $1 = 'system' THEN sr.details ELSE '{}'::jsonb END AS details
      FROM service_requests sr
      JOIN properties p ON p.id = sr.property_id
      WHERE sr.status = 'dispatching'`;
    if (category) {
      params.push(category);
      sql += ` AND sr.category_id = $${params.length}`;
    }
    if (zip) {
      params.push(zip);
      sql += ` AND p.zip = $${params.length}`;
    }
    sql += ` ORDER BY sr.promise_by ASC NULLS LAST, sr.created_at ASC LIMIT 100`;

    const { rows } = await pool.query(sql, params);
    return c.json({ items: rows, next_cursor: null });
  });

  /** Member (or ops acting for demo) books a visit → dispatching pool. */
  v1.post('/requests', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'member' && actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }

    let body: {
      property_id?: string;
      category_id?: string;
      preferred_window_start?: string | null;
      preferred_window_end?: string | null;
      details?: Record<string, unknown>;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (!body.property_id || !isUuid(body.property_id)) {
      return c.json({ error: 'validation_error', detail: 'property_id required' }, 422);
    }
    if (!body.category_id || typeof body.category_id !== 'string') {
      return c.json({ error: 'validation_error', detail: 'category_id required' }, 422);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prop = await client.query(
        `SELECT p.id, p.homeowner_id, h.membership_tier
         FROM properties p
         JOIN homeowners h ON h.id = p.homeowner_id
         WHERE p.id = $1
         FOR UPDATE OF p`,
        [body.property_id],
      );
      if (!prop.rowCount) {
        await client.query('ROLLBACK');
        return c.json({ error: 'not_found', detail: 'property' }, 404);
      }
      const homeownerId = prop.rows[0].homeowner_id as string;
      if (actor.role === 'member' && actor.sub !== homeownerId) {
        await client.query('ROLLBACK');
        return c.json({ error: 'forbidden' }, 403);
      }

      const row = await createServiceRequest(client, {
        homeownerId,
        propertyId: body.property_id,
        categoryId: body.category_id,
        membershipTier: prop.rows[0].membership_tier as string,
        preferredWindowStart: body.preferred_window_start,
        preferredWindowEnd: body.preferred_window_end,
        details: body.details,
        actorRole: actor.role,
        actorId: actor.sub,
      });
      await client.query('COMMIT');
      if (actor.role === 'member') {
        return c.json(memberPublicRequest(row), 201);
      }
      return c.json(row, 201);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  /**
   * Ops demo seed: creates homeowner + property + dispatching request.
   * Console "Seed request" button uses this — not a member app.
   */
  v1.post('/ops/seed-request', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }

    let body: {
      category_id?: string;
      city?: string;
      state?: string;
      zip?: string;
      membership_tier?: string;
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const category = body.category_id ?? 'hvac';
    const tier = body.membership_tier ?? 'Comfort';
    if (!['Free', 'Comfort', 'Premium'].includes(tier)) {
      return c.json({ error: 'validation_error', detail: 'membership_tier' }, 422);
    }

    const start = new Date();
    start.setDate(start.getDate() + 2);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(12, 0, 0, 0);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ho = await client.query(
        `INSERT INTO homeowners (full_name, email, membership_tier)
         VALUES ($1, $2, $3) RETURNING id`,
        [
          `Seed Member ${Date.now().toString(36)}`,
          `seed+${Date.now()}@strech.local`,
          tier,
        ],
      );
      const prop = await client.query(
        `INSERT INTO properties (homeowner_id, address_line1, city, state, zip)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          ho.rows[0].id,
          '100 Seed Lane',
          body.city ?? 'Austin',
          body.state ?? 'TX',
          body.zip ?? '78701',
        ],
      );
      const row = await createServiceRequest(client, {
        homeownerId: ho.rows[0].id,
        propertyId: prop.rows[0].id,
        categoryId: category,
        membershipTier: tier,
        preferredWindowStart: start.toISOString(),
        preferredWindowEnd: end.toISOString(),
        details: { source: 'ops_seed', note: 'Stage 3 demo seed' },
        actorRole: 'ops',
        actorId: actor.sub,
        note: 'ops seeded request into dispatch pool',
      });
      await client.query('COMMIT');
      return c.json(
        {
          request: row,
          homeowner_id: ho.rows[0].id,
          property_id: prop.rows[0].id,
        },
        201,
      );
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  v1.get('/requests/:id', async (c) => {
    const actor = c.get('actor');
    const id = c.req.param('id');
    const { rows } = await pool.query(`SELECT * FROM service_requests WHERE id = $1`, [id]);
    if (!rows[0]) return c.json({ error: 'not_found' }, 404);

    if (actor.role === 'member') {
      if (rows[0].homeowner_id !== actor.sub) return c.json({ error: 'forbidden' }, 403);
      return c.json(memberPublicRequest(rows[0]));
    }
    if (actor.role === 'contractor') {
      if (rows[0].assigned_contractor_id !== actor.sub) {
        return c.json({ error: 'forbidden' }, 403);
      }
      // Field payload — no billing; access notes OK later via redaction tiers
      const { details, ...rest } = rows[0] as Record<string, unknown>;
      const safeDetails =
        details && typeof details === 'object'
          ? Object.fromEntries(
              Object.entries(details as Record<string, unknown>).filter(
                ([k]) => !k.startsWith('safety.'),
              ),
            )
          : {};
      return c.json({ ...rest, details: safeDetails });
    }
    if (actor.role === 'agent') {
      return c.json({ ...rows[0], details: {} });
    }
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    return c.json(rows[0]);
  });

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

  v1.get('/requests/:id/events', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system' && actor.role !== 'agent') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const id = c.req.param('id');
    const { rows } = await pool.query(
      `SELECT id, service_request_id, from_status, to_status, actor_role, actor_id, note, created_at
       FROM job_events WHERE service_request_id = $1
       ORDER BY created_at ASC, id ASC`,
      [id],
    );
    return c.json({ items: rows });
  });

  app.route('/v1', v1);
  return app;
}
