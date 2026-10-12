/**
 * Booking error taxonomy.
 *
 * Every failure that can leave a trusted booking function is distilled into a
 * small, stable set of codes with a safe, non-technical message. Raw SQL text,
 * provider payloads and stack traces are never forwarded to a caller, and no code
 * discloses whether a private record exists.
 *
 * The database functions raise messages prefixed with `BOOKING_<MARKER>: …`
 * (see `supabase/migrations/20261011130200_booking_functions.sql`), which
 * `mapBookingDatabaseError` maps onto this taxonomy.
 */

export type BookingErrorCode =
  | "invalid_request"
  | "invalid_scope"
  | "idempotency_required"
  | "idempotency_mismatch"
  | "invalid_payload"
  | "invalid_service"
  | "paused"
  | "invalid_name"
  | "invalid_phone"
  | "invalid_email"
  | "invalid_contact"
  | "invalid_address"
  | "invalid_map"
  | "invalid_date"
  | "invalid_time"
  | "pickup_date"
  | "pickup_window"
  | "pickup_time_past"
  | "pickup_closed"
  | "express_cutoff"
  | "actor_required"
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "invalid_transition"
  | "state_unchanged"
  | "cancellation_reason"
  | "confirmation_incomplete"
  | "invalid_branch"
  | "invalid_fee"
  | "zero_fee_reason"
  | "invalid_note"
  | "not_configured";

export const BOOKING_ERROR_MESSAGES: Record<BookingErrorCode, string> = {
  invalid_request: "The request could not be processed. Please review the details and try again.",
  invalid_scope: "The submission channel is not recognised.",
  idempotency_required: "This request is missing its protection key. Reload the form and submit again.",
  idempotency_mismatch: "This request changed while it was being saved. Review your details and submit again.",
  invalid_payload: "Some of the submitted details are not valid.",
  invalid_service: "One of the selected services is no longer available. Choose another service.",
  paused: "Online pickup requests are paused for now. Your details are still here.",
  invalid_name: "Enter the customer name.",
  invalid_phone: "Enter a valid phone number.",
  invalid_email: "Enter a valid email address.",
  invalid_contact: "Choose a preferred contact method.",
  invalid_address: "Enter the pickup address.",
  invalid_map: "Enter a valid https map link or leave it empty.",
  invalid_date: "Choose a valid pickup date.",
  invalid_time: "Choose a valid preferred time.",
  pickup_date: "Choose a valid pickup date.",
  pickup_window: "Choose a preferred time within the pickup window.",
  pickup_time_past: "Choose a pickup time that has not already passed today.",
  pickup_closed: "Pickup hours have ended for that date. Choose another date or contact the team.",
  express_cutoff: "The cutoff for express same-day pickup has passed. Choose another date or contact the team.",
  actor_required: "Sign in with an administrator account to continue.",
  permission_denied: "Your administrator role does not allow this action.",
  not_found: "This booking is no longer available.",
  conflict: "This booking changed while you were editing it. Reload the latest details before saving.",
  invalid_transition: "This status change is not allowed.",
  state_unchanged: "The booking is already in that status.",
  cancellation_reason: "Enter a reason for cancellation.",
  confirmation_incomplete: "Complete the agreed branch, pickup time, fee, contact outcome and confirmation note before confirming.",
  invalid_branch: "Choose an available branch.",
  invalid_fee: "Enter a valid, non-negative fee.",
  zero_fee_reason: "Record the reason for a zero pickup fee.",
  invalid_note: "Enter a note between 1 and 4000 characters.",
  not_configured: "Booking operations are not configured for this environment.",
};

/** Safe, generic fallback for an unrecognised failure. */
export const BOOKING_ERROR_FALLBACK = BOOKING_ERROR_MESSAGES.invalid_request;

export function bookingErrorMessage(code: BookingErrorCode): string {
  return BOOKING_ERROR_MESSAGES[code] ?? BOOKING_ERROR_FALLBACK;
}

