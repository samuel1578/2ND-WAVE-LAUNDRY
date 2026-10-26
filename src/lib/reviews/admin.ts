/**
 * Administrator review contracts and pure helpers (Sprint 3B).
 *
 * Framework-free and side-effect free: the list/detail projections, query
 * normalisation and row mappers are shared by the server read service, the HTTP
 * route and the unit tests, so the three cannot drift apart. A persisted row that
 * does not have the expected shape maps to `null` and is reported rather than
 * rendered as a partial record.
 *
 * `bodyOriginal` is exposed to administrators only. Public rendering (Sprint 3C)
 * must use `bodyPublished`.
 */

import {
    isModerationStatus,
    type ReviewModerationStatus,
} from "./moderation";

export const REVIEW_LIST_PAGE_SIZE = 20;
export const REVIEW_LIST_MAX_PAGE_SIZE = 50;
export const REVIEW_DETAIL_HISTORY_LIMIT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isReviewId = (value: unknown): value is string =>
    typeof value === "string" && UUID.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const asText = (value: unknown): string =>
    typeof value === "string" ? value : "";

const asNullableText = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const asNullableInstant = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    return Number.isNaN(Date.parse(value)) ? null : value;
};

const asNullableNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

/* -------------------------------------------------------------------------- */
/* Query normalisation                                                         */
/* -------------------------------------------------------------------------- */

export type ReviewListQuery = {
    search: string;
    status: ReviewModerationStatus | "";
    branch: string;
    rating: number | null;
    /** `""` (unbounded) or an inclusive `YYYY-MM-DD` date. */
    from: string;
    to: string;
    page: number;
    pageSize: number;
};

export type ReviewListPage = {
    rows: AdminReviewSummary[];
    total: number;
    page: number;
    pageSize: number;
};

/**
 * Neutralises a free-text search term for PostgREST's `or` grammar and bounds
 * its length. The result is safe to embed in an `ilike` pattern.
 */
