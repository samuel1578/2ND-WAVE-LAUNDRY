import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { bookingErrorStatus, type BookingErrorCode } from "@/lib/bookings/errors";
import {
  getAdminBooking,
  listAdminBookings,
  listBranchOptions,
  loadBookingOperationsSummary,
} from "@/lib/bookings/admin-service";
import { normaliseBookingListQuery } from "@/lib/bookings/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

/**
 * Administrator booking read endpoint (Sprint 2C).
 *
 * Authorisation is resolved from the caller's verified session plus the database
 * profile — never from the request — and the same `bookings.read` capability that
 * gates `/admin/bookings` gates this endpoint. The queries then run under row level
 * security with the caller's own client, so even a mis-resolved role would see no
 * booking rows.
 *
 *   GET /api/admin/bookings                     → one filtered page + branch options
 *   GET /api/admin/bookings?id=<uuid>           → one booking with its history/notes
 *   GET /api/admin/bookings?view=summary        → dashboard counters + recent rows
 *
 * Nothing here returns a credential or a raw database message.
 */
export async function GET(request: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin)
    return NextResponse.json(
      { code: "actor_required", message: "Sign in with an administrator account." },
      { status: 401, headers: NO_STORE },
    );

  if (!hasPermission(admin.role, "bookings.read"))
    return NextResponse.json(
      {
        code: "permission_denied",
        message: "Your administrator role does not include bookings.",
      },
      { status: 403, headers: NO_STORE },
    );

  const params = request.nextUrl.searchParams;

  const id = params.get("id");
  if (id) {
    // The branch options travel with the detail so assignment is one round trip.
    const [detail, branches] = await Promise.all([
      getAdminBooking(id),
      listBranchOptions(),
    ]);
    if (!detail.ok) return errorResponse(detail.code);
    return NextResponse.json(
      { booking: detail.data, branches: branches.ok ? branches.data : [] },
      { headers: NO_STORE },
    );
  }

  if (params.get("view") === "summary") {
    const summary = await loadBookingOperationsSummary();
    if (!summary.ok) return errorResponse(summary.code);
    return NextResponse.json(summary.data, { headers: NO_STORE });
  }

  const query = normaliseBookingListQuery({
    search: params.get("search") ?? undefined,
    status: params.get("status") ?? undefined,
    branch: params.get("branch") ?? undefined,
    date: params.get("date") ?? undefined,
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });

  const [page, branches] = await Promise.all([
    listAdminBookings(query),
    listBranchOptions(),
  ]);
  if (!page.ok) return errorResponse(page.code);

  return NextResponse.json(
    {
      rows: page.data.rows,
      total: page.data.total,
      page: page.data.page,
      pageSize: page.data.pageSize,
      branches: branches.ok ? branches.data : [],
    },
    { headers: NO_STORE },
  );
}

function errorResponse(code: BookingErrorCode) {
  const status = bookingErrorStatus(code);
  return NextResponse.json(
    { code, message: messages[code] ?? messages.conflict },
    { status: status === 422 ? 400 : status, headers: NO_STORE },
  );
}

/**
 * Short, safe messages for the read path. The richer user-facing copy lives in
 * `src/lib/bookings/errors.ts`; these keep the response body minimal.
 */
const messages: Partial<Record<BookingErrorCode, string>> = {
  not_found: "This booking is no longer available.",
  permission_denied: "Your administrator role does not allow this action.",
  actor_required: "Sign in with an administrator account.",
  not_configured: "Booking operations are not configured for this environment.",
  conflict: "The booking list could not be loaded. Please try again.",
};
