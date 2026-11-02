import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { demoMode } from "@/lib/demo-mode";
import { protectedAdminPath, safeAdminPath } from "@/lib/auth/redirect";
import { PRIVATE_HEADERS, refreshSession } from "@/lib/supabase/proxy";
import { SITE_URL } from "@/lib/site";

/**
 * Next.js 16 Proxy (the renamed Middleware file convention).
 *
 * Responsibilities:
 * 1. Canonical-host redirects in production: apex → www, any *.vercel.app
 *    deployment host → the canonical domain, and http → https.
 * 2. Refresh the Supabase session for `/admin` and propagate the cookies.
 * 3. Redirect unauthenticated visitors away from protected `/admin` routes
 *    when demo mode is disabled.
 *
 * Important: public routes return **no response**. Creating a pass-through
 * `NextResponse.next()` committed a 200 status before the page rendered, which
 * turned `notFound()` into a soft 404. Letting Next handle the request keeps
 * real 404 statuses. Preview noindex is applied by next.config headers instead.
 *
 * This is NOT the authorisation boundary. Every admin page and every privileged
 * server operation independently verifies the authenticated user and the
 * current database role, and RLS enforces access again in Postgres.
 */

const CANONICAL = new URL(SITE_URL);

/** Only Vercel's production deployment is redirected; previews are noindexed. */
function canonicalRedirect(request: NextRequest): NextResponse | null {
  if (process.env.VERCEL_ENV !== "production") return null;

  const host = (request.headers.get("host") ?? "")
    .split(":")[0]
    .toLowerCase();
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  const wrongHost =
    host !== CANONICAL.hostname &&
    (host === "2ndwavelaundry.com" || host.endsWith(".vercel.app"));
  const wrongProtocol = protocol !== "https";

  if (!wrongHost && !wrongProtocol) return null;

  const target = new URL(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
    SITE_URL,
  );
  return NextResponse.redirect(target, 301);
}

export default async function proxy(request: NextRequest) {
  const redirect = canonicalRedirect(request);
  if (redirect) return redirect;

  const pathname = request.nextUrl.pathname;
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");

  // Public pages: no response object, so Next keeps control of status codes.
  if (!isAdminPath) return;

  const { response, user } = await refreshSession(request);
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
  // Every HTML route, including admin. Static files, images and Next internals
  // are excluded so asset requests never pay for a proxy invocation.
  matcher: ["/((?!_next/|.*\\..*).*)"],
};
