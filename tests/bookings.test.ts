import test from "node:test";
import assert from "node:assert/strict";
import { statuses as formStatuses, transitions as formTransitions } from "../src/lib/rules";
import {
  bookingStatuses,
  type CatalogueService,
} from "../src/lib/bookings/types";
import {
  bookingTransitions,
  allowedTransitions,
  canTransition,
  cancellationError,
  confirmationFieldErrors,
  isConfirmationReady,
  validateArrangement,
} from "../src/lib/bookings/lifecycle";
import {
  accraDate,
  DEFAULT_EXPRESS_CUTOFF,
  expressEligibilityError,
  isoWeekday,
  pickupWindowError,
  schedulingFailure,
} from "../src/lib/bookings/scheduling";
import {
  validatePublicBookingRequest,
  toBookingSubmitPayload,
} from "../src/lib/bookings/validation";
import {
  BOOKING_REFERENCE_PATTERN,
  createIdempotencyKey,
  isValidBookingReference,
  isValidIdempotencyKey,
} from "../src/lib/bookings/reference";
import {
  BOOKING_ERROR_MESSAGES,
  bookingErrorStatus,
  mapBookingDatabaseError,
  type BookingErrorCode,
} from "../src/lib/bookings/errors";

/**
 * Sprint 2A booking contract tests.
 *
 * These cover the pure server-side contracts: scheduling boundaries, payload
 * validation, lifecycle transitions and confirmation prerequisites, and the error
 * taxonomy. The database-level behaviour is covered by the (NOT EXECUTED) script
 * `supabase/tests/sprint_2a_booking_security.sql`; these tests deliberately do not
 * claim to prove it.
 */

// 2026-10-11 is a Sunday; pickups operate seven days a week.
const SUNDAY_0800 = new Date("2026-10-11T08:00:00Z");

const catalogue: CatalogueService[] = [
  { slug: "wash-ironing-fold", title: "Wash, Ironing & Fold", kind: "laundry", bookable: true, active: true },
  { slug: "ironing", title: "Ironing", kind: "laundry", bookable: true, active: true },
  { slug: "express-same-day-laundry", title: "Express/Same-Day Laundry", kind: "modifier", bookable: true, active: true },
  { slug: "pickup-and-delivery", title: "Pickup & Delivery", kind: "information", bookable: false, active: true },
];

