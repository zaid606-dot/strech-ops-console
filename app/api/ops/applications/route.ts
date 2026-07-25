import { NextResponse } from 'next/server';

/** Gone — contractor intake lives under Contractors, not a parallel Applications desk. */
export async function GET() {
  return NextResponse.json(
    {
      error: 'gone',
      detail: 'Applications desk removed. Use Contractors for vetting and intake.',
    },
    { status: 410 },
  );
}

export async function POST() {
  return NextResponse.json(
    {
      error: 'gone',
      detail: 'Applications desk removed. Use Contractors for vetting and intake.',
    },
    { status: 410 },
  );
}
