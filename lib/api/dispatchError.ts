import { NextResponse } from 'next/server';

import { DispatchHttpError } from '@/lib/dispatch/client';

export function dispatchErrorResponse(e: unknown): NextResponse {
  if (e instanceof DispatchHttpError) {
    const body =
      e.body && typeof e.body === 'object'
        ? e.body
        : { error: 'dispatch_error', detail: String(e.body) };
    return NextResponse.json(body, {
      status: e.status >= 400 && e.status < 600 ? e.status : 502,
    });
  }
  console.error(e);
  return NextResponse.json({ error: 'internal_error' }, { status: 500 });
}
