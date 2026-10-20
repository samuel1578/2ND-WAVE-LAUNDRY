/**
 * Pure contracts and display semantics for the administrator email monitor.
 * Provider acceptance and provider-confirmed delivery remain distinct states.
 */

import { hasPermission } from "../auth/permissions";
import type { AdminRole } from "../auth/roles";

export const EMAIL_TEMPLATES = [
  "booking_created",
  "booking_confirmed",
  "booking_processing_started",
  "booking_ready",
  "booking_completed",
  "booking_cancelled",
] as const;

export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];
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
