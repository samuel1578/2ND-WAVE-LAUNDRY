export const NEWSLETTER_LIMITS = {
    email: 254,
    idempotencyKeyMin: 16,
    idempotencyKeyMax: 128,
} as const;

export type NewsletterSubmission = {
    email: string;
    consent: true;
};

export type NewsletterValidationCode =
    | "invalid_payload"
    | "invalid_email"
    | "consent_required"
    | "spam_rejected";

export type NewsletterValidationResult =
    | { ok: true; value: NewsletterSubmission }
    | { ok: false; code: NewsletterValidationCode; fieldErrors: Record<string, string> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Pure validation used by the HTTP adapter and tests.
 *
 * The address is normalised to lower case here so the unique index in the
 * database sees one canonical form; the database function re-validates every
 * rule as defence in depth.
 */
export function validateNewsletterSubmission(raw: unknown): NewsletterValidationResult {
    if (!isRecord(raw))
        return { ok: false, code: "invalid_payload", fieldErrors: { form: "Invalid submission." } };

    const fieldErrors: Record<string, string> = {};
    const email = text(raw.email).toLowerCase();

    if (!email || email.length > NEWSLETTER_LIMITS.email || !EMAIL_SHAPE.test(email))
        fieldErrors.email = "Enter a valid email address.";

    if (raw.consent !== true)
        fieldErrors.consent = "Permission to receive news and offers by email is required.";

    if (text(raw.website)) {
        fieldErrors.form = "The submission could not be accepted.";
        return { ok: false, code: "spam_rejected", fieldErrors };
    }

    if (Object.keys(fieldErrors).length) {
        const code: NewsletterValidationCode = fieldErrors.email
            ? "invalid_email"
            : fieldErrors.consent
                ? "consent_required"
                : "invalid_payload";
        return { ok: false, code, fieldErrors };
    }

    return { ok: true, value: { email, consent: true } };
}

export function isValidNewsletterIdempotencyKey(value: string | null): value is string {
    return Boolean(
        value &&
        value.length >= NEWSLETTER_LIMITS.idempotencyKeyMin &&
        value.length <= NEWSLETTER_LIMITS.idempotencyKeyMax &&
        value.trim() === value,
    );
}
