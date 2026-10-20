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
import type { BookingEmailContext } from "./templates";
import type { EmailTemplate } from "./templates";

export type ClaimedOutboxEmail = {
  id: string;
  bookingId: string | null;
  template: EmailTemplate;
  recipientEmail: string;
  payload: {
    booking_reference: string;
    status: string;
  };
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
  attempt_count: number;
  max_attempts: number;
};

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

const TEMPLATE_SET = new Set<EmailTemplate>([
  "booking_created",
  "booking_confirmed",
  "booking_processing_started",
  "booking_ready",
  "booking_completed",
  "booking_cancelled",
]);

function asPayload(value: unknown): ClaimedOutboxEmail["payload"] {
  if (typeof value !== "object" || value === null)
    throw new EmailRepositoryError();
  const record = value as Record<string, unknown>;
  if (
    typeof record.booking_reference !== "string" ||
    typeof record.status !== "string"
  )
    throw new EmailRepositoryError();
  return {
    booking_reference: record.booking_reference,
    status: record.status,
  };
}

function mapClaimed(row: OutboxRow): ClaimedOutboxEmail {
  if (!TEMPLATE_SET.has(row.template as EmailTemplate))
    throw new EmailRepositoryError();

  return {
    id: row.id,
    bookingId: row.booking_id,
    template: row.template as EmailTemplate,
    recipientEmail: row.recipient_email,
    payload: asPayload(row.payload),
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
