import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  buildBrevoTemplateParams,
  buildStaffOrderTemplateParams,
  formatEventTimestamp,
  formatStaffStatus,
  isStaffOrderTemplate,
  staffOrderTemplates,
  staffOrderTemplateByStatus,
  STAFF_HEADER_ASSETS,
  type BookingEmailContext,
  type StaffNotificationContext,
} from "../src/lib/email/templates";
import {
  BREVO_STAFF_TEMPLATE_ID_VARS,
  readStaffEmailTemplateIds,
  readTransactionalEmailConfig,
} from "../src/lib/email/config";
import {
  runEmailWorker,
  type EmailWorkerDeps,
} from "../src/lib/email/worker";
import type {
  ClaimedOutboxEmail,
  EmailOutboxRepository,
} from "../src/lib/email/outbox-repository";
import { emailTemplateLabel, isEmailTemplate } from "../src/lib/email/monitoring";

/**
 * Phase 2E.1 staff/admin order alert tests.
 *
 * The delivery tests use a mocked provider and repository only: no network
 * request reaches Brevo, no address is real and no email is sent. Database
 * behaviour (fan-out, idempotency, actor verification) is exercised against
 * PGlite in `staff-order-alerts-db.test.ts`.
 */

const CONTEXT: BookingEmailContext = {
  reference: "2W-7K3M9PQRST",
  customerName: "Ama Mensah",
  serviceTitles: ["Wash, iron & fold"],
  requestedDate: "2099-01-01",
  requestedTime: "09:00",
  agreedPickupAt: "2099-01-01T09:00:00.000Z",
  agreedFee: 50,
  currency: "GHS",
  branch: { title: "Ashaiman–Atadeka" },
};

const STAFF: StaffNotificationContext = {
  previousStatus: "processing",
  actorType: "admin",
  actorName: "Kofi Operator",
  actorRole: "full_admin",
  occurredAt: "2026-10-22T10:30:00.000Z",
  cancellationReason: "Customer requested the cancellation.",
};

const BASE_KEYS = [
  "actorType",
  "bookingReference",
  "bookingStatus",
  "contactUrl",
  "customerName",
  "headerImageAlt",
  "headerImageUrl",
  "privacyUrl",
  "websiteUrl",
];

const VALID_CUSTOMER_ENV = {
  TRANSACTIONAL_EMAILS_ENABLED: "true",
  BREVO_API_KEY: `xkeysib-${"a".repeat(40)}`,
  SITE_URL: "https://2ndwave.example",
  EMAIL_WORKER_SECRET: `worker-${"w".repeat(40)}`,
  BREVO_TEMPLATE_BOOKING_RECEIVED_ID: "101",
  BREVO_TEMPLATE_BOOKING_CONFIRMED_ID: "102",
  BREVO_TEMPLATE_PROCESSING_STARTED_ID: "103",
  BREVO_TEMPLATE_LAUNDRY_READY_ID: "104",
  BREVO_TEMPLATE_BOOKING_COMPLETED_ID: "105",
  BREVO_TEMPLATE_BOOKING_CANCELLED_ID: "106",
};

/* -------------------------------------------------------------------------- */
/* Event mapping                                                              */
/* -------------------------------------------------------------------------- */

test("only the five required order events map to a staff alert", () => {
  assert.deepEqual(Object.keys(staffOrderTemplateByStatus).sort(), [
    "cancelled",
    "completed",
    "pending",
    "processing",
    "ready",
  ]);

  assert.equal(staffOrderTemplateByStatus.pending, "staff_order_pending");
  assert.equal(staffOrderTemplateByStatus.processing, "staff_order_processing");
  assert.equal(staffOrderTemplateByStatus.ready, "staff_order_ready");
  assert.equal(staffOrderTemplateByStatus.completed, "staff_order_completed");
  assert.equal(staffOrderTemplateByStatus.cancelled, "staff_order_cancelled");

  // Lifecycle states that deliberately produce no staff alert.
  for (const status of ["confirmed", "scheduled", "picked_up", "out_for_delivery"] as const)
    assert.equal(staffOrderTemplateByStatus[status], undefined, status);
});

