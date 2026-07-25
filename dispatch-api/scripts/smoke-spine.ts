import { SignJWT } from 'jose';

import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { transitionStatus } from '../src/status/transitions.js';

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

  const ready = await app.request('/api/ready');
  if (ready.status !== 200) throw new Error(`ready ${ready.status}`);

  const opsJwt = await mint('ops', '00000000-0000-4000-8000-0000000000aa');
  const health = await app.request('/v1/health', {
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': opsJwt,
    },
  });
  if (health.status !== 200) throw new Error(`health ${health.status}`);

  const client = await pool.connect();
  let requestId = '';
  let homeownerId = '';
  try {
    await client.query('BEGIN');
    const ho = await client.query(
      `INSERT INTO homeowners (full_name, membership_tier)
       VALUES ('Smoke Member', 'Comfort') RETURNING id`,
    );
    homeownerId = ho.rows[0].id as string;
    const prop = await client.query(
      `INSERT INTO properties (homeowner_id, address_line1, city, state, zip)
       VALUES ($1, '1 Test St', 'Austin', 'TX', '78701') RETURNING id`,
      [homeownerId],
    );
    const code = `SMK${Date.now().toString(36).toUpperCase()}`;
    const req = await client.query(
      `INSERT INTO service_requests
         (homeowner_id, property_id, category_id, status, confirmation_code, promise_by)
       VALUES ($1, $2, 'hvac', 'dispatching', $3, now() + interval '24 hours')
       RETURNING id`,
      [homeownerId, prop.rows[0].id, code],
    );
    requestId = req.rows[0].id as string;

    await transitionStatus(client, {
      serviceRequestId: requestId,
      to: 'booked',
      actorRole: 'ops',
      actorId: '00000000-0000-4000-8000-0000000000aa',
      note: 'spine smoke',
    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const ev = await pool.query(
    `SELECT from_status, to_status, actor_role FROM job_events
     WHERE service_request_id = $1 ORDER BY created_at ASC, id ASC`,
    [requestId],
  );
  if (!ev.rowCount) throw new Error('expected job_event');

  const memberJwt = await mint('member', homeownerId);
  const memberView = await app.request(`/v1/requests/${requestId}/member-view`, {
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': memberJwt,
    },
  });
  if (memberView.status !== 200) throw new Error(`member-view ${memberView.status}`);
  const body = await memberView.json();
  if (body.assigned_contractor_id || body.contractor_id) {
    throw new Error('INV-2 leak in member-view');
  }

  const otherMember = await mint('member', '00000000-0000-4000-8000-0000000000ff');
  const idor = await app.request(`/v1/requests/${requestId}/member-view`, {
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': otherMember,
    },
  });
  if (idor.status !== 403) throw new Error('member-view should 403 for non-owner');

  const agentJwt = await mint('agent', '00000000-0000-4000-8000-0000000000ae');
  const agentDenied = await app.request(`/v1/requests/${requestId}/member-view`, {
    headers: {
      Authorization: `Bearer ${EDGE}`,
      'X-Strech-Actor': agentJwt,
    },
  });
  if (agentDenied.status !== 403) throw new Error('agent fence should 403 member-view');

  const denied = await app.request('/v1/health', {
    headers: { Authorization: `Bearer wrong` },
  });
  if (denied.status !== 401) throw new Error('edge auth should 401');

  console.log('smoke:spine OK', { requestId, events: ev.rowCount });
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
