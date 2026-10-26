export type ReviewErrorCode =
    | "invalid_payload"
    | "invalid_name"
    | "invalid_body"
    | "invalid_rating"
    | "invalid_branch"
    | "consent_required"
    | "spam_rejected"
    | "origin_rejected"
    | "submissions_disabled"
    | "not_configured"
    | "rate_limit_unavailable"
    | "rate_limited"
    | "idempotency_required"
    | "idempotency_mismatch"
    | "storage_unavailable"
    | "conflict"
    // Sprint 3B — moderation, publication and override.
    | "actor_required"
    | "permission_denied"
    | "not_found"
    | "invalid_transition"
    | "state_unchanged"
    | "note_required"
    | "reason_required"
    | "invalid_note"
    | "invalid_operation"
    | "invalid_publication"
    | "invalid_reply"
    | "version_conflict";

const messages: Record<ReviewErrorCode, string> = {
    invalid_payload: "The review could not be processed. Check the details and try again.",
    invalid_name: "Enter a name between 1 and 120 characters.",
    invalid_body: "Enter a review between 1 and 4000 characters.",
    invalid_rating: "Choose a rating from 1 to 5.",
    invalid_branch: "Choose a valid branch.",
    consent_required: "Permission is required before submitting a review.",
    spam_rejected: "The review could not be accepted. Remove extra links and try again.",
    origin_rejected: "This request did not come from an approved origin.",
    submissions_disabled: "Online review submissions are temporarily unavailable.",
    not_configured: "Online review submissions are temporarily unavailable. Please contact our team.",
    rate_limit_unavailable: "Online review submissions are temporarily unavailable. Please try again shortly.",
    rate_limited: "Too many reviews have been submitted from this connection. Please wait and try again.",
    idempotency_required: "This review is missing its protection key. Reload the form and try again.",
    idempotency_mismatch: "This review changed while it was being saved. Review it and submit again.",
    storage_unavailable: "Online review submissions are temporarily unavailable. Please try again shortly.",
    conflict: "The review could not be saved. Please try again.",
    actor_required: "Sign in with an administrator account to continue.",
    permission_denied: "Your administrator role does not allow this action.",
    not_found: "This review is no longer available.",
    invalid_transition: "This review cannot move to that state.",
    state_unchanged: "The review is already in that state.",
    note_required: "Record a reason before rejecting a review.",
    reason_required: "Record a reason for this action.",
    invalid_note: "Enter a note up to 500 characters.",
    invalid_operation: "That review action is not supported.",
    invalid_publication: "Enter the text to publish, up to 4000 characters.",
    invalid_reply: "Enter a reply between 1 and 4000 characters.",
    version_conflict: "This review changed while you were viewing it. Reload the latest details before saving.",
};

export function reviewErrorMessage(code: ReviewErrorCode): string {
    return messages[code] ?? messages.conflict;
}

export function reviewErrorStatus(code: ReviewErrorCode): number {
    switch (code) {
        case "origin_rejected": return 403;
        case "actor_required": return 401;
        case "permission_denied": return 403;
        case "not_found": return 404;
        case "submissions_disabled":
        case "not_configured":
        case "rate_limit_unavailable":
        case "storage_unavailable": return 503;
        case "rate_limited": return 429;
        case "idempotency_mismatch":
        case "invalid_transition":
        case "state_unchanged":
        case "version_conflict": return 409;
        case "invalid_payload":
        case "invalid_name":
        case "invalid_body":
        case "invalid_rating":
        case "invalid_branch":
        case "consent_required":
        case "spam_rejected":
        case "idempotency_required":
        case "note_required":
        case "reason_required":
        case "invalid_note":
        case "invalid_operation":
        case "invalid_publication":
        case "invalid_reply": return 422;
        default: return 400;
    }
}
