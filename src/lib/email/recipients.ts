/**
 * Central staff/admin order-alert recipient list — server-only persistence.
 *
 * This is the single integration point between the notification engine and the
 * administrator-managed recipient list. The engine resolves recipients inside
 * the trusted database helper (`private.enqueue_staff_order_alert`), so an order
 * event reads the same table atomically and can never use caller-supplied
 * addresses. This module reads and writes that table for `/admin/settings`.
 *
 * Authorisation is NOT decided here: `src/lib/email/recipient-actions.ts` and the
 * read route re-resolve the verified Full Admin and `settings.manage` capability
 * on every call. The elevated Supabase key never leaves the server; the table has
 * RLS enabled with no client policy, so `anon`/`authenticated` cannot touch it.
 *
 * Changes apply to subsequent notifications only. The outbox copies the address
 * at enqueue time, so removing a recipient never rewrites or resends history.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  normaliseBookingAlertRecipientEmail,
  type BookingAlertRecipient,
  type BookingAlertRecipientErrorCode,
} from "./recipient-rules";

export const BOOKING_ALERT_RECIPIENTS_TABLE = "booking_alert_recipients";

export {
  MAX_ENABLED_BOOKING_ALERT_RECIPIENTS,
  type BookingAlertRecipient,
} from "./recipient-rules";

export type BookingAlertRecipientsResult =
  | { ok: true; recipients: BookingAlertRecipient[] }
  | { ok: false; reason: "not_configured" | "unavailable" };

export type BookingAlertRecipientMutationResult =
  | { ok: true }
  | { ok: false; code: BookingAlertRecipientErrorCode };

type RecipientRow = {
  id: string;
  email: string;
  label: string;
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

type DatabaseError = { code?: string | null; message?: string | null };

/** Maps a database failure to a stable code without exposing its message. */
function mapDatabaseError(error: DatabaseError): BookingAlertRecipientErrorCode {
  const code = (error.code ?? "").trim();
  const message = (error.message ?? "").toLowerCase();

  if (code === "23505" || message.includes("duplicate key")) return "duplicate";
  if (message.includes("booking_alert_recipients_limit")) return "limit_reached";
  if (code === "23514" || message.includes("booking_alert_recipients_email"))
    return "invalid_email";
  return "unavailable";
}

/**
 * Reads the full list (all rows are created enabled by this interface) for the
 * settings surface. A failure is logged without an address and reported as a
 * stable result.
 */
export async function listBookingAlertRecipients(): Promise<BookingAlertRecipientsResult> {
  let client;
  try {
    client = createSupabaseAdminClient();
  } catch {
    return { ok: false, reason: "not_configured" };
  }

  const { data, error } = await client
    .from(BOOKING_ALERT_RECIPIENTS_TABLE)
    .select("id, email, label, enabled, version, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (error || !Array.isArray(data)) {
    console.warn(
      `[email] booking alert recipient list unavailable code=${error?.code ?? "unknown"}`,
    );
    return { ok: false, reason: "unavailable" };
  }

  return {
    ok: true,
    recipients: (data as unknown as RecipientRow[]).map((row) => ({
      id: row.id,
      email: row.email,
      label: row.label,
      enabled: row.enabled,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

/** Adds one enabled address. The database enforces uniqueness and the cap. */
export async function addBookingAlertRecipient(
  email: string,
): Promise<BookingAlertRecipientMutationResult> {
  let client;
  try {
    client = createSupabaseAdminClient();
  } catch {
    return { ok: false, code: "not_configured" };
  }

  const { error } = await client.from(BOOKING_ALERT_RECIPIENTS_TABLE).insert({
    email: normaliseBookingAlertRecipientEmail(email),
  });

  if (error) return { ok: false, code: mapDatabaseError(error) };
  return { ok: true };
}

/**
 * Replaces an address using the row's optimistic-concurrency version. A stale
 * version (another administrator saved first) matches no row and is reported as
 * a conflict rather than silently overwriting.
 */
export async function updateBookingAlertRecipient(input: {
  id: string;
  email: string;
  expectedVersion: number;
}): Promise<BookingAlertRecipientMutationResult> {
  let client;
  try {
    client = createSupabaseAdminClient();
  } catch {
    return { ok: false, code: "not_configured" };
  }

  const { data, error } = await client
    .from(BOOKING_ALERT_RECIPIENTS_TABLE)
    .update({
      email: normaliseBookingAlertRecipientEmail(input.email),
      version: input.expectedVersion + 1,
    })
    .eq("id", input.id)
    .eq("version", input.expectedVersion)
    .select("id");

  if (error) return { ok: false, code: mapDatabaseError(error) };
  if (!Array.isArray(data) || data.length === 0)
    return { ok: false, code: "conflict" };
  return { ok: true };
}

export async function removeBookingAlertRecipient(
  id: string,
): Promise<BookingAlertRecipientMutationResult> {
  let client;
  try {
    client = createSupabaseAdminClient();
  } catch {
    return { ok: false, code: "not_configured" };
  }

  const { data, error } = await client
    .from(BOOKING_ALERT_RECIPIENTS_TABLE)
    .delete()
    .eq("id", id)
    .select("id");

  if (error) return { ok: false, code: mapDatabaseError(error) };
  if (!Array.isArray(data) || data.length === 0)
    return { ok: false, code: "not_found" };
  return { ok: true };
}
