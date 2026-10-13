import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/bookings/admin";
import {
  getBookingPhotoAccess,
  type PhotoAccessErrorCode,
} from "@/lib/bookings/photo-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

/**
 * Administrator booking photo endpoint (Sprint 2C refinement).
 *
 *   GET /api/admin/bookings/<id>/photos/<photoId>
 *     → that photo's display metadata plus a short-lived signed URL.
 *
 * The same `bookings.read` capability that gates `/admin/bookings` gates this
 * endpoint, and the underlying read runs under the caller's own session so row
 * level security decides independently. An unauthenticated caller receives 401;
 * an authenticated role without `bookings.read` receives 403; a photo that does
 * not belong to the booking, is already retained out, or whose object is gone
 * all resolve to the same 404, so the endpoint cannot be used to probe for
 * other bookings' attachments.
 *
 * Nothing here logs or returns the elevated key, the bucket name or the object
 * key, and signing never mutates the booking.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; photoId: string }> },
) {
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

  const { id, photoId } = await ctx.params;
  if (!isUuid(id) || !isUuid(photoId))
    return NextResponse.json(
      { code: "not_found", message: "This image is no longer available." },
      { status: 404, headers: NO_STORE },
    );

  const result = await getBookingPhotoAccess(admin, id, photoId);
  if (!result.ok) return errorResponse(result.code);

  return NextResponse.json({ photo: result.data }, { headers: NO_STORE });
}

function errorResponse(code: PhotoAccessErrorCode) {
  return NextResponse.json(
    { code, message: messages[code] ?? messages.conflict },
    { status: statuses[code] ?? 500, headers: NO_STORE },
  );
}

const statuses: Record<PhotoAccessErrorCode, number> = {
  actor_required: 401,
  permission_denied: 403,
  not_found: 404,
  not_configured: 503,
  conflict: 409,
};

const messages: Record<PhotoAccessErrorCode, string> = {
  actor_required: "Sign in with an administrator account.",
  permission_denied: "Your administrator role does not allow this action.",
  not_found: "This image is no longer available.",
  not_configured: "Booking images are not configured for this environment.",
  conflict: "This image could not be loaded. Please try again.",
};
