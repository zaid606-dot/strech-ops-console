import { createHash, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import {
  OPS_COOKIE,
  type OpsSession,
  parseOpsSession,
} from '@/lib/auth/session';

export { OPS_COOKIE, parseOpsSession };
export type { OpsSession };

export function defaultOperatorSub(): string {
  return process.env.OPS_OPERATOR_SUB ?? '00000000-0000-4000-8000-0000000000aa';
}

/** Fail closed: both must be set; password ≥12 chars. */
export function opsDashboardCredentials(): { user: string; password: string } | null {
  const user = process.env.OPS_DASHBOARD_USER?.trim() ?? '';
  const password = process.env.OPS_DASHBOARD_PASSWORD ?? '';
  if (!user || !password) return null;
  if (password.length < 12) return null;
  return { user, password };
}

function normalize(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/** Constant-time compare of UTF-8 secrets via SHA-256 digests. */
export function secretsEqual(a: string, b: string): boolean {
  const ba = normalize(a);
  const bb = normalize(b);
  return timingSafeEqual(ba, bb);
}

export async function getOpsSession(): Promise<OpsSession | null> {
  const jar = await cookies();
  return parseOpsSession(jar.get(OPS_COOKIE)?.value);
}

export async function getOpsSessionFromRequest(
  request: NextRequest,
): Promise<OpsSession | null> {
  return parseOpsSession(request.cookies.get(OPS_COOKIE)?.value);
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export function authFailed(): NextResponse {
  return NextResponse.json(
    { error: 'unauthorized', detail: 'Invalid credentials' },
    { status: 401 },
  );
}
