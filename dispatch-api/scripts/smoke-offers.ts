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

  const pro2 = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', full_name: 'Pro Two' }),
  });
  if (pro2.status !== 201) throw new Error(`seed contractor2 ${pro2.status}`);
  const pro2Body = await pro2.json();
  // Align second pro slot with first
  await pool.query(
    `UPDATE availability_slots SET slot_start = $2, slot_end = $3 WHERE contractor_id = $1`,
    [pro2Body.contractor.id, proBody.slot.slot_start, proBody.slot.slot_end],
  );

  const seed = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      category_id: 'hvac',
      zip: '78701',
      membership_tier: 'Comfort',
    }),
  });
  if (seed.status !== 201) throw new Error(`seed request ${seed.status}`);
  const seeded = await seed.json();
  const requestId = seeded.request.id as string;

  // Align preferred window with contractor slot so scoring finds them
  await pool.query(
    `UPDATE service_requests
     SET preferred_window_start = $2, preferred_window_end = $3
     WHERE id = $1`,
    [requestId, proBody.slot.slot_start, proBody.slot.slot_end],
  );

  const wave = await app.request(`/v1/requests/${requestId}/offer-wave`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ strategy: 'parallel_batch', batch_size: 3, ttl_seconds: 600 }),
  });
  if (wave.status !== 201 && wave.status !== 200) {
    throw new Error(`wave ${wave.status} ${await wave.text()}`);
  }
  const waveBody = await wave.json();
  if (waveBody.escalated) throw new Error('unexpected escalate');
  if (!waveBody.offers?.length) throw new Error('no offers');

  if (waveBody.offers.length < 2) throw new Error('expected ≥2 offers for race test');

  const offerId = waveBody.offers[0].id as string;
  const offerId2 = waveBody.offers[1].id as string;

  const accept1 = await app.request(`/v1/offers/${offerId}/accept`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contractor_id: waveBody.offers[0].contractor_id }),
  });
  if (accept1.status !== 200) {
    throw new Error(`accept ${accept1.status} ${await accept1.text()}`);
  }

  const accept2 = await app.request(`/v1/offers/${offerId2}/accept`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contractor_id: waveBody.offers[1].contractor_id }),
  });
  if (accept2.status !== 409) {
    throw new Error(`second accept expected 409 got ${accept2.status}`);
  }
  const lost = await accept2.json();
  if (lost.code !== 'OFFER_LOST') throw new Error(`expected OFFER_LOST got ${lost.code}`);

  // SLOT_CONFLICT must persist withdraw (not roll back with the 409)
  const seedConflict = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701' }),
  });
  if (seedConflict.status !== 201) throw new Error('seed conflict request');
  const conflictReq = await seedConflict.json();
  const conflictId = conflictReq.request.id as string;
  await pool.query(
    `UPDATE service_requests
     SET preferred_window_start = $2, preferred_window_end = $3
     WHERE id = $1`,
    [conflictId, proBody.slot.slot_start, proBody.slot.slot_end],
  );
  // Free the booked contractor's slot window for a new offer by using pro2 only —
  // seed a third contractor whose slot we then collide with an appointment
  const pro3 = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', full_name: 'Pro Conflict' }),
  });
  const pro3Body = await pro3.json();
  await pool.query(
    `UPDATE availability_slots SET slot_start = $2, slot_end = $3 WHERE contractor_id = $1`,
    [pro3Body.contractor.id, proBody.slot.slot_start, proBody.slot.slot_end],
  );
  const waveC = await app.request(`/v1/requests/${conflictId}/offer-wave`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ strategy: 'sequential', ttl_seconds: 600 }),
  });
  if (waveC.status !== 201) throw new Error(`conflict wave ${waveC.status} ${await waveC.text()}`);
  const waveCBody = await waveC.json();
  const conflictOffer = waveCBody.offers[0];
  // Force appointment collision for that contractor's offered slot
  await pool.query(
    `INSERT INTO appointments (contractor_id, slot_start, slot_end) VALUES ($1,$2,$3)`,
    [conflictOffer.contractor_id, conflictOffer.slot_start, conflictOffer.slot_end],
  );
  const acceptConflict = await app.request(`/v1/offers/${conflictOffer.id}/accept`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contractor_id: conflictOffer.contractor_id }),
  });
  if (acceptConflict.status !== 409) {
    throw new Error(`slot conflict expected 409 got ${acceptConflict.status}`);
  }
  const conflictBody = await acceptConflict.json();
  if (conflictBody.code !== 'SLOT_CONFLICT') {
    throw new Error(`expected SLOT_CONFLICT got ${conflictBody.code}`);
  }
  const { rows: offerRows } = await pool.query(
    `SELECT status FROM dispatch_offers WHERE id = $1`,
    [conflictOffer.id],
  );
  if (offerRows[0]?.status !== 'withdrawn') {
    throw new Error(`SLOT_CONFLICT must leave offer withdrawn, got ${offerRows[0]?.status}`);
  }

  // Agent cannot accept when ops owns
  await pool.query(`UPDATE service_requests SET dispatch_owner = 'ops' WHERE id = $1`, [
    requestId,
  ]);
  // re-seed path: create new request for agent OWNED_BY_OPS check on wave
  const seed2 = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701' }),
  });
  const s2 = await seed2.json();
  await pool.query(
    `UPDATE service_requests
     SET preferred_window_start = $2, preferred_window_end = $3, dispatch_owner = 'ops'
     WHERE id = $1`,
    [s2.request.id, proBody.slot.slot_start, proBody.slot.slot_end],
  );
  const agentJwt = await mint('agent', '00000000-0000-4000-8000-0000000000ae');
  const agentWave = await app.request(`/v1/requests/${s2.request.id}/offer-wave`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': agentJwt,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ strategy: 'sequential' }),
  });
  if (agentWave.status !== 403) {
    throw new Error(`agent wave on ops-owned expected 403 got ${agentWave.status}`);
  }

  const board = await app.request('/v1/board', { headers });
  if (board.status !== 200) throw new Error(`board ${board.status}`);
  const boardBody = await board.json();
  if (!boardBody.counts?.booked) throw new Error('board missing booked');

  const req = await app.request(`/v1/requests/${requestId}`, { headers });
  const reqBody = await req.json();
  if (reqBody.status !== 'booked') throw new Error(`status ${reqBody.status}`);
  if (reqBody.assigned_contractor_id !== waveBody.offers[0].contractor_id) {
    throw new Error('wrong contractor assigned');
  }

  const poolRes = await app.request('/v1/pool', { headers });
  const poolBody = await poolRes.json();
  if ((poolBody.items as { id: string }[]).some((i) => i.id === requestId)) {
    throw new Error('booked request still in pool');
  }

  console.log('smoke:offers OK', {
    requestId,
    offerId,
    contractorId: proBody.contractor.id,
  });
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
