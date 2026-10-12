import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { handleBookingSubmission } from "@/lib/bookings/submission";
import { bookingSubmissionsEnabled } from "@/lib/bookings/config";
import { loadBookingCatalogue } from "@/lib/bookings/catalogue";
import { submitPublicBooking } from "@/lib/bookings/repository";
import { isElevatedConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { resolveBookingRateLimiter } from "@/lib/security/booking-rate-limit";
import { checkRequestOrigin } from "@/lib/security/request-origin";

/**
 * Public booking submission endpoint.
 *
 * This handler is an adapter only: it reads the request, establishes the origin
 * and an opaque client identity, builds the real dependencies and delegates every
 * decision to `handleBookingSubmission`. Authorisation, validation and the
 * database write all happen behind the server-only elevated client; nothing here
 * is reachable from the browser, and no GET/list/lookup is exposed.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Upper bound on a submission body; the largest legitimate payload is well under. */
const MAX_BODY_BYTES = 32 * 1024;
const NO_STORE = { "Cache-Control": "no-store" } as const;
const IDEMPOTENCY_HEADER = "idempotency-key";

function reject(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(
    { ok: false, code, message, correlationId },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

/** Hashes the client address so no raw IP is ever stored or logged. */
function hashedIdentity(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const address =
    forwarded.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  return createHash("sha256").update(address).digest("hex").slice(0, 32);
}

function resolveIdempotencyKey(body: unknown, request: NextRequest): string | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>).idempotencyKey;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const header = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
  return header || null;
}

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json"))
    return reject(415, "unsupported_media_type", "Send the request as JSON.", correlationId);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
    return reject(413, "payload_too_large", "The submission is too large.", correlationId);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    return reject(413, "payload_too_large", "The submission is too large.", correlationId);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reject(400, "malformed_json", "The submission could not be read.", correlationId);
  }

  const origin = checkRequestOrigin({
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL,
  });

  const configured = isSupabaseConfigured && isElevatedConfigured;
  const catalogue = configured ? await loadBookingCatalogue() : null;

  const response = await handleBookingSubmission(
    {
      body,
      idempotencyKey: resolveIdempotencyKey(body, request),
      origin,
      identity: hashedIdentity(request),
      correlationId,
    },
    {
      enabled: bookingSubmissionsEnabled,
      configured: configured && Array.isArray(catalogue),
      catalogue,
      rateLimiter: resolveBookingRateLimiter(),
      submit: (input) => submitPublicBooking(input),
      log: (event) => {
        // Operational diagnosis only: status, stable code and correlation id.
        // Never a name, phone number, email address or pickup address.
        if (event.status >= 400)
          console.warn(
            `[bookings] submission rejected status=${event.status} code=${event.code ?? "unknown"} correlation=${event.correlationId}`,
          );
      },
    },
  );

  return NextResponse.json(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function GET() {
  return NextResponse.json(
    { ok: false, code: "method_not_allowed", message: "Use POST to submit a booking request." },
    { status: 405, headers: { ...NO_STORE, Allow: "POST" } },
  );
}
