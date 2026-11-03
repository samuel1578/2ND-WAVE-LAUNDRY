import { createHash, randomUUID } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { isElevatedConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { databaseEnquiryRateLimiter } from "@/lib/enquiries/rate-limit";
import { submitEnquiry } from "@/lib/enquiries/repository";
import { handleEnquirySubmission } from "@/lib/enquiries/submission";
import { dispatchPendingEmails } from "@/lib/email/dispatch";
import { enquiryReceivedTemplates } from "@/lib/email/templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_BODY_BYTES = 12 * 1024;
function identity(request: NextRequest): string {
    const forwarded = request.headers.get("x-forwarded-for") ?? "";
    const address = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
    return createHash("sha256").update(address).digest("hex").slice(0, 32);
}
async function readBoundedBody(request: NextRequest): Promise<string | null> {
    const reader = request.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
}
function reject(status: number, code: string, message: string, correlationId: string) {
    return NextResponse.json({ ok: false, code, message, correlationId }, { status, headers: NO_STORE });
}
export async function POST(request: NextRequest) {
    const correlationId = randomUUID();
    if ((request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json")
        return reject(415, "unsupported_media_type", "Send the enquiry as JSON.", correlationId);
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
        return reject(413, "payload_too_large", "The enquiry is too large.", correlationId);
    let raw: string | null;
    try { raw = await readBoundedBody(request); } catch { return reject(400, "malformed_json", "The enquiry could not be read.", correlationId); }
    if (raw === null) return reject(413, "payload_too_large", "The enquiry is too large.", correlationId);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return reject(400, "malformed_json", "The enquiry could not be read.", correlationId); }
    const origin = checkRequestOrigin({
        origin: request.headers.get("origin"), host: request.headers.get("host"),
        forwardedHost: request.headers.get("x-forwarded-host"),
        siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null,
    });
    const response = await handleEnquirySubmission({
        body, idempotencyKey: request.headers.get("idempotency-key"), origin,
        identity: identity(request), correlationId,
    }, {
        configured: isSupabaseConfigured && isElevatedConfigured,
        rateLimiter: isSupabaseConfigured && isElevatedConfigured ? databaseEnquiryRateLimiter : null,
        submit: async (input) => {
            const result = await submitEnquiry(input);
            if (!result.ok) {
                if (result.dbError) console.warn(`[enquiries] storage error code=${result.dbError.code ?? "unknown"} correlation=${correlationId}`);
                return { ok: false, code: result.code };
            }
            return { ok: true, enquiryId: result.data.enquiryId, isNew: result.data.isNew };
        },
    });
    if (response.body.ok === true)
        after(() => dispatchPendingEmails("enquiry_submit", enquiryReceivedTemplates));
    return NextResponse.json(response.body, { status: response.status, headers: response.headers });
}
export function GET() {
    return NextResponse.json({ ok: false, code: "method_not_allowed", message: "Use POST to send an enquiry." }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
