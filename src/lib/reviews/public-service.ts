/**
 * Server-only public review reader (Sprint 3C).
 *
 * Reads `public.published_reviews` with the public (publishable-key) session
 * client, so row level security and the narrow column grants decide what is
 * visible. The view is `security_invoker`; anonymous callers can only ever see
 * approved, consented, published, non-deleted rows.
 *
 * The row source is injectable so the public payload can be tested against
 * hostile rows without a database. Failures fail closed: the public surface
 * returns no reviews rather than falling back to sample data or an error body.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseConfigError } from "@/lib/supabase/config";
import {
    PUBLIC_REVIEW_COLUMNS,
    PUBLIC_REVIEW_LIMIT,
    projectPublicReviews,
    type PublicReview,
} from "./public";

export type PublishedReviewRows = { data: unknown; error: unknown };

export type PublishedReviewFetcher = () => Promise<PublishedReviewRows>;

export type PublicReviewListResult =
    | { ok: true; reviews: PublicReview[] }
    | { ok: false; code: "not_configured" | "storage_unavailable" };

/** Default reader: the public site's own anon/publishable-key client. */
export const fetchPublishedReviewRows: PublishedReviewFetcher = async () => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
        .from("published_reviews")
        .select(PUBLIC_REVIEW_COLUMNS)
        .order("published_at", { ascending: false })
        .limit(PUBLIC_REVIEW_LIMIT);
    return { data, error };
};

export async function loadPublishedReviews(
    fetcher: PublishedReviewFetcher = fetchPublishedReviewRows,
): Promise<PublicReviewListResult> {
    if (typeof window !== "undefined")
        throw new Error("Published review reads are server-only.");

    let result: PublishedReviewRows;
    try {
        result = await fetcher();
    } catch (error) {
        return {
            ok: false,
            code: error instanceof SupabaseConfigError ? "not_configured" : "storage_unavailable",
        };
    }

    if (result.error) return { ok: false, code: "storage_unavailable" };
    return { ok: true, reviews: projectPublicReviews(result.data) };
}
