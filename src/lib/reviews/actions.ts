"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { hasPermission, type Permission } from "@/lib/auth/permissions";
import { AdminAuthorisationError, type AdminIdentity } from "@/lib/auth/roles";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { isReviewId } from "./admin";
import { reviewErrorMessage, type ReviewErrorCode } from "./errors";
import {
  validateModerationInput,
  validateOverrideInput,
  validatePublicationInput,
  validateReopenInput,
  validateReplyInput,
} from "./moderation";
import {
  draftReply,
  moderateReview,
  overrideReview,
  publishReply,
  publishReview,
  reopenReview,
} from "./admin-service";

/**
 * Privileged administrative review actions (Sprint 3B).
 *
 * Every action repeats the full control chain instead of trusting the caller:
 *
 *   1. verified session + `admin_profiles` role (`requireAdmin`);
 *   2. registry capability check (`reviews.moderate`, or `reviews.override` for
 *      re-open and emergency overrides — a Full Admin capability);
 *   3. origin verification for this cookie-authenticated write;
 *   4. per-actor rate limit;
 *   5. shape validation (mandatory reject note / override reason, body bounds);
 *   6. the trusted database function through the server-only elevated client,
 *      which re-validates the actor, the allowed transition, the mandatory reason
 *      and the optimistic version inside one transaction (change + audit).
 *
 * No action accepts an actor id: the acting administrator is always resolved from
 * the verified session, and the database independently re-checks the role.
 */

export type ReviewActionResult =
  | { ok: true; message: string; version: number }
  | {
      ok: false;
      code: ReviewErrorCode;
      message: string;
      fieldErrors?: Record<string, string>;
    };

type ReviewOperation = "moderate" | "publish" | "reply" | "reopen" | "override";

function failure(
  code: ReviewErrorCode,
  fieldErrors?: Record<string, string>,
): Extract<ReviewActionResult, { ok: false }> {
  return {
    ok: false,
    code,
    message: reviewErrorMessage(code),
    ...(fieldErrors && Object.keys(fieldErrors).length ? { fieldErrors } : {}),
  };
}

function permissionFor(operation: ReviewOperation): Permission {
  switch (operation) {
    case "reopen":
    case "override":
      return "reviews.override";
    case "reply":
      return "reviews.reply";
    default:
      return "reviews.moderate";
  }
}

/** Resolves and authorises the acting administrator, then applies origin + limit. */
async function guard(
  operation: ReviewOperation,
): Promise<{ ok: true; actor: AdminIdentity } | Extract<ReviewActionResult, { ok: false }>> {
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

  if (!hasPermission(actor.role, permissionFor(operation)))
    return failure("permission_denied");

  const requestHeaders = await headers();
  const origin = checkRequestOrigin({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });
  if (!origin.ok) return failure("origin_rejected");

  const withinLimit = consumeRateLimit("review_mutation", actor.userId);
  if (!withinLimit.ok) return failure("rate_limited");

  return { ok: true, actor };
}

function isExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function revalidateReview(reviewId: string) {
  revalidatePath("/admin/reviews");
  revalidatePath(`/admin/reviews/${reviewId}`);
  revalidatePath("/admin");
}

/** Approves or rejects a pending review; a rejection requires a recorded reason. */
export async function moderateReviewAction(input: {
  reviewId: string;
  decision: unknown;
  note?: string | null;
  expectedVersion: number;
}): Promise<ReviewActionResult> {
  const guardResult = await guard("moderate");
  if (!guardResult.ok) return guardResult;

  if (!isReviewId(input.reviewId) || !isExpectedVersion(input.expectedVersion))
    return failure("invalid_payload");

  const validated = validateModerationInput({
    decision: input.decision,
    note: input.note,
  });
  if (!validated.ok) return failure(validated.code, validated.fieldErrors);

  const result = await moderateReview({
    actor: guardResult.actor,
    reviewId: input.reviewId,
    decision: validated.value.decision,
    note: validated.value.note,
    expectedVersion: input.expectedVersion,
    correlationId: crypto.randomUUID(),
  });
  if (!result.ok) return failure(result.code);

  revalidateReview(input.reviewId);
  return {
    ok: true,
    version: result.data.version,
    message:
      validated.value.decision === "approved"
        ? "Review approved."
        : "Review rejected.",
  };
}

/**
 * Publishes, unpublishes or edits the public version of an approved review.
 * `body_original` is never accepted here: only the public text changes.
 */
