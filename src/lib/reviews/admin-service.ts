/**
 * Server-only administrator review moderation (Sprint 3B).
 *
 * Split of responsibility, mirroring the staff and booking modules:
 * - Reads run with the caller's *own* session client, so row level security
 *   decides what is visible. The review policies expose submissions to any active
 *   administrator, and the review-history audit policy added in Sprint 3B exposes
 *   audit rows for `entity_type = 'review'` to the same administrators.
 * - Writes call the trusted `review_*` database functions through the server-only
 *   elevated client. Those functions re-validate the acting administrator, the
 *   transition, the mandatory reason and the optimistic version, then write the
 *   change and its audit event in one transaction.
 *
 * The actor id always comes from the verified session resolved by the caller —
 * never from the request body. Nothing here returns a credential, raw SQL text or
 * an IP hash to the browser.
 */

import { createSupabaseAdminClient, SupabaseElevatedConfigError } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseConfigError } from "@/lib/supabase/config";
import type { AdminIdentity } from "@/lib/auth/roles";
import type { ReviewErrorCode } from "./errors";
import {
    REVIEW_DETAIL_HISTORY_LIMIT,
    isReviewId,
    mapReviewDetailRow,
    mapReviewSummaryRow,
    normaliseReviewListQuery,
    reviewListRange,
    reviewSearchFilter,
    type AdminReviewDetail,
    type AdminReviewSummary,
    type ReviewListPage,
    type ReviewListQuery,
    type ReviewOperationsSummary,
} from "./admin";
import { mapReviewDatabaseError } from "./moderation";

export type ReviewAdminResult<T> =
    | { ok: true; data: T }
    | { ok: false; code: ReviewErrorCode };

const fail = (code: ReviewErrorCode): { ok: false; code: ReviewErrorCode } => ({
    ok: false,
    code,
});

const SUMMARY_COLUMNS = [
    "id",
    "customer_name",
    "rating",
    "branch",
    "consent",
    "moderation_status",
    "moderated_at",
    "body_published",
    "published_version",
    "version",
    "created_at",
].join(", ");

const DETAIL_COLUMNS = [
    SUMMARY_COLUMNS,
    "body_original",
    "moderation_note",
    "published_at",
    "consent_version",
    "updated_at",
    "reply_status",
    "reply_body",
    "reply_published_at",
].join(", ");

const AUDIT_COLUMNS = [
    "id",
    "action",
    "actor_id",
    "reason",
    "before_state",
    "after_state",
    "created_at",
].join(", ");

async function sessionClient() {
    return createSupabaseServerClient();
}

/** One bounded page of review submissions, newest first, with exact totals. */
export async function listAdminReviews(
    query: ReviewListQuery,
): Promise<ReviewAdminResult<ReviewListPage>> {
    let supabase;
    try {
        supabase = await sessionClient();
    } catch (error) {
        return fail(error instanceof SupabaseConfigError ? "not_configured" : "conflict");
    }

    let request = supabase
        .from("review_submissions")
        .select(SUMMARY_COLUMNS, { count: "exact" })
        .is("deleted_at", null);

    const search = reviewSearchFilter(query.search);
    if (search) request = request.or(search);
    if (query.status) request = request.eq("moderation_status", query.status);
    if (query.branch) request = request.eq("branch", query.branch);
    if (query.rating !== null) request = request.eq("rating", query.rating);
    if (query.from) request = request.gte("created_at", `${query.from}T00:00:00.000Z`);
    if (query.to) request = request.lte("created_at", `${query.to}T23:59:59.999Z`);

    const { from, to } = reviewListRange(query);
    const { data, error, count } = await request
        .order("created_at", { ascending: false })
        .range(from, to);

    if (error) return fail("permission_denied");

    const rows: AdminReviewSummary[] = [];
    for (const row of (data ?? []) as unknown[]) {
        const mapped = mapReviewSummaryRow(row);
        if (mapped) rows.push(mapped);
    }

    return {
        ok: true,
        data: {
            rows,
            total: typeof count === "number" ? count : rows.length,
            page: query.page,
            pageSize: query.pageSize,
        },
    };
}

