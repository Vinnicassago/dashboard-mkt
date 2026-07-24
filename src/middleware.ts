import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Route gate. Runs on the Edge runtime, so it only verifies the signed cookie
 * (Web Crypto) — it never touches the store or node:crypto.
 *
 * Left open on purpose:
 *  - /login            (where you sign in / create the first user)
 *  - /api/track        (public ingest from the landing page)
 *  - /api/sync         (cron; guarded by its own CRON_SECRET header)
 * Auth is skipped entirely when AUTH_SECRET is not set.
 */
const OPEN_API = ["/api/track", "/api/sync"];

export async function middleware(request: NextRequest) {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (
    pathname === "/login" ||
    OPEN_API.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifySessionToken(token, secret) : null;
  if (user) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|lp-tracking.js).*)"],
};
