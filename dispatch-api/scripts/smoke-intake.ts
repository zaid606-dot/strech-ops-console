/**
 * Smoke: real ops booking intake + contractor directory (not seed demos).
 */
import { SignJWT } from 'jose';

import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

const EDGE = process.env.EDGE_BEARER_TOKEN ?? 'replace-me-edge-secret';
const SECRET = new TextEncoder().encode(
  process.env.ACTOR_JWT_SECRET ?? 'replace-me-hs256-secret',
);
const OPS_SUB = '00000000-0000-4000-8000-0000000000aa';

async function jwt(role: string, sub: string) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET);
}

function hdr(token: string, idem?: string) {
  const h: Record<string, string> = {
    Authorization: `Bearer ${EDGE}`,
    'X-Strech-Actor': token,
    'Content-Type': 'application/json',
  };
  if (idem) h['Idempotency-Key'] = idem;
  return h;
}

async function main() {
  const app = buildApp();
  const ops = await jwt('ops', OPS_SUB);

  const start = new Date();
  start.setDate(start.getDate() + 3);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(12, 0, 0, 0);

  const book = await app.request('/v1/ops/bookings', {
    method: 'POST',
    headers: hdr(ops, `intake-book-${Date.now()}`),
    body: JSON.stringify({
      member: {
        full_name: 'Jordan Lee',
        email: 'jordan.lee@example.com',
        phone: '+15125550123',
        membership_tier: 'Premium',
      },
      property: {
        address_line1: '412 West Lynn St',
        city: 'Austin',
        state: 'TX',
        zip: '78703',
        timezone: 'America/Chicago',
      },
      request: {
        category_id: 'hvac',
        preferred_window_start: start.toISOString(),
        preferred_window_end: end.toISOString(),
        details: { notes: 'AC not cooling upstairs' },
      },
    }),
  });
  if (book.status !== 201) {
    throw new Error(`book ${book.status} ${await book.text()}`);
  }
  const booked = await book.json();
  const requestId = booked.request.id as string;
  const propertyId = booked.property_id as string;

  const prop = await app.request(`/v1/properties/${propertyId}`, { headers: hdr(ops) });
  if (prop.status !== 200) throw new Error(`property ${prop.status}`);
  const propBody = await prop.json();
  if (propBody.homeowner?.full_name !== 'Jordan Lee') {
    throw new Error('property homeowner mismatch');
  }
  if (propBody.address_line1 !== '412 West Lynn St') {
    throw new Error('property address mismatch');
  }

  const poolRes = await app.request('/v1/pool', { headers: hdr(ops) });
  if (poolRes.status !== 200) throw new Error(`pool ${poolRes.status}`);
  const poolBody = await poolRes.json();
  const item = (poolBody.items as { id: string; member_name?: string; address_line1?: string }[]).find(
    (r) => r.id === requestId,
  );
  if (!item?.member_name || item.member_name !== 'Jordan Lee') {
    throw new Error('pool missing real member_name');
  }
  if (item.address_line1 !== '412 West Lynn St') {
    throw new Error('pool missing real address');
  }

  const createPro = await app.request('/v1/contractors', {
    method: 'POST',
    headers: hdr(ops, `intake-pro-${Date.now()}`),
    body: JSON.stringify({
      full_name: 'Alex Rivera HVAC',
      email: 'alex.rivera@example.com',
      phone: '+15125550999',
      categories: ['hvac'],
      service_zips: ['78703'],
    }),
  });
  if (createPro.status !== 201) throw new Error(`contractor ${createPro.status}`);
  const pro = await createPro.json();

  const vet = await app.request(`/v1/contractors/${pro.id}/vetting`, {
    method: 'POST',
    headers: hdr(ops, `intake-vet-${Date.now()}`),
    body: JSON.stringify({ vetting_status: 'approved' }),
  });
  if (vet.status !== 200) throw new Error(`vetting ${vet.status}`);

  const avail = await app.request(`/v1/contractors/${pro.id}/availability`, {
    method: 'POST',
    headers: hdr(ops, `intake-avail-${Date.now()}`),
    body: JSON.stringify({
      slot_start: start.toISOString(),
      slot_end: end.toISOString(),
    }),
  });
  if (avail.status !== 201) throw new Error(`availability ${avail.status}`);

  const list = await app.request('/v1/contractors?vetting_status=approved', {
    headers: hdr(ops),
  });
  if (list.status !== 200) throw new Error(`list ${list.status}`);
  const listBody = await list.json();
  if (!(listBody.items as { id: string }[]).some((c) => c.id === pro.id)) {
    throw new Error('approved contractor missing from list');
  }

  console.log('smoke:intake OK', {
    requestId,
    code: booked.request.confirmation_code,
    contractorId: pro.id,
    member: propBody.homeowner.full_name,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
