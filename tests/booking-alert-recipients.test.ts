import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ENABLED_BOOKING_ALERT_RECIPIENTS,
  bookingAlertRecipientErrorMessage,
  isBookingAlertRecipientId,
  isBookingAlertRecipientVersion,
  normaliseBookingAlertRecipientEmail,
  validateBookingAlertRecipientEmail,
} from "../src/lib/email/recipient-rules";
import {
  hasPermission,
  resolveAdminRouteAccess,
} from "../src/lib/auth/permissions";

/**
 * Phase 2E.2 central order-alert recipient rules.
 *
 * Pure validation and authorisation only: no database, no session and no email.
 * Persistence, fan-out, uniqueness, the cap and failure isolation are exercised
 * against real PostgreSQL in `staff-order-alerts-db.test.ts`.
 */

test("addresses are normalised to the database's stored form", () => {
  assert.equal(
    normaliseBookingAlertRecipientEmail("  Ops.Team@2ndWave.Example "),
    "ops.team@2ndwave.example",
  );
  assert.equal(normaliseBookingAlertRecipientEmail(undefined), "");
  assert.equal(normaliseBookingAlertRecipientEmail(42), "");
});

test("valid addresses are accepted after normalisation", () => {
  for (const input of [
    "ops@2ndwave.example",
    "  Ops.Team@2ndWave.Example ",
    "alerts+orders@2nd-wave.co.uk",
  ]) {
    const result = validateBookingAlertRecipientEmail(input);
    assert.equal(result.ok, true, input);
    if (result.ok)
      assert.equal(result.email, normaliseBookingAlertRecipientEmail(input));
  }
});

test("invalid addresses are rejected with a precise message", () => {
  for (const input of [
    "",
    "   ",
    "not-an-email",
    "ops@",
    "ops@2ndwave",
    "ops team@2ndwave.example",
    `${"a".repeat(250)}@2ndwave.example`,
    null,
    undefined,
    123,
  ]) {
    const result = validateBookingAlertRecipientEmail(input);
    assert.equal(result.ok, false, String(input));
    if (!result.ok) {
      assert.equal(result.code, "invalid_email");
      assert.equal(result.message, "Enter a valid email address.");
    }
  }
});

test("row identifiers and versions are checked before any write", () => {
  assert.equal(
    isBookingAlertRecipientId("0b6b1f0e-6f0f-4f6a-9f5b-0c3f2a7d8e91"),
    true,
  );
  assert.equal(isBookingAlertRecipientId("not-a-uuid"), false);
  assert.equal(isBookingAlertRecipientId(""), false);
  assert.equal(isBookingAlertRecipientId(null), false);

  assert.equal(isBookingAlertRecipientVersion(1), true);
  assert.equal(isBookingAlertRecipientVersion(7), true);
  assert.equal(isBookingAlertRecipientVersion(0), false);
  assert.equal(isBookingAlertRecipientVersion(1.5), false);
  assert.equal(isBookingAlertRecipientVersion("1"), false);
});

test("the recipient interface exposes stable error messages", () => {
  assert.match(bookingAlertRecipientErrorMessage("duplicate"), /already/);
  assert.match(bookingAlertRecipientErrorMessage("limit_reached"), /10/);
  assert.match(bookingAlertRecipientErrorMessage("permission_denied"), /permission/);
  assert.match(bookingAlertRecipientErrorMessage("conflict"), /Reload/);
  assert.equal(MAX_ENABLED_BOOKING_ALERT_RECIPIENTS, 10);
});

test("only a Full Admin may reach the recipient settings surface", () => {
  assert.equal(hasPermission("full_admin", "settings.manage"), true);
  assert.equal(hasPermission("operational_admin", "settings.manage"), false);
  assert.equal(hasPermission(null, "settings.manage"), false);
  assert.equal(hasPermission("super_admin", "settings.manage"), false);

  assert.equal(
    resolveAdminRouteAccess("full_admin", "/admin/settings").kind,
    "allowed",
  );
  assert.equal(
    resolveAdminRouteAccess("operational_admin", "/admin/settings").kind,
    "forbidden",
  );
  assert.equal(
    resolveAdminRouteAccess(null, "/admin/settings").kind,
    "forbidden",
  );
});
