import { newsletterErrorMessage, newsletterErrorStatus, type NewsletterErrorCode } from "./errors";
import {
    isValidNewsletterIdempotencyKey,
    validateNewsletterSubmission,
    type NewsletterSubmission,
} from "./validation";
import type { RateLimitOutcome } from "@/lib/security/booking-rate-limit";
import type { OriginCheck } from "@/lib/security/request-origin";

export type NewsletterHttpResponse = {
    status: number;
    body: Record<string, unknown>;
    headers: Record<string, string>;
};

export type NewsletterSubmissionDeps = {
    configured: boolean;
    consentVersion: string;
    managerEmail: string;
    rateLimiter: { consume(identity: string): Promise<RateLimitOutcome> } | null;
    submit(input: {
        submission: NewsletterSubmission;
        idempotencyKey: string;
        sourceIpHash: string;
        consentVersion: string;
        managerEmail: string;
        correlationId: string;
    }): Promise<
        { ok: true; interestId: string; isNew: boolean } | { ok: false; code: NewsletterErrorCode }
    >;
};

export type NewsletterSubmissionInput = {
    body: unknown;
    idempotencyKey: string | null;
    origin: OriginCheck;
    identity: string;
    correlationId: string;
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

function response(
    status: number,
    code: NewsletterErrorCode | "rate_limit_unavailable",
    correlationId: string,
    extra: Record<string, unknown> = {},
): NewsletterHttpResponse {
    return {
        status,
        headers: { ...NO_STORE },
        body: {
            ok: false,
            code,
            message:
                code === "rate_limit_unavailable"
                    ? newsletterErrorMessage("rate_limit_unavailable")
                    : newsletterErrorMessage(code),
            correlationId,
            ...extra,
        },
    };
}

export async function handleNewsletterInterestSubmission(
    input: NewsletterSubmissionInput,
    deps: NewsletterSubmissionDeps,
): Promise<NewsletterHttpResponse> {
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

    if (!isValidNewsletterIdempotencyKey(input.idempotencyKey))
        return response(422, "idempotency_required", input.correlationId);

    const validation = validateNewsletterSubmission(input.body);
    if (!validation.ok)
        return response(
            newsletterErrorStatus(validation.code),
            validation.code,
            input.correlationId,
            { fieldErrors: validation.fieldErrors },
        );

    let result: Awaited<ReturnType<NewsletterSubmissionDeps["submit"]>>;
    try {
        result = await deps.submit({
            submission: validation.value,
            idempotencyKey: input.idempotencyKey,
            sourceIpHash: input.identity,
            consentVersion: deps.consentVersion,
            managerEmail: deps.managerEmail,
            correlationId: input.correlationId,
        });
    } catch {
        return response(503, "storage_unavailable", input.correlationId);
    }
    if (!result.ok) return response(newsletterErrorStatus(result.code), result.code, input.correlationId);

    // The public answer is deliberately identical for a first-time sign-up and
    // a duplicate address: whether an alert was queued is server-side detail.
    return {
        status: 202,
        headers: { ...NO_STORE },
        body: {
            ok: true,
            message: "Thank you. Your interest has been recorded.",
            correlationId: input.correlationId,
        },
    };
}
