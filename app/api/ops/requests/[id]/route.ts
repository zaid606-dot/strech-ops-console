import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';
import type { ServiceRequest } from '@/lib/dispatch/types';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const session = getOpsSessionFromRequest(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;

  try {
    const data = await dispatchFetch<ServiceRequest>({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'GET',
      path: `/requests/${id}`,
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
