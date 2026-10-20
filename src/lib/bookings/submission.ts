/**
 * Public booking submission orchestration.
 *
 * This module contains every decision the submission endpoint makes, expressed as
 * a pure function over injected dependencies. The route handler in
 * `src/app/api/bookings/route.ts` is a thin adapter that reads the request and
 * supplies real dependencies; tests exercise this function with mocks, so the
 * acceptance cases run without a database or network.
 *
 * Order of checks (each one fails closed):
 *   1. origin/CSRF verification;
 *   2. the explicit activation gate;
 *   3. configuration and the active catalogue;
 *   4. shared rate limiting;
 *   5. idempotency key;
 *   6. full payload validation (including scheduling and express eligibility);
 *   7. the trusted database submission.
 *
 * Customer personal data is never echoed in a response or a log line.
 */

import {
  bookingErrorMessage,
  bookingErrorStatus,
  type BookingErrorCode,
} from "./errors";
import {
  createPhotoUploadToken,
  PHOTO_UPLOAD_TOKEN_TTL_SECONDS,
} from "./photos";
import { isValidIdempotencyKey } from "./reference";
import {
  selectedServiceSlugs,
  toBookingSubmitPayload,
  validatePublicBookingRequest,
} from "./validation";
import type {
  BookingSubmitPayload,
  BookingSubmitResult,
  CatalogueService,
} from "./types";
import type { RateLimitOutcome } from "@/lib/security/booking-rate-limit";
import type { OriginCheck } from "@/lib/security/request-origin";

