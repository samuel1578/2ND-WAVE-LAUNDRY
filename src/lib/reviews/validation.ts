export const REVIEW_LIMITS = {
    name: 120,
    body: 4000,
    branch: 120,
    links: 2,
    idempotencyKeyMin: 16,
    idempotencyKeyMax: 128,
} as const;

export type ReviewSubmission = {
    customerName: string;
    bodyOriginal: string;
    rating: number | null;
    branch: string | null;
    consent: true;
};

export type ReviewValidationCode =
    | "invalid_payload"
    | "invalid_name"
    | "invalid_body"
    | "invalid_rating"
    | "invalid_branch"
    | "consent_required"
    | "spam_rejected";

export type ReviewValidationResult =
    | { ok: true; value: ReviewSubmission }
    | { ok: false; code: ReviewValidationCode; fieldErrors: Record<string, string> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export function countReviewLinks(value: string): number {
    return value.match(/https?:\/\/|www\./gi)?.length ?? 0;
}

/** Pure validation used by the HTTP adapter and tests. Customer text stays plain text. */
export function validateReviewSubmission(raw: unknown): ReviewValidationResult {
    if (!isRecord(raw))
        return { ok: false, code: "invalid_payload", fieldErrors: { form: "Invalid submission." } };

    const fieldErrors: Record<string, string> = {};
    const customerName = text(raw.name);
    const bodyOriginal = text(raw.body);
    const branchValue = text(raw.branch);
    const ratingRaw = raw.rating;
    let rating: number | null = null;

    if (!customerName || customerName.length > REVIEW_LIMITS.name)
        fieldErrors.name = "Enter a name between 1 and 120 characters.";
    if (!bodyOriginal || bodyOriginal.length > REVIEW_LIMITS.body)
        fieldErrors.review = "Enter a review between 1 and 4000 characters.";

    if (ratingRaw !== undefined && ratingRaw !== null && ratingRaw !== "") {
        const parsed = typeof ratingRaw === "number" ? ratingRaw : Number(ratingRaw);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5)
            fieldErrors.rating = "Choose a rating from 1 to 5.";
        else rating = parsed;
    }

    if (branchValue.length > REVIEW_LIMITS.branch)
        fieldErrors.branch = "Choose a valid branch.";

    if (raw.consent !== true)
        fieldErrors.consent = "Permission to consider your review for publication is required.";

    if (text(raw.website)) {
        fieldErrors.form = "The submission could not be accepted.";
        return { ok: false, code: "spam_rejected", fieldErrors };
    }

    if (countReviewLinks(bodyOriginal) > REVIEW_LIMITS.links) {
        fieldErrors.review = "Remove some links from your review and try again.";
        fieldErrors.form = "The submission could not be accepted.";
        return { ok: false, code: "spam_rejected", fieldErrors };
    }

    if (Object.keys(fieldErrors).length) {
        const code: ReviewValidationCode = fieldErrors.name
            ? "invalid_name"
            : fieldErrors.review
                ? "invalid_body"
                : fieldErrors.rating
                    ? "invalid_rating"
                    : fieldErrors.branch
                        ? "invalid_branch"
                        : fieldErrors.consent
                            ? "consent_required"
                            : "invalid_payload";
        return { ok: false, code, fieldErrors };
    }

    return {
        ok: true,
        value: {
            customerName,
            bodyOriginal,
            rating,
            branch: branchValue || null,
            consent: true,
        },
    };
}

export function isValidReviewIdempotencyKey(value: string | null): value is string {
    return Boolean(
        value &&
        value.length >= REVIEW_LIMITS.idempotencyKeyMin &&
        value.length <= REVIEW_LIMITS.idempotencyKeyMax &&
        value.trim() === value,
    );
}
