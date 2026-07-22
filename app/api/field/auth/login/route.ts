import { NextRequest, NextResponse } from 'next/server';

import { FIELD_COOKIE, fieldDevToken, isUuid } from '@/lib/auth/field';

export async function POST(request: NextRequest) {
  const expected = fieldDevToken();
  if (!expected) {
    return NextResponse.json(
      { error: 'misconfigured', detail: 'FIELD_DEV_TOKEN or OPS_DEV_TOKEN not set' },
      { status: 500 },
    );
  }

  let body: { token?: string; contractorId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.token || body.token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!body.contractorId || !isUuid(body.contractorId)) {
    return NextResponse.json(
      { error: 'validation_error', detail: 'contractorId must be a UUID' },
      { status: 422 },
    );
  }

  const session = {
    contractorId: body.contractorId,
    loggedInAt: new Date().toISOString(),
  };

  const res = NextResponse.json({ ok: true, contractorId: session.contractorId });
  res.cookies.set(FIELD_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 12,
  });
  return res;
}
