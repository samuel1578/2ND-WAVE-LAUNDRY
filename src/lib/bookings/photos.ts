/**
 * Booking photo validation, identity and upload tokens (Sprint 2C refinement).
 *
 * Framework-free and side-effect free so every rule the public upload endpoint
 * enforces is unit tested without a network or a database. The rules mirror the
 * CHECK constraints on `public.booking_photos` and the SRS PHOTO-01 contract:
 * at most three private JPEG/PNG/WebP photos, each at most 5,000,000 bytes,
 * 15,000,000 bytes in total.
 *
 * Trust model: the browser's declared MIME type and filename are hints only.
 * The accepted type is decided by sniffing the actual bytes (magic numbers),
 * and the storage key is derived from the content hash, so a caller can never
 * choose a bucket, a path or a duplicate object.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** The one private bucket registered by the storage migration. */
export const BOOKING_PHOTOS_BUCKET = "booking-photos";

/** Retention and count limits; kept in lockstep with the database constraints. */
export const PHOTO_LIMITS = {
  maxPerBooking: 3,
  maxBytes: 5_000_000,
  maxTotalBytes: 15_000_000,
} as const;

/** Signed URLs for admin image access are short-lived bearer credentials. */
export const PHOTO_SIGNED_URL_TTL_SECONDS = 600;
/** Upload tokens bind a just-created booking to its photo upload session. */
export const PHOTO_UPLOAD_TOKEN_TTL_SECONDS = 3600;

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";

export type PhotoErrorCode =
  | "invalid_upload_token"
  | "too_many_photos"
  | "photo_too_large"
  | "unsupported_photo_type"
  | "upload_failed"
  | "storage_unavailable"
  | "not_configured";

export const PHOTO_ERROR_MESSAGES: Record<PhotoErrorCode, string> = {
  invalid_upload_token:
    "This photo upload session is no longer valid. Submit the booking form again to attach photos.",
  too_many_photos: `A booking can include at most ${PHOTO_LIMITS.maxPerBooking} photos.`,
  photo_too_large: `Each photo must be ${Math.floor(PHOTO_LIMITS.maxBytes / 1_000_000)}MB or smaller.`,
  unsupported_photo_type: "Choose a JPEG, PNG or WebP image.",
  upload_failed: "The photos could not be attached. Your booking request is still saved.",
  storage_unavailable: "Photo attachment is temporarily unavailable. Your booking request is still saved.",
  not_configured: "Photo attachment is not configured for this environment.",
};

export function photoErrorMessage(code: PhotoErrorCode): string {
  return PHOTO_ERROR_MESSAGES[code];
}

/* -------------------------------------------------------------------------- */
/* Byte-level type detection and dimensions                                   */
/* -------------------------------------------------------------------------- */

/**
 * Decides the accepted type from the file's actual leading bytes.
 *
 * JPEG starts FF D8 FF; PNG with its 8-byte signature; WebP is a RIFF container
 * whose form type at offset 8 is `WEBP`. Anything else — including SVG, HTML
 * and executables, which browsers happily label `image/svg+xml` — is refused.
 */
export function detectPhotoMime(bytes: Uint8Array): PhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  )
    return "image/webp";
  return null;
}

const readU32BE = (b: Uint8Array, offset: number): number =>
  ((b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3]) >>> 0;

const readU16BE = (b: Uint8Array, offset: number): number =>
  (b[offset] << 8) | b[offset + 1];

export type PhotoDimensions = { width: number; height: number };

/**
 * Extracts the intrinsic pixel size from the header, or `null` when the header
 * is malformed. The database columns are nullable and the interface always
 * falls back to the rendered size, so a parse failure is never fatal.
 */
export function readPhotoDimensions(
  bytes: Uint8Array,
  mime: PhotoMime,
): PhotoDimensions | null {
  try {
    if (mime === "image/png") {
      // 8-byte signature, 4-byte length, `IHDR`, then width/height as u32 BE.
      if (bytes.length < 24) return null;
      if (
        bytes[12] !== 0x49 ||
        bytes[13] !== 0x48 ||
        bytes[14] !== 0x44 ||
        bytes[15] !== 0x52
      )
        return null;
      const width = readU32BE(bytes, 16);
      const height = readU32BE(bytes, 20);
      return width > 0 && height > 0 ? { width, height } : null;
    }

    if (mime === "image/jpeg") {
      // Walk the segment chain to the first Start-Of-Frame marker.
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        const marker = bytes[offset + 1];
        // SOF0–SOF15 excluding DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = readU16BE(bytes, offset + 5);
          const width = readU16BE(bytes, offset + 7);
          return width > 0 && height > 0 ? { width, height } : null;
        }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
          offset += 2;
          continue;
        }
        const length = readU16BE(bytes, offset + 2);
        if (length < 2) return null;
        offset += 2 + length;
      }
      return null;
    }

    // WebP: RIFF size (4), `WEBP` (4), then a VP8X, VP8 or VP8L chunk.
    if (bytes.length < 30) return null;
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = readU16BE(bytes, 26) & 0x3fff;
      const height = readU16BE(bytes, 28) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const packed =
        bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      const width = (packed & 0x3fff) + 1;
      const height = ((packed >>> 14) & 0x3fff) + 1;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    return null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Content identity                                                           */
