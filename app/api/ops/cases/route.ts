import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';

export async function GET(request: NextRequest) {
  const session = await getOpsSessionFromRequest(request);
  if (!session) return unauthorized();
  const status = request.nextUrl.searchParams.get('status') ?? 'open';
  const type = request.nextUrl.searchParams.get('type') ?? undefined;
  const serviceRequestId =
    request.nextUrl.searchParams.get('service_request_id') ?? undefined;
  try {
    const data = await dispatchFetch({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'GET',
      path: '/cases',
      query: { status, type, service_request_id: serviceRequestId },
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
