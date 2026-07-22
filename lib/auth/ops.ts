import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

export const OPS_COOKIE = 'strech_ops_session';

export type OpsSession = {
  operatorSub: string;
  loggedInAt: string;
};

export function opsDevToken(): string {
  return process.env.OPS_DEV_TOKEN ?? '';
}

export function defaultOperatorSub(): string {
  return process.env.OPS_OPERATOR_SUB ?? '00000000-0000-4000-8000-0000000000aa';
}

export function parseOpsSession(raw: string | undefined): OpsSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OpsSession;
    if (!parsed?.operatorSub) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getOpsSession(): Promise<OpsSession | null> {
  const jar = await cookies();
  return parseOpsSession(jar.get(OPS_COOKIE)?.value);
}

export function getOpsSessionFromRequest(request: NextRequest): OpsSession | null {
  return parseOpsSession(request.cookies.get(OPS_COOKIE)?.value);
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
