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

function hdr(jwt: string) {
  return {
    Authorization: `Bearer ${EDGE}`,
    'X-Strech-Actor': jwt,
    'Content-Type': 'application/json',
  };
}

async function main() {
  process.env.EDGE_BEARER_TOKEN = EDGE;
  process.env.ACTOR_JWT_SECRET = SECRET;
  await migrate();
  const app = buildApp();
  const opsJwt = await mint('ops', '00000000-0000-4000-8000-0000000000aa');
  const agentJwt = await mint('agent', '00000000-0000-4000-8000-0000000000ae');
  const ops = hdr(opsJwt);
  const agent = hdr(agentJwt);

  // Agent cannot write policy
  const deny = await app.request('/v1/agent/policy', {
    method: 'PATCH',
    headers: agent,
    body: JSON.stringify({ confirm: { auto_confirm_visit: false } }),
  });
  if (deny.status !== 403) throw new Error(`agent policy write expected 403 got ${deny.status}`);

  // Ops can toggle policy on
  const pol = await app.request('/v1/agent/policy', {
    method: 'PATCH',
    headers: ops,
    body: JSON.stringify({
      confirm: { auto_confirm_visit: true },
      offer: { strategy: 'sequential', batch_size: 1, ttl_seconds: 600 },
    }),
  });
  if (pol.status !== 200) throw new Error(`policy patch ${pol.status}`);
  const polBody = await pol.json();
  if (!polBody.settings.confirm.auto_confirm_visit) throw new Error('auto_confirm not set');

  const pro = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', full_name: 'Agent Pro' }),
  });
  if (pro.status !== 201) throw new Error(`seed pro ${pro.status}`);
  const proBody = await pro.json();

  const seed = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', membership_tier: 'Comfort' }),
  });
  const seeded = await seed.json();
  const requestId = seeded.request.id as string;
  await pool.query(
    `UPDATE service_requests
     SET preferred_window_start = $2, preferred_window_end = $3, dispatch_owner = 'agent'
     WHERE id = $1`,
    [requestId, proBody.slot.slot_start, proBody.slot.slot_end],
  );

  const work = await app.request('/v1/agent/work', { headers: agent });
  if (work.status !== 200) throw new Error(`work ${work.status}`);
  const workBody = await work.json();
  const hit = (workBody.items as { service_request_id: string; reason: string }[]).find(
    (i) => i.service_request_id === requestId,
  );
  if (!hit || hit.reason !== 'needs_offer_wave') {
    throw new Error(`expected needs_offer_wave got ${JSON.stringify(hit)}`);
  }

  // Tick creates offer wave as agent
  const tick1 = await app.request('/v1/agent/tick', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ limit: 50 }),
  });
  if (tick1.status !== 200) throw new Error(`tick1 ${tick1.status} ${await tick1.text()}`);
  const t1 = await tick1.json();
  const waveAct = (t1.actions as { service_request_id: string; action: string }[]).find(
    (a) => a.service_request_id === requestId && a.action === 'offer_wave',
  );
  if (!waveAct) throw new Error(`expected offer_wave action ${JSON.stringify(t1.actions)}`);

  const { rows: events } = await pool.query(
    `SELECT actor_role, note FROM job_events
     WHERE service_request_id = $1 AND note LIKE 'offer wave%'
     ORDER BY created_at DESC LIMIT 1`,
    [requestId],
  );
  if (events[0]?.actor_role !== 'agent') throw new Error('wave event must be actor=agent');

  const offers = await app.request(`/v1/offers?service_request_id=${requestId}&status=pending`, {
    headers: ops,
  });
  const offerBody = await offers.json();
  const offer = offerBody.items[0];
  if (!offer) throw new Error('no pending offer after tick');

  await app.request(`/v1/offers/${offer.id}/accept`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ contractor_id: offer.contractor_id }),
  });
  await app.request(`/v1/requests/${requestId}/ack-arrival`, {
    method: 'POST',
    headers: ops,
    body: '{}',
  });

  // auto_confirm on → tick confirms
  const tick2 = await app.request('/v1/agent/tick', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ limit: 50 }),
  });
  const t2 = await tick2.json();
  const confAct = (t2.actions as { service_request_id: string; action: string }[]).find(
    (a) => a.service_request_id === requestId && a.action === 'confirm_visit',
  );
  if (!confAct) throw new Error(`expected confirm_visit ${JSON.stringify(t2.actions)}`);

  const req = await app.request(`/v1/requests/${requestId}`, { headers: ops });
  const reqBody = await req.json();
  if (reqBody.status !== 'confirmed') throw new Error(`status ${reqBody.status}`);

  // auto_confirm off → escalate ready_to_confirm
  await app.request('/v1/agent/policy', {
    method: 'PATCH',
    headers: ops,
    body: JSON.stringify({ confirm: { auto_confirm_visit: false } }),
  });

  const pro2 = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', full_name: 'Agent Pro 2' }),
  });
  const pro2Body = await pro2.json();
  await pool.query(
    `UPDATE availability_slots SET slot_start = $2, slot_end = $3 WHERE contractor_id = $1`,
    [pro2Body.contractor.id, proBody.slot.slot_start, proBody.slot.slot_end],
  );
  const seed2 = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701' }),
  });
  const s2 = await seed2.json();
  await pool.query(
    `UPDATE service_requests
     SET preferred_window_start = $2, preferred_window_end = $3, dispatch_owner = 'agent'
     WHERE id = $1`,
    [s2.request.id, proBody.slot.slot_start, proBody.slot.slot_end],
  );
  await app.request('/v1/agent/tick', { method: 'POST', headers: ops, body: '{}' });
  const offers2 = await app.request(`/v1/offers?service_request_id=${s2.request.id}`, {
    headers: ops,
  });
  const o2 = (await offers2.json()).items[0];
  await app.request(`/v1/offers/${o2.id}/accept`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ contractor_id: o2.contractor_id }),
  });
  await app.request(`/v1/requests/${s2.request.id}/ack-arrival`, {
    method: 'POST',
    headers: ops,
    body: '{}',
  });

  const tick3 = await app.request('/v1/agent/tick', {
    method: 'POST',
    headers: ops,
    body: '{}',
  });
  const t3 = await tick3.json();
  const esc = (t3.actions as { service_request_id: string; action: string }[]).find(
    (a) => a.service_request_id === s2.request.id && a.action === 'escalate_confirm',
  );
  if (!esc) throw new Error(`expected escalate_confirm ${JSON.stringify(t3.actions)}`);

  const { rows: owner } = await pool.query(
    `SELECT status, dispatch_owner FROM service_requests WHERE id = $1`,
    [s2.request.id],
  );
  if (owner[0].status !== 'booked') throw new Error('should stay booked when auto_confirm off');
  if (owner[0].dispatch_owner !== 'ops') throw new Error('should escalate to ops owner');

  // Agent cannot read charges
  const money = await app.request(`/v1/requests/${requestId}/charges`, { headers: agent });
  if (money.status !== 403) throw new Error(`agent charges expected 403 got ${money.status}`);

  // Reset policy for other smokes
  await app.request('/v1/agent/policy', {
    method: 'PATCH',
    headers: ops,
    body: JSON.stringify({ confirm: { auto_confirm_visit: true } }),
  });

  console.log('smoke:agent OK', {
    requestId,
    confirmed: reqBody.status,
    escalated: s2.request.id,
    tick_actions: t1.actions.length,
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
