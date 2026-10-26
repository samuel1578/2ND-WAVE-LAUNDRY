import { reviewErrorMessage, reviewErrorStatus, type ReviewErrorCode } from "./errors";
import { isValidReviewIdempotencyKey, validateReviewSubmission, type ReviewSubmission } from "./validation";
import type { RateLimitOutcome } from "@/lib/security/booking-rate-limit";
import type { OriginCheck } from "@/lib/security/request-origin";

export type ReviewHttpResponse = {
    status: number;
    body: Record<string, unknown>;
    headers: Record<string, string>;
};

export type ReviewSubmissionDeps = {
    configured: boolean;
    consentVersion: string;
    rateLimiter: { consume(identity: string): Promise<RateLimitOutcome> } | null;
    submit(input: {
        submission: ReviewSubmission;
        idempotencyKey: string;
        sourceIpHash: string;
        consentVersion: string;
        correlationId: string;
    }): Promise<{ ok: true; reviewId: string; replayed: boolean } | { ok: false; code: ReviewErrorCode }>;
};

export type ReviewSubmissionInput = {
    body: unknown;
    idempotencyKey: string | null;
    origin: OriginCheck;
    identity: string;
    correlationId: string;
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

function response(status: number, code: ReviewErrorCode | "rate_limit_unavailable", correlationId: string, extra: Record<string, unknown> = {}): ReviewHttpResponse {
    return {
        status,
        headers: { ...NO_STORE },
        body: {
            ok: false,
            code,
            message: code === "rate_limit_unavailable" ? reviewErrorMessage("rate_limit_unavailable") : reviewErrorMessage(code),
            correlationId,
            ...extra,
        },
    };
}

export async function handleReviewSubmission(
    input: ReviewSubmissionInput,
    deps: ReviewSubmissionDeps,
): Promise<ReviewHttpResponse> {
    if (!input.origin.ok) return response(403, "origin_rejected", input.correlationId);
    if (!deps.configured || !deps.rateLimiter)
        return response(503, "not_configured", input.correlationId);

    let limited: RateLimitOutcome;
    try {
        limited = await deps.rateLimiter.consume(input.identity);
    } catch {
        return response(503, "rate_limit_unavailable", input.correlationId);
    }
    if (limited.status === "unavailable") return response(503, "rate_limit_unavailable", input.correlationId);
    if (limited.status === "limited")
        return {
            ...response(429, "rate_limited", input.correlationId, { retryAfterSeconds: limited.retryAfterSeconds }),
            headers: { ...NO_STORE, "Retry-After": String(limited.retryAfterSeconds) },
        };

    if (!isValidReviewIdempotencyKey(input.idempotencyKey))
        return response(422, "idempotency_required", input.correlationId);

    const validation = validateReviewSubmission(input.body);
    if (!validation.ok)
        return response(
            reviewErrorStatus(validation.code),
            validation.code,
            input.correlationId,
            { fieldErrors: validation.fieldErrors },
        );

    let result: Awaited<ReturnType<ReviewSubmissionDeps["submit"]>>;
    try {
        result = await deps.submit({
            submission: validation.value,
            idempotencyKey: input.idempotencyKey,
            sourceIpHash: input.identity,
            consentVersion: deps.consentVersion,
            correlationId: input.correlationId,
        });
    } catch {
        return response(503, "storage_unavailable", input.correlationId);
    }
    if (!result.ok) return response(reviewErrorStatus(result.code), result.code, input.correlationId);

    return {
        status: result.replayed ? 200 : 201,
        headers: { ...NO_STORE },
        body: {
            ok: true,
            reviewId: result.reviewId,
            replayed: result.replayed,
            message: "Thank you. Your review has been received and is pending review.",
            correlationId: input.correlationId,
        },
    };
}
