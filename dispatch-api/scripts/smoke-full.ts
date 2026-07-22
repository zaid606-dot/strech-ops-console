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

function hdr(jwt: string, idem?: string) {
  const h: Record<string, string> = {
    Authorization: `Bearer ${EDGE}`,
    'X-Strech-Actor': jwt,
    'Content-Type': 'application/json',
  };
  if (idem) h['Idempotency-Key'] = idem;
  return h;
}

async function main() {
  process.env.EDGE_BEARER_TOKEN = EDGE;
  process.env.ACTOR_JWT_SECRET = SECRET;
  await migrate();
  const app = buildApp();
  const opsJwt = await mint('ops', '00000000-0000-4000-8000-0000000000aa');
  const ops = hdr(opsJwt);

  // --- Happy path: seed → wave → accept → ack → confirm → field → review → close ---
  const pro = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers: hdr(opsJwt, `full-pro-${Date.now()}`),
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', full_name: 'Full Loop Pro' }),
  });
  if (pro.status !== 201) throw new Error(`seed pro ${pro.status}`);
  const proBody = await pro.json();

  const seed = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers: hdr(opsJwt, `full-seed-${Date.now()}`),
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', membership_tier: 'Free' }),
  });
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
    headers: hdr(opsJwt, `full-wave-${requestId}`),
    body: JSON.stringify({ strategy: 'sequential' }),
  });
  if (wave.status !== 201) throw new Error(`wave ${wave.status}`);
  const offer = (await wave.json()).offers[0];

  // Idempotent accept replay
  const acceptKey = `full-accept-${offer.id}`;
  const accept1 = await app.request(`/v1/offers/${offer.id}/accept`, {
    method: 'POST',
    headers: hdr(opsJwt, acceptKey),
    body: JSON.stringify({ contractor_id: offer.contractor_id }),
  });
  if (accept1.status !== 200) throw new Error(`accept ${accept1.status}`);
  const acceptBody1 = await accept1.json();
  const accept2 = await app.request(`/v1/offers/${offer.id}/accept`, {
    method: 'POST',
    headers: hdr(opsJwt, acceptKey),
    body: JSON.stringify({ contractor_id: offer.contractor_id }),
  });
  if (accept2.status !== 200) throw new Error(`accept replay ${accept2.status}`);
  if (accept2.headers.get('Idempotent-Replay') !== 'true') {
    throw new Error('expected Idempotent-Replay header');
  }
  const acceptBody2 = await accept2.json();
  if (acceptBody2.appointment_id !== acceptBody1.appointment_id) {
    throw new Error('idempotent accept body mismatch');
  }

  await app.request(`/v1/requests/${requestId}/ack-arrival`, {
    method: 'POST',
    headers: ops,
    body: '{}',
  });
  await app.request(`/v1/requests/${requestId}/confirm-visit`, {
    method: 'POST',
    headers: ops,
    body: '{}',
  });

  const contractor = hdr(await mint('contractor', offer.contractor_id));
  await app.request(`/v1/requests/${requestId}/en-route`, {
    method: 'POST',
    headers: contractor,
    body: JSON.stringify({ note: 'en_route' }),
  });
  await app.request(`/v1/requests/${requestId}/check-in`, {
    method: 'POST',
    headers: contractor,
    body: '{}',
  });
  const complete = await app.request(`/v1/requests/${requestId}/complete`, {
    method: 'POST',
    headers: contractor,
    body: JSON.stringify({ summary: 'Full loop complete' }),
  });
  if (complete.status !== 200) throw new Error(`complete ${complete.status}`);

  const req = await (await app.request(`/v1/requests/${requestId}`, { headers: ops })).json();
  const member = hdr(await mint('member', req.homeowner_id));
  const mv = await app.request(`/v1/requests/${requestId}/member-view`, { headers: member });
  const memberView = await mv.json();
  assertNoContractorLeak(memberView);

  await app.request(`/v1/requests/${requestId}/review`, {
    method: 'POST',
    headers: member,
    body: JSON.stringify({ rating: 5, comment: 'full loop' }),
  });
  const close = await app.request(`/v1/requests/${requestId}/close`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ note: 'closed full loop' }),
  });
  if (close.status !== 200) throw new Error(`close ${close.status} ${await close.text()}`);
  if ((await close.json()).status !== 'closed') throw new Error('not closed');

  // Audit export
  const audit = await app.request(
    `/v1/ops/audit/events?service_request_id=${requestId}&limit=100`,
    { headers: ops },
  );
  if (audit.status !== 200) throw new Error(`audit ${audit.status}`);
  const auditBody = await audit.json();
  if ((auditBody.items as unknown[]).length < 5) throw new Error('audit too short');

  // --- Messy: emergency bypass ---
  const pro2 = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', full_name: 'Messy Pro' }),
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
     SET preferred_window_start = $2, preferred_window_end = $3
     WHERE id = $1`,
    [s2.request.id, proBody.slot.slot_start, proBody.slot.slot_end],
  );
  const wave2 = await app.request(`/v1/requests/${s2.request.id}/offer-wave`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ strategy: 'sequential' }),
  });
  const o2 = (await wave2.json()).offers[0];
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
  await app.request(`/v1/requests/${s2.request.id}/confirm-visit`, {
    method: 'POST',
    headers: ops,
    body: '{}',
  });
  const em = await app.request('/v1/emergency', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({
      service_request_id: s2.request.id,
      signal_type: 'full_smoke_emergency',
      payload: { medical: 'hidden' },
    }),
  });
  if (em.status !== 201) throw new Error(`emergency ${em.status}`);

  // --- CONTRACTOR_UNFIT on accept ---
  const pro3 = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', full_name: 'Unfit Pro' }),
  });
  const pro3Body = await pro3.json();
  await pool.query(
    `UPDATE availability_slots SET slot_start = $2, slot_end = $3 WHERE contractor_id = $1`,
    [pro3Body.contractor.id, proBody.slot.slot_start, proBody.slot.slot_end],
  );
  const seed3 = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701' }),
  });
  const s3 = await seed3.json();
  await pool.query(
    `UPDATE service_requests
     SET preferred_window_start = $2, preferred_window_end = $3
     WHERE id = $1`,
    [s3.request.id, proBody.slot.slot_start, proBody.slot.slot_end],
  );
  const wave3 = await app.request(`/v1/requests/${s3.request.id}/offer-wave`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ strategy: 'sequential' }),
  });
  const o3 = (await wave3.json()).offers[0];
  // Suspend contractor after offer (fitness fails at accept)
  await pool.query(
    `UPDATE contractors SET vetting_status = 'suspended', suspended_at = now() WHERE id = $1`,
    [o3.contractor_id],
  );
  const unfit = await app.request(`/v1/offers/${o3.id}/accept`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ contractor_id: o3.contractor_id }),
  });
  if (unfit.status !== 409) throw new Error(`unfit expected 409 got ${unfit.status}`);
  const unfitBody = await unfit.json();
  if (unfitBody.code !== 'CONTRACTOR_UNFIT') {
    throw new Error(`expected CONTRACTOR_UNFIT got ${unfitBody.code}`);
  }
  const { rows: offerRows } = await pool.query(
    `SELECT status FROM dispatch_offers WHERE id = $1`,
    [o3.id],
  );
  if (offerRows[0]?.status !== 'withdrawn') {
    throw new Error(`unfit must withdraw offer, got ${offerRows[0]?.status}`);
  }

  console.log('smoke:full OK', {
    closed: requestId,
    emergency: s2.request.id,
    unfitOffer: o3.id,
    auditEvents: auditBody.count,
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