test("every mapped template is a staff template", () => {
  for (const template of staffOrderTemplates)
    assert.equal(isStaffOrderTemplate(template), true, template);
  assert.equal(isStaffOrderTemplate("booking_created"), false);
  assert.equal(isStaffOrderTemplate(undefined), false);
});

/* -------------------------------------------------------------------------- */
/* Parameter contract                                                         */
/* -------------------------------------------------------------------------- */

test("each staff alert renders only the supported parameter set", () => {
  for (const template of staffOrderTemplates) {
    const params = buildStaffOrderTemplateParams(template, CONTEXT, STAFF, {
      siteUrl: "https://2ndwave.example/",
    });

    for (const key of BASE_KEYS) assert.ok(key in params, `${template}: ${key}`);
    assert.equal(
      params.headerImageUrl,
      `https://2ndwave.example/headers/${STAFF_HEADER_ASSETS[template]}`,
    );
    assert.match(params.headerImageAlt, /^2nd Wave Laundry staff alert/);
    assert.equal(params.websiteUrl, "https://2ndwave.example");
    assert.equal(params.contactUrl, "https://2ndwave.example/contact");
    assert.equal(params.privacyUrl, "https://2ndwave.example/privacy");
    assert.equal(params.bookingReference, CONTEXT.reference);
    assert.equal(params.customerName, CONTEXT.customerName);
    assert.equal(params.serviceSummary, "Wash, iron & fold");
    assert.equal(params.requestedPickup, "Thursday, 1 January 2099 at 09:00");
    assert.equal(params.branchName, "Ashaiman–Atadeka");
    assert.equal(params.actorType, "Administrator");
    assert.equal(params.actorName, "Kofi Operator");
    assert.equal(params.actorRole, "Full administrator");
    assert.ok(params.eventAt?.includes("22 October 2026"));

    // Customer-only values are never introduced on a staff alert.
    for (const key of ["agreedPickup", "confirmedFee", "headerImageAltText"])
      assert.equal(key in params, false, `${template}: ${key}`);

    if (template === "staff_order_pending") {
      assert.equal("previousStatus" in params, false);
    } else {
      assert.equal(params.previousStatus, "Processing");
    }

    if (template === "staff_order_cancelled")
      assert.equal(params.cancellationReason, "Customer requested the cancellation.");
    else assert.equal("cancellationReason" in params, false, template);
  }
});

test("unknown metadata is omitted rather than fabricated", () => {
  const emptyContext: BookingEmailContext = {
    reference: "2W-7K3M9PQRST",
    customerName: "",
    serviceTitles: [],
    requestedDate: null,
    requestedTime: null,
    agreedPickupAt: null,
    agreedFee: null,
    currency: "GHS",
    branch: null,
  };

  const params = buildStaffOrderTemplateParams(
    "staff_order_ready",
    emptyContext,
    {
      previousStatus: null,
      actorType: "system",
      actorName: null,
      actorRole: null,
      occurredAt: null,
      cancellationReason: null,
    },
    { siteUrl: "https://2ndwave.example" },
  );

  for (const key of ["serviceSummary", "requestedPickup", "branchName", "previousStatus"])
    assert.equal(key in params, false, key);
  for (const key of ["actorName", "actorRole", "eventAt", "cancellationReason"])
    assert.equal(key in params, false, key);
  assert.equal(params.actorType, "System");
  assert.equal(params.customerName, "");
});

test("a newly placed order never claims a previous lifecycle status", () => {
  const params = buildStaffOrderTemplateParams(
    "staff_order_pending",
    CONTEXT,
    { ...STAFF, previousStatus: "processing" },
    { siteUrl: "https://2ndwave.example" },
  );

  assert.equal("previousStatus" in params, false);
  assert.equal(params.bookingStatus, "Pending");
});

