import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { fieldUnauthorized, getFieldSessionFromRequest } from '@/lib/auth/field';
import { dispatchFetch } from '@/lib/dispatch/client';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const session = await getFieldSessionFromRequest(request);
  if (!session) return fieldUnauthorized();
  const { id } = await ctx.params;

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
      role: 'contractor',
      contractorId: session.contractorId,
      method: 'POST',
      path: `/requests/${id}/complete`,
      idempotencyKey: crypto.randomUUID(),
      body,
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
