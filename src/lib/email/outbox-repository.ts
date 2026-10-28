/**
 * Server-only outbox persistence for the email worker.
 *
 * Every mutation goes through the scoped database functions added in
 * `20261019130000_email_delivery.sql`. The elevated Supabase key is created per
 * operation, never leaves the server and is never logged.
 *
 * This module is the only place the worker reads booking data. It selects only
 * the fields the templates need: no phone, address, notes, cancellation reason
 * or private administrator commentary.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bookingStatuses, type BookingStatus } from "@/lib/bookings/types";
import {
  isNewsletterInterestTemplate,
  isStaffOrderTemplate,
  type BookingEmailContext,
  type NewsletterInterestContext,
  type NotificationTemplate,
  type StaffActorType,
  type StaffNotificationContext,
} from "./templates";

export type ClaimedOutboxEmail = {
  id: string;
  bookingId: string | null;
  template: NotificationTemplate;
  recipientEmail: string;
  payload:
    | {
        booking_reference: string;
        status: string;
      }
    | NewsletterInterestContext;
  testContext?: {
    booking: BookingEmailContext;
    staff?: StaffNotificationContext;
  };
  isTest?: boolean;
  resendOf?: string | null;
  /** Present only for staff_order_* rows; never for a customer template. */
  staff?: StaffNotificationContext;
  /** Present only for newsletter_interest_received rows. */
  newsletter?: NewsletterInterestContext;
  attemptCount: number;
  maxAttempts: number;
};

export type EmailOutboxRepository = {
  reap(limit: number): Promise<number>;
  claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ClaimedOutboxEmail[]>;
  markSent(input: {
    id: string;
    workerId: string;
    providerMessageId: string | null;
  }): Promise<boolean>;
  markRetry(input: {
    id: string;
    workerId: string;
    error: string;
    delaySeconds: number;
  }): Promise<"retryable_failed" | "dead" | null>;
  markDead(input: {
    id: string;
    workerId: string;
    error: string;
  }): Promise<boolean>;
  loadBookingContext(bookingId: string): Promise<BookingEmailContext | null>;
  createTestSend(input: {
    template: NotificationTemplate;
    recipientEmail: string;
    testContext: { booking: BookingEmailContext; staff?: StaffNotificationContext };
    actorId: string;
    correlationId: string;
  }): Promise<string>;
  resend(input: {
    id: string;
    actorId: string;
    reason: string;
    correlationId: string;
  }): Promise<string>;
};

/** Safe, non-identifying repository failure. */
export class EmailRepositoryError extends Error {
  readonly code = "email_repository_unavailable" as const;
  constructor() {
    super("The email delivery repository is unavailable.");
    this.name = "EmailRepositoryError";
  }
}

type OutboxRow = {
  id: string;
  booking_id: string | null;
  template: string;
  recipient_email: string;
  payload: unknown;
  is_test?: boolean;
  test_context?: unknown;
  resend_of?: string | null;
  attempt_count: number;
  max_attempts: number;
};

const bookingStatusSet = new Set<string>(bookingStatuses);
const actorTypeSet = new Set<StaffActorType>(["customer", "admin", "system"]);

type BookingRow = {
  id: string;
  reference: string;
  customer_name: string;
  requested_date: string | null;
  requested_time: string | null;
  agreed_pickup_at: string | null;
  agreed_fee: number | string | null;
  agreed_fee_currency: string | null;
  assigned_branch_id: string | null;
};

type BookingServiceRow = {
  service_title: string;
};

type BranchRow = {
  title: string;
};

const TEMPLATE_SET = new Set<NotificationTemplate>([
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
  "newsletter_interest_received",
]);

const asBookingStatus = (value: unknown): BookingStatus | null =>
  typeof value === "string" && bookingStatusSet.has(value)
    ? (value as BookingStatus)
    : null;

const NEWSLETTER_EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Parses the manager alert payload written by `newsletter_interest_submit`.
 * A malformed payload is a repository error, never a fabricated value.
 */
