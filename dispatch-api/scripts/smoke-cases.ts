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

async function seedConfirmed(app: ReturnType<typeof buildApp>, ops: Record<string, string>) {
  const pro = await app.request('/v1/ops/seed-contractor', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({
      category_id: 'hvac',
      zip: '78701',
      full_name: `Case Pro ${Date.now()}`,
    }),
  });
  const proBody = await pro.json();
  const seed = await app.request('/v1/ops/seed-request', {
    method: 'POST',
    headers: ops,
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
  const req = await (await app.request(`/v1/requests/${requestId}`, { headers: ops })).json();
  return {
    requestId,
    contractorId: offer.contractor_id as string,
    propertyId: req.property_id as string,
    homeownerId: req.homeowner_id as string,
  };
}

async function toCheckedIn(
  app: ReturnType<typeof buildApp>,
  ops: Record<string, string>,
  requestId: string,
  contractorId: string,
) {
  const contractor = hdr(await mint('contractor', contractorId));
  await app.request(`/v1/requests/${requestId}/check-in`, {
    method: 'POST',
    headers: contractor,
    body: '{}',
  });
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

  // No-show path
  const j1 = await seedConfirmed(app, ops);
  const ns = await app.request(`/v1/requests/${j1.requestId}/no-show`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ party: 'contractor' }),
  });
  if (ns.status !== 200) throw new Error(`no-show ${ns.status} ${await ns.text()}`);
  const nsBody = await ns.json();
  if (nsBody.status !== 'no_show') throw new Error('status not no_show');
  if (nsBody.case?.type !== 'no_show') throw new Error('missing no_show case');

  const { rows: rem } = await pool.query(
    `SELECT status FROM reminder_jobs WHERE service_request_id = $1 AND status = 'scheduled'`,
    [j1.requestId],
  );
  if (rem.length) throw new Error('reminders should be cancelled on no-show');

  const rd = await app.request(`/v1/requests/${j1.requestId}/redispatch`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ note: 'try again' }),
  });
  if (rd.status !== 200) throw new Error(`redispatch ${rd.status}`);
  if ((await rd.json()).status !== 'dispatching') throw new Error('redispatch not dispatching');

  // Cancel after confirm voids charge
  const j2 = await seedConfirmed(app, ops);
  const cancel = await app.request(`/v1/requests/${j2.requestId}/cancel`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ reason: 'member moved' }),
  });
  if (cancel.status !== 200) throw new Error(`cancel ${cancel.status}`);
  const { rows: charges } = await pool.query(
    `SELECT status FROM charges WHERE service_request_id = $1`,
    [j2.requestId],
  );
  if (charges[0]?.status !== 'voided') throw new Error('pending charge should void on cancel');

  // Reject cancel after complete
  const j3 = await seedConfirmed(app, ops);
  await toCheckedIn(app, ops, j3.requestId, j3.contractorId);
  await app.request(`/v1/requests/${j3.requestId}/complete`, {
    method: 'POST',
    headers: hdr(await mint('contractor', j3.contractorId)),
    body: JSON.stringify({ summary: 'done' }),
  });
  const badCancel = await app.request(`/v1/requests/${j3.requestId}/cancel`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ reason: 'too late' }),
  });
  if (badCancel.status !== 409) throw new Error(`cancel after complete expected 409`);

  // Parts hold + child
  const j4 = await seedConfirmed(app, ops);
  await toCheckedIn(app, ops, j4.requestId, j4.contractorId);
  const ph = await app.request(`/v1/requests/${j4.requestId}/parts-hold`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ deferred_items: ['capacitor'] }),
  });
  if (ph.status !== 201) throw new Error(`parts-hold ${ph.status} ${await ph.text()}`);
  const phBody = await ph.json();
  if (phBody.status !== 'checked_in') throw new Error('parent must stay checked_in');
  if (!phBody.child_request_id) throw new Error('missing child');
  const { rows: child } = await pool.query(
    `SELECT parent_request_id, status FROM service_requests WHERE id = $1`,
    [phBody.child_request_id],
  );
  if (child[0].parent_request_id !== j4.requestId) throw new Error('parent_request_id mismatch');
  if (child[0].status !== 'dispatching') throw new Error('child not in pool');

  // Scope change + agent cannot approve
  const j5 = await seedConfirmed(app, ops);
  const sc = await app.request(`/v1/requests/${j5.requestId}/scope-change`, {
    method: 'POST',
    headers: agent,
    body: JSON.stringify({ description: 'extra zone', proposed_amount_cents: 19900 }),
  });
  if (sc.status !== 201) throw new Error(`scope ${sc.status}`);
  const scBody = await sc.json();
  const agentApprove = await app.request(`/v1/cases/${scBody.case.id}/approve-scope`, {
    method: 'POST',
    headers: agent,
    body: JSON.stringify({ amount_cents: 19900 }),
  });
  if (agentApprove.status !== 403) throw new Error('agent approve-scope must 403');

  const opsApprove = await app.request(`/v1/cases/${scBody.case.id}/approve-scope`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ amount_cents: 19900 }),
  });
  if (opsApprove.status !== 200) throw new Error(`ops approve ${opsApprove.status}`);
  const { rows: amended } = await pool.query(
    `SELECT amount_cents FROM charges WHERE service_request_id = $1 AND status = 'pending'`,
    [j5.requestId],
  );
  if (amended[0]?.amount_cents !== 19900) throw new Error('charge not amended');

  // Emergency ingress + agent queue bypass + agent cannot resolve
  const j6 = await seedConfirmed(app, ops);
  const em = await app.request('/v1/emergency', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({
      service_request_id: j6.requestId,
      signal_type: 'hhs_fall',
      payload: { medical: 'redacted-in-agent' },
    }),
  });
  if (em.status !== 201) throw new Error(`emergency ${em.status}`);
  const emBody = await em.json();
  if (emBody.case?.type !== 'emergency' || !emBody.case.blocks_close) {
    throw new Error('emergency case flags');
  }

  const work = await app.request('/v1/agent/work', { headers: agent });
  const workBody = await work.json();
  if (
    (workBody.items as { service_request_id: string }[]).some(
      (i) => i.service_request_id === j6.requestId,
    )
  ) {
    throw new Error('emergency job must leave agent work queue');
  }

  const agentResolve = await app.request(`/v1/cases/${emBody.case.id}/resolve`, {
    method: 'POST',
    headers: agent,
    body: JSON.stringify({ resolution: 'resolved' }),
  });
  if (agentResolve.status !== 403) throw new Error('agent resolve emergency must 403');

  const agentEm = await app.request('/v1/emergency', {
    method: 'POST',
    headers: agent,
    body: JSON.stringify({ service_request_id: j6.requestId, signal_type: 'x' }),
  });
  if (agentEm.status !== 403) throw new Error('agent POST /emergency must 403');

  const cases = await app.request('/v1/cases?status=open', { headers: ops });
  const casesBody = await cases.json();
  const first = casesBody.items[0];
  if (first?.type !== 'emergency') throw new Error('emergencies should sort first');

  const agentCases = await app.request('/v1/cases?status=open', { headers: agent });
  const ac = await agentCases.json();
  const emAgentView = (ac.items as { type: string; meta: Record<string, unknown> }[]).find(
    (c) => c.type === 'emergency',
  );
  if (emAgentView?.meta && 'payload' in emAgentView.meta) {
    throw new Error('agent must not see emergency payload');
  }

  // late / cant_find
  const j7 = await seedConfirmed(app, ops);
  const late = await app.request(`/v1/requests/${j7.requestId}/flag`, {
    method: 'POST',
    headers: ops,
    body: JSON.stringify({ kind: 'cant_find' }),
  });
  if (late.status !== 201) throw new Error(`flag ${late.status}`);

  console.log('smoke:cases OK', {
    noShow: j1.requestId,
    partsChild: phBody.child_request_id,
    emergency: emBody.case.id,
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