export type BookingHttpResponse = {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

export type BookingSubmitCall = (input: {
  payload: BookingSubmitPayload;
  services: string[];
  idempotencyKey: string;
  correlationId: string;
}) => Promise<
  { ok: true; data: BookingSubmitResult } | { ok: false; code: BookingErrorCode }
>;

export type BookingLogEvent = {
  event: "booking_submission";
  correlationId: string;
  status: number;
  code?: string;
  identity?: string;
  durationMs: number;
};

export type BookingSubmissionDeps = {
  /** Explicit activation gate (`BOOKING_SUBMISSIONS_ENABLED`). */
  enabled: boolean;
  /** Supabase URL, elevated key and the active catalogue are all available. */
  configured: boolean;
  catalogue: readonly CatalogueService[] | null;
  rateLimiter: { consume(identity: string): Promise<RateLimitOutcome> } | null;
  submit: BookingSubmitCall;
  /**
   * Mints the short-lived photo upload token returned alongside a successful
   * reference, so the same browser can attach photos to the booking it just
   * created. A `null` secret disables photo attachment without affecting the
   * booking itself (SRS AT-14: an unpictured booking is still valid).
   */
  photoTokenSecret?: string | null;
  /**
   * Server-approved privacy-notice version stored with the booking. Supplied by
   * the route from trusted configuration, never from request JSON.
   */
  noticeVersion?: string | null;
  now?: () => Date;
  log?: (event: BookingLogEvent) => void;
};

export type BookingSubmissionInput = {
  /** Parsed JSON request body; validated before use. */
  body: unknown;
  /** Resolved idempotency key (body field or `Idempotency-Key` header). */
  idempotencyKey: string | null;
  origin: OriginCheck;
  /** Opaque, hashed client identity for rate limiting. Never a raw address. */
  identity: string;
  correlationId: string;
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

const CONFIRMATION_MESSAGE =
  "Your pickup request has been received and is pending. The team will contact you to confirm the arrangements.";

export async function handleBookingSubmission(
  input: BookingSubmissionInput,
  deps: BookingSubmissionDeps,
): Promise<BookingHttpResponse> {
  const started = Date.now();
  const finish = (response: BookingHttpResponse): BookingHttpResponse => {
    deps.log?.({
      event: "booking_submission",
      correlationId: input.correlationId,
      status: response.status,
      code: typeof response.body.code === "string" ? response.body.code : undefined,
      identity: input.identity,
      durationMs: Date.now() - started,
    });
    return response;
  };

  // 1. Origin/CSRF.
  if (!input.origin.ok)
    return finish({
      status: 403,
      headers: { ...NO_STORE },
      body: {
        ok: false,
        code: "origin_rejected",
        message: "This request did not come from an approved origin.",
        correlationId: input.correlationId,
      },
    });

  // 2. Activation gate.
  if (!deps.enabled)
    return finish({
      status: 503,
      headers: { ...NO_STORE },
      body: {
        ok: false,
        code: "submissions_disabled",
        message: "Online pickup requests are not active on this deployment yet. Please contact the team directly.",
        correlationId: input.correlationId,
      },
    });

  // 3. Configuration.
  if (!deps.configured || !deps.catalogue || deps.catalogue.length === 0 || !deps.rateLimiter)
    return finish({
      status: 503,
      headers: { ...NO_STORE },
      body: {
        ok: false,
        code: "not_configured",
        message: bookingErrorMessage("not_configured"),
        correlationId: input.correlationId,
      },
    });

  // 4. Shared rate limiting.
  const decision = await deps.rateLimiter.consume(input.identity);
  if (decision.status === "unavailable")
    return finish({
      status: 503,
      headers: { ...NO_STORE },
      body: {
        ok: false,
        code: "rate_limit_unavailable",
        message: "Online pickup requests are temporarily unavailable. Please try again shortly.",
        correlationId: input.correlationId,
      },
    });
  if (decision.status === "limited")
    return finish({
      status: 429,
      headers: {
        ...NO_STORE,
        "Retry-After": String(decision.retryAfterSeconds),
      },
      body: {
        ok: false,
        code: "rate_limited",
        message: "Too many pickup requests have been submitted from this connection. Please wait a few minutes and try again.",
        retryAfterSeconds: decision.retryAfterSeconds,
        correlationId: input.correlationId,
      },
    });

  // 5. Idempotency.
  if (!isValidIdempotencyKey(input.idempotencyKey))
    return finish({
      status: 422,
      headers: { ...NO_STORE },
      body: {
        ok: false,
        code: "idempotency_required",
        message: bookingErrorMessage("idempotency_required"),
        correlationId: input.correlationId,
      },
    });

  // 6. Validation (includes scheduling and express eligibility).
  const now = deps.now?.() ?? new Date();
  const validation = validatePublicBookingRequest(input.body, {
    services: deps.catalogue,
    now,
  });
  if (!validation.ok)
    return finish({
      status: 422,
      headers: { ...NO_STORE },
      body: {
        ok: false,
        code: validation.code,
        message: bookingErrorMessage(validation.code),
        fieldErrors: validation.fieldErrors,
        correlationId: input.correlationId,
      },
    });

  // 7. Trusted submission.
  const submission = await deps.submit({
    payload: toBookingSubmitPayload(validation.value, deps.noticeVersion ?? null),
    services: selectedServiceSlugs(validation.value),
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  });

  if (!submission.ok)
    return finish({
      status: bookingErrorStatus(submission.code),
      headers: { ...NO_STORE },
      body: {
        ok: false,
        code: submission.code,
        message: bookingErrorMessage(submission.code),
        correlationId: input.correlationId,
      },
    });

  // A replayed submission returns the original token-less body: the booking
  // already exists and its upload window may well have closed.
  const photoToken =
    !submission.data.replayed && deps.photoTokenSecret
      ? createPhotoUploadToken(submission.data.bookingId, deps.photoTokenSecret)
      : null;

  return finish({
    status: submission.data.replayed ? 200 : 201,
    headers: { ...NO_STORE },
    body: {
      ok: true,
      reference: submission.data.reference,
      status: submission.data.status,
      replayed: submission.data.replayed,
      message: CONFIRMATION_MESSAGE,
      ...(photoToken
        ? {
            photoUploadToken: photoToken,
            photoUploadExpiresInSeconds: PHOTO_UPLOAD_TOKEN_TTL_SECONDS,
          }
        : {}),
      correlationId: input.correlationId,
    },
  });
}