function asNewsletterContext(value: unknown): NewsletterInterestContext {
  if (typeof value !== "object" || value === null)
    throw new EmailRepositoryError();
  const record = value as Record<string, unknown>;
  if (
    typeof record.subscriber_email !== "string" ||
    typeof record.submitted_at !== "string" ||
    typeof record.source !== "string"
  )
    throw new EmailRepositoryError();
  if (
    record.subscriber_email.length > 254 ||
    !NEWSLETTER_EMAIL_SHAPE.test(record.subscriber_email) ||
    Number.isNaN(Date.parse(record.submitted_at)) ||
    record.source !== "public_newsletter_form"
  )
    throw new EmailRepositoryError();
  return {
    subscriberEmail: record.subscriber_email,
    submittedAt: record.submitted_at,
    source: record.source,
  };
}

/**
 * Parses the minimal render payload. Customer rows carry exactly two keys; staff
 * rows additionally carry the trusted event metadata written by the enqueue
 * trigger; the newsletter manager alert carries only its committed sign-up
 * detail. A malformed payload is a repository error, never a fabricated value.
 */
function asPayload(
  value: unknown,
  template: NotificationTemplate,
): {
  payload: ClaimedOutboxEmail["payload"];
  staff?: StaffNotificationContext;
  newsletter?: NewsletterInterestContext;
} {
  if (typeof value !== "object" || value === null)
    throw new EmailRepositoryError();
  const record = value as Record<string, unknown>;

  if (isNewsletterInterestTemplate(template)) {
    return { payload: asNewsletterContext(record), newsletter: asNewsletterContext(record) };
  }

  if (
    typeof record.booking_reference !== "string" ||
    typeof record.status !== "string"
  )
    throw new EmailRepositoryError();

  const payload = {
    booking_reference: record.booking_reference,
    status: record.status,
  };

  if (!isStaffOrderTemplate(template)) return { payload };

  const actorType = record.actor_kind;
  if (typeof actorType !== "string" || !actorTypeSet.has(actorType as StaffActorType))
    throw new EmailRepositoryError();
  if (
    typeof record.previous_status !== "string" ||
    typeof record.actor_name !== "string" ||
    typeof record.actor_role !== "string" ||
    typeof record.occurred_at !== "string" ||
    typeof record.cancellation_reason !== "string"
  )
    throw new EmailRepositoryError();

  const previousStatus =
    record.previous_status === ""
      ? null
      : asBookingStatus(record.previous_status);
  if (record.previous_status !== "" && !previousStatus)
    throw new EmailRepositoryError();

  const occurredAt = record.occurred_at;
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt)))
    throw new EmailRepositoryError();

  return {
    payload,
    staff: {
      previousStatus,
      actorType: actorType as StaffActorType,
      actorName: record.actor_name || null,
      actorRole: record.actor_role || null,
      occurredAt,
      cancellationReason: record.cancellation_reason || null,
    },
  };
}

