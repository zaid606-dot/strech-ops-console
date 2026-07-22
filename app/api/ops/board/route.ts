import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';
import type { ServiceRequest } from '@/lib/dispatch/types';

export async function GET(request: NextRequest) {
  const session = await getOpsSessionFromRequest(request);
  if (!session) return unauthorized();

  try {
    const data = await dispatchFetch<{
      counts: Record<string, number>;
      queues: Record<string, ServiceRequest[]>;
    }>({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'GET',
      path: '/ops/board',
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
