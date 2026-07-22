import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';

export async function GET(request: NextRequest) {
  const session = getOpsSessionFromRequest(request);
  if (!session) return unauthorized();

  try {
    const data = await dispatchFetch({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'GET',
      path: '/contractors/applications',
      query: {
        status: request.nextUrl.searchParams.get('status') ?? 'pending',
      },
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  const session = getOpsSessionFromRequest(request);
  if (!session) return unauthorized();

  try {
    const body = await request.json();
    const data = await dispatchFetch({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'POST',
      path: '/contractors/applications',
      query: { action: 'accept' },
      body,
      idempotencyKey: randomUUID(),
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
