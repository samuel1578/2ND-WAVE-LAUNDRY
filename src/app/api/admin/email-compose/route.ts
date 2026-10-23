import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { canManageEmailDelivery } from "@/lib/email/monitoring";
import { readBrevoApiKey } from "@/lib/email/config";
import {
  listActiveBrevoSenders,
  sanitizeManualEmailHtml,
  sendManualBrevoEmail,
} from "@/lib/email/manual";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { validEmail } from "@/lib/rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
const MAX_SUBJECT_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 10_000;

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function authorisedAdmin() {
  const admin = await getCurrentAdmin();
  if (!admin) return { response: json({ code: "unauthenticated" }, 401) };
  if (!canManageEmailDelivery(admin.role))
    return { response: json({ code: "permission_denied" }, 403) };
  return { admin };
}

function senderErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith("brevo_senders_http_") ? 502 : 503;
}

export async function GET() {
  const access = await authorisedAdmin();
  if ("response" in access) return access.response;

  const credentials = readBrevoApiKey();
  if (!credentials.ok)
    return json(
      {
        code: credentials.reason === "disabled" ? "email_disabled" : "not_configured",
      },
      503,
    );

  try {
    const senders = await listActiveBrevoSenders(credentials.apiKey);
    return json({ senders }, 200);
  } catch (error) {
    console.error(
      `[email] sender list unavailable reason=${error instanceof Error ? error.message : "unknown"}`,
    );
    return json({ code: "sender_list_unavailable" }, senderErrorStatus(error));
  }
}

export async function POST(request: NextRequest) {
  const access = await authorisedAdmin();
  if ("response" in access) return access.response;
  const { admin } = access;

  const origin = checkRequestOrigin({
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });
  if (!origin.ok) return json({ code: "permission_denied" }, 403);

  const credentials = readBrevoApiKey();
  if (!credentials.ok)
    return json(
      {
        code: credentials.reason === "disabled" ? "email_disabled" : "not_configured",
      },
      503,
    );

  const limit = consumeRateLimit("email_send", admin.userId);
  if (!limit.ok)
    return NextResponse.json(
      { code: "rate_limited" },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "Retry-After": String(limit.retryAfterSeconds),
        },
      },
    );

  if (Number(request.headers.get("content-length") ?? 0) > MAX_MESSAGE_LENGTH + 2_000)
    return json({ code: "invalid_request" }, 413);

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_MESSAGE_LENGTH + 2_000)
      return json({ code: "invalid_request" }, 413);
    body = JSON.parse(rawBody);
  } catch {
    return json({ code: "invalid_request" }, 400);
  }
  if (typeof body !== "object" || body === null)
    return json({ code: "invalid_request" }, 400);

  const values = body as Record<string, unknown>;
  const recipientEmail =
    typeof values.recipientEmail === "string" ? values.recipientEmail.trim() : "";
  const subject = typeof values.subject === "string" ? values.subject.trim() : "";
  const messageHtml =
    typeof values.messageHtml === "string" ? values.messageHtml : "";
  const senderId = values.senderId;
  const safeMessageHtml = sanitizeManualEmailHtml(messageHtml);
  const messageText = safeMessageHtml
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .trim();

  if (
    typeof senderId !== "number" ||
    !Number.isSafeInteger(senderId) ||
    senderId < 1 ||
    !validEmail(recipientEmail) ||
    subject.length < 1 ||
    subject.length > MAX_SUBJECT_LENGTH ||
    /[\r\n]/.test(subject) ||
    messageHtml.length > MAX_MESSAGE_LENGTH ||
    messageText.length < 1
  )
    return json({ code: "invalid_request" }, 400);

  try {
    const senders = await listActiveBrevoSenders(credentials.apiKey);
    const sender = senders.find((candidate) => candidate.id === senderId);
    if (!sender) return json({ code: "sender_unavailable" }, 400);

    const result = await sendManualBrevoEmail(credentials.apiKey, {
      sender,
      recipientEmail,
      subject,
      messageHtml: safeMessageHtml,
    });
    if (!result.ok) {
      console.warn(`[email] manual send failed reason=${result.reason}`);
      return json({ code: "send_failed" }, 502);
    }

    return json({ ok: true, messageId: result.providerMessageId }, 202);
  } catch (error) {
    console.error(
      `[email] manual send unavailable reason=${error instanceof Error ? error.message : "unknown"}`,
    );
    return json({ code: "send_unavailable" }, senderErrorStatus(error));
  }
}
