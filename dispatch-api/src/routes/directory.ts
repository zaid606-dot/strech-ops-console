import type { Hono } from 'hono';

import type { Env } from '../auth/actor.js';
import { pool } from '../db/pool.js';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}

const VETTING = new Set(['pending', 'approved', 'suspended', 'rejected']);

/** Real contractor + property directory (not seed demos). */
export function registerDirectoryRoutes(v1: Hono<Env>) {
  v1.get('/properties/:id', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'validation_error', detail: 'id' }, 422);

    const { rows } = await pool.query(
      `SELECT p.id, p.homeowner_id, p.address_line1, p.address_line2, p.city, p.state, p.zip,
              p.timezone, p.created_at,
              h.full_name AS homeowner_full_name,
              h.email AS homeowner_email,
              h.phone AS homeowner_phone,
              h.membership_tier AS homeowner_membership_tier
       FROM properties p
       JOIN homeowners h ON h.id = p.homeowner_id
       WHERE p.id = $1`,
      [id],
    );
    if (!rows[0]) return c.json({ error: 'not_found' }, 404);
    const row = rows[0];
    return c.json({
      id: row.id,
      homeowner_id: row.homeowner_id,
      address_line1: row.address_line1,
      address_line2: row.address_line2,
      city: row.city,
      state: row.state,
      zip: row.zip,
      timezone: row.timezone,
      created_at: row.created_at,
      homeowner: {
        id: row.homeowner_id,
        full_name: row.homeowner_full_name,
        email: row.homeowner_email,
        phone: row.homeowner_phone,
        membership_tier: row.homeowner_membership_tier,
      },
    });
  });

  v1.get('/contractors', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const vetting = c.req.query('vetting_status');
    const params: unknown[] = [];
    let sql = `SELECT * FROM contractors WHERE 1=1`;
    if (vetting) {
      if (!VETTING.has(vetting)) {
        return c.json({ error: 'validation_error', detail: 'vetting_status' }, 422);
      }
      params.push(vetting);
      sql += ` AND vetting_status = $${params.length}`;
    }
    sql += ` ORDER BY created_at DESC LIMIT 200`;
    const { rows } = await pool.query(sql, params);
    return c.json({ items: rows, next_cursor: null });
  });

  v1.post('/contractors', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }

    let body: {
      full_name?: string;
      email?: string | null;
      phone?: string | null;
      categories?: string[];
      service_zips?: string[];
      rating?: number | null;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const fullName = body.full_name?.trim();
    if (!fullName) {
      return c.json({ error: 'validation_error', detail: 'full_name required' }, 422);
    }
    const categories = Array.isArray(body.categories)
      ? body.categories.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const zips = Array.isArray(body.service_zips)
      ? body.service_zips.map((s) => String(s).trim()).filter(Boolean)
      : [];
    if (categories.length === 0) {
      return c.json({ error: 'validation_error', detail: 'categories required' }, 422);
    }
    if (zips.length === 0) {
      return c.json({ error: 'validation_error', detail: 'service_zips required' }, 422);
    }

    const { rows } = await pool.query(
      `INSERT INTO contractors (
         full_name, phone, email, rating, categories, service_zips, vetting_status
       ) VALUES ($1,$2,$3,$4,$5,$6,'pending')
       RETURNING *`,
      [
        fullName,
        body.phone?.trim() || null,
        body.email?.trim() || null,
        body.rating ?? null,
        categories,
        zips,
      ],
    );
    return c.json(rows[0], 201);
  });

  v1.post('/contractors/:id/vetting', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'validation_error', detail: 'id' }, 422);

    let body: { vetting_status?: string; documents_verified?: string[] };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const status = body.vetting_status;
    if (!status || !VETTING.has(status)) {
      return c.json({ error: 'validation_error', detail: 'vetting_status' }, 422);
    }

    const { rows } = await pool.query(
      `UPDATE contractors SET
         vetting_status = $2::vetting_status,
         vetted_at = CASE WHEN $2 = 'approved' THEN COALESCE(vetted_at, now()) ELSE vetted_at END,
         suspended_at = CASE WHEN $2 = 'suspended' THEN now() ELSE NULL END,
         insurance_expires_at = CASE
           WHEN $2 = 'approved' AND insurance_expires_at IS NULL
           THEN now() + interval '1 year'
           ELSE insurance_expires_at
         END
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );
    if (!rows[0]) return c.json({ error: 'not_found' }, 404);
    return c.json(rows[0]);
  });

  v1.get('/contractors/:id/availability', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'validation_error', detail: 'id' }, 422);

    const { rows: contractors } = await pool.query(`SELECT id FROM contractors WHERE id = $1`, [
      id,
    ]);
    if (!contractors[0]) return c.json({ error: 'not_found' }, 404);

    const { rows } = await pool.query(
      `SELECT id, contractor_id, slot_start, slot_end
       FROM availability_slots
       WHERE contractor_id = $1 AND slot_end > now()
       ORDER BY slot_start ASC
       LIMIT 100`,
      [id],
    );
    return c.json({ items: rows });
  });

  v1.post('/contractors/:id/availability', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'validation_error', detail: 'id' }, 422);

    let body: {
      slot_start?: string;
      slot_end?: string;
      slots?: { slot_start: string; slot_end: string }[];
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const slots =
      Array.isArray(body.slots) && body.slots.length > 0
        ? body.slots
        : body.slot_start && body.slot_end
          ? [{ slot_start: body.slot_start, slot_end: body.slot_end }]
          : [];
    if (slots.length === 0) {
      return c.json(
        { error: 'validation_error', detail: 'slot_start/slot_end or slots required' },
        422,
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cRow = await client.query(`SELECT id FROM contractors WHERE id = $1 FOR UPDATE`, [id]);
      if (!cRow.rowCount) {
        await client.query('ROLLBACK');
        return c.json({ error: 'not_found' }, 404);
      }
      const inserted: unknown[] = [];
      for (const s of slots) {
        const start = new Date(s.slot_start);
        const end = new Date(s.slot_end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
          await client.query('ROLLBACK');
          return c.json({ error: 'validation_error', detail: 'invalid slot range' }, 422);
        }
        const { rows } = await client.query(
          `INSERT INTO availability_slots (contractor_id, slot_start, slot_end)
           VALUES ($1,$2,$3) RETURNING *`,
          [id, start.toISOString(), end.toISOString()],
        );
        inserted.push(rows[0]);
      }
      await client.query('COMMIT');
      return c.json({ items: inserted }, 201);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
}
