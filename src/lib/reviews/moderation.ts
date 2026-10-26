/**
 * Review moderation contracts and pure rules (Sprint 3B).
 *
 * The database functions in
 * `supabase/migrations/20261026100200_review_moderation_functions.sql` are the
 * authority for every transition, permission and optimistic version check. This
 * module mirrors those rules so the interface can explain a decision before a
 * round trip and so the behaviour can be unit tested without a database.
 *
 * Nothing here renders or accepts HTML: customer text stays plain text throughout.
 */

import type { Permission } from "@/lib/auth/permissions";
import type { ReviewErrorCode } from "./errors";

export const REVIEW_MODERATION_STATUSES = [
    "pending",
    "approved",
    "rejected",
] as const;
export type ReviewModerationStatus = (typeof REVIEW_MODERATION_STATUSES)[number];

export const REVIEW_PUBLICATION_ACTIONS = [
    "publish",
    "unpublish",
    "update",
] as const;
export type ReviewPublicationAction = (typeof REVIEW_PUBLICATION_ACTIONS)[number];

export const REVIEW_OVERRIDE_OPERATIONS = [
    "approve",
    "reject",
    "publish",
    "unpublish",
] as const;
export type ReviewOverrideOperation = (typeof REVIEW_OVERRIDE_OPERATIONS)[number];

export type ReviewAdminOperation =
    | "moderate"
    | "publish"
    | "reply"
    | "reopen"
    | "override";

export const REVIEW_MODERATION_LIMITS = {
    note: 500,
    reason: 500,
    body: 4000,
} as const;

/**
 * The registry capability that gates one operation.
 *
 * Re-opening a rejected review and any emergency override are Full Admin
 * capabilities in the permission registry (`reviews.override`); moderation,
 * publication and replies are the shared review workflow (`reviews.moderate` /
 * `reviews.reply`).
 */
export function reviewOperationPermission(
    operation: ReviewAdminOperation,
): Permission {
    switch (operation) {
        case "override":
        case "reopen":
            return "reviews.override";
        case "reply":
            return "reviews.reply";
        default:
            return "reviews.moderate";
    }
}

export const isModerationStatus = (
    value: unknown,
): value is ReviewModerationStatus =>
    typeof value === "string" &&
    (REVIEW_MODERATION_STATUSES as readonly string[]).includes(value);

export const isPublicationAction = (
    value: unknown,
): value is ReviewPublicationAction =>
    typeof value === "string" &&
    (REVIEW_PUBLICATION_ACTIONS as readonly string[]).includes(value);

export const isOverrideOperation = (
    value: unknown,
): value is ReviewOverrideOperation =>
    typeof value === "string" &&
    (REVIEW_OVERRIDE_OPERATIONS as readonly string[]).includes(value);

/** `pending` is the only state a moderator may decide. */
export function canModerate(status: ReviewModerationStatus): boolean {
    return status === "pending";
}

/** Only a rejected review can be re-opened (Full Admin). */
export function canReopen(status: ReviewModerationStatus): boolean {
    return status === "rejected";
}

/**
 * Publication is possible only for an approved review whose customer granted
 * permission. The database enforces the same predicate.
 */
export function canPublish(review: {
    moderationStatus: ReviewModerationStatus;
    consent: boolean;
}): boolean {
    return review.moderationStatus === "approved" && review.consent;
}

/** Editing the public version requires an existing publication. */
export function canEditPublication(review: {
    published: boolean;
    canPublish: boolean;
}): boolean {
    return review.published && review.canPublish;
}

export type ReviewModerationValidationFailure = {
    ok: false;
    code: ReviewErrorCode;
    fieldErrors: Record<string, string>;
};

export type ReviewModerationValidationResult<T> =
    | { ok: true; value: T }
    | ReviewModerationValidationFailure;

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export type ModerationDecision = {
    decision: Extract<ReviewModerationStatus, "approved" | "rejected">;
    note: string | null;
};

export function validateModerationInput(input: {
    decision: unknown;
    note?: unknown;
}): ReviewModerationValidationResult<ModerationDecision> {
    const decision = text(input.decision);
    const note = text(input.note) || null;

    if (decision !== "approved" && decision !== "rejected")
        return {
            ok: false,
            code: "invalid_operation",
            fieldErrors: { decision: "Choose approve or reject." },
        };

    if (decision === "rejected" && !note)
        return {
            ok: false,
            code: "note_required",
            fieldErrors: { note: "Record a reason before rejecting a review." },
        };

    if (note && note.length > REVIEW_MODERATION_LIMITS.note)
        return {
            ok: false,
            code: "invalid_note",
            fieldErrors: { note: `Enter a note up to ${REVIEW_MODERATION_LIMITS.note} characters.` },
        };

    return { ok: true, value: { decision, note } };
}

export type PublicationInput = {
    action: ReviewPublicationAction;
    body: string | null;
};

