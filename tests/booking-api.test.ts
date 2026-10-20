import test from "node:test";
import assert from "node:assert/strict";
import {
  handleBookingSubmission,
  type BookingSubmissionDeps,
} from "../src/lib/bookings/submission";
import type { CatalogueService } from "../src/lib/bookings/types";
import type { RateLimitOutcome } from "../src/lib/security/booking-rate-limit";

/**
 * Sprint 2B public submission handler tests.
 *
 * These exercise the orchestrator with isolated dependencies, using the real
 * validation and scheduling utilities. No database, network or environment is
 * required. The database-level behaviour is covered by
 * `supabase/tests/sprint_2a_booking_security.sql` (NOT EXECUTED here).
 */

const NOW = () => new Date("2026-10-11T08:00:00Z");

const catalogue: CatalogueService[] = [
  { slug: "wash-ironing-fold", title: "Wash, Ironing & Fold", kind: "laundry", bookable: true, active: true },
  { slug: "ironing", title: "Ironing", kind: "laundry", bookable: true, active: true },
  { slug: "express-same-day-laundry", title: "Express/Same-Day Laundry", kind: "modifier", bookable: true, active: true },
];

const allowed: RateLimitOutcome = { status: "allowed", remaining: 5, limit: 5 };
const allowLimiter = { consume: async () => allowed };

const EXISTING_KEY = "abcdef0123456789abcdef0123456789";

function body(overrides: Record<string, unknown> = {}) {
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
    email: "customer@example.test",
    sameWhatsapp: true,
    whatsapp: "",
    contactMethod: "Phone call",
    acknowledged: true,
    photoNames: [],
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<BookingSubmissionDeps> = {},
  submitImpl?: BookingSubmissionDeps["submit"],
) {
  const calls: Array<{ services: string[]; idempotencyKey: string }> = [];
  const deps: BookingSubmissionDeps = {
    enabled: true,
    configured: true,
    catalogue,
    rateLimiter: allowLimiter,
    now: NOW,
    submit: async (input) => {
      calls.push({ services: input.services, idempotencyKey: input.idempotencyKey });
      return (
        submitImpl?.(input) ?? {
          ok: true,
          data: {
            bookingId: "11111111-1111-1111-1111-111111111111",
            reference: "2W-7K3M9PQRST",
            status: "pending",
            version: 1,
            replayed: false,
          },
        }
      );
    },
    ...overrides,
  };
  return { deps, calls };
}

const input = (
  overrides: Partial<Parameters<typeof handleBookingSubmission>[0]> = {},
) => ({
  body: body(),
  idempotencyKey: EXISTING_KEY,
  origin: { ok: true } as const,
  identity: "hashed-client",
  correlationId: "corr-1",
  ...overrides,
});

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

test("a cross-origin request is rejected before anything else", async () => {
  const { deps, calls } = makeDeps();
  const res = await handleBookingSubmission(
    input({ origin: { ok: false, reason: "cross-origin" } }),
    deps,
  );
  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
  assert.equal(calls.length, 0);
});

test("submission is disabled until explicitly activated", async () => {
  const { deps, calls } = makeDeps({ enabled: false });
  const res = await handleBookingSubmission(input(), deps);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "submissions_disabled");
  assert.equal(calls.length, 0);
});

test("the trusted server supplies the notice version, never the request body", async () => {
  let payload: Record<string, unknown> | undefined;
  const { deps } = makeDeps({ noticeVersion: "2026-10-01" }, async (call) => {
    payload = call.payload;
    return {
      ok: true,
      data: {
        bookingId: "11111111-1111-1111-1111-111111111111",
        reference: "2W-7K3M9PQRST",
        status: "pending",
        version: 1,
        replayed: false,
      },
    };
  });

  const res = await handleBookingSubmission(
    input({ body: body({ noticeVersion: "forged-client-version" }) }),
    deps,
  );

  assert.equal(res.status, 201);
  assert.equal(payload?.notice_version, "2026-10-01");
});

test("an unconfigured deployment fails closed", async () => {
  for (const overrides of [{ configured: false }, { catalogue: null }] as const) {
    const { deps, calls } = makeDeps(overrides);
    const res = await handleBookingSubmission(input(), deps);
    assert.equal(res.status, 503, JSON.stringify(overrides));
    assert.equal(res.body.code, "not_configured");
    assert.equal(calls.length, 0);
  }
});

test("a limited caller receives 429 with Retry-After and no submission", async () => {
  const { deps, calls } = makeDeps({
    rateLimiter: { consume: async () => ({ status: "limited", retryAfterSeconds: 42, limit: 5 }) },
  });
  const res = await handleBookingSubmission(input(), deps);
  assert.equal(res.status, 429);
  assert.equal(res.headers["Retry-After"], "42");
  assert.equal(calls.length, 0);
});

test("an unavailable rate limiter fails closed", async () => {
  const { deps, calls } = makeDeps({
    rateLimiter: { consume: async () => ({ status: "unavailable" }) },
  });
  const res = await handleBookingSubmission(input(), deps);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "rate_limit_unavailable");
  assert.equal(calls.length, 0);
});

test("a missing or short idempotency key is rejected", async () => {
  for (const key of [null, "", "short"]) {
    const { deps, calls } = makeDeps();
    const res = await handleBookingSubmission(input({ idempotencyKey: key }), deps);
    assert.equal(res.status, 422, String(key));
    assert.equal(res.body.code, "idempotency_required");
    assert.equal(calls.length, 0);
  }
});

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

