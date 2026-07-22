import { NextResponse, type NextRequest } from 'next/server';

import {
  FIELD_COOKIE,
  OPS_COOKIE,
  parseFieldSession,
  parseOpsSession,
} from '@/lib/auth/session';

function isOpsApi(pathname: string) {
  return pathname === '/api/ops' || pathname.startsWith('/api/ops/');
}
function isOpsPage(pathname: string) {
  return pathname === '/ops' || pathname.startsWith('/ops/');
}
function isFieldApi(pathname: string) {
  if (pathname === '/api/field/auth' || pathname.startsWith('/api/field/auth/')) {
    return false;
  }
  return pathname === '/api/field' || pathname.startsWith('/api/field/');
}
function isFieldPage(pathname: string) {
  if (pathname === '/field/login' || pathname.startsWith('/field/login/')) {
    return false;
  }
  return pathname === '/field' || pathname.startsWith('/field/');
}

/** Hard gate: desk and BFFs require a sealed session cookie. Fail closed. */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isOpsApi(pathname) || isOpsPage(pathname)) {
    const session = await parseOpsSession(request.cookies.get(OPS_COOKIE)?.value);
    if (!session) {
      if (isOpsApi(pathname)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      const login = new URL('/login', request.url);
      login.searchParams.set('next', pathname);
      return NextResponse.redirect(login);
    }
  }

  if (isFieldApi(pathname) || isFieldPage(pathname)) {
    const session = await parseFieldSession(request.cookies.get(FIELD_COOKIE)?.value);
    if (!session) {
      if (isFieldApi(pathname)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/field/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/ops', '/ops/:path*', '/api/ops', '/api/ops/:path*', '/field', '/field/:path*', '/api/field', '/api/field/:path*'],
};
