import { createSupabaseAdminClient, SupabaseElevatedConfigError } from "@/lib/supabase/admin";
import type { NewsletterErrorCode } from "./errors";
import type { NewsletterSubmission } from "./validation";

export type NewsletterRepositoryResult =
    | { ok: true; interestId: string; isNew: boolean }
    | { ok: false; code: NewsletterErrorCode };

function mapDatabaseError(message: string): NewsletterErrorCode {
    const mappings: Array<[string, NewsletterErrorCode]> = [
        ["NEWSLETTER_IDEMPOTENCY_REQUIRED", "idempotency_required"],
        ["NEWSLETTER_INVALID_EMAIL", "invalid_email"],
        ["NEWSLETTER_CONSENT_REQUIRED", "consent_required"],
        ["NEWSLETTER_NOTICE_UNAVAILABLE", "not_configured"],
        ["NEWSLETTER_RECIPIENT_INVALID", "not_configured"],
        ["NEWSLETTER_INVALID_PAYLOAD", "invalid_payload"],
    ];
    return mappings.find(([marker]) => message.includes(marker))?.[1] ?? "storage_unavailable";
}

/**
 * Inserts one consented interest submission and queues the single manager
 * alert, both inside the database transaction of `newsletter_interest_submit`.
 * A duplicate address returns `isNew: false` — the row exists, no second alert
 * was queued, and the HTTP layer still answers with the generic success body.
 */
export async function submitNewsletterInterest(input: {
    submission: NewsletterSubmission;
    idempotencyKey: string;
    sourceIpHash: string;
    consentVersion: string;
    managerEmail: string;
    correlationId: string;
}): Promise<NewsletterRepositoryResult> {
    if (typeof window !== "undefined") throw new Error("The newsletter repository is server-only.");

    let client;
    try {
        client = createSupabaseAdminClient();
    } catch (error) {
        return {
            ok: false,
            code: error instanceof SupabaseElevatedConfigError ? "not_configured" : "conflict",
        };
    }

    const { data, error } = await client.rpc("newsletter_interest_submit", {
        p_email: input.submission.email,
        p_consent: input.submission.consent,
        p_consent_version: input.consentVersion,
        p_source_ip_hash: input.sourceIpHash,
        p_recipient_email: input.managerEmail,
        p_idempotency_key: input.idempotencyKey,
        p_correlation: input.correlationId,
    });
    if (error) return { ok: false, code: mapDatabaseError(error.message) };

    const result = data as { interest_id?: unknown; is_new?: unknown } | null;
    if (!result || typeof result.interest_id !== "string") return { ok: false, code: "conflict" };
    return { ok: true, interestId: result.interest_id, isNew: result.is_new === true };
}

export type NewsletterInterestRecord = {
    id: string;
    email: string;
    consentVersion: string;
    source: string;
    createdAt: string;
};

export type NewsletterListResult =
    | { ok: true; records: NewsletterInterestRecord[] }
    | { ok: false; reason: "not_configured" | "unavailable" };

/** Read-only list for the administration console. Full Admin route only. */
export async function listNewsletterInterest(): Promise<NewsletterListResult> {
    if (typeof window !== "undefined") throw new Error("The newsletter repository is server-only.");

    let client;
    try {
        client = createSupabaseAdminClient();
    } catch (error) {
        return {
            ok: false,
            reason: error instanceof SupabaseElevatedConfigError ? "not_configured" : "unavailable",
        };
    }

    const { data, error } = await client
        .from("newsletter_interest")
        .select("id, email, consent_version, source, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
    if (error) return { ok: false, reason: "unavailable" };

    const rows = (data ?? []) as Array<{
        id?: unknown;
        email?: unknown;
        consent_version?: unknown;
        source?: unknown;
        created_at?: unknown;
    }>;
    return {
        ok: true,
        records: rows.map((row) => ({
            id: typeof row.id === "string" ? row.id : "",
            email: typeof row.email === "string" ? row.email : "",
            consentVersion: typeof row.consent_version === "string" ? row.consent_version : "",
            source: typeof row.source === "string" ? row.source : "",
            createdAt: typeof row.created_at === "string" ? row.created_at : "",
        })),
    };
}
