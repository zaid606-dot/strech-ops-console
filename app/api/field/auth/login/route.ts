import { NextRequest, NextResponse } from 'next/server';

import {
  FIELD_COOKIE,
  fieldAuthFailed,
  fieldDashboardPassword,
  fieldPasswordOk,
  isUuid,
} from '@/lib/auth/field';
import { SESSION_COOKIE_BASE, sealFieldSession } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  if (!fieldDashboardPassword()) {
    return NextResponse.json(
      {
        error: 'misconfigured',
        detail:
          'Set FIELD_DASHBOARD_PASSWORD or OPS_DASHBOARD_PASSWORD (min 12 chars)',
      },
      { status: 503 },
    );
  }

  let body: { password?: string; contractorId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const contractorId = (body.contractorId ?? '').trim();
  const password = body.password ?? '';

  // Uniform failure: never reveal which field failed (no 422 after password OK).
  if (!isUuid(contractorId) || !fieldPasswordOk(password)) {
    return fieldAuthFailed();
  }

  const session = {
    contractorId,
    loggedInAt: new Date().toISOString(),
  };

  const token = await sealFieldSession(session);
  if (!token) {
    return NextResponse.json(
      {
        error: 'misconfigured',
        detail: 'Session sealing unavailable — set OPS_SESSION_SECRET or ops password',
      },
      { status: 503 },
    );
  }

  const res = NextResponse.json({ ok: true, contractorId: session.contractorId });
  res.cookies.set(FIELD_COOKIE, token, SESSION_COOKIE_BASE);
  return res;
}
