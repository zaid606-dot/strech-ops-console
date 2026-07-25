/** Edge-safe sealed sessions (jose HMAC). Used by middleware + server. */

import { SignJWT, jwtVerify } from 'jose';

export const OPS_COOKIE = 'strech_ops_session';
export const FIELD_COOKIE = 'strech_field_session';

export type OpsSession = {
  operatorSub: string;
  loggedInAt: string;
  username: string;
};

export type FieldSession = {
  contractorId: string;
  loggedInAt: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

function sessionSecretKey(): Uint8Array | null {
  const raw =
    process.env.OPS_SESSION_SECRET?.trim() ||
    process.env.OPS_DASHBOARD_PASSWORD ||
    '';
  if (!raw || raw.length < 12) return null;
  return new TextEncoder().encode(raw);
}

export async function sealOpsSession(session: OpsSession): Promise<string | null> {
  const key = sessionSecretKey();
  if (!key) return null;
  return new SignJWT({
    typ: 'ops',
    operatorSub: session.operatorSub,
    username: session.username,
    loggedInAt: session.loggedInAt,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(key);
}

export async function sealFieldSession(session: FieldSession): Promise<string | null> {
  const key = sessionSecretKey();
  if (!key) return null;
  return new SignJWT({
    typ: 'field',
    contractorId: session.contractorId,
    loggedInAt: session.loggedInAt,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(key);
}

export async function parseOpsSession(raw: string | undefined): Promise<OpsSession | null> {
  if (!raw || typeof raw !== 'string') return null;
  const key = sessionSecretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(raw, key, { algorithms: ['HS256'] });
    if (payload.typ !== 'ops') return null;
    const operatorSub = payload.operatorSub;
    const username = payload.username;
    const loggedInAt = payload.loggedInAt;
    if (typeof operatorSub !== 'string' || !operatorSub) return null;
    if (typeof username !== 'string' || !username) return null;
    if (typeof loggedInAt !== 'string' || !loggedInAt) return null;
    return { operatorSub, username, loggedInAt };
  } catch {
    return null;
  }
}

export async function parseFieldSession(
  raw: string | undefined,
): Promise<FieldSession | null> {
  if (!raw || typeof raw !== 'string') return null;
  const key = sessionSecretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(raw, key, { algorithms: ['HS256'] });
    if (payload.typ !== 'field') return null;
    const contractorId = payload.contractorId;
    const loggedInAt = payload.loggedInAt;
    if (typeof contractorId !== 'string' || !isUuid(contractorId)) return null;
    if (typeof loggedInAt !== 'string' || !loggedInAt) return null;
    return { contractorId, loggedInAt };
  } catch {
    return null;
  }
}

/** Safe post-login path helpers live in paths.ts (client-safe). */
export { safeOpsNextPath } from '@/lib/auth/paths';

export const SESSION_COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 12,
};
