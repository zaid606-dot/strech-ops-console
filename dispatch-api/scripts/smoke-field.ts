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

function hdr(jwt: string) {
  return {
    Authorization: `Bearer ${EDGE}`,
    'X-Strech-Actor': jwt,
    'Content-Type': 'application/json',
  };
}

async function seedConfirmed(app: ReturnType<typeof buildApp>, ops: Record<string, string>) {
  const pro = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', full_name: `Field Pro ${Date.now()}` }),
  });
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
     SET preferred_window_start = $2, preferred_window_end = $3
     WHERE id = $1`,
    [requestId, proBody.slot.slot_start, proBody.slot.slot_end],
  );
  const wave = await app.request(`/v1/requests/${requestId}/offer-wave`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ strategy: 'sequential' }),
  });
  const waveBody = await wave.json();
  const offer = waveBody.offers[0];
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
  await app.request(`/v1/requests/${requestId}/confirm-visit`, {
    method: 'POST',
    headers: ops,
    body: '{}',
  });
  const req = await app.request(`/v1/requests/${requestId}`, { headers: ops });
  const reqBody = await req.json();
  return {
    requestId,
    contractorId: offer.contractor_id as string,
    confirmationCode: reqBody.confirmation_code as string,
    homeownerId: reqBody.homeowner_id as string,
  };
}

async function main() {
  process.env.EDGE_BEARER_TOKEN = EDGE;
  process.env.ACTOR_JWT_SECRET = SECRET;
  await migrate();
  const app = buildApp();
  const opsJwt = await mint('ops', '00000000-0000-4000-8000-0000000000aa');
  const ops = hdr(opsJwt);

  const job = await seedConfirmed(app, ops);
  const contractor = hdr(await mint('contractor', job.contractorId));

  const jobs = await app.request('/v1/contractors/me/jobs', { headers: contractor });
  if (jobs.status !== 200) throw new Error(`jobs ${jobs.status}`);
  const jobsBody = await jobs.json();
  if (!(jobsBody.items as { request: { id: string } }[]).some((j) => j.request.id === job.requestId)) {
    throw new Error('confirmed job missing from contractor list');
  }

  const earlyComplete = await app.request(`/v1/requests/${job.requestId}/complete`, {
    method: 'POST',
    headers: contractor,
    body: JSON.stringify({ summary: 'too early' }),
  });
  if (earlyComplete.status !== 409) {
    throw new Error(`complete from confirmed expected 409 got ${earlyComplete.status}`);
  }

  const enRoute = await app.request(`/v1/requests/${job.requestId}/en-route`, {
    method: 'POST',
    headers: contractor,
    body: JSON.stringify({ note: 'en_route' }),
  });
  if (enRoute.status !== 200) throw new Error(`en-route ${enRoute.status}`);
  const er = await enRoute.json();
  if (er.status !== 'confirmed') throw new Error('en-route must stay confirmed');

  const checkIn = await app.request(`/v1/requests/${job.requestId}/check-in`, {
    method: 'POST',
    headers: contractor,
    body: JSON.stringify({ note: 'check_in' }),
  });
  if (checkIn.status !== 200) throw new Error(`check-in ${checkIn.status} ${await checkIn.text()}`);
  const ci = await checkIn.json();
  if (ci.status !== 'checked_in') throw new Error(`status ${ci.status}`);

  const complete = await app.request(`/v1/requests/${job.requestId}/complete`, {
    method: 'POST',
    headers: contractor,
    body: JSON.stringify({ summary: 'HVAC filter replaced' }),
  });
  if (complete.status !== 200) throw new Error(`complete ${complete.status}`);
  const done = await complete.json();
  if (done.status !== 'needs_review') throw new Error(`expected needs_review got ${done.status}`);

  const { rows: events } = await pool.query(
    `SELECT from_status, to_status, actor_role, note FROM job_events
     WHERE service_request_id = $1 ORDER BY created_at ASC, id ASC`,
    [job.requestId],
  );
  const hasCompleted = events.some((e) => e.to_status === 'completed' && e.actor_role === 'contractor');
  const hasReview = events.some(
    (e) => e.to_status === 'needs_review' && e.actor_role === 'system',
  );
  const hasEnRoute = events.some(
    (e) => typeof e.note === 'string' && /en_route/i.test(e.note),
  );
  if (!hasCompleted || !hasReview || !hasEnRoute) {
    throw new Error('timeline missing field events');
  }

  const progress = await app.request(`/v1/requests/${job.requestId}/member-progress`, {
    headers: hdr(await mint('member', job.homeownerId)),
  });
  if (progress.status !== 200) throw new Error(`progress ${progress.status}`);
  const prog = await progress.json();
  assertNoContractorLeak(prog);
  if (!prog.steps?.every((s: { done: boolean }) => s.done)) {
    throw new Error(`progress incomplete ${JSON.stringify(prog.steps)}`);
  }

  // SMS stub path on a fresh confirmed job
  const job2 = await seedConfirmed(app, ops);
  const smsOtW = await app.request('/v1/field/sms-inbound', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ body: `OTW ${job2.confirmationCode}`, from: '+15555550199' }),
  });
  if (smsOtW.status !== 200) throw new Error(`sms otw ${smsOtW.status} ${await smsOtW.text()}`);
  const smsArrived = await app.request('/v1/field/sms-inbound', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ body: `ARRIVED ${job2.confirmationCode}` }),
  });
  if (smsArrived.status !== 200) throw new Error(`sms arrived ${smsArrived.status}`);
  const smsDone = await app.request('/v1/field/sms-inbound', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ body: `DONE ${job2.confirmationCode}` }),
  });
  if (smsDone.status !== 200) throw new Error(`sms done ${smsDone.status}`);
  const smsBody = await smsDone.json();
  if (smsBody.status !== 'needs_review') throw new Error('sms done should needs_review');

  const garbage = await app.request('/v1/field/sms-inbound', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ body: 'maybe arrived sometime?' }),
  });
  if (garbage.status !== 422) throw new Error(`garbage expected 422 got ${garbage.status}`);
  const g = await garbage.json();
  if (!g.escalate) throw new Error('garbage must escalate');

  // IDOR: other contractor cannot check-in
  const other = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', full_name: 'Other Pro' }),
  });
  const otherBody = await other.json();
  const job3 = await seedConfirmed(app, ops);
  const idor = await app.request(`/v1/requests/${job3.requestId}/check-in`, {
    method: 'POST',
    headers: hdr(await mint('contractor', otherBody.contractor.id)),
    body: '{}',
  });
  if (idor.status !== 403) throw new Error(`idor expected 403 got ${idor.status}`);

  console.log('smoke:field OK', {
    requestId: job.requestId,
    smsRequestId: job2.requestId,
    final: done.status,
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