/* -------------------------------------------------------------------------- */

/** Lower-case hex SHA-256 of the file's bytes; the object's content identity. */
export function photoContentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const EXTENSION: Record<PhotoMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * The deterministic object key for a photo. Derived from the booking and the
 * content hash only — never from a client-supplied name — so re-uploading the
 * same bytes targets the same object and cannot create duplicates or traverse
 * paths. The `storage_key` UNIQUE constraint backs this up at the database.
 */
export function bookingPhotoStorageKey(
  bookingId: string,
  hash: string,
  mime: PhotoMime,
): string {
  return `bookings/${bookingId}/${hash}.${EXTENSION[mime]}`;
}

/* -------------------------------------------------------------------------- */
/* Upload tokens                                                              */
/* -------------------------------------------------------------------------- */

export type PhotoUploadToken = { bookingId: string; expiresAtMs: number };

const TOKEN_VERSION = "v1";

/**
 * Mints a short-lived, single-purpose upload token for a booking that the
 * trusted submission path just created. The token carries no customer data and
 * grants nothing beyond attaching photos to that one booking while it lasts.
 */
export function createPhotoUploadToken(
  bookingId: string,
  secret: string,
  nowMs: number = Date.now(),
): string {
  const expires = Math.floor(nowMs / 1000) + PHOTO_UPLOAD_TOKEN_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${bookingId}.${expires}`;
  const mac = createHmac("sha256", secret).update(payload).digest();
  return `${payload}.${mac.subarray(0, 16).toString("base64url")}`;
}

/** Verifies a token's signature and expiry; any tampering resolves to `null`. */
export function verifyPhotoUploadToken(
  token: unknown,
  secret: string,
  nowMs: number = Date.now(),
): PhotoUploadToken | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, bookingId, expiryRaw, macRaw] = parts;
  if (version !== TOKEN_VERSION) return null;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
  const expiresAt = Number(expiryRaw);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= nowMs) return null;

  const expected = createHmac("sha256", secret)
    .update(`${version}.${bookingId}.${expiresAt}`)
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(macRaw, "base64url");
  } catch {
    return null;
  }
  const expectedMac = expected.subarray(0, 16);
  if (provided.length !== expectedMac.length) return null;
  if (!timingSafeEqual(provided, expectedMac)) return null;
  return { bookingId, expiresAtMs: expiresAt * 1000 };
}

/* -------------------------------------------------------------------------- */
/* Batch validation                                                           */
/* -------------------------------------------------------------------------- */

export type IncomingPhoto = {
  bytes: Uint8Array;
  /** Browser-declared type; a hint only, never the accept decision. */
  declaredType: string;
  /** Browser-supplied name; used for nothing except being ignored safely. */
  name: string;
};

export type ValidatedPhoto = {
  bytes: Uint8Array;
  mime: PhotoMime;
  byteSize: number;
  width: number | null;
  height: number | null;
  hash: string;
  storageKey: string;
};

export type PhotoBatchResult =
  | { ok: true; photos: ValidatedPhoto[] }
  | { ok: false; code: PhotoErrorCode };

/**
 * Validates one upload batch against the retention-era limits.
 *
 * `existingCount` is how many photos the booking already has, so the per-booking
 * cap holds across retries. Byte content decides the type; identical bytes
 * inside one batch are collapsed so a double-selected file cannot duplicate.
 */
export function validatePhotoBatch(
  existingCount: number,
  bookingId: string,
  files: readonly IncomingPhoto[],
): PhotoBatchResult {
  if (files.length === 0) return { ok: false, code: "too_many_photos" };
  if (
    !Number.isInteger(existingCount) ||
    existingCount < 0 ||
    existingCount + files.length > PHOTO_LIMITS.maxPerBooking
  )
    return { ok: false, code: "too_many_photos" };

  const photos: ValidatedPhoto[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const file of files) {
    const byteSize = file.bytes.byteLength;
    if (byteSize === 0 || byteSize > PHOTO_LIMITS.maxBytes)
      return { ok: false, code: "photo_too_large" };
    total += byteSize;
    if (total > PHOTO_LIMITS.maxTotalBytes) return { ok: false, code: "photo_too_large" };

    const mime = detectPhotoMime(file.bytes);
    if (!mime) return { ok: false, code: "unsupported_photo_type" };

    const hash = photoContentHash(file.bytes);
    if (seen.has(hash)) continue;
    seen.add(hash);

    const dimensions = readPhotoDimensions(file.bytes, mime);
    photos.push({
      bytes: file.bytes,
      mime,
      byteSize,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      hash,
      storageKey: bookingPhotoStorageKey(bookingId, hash, mime),
    });
  }

  if (photos.length === 0) return { ok: false, code: "too_many_photos" };
  if (existingCount + photos.length > PHOTO_LIMITS.maxPerBooking)
    return { ok: false, code: "too_many_photos" };
  return { ok: true, photos };
}
