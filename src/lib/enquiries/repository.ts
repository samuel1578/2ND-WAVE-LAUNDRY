import "server-only";
import { createSupabaseAdminClient, SupabaseElevatedConfigError } from "@/lib/supabase/admin";
import type { EnquiryKind, EnquirySubmission } from "./validation";

export type EnquiryErrorCode = "not_configured" | "storage_unavailable" | "idempotency_mismatch" | "conflict" | "not_found" | "invalid_status" | "invalid_note";
export type EnquiryNote = { text: string; at: string; by: string };
export type EnquiryRecord = {
    id: string;
    kind: EnquiryKind;
    status: "new" | "contacted" | "closed";
    name: string;
    business: string | null;
    phone: string;
    email: string | null;
    topic: string | null;
    message: string | null;
    details: Record<string, unknown>;
    notes: EnquiryNote[];
    version: number;
    createdAt: string;
    updatedAt: string;
};
export type EnquiryRepositoryResult<T> = { ok: true; data: T } | { ok: false; code: EnquiryErrorCode; dbError?: { code: string | null; message: string; hint: string | null } };
function mapError(message: string): EnquiryErrorCode {
    if (message.includes("ENQUIRY_IDEMPOTENCY_MISMATCH")) return "idempotency_mismatch";
    if (message.includes("ENQUIRY_VERSION_CONFLICT")) return "conflict";
    if (message.includes("ENQUIRY_NOT_FOUND")) return "not_found";
    if (message.includes("ENQUIRY_INVALID_STATUS")) return "invalid_status";
    if (message.includes("ENQUIRY_INVALID_NOTE")) return "invalid_note";
    return "storage_unavailable";
}
function record(row: Record<string, unknown>): EnquiryRecord {
    const details = row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details as Record<string, unknown> : {};
    const notes = Array.isArray(row.notes) ? row.notes.filter((note): note is EnquiryNote => !!note && typeof note === "object" && typeof (note as EnquiryNote).text === "string" && typeof (note as EnquiryNote).at === "string" && typeof (note as EnquiryNote).by === "string") : [];
    return {
        id: String(row.id ?? ""), kind: row.kind === "commercial" ? "commercial" : "general",
        status: row.status === "contacted" || row.status === "closed" ? row.status : "new",
        name: String(row.name ?? ""), business: typeof row.business === "string" ? row.business : null,
        phone: String(row.phone ?? ""), email: typeof row.email === "string" ? row.email : null,
        topic: typeof row.topic === "string" ? row.topic : null, message: typeof row.message === "string" ? row.message : null,
        details, notes, version: Number(row.version ?? 1), createdAt: String(row.created_at ?? ""), updatedAt: String(row.updated_at ?? ""),
    };
}
function clientOrResult(): { client: ReturnType<typeof createSupabaseAdminClient> } | { error: EnquiryErrorCode } {
    try { return { client: createSupabaseAdminClient() }; }
    catch (error) { return { error: error instanceof SupabaseElevatedConfigError ? "not_configured" : "storage_unavailable" }; }
}
export async function submitEnquiry(input: { submission: EnquirySubmission; idempotencyKey: string; sourceIpHash: string; correlationId: string }): Promise<EnquiryRepositoryResult<{ enquiryId: string; isNew: boolean }>> {
    if (typeof window !== "undefined") throw new Error("Enquiry repository is server-only.");
    const ready = clientOrResult();
    if ("error" in ready) return { ok: false, code: ready.error };
    const s = input.submission;
    const { data, error } = await ready.client.rpc("enquiry_submit", {
        p_kind: s.kind, p_name: s.name, p_business: s.business, p_phone: s.phone, p_email: s.email,
        p_topic: s.topic, p_message: s.message, p_details: s.details, p_idempotency_key: input.idempotencyKey,
        p_source_ip_hash: input.sourceIpHash, p_recipient_email: "manager@2ndwavelaundry.com", p_correlation: input.correlationId,
    });
    if (error) return { ok: false, code: mapError(error.message), dbError: { code: error.code ?? null, message: error.message, hint: error.hint ?? null } };
    const result = data as { enquiry_id?: unknown; is_new?: unknown } | null;
    if (!result || typeof result.enquiry_id !== "string") return { ok: false, code: "storage_unavailable" };
    return { ok: true, data: { enquiryId: result.enquiry_id, isNew: result.is_new === true } };
}
export async function listEnquiries(kind: EnquiryKind): Promise<EnquiryRepositoryResult<{ records: EnquiryRecord[]; limit: 100 }>> {
    const ready = clientOrResult();
    if ("error" in ready) return { ok: false, code: ready.error };
    const { data, error } = await ready.client.from("enquiries").select("*").eq("kind", kind).order("created_at", { ascending: false }).limit(100);
    if (error) return { ok: false, code: "storage_unavailable", dbError: { code: error.code ?? null, message: error.message, hint: error.hint ?? null } };
    return { ok: true, data: { records: (data ?? []).map((row) => record(row as Record<string, unknown>)), limit: 100 } };
}
export async function getEnquiry(id: string): Promise<EnquiryRepositoryResult<EnquiryRecord>> {
    const ready = clientOrResult();
    if ("error" in ready) return { ok: false, code: ready.error };
    const { data, error } = await ready.client.from("enquiries").select("*").eq("id", id).maybeSingle();
    if (error) return { ok: false, code: "storage_unavailable", dbError: { code: error.code ?? null, message: error.message, hint: error.hint ?? null } };
    if (!data) return { ok: false, code: "not_found" };
    return { ok: true, data: record(data as Record<string, unknown>) };
}
export async function getEnquirySummary(): Promise<EnquiryRepositoryResult<{
    newCount: number;
    recent: Array<{ id: string; kind: EnquiryKind; name: string; business: string | null; status: EnquiryRecord["status"] }>;
}>> {
    const ready = clientOrResult();
    if ("error" in ready) return { ok: false, code: ready.error };
    const [countResult, recentResult] = await Promise.all([
        ready.client.from("enquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
        ready.client.from("enquiries").select("id, kind, name, business, status").order("created_at", { ascending: false }).limit(5),
    ]);
    if (countResult.error || recentResult.error) {
        const error = countResult.error ?? recentResult.error!;
        return { ok: false, code: "storage_unavailable", dbError: { code: error.code ?? null, message: error.message, hint: error.hint ?? null } };
    }
    const recent = (recentResult.data ?? []).map((row) => ({
        id: String(row.id),
        kind: row.kind === "commercial" ? "commercial" as const : "general" as const,
        name: String(row.name ?? ""),
        business: typeof row.business === "string" ? row.business : null,
        status: row.status === "contacted" || row.status === "closed" ? row.status : "new" as const,
    }));
    return { ok: true, data: { newCount: countResult.count ?? 0, recent } };
}
export async function updateEnquiry(input: { id: string; expectedVersion: number; status?: "new" | "contacted" | "closed"; note?: string; actorUserId: string; correlationId: string }): Promise<EnquiryRepositoryResult<{ version: number }>> {
    const ready = clientOrResult();
    if ("error" in ready) return { ok: false, code: ready.error };
    const { data, error } = await ready.client.rpc("enquiry_update", {
        p_id: input.id, p_expected_version: input.expectedVersion, p_new_status: input.status ?? null,
        p_note: input.note ?? null, p_actor_user_id: input.actorUserId, p_correlation: input.correlationId,
    });
    if (error) return { ok: false, code: mapError(error.message), dbError: { code: error.code ?? null, message: error.message, hint: error.hint ?? null } };
    const result = data as { version?: unknown } | null;
    return typeof result?.version === "number" ? { ok: true, data: { version: result.version } } : { ok: false, code: "storage_unavailable" };
}
