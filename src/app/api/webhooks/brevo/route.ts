import { NextResponse, type NextRequest } from "next/server";
import { readBrevoWebhookConfig } from "@/lib/email/config";
import { handleBrevoWebhook } from "@/lib/email/webhook";
import { createBrevoWebhookRepository } from "@/lib/email/webhook-repository";

/**
 * Brevo transactional webhook endpoint.
 *
 * Brevo is configured with bearer-token authentication (or custom headers) when
 * the webhook is created. The handler verifies that token in constant time,
 * accepts POST JSON only, normalises the event and stores only the minimum
 * delivery-event fields. Forged or replayed requests are rejected/deduplicated.
 *
 * If the secret or Supabase configuration is missing, the endpoint fails closed
 * with 503 so Brevo retries after the operator fixes configuration.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_DECLARED_BYTES = 16 * 1024;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_DECLARED_BYTES) {
    return json({ ok: false, code: "payload_too_large" }, 413);
  }

  const config = readBrevoWebhookConfig();
  if (!config.ok) return json({ ok: false, code: "not_configured" }, 503);

  let repository;
  try {
    repository = createBrevoWebhookRepository();
  } catch {
    return json({ ok: false, code: "not_configured" }, 503);
  }

  const bodyText = await request.text();
  const result = await handleBrevoWebhook(
    {
      method: "POST",
      authorization: request.headers.get("authorization"),
      contentType: request.headers.get("content-type"),
      bodyText,
    },
    { secret: config.secret, repository },
  );

  return json(result.body, result.status);
}

export async function GET() {
  return json({ ok: false, code: "method_not_allowed" }, 405);
}

export async function PUT() {
  return json({ ok: false, code: "method_not_allowed" }, 405);
}

export async function PATCH() {
  return json({ ok: false, code: "method_not_allowed" }, 405);
}

export async function DELETE() {
  return json({ ok: false, code: "method_not_allowed" }, 405);
}
