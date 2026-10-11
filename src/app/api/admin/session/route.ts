import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import {
  defaultLandingFor,
  permissionsFor,
} from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

/**
 * Server-verified administrator session probe.
 *
 * Identity and role come from the caller's own verified session plus the
 * database profile — never from the request — and denials return a stable status
 * without revealing whether an account exists.
 *
 * The browser uses the returned role only to filter navigation. Every protected
 * route and privileged operation is authorised again on the server, so a
 * tampered response cannot grant anything.
 */
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin)
    return NextResponse.json(
      { authenticated: false, code: "unauthenticated" },
      { status: 401, headers: NO_STORE },
    );

  return NextResponse.json(
    {
      authenticated: true,
      role: admin.role,
      displayName: admin.displayName,
      landing: defaultLandingFor(admin.role),
      permissions: permissionsFor(admin.role),
    },
    { headers: NO_STORE },
  );
}