export async function publishReviewAction(input: {
  reviewId: string;
  action: unknown;
  body?: string | null;
  expectedVersion: number;
}): Promise<ReviewActionResult> {
  const guardResult = await guard("publish");
  if (!guardResult.ok) return guardResult;

  if (!isReviewId(input.reviewId) || !isExpectedVersion(input.expectedVersion))
    return failure("invalid_payload");

  const validated = validatePublicationInput({
    action: input.action,
    body: input.body,
  });
  if (!validated.ok) return failure(validated.code, validated.fieldErrors);

  const result = await publishReview({
    actor: guardResult.actor,
    reviewId: input.reviewId,
    action: validated.value.action,
    body: validated.value.body,
    expectedVersion: input.expectedVersion,
    correlationId: crypto.randomUUID(),
  });
  if (!result.ok) return failure(result.code);

  revalidateReview(input.reviewId);
  return {
    ok: true,
    version: result.data.version,
    message:
      validated.value.action === "publish"
        ? "Review published."
        : validated.value.action === "unpublish"
          ? "Review unpublished."
          : "Public version updated.",
  };
}

/** Re-opens a rejected review for moderation. Full Admin only, reason required. */
export async function reopenReviewAction(input: {
  reviewId: string;
  reason: string;
  expectedVersion: number;
}): Promise<ReviewActionResult> {
  const guardResult = await guard("reopen");
  if (!guardResult.ok) return guardResult;

  if (!isReviewId(input.reviewId) || !isExpectedVersion(input.expectedVersion))
    return failure("invalid_payload");

  const validated = validateReopenInput({ reason: input.reason });
  if (!validated.ok) return failure(validated.code, validated.fieldErrors);

  const result = await reopenReview({
    actor: guardResult.actor,
    reviewId: input.reviewId,
    reason: validated.value.reason,
    expectedVersion: input.expectedVersion,
    correlationId: crypto.randomUUID(),
  });
  if (!result.ok) return failure(result.code);

  revalidateReview(input.reviewId);
  return {
    ok: true,
    version: result.data.version,
    message: "Review re-opened for moderation.",
  };
}

/**
 * Saves a reply draft. Shared by both administrator roles (`reviews.reply`).
 * Replacing a published reply retains the prior text in the append-only
 * revision table; the audit event records the transition, not the text.
 */
export async function draftReplyAction(input: {
  reviewId: string;
  body: string;
  expectedVersion: number;
}): Promise<ReviewActionResult> {
  const guardResult = await guard("reply");
  if (!guardResult.ok) return guardResult;

  if (!isReviewId(input.reviewId) || !isExpectedVersion(input.expectedVersion))
    return failure("invalid_payload");

  const validated = validateReplyInput({ body: input.body });
  if (!validated.ok) return failure(validated.code, validated.fieldErrors);

  const result = await draftReply({
    actor: guardResult.actor,
    reviewId: input.reviewId,
    body: validated.value.body,
    expectedVersion: input.expectedVersion,
    correlationId: crypto.randomUUID(),
  });
  if (!result.ok) return failure(result.code);

  revalidateReview(input.reviewId);
  return {
    ok: true,
    version: result.data.version,
    message: "Reply draft saved.",
  };
}

/** Publishes the saved reply draft under an approved, published review. */
export async function publishReplyAction(input: {
  reviewId: string;
  expectedVersion: number;
}): Promise<ReviewActionResult> {
  const guardResult = await guard("reply");
  if (!guardResult.ok) return guardResult;

  if (!isReviewId(input.reviewId) || !isExpectedVersion(input.expectedVersion))
    return failure("invalid_payload");

  const result = await publishReply({
    actor: guardResult.actor,
    reviewId: input.reviewId,
    expectedVersion: input.expectedVersion,
    correlationId: crypto.randomUUID(),
  });
  if (!result.ok) return failure(result.code);

  revalidateReview(input.reviewId);
  return {
    ok: true,
    version: result.data.version,
    message: "Reply published.",
  };
}

/**
 * Emergency override of a decided review or its publication. Deliberately
 * separate from the ordinary actions: Full Admin only, mandatory reason, and a
 * distinct audit action (`review.override_*`) in the database.
 */
export async function overrideReviewAction(input: {
  reviewId: string;
  operation: unknown;
  reason: string;
  body?: string | null;
  expectedVersion: number;
}): Promise<ReviewActionResult> {
  const guardResult = await guard("override");
  if (!guardResult.ok) return guardResult;

  if (!isReviewId(input.reviewId) || !isExpectedVersion(input.expectedVersion))
    return failure("invalid_payload");

  const validated = validateOverrideInput({
    operation: input.operation,
    reason: input.reason,
    body: input.body,
  });
  if (!validated.ok) return failure(validated.code, validated.fieldErrors);

  const result = await overrideReview({
    actor: guardResult.actor,
    reviewId: input.reviewId,
    operation: validated.value.operation,
    reason: validated.value.reason,
    body: validated.value.body,
    expectedVersion: input.expectedVersion,
    correlationId: crypto.randomUUID(),
  });
  if (!result.ok) return failure(result.code);

  revalidateReview(input.reviewId);
  return {
    ok: true,
    version: result.data.version,
    message: "Override applied and recorded in the review history.",
  };
}
