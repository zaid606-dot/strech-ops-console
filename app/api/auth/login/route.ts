import { NextRequest, NextResponse } from 'next/server';

import {
  OPS_COOKIE,
  authFailed,
  defaultOperatorSub,
  opsDashboardCredentials,
  secretsEqual,
} from '@/lib/auth/ops';
import { SESSION_COOKIE_BASE, sealOpsSession } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const creds = opsDashboardCredentials();
  if (!creds) {
    return NextResponse.json(
      {
        error: 'misconfigured',
        detail:
          'Set OPS_DASHBOARD_USER and OPS_DASHBOARD_PASSWORD (min 12 chars) in the environment',
      },
      { status: 503 },
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';

  const userOk = secretsEqual(username, creds.user);
  const passOk = secretsEqual(password, creds.password);
  if (!userOk || !passOk) {
    return authFailed();
  }

  const session = {
    operatorSub: defaultOperatorSub(),
    loggedInAt: new Date().toISOString(),
    username: creds.user,
  };

  const token = await sealOpsSession(session);
  if (!token) {
    return NextResponse.json(
      {
        error: 'misconfigured',
        detail: 'Set OPS_SESSION_SECRET or OPS_DASHBOARD_PASSWORD (≥12 chars) to seal sessions',
      },
      { status: 503 },
    );
  }

  const res = NextResponse.json({ ok: true, operatorSub: session.operatorSub });
  res.cookies.set(OPS_COOKIE, token, SESSION_COOKIE_BASE);
  return res;
}
