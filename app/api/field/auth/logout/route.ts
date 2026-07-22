import { NextResponse } from 'next/server';

import { FIELD_COOKIE } from '@/lib/auth/field';
import { SESSION_COOKIE_BASE } from '@/lib/auth/session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(FIELD_COOKIE, '', { ...SESSION_COOKIE_BASE, maxAge: 0 });
  return res;
}