function input(overrides: Record<string, unknown> = {}) {
  return {
    services: ["wash-ironing-fold"],
    category: "Clothing",
    items: "1 Standard Bag",
    notes: "",
    address: "1 Test Street",
    landmark: "",
    map: "",
    date: "2099-01-01",
    time: "09:00",
    transport: "No preference",
    name: "Test Customer",
    phone: "+233595224280",
    email: "",
    sameWhatsapp: true,
    whatsapp: "",
    contactMethod: "Phone call",
    acknowledged: true,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Lifecycle parity with the existing front-end rules                          */
/* -------------------------------------------------------------------------- */

test("booking statuses and transitions match the front-end rules exactly", () => {
  assert.deepEqual([...bookingStatuses], [...formStatuses]);
  assert.deepEqual(
    Object.keys(bookingTransitions).sort(),
    Object.keys(formTransitions).sort(),
  );
  for (const status of formStatuses) {
    assert.deepEqual(
      [...bookingTransitions[status]].sort(),
      [...formTransitions[status]].sort(),
      status,
    );
  }
});

test("terminal statuses have no ordinary transition", () => {
  assert.deepEqual(allowedTransitions("completed"), []);
  assert.deepEqual(allowedTransitions("cancelled"), []);
  assert.equal(canTransition("completed", "processing"), false);
  assert.equal(canTransition("cancelled", "confirmed"), false);
  assert.equal(canTransition("pending", "confirmed"), true);
  assert.equal(canTransition("pending", "processing"), false);
  assert.equal(canTransition("confirmed", "picked_up"), true);
  assert.equal(canTransition("ready", "completed"), true);
});

/* -------------------------------------------------------------------------- */
/* Pickup operating window                                                     */
/* -------------------------------------------------------------------------- */

test("pickup window accepts and rejects the documented boundaries", () => {
  const now = SUNDAY_0800;
  assert.equal(pickupWindowError({ date: "2026-10-12", time: "06:30" }, now)?.code, "pickup_window");
  assert.equal(pickupWindowError({ date: "2026-10-12", time: "07:00" }, now), null);
  assert.equal(pickupWindowError({ date: "2026-10-12", time: "12:00" }, now), null);
  // 17:00 is the inclusive closing boundary for a requested time.
  assert.equal(pickupWindowError({ date: "2026-10-12", time: "17:00" }, now), null);
  assert.equal(pickupWindowError({ date: "2026-10-12", time: "17:30" }, now)?.code, "pickup_window");
  assert.equal(pickupWindowError({ date: "2026-10-12", time: "19:00" }, now)?.code, "pickup_window");
});

test("a same-day request is closed once the window has ended", () => {
  const afterClose = new Date("2026-10-11T17:00:00Z");
  assert.equal(
    pickupWindowError({ date: "2026-10-11", time: null }, afterClose)?.code,
    "pickup_closed",
  );
  // Before the close, a same-day request is still accepted.
  assert.equal(
    pickupWindowError({ date: "2026-10-11", time: null }, new Date("2026-10-11T16:59:59Z")),
    null,
  );
});

test("a specific same-day time that has already passed is rejected", () => {
  const now = new Date("2026-10-11T09:00:00Z");
  // Within the window but earlier than the current local time.
  assert.equal(pickupWindowError({ date: "2026-10-11", time: "07:30" }, now)?.code, "pickup_time_past");
  // Later today is still acceptable.
  assert.equal(pickupWindowError({ date: "2026-10-11", time: "10:00" }, now), null);
  // Out-of-window bounds take precedence over the past-time rule.
  assert.equal(pickupWindowError({ date: "2026-10-11", time: "06:30" }, now)?.code, "pickup_window");
  // A future date is unaffected by the current time.
  assert.equal(pickupWindowError({ date: "2026-10-12", time: "07:30" }, now), null);
});

test("a past pickup date is rejected and weekends and holidays stay open", () => {
  const now = SUNDAY_0800;
  assert.equal(pickupWindowError({ date: "2026-10-10", time: "09:00" }, now)?.code, "pickup_date");
  // Sunday (a weekend) and Christmas Day (a public holiday) are both accepted.
  assert.equal(isoWeekday("2026-10-11"), 7);
  assert.equal(pickupWindowError({ date: "2026-10-11", time: "09:00" }, now), null);
  assert.equal(pickupWindowError({ date: "2026-12-25", time: "09:00" }, now), null);
});

/* -------------------------------------------------------------------------- */
/* Express cutoff is separate from the window                                  */
/* -------------------------------------------------------------------------- */

test("express cutoff boundaries are enforced separately", () => {
  const today = "2026-10-11";
  assert.equal(
    expressEligibilityError({ date: today, express: true }, new Date("2026-10-11T10:59:59Z")),
    null,
  );
  // Equality is accepted: exactly 11:00:00 local time is valid.
  assert.equal(
    expressEligibilityError({ date: today, express: true }, new Date("2026-10-11T11:00:00Z")),
    null,
  );
  assert.equal(
    expressEligibilityError({ date: today, express: true }, new Date("2026-10-11T11:00:01Z"))?.code,
    "express_cutoff",
  );
});

test("the express cutoff never restricts ordinary or later-date requests", () => {
  const afterCutoff = new Date("2026-10-11T15:00:00Z");
  assert.equal(expressEligibilityError({ date: "2026-10-11", express: false }, afterCutoff), null);
  assert.equal(expressEligibilityError({ date: "2026-10-20", express: true }, afterCutoff), null);
  // A later same-day time (16:00) is still inside the pickup window at 15:00 and
  // is unaffected by the express cutoff. (12:00 would now be rejected as past.)
  assert.equal(
    schedulingFailure({ date: "2026-10-11", time: "16:00", express: false }, afterCutoff),
    null,
  );
});

test("accraDate reports the local calendar date", () => {
  assert.equal(accraDate(SUNDAY_0800), "2026-10-11");
  assert.equal(DEFAULT_EXPRESS_CUTOFF, "11:00");
});

/* -------------------------------------------------------------------------- */
/* Public request validation                                                   */
/* -------------------------------------------------------------------------- */

test("valid public input normalises into the database payload", () => {
  const result = validatePublicBookingRequest(input(), { services: catalogue, now: SUNDAY_0800 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.customerPhone, "+233595224280");
  assert.equal(result.value.customerEmail, null);
  assert.equal(result.value.contactMethod, "phone");
  assert.equal(result.value.transportPreference, "no_preference");
  const payload = toBookingSubmitPayload(result.value, "2026-10-01");
  assert.equal(payload.customer_phone, "+233595224280");
  assert.equal(payload.customer_email, null);
  assert.equal(payload.requested_date, "2099-01-01");
  assert.equal(payload.express_requested, false);
  assert.equal(payload.notice_version, "2026-10-01");
});

test("a browser-supplied notice version is ignored; the server value is persisted", () => {
  const result = validatePublicBookingRequest(
    input({ noticeVersion: "forged-client-version" }),
    { services: catalogue, now: SUNDAY_0800 },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // The normalised request carries no notice version at all.
  assert.equal("noticeVersion" in result.value, false);

  const withApproved = toBookingSubmitPayload(result.value, "2026-10-01");
  assert.equal(withApproved.notice_version, "2026-10-01");

  const withoutApproved = toBookingSubmitPayload(result.value, null);
  assert.equal(withoutApproved.notice_version, null);
});

test("a missing customer phone is rejected; an optional email is accepted", () => {
  const missingPhone = validatePublicBookingRequest(input({ phone: "" }), {
    services: catalogue,
    now: SUNDAY_0800,
  });
  assert.equal(missingPhone.ok, false);
  if (!missingPhone.ok) assert.ok(missingPhone.fieldErrors.phone);

  const withEmail = validatePublicBookingRequest(
    input({ email: "Customer@Example.test" }),
    { services: catalogue, now: SUNDAY_0800 },
  );
  assert.equal(withEmail.ok, true);
  if (withEmail.ok) assert.equal(withEmail.value.customerEmail, "customer@example.test");
});

test("unknown, unbookable or empty service selections are rejected", () => {
  for (const services of [[], ["not-a-service"], ["pickup-and-delivery"]]) {
    const result = validatePublicBookingRequest(input({ services }), {
      services: catalogue,
      now: SUNDAY_0800,
    });
    assert.equal(result.ok, false, JSON.stringify(services));
    if (!result.ok) assert.ok(result.fieldErrors.services);
  }
});

test("selecting the express service sets the express flag", () => {
  const result = validatePublicBookingRequest(
    input({ services: ["ironing", "express-same-day-laundry"] }),
    { services: catalogue, now: SUNDAY_0800 },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.expressRequested, true);
});

test("express selection for today after the cutoff fails on the date field", () => {
  const result = validatePublicBookingRequest(
    input({ services: ["express-same-day-laundry"], date: "2026-10-11", time: "12:00" }),
    { services: catalogue, now: new Date("2026-10-11T12:00:00Z") },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.date);
});

test("duplicate service selections are rejected, not silently merged", () => {
  const result = validatePublicBookingRequest(
    input({ services: ["ironing", "ironing"] }),
    { services: catalogue, now: SUNDAY_0800 },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.services);
});

test("the pending-request acknowledgement is required by the server", () => {
  const result = validatePublicBookingRequest(input({ acknowledged: false }), {
    services: catalogue,
    now: SUNDAY_0800,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.fieldErrors.acknowledged);
});

test("required name, address and load size are rejected when missing", () => {
  const result = validatePublicBookingRequest(
    input({ name: "", address: "  ", items: "" }),
    { services: catalogue, now: SUNDAY_0800 },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.fieldErrors.name);
    assert.ok(result.fieldErrors.address);
    assert.ok(result.fieldErrors.items);
  }
});

/* -------------------------------------------------------------------------- */
/* Confirmation and cancellation prerequisites                                 */
/* -------------------------------------------------------------------------- */

test("confirmation requires branch, appointment, fee, contact outcome and note", () => {
  const incomplete = {
    branchId: null,
    agreedPickupAt: null,
    agreedFee: null,
    zeroFeeReason: null,
    contactOutcome: null,
    confirmationNote: null,
  };
  const errors = confirmationFieldErrors(incomplete);
  assert.deepEqual(Object.keys(errors).sort(), [
    "agreedFee",
    "agreedPickupAt",
    "branchId",
    "confirmationNote",
    "contactOutcome",
  ]);
  assert.equal(isConfirmationReady(incomplete), false);

  const ready = {
    branchId: "11111111-1111-1111-1111-111111111111",
    agreedPickupAt: "2099-01-01T09:00:00.000Z",
    agreedFee: 50,
    zeroFeeReason: null,
    contactOutcome: "Customer confirmed by phone",
    confirmationNote: "Collected and confirmed",
  };
  assert.equal(isConfirmationReady(ready), true);
});

test("a zero fee requires a recorded reason", () => {
  const base = {
    branchId: "11111111-1111-1111-1111-111111111111",
    agreedPickupAt: "2099-01-01T09:00:00.000Z",
    agreedFee: 0,
    contactOutcome: "Confirmed",
    confirmationNote: "No charge agreed",
  };
  assert.ok(confirmationFieldErrors({ ...base, zeroFeeReason: null }).zeroFeeReason);
  assert.equal(isConfirmationReady({ ...base, zeroFeeReason: "Loyalty courtesy" }), true);
});

test("cancellation always requires a reason", () => {
  assert.ok(cancellationError(""));
  assert.ok(cancellationError("   "));
  assert.ok(cancellationError(null));
  assert.equal(cancellationError("Customer request"), null);
});

test("arrangement validation rejects negative fees and a reasonless zero fee", () => {
  const negative = validateArrangement({ agreedFee: -1 });
  assert.equal(negative.ok, false);
  if (!negative.ok) assert.ok(negative.fieldErrors.agreedFee);

  const zeroWithoutReason = validateArrangement({ agreedFee: 0, zeroFeeReason: "" });
  assert.equal(zeroWithoutReason.ok, false);
  if (!zeroWithoutReason.ok) assert.ok(zeroWithoutReason.fieldErrors.zeroFeeReason);

  const valid = validateArrangement({ agreedFee: 50, contactOutcome: "Confirmed" });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.agreedFee, 50);
    assert.equal(valid.value.branchId, null);
  }
});

/* -------------------------------------------------------------------------- */
/* Reference and idempotency helpers                                           */
/* -------------------------------------------------------------------------- */

test("booking references are validated against the database shape", () => {
  assert.ok(BOOKING_REFERENCE_PATTERN.test("2W-7K3M9PQRST"));
  assert.equal(isValidBookingReference("2W-7K3M9PQRST"), true);
  assert.equal(isValidBookingReference("DEMO-001"), false);
  assert.equal(isValidBookingReference("2W-123"), false);
  assert.equal(isValidBookingReference(null), false);
});

test("idempotency keys are long enough for the database constraint", () => {
  const key = createIdempotencyKey();
  assert.equal(isValidIdempotencyKey(key), true);
  assert.ok(key.length >= 16);
  assert.equal(isValidIdempotencyKey("short"), false);
  assert.equal(isValidIdempotencyKey("a".repeat(129)), false);
});

/* -------------------------------------------------------------------------- */
/* Error taxonomy                                                              */
/* -------------------------------------------------------------------------- */

test("database markers map onto the taxonomy and never leak SQL", () => {
  assert.equal(mapBookingDatabaseError("BOOKING_IDEMPOTENCY_MISMATCH: changed"), "idempotency_mismatch");
  assert.equal(mapBookingDatabaseError("BOOKING_CONFIRMATION_INCOMPLETE: assign a branch"), "confirmation_incomplete");
  assert.equal(mapBookingDatabaseError("BOOKING_INVALID_TRANSITION: pending cannot move"), "invalid_transition");
  assert.equal(mapBookingDatabaseError("BOOKING_PICKUP_WINDOW: choose a time"), "pickup_window");
  assert.equal(mapBookingDatabaseError("BOOKING_PICKUP_TIME_PAST: choose a future time"), "pickup_time_past");
  assert.equal(mapBookingDatabaseError("BOOKING_EXPRESS_CUTOFF: by 11:00"), "express_cutoff");
  assert.equal(mapBookingDatabaseError("BOOKING_FORBIDDEN: no admin"), "permission_denied");
  assert.equal(mapBookingDatabaseError("permission denied for table bookings"), "conflict");
  assert.equal(mapBookingDatabaseError(null), "conflict");
});

test("every error code has a safe, non-technical message and a status", () => {
  for (const [code, message] of Object.entries(BOOKING_ERROR_MESSAGES)) {
    assert.ok(message.length > 10, code);
    assert.ok(!/SQL|stack|relation|column|postgres/i.test(message), code);
    const status = bookingErrorStatus(code as BookingErrorCode);
    assert.equal(status >= 400 && status <= 503, true, code);
  }
  assert.equal(bookingErrorStatus("actor_required"), 401);
  assert.equal(bookingErrorStatus("permission_denied"), 403);
  assert.equal(bookingErrorStatus("conflict"), 409);
  assert.equal(bookingErrorStatus("pickup_window"), 422);
  assert.equal(bookingErrorStatus("pickup_time_past"), 422);
});
