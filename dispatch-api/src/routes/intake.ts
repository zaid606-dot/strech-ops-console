import type { Hono } from 'hono';

import type { Env } from '../auth/actor.js';
import { createServiceRequest } from '../domain/requests.js';
import { pool } from '../db/pool.js';

const TIERS = new Set(['Free', 'Comfort', 'Premium']);

/**
 * Ops books a real member visit into the dispatch pool.
 * Replaces fake seed data for day-to-day desk use.
 */
export function registerIntakeRoutes(v1: Hono<Env>) {
  v1.post('/ops/bookings', async (c) => {
    const actor = c.get('actor');
    if (actor.role !== 'ops' && actor.role !== 'system') {
      return c.json({ error: 'forbidden' }, 403);
    }

    let body: {
      member?: {
        full_name?: string;
        email?: string | null;
        phone?: string | null;
        membership_tier?: string;
      };
      property?: {
        address_line1?: string;
        address_line2?: string | null;
        city?: string;
        state?: string;
        zip?: string;
        timezone?: string;
      };
      request?: {
        category_id?: string;
        preferred_window_start?: string | null;
        preferred_window_end?: string | null;
        details?: Record<string, unknown>;
        note?: string;
      };
      /** Optional: book against an existing property instead of creating member+property. */
      property_id?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const category = body.request?.category_id?.trim();
    if (!category) {
      return c.json({ error: 'validation_error', detail: 'request.category_id required' }, 422);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let homeownerId: string;
      let propertyId: string;
      let membershipTier: string;

      if (body.property_id) {
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
        homeownerId = prop.rows[0].homeowner_id as string;
        propertyId = prop.rows[0].id as string;
        membershipTier = prop.rows[0].membership_tier as string;
      } else {
        const member = body.member ?? {};
        const property = body.property ?? {};
        const fullName = member.full_name?.trim();
        const address = property.address_line1?.trim();
        const city = property.city?.trim();
        const state = property.state?.trim();
        const zip = property.zip?.trim();
        const tier = member.membership_tier ?? 'Comfort';

        if (!fullName) {
          await client.query('ROLLBACK');
          return c.json({ error: 'validation_error', detail: 'member.full_name required' }, 422);
        }
        if (!address || !city || !state || !zip) {
          await client.query('ROLLBACK');
          return c.json(
            {
              error: 'validation_error',
              detail: 'property.address_line1, city, state, zip required',
            },
            422,
          );
        }
        if (!TIERS.has(tier)) {
          await client.query('ROLLBACK');
          return c.json({ error: 'validation_error', detail: 'membership_tier' }, 422);
        }
        if (!member.email?.trim() && !member.phone?.trim()) {
          await client.query('ROLLBACK');
          return c.json(
            { error: 'validation_error', detail: 'member.email or member.phone required' },
            422,
          );
        }

        const ho = await client.query(
          `INSERT INTO homeowners (full_name, email, phone, membership_tier)
           VALUES ($1, $2, $3, $4) RETURNING id, membership_tier`,
          [
            fullName,
            member.email?.trim() || null,
            member.phone?.trim() || null,
            tier,
          ],
        );
        const prop = await client.query(
          `INSERT INTO properties (
             homeowner_id, address_line1, address_line2, city, state, zip, timezone
           ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            ho.rows[0].id,
            address,
            property.address_line2?.trim() || null,
            city,
            state,
            zip,
            property.timezone?.trim() || 'America/Chicago',
          ],
        );
        homeownerId = ho.rows[0].id as string;
        propertyId = prop.rows[0].id as string;
        membershipTier = ho.rows[0].membership_tier as string;
      }

      const details = {
        ...(body.request?.details && typeof body.request.details === 'object'
          ? body.request.details
          : {}),
        source: 'ops_booking',
      };

      const row = await createServiceRequest(client, {
        homeownerId,
        propertyId,
        categoryId: category,
        membershipTier,
        preferredWindowStart: body.request?.preferred_window_start ?? null,
        preferredWindowEnd: body.request?.preferred_window_end ?? null,
        details,
        actorRole: actor.role === 'system' ? 'system' : 'ops',
        actorId: actor.sub,
        note: body.request?.note?.trim() || 'ops booked visit into dispatch pool',
      });

      await client.query('COMMIT');
      return c.json(
        {
          request: row,
          homeowner_id: homeownerId,
          property_id: propertyId,
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
}
