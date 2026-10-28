import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import {
  EMAIL_TEST_RECIPIENT_VAR,
  readDeliveryTemplateIds,
  readEmailTestRecipient,
  readTransactionalEmailConfig,
} from "@/lib/email/config";
import { createEmailOutboxRepository } from "@/lib/email/outbox-repository";
import { canManageEmailDelivery, isEmailTemplate } from "@/lib/email/monitoring";
import {
  buildBrevoTemplateParams,
  buildStaffOrderTemplateParams,
  validateEmailTemplateParams,
  type BookingEmailContext,
  type NotificationTemplate,
  type StaffNotificationContext,
} from "@/lib/email/templates";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { dispatchPendingEmails } from "@/lib/email/dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
const TEST_CONTEXT: BookingEmailContext = {
  reference: "2W-ABCDEFGHJK",
  customerName: "Template Preview",
  serviceTitles: ["Wash, Ironing & Fold"],
  requestedDate: "2099-01-01",
  requestedTime: "09:00",
  agreedPickupAt: "2099-01-01T09:00:00.000Z",
  agreedFee: 50,
  currency: "GHS",
  branch: { title: "Ashaiman–Atadeka" },
};
const TEST_STAFF: StaffNotificationContext = {
  previousStatus: "pending",
  actorType: "system",
  actorName: "Template Preview",
  actorRole: null,
  occurredAt: "2099-01-01T09:00:00.000Z",
  cancellationReason: "Controlled template test.",
};

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return json({ code: "unauthenticated" }, 401);
  if (!canManageEmailDelivery(admin.role))
    return json({ code: "permission_denied" }, 403);

  const origin = checkRequestOrigin({
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });
  if (!origin.ok) return json({ code: "permission_denied" }, 403);

  const limit = consumeRateLimit("email_send", admin.userId);
  if (!limit.ok)
    return NextResponse.json(
      { code: "rate_limited" },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) },
      },
    );

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 1024) return json({ code: "invalid_request" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ code: "invalid_request" }, 400);
  }
  if (
    typeof body !== "object" || body === null ||
    !isEmailTemplate((body as Record<string, unknown>).template) ||
    Object.keys(body).some((key) => key !== "template")
  ) return json({ code: "invalid_request" }, 400);

  const template = (body as { template: NotificationTemplate }).template;
  if (!isEmailTemplate(template)) return json({ code: "invalid_request" }, 400);
  // The newsletter manager alert renders from a committed sign-up payload; the
  // controlled fixture path only knows booking contexts, so it is not testable.
  if (template === "newsletter_interest_received")
    return json({ code: "template_not_testable" }, 400);
  const recipient = readEmailTestRecipient();
  if (!recipient.ok)
    return json({ code: "test_recipient_not_configured", variable: EMAIL_TEST_RECIPIENT_VAR }, 503);

  const config = readTransactionalEmailConfig();
  if (!config.ok)
    return json({ code: config.reason === "disabled" ? "email_disabled" : "not_configured" }, 503);

  const { templateIds } = readDeliveryTemplateIds();
  const templateId = templateIds[template];
  if (typeof templateId !== "number")
    return json({ code: "template_not_configured" }, 409);

  let params: Record<string, string>;
  try {
    params = template.startsWith("staff_order_")
      ? buildStaffOrderTemplateParams(
          template as Extract<NotificationTemplate, `staff_order_${string}`>,
          TEST_CONTEXT,
          TEST_STAFF,
          { siteUrl: config.config.siteUrl },
        )
      : buildBrevoTemplateParams(
          template as Exclude<
            NotificationTemplate,
            `staff_order_${string}` | "newsletter_interest_received"
          >,
          TEST_CONTEXT,
          { siteUrl: config.config.siteUrl },
        );
    validateEmailTemplateParams(template, params);
  } catch {
    return json({ code: "email_template_params_failed" }, 422);
  }

  try {
    const id = await createEmailOutboxRepository().createTestSend({
      template,
      recipientEmail: recipient.email,
      testContext: {
        booking: TEST_CONTEXT,
        ...(template.startsWith("staff_order_") ? { staff: TEST_STAFF } : {}),
      },
      actorId: admin.userId,
      correlationId: randomUUID(),
    });
    after(() => dispatchPendingEmails("admin_email_template_test"));
    return json({ ok: true, id, message: "A controlled template test was queued." }, 202);
  } catch {
    return json({ code: "email_test_unavailable" }, 503);
  }
}
