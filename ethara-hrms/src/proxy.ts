// Defense-in-depth route guard for the staff dashboard (/dashboard/*).
//
// The access token lives in sessionStorage and the refresh-token cookie is scoped
// to /api/v1/auth, so the edge cannot reliably observe an authenticated dashboard
// session today. This proxy remains a safe pass-through until a readable session
// cookie is introduced, while client-side auth and backend permissions continue
// to enforce access.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "refresh_token";

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (!pathname.startsWith("/dashboard")) {
    return NextResponse.next();
  }

  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  if (!hasSessionCookie) {
    return NextResponse.next();
  }

  void search;
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
