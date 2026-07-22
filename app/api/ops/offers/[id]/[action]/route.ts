import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';

type Ctx = { params: Promise<{ id: string; action: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getOpsSessionFromRequest(request);
  if (!session) return unauthorized();
  const { id, action } = await ctx.params;
  if (action !== 'accept' && action !== 'decline') {
    return NextResponse.json({ error: 'unknown_action' }, { status: 404 });
  }

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
      path: `/offers/${id}/${action}`,
      idempotencyKey: crypto.randomUUID(),
      body,
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
