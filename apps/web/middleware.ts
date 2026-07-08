import { NextResponse, type NextRequest } from "next/server";

const ACCESS_COOKIE = "sabbi_access";
const PUBLIC_PATHS = ["/login"];

/**
 * Server-side route guard: redirects to `/login` when the `sabbi_access`
 * cookie is absent, before any protected page renders — avoids a flash of
 * protected content (`design.md` — "Route protection"). This only checks
 * cookie *existence*, not validity — the backend independently validates the
 * JWT on every API call, so an expired-but-present cookie still reaches the
 * page and any subsequent API call gets a 401 (handled client-side, e.g.
 * `usePortfolio`'s redirect-on-401).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/") || PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const hasAccessCookie = request.cookies.has(ACCESS_COOKIE);
  if (!hasAccessCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
