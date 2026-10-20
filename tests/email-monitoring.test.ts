import test from "node:test";
import assert from "node:assert/strict";
import {
  canManageEmailDelivery,
  emailDeliveryStatusLabel,
  latestEmailDeliveryEvent,
  normaliseEmailMonitoringQuery,
  type EmailDeliveryEventSummary,
} from "../src/lib/email/monitoring";
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
