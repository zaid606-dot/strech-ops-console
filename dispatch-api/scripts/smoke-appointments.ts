import { SignJWT } from 'jose';

import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';

const EDGE = process.env.EDGE_BEARER_TOKEN ?? 'replace-me-edge-secret';
const SECRET = process.env.ACTOR_JWT_SECRET ?? 'replace-me-hs256-secret';

async function mint(role: string, sub: string) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(SECRET));
}

async function main() {
  process.env.EDGE_BEARER_TOKEN = EDGE;
  process.env.ACTOR_JWT_SECRET = SECRET;
  await migrate();
  const app = buildApp();
  const opsJwt = await mint('ops', '00000000-0000-4000-8000-0000000000aa');
  const headers = {
    Authorization: `Bearer ${EDGE}`,
    'X-Strech-Actor': opsJwt,
    'Content-Type': 'application/json',
  };

  const pro = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701' }),
  });
  if (pro.status !== 201) throw new Error(`seed contractor ${pro.status} ${await pro.text()}`);
  const proBody = await pro.json();

  const seed = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701' }),
  });
  if (seed.status !== 201) throw new Error(`seed request ${seed.status}`);
  const seeded = await seed.json();
  const requestId = seeded.request.id as string;

  await pool.query(
    `UPDATE service_requests
     SET preferred_window_start = $2, preferred_window_end = $3
     WHERE id = $1`,
    [requestId, proBody.slot.slot_start, proBody.slot.slot_end],
  );

  const wave = await app.request(`/v1/requests/${requestId}/offer-wave`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ strategy: 'sequential', batch_size: 1 }),
  });
  if (wave.status !== 201 && wave.status !== 200) {
    throw new Error(`wave ${wave.status} ${await wave.text()}`);
  }
  const waveBody = await wave.json();
  if (waveBody.escalated) throw new Error('unexpected escalate');

  const book = await app.request('/v1/appointments', {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      service_request_id: requestId,
      contractor_id: proBody.contractor.id,
      slot_start: proBody.slot.slot_start,
      slot_end: proBody.slot.slot_end,
    }),
  });
  if (book.status !== 201) throw new Error(`book ${book.status} ${await book.text()}`);
  const appt = await book.json();
  if (!appt.id) throw new Error('missing appointment id');

  const req = await app.request(`/v1/requests/${requestId}`, { headers });
  const reqBody = await req.json();
  if (reqBody.status !== 'booked') throw new Error(`status ${reqBody.status}`);
  if (reqBody.appointment_id !== appt.id) throw new Error('appointment_id mismatch');
  if (reqBody.assigned_contractor_id !== proBody.contractor.id) {
    throw new Error('contractor mismatch');
  }

  const pending = await pool.query(
    `SELECT status FROM dispatch_offers WHERE service_request_id = $1`,
    [requestId],
  );
  for (const r of pending.rows) {
    if (r.status === 'pending') throw new Error('pending offer remains');
  }

  const events = await pool.query(
    `SELECT to_status FROM job_events WHERE service_request_id = $1`,
    [requestId],
  );
  if (!events.rows.some((e) => e.to_status === 'booked')) {
    throw new Error('no booked job_event');
  }

  const memJwt = await mint('member', seeded.request.homeowner_id);
  const forbidden = await app.request('/v1/appointments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': memJwt,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      service_request_id: requestId,
      contractor_id: proBody.contractor.id,
      slot_start: proBody.slot.slot_start,
      slot_end: proBody.slot.slot_end,
    }),
  });
  if (forbidden.status !== 403) throw new Error(`expected 403 got ${forbidden.status}`);

  console.log('smoke-appointments OK', appt.id);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
