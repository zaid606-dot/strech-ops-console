import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

export const FIELD_COOKIE = 'strech_field_session';

export type FieldSession = {
  contractorId: string;
  loggedInAt: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function fieldDevToken(): string {
  return process.env.FIELD_DEV_TOKEN ?? process.env.OPS_DEV_TOKEN ?? '';
}

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

export function parseFieldSession(raw: string | undefined): FieldSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FieldSession;
    if (!parsed?.contractorId || !isUuid(parsed.contractorId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getFieldSession(): Promise<FieldSession | null> {
  const jar = await cookies();
  return parseFieldSession(jar.get(FIELD_COOKIE)?.value);
}

export function getFieldSessionFromRequest(request: NextRequest): FieldSession | null {
  return parseFieldSession(request.cookies.get(FIELD_COOKIE)?.value);
}

export function fieldUnauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
