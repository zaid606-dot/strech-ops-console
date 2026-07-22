import { SignJWT } from 'jose';

import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

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

  const seed = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers,
    body: JSON.stringify({ category_id: 'hvac', membership_tier: 'Premium' }),
  });
  if (seed.status !== 201) {
    throw new Error(`seed ${seed.status} ${await seed.text()}`);
  }
  const seeded = await seed.json();
  if (seeded.request.status !== 'dispatching') throw new Error('not dispatching');
  if (!seeded.request.promise_by) throw new Error('missing promise_by');
  if (!seeded.request.confirmation_code) throw new Error('missing confirmation_code');

  const poolRes = await app.request('/v1/pool', { headers });
  if (poolRes.status !== 200) throw new Error(`pool ${poolRes.status}`);
  const poolBody = await poolRes.json();
  const found = (poolBody.items as { id: string }[]).some(
    (i) => i.id === seeded.request.id,
  );
  if (!found) throw new Error('seeded request not in pool');

  const events = await app.request(`/v1/requests/${seeded.request.id}/events`, {
    headers,
  });
  if (events.status !== 200) throw new Error(`events ${events.status}`);
  const evBody = await events.json();
  if (!evBody.items?.length) throw new Error('expected create job_event');

  const memberJwt = await mint('member', seeded.homeowner_id);
  const book = await app.request('/v1/requests', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': memberJwt,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      property_id: seeded.property_id,
      category_id: 'landscaping',
    }),
  });
  if (book.status !== 201) throw new Error(`member book ${book.status}`);
  const booked = await book.json();
  const memberView = await app.request(`/v1/requests/${booked.id}/member-view`, {
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': memberJwt,
    },
  });
  const mv = await memberView.json();
  if (mv.assigned_contractor_id) throw new Error('INV-2 leak');
  if (mv.status !== 'dispatching') throw new Error('member should see dispatching');
  if ('assigned_contractor_id' in booked) {
    throw new Error('INV-2 leak on create response');
  }

  const overview = await app.request('/v1/overview', { headers });
  if (overview.status !== 200) throw new Error(`overview ${overview.status}`);
  const counts = await overview.json();
  if (counts.dispatching < 2) throw new Error('overview dispatching count low');

  const agentJwt = await mint('agent', '00000000-0000-4000-8000-0000000000ae');
  const agentPool = await app.request('/v1/pool', {
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': agentJwt,
    },
  });
  if (agentPool.status !== 200) throw new Error(`agent pool ${agentPool.status}`);

  const agentSeed = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': agentJwt,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (agentSeed.status !== 403) throw new Error('agent must not seed');

  console.log('smoke:pool OK', {
    seedId: seeded.request.id,
    memberId: booked.id,
    dispatching: counts.dispatching,
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