/**
 * One review with its original submission, current publication and audit
 * history. The original text is administrator-only and is never rendered
 * publicly; the interface shows it read-only beside the publication editor.
 */
export async function getAdminReview(
    id: string,
): Promise<ReviewAdminResult<AdminReviewDetail>> {
    if (!isReviewId(id)) return fail("not_found");

    let supabase;
    try {
        supabase = await sessionClient();
    } catch (error) {
        return fail(error instanceof SupabaseConfigError ? "not_configured" : "conflict");
    }

    const { data, error } = await supabase
        .from("review_submissions")
        .select(DETAIL_COLUMNS)
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();

    if (error) return fail("permission_denied");
    if (!data) return fail("not_found");

    const audit = await supabase
        .from("audit_events")
        .select(AUDIT_COLUMNS)
        .eq("entity_type", "review")
        .eq("entity_id", id)
        .order("created_at", { ascending: true })
        .limit(REVIEW_DETAIL_HISTORY_LIMIT);

    const review = mapReviewDetailRow(data, {
        // A history read filtered out by a policy is "no history visible", not a
        // failure of the whole detail view.
        audit: audit.error ? [] : audit.data,
    });
    if (!review) return fail("conflict");
    return { ok: true, data: review };
}

/**
 * Bounded counters for the dashboard. Uses exact `head` counts rather than
 * fetching rows, so the dashboard never loads the review queue.
 */
export async function loadReviewOperationsSummary(): Promise<
    ReviewAdminResult<ReviewOperationsSummary>
> {
    let supabase;
    try {
        supabase = await sessionClient();
    } catch (error) {
        return fail(error instanceof SupabaseConfigError ? "not_configured" : "conflict");
    }

    const base = () =>
        supabase
            .from("review_submissions")
            .select("id", { count: "exact", head: true })
            .is("deleted_at", null);

    const [pending, published] = await Promise.all([
        base().eq("moderation_status", "pending"),
        base()
            .eq("moderation_status", "approved")
            .eq("consent", true)
            .not("body_published", "is", null),
    ]);

    if (pending.error || published.error) return fail("permission_denied");

    return {
        ok: true,
        data: {
            pendingCount: typeof pending.count === "number" ? pending.count : 0,
            publishedCount: typeof published.count === "number" ? published.count : 0,
        },
    };
}

export type ReviewMutationOutcome = {
    version: number;
    moderationStatus: string;
    published: boolean;
    publishedVersion: number | null;
};

type RawMutationResult = {
    review_id?: unknown;
    moderation_status?: unknown;
    published?: unknown;
    published_version?: unknown;
    version?: unknown;
};

/**
 * Calls one trusted review function and maps its result. Only the trusted server
 * can reach these RPCs; the grants in the migration deny them to browser roles.
 */
async function callReviewRpc(
    fn: string,
    args: Record<string, unknown>,
): Promise<ReviewAdminResult<ReviewMutationOutcome>> {
    let client;
    try {
        client = createSupabaseAdminClient();
    } catch (error) {
        return fail(
            error instanceof SupabaseElevatedConfigError ? "not_configured" : "conflict",
        );
    }

    const { data, error } = await client.rpc(fn, args);
    if (error) return fail(mapReviewDatabaseError(error.message));

    const result = data as RawMutationResult | null;
    if (!result || typeof result.moderation_status !== "string")
        return fail("conflict");

    const version = Number(result.version);
    const publishedVersion = Number(result.published_version);
    return {
        ok: true,
        data: {
            version: Number.isFinite(version) ? version : 1,
            moderationStatus: result.moderation_status,
            published: result.published === true,
            publishedVersion:
                Number.isFinite(publishedVersion) && publishedVersion > 0
                    ? publishedVersion
                    : null,
        },
    };
}

