import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';

type Ctx = { params: Promise<{ id: string }> };

/** GET / POST contractor availability rules → dispatch `/contractors/{id}/availability`. */
export async function GET(_request: NextRequest, ctx: Ctx) {
  const session = await getOpsSessionFromRequest(_request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;

  try {
    const data = await dispatchFetch({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'GET',
      path: `/contractors/${id}/availability`,
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getOpsSessionFromRequest(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  try {
    const data = await dispatchFetch({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'POST',
      path: `/contractors/${id}/availability`,
      idempotencyKey: randomUUID(),
      body,
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
