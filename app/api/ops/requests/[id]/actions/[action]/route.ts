import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';

const ALLOWED = new Set([
  'unassign',
  'cancel',
  'no-show',
  'redispatch',
  'reschedule',
  'reassign',
  'assign',
  'confirm-visit',
  'ack-arrival',
  'close',
]);

type Ctx = { params: Promise<{ id: string; action: string }> };

/** Proxy POST /v1/requests/{id}/{action} for ops desk recovery + confirm. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getOpsSessionFromRequest(request);
  if (!session) return unauthorized();

  const { id, action } = await ctx.params;
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ error: 'unknown_action', detail: action }, { status: 404 });
  }

  let body: unknown = {};
  const text = await request.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
  }

  try {
    const data = await dispatchFetch({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'POST',
      path: `/requests/${id}/${action}`,
      idempotencyKey: crypto.randomUUID(),
      body,
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
