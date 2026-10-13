/**
 * Abuse protection for public booking submissions.
 *
 * The existing `rate-limit.ts` module is explicitly in-process and is not a
 * distributed guarantee. Public submissions are the one place where that is not
 * good enough, so this module provides a shared, database-backed limiter and
 * fails closed when no shared limiter is available.
 *
 * Two implementations:
 *   * `databaseBookingRateLimiter` — calls the trusted
 *     `public.booking_rate_limit_consume` function, so every server instance
 *     shares one counter. This is the production limiter.
 *   * `memoryBookingRateLimiter` — a per-process fallback for local development
 *     and automated tests only. It is never selected in production.
 *
 * The bucket identity is a hashed client address (see the submission route); no
 * raw IP address and no customer data is stored.
 */

import {
  createSupabaseAdminClient,
  SupabaseElevatedConfigError,
} from "@/lib/supabase/admin";
import { demoMode } from "@/lib/demo-mode";

export type RateLimitOutcome =
  | { status: "allowed"; remaining: number; limit: number }
  | { status: "limited"; retryAfterSeconds: number; limit: number }
  | { status: "unavailable" };

export type BookingRateLimiter = {
  readonly kind: "database" | "memory";
  consume(identity: string): Promise<RateLimitOutcome>;
};

/** Approved submission allowance: five attempts per address per 15 minutes. */
export const BOOKING_RATE_LIMIT = { limit: 5, windowSeconds: 15 * 60 } as const;

/**
 * Photo upload allowance, separate from submissions so attaching photos cannot
 * exhaust the booking allowance: ten batches per address per 15 minutes.
 */
export const BOOKING_PHOTO_RATE_LIMIT = { limit: 10, windowSeconds: 15 * 60 } as const;

export const RATE_LIMIT_MODE_VAR = "BOOKING_RATE_LIMIT_MODE";

/* -------------------------------------------------------------------------- */
/* Shared (database) limiter                                                   */
/* -------------------------------------------------------------------------- */

function databaseLimiter(
  scope: "submit" | "photos",
  limit: number,
  windowSeconds: number,
): BookingRateLimiter {
  return {
    kind: "database",
    async consume(identity: string): Promise<RateLimitOutcome> {
      if (typeof window !== "undefined")
        throw new Error("The database rate limiter is server-only.");

      let client;
      try {
        client = createSupabaseAdminClient();
      } catch (error) {
        if (error instanceof SupabaseElevatedConfigError) return { status: "unavailable" };
        return { status: "unavailable" };
      }

      const { data, error } = await client.rpc("booking_rate_limit_consume", {
        p_bucket: `booking:${scope}:${identity}`,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });

      if (error || !data || typeof data !== "object") return { status: "unavailable" };

      const result = data as {
        allowed?: unknown;
        remaining?: unknown;
        retry_after_seconds?: unknown;
      };

      if (result.allowed === true) {
        return {
          status: "allowed",
          remaining: Number(result.remaining ?? 0) || 0,
          limit,
        };
      }
      if (result.allowed === false) {
        return {
          status: "limited",
          retryAfterSeconds: Math.max(1, Math.ceil(Number(result.retry_after_seconds ?? 60) || 60)),
          limit,
        };
      }
      return { status: "unavailable" };
    },
  };
}

export const databaseBookingRateLimiter: BookingRateLimiter = databaseLimiter(
  "submit",
  BOOKING_RATE_LIMIT.limit,
  BOOKING_RATE_LIMIT.windowSeconds,
);

export const databaseBookingPhotoRateLimiter: BookingRateLimiter = databaseLimiter(
  "photos",
  BOOKING_PHOTO_RATE_LIMIT.limit,
  BOOKING_PHOTO_RATE_LIMIT.windowSeconds,
);

/* -------------------------------------------------------------------------- */
/* In-process fallback (development and tests only)                            */
/* -------------------------------------------------------------------------- */

type Bucket = { timestamps: number[] };
const buckets = new Map<string, Bucket>();

/** Test seam: clears the in-process buckets. */
export function resetBookingRateLimits(): void {
  buckets.clear();
}

function memoryLimiter(
  scope: "submit" | "photos",
  limit: number,
  windowSeconds: number,
): BookingRateLimiter {
  return {
    kind: "memory",
    async consume(identity: string): Promise<RateLimitOutcome> {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const key = `${scope}:${identity}`;
      const bucket = buckets.get(key) ?? { timestamps: [] };
      const recent = bucket.timestamps.filter((at) => at > now - windowMs);

      if (recent.length >= limit) {
        buckets.set(key, { timestamps: recent });
        const oldest = recent[0] ?? now;
        return {
          status: "limited",
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
          limit,
        };
      }

      recent.push(now);
      buckets.set(key, { timestamps: recent });
      return {
        status: "allowed",
        remaining: limit - recent.length,
        limit,
      };
    },
  };
}

export const memoryBookingRateLimiter: BookingRateLimiter = memoryLimiter(
  "submit",
  BOOKING_RATE_LIMIT.limit,
  BOOKING_RATE_LIMIT.windowSeconds,
);

export const memoryBookingPhotoRateLimiter: BookingRateLimiter = memoryLimiter(
  "photos",
  BOOKING_PHOTO_RATE_LIMIT.limit,
  BOOKING_PHOTO_RATE_LIMIT.windowSeconds,
);

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Chooses a limiter for this deployment.
 *
 * `BOOKING_RATE_LIMIT_MODE` can force a mode:
 *   * `memory` — local development and tests only;
 *   * `database` — the shared production limiter.
 *
 * Without the override, the shared limiter is used outside demo mode, and the
 * in-process limiter is used in demo mode (which never reaches this route).
 * There is no configuration that silently falls back to in-process limiting in
 * production: if the shared limiter is unavailable the caller receives
 * `unavailable` and the route fails closed.
 */
export function resolveBookingRateLimiter(): BookingRateLimiter {
  const mode = (process.env[RATE_LIMIT_MODE_VAR] ?? "").trim().toLowerCase();
  if (mode === "memory") return memoryBookingRateLimiter;
  if (mode === "database") return databaseBookingRateLimiter;
  return demoMode ? memoryBookingRateLimiter : databaseBookingRateLimiter;
}

/** Photo uploads use the same mode selection with their own allowance. */
export function resolveBookingPhotoRateLimiter(): BookingRateLimiter {
  const mode = (process.env[RATE_LIMIT_MODE_VAR] ?? "").trim().toLowerCase();
  if (mode === "memory") return memoryBookingPhotoRateLimiter;
  if (mode === "database") return databaseBookingPhotoRateLimiter;
  return demoMode ? memoryBookingPhotoRateLimiter : databaseBookingPhotoRateLimiter;
}
