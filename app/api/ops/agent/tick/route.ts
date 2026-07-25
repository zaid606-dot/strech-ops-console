import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';

export async function POST(request: NextRequest) {
  const session = await getOpsSessionFromRequest(request);
  if (!session) return unauthorized();
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  try {
    const data = await dispatchFetch({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'POST',
      path: '/agent/tick',
      idempotencyKey: crypto.randomUUID(),
      body,
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
