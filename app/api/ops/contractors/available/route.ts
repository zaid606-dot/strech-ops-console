import { NextRequest, NextResponse } from 'next/server';

import { dispatchErrorResponse } from '@/lib/api/dispatchError';
import { getOpsSessionFromRequest, unauthorized } from '@/lib/auth/ops';
import { dispatchFetch } from '@/lib/dispatch/client';
import type { ContractorCandidate } from '@/lib/dispatch/types';

export async function GET(request: NextRequest) {
  const session = getOpsSessionFromRequest(request);
  if (!session) return unauthorized();

  const categoryId = request.nextUrl.searchParams.get('category_id') ?? undefined;
  const zip = request.nextUrl.searchParams.get('zip') ?? undefined;
  const windowStart = request.nextUrl.searchParams.get('window_start') ?? undefined;

  if (!categoryId || !zip) {
    return NextResponse.json(
      { error: 'validation_error', detail: 'category_id and zip are required' },
      { status: 422 },
    );
  }

  try {
    const data = await dispatchFetch<ContractorCandidate[]>({
      role: 'ops',
      operatorSub: session.operatorSub,
      method: 'GET',
      path: '/contractors/available',
      query: {
        category_id: categoryId,
        zip,
        window_start: windowStart,
      },
    });
    return NextResponse.json({ items: Array.isArray(data) ? data : [] });
  } catch (e) {
    return dispatchErrorResponse(e);
  }
}
