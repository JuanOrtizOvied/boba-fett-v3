import { NextResponse, type NextRequest } from "next/server";

const ACCESS_COOKIE = "sabbi_access";
const REFRESH_COOKIE = "sabbi_refresh";
const PUBLIC_PATHS = ["/login"];

/**
 * Server-side route guard: redirects to `/login` only when BOTH auth
 * cookies are absent. When only `sabbi_access` is missing but
 * `sabbi_refresh` exists, the page loads normally and the client-side
 * `fetchWithAuth` handles the 401 → refresh → retry flow.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/") || PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const hasAccess = request.cookies.has(ACCESS_COOKIE);
  const hasRefresh = request.cookies.has(REFRESH_COOKIE);
  if (!hasAccess && !hasRefresh) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