export function sanitiseReviewSearch(value: unknown): string {
    if (typeof value !== "string") return "";
    return value
        .replace(/[\u0000-\u001f]/g, " ")
        .replace(/[,()*\\%"]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
}

export function reviewSearchFilter(term: string): string | null {
    const clean = sanitiseReviewSearch(term);
    if (!clean) return null;
    const pattern = `*${clean}*`;
    return [
        `customer_name.ilike.${pattern}`,
        `body_original.ilike.${pattern}`,
    ].join(",");
}

export function normaliseReviewListQuery(
    raw: Record<string, unknown> | null | undefined,
): ReviewListQuery {
    const source = isRecord(raw) ? raw : {};

    const statusRaw = typeof source.status === "string" ? source.status.trim() : "";
    const status: ReviewModerationStatus | "" = isModerationStatus(statusRaw)
        ? statusRaw
        : "";

    const branchRaw = sanitiseReviewSearch(source.branch);
    const branch =
        branchRaw && branchRaw.length <= 120 ? branchRaw : "";

    const ratingRaw = Number(source.rating);
    const rating =
        Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5
            ? ratingRaw
            : null;

    const fromRaw = typeof source.from === "string" ? source.from.trim() : "";
    const toRaw = typeof source.to === "string" ? source.to.trim() : "";
    const from = DATE.test(fromRaw) && !Number.isNaN(Date.parse(fromRaw)) ? fromRaw : "";
    const to = DATE.test(toRaw) && !Number.isNaN(Date.parse(toRaw)) ? toRaw : "";

    const pageRaw = Number(source.page);
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

    const sizeRaw = Number(source.pageSize);
    const pageSize =
        Number.isFinite(sizeRaw) && sizeRaw >= 1
            ? Math.min(Math.floor(sizeRaw), REVIEW_LIST_MAX_PAGE_SIZE)
            : REVIEW_LIST_PAGE_SIZE;

    return {
        search: sanitiseReviewSearch(source.search),
        status,
        branch,
        rating,
        from,
        to,
        page,
        pageSize,
    };
}

export function reviewListRange(query: ReviewListQuery): { from: number; to: number } {
    const from = (query.page - 1) * query.pageSize;
    return { from, to: from + query.pageSize - 1 };
}

/* -------------------------------------------------------------------------- */
/* Projections                                                                 */
/* -------------------------------------------------------------------------- */

export type AdminReviewSummary = {
    id: string;
    customerName: string;
    rating: number | null;
    branch: string | null;
    consent: boolean;
    moderationStatus: ReviewModerationStatus;
    published: boolean;
    publishedVersion: number | null;
    version: number;
    createdAt: string;
    moderatedAt: string | null;
};

export type ReviewReplyStatus = "none" | "draft" | "published";

export type AdminReviewDetail = AdminReviewSummary & {
    bodyOriginal: string;
    bodyPublished: string | null;
    moderationNote: string | null;
    publishedAt: string | null;
    consentVersion: string;
    updatedAt: string;
    replyStatus: ReviewReplyStatus;
    replyBody: string | null;
    replyPublishedAt: string | null;
    audit: ReviewAuditEntry[];
};

export type ReviewAuditEntry = {
    id: string;
    action: string;
    actorId: string | null;
    reason: string | null;
    beforeState: Record<string, unknown> | null;
    afterState: Record<string, unknown> | null;
    at: string;
};

export type ReviewOperationsSummary = {
    /** Reviews still awaiting a moderation decision. */
    pendingCount: number;
    /** Approved reviews currently published on the public site. */
    publishedCount: number;
};

export function mapReviewSummaryRow(row: unknown): AdminReviewSummary | null {
    if (!isRecord(row)) return null;
    if (!isReviewId(row.id)) return null;
    if (!isModerationStatus(row.moderation_status)) return null;

    const publishedVersion = asNullableNumber(row.published_version);
    return {
        id: row.id,
        customerName: asText(row.customer_name),
        rating: asNullableNumber(row.rating),
        branch: asNullableText(row.branch),
        consent: row.consent === true,
        moderationStatus: row.moderation_status,
        published: typeof row.body_published === "string" && row.body_published.trim().length > 0,
        publishedVersion:
            publishedVersion && publishedVersion > 0 ? publishedVersion : null,
        version: Number.isFinite(Number(row.version)) ? Number(row.version) : 1,
        createdAt: asText(row.created_at),
        moderatedAt: asNullableInstant(row.moderated_at),
    };
}

export function mapReviewAuditRows(value: unknown): ReviewAuditEntry[] {
    if (!Array.isArray(value)) return [];
    const entries: ReviewAuditEntry[] = [];
    for (const item of value) {
        if (!isRecord(item)) continue;
        const action = asText(item.action);
        if (!action) continue;
        entries.push({
            id: String(item.id ?? ""),
            action,
            actorId: asNullableText(item.actor_id),
            reason: asNullableText(item.reason),
            beforeState: isRecord(item.before_state) ? item.before_state : null,
            afterState: isRecord(item.after_state) ? item.after_state : null,
            at: asText(item.created_at),
        });
    }
    return entries;
}

export function mapReviewDetailRow(
    row: unknown,
    extras: { audit?: unknown } = {},
): AdminReviewDetail | null {
    const summary = mapReviewSummaryRow(row);
    if (!summary || !isRecord(row)) return null;

    const bodyOriginal = asText(row.body_original);
    if (!bodyOriginal) return null;

    return {
        ...summary,
        bodyOriginal,
        bodyPublished: asNullableText(row.body_published),
        moderationNote: asNullableText(row.moderation_note),
        publishedAt: asNullableInstant(row.published_at),
        consentVersion: asText(row.consent_version),
        updatedAt: asText(row.updated_at),
        replyStatus:
            row.reply_status === "draft" || row.reply_status === "published"
                ? row.reply_status
                : "none",
        replyBody: asNullableText(row.reply_body),
        replyPublishedAt: asNullableInstant(row.reply_published_at),
        audit: mapReviewAuditRows(extras.audit),
    };
}

/**
 * In-memory application of the queue filters. The live query applies the same
 * rules in SQL; this mirrors them for tests and the demo store.
 */
export function applyReviewFilters(
    rows: AdminReviewSummary[],
    query: ReviewListQuery,
): AdminReviewSummary[] {
    const term = query.search.trim().toLowerCase();
    return rows.filter((row) => {
        if (
            term &&
            !`${row.customerName} ${row.branch ?? ""}`.toLowerCase().includes(term)
        )
            return false;
        if (query.status && row.moderationStatus !== query.status) return false;
        if (query.branch && row.branch !== query.branch) return false;
        if (query.rating !== null && row.rating !== query.rating) return false;
        if (query.from && row.createdAt.slice(0, 10) < query.from) return false;
        if (query.to && row.createdAt.slice(0, 10) > query.to) return false;
        return true;
    });
}
