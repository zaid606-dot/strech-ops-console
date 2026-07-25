import { SignJWT } from 'jose';

import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';
import { assertNoContractorLeak } from '../src/serializers/member.js';

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
  if (pro.status !== 201) throw new Error(`seed contractor ${pro.status}`);
  const proBody = await pro.json();

  const seed = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      category_id: 'hvac',
      zip: '78701',
      membership_tier: 'Free',
    }),
  });
  if (seed.status !== 201) throw new Error(`seed ${seed.status}`);
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
    body: JSON.stringify({ strategy: 'sequential', ttl_seconds: 600 }),
  });
  if (wave.status !== 201) throw new Error(`wave ${wave.status} ${await wave.text()}`);
  const waveBody = await wave.json();
  const offer = waveBody.offers[0];

  const accept = await app.request(`/v1/offers/${offer.id}/accept`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contractor_id: offer.contractor_id }),
  });
  if (accept.status !== 200) throw new Error(`accept ${accept.status}`);

  // confirm without ack → ACK_REQUIRED
  const early = await app.request(`/v1/requests/${requestId}/confirm-visit`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  if (early.status !== 409) throw new Error(`expected ACK_REQUIRED 409 got ${early.status}`);
  const earlyBody = await early.json();
  if (earlyBody.code !== 'ACK_REQUIRED') throw new Error(`code ${earlyBody.code}`);

  const contractorJwt = await mint('contractor', offer.contractor_id);
  const ack = await app.request(`/v1/requests/${requestId}/ack-arrival`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': contractorJwt,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (ack.status !== 200) throw new Error(`ack ${ack.status} ${await ack.text()}`);

  // Free tier → non-zero pending charge
  const conf = await app.request(`/v1/requests/${requestId}/confirm-visit`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  if (conf.status !== 200) throw new Error(`confirm ${conf.status} ${await conf.text()}`);
  const confBody = await conf.json();
  if (confBody.status !== 'confirmed') throw new Error('not confirmed');
  if (confBody.charge?.status !== 'pending') throw new Error('charge not pending');
  if (confBody.charge?.amount_cents <= 0) throw new Error('Free tier should have amount > 0');
  if (!confBody.reminders?.length) throw new Error('missing reminders');
  if (confBody.member_notify?.pro_label !== 'Strech Pro') {
    throw new Error('member notify must be masked');
  }
  assertNoContractorLeak(confBody.member_notify);

  const req = await app.request(`/v1/requests/${requestId}`, { headers });
  const reqBody = await req.json();
  if (reqBody.status !== 'confirmed') throw new Error(`status ${reqBody.status}`);
  if (!reqBody.arrival_acked_at || !reqBody.confirmed_at) {
    throw new Error('missing ack/confirm timestamps');
  }

  const memberJwt = await mint('member', seeded.request.homeowner_id);
  const memberView = await app.request(`/v1/requests/${requestId}/member-view`, {
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': memberJwt,
    },
  });
  if (memberView.status !== 200) throw new Error(`member-view ${memberView.status}`);
  const mv = await memberView.json();
  assertNoContractorLeak(mv);
  if (mv.pro_label !== 'Strech Pro') throw new Error('INV-2 pro_label');

  const charges = await app.request(`/v1/requests/${requestId}/charges`, { headers });
  const chargeBody = await charges.json();
  if (chargeBody.items?.[0]?.status !== 'pending') throw new Error('charges list');

  const reminders = await app.request(`/v1/requests/${requestId}/reminders`, { headers });
  const remBody = await reminders.json();
  if ((remBody.items as unknown[]).length < 3) throw new Error('expected 3 reminder rows');

  // Comfort included visit → $0 charge
  const seed2 = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      category_id: 'hvac',
      zip: '78701',
      membership_tier: 'Comfort',
    }),
  });
  const s2 = await seed2.json();
  await pool.query(
    `UPDATE service_requests
     SET preferred_window_start = $2, preferred_window_end = $3
     WHERE id = $1`,
    [s2.request.id, proBody.slot.slot_start, proBody.slot.slot_end],
  );
  // Need another contractor (first is booked)
  const pro2 = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', full_name: 'Pro Comfort' }),
  });
  const pro2Body = await pro2.json();
  await pool.query(
    `UPDATE availability_slots SET slot_start = $2, slot_end = $3 WHERE contractor_id = $1`,
    [pro2Body.contractor.id, proBody.slot.slot_start, proBody.slot.slot_end],
  );
  const wave2 = await app.request(`/v1/requests/${s2.request.id}/offer-wave`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ strategy: 'sequential' }),
  });
  const w2 = await wave2.json();
  await app.request(`/v1/offers/${w2.offers[0].id}/accept`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contractor_id: w2.offers[0].contractor_id }),
  });
  await app.request(`/v1/requests/${s2.request.id}/ack-arrival`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const conf2 = await app.request(`/v1/requests/${s2.request.id}/confirm-visit`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const c2 = await conf2.json();
  if (c2.charge?.amount_cents !== 0) throw new Error('Comfort should be $0 charge');

  // Agent OWNED_BY_OPS on confirm
  const seed3 = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701' }),
  });
  const s3 = await seed3.json();
  await pool.query(
    `UPDATE service_requests SET dispatch_owner = 'ops', status = 'booked',
       arrival_acked_at = now(), appointment_id = $2, assigned_contractor_id = $3
     WHERE id = $1`,
    [s3.request.id, reqBody.appointment_id, offer.contractor_id],
  );
  // Fake booked without real appointment exclusivity — use a fresh appointment
  const appt = await pool.query(
    `INSERT INTO appointments (contractor_id, slot_start, slot_end)
     VALUES ($1, now() + interval '3 days', now() + interval '3 days' + interval '2 hours')
     RETURNING id`,
    [pro2Body.contractor.id],
  );
  await pool.query(
    `UPDATE service_requests
     SET appointment_id = $2, assigned_contractor_id = $3, status = 'booked',
         arrival_acked_at = now(), dispatch_owner = 'ops'
     WHERE id = $1`,
    [s3.request.id, appt.rows[0].id, pro2Body.contractor.id],
  );
  const agentJwt = await mint('agent', '00000000-0000-4000-8000-0000000000ae');
  const agentConf = await app.request(`/v1/requests/${s3.request.id}/confirm-visit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': agentJwt,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (agentConf.status !== 403) {
    throw new Error(`agent on ops-owned expected 403 got ${agentConf.status}`);
  }

  // Fire reminders: force one due
  await pool.query(
    `UPDATE reminder_jobs SET fire_at = now() - interval '1 minute'
     WHERE service_request_id = $1 AND kind = 't_30m' AND status = 'scheduled'`,
    [requestId],
  );
  const fire = await app.request('/v1/system/fire-reminders', {
    method: 'POST',
    headers,
    body: '{}',
  });
  if (fire.status !== 200) throw new Error(`fire ${fire.status}`);
  const fireBody = await fire.json();
  if (fireBody.fired < 1) throw new Error('expected fired reminder');

  console.log('smoke:confirm OK', {
    requestId,
    chargeId: confBody.charge.id,
    amount_cents: confBody.charge.amount_cents,
    reminders: confBody.reminders.length,
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
