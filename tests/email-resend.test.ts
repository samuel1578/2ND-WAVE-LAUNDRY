import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  buildBrevoTemplateParams,
  buildStaffOrderTemplateParams,
  validateEmailTemplateParams,
  type BookingEmailContext,
} from "../src/lib/email/templates";
import { runEmailWorker, type EmailWorkerDeps } from "../src/lib/email/worker";
import type { ClaimedOutboxEmail, EmailOutboxRepository } from "../src/lib/email/outbox-repository";

const context: BookingEmailContext = {
  reference: "2W-ABCDEFGHJK",
  customerName: "Template Preview",
  serviceTitles: ["Wash, Ironing & Fold"],
  requestedDate: "2099-01-01",
  requestedTime: "09:00",
  agreedPickupAt: "2099-01-01T09:00:00Z",
  agreedFee: 50,
  currency: "GHS",
  branch: { title: "Ashaiman–Atadeka" },
};
const staff = {
  previousStatus: "pending" as const,
  actorType: "system" as const,
  actorName: "Template Preview",
  actorRole: null,
  occurredAt: "2099-01-01T09:00:00Z",
  cancellationReason: "Controlled template test.",
};
const siteUrl = "https://2ndwave.example";

const templates = [
  "booking_created", "booking_confirmed", "booking_processing_started", "booking_ready", "booking_completed", "booking_cancelled",
  "staff_order_pending", "staff_order_processing", "staff_order_ready", "staff_order_completed", "staff_order_cancelled",
] as const;

test("all customer and staff template builders satisfy their declared contracts", () => {
  for (const template of templates) {
    const params = template.startsWith("staff_order_")
      ? buildStaffOrderTemplateParams(template as `staff_order_${"pending" | "processing" | "ready" | "completed" | "cancelled"}`, context, staff, { siteUrl })
      : buildBrevoTemplateParams(template as "booking_created" | "booking_confirmed" | "booking_processing_started" | "booking_ready" | "booking_completed" | "booking_cancelled", context, { siteUrl });
    assert.doesNotThrow(() => validateEmailTemplateParams(template, params), template);
  }
});

test("contract validator catches missing required values and unexpected values", () => {
  assert.throws(() => validateEmailTemplateParams("booking_created", { bookingReference: "2W-ABCDEFGHJK" }));
  assert.throws(() => validateEmailTemplateParams("booking_created", { ...buildBrevoTemplateParams("booking_created", context, { siteUrl }), SUPPORT_EMAIL: "fake@example.test" }));
});

test("controlled test worker uses only fixed fixture context and never queries bookings", async () => {
  const id = randomUUID();
  let bookingLookup = false;
  const providerInputs: Array<{ to: string; params: Record<string, string>; idempotencyKey: string }> = [];
  const row: ClaimedOutboxEmail = {
    id,
    bookingId: null,
    template: "booking_created",
    recipientEmail: "qa@example.test",
    payload: { booking_reference: "2W-0000000000", status: "pending" },
    testContext: { booking: context },
    attemptCount: 1,
    maxAttempts: 5,
  };
  const repository: EmailOutboxRepository = {
    async reap() { return 0; },
    async claim() { return [row]; },
    async markSent(input) { assert.equal(input.id, id); return true; },
    async markRetry() { return "retryable_failed"; },
    async markDead() { return true; },
    async loadBookingContext() { bookingLookup = true; return null; },
    async createTestSend() { return id; },
    async resend() { return id; },
  };
  const deps: EmailWorkerDeps = {
    enabled: true,
    repository,
    provider: { async send(input) {
      providerInputs.push({ to: input.to, params: input.params, idempotencyKey: input.idempotencyKey });
      return { ok: true, providerMessageId: "<preview@relay>", duplicate: false };
    } },
    siteUrl,
    templateIds: { booking_created: 101 },
  };
  const result = await runEmailWorker(deps, { workerId: "controlled-test" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.sent, 1);
  assert.equal(bookingLookup, false);
  const providerInput = providerInputs[0];
  assert.ok(providerInput);
  assert.equal(providerInput.to, "qa@example.test");
  assert.equal(providerInput.params.customerName, "Template Preview");
  assert.equal(providerInput.params.bookingReference, context.reference);
  assert.equal(providerInput.idempotencyKey, id);
});
