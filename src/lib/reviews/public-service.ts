/**
 * Public review list logic (Sprint 3C; read path hardened at handover).
 *
 * The rows come from `public.published_reviews`, read by the server-only
 * secret-key reader in `./public-reader` (anon has no access to the review
 * tables since 20261113190000_handover_cleanup.sql). Rows are then projected
 * through the `PublicReview` whitelist, so private columns can never reach the
 * response even if the view changed.
 *
 * This module has no Supabase import so the projection and failure handling can
 * be tested with injected rows. Failures fail closed: the public surface returns
 * no reviews rather than sample data or an error body.
 */

import { SupabaseConfigError } from "@/lib/supabase/config";
import { projectPublicReviews, type PublicReview } from "./public";

export type PublishedReviewRows = { data: unknown; error: unknown };

export type PublishedReviewFetcher = () => Promise<PublishedReviewRows>;

export type PublicReviewListResult =
    | { ok: true; reviews: PublicReview[] }
    | { ok: false; code: "not_configured" | "storage_unavailable" };

const isConfigError = (error: unknown) =>
    error instanceof SupabaseConfigError ||
    (error instanceof Error && error.name === "SupabaseElevatedConfigError");

export async function loadPublishedReviews(
    fetcher: PublishedReviewFetcher,
): Promise<PublicReviewListResult> {
    if (typeof window !== "undefined")
        throw new Error("Published review reads are server-only.");

    let result: PublishedReviewRows;
    try {
        result = await fetcher();
    } catch (error) {
        return {
            ok: false,
            code: isConfigError(error) ? "not_configured" : "storage_unavailable",
        };
    }

    if (result.error) return { ok: false, code: "storage_unavailable" };
    return { ok: true, reviews: projectPublicReviews(result.data) };
}
