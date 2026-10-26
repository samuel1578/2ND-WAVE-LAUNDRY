import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOKING_LIST_MAX_PAGE_SIZE,
  BOOKING_LIST_PAGE_SIZE,
  accraInputValue,
  accraLocalToIso,
  agreedPickupAtWindowError,
  agreedPickupWindowError,
  applyBookingFilters,
  bookingListRange,
  bookingSearchFilter,
  mapBookingDetailRow,
  mapBookingSummaryRow,
  normaliseBookingListQuery,
  sanitiseSearchTerm,
  type AdminBookingSummary,
} from "../src/lib/bookings/admin";
import { hasPermission } from "../src/lib/auth/permissions";
import { canTransition, confirmationFieldErrors } from "../src/lib/bookings/lifecycle";
import {
  bookingErrorStatus,
  mapBookingDatabaseError,
} from "../src/lib/bookings/errors";
import { dataBackendNotice } from "../src/lib/features";
import { expressEligibilityError, pickupWindowError } from "../src/lib/bookings/scheduling";

/**
 * Sprint 2C administrator booking tests.
 *
 * These cover the pure layer the live dashboard, the read endpoint and the
 * guarded server actions all rely on: query normalisation and filtering, row
 * mapping, the Africa/Accra scheduling conversions, the pickup-window rule applied
 * to agreed appointments, capability checks and the error taxonomy.
 *
 * The database-level guarantees (RLS, transitions, confirmation prerequisites,
 * optimistic concurrency, atomic history + audit) are enforced by the deployed
 * functions and are exercised by `supabase/tests/sprint_2a_booking_security.sql`,
 * which is NOT executed here. These tests do not claim to prove database
 * behaviour.
 */

const BRANCH_ID = "11111111-1111-1111-1111-111111111111";

