import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { handlePhotoUpload, type PhotoStoreResult } from "@/lib/bookings/photo-upload";
import { bookingSubmissionsEnabled } from "@/lib/bookings/config";
import {
  BOOKING_PHOTOS_BUCKET,
  type IncomingPhoto,
  type ValidatedPhoto,
} from "@/lib/bookings/photos";
import {
  createSupabaseAdminClient,
  isElevatedConfigured,
  SupabaseElevatedConfigError,
} from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  resolveBookingPhotoRateLimiter,
} from "@/lib/security/booking-rate-limit";
import { checkRequestOrigin } from "@/lib/security/request-origin";

/**
 * Public booking photo upload endpoint (Sprint 2C refinement).
 *
 * An adapter only: it bounds the request, reads the multipart parts, resolves
 * an opaque client identity and delegates every decision to
 * `handlePhotoUpload`. Persistence runs through the server-only elevated
 * client, which is the one path allowed to write `booking_photos` (the table
 * has no insert policy for any client role) and to upload into the private
 * bucket (which has no storage policies at all).
 *
 * The request must carry the upload token minted by the booking submission
 * response; that token — never a bare reference — is what binds these bytes to
 * one booking. Nothing here returns or logs a storage key, bucket name or
 * signed URL.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Three 5MB photos plus multipart framing stays well under this ceiling. */
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 12; // generous framing bound; the validator enforces the real cap of 3

function reject(
  status: number,
  code: string,
  message: string,
  correlationId: string,
) {
  return NextResponse.json(
    { ok: false, code, message, correlationId },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function hashedIdentity(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const address =
    forwarded.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  return createHash("sha256").update(address).digest("hex").slice(0, 32);
}

async function storeBookingPhotos({
  bookingId,
  photos,
}: {
  bookingId: string;
  photos: readonly ValidatedPhoto[];
}): Promise<PhotoStoreResult> {
  let client;
  try {
    client = createSupabaseAdminClient();
  } catch (error) {
    return {
      ok: false,
      code: error instanceof SupabaseElevatedConfigError ? "not_configured" : "upload_failed",
    };
  }

  // The booking must exist and still be attachable (pending); a reference or a
  // stale token grants nothing once the request has moved on.
  const { data: booking, error: bookingError } = await client
    .from("bookings")
    .select("id, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingError || !booking) return { ok: false, code: "invalid_upload_token" };
  if (booking.status !== "pending") return { ok: false, code: "invalid_upload_token" };

  // Enforce the per-booking cap across retries and parallel tabs.
  const { count, error: countError } = await client
    .from("booking_photos")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", bookingId);
  if (countError) return { ok: false, code: "upload_failed" };
  const existing = typeof count === "number" ? count : 0;
  if (existing + photos.length > 3) return { ok: false, code: "too_many_photos" };

  const uploadedKeys: string[] = [];
  for (const photo of photos) {
    const { error } = await client.storage
      .from(BOOKING_PHOTOS_BUCKET)
      .upload(photo.storageKey, photo.bytes, {
        contentType: photo.mime,
        upsert: false,
      });
    // A duplicate key means these exact bytes are already stored for this
    // booking; treat it as idempotent success rather than an error.
    if (error && !/exists|duplicate/i.test(error.message ?? "")) {
      await cleanup(client, uploadedKeys);
      return { ok: false, code: "upload_failed" };
    }
    uploadedKeys.push(photo.storageKey);
  }

  const rows = photos.map((photo) => ({
    booking_id: bookingId,
    storage_key: photo.storageKey,
    mime_type: photo.mime,
    byte_size: photo.byteSize,
    width: photo.width,
    height: photo.height,
    processing_state: "available",
  }));

  const { error: insertError } = await client.from("booking_photos").insert(rows);
  if (insertError) {
    // Compensating cleanup: never leave an orphan object with no metadata row.
    await cleanup(client, uploadedKeys);
    return { ok: false, code: "upload_failed" };
  }

  return { ok: true, stored: rows.length };
}

async function cleanup(
  client: ReturnType<typeof createSupabaseAdminClient>,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  try {
    await client.storage.from(BOOKING_PHOTOS_BUCKET).remove(keys);
  } catch {
    // Best effort; the retention job and the unique key prevent lasting harm.
  }
}

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("multipart/form-data"))
    return reject(415, "unsupported_media_type", "Send the photos as multipart form data.", correlationId);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
    return reject(413, "payload_too_large", "The upload is too large.", correlationId);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reject(400, "malformed_form", "The upload could not be read.", correlationId);
  }

  const token = form.get("token");
  const rawFiles = form
    .getAll("photos")
    .filter((entry): entry is File => typeof entry === "object" && entry !== null && "arrayBuffer" in entry);
  if (rawFiles.length > MAX_FILES)
    return reject(413, "payload_too_large", "The upload is too large.", correlationId);

  const files: IncomingPhoto[] = [];
  for (const file of rawFiles) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    files.push({ bytes: buffer, declaredType: file.type, name: file.name });
  }

  const origin = checkRequestOrigin({
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL,
  });

  const response = await handlePhotoUpload(
    {
      files,
      token,
      origin,
      identity: hashedIdentity(request),
      correlationId,
    },
    {
      enabled: bookingSubmissionsEnabled,
      configured: isSupabaseConfigured && isElevatedConfigured,
      rateLimiter: resolveBookingPhotoRateLimiter(),
      // The elevated key signs the upload token; it never leaves the server.
      tokenSecret: isElevatedConfigured ? process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null : null,
      store: storeBookingPhotos,
      log: (event) => {
        if (event.status >= 400)
          console.warn(
            `[bookings] photo upload rejected status=${event.status} code=${event.code ?? "unknown"} correlation=${event.correlationId}`,
          );
      },
    },
  );

  return NextResponse.json(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
