import { NextResponse } from 'next/server';

import { OPS_COOKIE } from '@/lib/auth/ops';
import { SESSION_COOKIE_BASE } from '@/lib/auth/session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(OPS_COOKIE, '', { ...SESSION_COOKIE_BASE, maxAge: 0 });
  return res;
}
