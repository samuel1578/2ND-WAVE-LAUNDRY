import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isElevatedConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { resolveReviewRateLimiter } from "@/lib/reviews/rate-limit";
import { reviewConsentVersion } from "@/lib/reviews/config";
import { submitReview } from "@/lib/reviews/repository";
import { handleReviewSubmission } from "@/lib/reviews/submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024;
const NO_STORE = { "Cache-Control": "no-store" } as const;
const IDEMPOTENCY_HEADER = "idempotency-key";

function reject(status: number, code: string, message: string, correlationId: string) {
    return NextResponse.json(
        { ok: false, code, message, correlationId },
        { status, headers: NO_STORE },
    );
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
        if (size > MAX_BODY_BYTES) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

function hashedIdentity(request: NextRequest): string {
    const forwarded = request.headers.get("x-forwarded-for") ?? "";
    const address = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
    return createHash("sha256").update(address).digest("hex").slice(0, 32);
}

export async function POST(request: NextRequest) {
    const correlationId = randomUUID();
    const contentType = (request.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
    if (contentType !== "application/json")
        return reject(415, "unsupported_media_type", "Send the review as JSON.", correlationId);

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
        return reject(413, "payload_too_large", "The review is too large.", correlationId);

    let text: string | null;
    try {
        text = await readBoundedBody(request);
    } catch {
        return reject(400, "malformed_json", "The review could not be read.", correlationId);
    }
    if (text === null)
        return reject(413, "payload_too_large", "The review is too large.", correlationId);

    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        return reject(400, "malformed_json", "The review could not be read.", correlationId);
    }

    const origin = checkRequestOrigin({
        origin: request.headers.get("origin"),
        host: request.headers.get("host"),
        forwardedHost: request.headers.get("x-forwarded-host"),
        siteUrl: process.env.SITE_URL,
    });
    const configured = isSupabaseConfigured && isElevatedConfigured;
    const limiter = configured ? resolveReviewRateLimiter() : null;
    const response = await handleReviewSubmission(
        {
            body,
            idempotencyKey: request.headers.get(IDEMPOTENCY_HEADER) || null,
            origin,
            identity: hashedIdentity(request),
            correlationId,
        },
        {
            configured,
            consentVersion: reviewConsentVersion,
            rateLimiter: limiter,
            submit: (input) => submitReview(input),
        },
    );

    if (response.status >= 400)
        console.warn(`[reviews] submission rejected status=${response.status} code=${String(response.body.code)} correlation=${correlationId}`);

    return NextResponse.json(response.body, {
        status: response.status,
        headers: response.headers,
    });
}

export async function GET() {
    return NextResponse.json(
        { ok: false, code: "method_not_allowed", message: "Use POST to submit a review." },
        { status: 405, headers: { ...NO_STORE, Allow: "POST" } },
    );
}