function summary(overrides: Partial<AdminBookingSummary> = {}): AdminBookingSummary {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    reference: "2W-7K3M9PQRST",
    customerName: "Ama Mensah",
    customerPhone: "+233595224280",
    services: [{ slug: "ironing", title: "Ironing" }],
    itemCategory: "clothing",
    loadSize: "1 Standard Bag",
    requestedDate: "2099-01-01",
    requestedTime: "09:00",
    expressRequested: false,
    status: "pending",
    assignedBranch: null,
    agreedPickupAt: null,
    agreedFee: null,
    version: 1,
    createdAt: "2099-01-01T08:00:00.000Z",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Query normalisation and filtering                                           */
/* -------------------------------------------------------------------------- */

test("list queries drop invalid filters and clamp pagination", () => {
  assert.deepEqual(normaliseBookingListQuery({}), {
    search: "",
    status: "",
    branch: "",
    date: "",
    page: 1,
    pageSize: BOOKING_LIST_PAGE_SIZE,
  });

  const bounded = normaliseBookingListQuery({
    search: "  Ama <script> ",
    status: "not-a-status",
    branch: "not-a-branch",
    date: "2026-13-40",
    page: "0",
    pageSize: "9999",
  });
  // Invalid status, branch and date are discarded rather than forwarded.
  assert.equal(bounded.status, "");
  assert.equal(bounded.branch, "");
  assert.equal(bounded.date, "");
  assert.equal(bounded.page, 1);
  assert.equal(bounded.pageSize, BOOKING_LIST_MAX_PAGE_SIZE);

  const valid = normaliseBookingListQuery({
    status: "confirmed",
    branch: "unassigned",
    date: "2099-01-01",
    page: "3",
    pageSize: "10",
  });
  assert.equal(valid.status, "confirmed");
  assert.equal(valid.branch, "unassigned");
  assert.equal(valid.date, "2099-01-01");
  assert.equal(valid.page, 3);
  assert.deepEqual(bookingListRange(valid), { from: 20, to: 29 });
});

test("search terms are neutralised and the PostgREST filter is well formed", () => {
  // Grammar characters are removed so the `or` filter cannot be broken or widened.
  assert.equal(sanitiseSearchTerm("a,b(c)*d%e\"f"), "a b c d e f");
  assert.equal(bookingSearchFilter("   "), null);
  assert.equal(
    bookingSearchFilter("2W-7K3M9PQRST"),
    "reference.ilike.*2W-7K3M9PQRST*,customer_name.ilike.*2W-7K3M9PQRST*,customer_phone.ilike.*2W-7K3M9PQRST*",
  );
  // Clauses stay comma-joined, but a comma in the term itself is removed.
  const filter = bookingSearchFilter("x,y");
  assert.ok(filter);
  assert.ok(filter.includes(","));
  assert.ok(!filter.includes("x,y"));
});

test("filters match reference, name, status, branch and requested date", () => {
  const rows = [
    summary({ id: BRANCH_ID, reference: "2W-AAAA111111", status: "pending" }),
    summary({
      id: "33333333-3333-3333-3333-333333333333",
      reference: "2W-BBBB222222",
      customerName: "Kofi Boateng",
      status: "confirmed",
      assignedBranch: {
        id: BRANCH_ID,
        slug: "ashaiman-atadeka",
        title: "Ashaiman–Atadeka",
        label: "Main Branch",
        phone: "059 522 4280",
      },
      requestedDate: "2099-02-02",
    }),
  ];

  const base = normaliseBookingListQuery({});
  assert.equal(applyBookingFilters(rows, base).length, 2);
  assert.equal(
    applyBookingFilters(rows, { ...base, status: "confirmed" }).length,
    1,
  );
  assert.equal(
    applyBookingFilters(rows, { ...base, search: "kofi" })[0].reference,
    "2W-BBBB222222",
  );
  assert.equal(applyBookingFilters(rows, { ...base, search: "2W-AAAA111111" }).length, 1);
  assert.equal(applyBookingFilters(rows, { ...base, branch: "unassigned" }).length, 1);
  assert.equal(
    applyBookingFilters(rows, { ...base, branch: BRANCH_ID }).length,
    1,
  );
  assert.equal(
    applyBookingFilters(rows, { ...base, date: "2099-02-02" }).length,
    1,
  );
});

/* -------------------------------------------------------------------------- */
/* Row mapping                                                                 */
/* -------------------------------------------------------------------------- */

test("a persisted booking row maps to the list projection", () => {
  const mapped = mapBookingSummaryRow({
    id: BRANCH_ID,
    reference: "2W-7K3M9PQRST",
    customer_name: "Ama Mensah",
    customer_phone: "+233595224280",
    item_category: "bedding",
    load_size: "2 Standard Bags",
    requested_date: "2099-01-01",
    requested_time: "09:00:00",
    express_requested: true,
    status: "scheduled",
    agreed_pickup_at: "2099-01-01T09:00:00.000Z",
    agreed_fee: "120.50",
    version: 4,
    created_at: "2099-01-01T08:00:00.000Z",
    branches: {
      id: "44444444-4444-4444-4444-444444444444",
      slug: "katamanso-no-1",
      title: "Katamanso No. 1",
      label: "",
      phone: "059 814 8620",
    },
    booking_services: [
      { service_slug: "ironing", service_title: "Ironing" },
      { service_slug: "wash-and-fold-only", service_title: "Wash and Fold Only" },
    ],
  });

  assert.ok(mapped);
  assert.equal(mapped.status, "scheduled");
  assert.equal(mapped.requestedTime, "09:00");
  assert.equal(mapped.agreedFee, 120.5);
  assert.equal(mapped.version, 4);
  assert.equal(mapped.assignedBranch?.title, "Katamanso No. 1");
  assert.deepEqual(
    mapped.services.map((s) => s.slug),
    ["ironing", "wash-and-fold-only"],
  );
});

test("a malformed booking row fails closed instead of rendering", () => {
  assert.equal(mapBookingSummaryRow(null), null);
  assert.equal(mapBookingSummaryRow({ reference: "x" }), null);
  // An unknown status is not trusted.
  assert.equal(
    mapBookingSummaryRow({
      id: BRANCH_ID,
      reference: "2W-7K3M9PQRST",
      status: "paid",
    }),
    null,
  );
  assert.equal(mapBookingDetailRow({ id: "not-a-uuid" }), null);
});

test("detail mapping includes history, notes and audit without inventing fields", () => {
  const detail = mapBookingDetailRow(
    {
      id: BRANCH_ID,
      reference: "2W-7K3M9PQRST",
      customer_name: "Ama Mensah",
      customer_phone: "+233595224280",
      status: "confirmed",
      requested_date: "2099-01-01",
      version: 3,
      agreed_fee: 0,
      zero_fee_reason: "Loyalty courtesy",
      contact_outcome: "Customer confirmed by phone",
      confirmation_note: "Collected Saturday",
      agreed_fee_currency: "GHS",
    },
    {
      history: [
        {
          from_status: null,
          to_status: "pending",
          actor_kind: "customer",
          reason: null,
          created_at: "2099-01-01T08:00:00.000Z",
        },
        {
          from_status: "pending",
          to_status: "confirmed",
          actor_kind: "admin",
          actor_id: "55555555-5555-5555-5555-555555555555",
          reason: "Agreed",
          created_at: "2099-01-01T09:00:00.000Z",
        },
      ],
      notes: [
        { id: "n1", body: "Called twice", author_id: null, created_at: "2099-01-01T09:05:00.000Z" },
      ],
      audit: [
        { action: "booking.confirmed", actor_id: null, reason: null, created_at: "2099-01-01T09:00:00.000Z" },
      ],
    },
  );

  assert.ok(detail);
  assert.equal(detail.agreedFee, 0);
  assert.equal(detail.zeroFeeReason, "Loyalty courtesy");
  assert.equal(detail.agreedFeeCurrency, "GHS");
  assert.equal(detail.history.length, 2);
  assert.equal(detail.history[0].fromStatus, null);
  assert.equal(detail.history[1].toStatus, "confirmed");
  assert.equal(detail.notes[0].body, "Called twice");
  assert.equal(detail.audit[0].action, "booking.confirmed");
  // A missing field is empty, never fabricated.
  assert.equal(detail.pickupAddress, "");
  assert.deepEqual(detail.services, []);

  // A row without history/notes/audit still maps with empty collections.
  const bare = mapBookingDetailRow({
    id: BRANCH_ID,
    reference: "2W-7K3M9PQRST",
    status: "pending",
  });
  assert.ok(bare);
  assert.deepEqual(bare.history, []);
  assert.deepEqual(bare.notes, []);
  assert.deepEqual(bare.audit, []);
});

/* -------------------------------------------------------------------------- */
/* Africa/Accra scheduling                                                     */
/* -------------------------------------------------------------------------- */

test("agreed pickups use the 07:00–17:00 window and reject closed dates", () => {
  assert.equal(agreedPickupWindowError({ date: "2099-01-01", time: "06:30" })?.code, "pickup_window");
  assert.equal(agreedPickupWindowError({ date: "2099-01-01", time: "07:00" }), null);
  assert.equal(agreedPickupWindowError({ date: "2099-01-01", time: "16:30" }), null);
  assert.equal(agreedPickupWindowError({ date: "2099-01-01", time: "17:00" }), null);
  assert.equal(agreedPickupWindowError({ date: "2099-01-01", time: "17:01" })?.code, "pickup_window");
  assert.equal(agreedPickupWindowError({ date: "2099-01-01", time: null }), null);
  assert.equal(
    agreedPickupWindowError({ date: "2099-01-01", time: "09:00" }, {
      start: "07:00",
      end: "17:00",
      closed: true,
    })?.code,
    "pickup_closed",
  );
  assert.equal(agreedPickupWindowError({ date: "bad", time: "09:00" })?.code, "pickup_date");
});

test("the ordinary pickup window is not the express 11:00 cutoff", () => {
  const now = new Date("2099-01-01T12:30:00Z");
  // 12:30 and 16:00 are inside the 07:00–17:00 window, so an ordinary agreed
  // appointment is accepted even though the express cutoff has passed...
  assert.equal(agreedPickupWindowError({ date: "2099-01-01", time: "12:30" }), null);
  assert.equal(agreedPickupWindowError({ date: "2099-01-01", time: "16:00" }), null);
  // ...while the express cutoff still rejects a same-day express request.
  assert.equal(
    expressEligibilityError({ date: "2099-01-01", express: true }, now)?.code,
    "express_cutoff",
  );
  // The public scheduling rule remains intact and separate.
  assert.equal(pickupWindowError({ date: "2099-01-02", time: "16:00" }, now), null);
});

test("an instant stored for an agreed pickup is validated in Africa/Accra", () => {
  // Africa/Accra is UTC+00 all year: the wall clock maps to the same UTC instant.
  assert.equal(accraLocalToIso("2099-01-01", "09:00"), "2099-01-01T09:00:00.000Z");
  assert.equal(accraInputValue("2099-01-01T09:00:00.000Z"), "2099-01-01T09:00");
  assert.equal(accraInputValue(null), "");
  // Invalid input fails closed rather than recording the wrong instant.
  assert.equal(accraLocalToIso("2099-13-01", "09:00"), null);
  assert.equal(accraLocalToIso("2099-01-01", "25:00"), null);
  // The window helper works from the stored instant.
  assert.equal(agreedPickupAtWindowError("2099-01-01T18:00:00.000Z")?.code, "pickup_window");
  assert.equal(agreedPickupAtWindowError("2099-01-01T09:00:00.000Z"), null);
});

/* -------------------------------------------------------------------------- */
/* Capability, lifecycle and error taxonomy                                    */
/* -------------------------------------------------------------------------- */

test("both administrator roles may manage bookings; other callers may not", () => {
  assert.equal(hasPermission("full_admin", "bookings.manage"), true);
  assert.equal(hasPermission("operational_admin", "bookings.manage"), true);
  assert.equal(hasPermission("full_admin", "bookings.read"), true);
  assert.equal(hasPermission("operational_admin", "bookings.read"), true);
  // No side effect on the restricted modules.
  assert.equal(hasPermission("operational_admin", "staff.manage"), false);
  assert.equal(hasPermission("operational_admin", "settings.manage"), false);
  for (const role of [null, undefined, "", "super_admin"]) {
    assert.equal(hasPermission(role, "bookings.manage"), false, String(role));
    assert.equal(hasPermission(role, "bookings.read"), false, String(role));
  }
});

test("administrator transitions and confirmation prerequisites stay enforced", () => {
  // Permitted and rejected transitions mirror the database function.
  assert.equal(canTransition("pending", "confirmed"), true);
  assert.equal(canTransition("pending", "processing"), false);
  assert.equal(canTransition("completed", "processing"), false);
  assert.equal(canTransition("cancelled", "confirmed"), false);

  // Confirmation is blocked until every required detail is recorded.
  assert.deepEqual(
    Object.keys(
      confirmationFieldErrors({
        branchId: null,
        agreedPickupAt: null,
        agreedFee: null,
        zeroFeeReason: null,
        contactOutcome: null,
        confirmationNote: null,
      }),
    ).length,
    5,
  );
  assert.equal(
    confirmationFieldErrors({
      branchId: BRANCH_ID,
      agreedPickupAt: "2099-01-01T09:00:00.000Z",
      agreedFee: 20,
      zeroFeeReason: null,
      contactOutcome: "Confirmed",
      confirmationNote: "Collected",
    }).branchId,
    undefined,
  );
});

test("rate limiting and conflicts map onto the booking taxonomy", () => {
  assert.equal(mapBookingDatabaseError("BOOKING_RATE_LIMITED: slow down"), "rate_limited");
  assert.equal(bookingErrorStatus("rate_limited"), 429);
  assert.equal(mapBookingDatabaseError("BOOKING_CONFLICT: stale"), "conflict");
  assert.equal(bookingErrorStatus("conflict"), 409);
});

/* -------------------------------------------------------------------------- */
/* Demo-mode isolation and backend honesty                                     */
/* -------------------------------------------------------------------------- */

test("demo mode shows no backend banner while other states stay honest", () => {
  // The isolated demo workspace keeps its sample-data experience and is not
  // warned about a missing backend.
  assert.equal(dataBackendNotice("demo"), null);
  // With a verified session on a configured project, only the unconnected
  // modules are called out — bookings are not sample data.
  const live = dataBackendNotice("live");
  assert.ok(live);
  // Bookings and (since Sprint 3B) reviews are stated as persisted; only the
  // remaining modules are sample data.
  assert.match(live, /^Bookings and reviews are stored in the live database\./);
  assert.match(live, /Enquiries, website content, media and settings are still sample data/);
  const unconfigured = dataBackendNotice("unconfigured");
  assert.ok(unconfigured);
  assert.match(unconfigured, /not connected/);
});
