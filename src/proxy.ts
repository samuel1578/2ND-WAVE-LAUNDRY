import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { demoMode } from "@/lib/demo-mode";
import { protectedAdminPath, safeAdminPath } from "@/lib/auth/redirect";
import { PRIVATE_HEADERS, refreshSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 Proxy (the renamed Middleware file convention).
 *
 * Responsibilities:
 * 1. Refresh the Supabase session and propagate the refreshed cookies to the
 *    downstream server request and to the browser.
 * 2. Redirect unauthenticated visitors away from protected `/admin` routes
 *    when demo mode is disabled, preserving a validated return destination.
 *
 * This is NOT the authorisation boundary. Every admin page and every privileged
 * server operation independently verifies the authenticated user and the
 * current database role, and RLS enforces access again in Postgres.
 */
export default async function proxy(request: NextRequest) {
  const { response, user } = await refreshSession(request);
  const pathname = request.nextUrl.pathname;

  let result = response;
  if (!user && !demoMode && protectedAdminPath(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/admin/login";
    login.search = "";
    login.searchParams.set("next", safeAdminPath(pathname));
    result = NextResponse.redirect(login);
  }

  for (const [name, value] of Object.entries(PRIVATE_HEADERS))
    result.headers.set(name, value);
  return result;
}

export const config = {
  // Only administrative routes. Public website routes are never intercepted.
  matcher: ["/admin", "/admin/:path*"],
};
