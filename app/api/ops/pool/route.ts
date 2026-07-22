import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';
import type { ServiceRequest } from '@/lib/dispatch/types';

export async function GET(request: NextRequest) {
  const session = getOpsSessionFromRequest(request);
  if (!session) return unauthorized();

  try {
    const data = await dispatchFetch<{ items: ServiceRequest[]; next_cursor: string | null }>({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'GET',
      path: '/pool',
      query: {
        category_id: request.nextUrl.searchParams.get('category_id') ?? undefined,
        zip: request.nextUrl.searchParams.get('zip') ?? undefined,
      },
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
