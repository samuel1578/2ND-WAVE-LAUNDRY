/**
 * Public review projection (Sprint 3C).
 *
 * The only review data the public site may render. It is deliberately a
 * whitelist: rows are projected onto `PublicReview` and nothing else, so a
 * mis-selected column, a moderation note, a source-IP hash, the original
 * submission or a reply draft cannot reach the browser even if a query or view
 * regressed.
 *
 * Customer text stays plain text. React escapes it at render time; there is no
 * HTML path for review content anywhere in this module or its consumers.
 */

import type { Lead } from "@/lib/contracts";

export const PUBLIC_REVIEW_LIMIT = 50;

/** Columns selected from `public.published_reviews` (never private columns). */
export const PUBLIC_REVIEW_COLUMNS = [
    "id",
    "customer_name",
    "rating",
    "branch",
    "body_published",
    "published_at",
    "published_version",
    "reply_body",
    "reply_published_at",
].join(", ");

export type PublicReview = {
    id: string;
    name: string;
    rating: number | null;
    branch: string | null;
    body: string;
    publishedAt: string | null;
    publishedVersion: number | null;
    reply: string | null;
    replyPublishedAt: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";

const nullableText = (value: unknown): string | null => {
    const value_ = text(value);
    return value_ ? value_ : null;
};

const nullableInstant = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    return Number.isNaN(Date.parse(value)) ? null : value;
};

const nullableRating = (value: unknown): number | null => {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= 5 ? numeric : null;
};

/**
 * Maps one row to the public projection, or `null` when it is not publishable.
 *
 * Defence in depth on top of the `published_reviews` view and its RLS policy:
 * an explicit non-approved moderation status, a withheld consent flag or a
 * missing published body fails closed. Reply text is included only when the row
 * does not carry a non-published reply status.
 */
export function mapPublicReviewRow(row: unknown): PublicReview | null {
    if (!isRecord(row)) return null;
    if (typeof row.id !== "string" || !UUID.test(row.id)) return null;

    if (
        typeof row.moderation_status === "string" &&
        row.moderation_status !== "approved"
    )
        return null;
    if (row.consent === false) return null;

    const body = text(row.body_published);
    if (!body) return null;

    const replyStatus =
        typeof row.reply_status === "string" ? row.reply_status : null;
    const replyVisible =
        !replyStatus || replyStatus === "published" || replyStatus === "none";

    return {
        id: row.id,
        name: text(row.customer_name),
        rating: nullableRating(row.rating),
        branch: nullableText(row.branch),
        body,
        publishedAt: nullableInstant(row.published_at),
        publishedVersion:
            Number.isFinite(Number(row.published_version)) &&
            Number(row.published_version) > 0
                ? Number(row.published_version)
                : null,
        reply: replyVisible ? nullableText(row.reply_body) : null,
        replyPublishedAt: replyVisible
            ? nullableInstant(row.reply_published_at)
            : null,
    };
}

/** Validates the already-projected shape returned by `/api/reviews/public`. */
export function mapPublicReviewPayload(value: unknown): PublicReview | null {
    if (!isRecord(value)) return null;
    if (typeof value.id !== "string" || !UUID.test(value.id)) return null;
    if (typeof value.name !== "string") return null;
    if (typeof value.body !== "string" || !value.body.trim()) return null;
    if (
        value.rating !== null &&
        (typeof value.rating !== "number" ||
            !Number.isInteger(value.rating) ||
            value.rating < 1 ||
            value.rating > 5)
    )
        return null;
    if (value.branch !== null && typeof value.branch !== "string") return null;
    if (
        value.publishedAt !== null &&
        (typeof value.publishedAt !== "string" ||
            Number.isNaN(Date.parse(value.publishedAt)))
    )
        return null;
    if (
        value.publishedVersion !== null &&
        (typeof value.publishedVersion !== "number" ||
            !Number.isInteger(value.publishedVersion) ||
            value.publishedVersion < 1)
    )
        return null;
    if (value.reply !== null && typeof value.reply !== "string") return null;
    if (
        value.replyPublishedAt !== null &&
        (typeof value.replyPublishedAt !== "string" ||
            Number.isNaN(Date.parse(value.replyPublishedAt)))
    )
        return null;

    return {
        id: value.id,
        name: value.name.trim(),
        rating: value.rating,
        branch: nullableText(value.branch),
        body: value.body.trim(),
        publishedAt: value.publishedAt,
        publishedVersion: value.publishedVersion,
        reply: nullableText(value.reply),
        replyPublishedAt: value.replyPublishedAt,
    };
}

/** Bounds the list and drops every row that is not publishable. */
export function projectPublicReviews(rows: unknown): PublicReview[] {
    return projectReviewList(rows, mapPublicReviewRow);
}

/** Bounds and validates the public API's camelCase review payloads. */
export function projectPublicReviewPayloads(payload: unknown): PublicReview[] {
    return projectReviewList(payload, mapPublicReviewPayload);
}

function projectReviewList(
    rows: unknown,
    mapReview: (value: unknown) => PublicReview | null,
): PublicReview[] {
    if (!Array.isArray(rows)) return [];
    const reviews: PublicReview[] = [];
    for (const row of rows) {
        const mapped = mapReview(row);
        if (mapped) reviews.push(mapped);
        if (reviews.length >= PUBLIC_REVIEW_LIMIT) break;
    }
    return reviews;
}

/**
 * Mirrors the live predicate for the isolated demo store: approved, consented
 * reviews only. Demo reviews have no separate publication version, so the
 * approved record is the published text (exactly as before Sprint 3C).
 */
export function demoPublicReviews(leads: Lead[]): PublicReview[] {
    return leads
        .filter(
            (lead) =>
                lead.kind === "review" &&
                lead.status === "approved" &&
                lead.fields.consent === "yes",
        )
        .map((lead) => {
            const rating = Number(lead.fields.rating);
            return {
                id: lead.id,
                name: lead.fields.name ?? "",
                rating:
                    Number.isInteger(rating) && rating >= 1 && rating <= 5
                        ? rating
                        : null,
                branch: lead.fields.branch || null,
                body: (lead.fields.review ?? "").trim(),
                publishedAt: lead.createdAt,
                publishedVersion: 1,
                reply: null,
                replyPublishedAt: null,
            } satisfies PublicReview;
        })
        .filter((review) => review.body.length > 0)
        .slice(0, PUBLIC_REVIEW_LIMIT);
}
