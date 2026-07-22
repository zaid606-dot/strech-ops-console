import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';

export async function GET(request: NextRequest) {
  const session = await getOpsSessionFromRequest(request);
  if (!session) return unauthorized();
  const serviceRequestId =
    request.nextUrl.searchParams.get('service_request_id') ?? undefined;
  const limit = request.nextUrl.searchParams.get('limit') ?? undefined;
  try {
    const data = await dispatchFetch({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'GET',
      path: '/ops/audit/events',
      query: { service_request_id: serviceRequestId, limit },
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
