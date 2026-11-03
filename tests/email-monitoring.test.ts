import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EMAIL_TEMPLATES,
  canManageEmailDelivery,
  emailDeliveryStatusLabel,
  emailMonitoringReference,
  emailTemplateLabel,
  latestEmailDeliveryEvent,
  normaliseEmailMonitoringQuery,
  type EmailDeliveryEventSummary,
} from "../src/lib/email/monitoring";
import {
  BREVO_ENQUIRY_TEMPLATE_ID_VARS,
  readEnquiryTemplateIds,
} from "../src/lib/email/config";
import { resolveAdminRouteAccess } from "../src/lib/auth/permissions";

test("email delivery visibility remains Full Admin-only", () => {
  assert.equal(canManageEmailDelivery("full_admin"), true);
  assert.equal(canManageEmailDelivery("operational_admin"), false);
  assert.equal(canManageEmailDelivery(null), false);
  assert.equal(
    resolveAdminRouteAccess("operational_admin", "/admin/email-delivery").kind,
    "forbidden",
  );
  assert.equal(
    resolveAdminRouteAccess(null, "/admin/email-delivery").kind,
    "forbidden",
  );
});

test("monitoring query filters and pagination are validated and bounded", () => {
  assert.deepEqual(
    normaliseEmailMonitoringQuery({
      status: "dead",
      eventType: "booking_ready",
      bookingId: "11111111-1111-1111-1111-111111111111",
      page: "3",
      pageSize: "500",
    }),
    {
      status: "dead",
      eventType: "booking_ready",
      bookingId: "11111111-1111-1111-1111-111111111111",
      page: 3,
      pageSize: 50,
    },
  );
  assert.deepEqual(
    normaliseEmailMonitoringQuery({
      status: "sent;delete",
      eventType: "unknown",
      bookingId: "not-an-id",
      page: "-1",
      pageSize: "0",
    }),
    {
      status: "",
      eventType: "",
      bookingId: "",
      page: 1,
      pageSize: 20,
    },
  );
});

test("provider acceptance is not described as inbox delivery", () => {
  assert.equal(emailDeliveryStatusLabel("sent", null), "Accepted by provider");
  assert.equal(
    emailDeliveryStatusLabel("sent", {
      event: "delivered",
      reason: null,
      providerEventAt: "2026-10-19T10:00:00Z",
      receivedAt: "2026-10-19T10:01:00Z",
    }),
    "Delivered",
  );
});

test("enquiry delivery records are an accepted, displayable monitoring template", () => {
  assert.ok((EMAIL_TEMPLATES as readonly string[]).includes("enquiry_received"));
  assert.equal(emailTemplateLabel("enquiry_received"), "Enquiry — new submission");

  // Enquiries have no booking, so the monitor never fabricates a reference.
  assert.equal(
    emailMonitoringReference("enquiry_received", {
      enquiry_id: "123e4567-e89b-12d3-a456-426614174000",
      kind: "commercial",
    }),
    "Enquiry — commercial quote 123e4567",
  );
  assert.equal(
    emailMonitoringReference("enquiry_received", {
      enquiry_id: "123e4567-e89b-12d3-a456-426614174000",
      kind: "general",
    }),
    "Enquiry — general enquiry 123e4567",
  );
  assert.equal(
    emailMonitoringReference("enquiry_received", { kind: "general" }),
    null,
  );
  assert.equal(
    emailMonitoringReference("enquiry_received", { enquiry_id: "not-a-uuid" }),
    null,
  );
  assert.equal(
    emailMonitoringReference("booking_ready", {
      booking_reference: "2W-7K3M9PQRST",
    }),
    "2W-7K3M9PQRST",
  );
  assert.equal(
    emailMonitoringReference("newsletter_interest_received", {
      subscriber_email: "ama@example.test",
    }),
    "ama@example.test",
  );

  // The repository must accept the template instead of rejecting the whole page.
  const repository = readFileSync(
    "src/lib/email/monitoring-repository.ts",
    "utf8",
  );
  assert.match(repository, /"enquiry_received"/);
  assert.match(repository, /emailMonitoringReference\(template, row\.payload\)/);
  assert.doesNotMatch(repository, /row\.payload\?\.booking_reference/);
});

test("a missing enquiry template variable is reported without inventing an ID", () => {
  assert.equal(
    BREVO_ENQUIRY_TEMPLATE_ID_VARS.enquiry_received,
    "BREVO_TEMPLATE_ENQUIRY_RECEIVED_ID",
  );
  assert.deepEqual(readEnquiryTemplateIds({}), {
    ok: false,
    reason: "missing-template-id",
    templateVariable: "BREVO_TEMPLATE_ENQUIRY_RECEIVED_ID",
  });
  assert.deepEqual(
    readEnquiryTemplateIds({ BREVO_TEMPLATE_ENQUIRY_RECEIVED_ID: "808" }),
    { ok: true, templateIds: { enquiry_received: 808 } },
  );
  assert.equal(
    readEnquiryTemplateIds({ BREVO_TEMPLATE_ENQUIRY_RECEIVED_ID: "not-a-number" }).ok,
    false,
  );
});

test("late deferral events cannot regress a terminal delivery outcome", () => {
  const events: EmailDeliveryEventSummary[] = [
    {
      event: "delivered",
      reason: null,
      providerEventAt: "2026-10-19T10:00:00Z",
      receivedAt: "2026-10-19T10:02:00Z",
    },
    {
      event: "deferred",
      reason: "old deferred notification",
      providerEventAt: "2026-10-19T09:59:00Z",
      receivedAt: "2026-10-19T10:03:00Z",
    },
  ];
  assert.equal(latestEmailDeliveryEvent(events)?.event, "delivered");
});
