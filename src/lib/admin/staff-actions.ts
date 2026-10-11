"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdminRole } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { AdminAuthorisationError } from "@/lib/auth/roles";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  changeStaffRole,
  inviteStaff,
  setStaffDisabled,
} from "./staff-service";
import {
  isAssignableRole,
  staffErrorMessage,
  validateInvitationInput,
  validateReason,
  type AssignableRole,
  type StaffErrorCode,
} from "./staff";

/**
 * Privileged staff-management server actions.
 *
 * Every action repeats the full control chain rather than trusting the caller:
 *
 *   1. verified session + `admin_profiles` role (`requireAdminRole([full_admin])`);
 *   2. registry capability check (`staff.manage`);
 *   3. origin verification for this cookie-authenticated write;
 *   4. per-actor rate limit;
 *   5. input validation and the pure invariant planner;
 *   6. the trusted database function (which re-validates the actor and writes the
 *      change and its audit event in one transaction).
 *
 * Server Actions already reject cross-origin submissions through Next.js's own
 * Origin/Host comparison; step 3 makes that contract explicit and also covers any
 * future route-handler caller. It compares the request's own host values rather
 * than a hard-coded domain, so preview deployments keep working.
 *
 * No action accepts an actor id: the acting administrator is always resolved from
 * the session inside the action.
 */

export type StaffActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; code: StaffErrorCode; message: string };

function failure(code: StaffErrorCode): { ok: false; code: StaffErrorCode; message: string } {
  return { ok: false, code, message: staffErrorMessage(code) };
}

type GuardedActor = {
  userId: string;
  email: string;
  role: string;
};

/**
 * Resolves and authorises the acting Full Admin, then applies the origin and rate
 * limit checks. Returns a failure result rather than throwing, so the calling
 * client component can render one consistent message.
 */
async function guard(
  limitKey: "invite" | "change",
): Promise<
  | { ok: true; actor: GuardedActor }
  | { ok: false; code: StaffErrorCode; message: string }
> {
  let actor: GuardedActor;
  try {
    const identity = await requireAdminRole(["full_admin"]);
    actor = { userId: identity.userId, email: identity.email, role: identity.role };
  } catch (error) {
    if (error instanceof AdminAuthorisationError)
      return failure(
        error.code === "not_configured" ? "not_configured" : "permission_denied",
      );
    return failure("permission_denied");
  }

  // The permission registry is the second, independent check: a future role
  // change that keeps "full_admin" but drops `staff.manage` closes this module.
  if (!hasPermission(actor.role, "staff.manage")) return failure("permission_denied");

  const requestHeaders = await headers();
  const origin = checkRequestOrigin({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });
  if (!origin.ok) return failure("permission_denied");

  // Counting against the acting account means one compromised session cannot
  // exhaust the limit for everyone else.
  const withinLimit = consumeRateLimit(limitKey, actor.userId);
  if (!withinLimit.ok) return failure("rate_limited");

  return { ok: true, actor };
}

/**
 * Invites an administrator. Requires Full Admin; the invite is sent through the
 * server-only Supabase Admin client, so the browser never holds a privileged key.
 */
export async function inviteAdministrator(input: {
  email: string;
  role: string;
}): Promise<StaffActionResult<{ email: string; role: AssignableRole }>> {
  const guardResult = await guard("invite");
  if (!guardResult.ok) return guardResult;

  const validated = validateInvitationInput(input);
  if (!validated.ok) return failure(validated.code);

  const { email, role } = validated.value;
  if (email === guardResult.actor.email.trim().toLowerCase())
    return failure("self_action");

  const requestHeaders = await headers();
  const callbackOrigin = resolveCallbackOrigin({
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    protocol: requestHeaders.get("x-forwarded-proto"),
    siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });
  if (!callbackOrigin) return failure("not_configured");

  const result = await inviteStaff({
    actor: {
      userId: guardResult.actor.userId,
      email: guardResult.actor.email,
      role: "full_admin",
      displayName: "",
    },
    email,
    role,
    callbackUrl: `${callbackOrigin}/admin/auth/callback`,
    correlationId: crypto.randomUUID(),
  });

  if (!result.ok) return failure(result.code);

  revalidatePath("/admin/staff");
  return {
    ok: true,
    message: `Invitation sent to ${result.data.email} as ${
      result.data.role === "full_admin" ? "Full Admin" : "Operational Admin"
    }. Access starts only after they accept it.`,
    data: { email: result.data.email, role: result.data.role },
  };
}