test("only a recorded cancellation carries the cancellation reason", () => {
  const withoutReason = buildStaffOrderTemplateParams(
    "staff_order_cancelled",
    CONTEXT,
    { ...STAFF, cancellationReason: null },
    { siteUrl: "https://2ndwave.example" },
  );
  assert.equal("cancellationReason" in withoutReason, false);

  const withReason = buildStaffOrderTemplateParams(
    "staff_order_cancelled",
    CONTEXT,
    { ...STAFF, cancellationReason: "  Customer\n requested  cancellation. " },
    { siteUrl: "https://2ndwave.example" },
  );
  assert.equal(withReason.cancellationReason, "Customer requested cancellation.");

  // Even if a reason is somehow present, a non-cancellation alert never uses it.
  const processing = buildStaffOrderTemplateParams(
    "staff_order_processing",
    CONTEXT,
    STAFF,
    { siteUrl: "https://2ndwave.example" },
  );
  assert.equal("cancellationReason" in processing, false);
});

test("actor roles and statuses use deliberate labels", () => {
  assert.equal(formatStaffStatus("picked_up"), "Picked up");
  assert.equal(formatStaffStatus("out_for_delivery"), "Out for delivery");
  assert.equal(formatStaffStatus("pending"), "Pending");
  assert.equal(formatStaffStatus(null), null);

  const operational = buildStaffOrderTemplateParams(
    "staff_order_completed",
    CONTEXT,
    { ...STAFF, actorRole: "operational_admin" },
    { siteUrl: "https://2ndwave.example" },
  );
  assert.equal(operational.actorRole, "Operational administrator");

  const unknownRole = buildStaffOrderTemplateParams(
    "staff_order_completed",
    CONTEXT,
    { ...STAFF, actorRole: "owner" },
    { siteUrl: "https://2ndwave.example" },
  );
  assert.equal("actorRole" in unknownRole, false);

  const customerActor = buildStaffOrderTemplateParams(
    "staff_order_pending",
    CONTEXT,
    { ...STAFF, actorType: "customer", actorName: "Ama Mensah", actorRole: null },
    { siteUrl: "https://2ndwave.example" },
  );
  assert.equal(customerActor.actorType, "Customer");
  assert.equal(customerActor.actorName, "Ama Mensah");
  assert.equal("actorRole" in customerActor, false);
});

test("the event timestamp is rendered in the operations timezone", () => {
  assert.equal(
    formatEventTimestamp("2026-10-22T10:30:00.000Z"),
    "Thursday, 22 October 2026 at 10:30 GMT",
  );
  assert.equal(formatEventTimestamp(""), null);
  assert.equal(formatEventTimestamp("not-a-date"), null);
});

/* -------------------------------------------------------------------------- */
/* Customer Phase 2D contract is unchanged                                    */
/* -------------------------------------------------------------------------- */

test("the customer parameter builder keeps its Phase 2D contract", () => {
  const params = buildBrevoTemplateParams("booking_created", CONTEXT, {
    siteUrl: "https://2ndwave.example",
  });

  assert.deepEqual(Object.keys(params).sort(), [
    "bookingReference",
    "bookingStatus",
    "contactUrl",
    "customerName",
    "headerImageAlt",
    "headerImageUrl",
    "privacyUrl",
    "requestedPickup",
    "serviceSummary",
    "websiteUrl",
  ]);
  assert.equal(params.bookingStatus, "Pending confirmation");
  assert.equal(params.headerImageUrl, "https://2ndwave.example/headers/general-booking.png");
  for (const key of ["actorType", "actorName", "previousStatus", "eventAt", "cancellationReason"])
    assert.equal(key in params, false, key);
});

/* -------------------------------------------------------------------------- */
/* Staff template configuration                                               */
/* -------------------------------------------------------------------------- */

