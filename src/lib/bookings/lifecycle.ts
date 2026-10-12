/**
 * Booking lifecycle rules.
 *
 * The allowed transitions and confirmation prerequisites below are the server-side
 * contracts for Sprint 2C. They mirror `src/lib/rules.ts` (the existing front-end
 * rules) and the trusted database functions; `tests/bookings.test.ts` asserts the
 * two transition maps stay identical so the user interface and the database cannot
 * drift apart.
 */

import {
  BOOKING_LIMITS,
  type BookingArrangement,
  type BookingStatus,
} from "./types";
import type { ValidationResult } from "./errors";

/**
 * Allowed ordinary transitions (SRS §9). `cancelled` is reachable from every
 * non-terminal state; `completed` and `cancelled` are terminal.
 */
export const bookingTransitions: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["scheduled", "picked_up", "cancelled"],
  scheduled: ["picked_up", "cancelled"],
  picked_up: ["processing", "cancelled"],
  processing: ["ready", "cancelled"],
  ready: ["out_for_delivery", "completed", "cancelled"],
  out_for_delivery: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function allowedTransitions(status: BookingStatus): readonly BookingStatus[] {
  return bookingTransitions[status] ?? [];
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return allowedTransitions(from).includes(to);
}

/** True when the status change requires a written reason (cancellation). */
export function transitionRequiresReason(to: BookingStatus): boolean {
  return to === "cancelled";
}

/** The confirmation prerequisites an administrator must have recorded. */
export type ConfirmationSnapshot = Pick<
  BookingArrangement,
  | "branchId"
  | "agreedPickupAt"
  | "agreedFee"
  | "zeroFeeReason"
  | "contactOutcome"
  | "confirmationNote"
>;

const NON_EMPTY = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Field-level confirmation errors. An empty object means confirmation may
 * proceed. The agreed appointment is never inferred from the customer request.
 */
export function confirmationFieldErrors(
  booking: ConfirmationSnapshot,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!booking.branchId) errors.branchId = "Assign a branch before confirming.";
  if (!booking.agreedPickupAt || Number.isNaN(Date.parse(booking.agreedPickupAt)))
    errors.agreedPickupAt = "Record the agreed pickup date and time.";
  if (
    booking.agreedFee === null ||
    !Number.isFinite(booking.agreedFee) ||
    booking.agreedFee < 0
  )
    errors.agreedFee = "Record the agreed pickup fee.";
  else if (booking.agreedFee === 0 && !NON_EMPTY(booking.zeroFeeReason))
    errors.zeroFeeReason = "Record the reason for a zero pickup fee.";
  if (!NON_EMPTY(booking.contactOutcome))
    errors.contactOutcome = "Record the contact outcome before confirming.";
  if (!NON_EMPTY(booking.confirmationNote))
    errors.confirmationNote = "Record the confirmation note.";
  return errors;
}

export const isConfirmationReady = (booking: ConfirmationSnapshot): boolean =>
  Object.keys(confirmationFieldErrors(booking)).length === 0;

/** Cancellation always requires a reason (SRS ADM-04). */
export function cancellationError(reason: string | null | undefined): string | null {
  return NON_EMPTY(reason) ? null : "Enter a reason for cancellation.";
}

/**
 * Validates and normalises an administrative arrangement update.
 *
 * `null` clears a field. A zero fee requires a recorded reason, and a fee or
 * service charge may never be negative.
 */
export function validateArrangement(input: {
  branchId?: string | null;
  agreedPickupAt?: string | null;
  agreedFee?: number | string | null;
  zeroFeeReason?: string | null;
  serviceCharge?: number | string | null;
  contactOutcome?: string | null;
  confirmationNote?: string | null;
  returnDetails?: string | null;
}): ValidationResult<BookingArrangement> {
  const fieldErrors: Record<string, string> = {};

  const branchId = normaliseText(input.branchId, 60);
  if (branchId && !UUID.test(branchId)) fieldErrors.branchId = "Choose an available branch.";

  const agreedPickupAt = normaliseText(input.agreedPickupAt, 40);
  if (agreedPickupAt && Number.isNaN(Date.parse(agreedPickupAt)))
    fieldErrors.agreedPickupAt = "Record the agreed pickup date and time.";

  const agreedFee = normaliseFee(input.agreedFee);
  if (agreedFee === "invalid") fieldErrors.agreedFee = "Enter a valid, non-negative fee.";

  const serviceCharge = normaliseFee(input.serviceCharge);
  if (serviceCharge === "invalid")
    fieldErrors.serviceCharge = "Enter a valid, non-negative charge.";

  const zeroFeeReason = normaliseText(input.zeroFeeReason, BOOKING_LIMITS.confirmationText.max);
  if (agreedFee === 0 && !zeroFeeReason)
    fieldErrors.zeroFeeReason = "Record the reason for a zero pickup fee.";

  const contactOutcome = normaliseText(input.contactOutcome, BOOKING_LIMITS.confirmationText.max);
  const confirmationNote = normaliseText(
    input.confirmationNote,
    BOOKING_LIMITS.confirmationText.max,
  );
  const returnDetails = normaliseText(input.returnDetails, BOOKING_LIMITS.confirmationText.max);

  if (Object.keys(fieldErrors).length)
    return { ok: false, code: "invalid_request", fieldErrors };

  return {
    ok: true,
    value: {
      branchId: branchId || null,
      agreedPickupAt: agreedPickupAt || null,
      agreedFee: agreedFee === "invalid" ? null : agreedFee,
      zeroFeeReason: zeroFeeReason || null,
      serviceCharge: serviceCharge === "invalid" ? null : serviceCharge,
      contactOutcome: contactOutcome || null,
      confirmationNote: confirmationNote || null,
      returnDetails: returnDetails || null,
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normaliseText(value: string | null | undefined, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Returns a non-negative number, `null` for empty input, or `"invalid"`. */
function normaliseFee(value: number | string | null | undefined): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "invalid";
  return Math.round(numeric * 100) / 100;
}
