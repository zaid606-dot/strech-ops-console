import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { fieldUnauthorized, getFieldSessionFromRequest } from '@/lib/auth/field';
import { dispatchFetch } from '@/lib/dispatch/client';

export async function GET(request: NextRequest) {
  const session = await getFieldSessionFromRequest(request);
  if (!session) return fieldUnauthorized();

  try {
    const data = await dispatchFetch({
      role: 'contractor',
      contractorId: session.contractorId,
      method: 'GET',
      path: '/contractors/me/jobs',
      query: {
        status: request.nextUrl.searchParams.get('status') ?? undefined,
      },
    });
    return NextResponse.json(data);
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
