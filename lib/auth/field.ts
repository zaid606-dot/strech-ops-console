import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { secretsEqual } from '@/lib/auth/ops';
import {
  FIELD_COOKIE,
  type FieldSession,
  isUuid,
  parseFieldSession,
} from '@/lib/auth/session';

export { FIELD_COOKIE, isUuid, parseFieldSession };
export type { FieldSession };

export function fieldDashboardPassword(): string | null {
  const password =
    process.env.FIELD_DASHBOARD_PASSWORD || process.env.OPS_DASHBOARD_PASSWORD || '';
  if (!password || password.length < 12) return null;
  return password;
}

export async function getFieldSession(): Promise<FieldSession | null> {
  const jar = await cookies();
  return parseFieldSession(jar.get(FIELD_COOKIE)?.value);
}

export async function getFieldSessionFromRequest(
  request: NextRequest,
): Promise<FieldSession | null> {
  return parseFieldSession(request.cookies.get(FIELD_COOKIE)?.value);
}

export function fieldUnauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export function fieldAuthFailed(): NextResponse {
  return NextResponse.json(
    { error: 'unauthorized', detail: 'Invalid credentials' },
    { status: 401 },
  );
}

export function fieldPasswordOk(provided: string): boolean {
  const expected = fieldDashboardPassword();
  if (!expected) return false;
  return secretsEqual(provided, expected);
}
