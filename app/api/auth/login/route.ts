import { NextRequest, NextResponse } from 'next/server';

import {
  OPS_COOKIE,
  defaultOperatorSub,
  opsDevToken,
} from '@/lib/auth/ops';

export async function POST(request: NextRequest) {
  const expected = opsDevToken();
  if (!expected) {
    return NextResponse.json(
      { error: 'misconfigured', detail: 'OPS_DEV_TOKEN not set' },
      { status: 500 },
    );
  }

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.token || body.token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const session = {
    operatorSub: defaultOperatorSub(),
    loggedInAt: new Date().toISOString(),
  };

  const res = NextResponse.json({ ok: true, operatorSub: session.operatorSub });
  res.cookies.set(OPS_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 12,
  });
  return res;
}
