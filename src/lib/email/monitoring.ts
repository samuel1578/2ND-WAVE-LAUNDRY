/**
 * Pure contracts and display semantics for the administrator email monitor.
 * Provider acceptance and provider-confirmed delivery remain distinct states.
 */

import { hasPermission } from "../auth/permissions";
import type { AdminRole } from "../auth/roles";
import { emailTemplates, enquiryReceivedTemplates, newsletterInterestTemplates, staffOrderTemplates } from "./templates";

/** Every audience shares one outbox, so the monitor must recognise all of them. */
export const EMAIL_TEMPLATES = [
  ...emailTemplates,
  ...staffOrderTemplates,
  ...newsletterInterestTemplates,
  ...enquiryReceivedTemplates,
] as const;

export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export type EmailTemplateConfiguration = {
  template: EmailTemplate;
  variable: string;
  status: "configured" | "missing" | "invalid";
};

export type EmailOperationalConfiguration = {
  transactionalEnabled: boolean;
  apiKeyConfigured: boolean;
  siteUrlConfigured: boolean;
  workerSecretConfigured: boolean;
  cronSecretConfigured: boolean;
  webhookSecretConfigured: boolean;
  testRecipientConfigured: boolean;
  templates: EmailTemplateConfiguration[];
};
/**
 * The title shown for one outbox row in the monitor.
 *
 * Enquiries and newsletter alerts are not booking messages, so they never fake a
 * booking reference. Returns null when the committed payload is unusable, which
 * the repository turns into a stable monitoring error instead of printing
 * untrusted text.
 */
export function emailMonitoringReference(
  template: EmailTemplate,
  payload: Record<string, unknown> | null,
): string | null {
  if (template === "newsletter_interest_received") {
    const subscriber = payload?.subscriber_email;
    return typeof subscriber === "string" ? subscriber : null;
  }
  if (template === "enquiry_received") {
    const enquiryId = payload?.enquiry_id;
    if (typeof enquiryId !== "string" || !/^[0-9a-f-]{36}$/i.test(enquiryId))
      return null;
    const kind = payload?.kind === "commercial" ? "commercial quote" : "general enquiry";
    return `Enquiry — ${kind} ${enquiryId.slice(0, 8)}`;
  }
  const reference = payload?.booking_reference;
  return typeof reference === "string" ? reference : null;
}

export type OutboxStatus =
  | "pending"
  | "sending"
  | "sent"
  | "retryable_failed"
  | "dead";
export type ProviderDeliveryEvent =
  | "delivered"
  | "deferred"
  | "bounced"
  | "complained";
export type EmailStatusFilter = OutboxStatus | "";

export const canManageEmailDelivery = (
  role: AdminRole | string | null | undefined,
): boolean => hasPermission(role, "email.manage");

export const EMAIL_OUTBOX_PAGE_SIZE = 20;
export const EMAIL_OUTBOX_MAX_PAGE_SIZE = 50;

export type EmailMonitoringQuery = {
  status: EmailStatusFilter;
  eventType: EmailTemplate | "";
  bookingId: string;
  page: number;
  pageSize: number;
};

const OUTBOX_STATUSES: readonly OutboxStatus[] = [
  "pending",
  "sending",
  "sent",
  "retryable_failed",
  "dead",
];

export function isEmailTemplate(value: unknown): value is EmailTemplate {
  return (
    typeof value === "string" &&
    (EMAIL_TEMPLATES as readonly string[]).includes(value)
  );
}

export function isOutboxStatus(value: unknown): value is OutboxStatus {
  return (
    typeof value === "string" &&
    (OUTBOX_STATUSES as readonly string[]).includes(value)
  );
}

export function normaliseEmailMonitoringQuery(input: {
  status?: string | null;
  eventType?: string | null;
  bookingId?: string | null;
  page?: string | null;
  pageSize?: string | null;
}): EmailMonitoringQuery {
  const requestedPage = Number(input.page);
  const requestedSize = Number(input.pageSize);
  const status = isOutboxStatus(input.status) ? input.status : "";
  const eventType = isEmailTemplate(input.eventType) ? input.eventType : "";
  const bookingId =
    typeof input.bookingId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.bookingId,
      )
      ? input.bookingId
      : "";

  return {
    status,
    eventType,
    bookingId,
    page:
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? Math.min(requestedPage, 1_000_000)
        : 1,
    pageSize:
      Number.isSafeInteger(requestedSize) && requestedSize > 0
        ? Math.min(requestedSize, EMAIL_OUTBOX_MAX_PAGE_SIZE)
        : EMAIL_OUTBOX_PAGE_SIZE,
  };
}

export type EmailDeliveryEventSummary = {
  event: ProviderDeliveryEvent;
  reason: string | null;
  providerEventAt: string | null;
  receivedAt: string;
};

const terminalEvent = (event: ProviderDeliveryEvent) =>
  event === "delivered" || event === "bounced" || event === "complained";

function eventTime(event: EmailDeliveryEventSummary): number {
  const parsed = Date.parse(event.providerEventAt ?? event.receivedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Ignores stale deferral events after a terminal provider event. */
export function latestEmailDeliveryEvent(
  events: readonly EmailDeliveryEventSummary[],
): EmailDeliveryEventSummary | null {
  const terminal = events.filter((entry) => terminalEvent(entry.event));
  const candidates = terminal.length ? terminal : events;
  return (
    [...candidates].sort(
      (left, right) =>
        eventTime(right) - eventTime(left) ||
        Date.parse(right.receivedAt) - Date.parse(left.receivedAt),
    )[0] ?? null
  );
}

export function emailDeliveryStatusLabel(
  status: OutboxStatus,
  latestEvent: EmailDeliveryEventSummary | null,
): string {
  if (status === "sent") {
    if (latestEvent?.event === "delivered") return "Delivered";
    if (latestEvent?.event === "bounced") return "Bounced";
    if (latestEvent?.event === "complained") return "Complaint reported";
    if (latestEvent?.event === "deferred") return "Deferred by provider";
    return "Accepted by provider";
  }
  if (status === "pending") return "Queued";
  if (status === "sending") return "Sending";
  if (status === "retryable_failed") return "Retry scheduled";
  return "Terminal failure";
}

export function emailTemplateLabel(template: EmailTemplate): string {
  const labels: Record<EmailTemplate, string> = {
    booking_created: "Booking received",
    booking_confirmed: "Booking confirmed",
    booking_processing_started: "Processing started",
    booking_ready: "Laundry ready",
    booking_completed: "Booking completed",
    booking_cancelled: "Booking cancelled",
    staff_order_pending: "Staff alert — order pending",
    staff_order_processing: "Staff alert — processing",
    staff_order_ready: "Staff alert — ready",
    staff_order_completed: "Staff alert — completed",
    staff_order_cancelled: "Staff alert — cancelled",
    newsletter_interest_received: "Newsletter interest — new sign-up",
    enquiry_received: "Enquiry — new submission",
  };
  return labels[template];
}

export function emailOutboxStatusLabel(status: OutboxStatus): string {
  const labels: Record<OutboxStatus, string> = {
    pending: "Queued",
    sending: "Sending",
    sent: "Accepted by provider",
    retryable_failed: "Retry scheduled",
    dead: "Terminal failure",
  };
  return labels[status];
}