/**
 * Changes an existing administrator's role.
 *
 * `confirmed` carries the operator's acknowledgement of the elevation/confirmation
 * dialog. Reason is mandatory for any change that crosses the Full Admin boundary,
 * so every privilege change is justified in the audit log.
 */
export async function changeAdministratorRole(input: {
  userId: string;
  role: string;
  expectedUpdatedAt: string | null;
  reason?: string;
  confirmed?: boolean;
}): Promise<StaffActionResult> {
  const guardResult = await guard("change");
  if (!guardResult.ok) return guardResult;

  if (typeof input.userId !== "string" || input.userId.length === 0)
    return failure("invalid_request");
  if (!isAssignableRole(input.role)) return failure("invalid_role");

  // Self-service changes are refused here as well as in the database, so the
  // operator gets an immediate, specific message.
  if (input.userId === guardResult.actor.userId) return failure("self_action");

  // Every role change must be justified. The current role is only known once the
  // database function locks the row, so the server requires a reason for all of
  // them rather than guessing which ones cross the Full Admin boundary; the
  // dialog enforces the same rule and `planRoleChange` gives the operator
  // pre-flight feedback in the interface.
  const reason = validateReason(input.reason);
  if (!reason.ok) return failure(reason.code);
  if (!reason.value) return failure("reason_required");

  // Explicit confirmation for privilege elevation. `role_unchanged`,
  // `last_full_admin` and `conflict` are detected in the transaction and mapped
  // back to the same messages.
  if (input.role === "full_admin" && input.confirmed !== true)
    return failure("invalid_request");

  const result = await changeStaffRole({
    actor: {
      userId: guardResult.actor.userId,
      email: guardResult.actor.email,
      role: "full_admin",
      displayName: "",
    },
    targetUserId: input.userId,
    role: input.role,
    expectedUpdatedAt: input.expectedUpdatedAt,
    reason: reason.value,
    correlationId: crypto.randomUUID(),
  });

  if (!result.ok) return failure(result.code);

  revalidatePath("/admin/staff");
  return {
    ok: true,
    message: `Role updated to ${
      result.data.role === "full_admin" ? "Full Admin" : "Operational Admin"
    }. The change applies to their next verified request.`,
  };
}

/** Disables or restores an administrator account. */
export async function setAdministratorStatus(input: {
  userId: string;
  disabled: boolean;
  expectedUpdatedAt: string | null;
  reason?: string;
  confirmed?: boolean;
}): Promise<StaffActionResult> {
  const guardResult = await guard("change");
  if (!guardResult.ok) return guardResult;

  if (typeof input.userId !== "string" || input.userId.length === 0)
    return failure("invalid_request");
  if (typeof input.disabled !== "boolean") return failure("invalid_request");

  if (input.userId === guardResult.actor.userId) return failure("self_action");

  const reason = validateReason(input.reason);
  if (!reason.ok) return failure(reason.code);
  if (!reason.value) return failure("reason_required");

  // Suspension and restoration both require the operator's explicit confirmation
  // (the dialog's acknowledgement), so a stray request cannot revoke access.
  if (input.confirmed !== true) return failure("invalid_request");

  const result = await setStaffDisabled({
    actor: {
      userId: guardResult.actor.userId,
      email: guardResult.actor.email,
      role: "full_admin",
      displayName: "",
    },
    targetUserId: input.userId,
    disabled: input.disabled,
    expectedUpdatedAt: input.expectedUpdatedAt,
    reason: reason.value,
    correlationId: crypto.randomUUID(),
  });

  if (!result.ok) return failure(result.code);

  revalidatePath("/admin/staff");
  return {
    ok: true,
    message: input.disabled
      ? "Account disabled. Their next verified request will be rejected."
      : "Account restored with its existing role.",
  };
}

/**
 * Origin used for the invitation link. Recentred on the same trusted-origin rules
 * as password recovery: loopback for local development, otherwise `SITE_URL`, so
 * an invitation link can never be delivered to an attacker-controlled host.
 */
function resolveCallbackOrigin(input: {
  host?: string | null;
  protocol?: string | null;
  siteUrl?: string | null;
}): string | null {
  const configured = normaliseOrigin(input.siteUrl);
  if (configured) return configured;

  const host = (input.host ?? "").trim().toLowerCase();
  if (!host || /[\s/\\]/.test(host)) return null;
  const [hostname] = host.split(":");
  if (hostname !== "localhost" && hostname !== "127.0.0.1") return null;
  const protocol = (input.protocol ?? "").trim().toLowerCase() || "http";
  return protocol === "http" ? `http://${host}` : null;
}

function normaliseOrigin(value?: string | null): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && url.hostname === "localhost") return url.origin;
    return null;
  } catch {
    return null;
  }
}
