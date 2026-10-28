import {
    createSupabaseAdminClient,
    SupabaseElevatedConfigError,
} from "@/lib/supabase/admin";
import { demoMode } from "@/lib/demo-mode";
import type { RateLimitOutcome } from "@/lib/security/booking-rate-limit";
import { NEWSLETTER_RATE_LIMIT_MODE_VAR } from "./config";

/** Same tiers as review submissions: one connection cannot flood the queue. */
export const NEWSLETTER_IP_RATE_LIMIT = { limit: 5, windowSeconds: 60 * 60 } as const;
export const NEWSLETTER_GLOBAL_RATE_LIMIT = { limit: 100, windowSeconds: 60 * 60 } as const;

export type NewsletterRateLimiter = {
    consume(identity: string): Promise<RateLimitOutcome>;
};

async function consumeBucket(
    bucket: string,
    limit: number,
    windowSeconds: number,
): Promise<RateLimitOutcome> {
    if (typeof window !== "undefined") throw new Error("Newsletter rate limiting is server-only.");
    let client;
    try {
        client = createSupabaseAdminClient();
    } catch (error) {
        if (error instanceof SupabaseElevatedConfigError) return { status: "unavailable" };
        return { status: "unavailable" };
    }

    const { data, error } = await client.rpc("booking_rate_limit_consume", {
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
    });
    if (error || !data || typeof data !== "object") return { status: "unavailable" };
    const result = data as { allowed?: unknown; retry_after_seconds?: unknown };
    if (result.allowed === true)
        return { status: "allowed", remaining: 0, limit };
    if (result.allowed === false)
        return {
            status: "limited",
            retryAfterSeconds: Math.max(1, Math.ceil(Number(result.retry_after_seconds) || 60)),
            limit,
        };
    return { status: "unavailable" };
}

export const databaseNewsletterRateLimiter: NewsletterRateLimiter = {
    async consume(identity) {
        const perIdentity = await consumeBucket(
            `newsletter:submit:${identity}`,
            NEWSLETTER_IP_RATE_LIMIT.limit,
            NEWSLETTER_IP_RATE_LIMIT.windowSeconds,
        );
        if (perIdentity.status !== "allowed") return perIdentity;
        return consumeBucket(
            "newsletter:global",
            NEWSLETTER_GLOBAL_RATE_LIMIT.limit,
            NEWSLETTER_GLOBAL_RATE_LIMIT.windowSeconds,
        );
    },
};

const buckets = new Map<string, number[]>();
export function resetNewsletterRateLimits() {
    buckets.clear();
}

function consumeMemoryBucket(key: string, limit: number, windowSeconds: number): RateLimitOutcome {
    const now = Date.now();
    const recent = (buckets.get(key) ?? []).filter((timestamp) => timestamp > now - windowSeconds * 1000);
    if (recent.length >= limit) {
        buckets.set(key, recent);
        return {
            status: "limited",
            retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowSeconds * 1000 - now) / 1000)),
            limit,
        };
    }
    recent.push(now);
    buckets.set(key, recent);
    return { status: "allowed", remaining: limit - recent.length, limit };
}

export const memoryNewsletterRateLimiter: NewsletterRateLimiter = {
    async consume(identity) {
        const perIdentity = consumeMemoryBucket(`newsletter:submit:${identity}`, NEWSLETTER_IP_RATE_LIMIT.limit, NEWSLETTER_IP_RATE_LIMIT.windowSeconds);
        if (perIdentity.status !== "allowed") return perIdentity;
        return consumeMemoryBucket("newsletter:global", NEWSLETTER_GLOBAL_RATE_LIMIT.limit, NEWSLETTER_GLOBAL_RATE_LIMIT.windowSeconds);
    },
};

export function resolveNewsletterRateLimiter(): NewsletterRateLimiter {
    const mode = (process.env[NEWSLETTER_RATE_LIMIT_MODE_VAR] ?? "").trim().toLowerCase();
    if (mode === "memory" && process.env.NODE_ENV !== "production") return memoryNewsletterRateLimiter;
    return demoMode && mode !== "database" ? memoryNewsletterRateLimiter : databaseNewsletterRateLimiter;
}
