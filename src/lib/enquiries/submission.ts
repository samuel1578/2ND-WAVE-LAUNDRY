import type { RateLimitOutcome } from "@/lib/security/booking-rate-limit";
import type { OriginCheck } from "@/lib/security/request-origin";
import type { EnquiryErrorCode } from "./repository";
import { isValidEnquiryIdempotencyKey, validateEnquirySubmission, type EnquirySubmission } from "./validation";

export type EnquiryHttpResponse = {
    status: number;
    headers: Record<string, string>;
    body: Record<string, unknown>;
};
type RateLimiter = { consume(identity: string): Promise<RateLimitOutcome> };
export type EnquirySubmissionDeps = {
    configured: boolean;
    rateLimiter: RateLimiter | null;
    submit(input: {
        submission: EnquirySubmission;
        idempotencyKey: string;
        sourceIpHash: string;
        correlationId: string;
    }): Promise<{ ok: true; enquiryId: string; isNew: boolean } | { ok: false; code: EnquiryErrorCode }>;
};
export type EnquirySubmissionInput = {
    body: unknown;
    idempotencyKey: string | null;
    origin: OriginCheck;
    identity: string;
    correlationId: string;
};
const NO_STORE = { "Cache-Control": "no-store" } as const;
function failure(status: number, code: string, message: string, correlationId: string, extra: Record<string, unknown> = {}): EnquiryHttpResponse {
    return { status, headers: { ...NO_STORE }, body: { ok: false, code, message, correlationId, ...extra } };
}
export async function handleEnquirySubmission(input: EnquirySubmissionInput, deps: EnquirySubmissionDeps): Promise<EnquiryHttpResponse> {
    if (!input.origin.ok) return failure(403, "origin_rejected", "This request could not be verified.", input.correlationId);
    if (!deps.configured || !deps.rateLimiter) return failure(503, "not_configured", "Online enquiries are temporarily unavailable. Please call us or chat with us on WhatsApp.", input.correlationId);

    let limited: RateLimitOutcome;
    try { limited = await deps.rateLimiter.consume(input.identity); }
    catch { return failure(503, "rate_limit_unavailable", "We couldn't send your request. Please try again or call us.", input.correlationId); }
    if (limited.status === "unavailable") return failure(503, "rate_limit_unavailable", "We couldn't send your request. Please try again or call us.", input.correlationId);
    if (limited.status === "limited") return {
        ...failure(429, "rate_limited", "Too many requests have been sent. Please wait and try again.", input.correlationId),
        headers: { ...NO_STORE, "Retry-After": String(limited.retryAfterSeconds) },
    };

    if (!isValidEnquiryIdempotencyKey(input.idempotencyKey)) return failure(422, "idempotency_required", "Please refresh the form and try again.", input.correlationId);
    const validation = validateEnquirySubmission(input.body);
    if (!validation.ok) return failure(422, validation.code, validation.fieldErrors.form ?? "Please check the highlighted fields.", input.correlationId, { fieldErrors: validation.fieldErrors });

    let result: Awaited<ReturnType<EnquirySubmissionDeps["submit"]>>;
    try {
        result = await deps.submit({ submission: validation.value, idempotencyKey: input.idempotencyKey, sourceIpHash: input.identity, correlationId: input.correlationId });
    } catch {
        return failure(503, "storage_unavailable", "We couldn't send your request. Please try again or call us.", input.correlationId);
    }
    if (!result.ok) return failure(result.code === "idempotency_mismatch" ? 409 : 503, result.code, result.code === "idempotency_mismatch" ? "This request was already submitted with different details. Refresh and try again." : "We couldn't send your request. Please try again or call us.", input.correlationId);
    return { status: 202, headers: { ...NO_STORE }, body: { ok: true, message: "Thank you. Your enquiry has been received.", correlationId: input.correlationId } };
}
