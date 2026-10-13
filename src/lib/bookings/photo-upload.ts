/**
 * Public booking photo upload orchestration (Sprint 2C refinement).
 *
 * This module contains every decision the photo upload endpoint makes,
 * expressed as a pure function over injected dependencies — the same pattern
 * as `submission.ts`, so the acceptance cases run without a database or a
 * network.
 *
 * Order of checks (each one fails closed):
 *   1. origin/CSRF verification;
 *   2. the explicit activation gate;
 *   3. configuration (Supabase plus the elevated key);
 *   4. shared rate limiting (separate bucket from submissions);
 *   5. the upload token, which binds the request to one just-created booking;
 *   6. byte-level validation (count, size, magic-number type);
 *   7. the trusted store step: object upload plus the `booking_photos` row,
 *      with compensating cleanup when the row cannot be written.
 *
 * The token is minted by the submission response and proves the caller is the
 * browser that just created the booking; a reference alone is never an
 * authorisation credential. No storage key, bucket name or signed URL appears
 * in any response or log line.
 */

import type { RateLimitOutcome } from "@/lib/security/booking-rate-limit";
import type { OriginCheck } from "@/lib/security/request-origin";
import {
  photoErrorMessage,
  validatePhotoBatch,
  verifyPhotoUploadToken,
  type IncomingPhoto,
  type PhotoErrorCode,
  type ValidatedPhoto,
} from "./photos";

export type PhotoHttpResponse = {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

export type PhotoStoreResult =
  | { ok: true; stored: number }
  | { ok: false; code: PhotoErrorCode };

export type PhotoUploadDeps = {
  /** Explicit activation gate (`BOOKING_SUBMISSIONS_ENABLED`). */
  enabled: boolean;
  /** Supabase URL, elevated key and bucket are all available. */
  configured: boolean;
  rateLimiter: { consume(identity: string): Promise<RateLimitOutcome> } | null;
  /** Secret used to verify the upload token minted by the submission route. */
  tokenSecret: string | null;
  /**
   * Trusted persistence: verifies the booking still exists and is attachable,
   * counts existing photos, uploads each object under its content-derived key
   * and inserts the `booking_photos` rows, cleaning up any object whose row
   * could not be written. Never returns a storage key or a raw database error.
   */
  store(input: {
    bookingId: string;
    photos: ValidatedPhoto[];
  }): Promise<PhotoStoreResult>;
  now?: () => Date;
  log?: (event: {
    event: "booking_photo_upload";
    status: number;
    code?: string;
    correlationId: string;
    durationMs: number;
  }) => void;
};

export type PhotoUploadInput = {
  /** Multipart parts already bounded by the route's size ceiling. */
  files: readonly IncomingPhoto[];
  token: unknown;
  origin: OriginCheck;
  /** Opaque, hashed client identity for rate limiting. Never a raw address. */
  identity: string;
  correlationId: string;
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

function response(
  status: number,
  body: Record<string, unknown>,
): PhotoHttpResponse {
  return { status, body, headers: { ...NO_STORE } };
}

function failure(code: PhotoErrorCode, correlationId: string): PhotoHttpResponse {
  return response(422, {
    ok: false,
    code,
    message: photoErrorMessage(code),
    correlationId,
  });
}

export async function handlePhotoUpload(
  input: PhotoUploadInput,
  deps: PhotoUploadDeps,
): Promise<PhotoHttpResponse> {
  const started = Date.now();
  const finish = (res: PhotoHttpResponse): PhotoHttpResponse => {
    deps.log?.({
      event: "booking_photo_upload",
      status: res.status,
      code: typeof res.body.code === "string" ? res.body.code : undefined,
      correlationId: input.correlationId,
      durationMs: Date.now() - started,
    });
    return res;
  };

  // 1. Origin/CSRF.
  if (!input.origin.ok)
    return finish(
      response(403, {
        ok: false,
        code: "origin_rejected",
        message: "This request did not come from an approved origin.",
        correlationId: input.correlationId,
      }),
    );

  // 2. Activation gate.
  if (!deps.enabled)
    return finish(
      response(503, {
        ok: false,
        code: "submissions_disabled",
        message: "Photo attachment is not active on this deployment yet.",
        correlationId: input.correlationId,
      }),
    );

  // 3. Configuration.
  if (!deps.configured || !deps.tokenSecret)
    return finish(
      response(503, {
        ok: false,
        code: "not_configured",
        message: photoErrorMessage("not_configured"),
        correlationId: input.correlationId,
      }),
    );

  // 4. Shared rate limiting, separate bucket from submissions so photo retries
  //    cannot exhaust the booking allowance.
  if (!deps.rateLimiter)
    return finish(
      response(503, {
        ok: false,
        code: "not_configured",
        message: photoErrorMessage("not_configured"),
        correlationId: input.correlationId,
      }),
    );
  const decision = await deps.rateLimiter.consume(input.identity);
  if (decision.status === "unavailable")
    return finish(
      response(503, {
        ok: false,
        code: "rate_limit_unavailable",
        message: "Photo attachment is temporarily unavailable. Please try again shortly.",
        correlationId: input.correlationId,
      }),
    );
  if (decision.status === "limited")
    return finish({
      status: 429,
      headers: { ...NO_STORE, "Retry-After": String(decision.retryAfterSeconds) },
      body: {
        ok: false,
        code: "rate_limited",
        message: "Too many photo uploads have been attempted from this connection.",
        retryAfterSeconds: decision.retryAfterSeconds,
        correlationId: input.correlationId,
      },
    });

  // 5. Upload token: binds this request to one booking the trusted submission
  //    path just created. Expiry and signature are checked together.
  const nowMs = (deps.now?.() ?? new Date()).getTime();
  const session = verifyPhotoUploadToken(input.token, deps.tokenSecret, nowMs);
  if (!session) return finish(failure("invalid_upload_token", input.correlationId));

  // 6. Byte-level validation (count, size, magic numbers, duplicate collapse).
  const validation = validatePhotoBatch(0, session.bookingId, input.files);
  if (!validation.ok) return finish(failure(validation.code, input.correlationId));

  // 7. Trusted persistence under the verified booking.
  const stored = await deps.store({
    bookingId: session.bookingId,
    photos: validation.photos,
  });
  if (!stored.ok) return finish(failure(stored.code, input.correlationId));

  return finish(
    response(201, {
      ok: true,
      stored: stored.stored,
      message:
        stored.stored > 0
          ? "Your photos are attached to this request."
          : "These photos were already attached to this request.",
      correlationId: input.correlationId,
    }),
  );
}