test("staff template ids are read independently of the customer configuration", () => {
  // A deployment with only the Phase 2D customer values still delivers customer
  // mail; the staff ids are the only missing part.
  assert.equal(readTransactionalEmailConfig(VALID_CUSTOMER_ENV).ok, true);

  const missing = readStaffEmailTemplateIds({});
  assert.equal(missing.ok, false);
  if (!missing.ok)
    assert.equal(missing.templateVariable, BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_pending);

  assert.equal(
    readStaffEmailTemplateIds({
      ...VALID_CUSTOMER_ENV,
      [BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_pending]: "0",
    }).ok,
    false,
  );

  const valid = readStaffEmailTemplateIds({
    [BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_pending]: "201",
    [BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_processing]: "202",
    [BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_ready]: "203",
    [BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_completed]: "204",
    [BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_cancelled]: "205",
  });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.templateIds.staff_order_ready, 203);

  const duplicate = readStaffEmailTemplateIds({
    [BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_pending]: "201",
    [BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_processing]: "201",
    [BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_ready]: "203",
    [BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_completed]: "204",
    [BREVO_STAFF_TEMPLATE_ID_VARS.staff_order_cancelled]: "205",
  });
  assert.equal(duplicate.ok, false);
});

/* -------------------------------------------------------------------------- */
/* Worker delivery                                                            */
/* -------------------------------------------------------------------------- */

type RepositoryCalls = {
  sent: string[];
  retried: Array<{ error: string; delaySeconds: number }>;
  dead: string[];
};

function staffRow(
  overrides: Partial<ClaimedOutboxEmail> = {},
): ClaimedOutboxEmail {
  return {
    id: randomUUID(),
    bookingId: randomUUID(),
    template: "staff_order_processing",
    recipientEmail: "ops@2ndwave.example",
    payload: { booking_reference: CONTEXT.reference, status: "processing" },
    staff: STAFF,
    attemptCount: 1,
    maxAttempts: 5,
    ...overrides,
  };
}

function makeRepository(
  rows: ClaimedOutboxEmail[],
  options: { markRetry?: "retryable_failed" | "dead" | null } = {},
): { repository: EmailOutboxRepository; calls: RepositoryCalls } {
  const calls: RepositoryCalls = { sent: [], retried: [], dead: [] };

  const repository: EmailOutboxRepository = {
    async reap() {
      return 0;
    },
    async claim() {
      return rows;
    },
    async markSent(input) {
      calls.sent.push(input.id);
      return true;
    },
    async markRetry(input) {
      calls.retried.push({ error: input.error, delaySeconds: input.delaySeconds });
      return options.markRetry ?? "retryable_failed";
    },
    async markDead(input) {
      calls.dead.push(input.error);
      return true;
    },
    async loadBookingContext() {
      return CONTEXT;
    },
    async createTestSend() { return randomUUID(); },
    async resend() { return randomUUID(); },
  };

  return { repository, calls };
}

function workerDeps(
  repository: EmailOutboxRepository,
  overrides: Partial<EmailWorkerDeps> = {},
): EmailWorkerDeps {
  return {
    enabled: true,
    repository,
    provider: {
      send: async () => ({
        ok: true,
        providerMessageId: "<staff-1@relay>",
        duplicate: false,
      }),
    },
    siteUrl: "https://2ndwave.example",
    templateIds: {
      booking_created: 101,
      booking_confirmed: 102,
      booking_processing_started: 103,
      booking_ready: 104,
      booking_completed: 105,
      booking_cancelled: 106,
      staff_order_pending: 201,
      staff_order_processing: 202,
      staff_order_ready: 203,
      staff_order_completed: 204,
      staff_order_cancelled: 205,
    },
    random: () => 0,
    ...overrides,
  };
}

