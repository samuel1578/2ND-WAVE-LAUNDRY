/**
 * Server-approved privacy-notice version for public booking submissions.
 *
 * The SRS requires the *server* to apply the notice version that was actually
 * published when the form was served. The browser must not choose it: a client
 * value would let a submission claim any consent version it liked.
 *
 * The version is therefore read from a server-only environment variable, never
 * from request JSON. It is stored on the booking by the existing trusted
 * `booking_submit` function (the `notice_version` column already exists).
 *
 * IMPORTANT — current source-of-truth status:
 * No approved privacy-policy version string exists in this repository yet. The
 * published policy body lives in `src/data/content.json` section 18, but neither
 * that content nor the source documents define a version identifier or effective
 * date. Until the owner supplies one, this module returns `null` and the booking
 * records no version. Setting the variable does not fabricate consent; it records
 * which published notice applied.
 *
 * Accepted shape: 1–60 characters, starting alphanumeric and restricted to
 * letters, digits, dot, underscore and hyphen (for example `2026-10-01` or
 * `v1.1`). An invalid value is treated as unset rather than written verbatim.
 */

export const PRIVACY_NOTICE_VERSION_VAR = "BOOKING_PRIVACY_NOTICE_VERSION";
export const MAX_PRIVACY_NOTICE_VERSION_LENGTH = 60;

const NOTICE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;

/**
 * Reads and validates the server-approved notice version. Returns `null` when no
 * approved version is configured, so an absent notice is recorded as absent — it
 * is never replaced with guessed wording or a fabricated version.
 */
export function readPrivacyNoticeVersion(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = (env[PRIVACY_NOTICE_VERSION_VAR] ?? "").trim();
  if (!value) return null;
  if (value.length > MAX_PRIVACY_NOTICE_VERSION_LENGTH) return null;
  if (!NOTICE_VERSION_PATTERN.test(value)) return null;
  return value;
}

/** The process-wide server value. Never sent to the browser directly. */
export const privacyNoticeVersion = readPrivacyNoticeVersion();
