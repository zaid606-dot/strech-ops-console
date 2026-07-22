import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';
import type { Contractor } from '@/lib/dispatch/types';

export async function GET(request: NextRequest) {
  const session = getOpsSessionFromRequest(request);
  if (!session) return unauthorized();

  try {
    const data = await dispatchFetch<{ items: Contractor[]; next_cursor: string | null }>({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'GET',
      path: '/contractors',
      query: {
        vetting_status: request.nextUrl.searchParams.get('vetting_status') ?? undefined,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  try {
    const data = await dispatchFetch<Contractor>({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'POST',
      path: '/contractors',
      idempotencyKey: crypto.randomUUID(),
      body,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
