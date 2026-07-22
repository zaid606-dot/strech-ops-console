import { NextResponse } from 'next/server';

import { FIELD_COOKIE } from '@/lib/auth/field';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(FIELD_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