export function validatePublicationInput(input: {
    action: unknown;
    body?: unknown;
}): ReviewModerationValidationResult<PublicationInput> {
    const action = text(input.action);
    if (!isPublicationAction(action))
        return {
            ok: false,
            code: "invalid_operation",
            fieldErrors: { action: "Choose a publication action." },
        };

    if (action === "unpublish") return { ok: true, value: { action, body: null } };

    const body = text(input.body);
    if (!body || body.length > REVIEW_MODERATION_LIMITS.body)
        return {
            ok: false,
            code: "invalid_publication",
            fieldErrors: {
                body: `Enter the text to publish, between 1 and ${REVIEW_MODERATION_LIMITS.body} characters.`,
            },
        };

    return { ok: true, value: { action, body } };
}

export function validateReopenInput(input: {
    reason?: unknown;
}): ReviewModerationValidationResult<{ reason: string }> {
    const reason = text(input.reason);
    if (!reason || reason.length > REVIEW_MODERATION_LIMITS.reason)
        return {
            ok: false,
            code: "reason_required",
            fieldErrors: {
                reason: `Record a reason up to ${REVIEW_MODERATION_LIMITS.reason} characters.`,
            },
        };
    return { ok: true, value: { reason } };
}

export function validateReplyInput(input: {
    body?: unknown;
}): ReviewModerationValidationResult<{ body: string }> {
    const body = text(input.body);
    if (!body || body.length > REVIEW_MODERATION_LIMITS.body)
        return {
            ok: false,
            code: "invalid_reply",
            fieldErrors: {
                body: `Enter a reply between 1 and ${REVIEW_MODERATION_LIMITS.body} characters.`,
            },
        };
    return { ok: true, value: { body } };
}

export type OverrideInput = {
    operation: ReviewOverrideOperation;
    reason: string;
    body: string | null;
};

export function validateOverrideInput(input: {
    operation: unknown;
    reason?: unknown;
    body?: unknown;
}): ReviewModerationValidationResult<OverrideInput> {
    const operation = text(input.operation);
    if (!isOverrideOperation(operation))
        return {
            ok: false,
            code: "invalid_operation",
            fieldErrors: { operation: "Choose an override operation." },
        };

    const reason = text(input.reason);
    if (!reason || reason.length > REVIEW_MODERATION_LIMITS.reason)
        return {
            ok: false,
            code: "reason_required",
            fieldErrors: {
                reason: `An override requires a reason up to ${REVIEW_MODERATION_LIMITS.reason} characters.`,
            },
        };

    if (operation === "publish") {
        const body = text(input.body);
        if (!body || body.length > REVIEW_MODERATION_LIMITS.body)
            return {
                ok: false,
                code: "invalid_publication",
                fieldErrors: {
                    body: `Enter the text to publish, between 1 and ${REVIEW_MODERATION_LIMITS.body} characters.`,
                },
            };
        return { ok: true, value: { operation, reason, body } };
    }

    return { ok: true, value: { operation, reason, body: null } };
}

/**
 * Maps a marker raised by the trusted review functions onto the stable error
 * taxonomy. The most specific marker is matched first; anything unrecognised
 * fails closed as a retryable conflict so no raw database text reaches a caller.
 */
const DATABASE_MARKERS: ReadonlyArray<[string, ReviewErrorCode]> = [
    ["REVIEW_ACTOR_REQUIRED", "actor_required"],
    ["REVIEW_FORBIDDEN", "permission_denied"],
    ["REVIEW_NOT_FOUND", "not_found"],
    ["REVIEW_CONFLICT", "version_conflict"],
    ["REVIEW_INVALID_TRANSITION", "invalid_transition"],
    ["REVIEW_STATE_UNCHANGED", "state_unchanged"],
    ["REVIEW_NOTE_REQUIRED", "note_required"],
    ["REVIEW_REASON_REQUIRED", "reason_required"],
    ["REVIEW_INVALID_OPERATION", "invalid_operation"],
    ["REVIEW_INVALID_NOTE", "invalid_note"],
    ["REVIEW_INVALID_BODY", "invalid_publication"],
    ["REVIEW_INVALID_REPLY", "invalid_reply"],
    ["REVIEW_CONSENT_REQUIRED", "consent_required"],
    ["REVIEW_IDEMPOTENCY_MISMATCH", "idempotency_mismatch"],
    ["REVIEW_IDEMPOTENCY_REQUIRED", "idempotency_required"],
    ["REVIEW_INVALID_NAME", "invalid_name"],
    ["REVIEW_INVALID_RATING", "invalid_rating"],
    ["REVIEW_INVALID_BRANCH", "invalid_branch"],
    ["REVIEW_SPAM_REJECTED", "spam_rejected"],
    ["REVIEW_NOTICE_UNAVAILABLE", "not_configured"],
    ["REVIEW_INVALID_PAYLOAD", "invalid_payload"],
];

export function mapReviewDatabaseError(message: unknown): ReviewErrorCode {
    if (typeof message !== "string") return "conflict";
    for (const [marker, code] of DATABASE_MARKERS)
        if (message.includes(marker)) return code;
    return "conflict";
}