function asTestContext(value: unknown): ClaimedOutboxEmail["testContext"] {
  if (typeof value !== "object" || value === null) throw new EmailRepositoryError();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "booking" && key !== "staff"))
    throw new EmailRepositoryError();
  const booking = record.booking;
  if (typeof booking !== "object" || booking === null) throw new EmailRepositoryError();
  const context = booking as Record<string, unknown>;
  if (
    Object.keys(context).some((key) => !["reference", "customerName", "serviceTitles", "requestedDate", "requestedTime", "agreedPickupAt", "agreedFee", "currency", "branch"].includes(key)) ||
    typeof context.reference !== "string" ||
    typeof context.customerName !== "string" ||
    !Array.isArray(context.serviceTitles) ||
    !context.serviceTitles.every((item) => typeof item === "string") ||
    !(context.requestedDate === null || typeof context.requestedDate === "string") ||
    !(context.requestedTime === null || typeof context.requestedTime === "string") ||
    !(context.agreedPickupAt === null || typeof context.agreedPickupAt === "string") ||
    !(context.agreedFee === null || typeof context.agreedFee === "number") ||
    typeof context.currency !== "string"
  ) throw new EmailRepositoryError();

  const bookingContext: BookingEmailContext = {
    reference: context.reference,
    customerName: context.customerName,
    serviceTitles: context.serviceTitles,
    requestedDate: context.requestedDate,
    requestedTime: context.requestedTime,
    agreedPickupAt: context.agreedPickupAt,
    agreedFee: context.agreedFee,
    currency: context.currency,
    branch:
      typeof context.branch === "object" && context.branch !== null &&
      typeof (context.branch as Record<string, unknown>).title === "string"
        ? { title: (context.branch as Record<string, string>).title }
        : null,
  };
  const staffValue = record.staff;
  let staff: StaffNotificationContext | undefined;
  if (staffValue !== undefined) {
    if (Object.keys(record).some((key) => key !== "booking" && key !== "staff"))
      throw new EmailRepositoryError();
    if (typeof staffValue !== "object" || staffValue === null)
      throw new EmailRepositoryError();
    const staffRecord = staffValue as Record<string, unknown>;
    if (Object.keys(staffRecord).some((key) => !["previousStatus", "actorType", "actorName", "actorRole", "occurredAt", "cancellationReason"].includes(key)))
      throw new EmailRepositoryError();
    const actorType = staffRecord.actorType;
    if (
      !(staffRecord.previousStatus === null || asBookingStatus(staffRecord.previousStatus)) ||
      !(actorType === "customer" || actorType === "admin" || actorType === "system") ||
      !(staffRecord.actorName === null || typeof staffRecord.actorName === "string") ||
      !(staffRecord.actorRole === null || typeof staffRecord.actorRole === "string") ||
      !(staffRecord.occurredAt === null || typeof staffRecord.occurredAt === "string") ||
      !(staffRecord.cancellationReason === null || typeof staffRecord.cancellationReason === "string")
    ) throw new EmailRepositoryError();
    staff = {
      previousStatus: staffRecord.previousStatus as BookingStatus | null,
      actorType,
      actorName: staffRecord.actorName as string | null,
      actorRole: staffRecord.actorRole as string | null,
      occurredAt: staffRecord.occurredAt as string | null,
      cancellationReason: staffRecord.cancellationReason as string | null,
    };
  }
  return { booking: bookingContext, ...(staff ? { staff } : {}) };
}

function mapClaimed(row: OutboxRow): ClaimedOutboxEmail {
  if (!TEMPLATE_SET.has(row.template as NotificationTemplate))
    throw new EmailRepositoryError();

  const template = row.template as NotificationTemplate;
  const parsed = asPayload(row.payload, template);
  const testContext = row.is_test ? asTestContext(row.test_context) : undefined;

  return {
    id: row.id,
    bookingId: row.booking_id,
    template,
    recipientEmail: row.recipient_email,
    payload: parsed.payload,
    ...(parsed.staff ? { staff: parsed.staff } : {}),
    ...(parsed.newsletter ? { newsletter: parsed.newsletter } : {}),
    ...(testContext ? { testContext } : {}),
    isTest: row.is_test === true,
    ...(typeof row.resend_of === "string" ? { resendOf: row.resend_of } : {}),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
  };
}

