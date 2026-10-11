import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { listAuditEvents, listStaffAccounts } from "@/lib/admin/staff-service";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

/**
 * Staff-management read endpoint.
 *
 * Authorisation is resolved from the caller's verified session plus the database
 * profile — never from the request — and the same `staff.manage` capability that
 * gates `/admin/staff` gates this endpoint, so an Operational Admin receives 403
 * here as well as a forbidden route.
 *
 * Reads still happen under RLS with the caller's own client: even if this handler
 * were reached with the wrong role, the policies would return no administrator
 * profiles, no invitations and no audit history.
 */
export async function GET(request: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin)
    return NextResponse.json(
      { code: "unauthenticated", message: "Sign in with an administrator account." },
      { status: 401, headers: NO_STORE },
    );

  if (!hasPermission(admin.role, "staff.manage"))
    return NextResponse.json(
      {
        code: "permission_denied",
        message: "Your administrator role does not include staff management.",
      },
      { status: 403, headers: NO_STORE },
    );

  if (request.nextUrl.searchParams.has("events")) {
    const requested = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(requested) ? requested : 50;
    const events = await listAuditEvents(limit);
    if (!events.ok)
      return NextResponse.json(
        { code: events.code, message: "Audit history is unavailable." },
        { status: 403, headers: NO_STORE },
      );
    return NextResponse.json({ events: events.data }, { headers: NO_STORE });
  }

  const accounts = await listStaffAccounts();
  if (!accounts.ok)
    return NextResponse.json(
      { code: accounts.code, message: "Staff accounts are unavailable." },
      { status: 403, headers: NO_STORE },
    );

  return NextResponse.json(
    {
      members: accounts.data.members,
      invitations: accounts.data.invitations,
      activeFullAdmins: accounts.data.activeFullAdmins,
      // Display-only echo of the caller's own capability, already enforced above.
      canManage: true,
    },
    { headers: NO_STORE },
  );
}
