"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { AdminAuthorisationError, type AdminIdentity } from "@/lib/auth/roles";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  addBookingNote,
  transitionBooking,
  updateBookingArrangement,
} from "./repository";
import { bookingErrorMessage, type BookingErrorCode } from "./errors";
import {
  cancellationError,
  transitionRequiresReason,
  validateArrangement,
} from "./lifecycle";
import { BOOKING_LIMITS, type BookingStatus } from "./types";
import { agreedPickupAtWindowError, isBookingStatus, isUuid } from "./admin";

/**
 * Privileged administrative booking actions (Sprint 2C).
 *
 * Every action repeats the full control chain instead of trusting the caller:
 *
 *   1. verified session + `admin_profiles` role (`requireAdmin`);
 *   2. registry capability check (`bookings.manage` — both administrator roles);
 *   3. origin verification for this cookie-authenticated write;
 *   4. per-actor rate limit;
 *   5. shape validation and the pure lifecycle/window invariants;
 *   6. the trusted database function through the server-only elevated client,
 *      which re-validates the actor, the allowed transition, the confirmation
 *      prerequisites, the pickup window and the optimistic version inside one
 *      transaction (status change + history + audit).
 *
 * No action accepts an actor id: the acting administrator is always resolved from
 * the verified session. A browser that calls an action directly still passes steps
 * 1–4, so it cannot bypass authorisation, the confirmation prerequisites, the
 * pickup window or the required cancellation reason.
 */

export type BookingActionResult =
  | { ok: true; message: string; version: number }
  | {
      ok: false;
      code: BookingErrorCode;
      message: string;
      fieldErrors?: Record<string, string>;
    };

function failure(
  code: BookingErrorCode,
  fieldErrors?: Record<string, string>,
): Extract<BookingActionResult, { ok: false }> {
  return {
    ok: false,
    code,
    message: bookingErrorMessage(code),
    ...(fieldErrors && Object.keys(fieldErrors).length ? { fieldErrors } : {}),
  };
}

/** Resolves and authorises the acting administrator, then applies origin + limit. */
async function guard(): Promise<
  { ok: true; actor: AdminIdentity } | Extract<BookingActionResult, { ok: false }>
> {
  let actor: AdminIdentity;
  try {
    actor = await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAuthorisationError)
      return failure(
        error.code === "not_configured"
          ? "not_configured"
          : error.code === "forbidden"
            ? "permission_denied"
            : "actor_required",
      );
    return failure("permission_denied");
  }

  // The registry is an independent second check: a future role change that keeps
  // an admin role but drops `bookings.manage` closes this module.
  if (!hasPermission(actor.role, "bookings.manage"))
    return failure("permission_denied");

  const requestHeaders = await headers();
  const origin = checkRequestOrigin({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });
  if (!origin.ok) return failure("permission_denied");

  const withinLimit = consumeRateLimit("booking_mutation", actor.userId);
  if (!withinLimit.ok) return failure("rate_limited");

  return { ok: true, actor };
}

function isExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function revalidateBooking(bookingId: string) {
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${bookingId}`);
}

/**
 * Records the agreed operational arrangement: assigned branch, agreed pickup date
 * and time, agreed fee (with its zero-fee reason), service charge and the contact
 * outcome / confirmation note. Confirmation itself is a separate transition.
 */
export async function saveBookingArrangement(input: {
  bookingId: string;
  expectedVersion: number;
  branchId: string | null;
  agreedPickupAt: string | null;
  agreedFee: number | string | null;
  zeroFeeReason: string | null;
  serviceCharge?: number | string | null;
  contactOutcome: string | null;
  confirmationNote: string | null;
  returnDetails: string | null;
}): Promise<BookingActionResult> {
  const guardResult = await guard();
  if (!guardResult.ok) return guardResult;

  if (!isUuid(input.bookingId) || !isExpectedVersion(input.expectedVersion))
    return failure("invalid_request");

  const validated = validateArrangement({
    branchId: input.branchId,
    agreedPickupAt: input.agreedPickupAt,
    agreedFee: input.agreedFee,
    zeroFeeReason: input.zeroFeeReason,
    serviceCharge: input.serviceCharge ?? null,
    contactOutcome: input.contactOutcome,
    confirmationNote: input.confirmationNote,
    returnDetails: input.returnDetails,
  });
  if (!validated.ok) return failure(validated.code, validated.fieldErrors);

  const arrangement = validated.value;

  // The database applies the authoritative pickup window. Mirroring it here gives
  // a clear, field-level message without introducing an administrator bypass.
  if (arrangement.branchId && arrangement.agreedPickupAt) {
    const windowError = agreedPickupAtWindowError(arrangement.agreedPickupAt);
    if (windowError)
      return failure(windowError.code, { agreedPickupAt: windowError.message });
  }

  const result = await updateBookingArrangement({
    actor: guardResult.actor,
    bookingId: input.bookingId,
    expectedVersion: input.expectedVersion,
    arrangement,
    correlationId: crypto.randomUUID(),
  });
  if (!result.ok) return failure(result.code);

  revalidateBooking(input.bookingId);
  return { ok: true, version: result.data.version, message: "Agreed arrangements saved." };
}

/**
 * Advances the booking through one permitted lifecycle transition.
 *
 * The allowed transitions are enforced by the database; only a cancellation
 * requires (and is validated for) a reason here so the operator gets a precise
 * message before the round trip.
 */
export async function changeBookingStatus(input: {
  bookingId: string;
  expectedVersion: number;
  next: string;
  reason?: string | null;
}): Promise<BookingActionResult> {
  const guardResult = await guard();
  if (!guardResult.ok) return guardResult;

  if (!isUuid(input.bookingId) || !isExpectedVersion(input.expectedVersion))
    return failure("invalid_request");
  if (!isBookingStatus(input.next)) return failure("invalid_transition");

  const next: BookingStatus = input.next;
  const reason =
    typeof input.reason === "string" ? input.reason.trim().slice(0, BOOKING_LIMITS.reason.max) : "";

  if (transitionRequiresReason(next)) {
    const cancellation = cancellationError(reason);
    if (cancellation) return failure("cancellation_reason", { reason: cancellation });
  }

  const result = await transitionBooking({
    actor: guardResult.actor,
    transition: {
      bookingId: input.bookingId,
      expectedVersion: input.expectedVersion,
      next,
      reason: reason || null,
    },
    correlationId: crypto.randomUUID(),
  });
  if (!result.ok) return failure(result.code);

  revalidateBooking(input.bookingId);
  return {
    ok: true,
    version: result.data.version,
    message:
      next === "cancelled"
        ? "Booking cancelled."
        : `Status updated to ${next.replaceAll("_", " ")}.`,
  };
}

/** Appends a private administrative note. The note body is never audited. */
export async function addBookingNoteAction(input: {
  bookingId: string;
  expectedVersion: number;
  body: string;
}): Promise<BookingActionResult> {
  const guardResult = await guard();
  if (!guardResult.ok) return guardResult;

  if (!isUuid(input.bookingId) || !isExpectedVersion(input.expectedVersion))
    return failure("invalid_request");

  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length < BOOKING_LIMITS.note.min || body.length > BOOKING_LIMITS.note.max)
    return failure("invalid_note", {
      body: bookingErrorMessage("invalid_note"),
    });

  const result = await addBookingNote({
    actor: guardResult.actor,
    bookingId: input.bookingId,
    expectedVersion: input.expectedVersion,
    body,
    correlationId: crypto.randomUUID(),
  });
  if (!result.ok) return failure(result.code);

  revalidateBooking(input.bookingId);
  return { ok: true, version: result.data.version, message: "Note added." };
}
