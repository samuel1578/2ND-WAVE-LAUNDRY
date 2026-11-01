import { createSupabaseAdminClient, SupabaseElevatedConfigError } from "@/lib/supabase/admin";
import type { RateLimitOutcome } from "@/lib/security/booking-rate-limit";

export const ENQUIRY_IP_RATE_LIMIT = { limit: 5, windowSeconds: 60 * 60 } as const;
export const ENQUIRY_GLOBAL_RATE_LIMIT = { limit: 100, windowSeconds: 60 * 60 } as const;
export type EnquiryRateLimiter = { consume(identity: string): Promise<RateLimitOutcome> };
async function consumeBucket(bucket: string, limit: number): Promise<RateLimitOutcome> {
    if (typeof window !== "undefined") throw new Error("Enquiry rate limiting is server-only.");
    try {
        const client = createSupabaseAdminClient();
        const { data, error } = await client.rpc("booking_rate_limit_consume", { p_bucket: bucket, p_limit: limit, p_window_seconds: ENQUIRY_IP_RATE_LIMIT.windowSeconds });
        if (error || !data || typeof data !== "object") return { status: "unavailable" };
        const result = data as { allowed?: unknown; retry_after_seconds?: unknown };
        if (result.allowed === true) return { status: "allowed", remaining: 0, limit };
        if (result.allowed === false) return { status: "limited", retryAfterSeconds: Math.max(1, Math.ceil(Number(result.retry_after_seconds) || 60)), limit };
        return { status: "unavailable" };
    } catch (error) {
        if (error instanceof SupabaseElevatedConfigError) return { status: "unavailable" };
        return { status: "unavailable" };
    }
}
export const databaseEnquiryRateLimiter: EnquiryRateLimiter = {
    async consume(identity) {
        const perIdentity = await consumeBucket(`enquiry:submit:${identity}`, ENQUIRY_IP_RATE_LIMIT.limit);
        return perIdentity.status === "allowed" ? consumeBucket("enquiry:global", ENQUIRY_GLOBAL_RATE_LIMIT.limit) : perIdentity;
    },
};
