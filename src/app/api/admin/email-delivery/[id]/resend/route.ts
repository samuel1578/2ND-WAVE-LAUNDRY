import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { canManageEmailDelivery } from "@/lib/email/monitoring";
import { createEmailOutboxRepository } from "@/lib/email/outbox-repository";
import { readTransactionalEmailConfig } from "@/lib/email/config";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { dispatchPendingEmails } from "@/lib/email/dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return json({ code: "unauthenticated" }, 401);
  if (!canManageEmailDelivery(admin.role)) return json({ code: "permission_denied" }, 403);
  const { id: sourceId } = await context.params;
  if (!UUID.test(sourceId)) return json({ code: "invalid_request" }, 400);

  const origin = checkRequestOrigin({
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });
  if (!origin.ok) return json({ code: "permission_denied" }, 403);
  const config = readTransactionalEmailConfig();
  if (!config.ok)
    return json({ code: config.reason === "disabled" ? "email_disabled" : "not_configured" }, 503);
  const limit = consumeRateLimit("email_retry", admin.userId);
  if (!limit.ok)
    return NextResponse.json(
      { code: "rate_limited" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } },
    );

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 2048) return json({ code: "invalid_request" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ code: "invalid_request" }, 400);
  }
  if (
    typeof body !== "object" || body === null ||
    Object.keys(body).some((key) => key !== "reason") ||
    typeof (body as Record<string, unknown>).reason !== "string"
  ) return json({ code: "invalid_request" }, 400);
  const reason = ((body as { reason: string }).reason).trim();
  if (reason.length < 3 || reason.length > 500 || /[\r\n]/.test(reason))
    return json({ code: "invalid_request" }, 400);

  try {
    const id = await createEmailOutboxRepository().resend({
      id: sourceId,
      actorId: admin.userId,
      reason,
      correlationId: randomUUID(),
    });
    after(() => dispatchPendingEmails("admin_email_resend"));
    return json({ ok: true, id, message: "A deliberate resend was queued." }, 202);
  } catch {
    return json({ code: "email_resend_not_available" }, 409);
  }
}
