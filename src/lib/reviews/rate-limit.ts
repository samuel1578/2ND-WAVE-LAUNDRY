import {
    createSupabaseAdminClient,
    SupabaseElevatedConfigError,
} from "@/lib/supabase/admin";
import { demoMode } from "@/lib/demo-mode";
import type { RateLimitOutcome } from "@/lib/security/booking-rate-limit";
import { REVIEW_RATE_LIMIT_MODE_VAR } from "./config";

export const REVIEW_IP_RATE_LIMIT = { limit: 5, windowSeconds: 60 * 60 } as const;
export const REVIEW_GLOBAL_RATE_LIMIT = { limit: 100, windowSeconds: 60 * 60 } as const;

export type ReviewRateLimiter = {
    consume(identity: string): Promise<RateLimitOutcome>;
};

async function consumeBucket(
    bucket: string,
    limit: number,
    windowSeconds: number,
): Promise<RateLimitOutcome> {
    if (typeof window !== "undefined") throw new Error("Review rate limiting is server-only.");
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

export const databaseReviewRateLimiter: ReviewRateLimiter = {
    async consume(identity) {
        const perIdentity = await consumeBucket(
            `review:submit:${identity}`,
            REVIEW_IP_RATE_LIMIT.limit,
            REVIEW_IP_RATE_LIMIT.windowSeconds,
        );
        if (perIdentity.status !== "allowed") return perIdentity;
        return consumeBucket(
            "review:global",
            REVIEW_GLOBAL_RATE_LIMIT.limit,
            REVIEW_GLOBAL_RATE_LIMIT.windowSeconds,
        );
    },
};

const buckets = new Map<string, number[]>();
export function resetReviewRateLimits() {
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

export const memoryReviewRateLimiter: ReviewRateLimiter = {
    async consume(identity) {
        const perIdentity = consumeMemoryBucket(`review:submit:${identity}`, REVIEW_IP_RATE_LIMIT.limit, REVIEW_IP_RATE_LIMIT.windowSeconds);
        if (perIdentity.status !== "allowed") return perIdentity;
        return consumeMemoryBucket("review:global", REVIEW_GLOBAL_RATE_LIMIT.limit, REVIEW_GLOBAL_RATE_LIMIT.windowSeconds);
    },
};

export function resolveReviewRateLimiter(): ReviewRateLimiter {
    const mode = (process.env[REVIEW_RATE_LIMIT_MODE_VAR] ?? "").trim().toLowerCase();
    if (mode === "memory" && process.env.NODE_ENV !== "production") return memoryReviewRateLimiter;
    return demoMode && mode !== "database" ? memoryReviewRateLimiter : databaseReviewRateLimiter;
}
