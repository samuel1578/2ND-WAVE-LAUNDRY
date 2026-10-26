/**
 * Small in-process rate limiter for privileged administrative operations.
 *
 * Scope and honesty:
 * - This is defence in depth, not a distributed guarantee. State lives in the
 *   process, so on a serverless platform each instance keeps its own counters and
 *   a determined attacker spread across instances would see a larger effective
 *   limit. Persistent, shared limiting belongs in the Phase 2 infrastructure work
 *   (a database table or an edge rate limiter).
 * - It exists so a compromised or scripted administrator session cannot hammer
 *   staff management (and, through it, the Supabase Auth invite endpoint).
 * - Counters expire with their window, and the store is pruned on write, so it
 *   cannot grow without bound.
 */

export type RateLimitRule = {
  /** Maximum number of attempts allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number };

/** Deliberately conservative limits for staff administration. */
export const staffRateLimits = {
  invite: { limit: 10, windowMs: 15 * 60 * 1000 },
  change: { limit: 30, windowMs: 15 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Limits for administrative booking operations. Keyed separately from the staff
 * limits so a busy booking queue can never exhaust a staff administrator's own
 * allowance (the bucket key is the limit key plus the acting account).
 */
export const bookingRateLimits = {
  booking_mutation: { limit: 120, windowMs: 15 * 60 * 1000 },
  email_retry: { limit: 10, windowMs: 15 * 60 * 1000 },
  email_send: { limit: 10, windowMs: 15 * 60 * 1000 },
  // Order alert recipient management. Bounds a scripted Full Admin session
  // without getting in the way of ordinary settings edits.
  alert_recipients: { limit: 60, windowMs: 15 * 60 * 1000 },
  // Review moderation/publication. Bounds a scripted administrator session while
  // leaving ordinary queue work and publication edits untouched.
  review_mutation: { limit: 120, windowMs: 15 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

/** Every administrative limit the limiter knows about. */
export const adminRateLimits = {
  ...staffRateLimits,
  ...bookingRateLimits,
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitKey = keyof typeof adminRateLimits;

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

/** Test seam: clears all counters. */
export function resetRateLimits(): void {
  buckets.clear();
}

export function consumeRateLimit(
  limitKey: RateLimitKey,
  identity: string,
  now: number = Date.now(),
): RateLimitResult {
  const rule = adminRateLimits[limitKey];
  const key = `${limitKey}:${identity}`;
  const bucket = buckets.get(key) ?? { timestamps: [] };
  const cutoff = now - rule.windowMs;
  const recent = bucket.timestamps.filter((at) => at > cutoff);

  if (recent.length >= rule.limit) {
    buckets.set(key, { timestamps: recent });
    const oldest = recent[0] ?? now;
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldest + rule.windowMs - now) / 1000),
      ),
    };
  }

  recent.push(now);
  buckets.set(key, { timestamps: recent });
  prune(now);
  return { ok: true, remaining: rule.limit - recent.length };
}

/** Drops buckets that have fully expired, keeping the map bounded. */
function prune(now: number): void {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    const rule = adminRateLimits[key.split(":")[0] as RateLimitKey];
    if (!rule) {
      buckets.delete(key);
      continue;
    }
    bucket.timestamps = bucket.timestamps.filter(
      (at) => at > now - rule.windowMs,
    );
    if (bucket.timestamps.length === 0) buckets.delete(key);
  }
}
