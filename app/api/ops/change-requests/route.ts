import { NextResponse } from 'next/server';

/** Gone — use Cases (reschedule / cancel_request / etc.), not a parallel change-requests system. */
export async function GET() {
  return NextResponse.json(
    {
      error: 'gone',
      detail: 'Change-requests removed. Use Cases for reschedule, cancel, and related ops work.',
    },
    { status: 410 },
  );
}
