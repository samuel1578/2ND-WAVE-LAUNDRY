/**
 * Administrator booking photo access (Sprint 2C refinement).
 *
 * Issues short-lived signed URLs for a booking's customer-attached photos.
 *
 * Authorisation is layered on purpose:
 *
 *   1. the caller's verified session must hold `bookings.read` (both approved
 *      admin roles do; an unrecognised or disabled profile resolves to none);
 *   2. the photo's `booking_photos` row is re-read under the caller's *own*
 *      session client, so the row-level policy decides independently — a
 *      booking the caller cannot read yields no row, and a photo whose 90-day
 *      retention has lapsed is withheld even though its row still exists;
 *   3. only then does the server-only elevated client mint the signed URL.
 *
 * The elevated key and the object key never leave the server, no signed URL is
 * logged, and signing never mutates the booking, its arrangements, notes or
 * audit history. Never import this module from a Client Component.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/permissions";
import type { AdminIdentity } from "@/lib/auth/roles";
import {
  BOOKING_PHOTOS_BUCKET,
  PHOTO_SIGNED_URL_TTL_SECONDS,
} from "./photos";

export type PhotoAccessResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: PhotoAccessErrorCode };

export type PhotoAccessErrorCode =
  | "actor_required"
  | "permission_denied"
  | "not_found"
  | "not_configured"
  | "conflict";

const fail = (code: PhotoAccessErrorCode): { ok: false; code: PhotoAccessErrorCode } => ({
  ok: false,
  code,
});

export type BookingPhotoAccess = {
  photoId: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  url: string;
  expiresInSeconds: number;
};

/**
 * One photo's display metadata plus a short-lived signed URL.
 *
 * `photoId` must belong to `bookingId`; a photo id from another booking is
 * indistinguishable from one that does not exist, so this endpoint cannot be
 * used to probe for other bookings' attachments.
 */
export async function getBookingPhotoAccess(
  actor: AdminIdentity | null,
  bookingId: string,
  photoId: string,
): Promise<PhotoAccessResult<BookingPhotoAccess>> {
  if (typeof window !== "undefined")
    throw new Error("Booking photo access is server-only.");

  if (!actor) return fail("actor_required");
  if (!hasPermission(actor.role, "bookings.read")) return fail("permission_denied");
  if (!isSupabaseConfigured) return fail("not_configured");

  // 2. Session-scoped read: RLS re-checks that this administrator may see the
  //    booking and that the photo's retention has not lapsed.
  let session;
  try {
    session = await createSupabaseServerClient();
  } catch {
    return fail("not_configured");
  }

  const { data: row, error: rowError } = await session
    .from("booking_photos")
    .select("id, storage_key, mime_type, byte_size, width, height")
    .eq("id", photoId)
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (rowError) return fail("permission_denied");
  if (!row || typeof row.storage_key !== "string" || !row.storage_key)
    return fail("not_found");

  // 3. Elevated signing, strictly after the caller was proven authorised.
  let elevated;
  try {
    elevated = createSupabaseAdminClient();
  } catch {
    return fail("not_configured");
  }

  const { data: signed, error: signError } = await elevated.storage
    .from(BOOKING_PHOTOS_BUCKET)
    .createSignedUrl(row.storage_key, PHOTO_SIGNED_URL_TTL_SECONDS);

  // A missing object surfaces here (row without its bytes). Report it as an
  // absent photo rather than a raw storage error.
  if (signError || !signed?.signedUrl) return fail("not_found");

  const byteSize = Number(row.byte_size);
  const width = Number(row.width);
  const height = Number(row.height);

  return {
    ok: true,
    data: {
      photoId: row.id as string,
      mimeType: typeof row.mime_type === "string" ? row.mime_type : "image/jpeg",
      byteSize: Number.isFinite(byteSize) && byteSize > 0 ? byteSize : 0,
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
      url: signed.signedUrl,
      expiresInSeconds: PHOTO_SIGNED_URL_TTL_SECONDS,
    },
  };
}