const asNumber = (value: number | string | null): number | null => {
  if (value === null) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

export function createEmailOutboxRepository(): EmailOutboxRepository {
  return {
    async reap(limit: number): Promise<number> {
      const client = createSupabaseAdminClient();
      const { data, error } = await client.rpc("email_outbox_reap", {
        p_limit: limit,
      });
      if (error) throw new EmailRepositoryError();
      const count = Number(data);
      return Number.isFinite(count) && count >= 0 ? count : 0;
    },

    async claim(input): Promise<ClaimedOutboxEmail[]> {
      const client = createSupabaseAdminClient();
      const { data, error } = await client.rpc("email_outbox_claim", {
        p_worker_id: input.workerId,
        p_limit: input.limit,
        p_lease_seconds: input.leaseSeconds,
      });
      if (error) throw new EmailRepositoryError();
      if (!Array.isArray(data)) throw new EmailRepositoryError();
      return (data as OutboxRow[]).map(mapClaimed);
    },

    async markSent(input): Promise<boolean> {
      const client = createSupabaseAdminClient();
      const { data, error } = await client.rpc("email_outbox_mark_sent", {
        p_id: input.id,
        p_worker_id: input.workerId,
        p_provider_message_id: input.providerMessageId,
      });
      if (error) throw new EmailRepositoryError();
      return data === true;
    },

    async markRetry(input): Promise<"retryable_failed" | "dead" | null> {
      const client = createSupabaseAdminClient();
      const { data, error } = await client.rpc("email_outbox_mark_retry", {
        p_id: input.id,
        p_worker_id: input.workerId,
        p_error: input.error,
        p_delay_seconds: input.delaySeconds,
      });
      if (error) throw new EmailRepositoryError();
      if (data === "retryable_failed" || data === "dead") return data;
      return null;
    },

    async markDead(input): Promise<boolean> {
      const client = createSupabaseAdminClient();
      const { data, error } = await client.rpc("email_outbox_mark_dead", {
        p_id: input.id,
        p_worker_id: input.workerId,
        p_error: input.error,
      });
      if (error) throw new EmailRepositoryError();
      return data === true;
    },

    async createTestSend(input): Promise<string> {
      const client = createSupabaseAdminClient();
      const { data, error } = await client.rpc("email_outbox_create_test_send", {
        p_template: input.template,
        p_recipient_email: input.recipientEmail,
        p_test_context: input.testContext,
        p_actor_id: input.actorId,
        p_correlation: input.correlationId,
      });
      if (error || typeof data !== "string") throw new EmailRepositoryError();
      return data;
    },

    async resend(input): Promise<string> {
      const client = createSupabaseAdminClient();
      const { data, error } = await client.rpc("email_outbox_resend", {
        p_id: input.id,
        p_actor_id: input.actorId,
        p_reason: input.reason,
        p_correlation: input.correlationId,
      });
      if (error || typeof data !== "string") throw new EmailRepositoryError();
      return data;
    },

    async loadBookingContext(
      bookingId: string,
    ): Promise<BookingEmailContext | null> {
      const client = createSupabaseAdminClient();
      const { data, error } = await client
        .from("bookings")
        .select(
          "id, reference, customer_name, requested_date, requested_time, agreed_pickup_at, agreed_fee, agreed_fee_currency, assigned_branch_id",
        )
        .eq("id", bookingId)
        .maybeSingle();

      if (error) throw new EmailRepositoryError();
      if (!data) return null;

      const booking = data as BookingRow;
      const { data: serviceData, error: serviceError } = await client
        .from("booking_services")
        .select("service_title")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: true });
      if (serviceError) throw new EmailRepositoryError();
      const serviceTitles = ((serviceData ?? []) as BookingServiceRow[])
        .map((row) => row.service_title)
        .filter((title) => typeof title === "string" && title.trim().length > 0);

      let branch: BookingEmailContext["branch"] = null;

      if (booking.assigned_branch_id) {
        const { data: branchData, error: branchError } = await client
          .from("branches")
          .select("title")
          .eq("id", booking.assigned_branch_id)
          .maybeSingle();

        if (branchError) throw new EmailRepositoryError();
        if (branchData) {
          const row = branchData as BranchRow;
          branch = { title: row.title };
        }
      }

      return {
        reference: booking.reference,
        customerName: booking.customer_name,
        serviceTitles,
        requestedDate: booking.requested_date,
        requestedTime: booking.requested_time,
        agreedPickupAt: booking.agreed_pickup_at,
        agreedFee: asNumber(booking.agreed_fee),
        currency: booking.agreed_fee_currency ?? "GHS",
        branch,
      };
    },
  };
}
