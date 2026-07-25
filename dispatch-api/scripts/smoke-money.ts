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

async function seedToNeedsReview(
  app: ReturnType<typeof buildApp>,
  ops: Record<string, string>,
  tier = 'Free',
) {
  const pro = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({
      category_id: 'hvac',
      zip: '78701',
      full_name: `Money Pro ${Date.now()}`,
    }),
  });
  const proBody = await pro.json();
  const seed = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ category_id: 'hvac', zip: '78701', membership_tier: tier }),
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
  const offer = (await wave.json()).offers[0];
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
  const contractor = hdr(await mint('contractor', offer.contractor_id));
  await app.request(`/v1/requests/${requestId}/check-in`, {
    method: 'POST',
    headers: contractor,
    body: '{}',
  });
  const complete = await app.request(`/v1/requests/${requestId}/complete`, {
    method: 'POST',
    headers: contractor,
    body: JSON.stringify({ summary: 'All set' }),
  });
  if (complete.status !== 200) {
    throw new Error(`complete ${complete.status} ${await complete.text()}`);
  }
  const done = await complete.json();
  const req = await (await app.request(`/v1/requests/${requestId}`, { headers: ops })).json();
  return {
    requestId,
    contractorId: offer.contractor_id as string,
    homeownerId: req.homeowner_id as string,
    complete: done,
  };
}

async function main() {
  process.env.EDGE_BEARER_TOKEN = EDGE;
  process.env.ACTOR_JWT_SECRET = SECRET;
  await migrate();
  const app = buildApp();
  const ops = hdr(await mint('ops', '00000000-0000-4000-8000-0000000000aa'));
  const agent = hdr(await mint('agent', '00000000-0000-4000-8000-0000000000ae'));

  // Happy path Free: capture on complete + payout held
  const j1 = await seedToNeedsReview(app, ops, 'Free');
  if (j1.complete.status !== 'needs_review') throw new Error('expected needs_review');
  if (j1.complete.money?.payout?.status !== 'held') throw new Error('payout should be held');
  if (j1.complete.money?.capture?.charge?.status !== 'captured') {
    throw new Error('Free charge should capture on complete');
  }

  const money = await app.request(`/v1/requests/${j1.requestId}/money`, { headers: ops });
  const snap = await money.json();
  if (snap.charge?.status !== 'captured') throw new Error('snapshot charge');
  if (snap.payout?.status !== 'held') throw new Error('snapshot payout');
  if (!snap.payment_attempts?.length) throw new Error('missing payment_attempt');

  // ack + review
  const member = hdr(await mint('member', j1.homeownerId));
  const ack = await app.request(`/v1/requests/${j1.requestId}/ack-completion`, {
    method: 'POST',
    headers: member,
    body: '{}',
  });
  if (ack.status !== 200) throw new Error(`ack ${ack.status}`);

  const review = await app.request(`/v1/requests/${j1.requestId}/review`, {
    method: 'POST',
    headers: member,
    body: JSON.stringify({ rating: 5, comment: 'Great' }),
  });
  if (review.status !== 200) throw new Error(`review ${review.status}`);
  if ((await review.json()).status !== 'reviewed') throw new Error('not reviewed');

  // Close → payout payable
  const close = await app.request(`/v1/requests/${j1.requestId}/close`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ note: 'all good' }),
  });
  if (close.status !== 200) throw new Error(`close ${close.status} ${await close.text()}`);
  const closed = await close.json();
  if (closed.status !== 'closed') throw new Error('not closed');
  if (closed.payout?.status !== 'payable') throw new Error('payout should be payable');

  // Comfort $0 — auto captured, still closable
  const j0 = await seedToNeedsReview(app, ops, 'Comfort');
  if (j0.complete.money?.charge?.amount_cents !== 0) throw new Error('comfort should be $0');
  await app.request(`/v1/requests/${j0.requestId}/review`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ rating: 4 }),
  });
  const close0 = await app.request(`/v1/requests/${j0.requestId}/close`, {
    method: 'POST',
    headers: ops,
    body: '{}',
  });
  if (close0.status !== 200) throw new Error(`close $0 ${close0.status}`);

  // Capture failure blocks close
  const j2 = await seedToNeedsReview(app, ops, 'Free');
  // Force a failed re-path: set charge back to pending and fail capture
  await pool.query(
    `UPDATE charges SET status = 'pending' WHERE service_request_id = $1`,
    [j2.requestId],
  );
  // Delete blocking from prior success attempt uniqueness — update existing
  const fail = await app.request(`/v1/requests/${j2.requestId}/capture`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ force_fail: true }),
  });
  if (fail.status !== 200) throw new Error(`force fail ${fail.status}`);
  await app.request(`/v1/requests/${j2.requestId}/review`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ rating: 3 }),
  });
  const blocked = await app.request(`/v1/requests/${j2.requestId}/close`, {
    method: 'POST',
    headers: ops,
    body: '{}',
  });
  if (blocked.status !== 409) throw new Error(`close should block on failed charge`);
  const blockedBody = await blocked.json();
  if (blockedBody.code !== 'CHARGE_NOT_TERMINAL' && blockedBody.code !== 'BLOCKS_CLOSE') {
    throw new Error(`unexpected block code ${blockedBody.code}`);
  }

  // Dispute holds close
  const j3 = await seedToNeedsReview(app, ops, 'Free');
  const dispute = await app.request(`/v1/requests/${j3.requestId}/dispute`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ reason: 'not fixed' }),
  });
  if (dispute.status !== 200) throw new Error(`dispute ${dispute.status}`);
  if ((await dispute.json()).status !== 'disputed') throw new Error('not disputed');
  const { rows: payoutHold } = await pool.query(
    `SELECT status FROM payouts WHERE service_request_id = $1`,
    [j3.requestId],
  );
  if (payoutHold[0]?.status !== 'held') throw new Error('payout must stay held on dispute');

  // Refund row (money ≠ status) on a closed captured job — use j1
  const refund = await app.request(`/v1/requests/${j1.requestId}/refund`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ amount_cents: 1000, reason: 'goodwill' }),
  });
  if (refund.status !== 201) throw new Error(`refund ${refund.status} ${await refund.text()}`);
  const { rows: ch } = await pool.query(
    `SELECT status FROM charges WHERE service_request_id = $1`,
    [j1.requestId],
  );
  if (ch[0]?.status !== 'captured') throw new Error('charge stays captured after refund');

  // Agent cannot capture / refund / money read
  const agentCap = await app.request(`/v1/requests/${j0.requestId}/capture`, {
    method: 'POST',
    headers: agent,
    body: '{}',
  });
  if (agentCap.status !== 403) throw new Error('agent capture must 403');
  const agentMoney = await app.request(`/v1/requests/${j0.requestId}/money`, {
    headers: agent,
  });
  if (agentMoney.status !== 403) throw new Error('agent money must 403');

  console.log('smoke:money OK', {
    closed: j1.requestId,
    comfort: j0.requestId,
    blocked: j2.requestId,
    disputed: j3.requestId,
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
