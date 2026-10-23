import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import {
  listBookingAlertRecipients,
  MAX_ENABLED_BOOKING_ALERT_RECIPIENTS,
} from "@/lib/email/recipients";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

/**
 * Order alert recipient read endpoint (Phase 2E.2).
 *
 * Authorisation is resolved from the caller's verified session plus the database
 * profile — never from the request — and the same `settings.manage` capability
 * that gates `/admin/settings` gates this endpoint. An Operational Admin
 * therefore receives 403 here as well as the forbidden route.
 *
 * Reads use the server-only elevated client because the table has RLS enabled
 * with no client policy. The browser never receives a key. Writes do not exist on
 * this route: they are Server Actions that repeat the same authorisation chain.
 */
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin)
    return NextResponse.json(
      {
        code: "unauthenticated",
        message: "Sign in with an administrator account.",
      },
      { status: 401, headers: NO_STORE },
    );

  if (!hasPermission(admin.role, "settings.manage"))
    return NextResponse.json(
      {
        code: "permission_denied",
        message: "Your administrator role does not include notification settings.",
      },
      { status: 403, headers: NO_STORE },
    );

  const result = await listBookingAlertRecipients();
  if (!result.ok)
    return NextResponse.json(
      { code: result.reason, message: "The alert recipient list is unavailable." },
      { status: 503, headers: NO_STORE },
    );

  return NextResponse.json(
    {
      recipients: result.recipients,
      maxEnabled: MAX_ENABLED_BOOKING_ALERT_RECIPIENTS,
    },
    { headers: NO_STORE },
  );
}

/** Methods other than GET are not part of the read endpoint. */
export function POST() {
  return NextResponse.json(
    { code: "method_not_allowed", message: "Use the settings form to change recipients." },
    { status: 405, headers: { ...NO_STORE, Allow: "GET" } },
  );
}

export function PUT() {
  return POST();
}

export function PATCH() {
  return POST();
}

export function DELETE() {
  return POST();
}
