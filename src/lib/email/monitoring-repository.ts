import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  latestEmailDeliveryEvent,
  type EmailDeliveryEventSummary,
  type EmailMonitoringQuery,
  type EmailTemplate,
  type OutboxStatus,
  type ProviderDeliveryEvent,
} from "./monitoring";

export type EmailMonitoringRow = {
  id: string;
  bookingId: string | null;
  bookingReference: string;
  template: EmailTemplate;
  recipientEmail: string;
  status: OutboxStatus;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
  nextAttemptAt: string | null;
  lastError: string | null;
  latestDeliveryEvent: EmailDeliveryEventSummary | null;
};

export type EmailMonitoringPage = {
  rows: EmailMonitoringRow[];
  total: number;
  page: number;
  pageSize: number;
};

type OutboxRecord = {
  id: string;
  booking_id: string | null;
  template: string;
  recipient_email: string;
  payload: { booking_reference?: unknown } | null;
  status: string;
  attempt_count: number;
  max_attempts: number;
  last_attempt_at: string | null;
  sent_at: string | null;
  next_attempt_at: string | null;
  last_error: string | null;
};

type EventRecord = {
  outbox_id: string;
  event: string;
  reason: string | null;
  provider_event_at: string | null;
  received_at: string;
};

const validTemplates = new Set([
  "booking_created",
  "booking_confirmed",
  "booking_processing_started",
  "booking_ready",
  "booking_completed",
  "booking_cancelled",
  "staff_order_pending",
  "staff_order_processing",
  "staff_order_ready",
  "staff_order_completed",
  "staff_order_cancelled",
]);
const validStatuses = new Set([
  "pending",
  "sending",
  "sent",
  "retryable_failed",
  "dead",
]);
const validEvents = new Set(["delivered", "deferred", "bounced", "complained"]);

export class EmailMonitoringRepositoryError extends Error {
  constructor() {
    super("Email delivery monitoring is unavailable.");
    this.name = "EmailMonitoringRepositoryError";
  }
}

export async function listEmailMonitoring(
  query: EmailMonitoringQuery,
): Promise<EmailMonitoringPage> {
  const client = createSupabaseAdminClient();
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;
  let request = client
    .from("email_outbox")
    .select(
      "id, booking_id, template, recipient_email, payload, status, attempt_count, max_attempts, last_attempt_at, sent_at, next_attempt_at, last_error",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (query.status) request = request.eq("status", query.status);
  if (query.eventType) request = request.eq("template", query.eventType);
  if (query.bookingId) request = request.eq("booking_id", query.bookingId);

  const { data, error, count } = await request;
  if (error || !Array.isArray(data)) throw new EmailMonitoringRepositoryError();
  const rows = data as unknown as OutboxRecord[];
  const ids = rows.map((row) => row.id);

  let events: EventRecord[] = [];
  if (ids.length) {
    const { data: eventData, error: eventError } = await client
      .from("email_delivery_events")
      .select("outbox_id, event, reason, provider_event_at, received_at")
      .in("outbox_id", ids)
      .order("provider_event_at", { ascending: false, nullsFirst: false })
      .order("received_at", { ascending: false })
      .limit(200);
    if (eventError || !Array.isArray(eventData))
      throw new EmailMonitoringRepositoryError();
    events = eventData as unknown as EventRecord[];
  }

  return {
    rows: rows.map((row) => {
      const rowEvents = events
        .filter((entry) => entry.outbox_id === row.id)
        .filter((entry) => validEvents.has(entry.event))
        .map((entry) => ({
          event: entry.event as ProviderDeliveryEvent,
          reason: entry.reason,
          providerEventAt: entry.provider_event_at,
          receivedAt: entry.received_at,
        }));
      const status = row.status as OutboxStatus;
      const template = row.template as EmailTemplate;
      if (!validStatuses.has(status) || !validTemplates.has(template))
        throw new EmailMonitoringRepositoryError();
      const reference = row.payload?.booking_reference;
      if (typeof reference !== "string")
        throw new EmailMonitoringRepositoryError();

      return {
        id: row.id,
        bookingId: row.booking_id,
        bookingReference: reference,
        template,
        recipientEmail: row.recipient_email,
        status,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        lastAttemptAt: row.last_attempt_at,
        sentAt: row.sent_at,
        nextAttemptAt:
          status === "pending" || status === "retryable_failed"
            ? row.next_attempt_at
            : null,
        lastError: row.last_error,
        latestDeliveryEvent: latestEmailDeliveryEvent(rowEvents),
      };
    }),
    total: typeof count === "number" ? count : rows.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}