/** HTTP status for a code, reused by the future server routes. */
export function bookingErrorStatus(code: BookingErrorCode): number {
  switch (code) {
    case "actor_required":
      return 401;
    case "permission_denied":
      return 403;
    case "not_found":
      return 404;
    case "idempotency_mismatch":
    case "conflict":
    case "state_unchanged":
    case "invalid_transition":
      return 409;
    case "not_configured":
      return 503;
    case "paused":
      return 503;
    case "invalid_request":
    case "invalid_scope":
    case "idempotency_required":
    case "invalid_payload":
    case "invalid_service":
    case "invalid_name":
    case "invalid_phone":
    case "invalid_email":
    case "invalid_contact":
    case "invalid_address":
    case "invalid_map":
    case "invalid_date":
    case "invalid_time":
    case "pickup_date":
    case "pickup_window":
    case "pickup_time_past":
    case "pickup_closed":
    case "express_cutoff":
    case "cancellation_reason":
    case "confirmation_incomplete":
    case "invalid_branch":
    case "invalid_fee":
    case "zero_fee_reason":
    case "invalid_note":
      return 422;
    default:
      return 400;
  }
}

/**
 * Maps a marker raised by the trusted database functions onto the taxonomy.
 * Order matters: the longest, most specific marker is matched first.
 */
const DATABASE_MARKERS: ReadonlyArray<[string, BookingErrorCode]> = [
  ["BOOKING_IDEMPOTENCY_MISMATCH", "idempotency_mismatch"],
  ["BOOKING_IDEMPOTENCY_REQUIRED", "idempotency_required"],
  ["BOOKING_CONFIRMATION_INCOMPLETE", "confirmation_incomplete"],
  ["BOOKING_CANCELLATION_REASON", "cancellation_reason"],
  ["BOOKING_INVALID_TRANSITION", "invalid_transition"],
  ["BOOKING_STATE_UNCHANGED", "state_unchanged"],
  ["BOOKING_INVALID_SERVICE", "invalid_service"],
  ["BOOKING_INVALID_PAYLOAD", "invalid_payload"],
  ["BOOKING_INVALID_BRANCH", "invalid_branch"],
  ["BOOKING_INVALID_FEE", "invalid_fee"],
  ["BOOKING_ZERO_FEE_REASON", "zero_fee_reason"],
  ["BOOKING_INVALID_NOTE", "invalid_note"],
  ["BOOKING_INVALID_NAME", "invalid_name"],
  ["BOOKING_INVALID_PHONE", "invalid_phone"],
  ["BOOKING_INVALID_EMAIL", "invalid_email"],
  ["BOOKING_INVALID_CONTACT", "invalid_contact"],
  ["BOOKING_INVALID_ADDRESS", "invalid_address"],
  ["BOOKING_INVALID_MAP", "invalid_map"],
  ["BOOKING_INVALID_DATE", "invalid_date"],
  ["BOOKING_INVALID_TIME", "invalid_time"],
  ["BOOKING_PICKUP_WINDOW", "pickup_window"],
  ["BOOKING_PICKUP_TIME_PAST", "pickup_time_past"],
  ["BOOKING_PICKUP_CLOSED", "pickup_closed"],
  ["BOOKING_PICKUP_DATE", "pickup_date"],
  ["BOOKING_EXPRESS_CUTOFF", "express_cutoff"],
  ["BOOKING_ACTOR_REQUIRED", "actor_required"],
  ["BOOKING_FORBIDDEN", "permission_denied"],
  ["BOOKING_NOT_FOUND", "not_found"],
  ["BOOKING_CONFLICT", "conflict"],
  ["BOOKING_PAUSED", "paused"],
  ["BOOKING_INVALID_SCOPE", "invalid_scope"],
];

export function mapBookingDatabaseError(message: unknown): BookingErrorCode {
  if (typeof message !== "string") return "conflict";
  for (const [marker, code] of DATABASE_MARKERS)
    if (message.includes(marker)) return code;
  // Transport failures and unrecognised text fail closed as a retryable conflict
  // rather than leaking the underlying database message.
  return "conflict";
}

/** Structured validation result used by the pure validators. */
export type ValidationFailure = {
  code: BookingErrorCode;
  fieldErrors: Record<string, string>;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | ({ ok: false } & ValidationFailure);

export class BookingError extends Error {
  readonly code: BookingErrorCode;
  readonly status: number;
  readonly fieldErrors: Record<string, string>;

  constructor(
    code: BookingErrorCode,
    options: { fieldErrors?: Record<string, string>; message?: string } = {},
  ) {
    super(options.message ?? bookingErrorMessage(code));
    this.name = "BookingError";
    this.code = code;
    this.status = bookingErrorStatus(code);
    this.fieldErrors = options.fieldErrors ?? {};
  }
}
