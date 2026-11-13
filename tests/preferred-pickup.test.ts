import test from "node:test";
import assert from "node:assert/strict";

import { mapBookingSummaryRow } from "../src/lib/bookings/admin";
import { normaliseClock, preferredPickupTimeLabel } from "../src/lib/bookings/scheduling";
import { toBookingSubmitPayload, validatePublicBookingRequest } from "../src/lib/bookings/validation";
import type { CatalogueService } from "../src/lib/bookings/types";
import {
  buildBrevoTemplateParams,
  buildStaffOrderTemplateParams,
  formatRequestedPickup,
  type BookingEmailContext,
} from "../src/lib/email/templates";
import { withQueuedPickup } from "../src/lib/email/worker";
import type { ClaimedOutboxEmail } from "../src/lib/email/outbox-repository";

/**
 * Preferred pickup, end to end through the pure layers.
 *
 * The client reported that every booking showed "As soon as possible" whatever
 * time the customer chose. These tests pin the value at each hop the request and
 * the notification take — form payload, normalisation, stored `time` mapping,
 * customer email and administrator alert — so a regression at any one of them
 * fails here rather than in production. The database half of the same chain is
 * covered by the PGlite integration tests.
 */

const catalogue: CatalogueService[] = [
  {
    slug: "wash-ironing-fold",
    title: "Wash, Ironing & Fold",
    kind: "laundry",
    bookable: true,
    active: true,
  },
];

const NOW = new Date("2026-11-09T08:00:00Z");

function form(time: string, date = "2099-01-01") {
  return {
    services: ["wash-ironing-fold"],
    category: "Clothing",
    items: "1 Standard Bag",
    notes: "",
    address: "1 Test Street",
    landmark: "",
    map: "",
    date,
    time,
    transport: "No preference",
    name: "Ama Mensah",
    phone: "+233595224280",
    email: "ama@example.test",
    sameWhatsapp: true,
    whatsapp: "",
    contactMethod: "Phone call",
    acknowledged: true,
  };
}

function submitted(time: string, date = "2099-01-01") {
  const validation = validatePublicBookingRequest(form(time, date), {
    services: catalogue,
    now: NOW,
  });
  assert.equal(validation.ok, true, `validation failed for ${time}`);
  if (!validation.ok) throw new Error("unreachable");
  return {
    request: validation.value,
    payload: toBookingSubmitPayload(validation.value, "2026-10-01"),
  };
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "3f0b3d1c-6a55-4c76-9c1e-0a3b5d7e9f11",
    reference: "2W-7K3M",
    status: "pending",
    customer_name: "Ama Mensah",
    customer_phone: "+233595224280",
    requested_date: "2099-01-01",
    // PostgreSQL returns a `time` column with seconds.
    requested_time: "09:00:00",
    version: 1,
    created_at: "2026-11-09T08:00:00Z",
    ...overrides,
  };
}

function emailContext(time: string | null, date = "2099-01-01"): BookingEmailContext {
  return {
    reference: "2W-7K3M",
    customerName: "Ama Mensah",
    serviceTitles: ["Wash, Ironing & Fold"],
    requestedDate: date,
    requestedTime: time,
    agreedPickupAt: null,
    agreedFee: null,
    currency: "GHS",
    branch: null,
  };
}

function claimed(
  payload: Record<string, unknown>,
  template: ClaimedOutboxEmail["template"] = "booking_created",
): ClaimedOutboxEmail {
  return {
    id: "b4c0e5d6-1f2a-4b3c-8d9e-0f1a2b3c4d5e",
    bookingId: "3f0b3d1c-6a55-4c76-9c1e-0a3b5d7e9f11",
    template,
    recipientEmail: "ama@example.test",
    payload: payload as ClaimedOutboxEmail["payload"],
    attemptCount: 0,
    maxAttempts: 5,
  };
}

/* -------------------------------------------------------------------------- */
/* A. "As soon as possible"                                                    */
/* -------------------------------------------------------------------------- */

test("A: no selected time submits no time and renders the immediate option", () => {
  const { request, payload } = submitted("");

  assert.equal(request.requestedTime, null);
  assert.equal(payload.requested_time, null);

  // The stored booking has no clock time, so every surface says the same thing.
  assert.equal(mapBookingSummaryRow(storedRow({ requested_time: null }))?.requestedTime, null);
  assert.equal(preferredPickupTimeLabel(null), "As soon as possible");
  assert.equal(
    formatRequestedPickup("2099-01-01", null),
    "Thursday, 1 January 2099 at As soon as possible",
  );
});

/* -------------------------------------------------------------------------- */
/* B. A specific morning time                                                  */
/* -------------------------------------------------------------------------- */

test("B: a morning selection survives the form, payload, row mapping and both emails", () => {
  const { request, payload } = submitted("08:30");

  assert.equal(request.requestedTime, "08:30");
  assert.equal(payload.requested_time, "08:30");

  const mapped = mapBookingSummaryRow(storedRow({ requested_time: "08:30:00" }));
  assert.equal(mapped?.requestedTime, "08:30");
  assert.equal(preferredPickupTimeLabel(mapped?.requestedTime), "08:30");

  const customer = buildBrevoTemplateParams("booking_created", emailContext("08:30"), {
    siteUrl: "https://2ndwave.example",
  });
  assert.equal(customer.requestedPickup, "Thursday, 1 January 2099 at 08:30");

  const staff = buildStaffOrderTemplateParams(
    "staff_order_pending",
    emailContext("08:30"),
    {
      previousStatus: null,
      actorType: "customer",
      actorName: "Ama Mensah",
      actorRole: null,
      occurredAt: "2026-11-09T08:00:00Z",
      cancellationReason: null,
    },
    { siteUrl: "https://2ndwave.example", bookingId: "8f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f" },
  );
  assert.equal(staff.requestedPickup, "Thursday, 1 January 2099 at 08:30");
});

