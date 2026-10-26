import { createSupabaseAdminClient, SupabaseElevatedConfigError } from "@/lib/supabase/admin";
import type { ReviewErrorCode } from "./errors";
import type { ReviewSubmission } from "./validation";

export type ReviewRepositoryResult =
    | { ok: true; reviewId: string; replayed: boolean }
    | { ok: false; code: ReviewErrorCode };

function mapDatabaseError(message: string): ReviewErrorCode {
    const mappings: Array<[string, ReviewErrorCode]> = [
        ["REVIEW_IDEMPOTENCY_MISMATCH", "idempotency_mismatch"],
        ["REVIEW_IDEMPOTENCY_REQUIRED", "idempotency_required"],
        ["REVIEW_INVALID_NAME", "invalid_name"],
        ["REVIEW_INVALID_BODY", "invalid_body"],
        ["REVIEW_INVALID_RATING", "invalid_rating"],
        ["REVIEW_INVALID_BRANCH", "invalid_branch"],
        ["REVIEW_CONSENT_REQUIRED", "consent_required"],
        ["REVIEW_SPAM_REJECTED", "spam_rejected"],
        ["REVIEW_NOTICE_UNAVAILABLE", "not_configured"],
        ["REVIEW_INVALID_PAYLOAD", "invalid_payload"],
    ];
    return mappings.find(([marker]) => message.includes(marker))?.[1] ?? "storage_unavailable";
}

export async function submitReview(input: {
    submission: ReviewSubmission;
    idempotencyKey: string;
    sourceIpHash: string;
    consentVersion: string;
    correlationId: string;
}): Promise<ReviewRepositoryResult> {
    if (typeof window !== "undefined") throw new Error("The review repository is server-only.");

    let client;
    try {
        client = createSupabaseAdminClient();
    } catch (error) {
        return {
            ok: false,
            code: error instanceof SupabaseElevatedConfigError ? "not_configured" : "conflict",
        };
    }

    const { data, error } = await client.rpc("review_submit", {
        p_customer_name: input.submission.customerName,
        p_body_original: input.submission.bodyOriginal,
        p_rating: input.submission.rating,
        p_branch: input.submission.branch,
        p_consent: input.submission.consent,
        p_consent_version: input.consentVersion,
        p_notice_version: null,
        p_source_ip_hash: input.sourceIpHash,
        p_idempotency_key: input.idempotencyKey,
        p_correlation: input.correlationId,
    });
    if (error) return { ok: false, code: mapDatabaseError(error.message) };

    const result = data as { review_id?: unknown; replayed?: unknown } | null;
    if (!result || typeof result.review_id !== "string") return { ok: false, code: "conflict" };
    return { ok: true, reviewId: result.review_id, replayed: result.replayed === true };
}
