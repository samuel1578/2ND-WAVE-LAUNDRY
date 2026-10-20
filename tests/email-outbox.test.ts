import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PRIVACY_NOTICE_VERSION_LENGTH,
  PRIVACY_NOTICE_VERSION_VAR,
  readPrivacyNoticeVersion,
} from "../src/lib/bookings/notice";

/**
 * Sprint 2D.1 privacy-notice configuration tests.
 *
 * The database behaviour of the outbox is executed against PGlite in
 * `tests/email-outbox-db.test.ts` and `tests/email-outbox-integration-db.test.ts`.
 * These tests cover the server-only trust boundary: the notice version is read
 * from deployment configuration, never from a browser request, and no version is
 * fabricated when none was approved.
 */

test("no notice version is invented when the deployment has not configured one", () => {
  assert.equal(readPrivacyNoticeVersion({}), null);
  assert.equal(readPrivacyNoticeVersion({ [PRIVACY_NOTICE_VERSION_VAR]: "" }), null);
  assert.equal(readPrivacyNoticeVersion({ [PRIVACY_NOTICE_VERSION_VAR]: "   " }), null);
});

test("an approved version is accepted after trimming", () => {
  assert.equal(
    readPrivacyNoticeVersion({ [PRIVACY_NOTICE_VERSION_VAR]: " 2026-10-01 " }),
    "2026-10-01",
  );
  assert.equal(
    readPrivacyNoticeVersion({ [PRIVACY_NOTICE_VERSION_VAR]: "v1.1" }),
    "v1.1",
  );
  assert.equal(
    readPrivacyNoticeVersion({ [PRIVACY_NOTICE_VERSION_VAR]: "privacy_2026" }),
    "privacy_2026",
  );
});

test("invalid version values are treated as unset rather than persisted verbatim", () => {
  for (const value of [
    "has spaces",
    "semi;colon",
    "<script>",
    "line\nbreak",
    "-leading-punctuation",
    "x".repeat(MAX_PRIVACY_NOTICE_VERSION_LENGTH + 1),
  ]) {
    assert.equal(
      readPrivacyNoticeVersion({ [PRIVACY_NOTICE_VERSION_VAR]: value }),
      null,
      value,
    );
  }
});
