/**
 * Pure booking-alert recipient rules shared by the administration interface, the
 * server actions, the API route and the tests.
 *
 * The database is the source of truth (`public.booking_alert_recipients` and its
 * constraints), but both boundaries validate with these helpers so a caller gets
 * a precise message instead of a provider/database error. Nothing here performs
 * I/O, so it is safe to import from a Client Component.
 */

import { validEmail } from "@/lib/rules";

/** Must match the database trigger `booking_alert_recipients_cap`. */
export const MAX_ENABLED_BOOKING_ALERT_RECIPIENTS = 10;

export const BOOKING_ALERT_RECIPIENT_MAX_EMAIL_LENGTH = 254;

export type BookingAlertRecipient = {
  id: string;
  email: string;
  label: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type BookingAlertRecipientErrorCode =
  | "permission_denied"
  | "invalid_request"
  | "invalid_email"
  | "duplicate"
  | "limit_reached"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "not_configured"
  | "unavailable";

export const BOOKING_ALERT_RECIPIENT_ERRORS: Record<
  BookingAlertRecipientErrorCode,
  string
> = {
  permission_denied:
    "You do not have permission to manage order alert recipients.",
  invalid_request: "That request was not valid. Review the address and try again.",
  invalid_email: "Enter a valid email address.",
  duplicate: "That address is already on the alert list.",
  limit_reached: `At most ${MAX_ENABLED_BOOKING_ALERT_RECIPIENTS} addresses can receive order alerts. Remove one first.`,
  not_found: "That recipient is no longer on the list. Reload and try again.",
  conflict: "Another administrator changed this list. Reload and try again.",
  rate_limited: "Too many changes. Wait a few minutes and try again.",
  not_configured:
    "Alert recipient management is not configured on this deployment.",
  unavailable: "The alert recipient list is unavailable right now. Try again.",
};

export function bookingAlertRecipientErrorMessage(
  code: BookingAlertRecipientErrorCode,
): string {
  return BOOKING_ALERT_RECIPIENT_ERRORS[code];
}

/**
 * The one normalisation used everywhere: trim and lower-case, matching the
 * database's `email = lower(btrim(email))` constraint.
 */
export function normaliseBookingAlertRecipientEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export type RecipientEmailValidation =
  | { ok: true; email: string }
  | { ok: false; code: "invalid_email"; message: string };

export function validateBookingAlertRecipientEmail(
  value: unknown,
): RecipientEmailValidation {
  const email = normaliseBookingAlertRecipientEmail(value);
  if (
    email.length < 3 ||
    email.length > BOOKING_ALERT_RECIPIENT_MAX_EMAIL_LENGTH ||
    !validEmail(email)
  )
    return {
      ok: false,
      code: "invalid_email",
      message: BOOKING_ALERT_RECIPIENT_ERRORS.invalid_email,
    };
  return { ok: true, email };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBookingAlertRecipientId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Optimistic-concurrency token from the row the operator is editing. */
export function isBookingAlertRecipientVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
