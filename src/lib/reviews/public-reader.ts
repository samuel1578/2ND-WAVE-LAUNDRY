import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_REVIEW_COLUMNS, PUBLIC_REVIEW_LIMIT } from "./public";
import type { PublishedReviewFetcher } from "./public-service";

/**
 * Reads published reviews with the server-only secret-key client.
 *
 * Anonymous (publishable-key) access to `review_submissions` and
 * `published_reviews` is revoked, because a column grant let anyone read draft
 * replies. The view itself filters to approved, consented, published,
 * non-deleted rows and exposes a reply only once it is published; only
 * `PUBLIC_REVIEW_COLUMNS` are selected. Never import this from client code.
 */
export const fetchPublishedReviewRows: PublishedReviewFetcher = async () => {
    const client = createSupabaseAdminClient();
    const { data, error } = await client
        .from("published_reviews")
        .select(PUBLIC_REVIEW_COLUMNS)
        .order("published_at", { ascending: false })
        .limit(PUBLIC_REVIEW_LIMIT);
    return { data, error };
};
