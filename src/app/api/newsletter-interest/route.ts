import { createHash, randomUUID } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { isElevatedConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { readNewsletterInterestConfig } from "@/lib/newsletter/config";
import { resolveNewsletterRateLimiter } from "@/lib/newsletter/rate-limit";
import { submitNewsletterInterest } from "@/lib/newsletter/repository";
import { handleNewsletterInterestSubmission } from "@/lib/newsletter/submission";
import { dispatchPendingEmails } from "@/lib/email/dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public newsletter interest endpoint (Phase 5 MVP).
 *
 * Adapter only: it establishes the origin, a hashed client identity and a
 * bounded JSON body, then delegates every decision to
 * `handleNewsletterInterestSubmission`. Success means one consented row was
 * stored (first-time address only) and exactly one manager alert was queued in
 * the same database transaction. The response is generic: it never reveals
 * whether the address was new, so probing for subscribers is impossible.
 */

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

/** Hashes the client address so no raw IP is ever stored or logged. */
function hashedIdentity(request: NextRequest): string {
    const forwarded = request.headers.get("x-forwarded-for") ?? "";
    const address =
        forwarded.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip")?.trim() ||
        "unknown";
    return createHash("sha256").update(address).digest("hex").slice(0, 32);
}

export async function POST(request: NextRequest) {
    const correlationId = randomUUID();
    const contentType = (request.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
    if (contentType !== "application/json")
        return reject(415, "unsupported_media_type", "Send the sign-up as JSON.", correlationId);

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
        return reject(413, "payload_too_large", "The sign-up is too large.", correlationId);

    let text: string | null;
    try {
        text = await readBoundedBody(request);
    } catch {
        return reject(400, "malformed_json", "The sign-up could not be read.", correlationId);
    }
    if (text === null)
        return reject(413, "payload_too_large", "The sign-up is too large.", correlationId);

    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        return reject(400, "malformed_json", "The sign-up could not be read.", correlationId);
    }

    const config = readNewsletterInterestConfig();
    const origin = checkRequestOrigin({
        origin: request.headers.get("origin"),
        host: request.headers.get("host"),
        forwardedHost: request.headers.get("x-forwarded-host"),
        siteUrl: process.env.SITE_URL,
    });
    const configured =
        config.enabled && isSupabaseConfigured && isElevatedConfigured;
    const limiter = configured ? resolveNewsletterRateLimiter() : null;

    const response = await handleNewsletterInterestSubmission(
        {
            body,
            idempotencyKey: request.headers.get(IDEMPOTENCY_HEADER) || null,
            origin,
            identity: hashedIdentity(request),
            correlationId,
        },
        {
            configured,
            consentVersion: config.consentVersion,
            managerEmail: config.managerEmail,
            rateLimiter: limiter,
            submit: (input) => submitNewsletterInterest(input),
        },
    );

    if (response.status >= 400)
        console.warn(
            `[newsletter] submission rejected status=${response.status} code=${String(response.body.code)} correlation=${correlationId}`,
        );

    // Best-effort post-commit delivery: the outbox row is already committed, so
    // a lost kick only delays the alert until the scheduled worker picks it up.
    if (response.body.ok === true) {
        after(() => dispatchPendingEmails("newsletter_interest_submit"));
    }

    return NextResponse.json(response.body, {
        status: response.status,
        headers: response.headers,
    });
}

export async function GET() {
    return NextResponse.json(
        { ok: false, code: "method_not_allowed", message: "Use POST to register interest." },
        { status: 405, headers: { ...NO_STORE, Allow: "POST" } },
    );
}
