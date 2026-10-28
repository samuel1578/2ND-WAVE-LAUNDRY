export type NewsletterErrorCode =
    | "invalid_payload"
    | "invalid_email"
    | "consent_required"
    | "spam_rejected"
    | "origin_rejected"
    | "not_configured"
    | "rate_limit_unavailable"
    | "rate_limited"
    | "idempotency_required"
    | "storage_unavailable"
    | "conflict";

const messages: Record<NewsletterErrorCode, string> = {
    invalid_payload: "The request could not be processed. Check the details and try again.",
    invalid_email: "Enter a valid email address.",
    consent_required: "Permission to receive news and offers by email is required.",
    spam_rejected: "The submission could not be accepted. Check the form and try again.",
    origin_rejected: "This request did not come from an approved origin.",
    not_configured: "Newsletter registration is temporarily unavailable. Please contact our team.",
    rate_limit_unavailable: "Newsletter registration is temporarily unavailable. Please try again shortly.",
    rate_limited: "Too many sign-ups have been submitted from this connection. Please wait and try again.",
    idempotency_required: "This sign-up is missing its protection key. Reload the form and try again.",
    storage_unavailable: "Newsletter registration is temporarily unavailable. Please try again shortly.",
    conflict: "The sign-up could not be saved. Please try again.",
};

export function newsletterErrorMessage(code: NewsletterErrorCode): string {
    return messages[code] ?? messages.conflict;
}

export function newsletterErrorStatus(code: NewsletterErrorCode): number {
    switch (code) {
        case "origin_rejected": return 403;
        case "not_configured":
        case "rate_limit_unavailable":
        case "storage_unavailable": return 503;
        case "rate_limited": return 429;
        case "invalid_payload":
        case "invalid_email":
        case "consent_required":
        case "spam_rejected":
        case "idempotency_required": return 422;
        default: return 400;
    }
}