/* -------------------------------------------------------------------------- */
/* C. A specific afternoon time                                                */
/* -------------------------------------------------------------------------- */

test("C: an afternoon selection keeps its exact clock time through every hop", () => {
  const { request, payload } = submitted("16:45");

  assert.equal(request.requestedTime, "16:45");
  assert.equal(payload.requested_time, "16:45");
  assert.equal(
    mapBookingSummaryRow(storedRow({ requested_time: "16:45:00" }))?.requestedTime,
    "16:45",
  );

  const customer = buildBrevoTemplateParams("booking_created", emailContext("16:45:00"), {
    siteUrl: "https://2ndwave.example",
  });
  assert.equal(customer.requestedPickup, "Thursday, 1 January 2099 at 16:45");
});

/* -------------------------------------------------------------------------- */
/* D. A different pickup date                                                  */
/* -------------------------------------------------------------------------- */

test("D: a different pickup date and time stay paired and are never shifted", () => {
  const { payload } = submitted("15:15", "2099-03-31");

  assert.equal(payload.requested_date, "2099-03-31");
  assert.equal(payload.requested_time, "15:15");

  const customer = buildBrevoTemplateParams(
    "booking_created",
    emailContext("15:15", "2099-03-31"),
    { siteUrl: "https://2ndwave.example" },
  );
  assert.equal(customer.requestedPickup, "Tuesday, 31 March 2099 at 15:15");
});

/* -------------------------------------------------------------------------- */
/* Outbox and worker render path                                               */
/* -------------------------------------------------------------------------- */

test("a queued payload carries the pickup that was committed with the booking", () => {
  const context = withQueuedPickup(
    emailContext(null),
    claimed({
      booking_reference: "2W-7K3M",
      status: "pending",
      requested_date: "2099-01-01",
      requested_time: "13:20",
    }),
  );

  assert.equal(context.requestedDate, "2099-01-01");
  assert.equal(context.requestedTime, "13:20");
  assert.equal(
    buildBrevoTemplateParams("booking_created", context, {
      siteUrl: "https://2ndwave.example",
    }).requestedPickup,
    "Thursday, 1 January 2099 at 13:20",
  );
});

test("a row queued before the fix still renders from the committed booking", () => {
  // No pickup keys in the payload: the worker must fall back to the booking
  // record rather than inventing or blanking the preference.
  const queued = withQueuedPickup(
    emailContext("11:05"),
    claimed({ booking_reference: "2W-7K3M", status: "pending" }),
  );
  assert.equal(
    buildBrevoTemplateParams("booking_created", queued, {
      siteUrl: "https://2ndwave.example",
    }).requestedPickup,
    "Thursday, 1 January 2099 at 11:05",
  );

  const queuedImmediate = withQueuedPickup(
    emailContext(null),
    claimed({ booking_reference: "2W-7K3M", status: "pending" }),
  );
  assert.equal(
    buildBrevoTemplateParams("booking_created", queuedImmediate, {
      siteUrl: "https://2ndwave.example",
    }).requestedPickup,
    "Thursday, 1 January 2099 at As soon as possible",
  );
});

test("the committed booking wins over a conflicting queued value", () => {
  const context = withQueuedPickup(
    emailContext("09:00"),
    claimed({
      booking_reference: "2W-7K3M",
      status: "pending",
      requested_date: "2099-01-01",
      requested_time: "14:00",
    }),
  );
  assert.equal(context.requestedTime, "09:00");
});

/* -------------------------------------------------------------------------- */
/* Canonicalisation                                                            */
/* -------------------------------------------------------------------------- */

test("clock values are canonicalised, and only a real time is ever displayed", () => {
  assert.equal(normaliseClock("09:00"), "09:00");
  assert.equal(normaliseClock("09:00:00"), "09:00");
  assert.equal(normaliseClock("09:00:00.000"), "09:00");
  assert.equal(normaliseClock(" 16:45 "), "16:45");
  assert.equal(normaliseClock(""), null);
  assert.equal(normaliseClock(null), null);
  assert.equal(normaliseClock(undefined), null);
  assert.equal(normaliseClock("9:00"), null);
  assert.equal(normaliseClock("24:00"), null);

  assert.equal(preferredPickupTimeLabel("09:00:00"), "09:00");
  assert.equal(preferredPickupTimeLabel(""), "As soon as possible");
  assert.equal(preferredPickupTimeLabel(undefined), "As soon as possible");
});

test("every admin list row shows the selected time or the immediate option", () => {
  // A null time means the customer chose the immediate option; it is never
  // produced for a booking that recorded a clock time.
  for (const [stored, expected] of [
    ["07:00:00", "07:00"],
    ["12:00:00", "12:00"],
    ["17:00:00", "17:00"],
    [null, "As soon as possible"],
  ] as const) {
    const row = mapBookingSummaryRow(storedRow({ requested_time: stored }));
    assert.equal(preferredPickupTimeLabel(row?.requestedTime), expected);
  }
});
