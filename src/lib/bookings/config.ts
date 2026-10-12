/**
 * Server-side configuration for public booking submissions.
 *
 * Public submission is off unless an operator deliberately switches it on, so a
 * deployment cannot expose the privileged submission path by accident. Enabling
 * it is only one prerequisite: the endpoint still requires Supabase (URL plus the
 * server-only elevated key), a readable active catalogue and a shared rate
 * limiter, and it fails closed when any of those are missing.
 *
 * This value is server-only. It is never exposed to the browser, and the public
 * booking form decides between demo and production behaviour from
 * `NEXT_PUBLIC_DEMO_MODE`.
 */

export const BOOKING_SUBMISSIONS_ENABLED_VAR = "BOOKING_SUBMISSIONS_ENABLED";

export function readBookingSubmissionsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env[BOOKING_SUBMISSIONS_ENABLED_VAR] ?? "").trim().toLowerCase() === "true";
}

export const bookingSubmissionsEnabled = readBookingSubmissionsEnabled();