test("the worker sends a staff alert with the staff template id and contract", async () => {
  const { repository, calls } = makeRepository([staffRow()]);
  const sent: Array<Parameters<EmailWorkerDeps["provider"]["send"]>[0]> = [];

  const result = await runEmailWorker(
    workerDeps(repository, {
      provider: {
        send: async (input) => {
          sent.push(input);
          return { ok: true, providerMessageId: "<staff-1@relay>", duplicate: false };
        },
      },
    }),
    { workerId: "worker-staff" },
  );

  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  const payload = sent[0];
  assert.equal(payload.templateId, 202);
  assert.equal(payload.to, "ops@2ndwave.example");
  assert.equal("replyToEmail" in payload, false);
  assert.equal(payload.params.actorType, "Administrator");
  assert.equal(payload.params.actorName, "Kofi Operator");
  assert.equal(payload.params.previousStatus, "Processing");
  assert.equal(payload.params.bookingStatus, "Processing");
  assert.equal(
    payload.params.headerImageUrl,
    "https://2ndwave.example/headers/admin-order-processing.jpeg",
  );
  assert.equal(calls.sent.length, 1);
  if (result.ok) assert.equal(result.sent, 1);
});

test("one recipient's failure does not stop delivery to the others", async () => {
  const failing = staffRow({ recipientEmail: "ops.one@2ndwave.example" });
  const succeeding = staffRow({ recipientEmail: "ops.two@2ndwave.example" });
  const { repository, calls } = makeRepository([failing, succeeding]);
  const attempted: string[] = [];

  const result = await runEmailWorker(
    workerDeps(repository, {
      provider: {
        send: async (input) => {
          attempted.push(input.to);
          if (input.to === "ops.one@2ndwave.example")
            return {
              ok: false,
              classification: "permanent",
              reason: "brevo_http_400_invalid_parameter",
            };
          return { ok: true, providerMessageId: "<staff-2@relay>", duplicate: false };
        },
      },
    }),
    { workerId: "worker-fanout" },
  );

  // Each address is an independent message: a rejected one is dead-lettered
  // while the remaining recipients are still delivered.
  assert.deepEqual(attempted, [
    "ops.one@2ndwave.example",
    "ops.two@2ndwave.example",
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.sent, 1);
    assert.equal(result.dead, 1);
  }
  assert.deepEqual(calls.sent, [succeeding.id]);
  assert.deepEqual(calls.dead, ["brevo_http_400_invalid_parameter"]);
});

test("a staff row stays retryable when its template is not configured", async () => {
  const { repository, calls } = makeRepository([staffRow()]);
  let providerCalled = false;

  const result = await runEmailWorker(
    workerDeps(repository, {
      // Only the Phase 2D customer ids are configured.
      templateIds: { booking_created: 101 },
      provider: {
        send: async () => {
          providerCalled = true;
          return { ok: true, providerMessageId: null, duplicate: false };
        },
      },
    }),
    { workerId: "worker-staff" },
  );

  assert.equal(providerCalled, false);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.retried, 1);
  assert.equal(calls.retried.length, 1);
  assert.equal(calls.retried[0].error, "email_template_not_configured");
  assert.equal(calls.sent.length, 0);
});

test("customer rows still use the Phase 2D builder unchanged", async () => {
  const customer = staffRow({
    template: "booking_created",
    payload: { booking_reference: CONTEXT.reference, status: "pending" },
  });
  delete customer.staff;

  const { repository } = makeRepository([customer]);
  const sent: Array<Parameters<EmailWorkerDeps["provider"]["send"]>[0]> = [];

  await runEmailWorker(
    workerDeps(repository, {
      provider: {
        send: async (input) => {
          sent.push(input);
          return { ok: true, providerMessageId: null, duplicate: false };
        },
      },
    }),
    { workerId: "worker-customer" },
  );

  assert.equal(sent.length, 1);
  const payload = sent[0];
  assert.equal(payload.templateId, 101);
  assert.equal(payload.params.bookingStatus, "Pending confirmation");
  for (const key of ["actorType", "actorName", "previousStatus", "eventAt"])
    assert.equal(key in payload.params, false, key);
});

/* -------------------------------------------------------------------------- */
/* Monitoring                                                                 */
/* -------------------------------------------------------------------------- */

test("the administrator email monitor recognises staff alerts", () => {
  for (const template of staffOrderTemplates) {
    assert.equal(isEmailTemplate(template), true, template);
    assert.match(emailTemplateLabel(template), /^Staff alert/);
  }
});