export async function moderateReview(input: {
    actor: AdminIdentity;
    reviewId: string;
    decision: "approved" | "rejected";
    note: string | null;
    expectedVersion: number;
    correlationId: string;
}): Promise<ReviewAdminResult<ReviewMutationOutcome>> {
    return callReviewRpc("review_moderate", {
        p_actor: input.actor.userId,
        p_review: input.reviewId,
        p_decision: input.decision,
        p_note: input.note,
        p_expected_version: input.expectedVersion,
        p_correlation: input.correlationId,
    });
}

export async function publishReview(input: {
    actor: AdminIdentity;
    reviewId: string;
    action: "publish" | "unpublish" | "update";
    body: string | null;
    expectedVersion: number;
    correlationId: string;
}): Promise<ReviewAdminResult<ReviewMutationOutcome>> {
    return callReviewRpc("review_publish", {
        p_actor: input.actor.userId,
        p_review: input.reviewId,
        p_action: input.action,
        p_body_published: input.body,
        p_expected_version: input.expectedVersion,
        p_correlation: input.correlationId,
    });
}

export async function reopenReview(input: {
    actor: AdminIdentity;
    reviewId: string;
    reason: string;
    expectedVersion: number;
    correlationId: string;
}): Promise<ReviewAdminResult<ReviewMutationOutcome>> {
    return callReviewRpc("review_open", {
        p_actor: input.actor.userId,
        p_review: input.reviewId,
        p_reason: input.reason,
        p_expected_version: input.expectedVersion,
        p_correlation: input.correlationId,
    });
}

export type ReviewReplyOutcome = {
    version: number;
    replyStatus: string;
};

async function callReplyRpc(
    fn: string,
    args: Record<string, unknown>,
): Promise<ReviewAdminResult<ReviewReplyOutcome>> {
    let client;
    try {
        client = createSupabaseAdminClient();
    } catch (error) {
        return fail(
            error instanceof SupabaseElevatedConfigError ? "not_configured" : "conflict",
        );
    }

    const { data, error } = await client.rpc(fn, args);
    if (error) return fail(mapReviewDatabaseError(error.message));

    const result = data as { reply_status?: unknown; version?: unknown } | null;
    if (!result || typeof result.reply_status !== "string") return fail("conflict");

    const version = Number(result.version);
    return {
        ok: true,
        data: {
            version: Number.isFinite(version) ? version : 1,
            replyStatus: result.reply_status,
        },
    };
}

export async function draftReply(input: {
    actor: AdminIdentity;
    reviewId: string;
    body: string;
    expectedVersion: number;
    correlationId: string;
}): Promise<ReviewAdminResult<ReviewReplyOutcome>> {
    return callReplyRpc("review_draft_reply", {
        p_actor: input.actor.userId,
        p_review: input.reviewId,
        p_body: input.body,
        p_expected_version: input.expectedVersion,
        p_correlation: input.correlationId,
    });
}

export async function publishReply(input: {
    actor: AdminIdentity;
    reviewId: string;
    expectedVersion: number;
    correlationId: string;
}): Promise<ReviewAdminResult<ReviewReplyOutcome>> {
    return callReplyRpc("review_reply_publish", {
        p_actor: input.actor.userId,
        p_review: input.reviewId,
        p_expected_version: input.expectedVersion,
        p_correlation: input.correlationId,
    });
}

export async function overrideReview(input: {
    actor: AdminIdentity;
    reviewId: string;
    operation: "approve" | "reject" | "publish" | "unpublish";
    reason: string;
    body: string | null;
    expectedVersion: number;
    correlationId: string;
}): Promise<ReviewAdminResult<ReviewMutationOutcome>> {
    return callReviewRpc("review_override", {
        p_actor: input.actor.userId,
        p_review: input.reviewId,
        p_operation: input.operation,
        p_reason: input.reason,
        p_body_published: input.body,
        p_expected_version: input.expectedVersion,
        p_correlation: input.correlationId,
    });
}

export { normaliseReviewListQuery };
