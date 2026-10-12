/**
 * Server-only booking repository.
 *
 * This is the single place allowed to call the trusted booking functions. It is
 * scaffolding for Sprint 2B (public submission) and Sprint 2C (administrative
 * booking management); no route or component imports it yet, and the existing
 * demonstration booking flow is untouched.
 *
 * Responsibility split:
 * - authorisation is decided here, from the caller's verified administrator
 *   identity and the central permission registry (`bookings.manage`);
 * - the database re-validates the acting administrator, the allowed transition,
 *   the confirmation prerequisites and the version inside each function;
 * - the elevated secret key is created per operation and never leaves the server;
 * - raw database errors are mapped to the `BookingErrorCode` taxonomy and never
 *   forwarded to a caller.
 *
 * Never import this module from a Client Component.
 */

import {
  createSupabaseAdminClient,
  SupabaseElevatedConfigError,
} from "@/lib/supabase/admin";
import type { AdminIdentity } from "@/lib/auth/roles";
import { hasPermission } from "@/lib/auth/permissions";
import { mapBookingDatabaseError, type BookingErrorCode } from "./errors";
import type {
  BookingArrangement,
  BookingMutationResult,
  BookingStatus,
  BookingSubmitPayload,
  BookingSubmitResult,
  BookingTransitionInput,
} from "./types";

export type RepositoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: BookingErrorCode };

const fail = (code: BookingErrorCode): { ok: false; code: BookingErrorCode } => ({
  ok: false,
  code,
});

/** True when the acting administrator may manage bookings (both roles may). */
export function canManageBookings(identity: AdminIdentity | null): boolean {
  return hasPermission(identity?.role, "bookings.manage");
}

/**
 * Calls one trusted booking function through the server-only elevated client.
 * Returns a stable code on failure rather than the raw message.
 */
async function callBookingRpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<RepositoryResult<T>> {
  if (typeof window !== "undefined")
    throw new Error("The booking repository is server-only.");

  let client;
  try {
    client = createSupabaseAdminClient();
  } catch (error) {
    return fail(
      error instanceof SupabaseElevatedConfigError ? "not_configured" : "conflict",
    );
  }

  const { data, error } = await client.rpc(fn, args);
  if (error) return fail(mapBookingDatabaseError(error.message));
  return { ok: true, data: data as T };
}

const asStatus = (value: unknown): BookingStatus => value as BookingStatus;

/* -------------------------------------------------------------------------- */
/* Public submission (Sprint 2B)                                               */
/* -------------------------------------------------------------------------- */

export type PublicBookingSubmission = {
  payload: BookingSubmitPayload;
  services: string[];
  idempotencyKey: string;
  correlationId: string;
  submissionScope?: string;
};

/**
 * Creates a pending booking from an already validated submission. Callable from
 * the trusted server path only, after `validatePublicBookingRequest` has passed.
 */
export async function submitPublicBooking(
  input: PublicBookingSubmission,
): Promise<RepositoryResult<BookingSubmitResult>> {
  const result = await callBookingRpc<{
    booking_id: string;
    reference: string;
    status: string;
    version: number;
    replayed: boolean;
  }>("booking_submit", {
    p_payload: input.payload,
    p_services: input.services,
    p_idempotency_key: input.idempotencyKey,
    p_submission_scope: input.submissionScope ?? "public_booking_form",
    p_correlation: input.correlationId,
  });

  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      bookingId: result.data.booking_id,
      reference: result.data.reference,
      status: asStatus(result.data.status),
      version: result.data.version,
      replayed: result.data.replayed,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Administrative mutations (Sprint 2C)                                        */
/* -------------------------------------------------------------------------- */

export async function transitionBooking(input: {
  actor: AdminIdentity;
  transition: BookingTransitionInput;
  correlationId: string;
}): Promise<RepositoryResult<BookingMutationResult>> {
  if (!canManageBookings(input.actor)) return fail("permission_denied");

  const result = await callBookingRpc<{
    booking_id: string;
    reference: string;
    status: string;
    previous_status: string;
    version: number;
  }>("booking_transition", {
    p_actor: input.actor.userId,
    p_booking: input.transition.bookingId,
    p_expected_version: input.transition.expectedVersion,
    p_next: input.transition.next,
    p_reason: input.transition.reason ?? null,
    p_correlation: input.correlationId,
  });

  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      bookingId: result.data.booking_id,
      reference: result.data.reference,
      status: asStatus(result.data.status),
      previousStatus: asStatus(result.data.previous_status),
      version: result.data.version,
    },
  };
}

export async function updateBookingArrangement(input: {
  actor: AdminIdentity;
  bookingId: string;
  expectedVersion: number;
  arrangement: BookingArrangement;
  correlationId: string;
}): Promise<RepositoryResult<BookingMutationResult>> {
  if (!canManageBookings(input.actor)) return fail("permission_denied");

  const result = await callBookingRpc<{
    booking_id: string;
    reference: string;
    status: string;
    version: number;
  }>("booking_update_arrangement", {
    p_actor: input.actor.userId,
    p_booking: input.bookingId,
    p_expected_version: input.expectedVersion,
    p_branch: input.arrangement.branchId,
    p_agreed_pickup_at: input.arrangement.agreedPickupAt,
    p_agreed_fee: input.arrangement.agreedFee,
    p_zero_fee_reason: input.arrangement.zeroFeeReason,
    p_service_charge: input.arrangement.serviceCharge,
    p_contact_outcome: input.arrangement.contactOutcome,
    p_confirmation_note: input.arrangement.confirmationNote,
    p_return_details: input.arrangement.returnDetails,
    p_correlation: input.correlationId,
  });

  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      bookingId: result.data.booking_id,
      reference: result.data.reference,
      status: asStatus(result.data.status),
      version: result.data.version,
    },
  };
}

export async function addBookingNote(input: {
  actor: AdminIdentity;
  bookingId: string;
  expectedVersion: number;
  body: string;
  correlationId: string;
}): Promise<RepositoryResult<BookingMutationResult>> {
  if (!canManageBookings(input.actor)) return fail("permission_denied");

  const result = await callBookingRpc<{
    booking_id: string;
    reference: string;
    status: string;
    version: number;
  }>("booking_add_note", {
    p_actor: input.actor.userId,
    p_booking: input.bookingId,
    p_expected_version: input.expectedVersion,
    p_body: input.body,
    p_correlation: input.correlationId,
  });

  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      bookingId: result.data.booking_id,
      reference: result.data.reference,
      status: asStatus(result.data.status),
      version: result.data.version,
    },
  };
}
