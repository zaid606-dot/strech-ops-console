import { createMiddleware } from 'hono/factory';

import type { Env } from './actor.js';
import { pool } from '../db/pool.js';

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Replay-safe writes when `Idempotency-Key` is present.
 * Missing key → proceed (reads and legacy callers). BFF always sends keys.
 */
export const idempotency = createMiddleware<Env>(async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (!WRITE.has(method)) {
    await next();
    return;
  }

  const key = c.req.header('idempotency-key')?.trim();
  if (!key) {
    await next();
    return;
  }

  const actor = c.get('actor');
  const path = new URL(c.req.url).pathname;

  const existing = await pool.query(
    `SELECT status_code, response_body FROM idempotency_keys
     WHERE actor_sub = $1 AND idem_key = $2`,
    [actor.sub, key],
  );
  if (existing.rowCount) {
    c.header('Idempotent-Replay', 'true');
    return c.json(existing.rows[0].response_body, existing.rows[0].status_code);
  }

  await next();

  // Persist JSON responses only
  try {
    const res = c.res;
    if (!res) return;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return;
    const status = res.status;
    const clone = res.clone();
    const body = await clone.json();
    await pool.query(
      `INSERT INTO idempotency_keys
         (actor_sub, actor_role, idem_key, method, path, status_code, response_body)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (actor_sub, idem_key) DO NOTHING`,
      [actor.sub, actor.role, key, method, path, status, JSON.stringify(body)],
    );
  } catch {
    // Never fail the primary request because of idempotency bookkeeping
  }
});
