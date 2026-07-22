import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';
import type { JobEvent } from '@/lib/dispatch/types';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const session = getOpsSessionFromRequest(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;

  try {
    const data = await dispatchFetch<{ items: JobEvent[] } | JobEvent[]>({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'GET',
      path: `/requests/${id}/events`,
    });
    const items = Array.isArray(data) ? data : (data.items ?? []);
    return NextResponse.json({ items });
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
