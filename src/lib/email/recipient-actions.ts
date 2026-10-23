"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { AdminAuthorisationError } from "@/lib/auth/roles";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  addBookingAlertRecipient,
  removeBookingAlertRecipient,
  updateBookingAlertRecipient,
} from "./recipients";
import {
  bookingAlertRecipientErrorMessage,
  isBookingAlertRecipientId,
  isBookingAlertRecipientVersion,
  validateBookingAlertRecipientEmail,
  type BookingAlertRecipientErrorCode,
} from "./recipient-rules";

/**
 * Privileged order-alert recipient actions (Phase 2E.2).
 *
 * Every action repeats the full control chain instead of trusting the browser:
 *
 *   1. verified session + `admin_profiles` role (`requireAdmin`);
 *   2. registry capability check (`settings.manage`, Full Admin only);
 *   3. origin verification for this cookie-authenticated write;
 *   4. per-actor rate limit;
 *   5. email/identity validation with the shared pure rules;
 *   6. the server-only elevated repository.
 *
 * No action accepts an actor id or an address list. Addresses are normalised and
 * validated here, and the database independently rejects duplicates, malformed
 * addresses and a fan-out above the configured cap. The browser holds no key and
 * the recipient table has no client policy.
 */

export type BookingAlertRecipientActionResult =
  | { ok: true; message: string }
  | { ok: false; code: BookingAlertRecipientErrorCode; message: string };

function failure(
  code: BookingAlertRecipientErrorCode,
): Extract<BookingAlertRecipientActionResult, { ok: false }> {
  return { ok: false, code, message: bookingAlertRecipientErrorMessage(code) };
}

type GuardResult =
  | { ok: true; userId: string }
  | Extract<BookingAlertRecipientActionResult, { ok: false }>;

async function guard(): Promise<GuardResult> {
  let actor;
  try {
    actor = await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAuthorisationError)
      return failure(
        error.code === "not_configured" ? "not_configured" : "permission_denied",
      );
    return failure("permission_denied");
  }

  // Independent second check: the settings surface and this capability are both
  // Full Admin only, so an Operational Admin never reaches the repository.
  if (!hasPermission(actor.role, "settings.manage"))
    return failure("permission_denied");

  const requestHeaders = await headers();
  const origin = checkRequestOrigin({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });
  if (!origin.ok) return failure("permission_denied");

  const withinLimit = consumeRateLimit("alert_recipients", actor.userId);
  if (!withinLimit.ok) return failure("rate_limited");

  return { ok: true, userId: actor.userId };
}

function revalidateSettings() {
  revalidatePath("/admin/settings");
}

/** Adds one address to the central list. */
export async function addBookingAlertRecipientAction(input: {
  email: string;
}): Promise<BookingAlertRecipientActionResult> {
  const guardResult = await guard();
  if (!guardResult.ok) return guardResult;

  const validated = validateBookingAlertRecipientEmail(input?.email);
  if (!validated.ok) return failure(validated.code);

  const result = await addBookingAlertRecipient(validated.email);
  if (!result.ok) return failure(result.code);

  revalidateSettings();
  return {
    ok: true,
    message: `${validated.email} will receive future staff order alerts.`,
  };
}

/** Corrects an existing address, preserving its position on the list. */
export async function updateBookingAlertRecipientAction(input: {
  id: string;
  email: string;
  expectedVersion: number;
}): Promise<BookingAlertRecipientActionResult> {
  const guardResult = await guard();
  if (!guardResult.ok) return guardResult;

  if (
    !isBookingAlertRecipientId(input?.id) ||
    !isBookingAlertRecipientVersion(input?.expectedVersion)
  )
    return failure("invalid_request");

  const validated = validateBookingAlertRecipientEmail(input?.email);
  if (!validated.ok) return failure(validated.code);

  const result = await updateBookingAlertRecipient({
    id: input.id,
    email: validated.email,
    expectedVersion: input.expectedVersion,
  });
  if (!result.ok) return failure(result.code);

  revalidateSettings();
  return {
    ok: true,
    message: `${validated.email} will receive future staff order alerts.`,
  };
}

/** Removes an address. It receives nothing queued after this change. */
export async function removeBookingAlertRecipientAction(input: {
  id: string;
}): Promise<BookingAlertRecipientActionResult> {
  const guardResult = await guard();
  if (!guardResult.ok) return guardResult;

  if (!isBookingAlertRecipientId(input?.id)) return failure("invalid_request");

  const result = await removeBookingAlertRecipient(input.id);
  if (!result.ok) return failure(result.code);

  revalidateSettings();
  return {
    ok: true,
    message: "Recipient removed. It will not receive future order alerts.",
  };
}