test("a 06:30 pickup is rejected and never reaches the database", async () => {
  const { deps, calls } = makeDeps();
  const res = await handleBookingSubmission(
    input({ body: body({ date: "2026-10-12", time: "06:30" }) }),
    deps,
  );
  assert.equal(res.status, 422);
  assert.ok((res.body.fieldErrors as Record<string, string>).date);
  assert.equal(calls.length, 0);
});

test("a 07:00 pickup is accepted", async () => {
  const { deps, calls } = makeDeps();
  const res = await handleBookingSubmission(
    input({ body: body({ date: "2026-10-12", time: "07:00" }) }),
    deps,
  );
  assert.equal(res.status, 201);
  assert.equal(calls.length, 1);
});

test("a 17:00 pickup is accepted and a 17:30 pickup is rejected", async () => {
  const accepted = makeDeps();
  assert.equal(
    (await handleBookingSubmission(input({ body: body({ date: "2026-10-12", time: "17:00" }) }), accepted.deps)).status,
    201,
  );
  const rejected = makeDeps();
  const res = await handleBookingSubmission(
    input({ body: body({ date: "2026-10-12", time: "17:30" }) }),
    rejected.deps,
  );
  assert.equal(res.status, 422);
  assert.equal(rejected.calls.length, 0);
});

test("a past same-day time is rejected", async () => {
  const { deps, calls } = makeDeps();
  const res = await handleBookingSubmission(
    input({ body: body({ date: "2026-10-11", time: "07:30" }) }),
    deps,
  );
  assert.equal(res.status, 422);
  assert.ok((res.body.fieldErrors as Record<string, string>).date);
  assert.equal(calls.length, 0);
});

test("a missing phone is rejected; an email-less request is accepted", async () => {
  const missing = makeDeps();
  const rejected = await handleBookingSubmission(input({ body: body({ phone: "" }) }), missing.deps);
  assert.equal(rejected.status, 422);
  assert.ok((rejected.body.fieldErrors as Record<string, string>).phone);
  assert.equal(missing.calls.length, 0);

  const noEmail = makeDeps();
  const accepted = await handleBookingSubmission(input({ body: body({ email: "" }) }), noEmail.deps);
  assert.equal(accepted.status, 201);
  assert.equal(noEmail.calls.length, 1);
});

test("unknown, empty and duplicate service selections are rejected", async () => {
  for (const overrides of [
    { services: [] },
    { services: ["not-a-service"] },
    { services: ["ironing", "ironing"] },
  ]) {
    const { deps, calls } = makeDeps();
    const res = await handleBookingSubmission(input({ body: body(overrides) }), deps);
    assert.equal(res.status, 422, JSON.stringify(overrides));
    assert.ok((res.body.fieldErrors as Record<string, string>).services);
    assert.equal(calls.length, 0);
  }
});

test("express for today after the 11:00 cutoff is rejected", async () => {
  const { deps, calls } = makeDeps({ now: () => new Date("2026-10-11T12:00:00Z") });
  const res = await handleBookingSubmission(
    input({ body: body({ services: ["express-same-day-laundry"], date: "2026-10-11", time: "12:00" }) }),
    deps,
  );
  assert.equal(res.status, 422);
  assert.ok((res.body.fieldErrors as Record<string, string>).date);
  assert.equal(calls.length, 0);
});

test("an ordinary request after the express cutoff is accepted", async () => {
  const { deps } = makeDeps({ now: () => new Date("2026-10-11T14:00:00Z") });
  const res = await handleBookingSubmission(
    input({ body: body({ date: "2026-10-11", time: "15:00" }) }),
    deps,
  );
  assert.equal(res.status, 201);
});

/* -------------------------------------------------------------------------- */
/* Success and idempotency                                                     */
/* -------------------------------------------------------------------------- */

test("a valid submission returns 201 with a minimal body and no personal data", async () => {
  const { deps, calls } = makeDeps();
  const res = await handleBookingSubmission(input(), deps);
  assert.equal(res.status, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.reference, "2W-7K3M9PQRST");
  assert.equal(res.body.status, "pending");
  assert.equal(res.body.replayed, false);

  // The response never echoes customer personal data.
  const serialised = JSON.stringify(res.body);
  for (const secret of ["Test Customer", "+233595224280", "customer@example.test", "1 Test Street"])
    assert.ok(!serialised.includes(secret), secret);

  // Only one booking is attempted, with the selected service forwarded.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].services, ["wash-ironing-fold"]);
});

test("an idempotent replay returns 200 with the original reference", async () => {
  const { deps } = makeDeps({}, async () => ({
    ok: true,
    data: {
      bookingId: "11111111-1111-1111-1111-111111111111",
      reference: "2W-7K3M9PQRST",
      status: "pending",
      version: 1,
      replayed: true,
    },
  }));
  const res = await handleBookingSubmission(input(), deps);
  assert.equal(res.status, 200);
  assert.equal(res.body.replayed, true);
  assert.equal(res.body.reference, "2W-7K3M9PQRST");
});

test("a database conflict is reported as 409", async () => {
  const { deps } = makeDeps({}, async () => ({ ok: false, code: "conflict" }));
  const res = await handleBookingSubmission(input(), deps);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "conflict");
  // The safe message is returned, never raw SQL.
  assert.ok(!/SQL|postgres|relation/i.test(String(res.body.message)));
});

test("a reused key with changed content is reported as a conflict", async () => {
  const { deps } = makeDeps({}, async () => ({ ok: false, code: "idempotency_mismatch" }));
  const res = await handleBookingSubmission(input(), deps);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "idempotency_mismatch");
});

test("a paused site returns 503 and preserves nothing partial", async () => {
  const { deps } = makeDeps({}, async () => ({ ok: false, code: "paused" }));
  const res = await handleBookingSubmission(input(), deps);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "paused");
});
