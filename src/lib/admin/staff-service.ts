/**
 * Server-side staff administration.
 *
 * Split of responsibility:
 * - Reads (account list, invitations, audit history) use the caller's own session
 *   client, so row level security decides what is visible. Only a Full Admin has
 *   a policy that exposes other administrators or the audit log.
 * - Writes call the trusted `staff_*` database functions through the server-only
 *   elevated client. Those functions are the authorisation boundary: they
 *   re-validate the acting account, enforce the invariants under a lock, apply the
 *   change and write its audit event in one transaction.
 *
 * The actor id passed to a privileged function always comes from the verified
 * session resolved in this module's callers — never from the request body — and
 * the database independently re-checks that the actor is an active Full Admin.
 *
 * Nothing in this module returns a credential, a provider payload or raw SQL
 * text to the browser: failures are mapped to the `StaffErrorCode` taxonomy.
 */

import { createSupabaseAdminClient, SupabaseElevatedConfigError } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AdminIdentity } from "@/lib/auth/roles";
import { hasPermission } from "@/lib/auth/permissions";
import {
  mapStaffDatabaseError,
  type AssignableRole,
  type AuditEvent,
  type StaffAccount,
  type StaffErrorCode,
  type StaffInvitation,
} from "./staff";

export type StaffResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: StaffErrorCode };

const fail = (code: StaffErrorCode): { ok: false; code: StaffErrorCode } => ({
  ok: false,
  code,
});

/** The acting administrator may manage staff only with the staff.manage permission. */
export function canManageStaff(identity: AdminIdentity | null): boolean {
  return hasPermission(identity?.role, "staff.manage");
}

export type { StaffAccount, StaffInvitation };

const PROFILE_COLUMNS =
  "user_id, role, display_name, email, created_at, updated_at, disabled_at";
const INVITATION_COLUMNS =
  "id, email, role, status, created_at, sent_at, accepted_at, failure_reason";
const AUDIT_COLUMNS =
  "id, actor_id, action, entity_type, entity_id, before_state, after_state, reason, correlation_id, created_at";

/** Current administrator accounts. Does not query invitation history. */
export async function listStaffAccounts(): Promise<
  StaffResult<{ members: StaffAccount[]; activeFullAdmins: number }>
> {
  const supabase = await createSupabaseServerClient();
  const { data: profiles, error } = await supabase
    .from("admin_profiles")
    .select(PROFILE_COLUMNS)
    .order("created_at", { ascending: true });

  // A policy denial, a missing table or a transport error all fail closed.
  if (error) return fail("permission_denied");

  const members: StaffAccount[] = (
    (profiles ?? []) as Array<{
      user_id: string;
      role: string;
      display_name: string | null;
      email: string | null;
      created_at: string;
      updated_at: string;
      disabled_at: string | null;
    }>
  ).map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name ?? "",
    role: row.role,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return {
    ok: true,
    data: {
      members,
      activeFullAdmins: members.filter(
        (member) => member.role === "full_admin" && !member.disabledAt,
      ).length,
    },
  };
}

/** Invitation history, queried only when the authorised disclosure is opened. */
export async function listStaffInvitations(): Promise<StaffResult<StaffInvitation[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("admin_invitations")
    .select(INVITATION_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return fail("permission_denied");

  const invitations: StaffInvitation[] = (
    (data ?? []) as Array<{
      id: string;
      email: string;
      role: string;
      status: string;
      created_at: string;
      sent_at: string | null;
      accepted_at: string | null;
      failure_reason: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
    failureReason: row.failure_reason,
  }));

  return { ok: true, data: invitations };
}

/** Recent audit history, newest first. Full Admins only (enforced by policy). */
export async function listAuditEvents(
  limit = 50,
): Promise<StaffResult<AuditEvent[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("audit_events")
    .select(AUDIT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) return fail("permission_denied");
  return { ok: true, data: (data ?? []) as AuditEvent[] };
}

// ---------------------------------------------------------------------------
// Privileged operations
// ---------------------------------------------------------------------------

/**
 * Calls one trusted database function. Never surfaces the raw error text.
 *
 * The elevated client is created per operation and is confined to this module: no
 * other code path can reach the privileged functions, and the key never leaves the
 * server.
 */
async function callStaffRpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<StaffResult<T>> {
  let client;
  try {
    client = createSupabaseAdminClient();
  } catch (error) {
    return fail(
      error instanceof SupabaseElevatedConfigError ? "not_configured" : "conflict",
    );
  }

  const { data, error } = await client.rpc(fn, args);
  if (error) return fail(mapStaffDatabaseError(error.message));
  return { ok: true, data: data as T };
}

export type InvitationOutcome = {
  invitationId: string;
  email: string;
  role: AssignableRole;
  status: "sent";
};

/**
 * Invites an administrator.
 *
 * Supabase Auth and the application database cannot be written in one
 * transaction, so the workflow is explicitly staged and reconciled:
 *
 *   1. record a `pending` invitation (+ audit) — grants nothing, no profile exists;
 *   2. ask Supabase Auth to send the invitation email;
 *   3. mark the invitation `sent` with the auth user id, or `failed` with a
 *      non-sensitive reason.
 *
 * A failure at step 2 is recorded as `failed` and reported as `invite_failed`, so
 * the interface never claims an email was sent when it was not. A failure at step
 * 3 (the email went out but the state could not be recorded) is reported as
 * `partial_failure`: the operator can retry, and the retry reconciles the same
 * invitation because the lifecycle is keyed on the email address.
 *
 * No profile is created here. The invitee becomes an administrator only when they
 * accept the invitation and `staff_complete_invitation` creates their profile from
 * the invited role.
 */
export async function inviteStaff(input: {
  actor: AdminIdentity;
  email: string;
  role: AssignableRole;
  redirectTo: string;
  correlationId: string;
}): Promise<StaffResult<InvitationOutcome>> {
  const created = await callStaffRpc<{
    invitation_id: string;
    email: string;
    role: AssignableRole;
    status: string;
  }>("staff_create_invitation", {
    p_actor: input.actor.userId,
    p_email: input.email,
    p_role: input.role,
    p_correlation: input.correlationId,
  });
  if (!created.ok) return created;

  const invitationId = created.data.invitation_id;

  let client;
  try {
    client = createSupabaseAdminClient();
  } catch (error) {
    // The invitation row exists but the email cannot be sent; record it honestly.
    await callStaffRpc("staff_mark_invitation", {
      p_actor: input.actor.userId,
      p_invitation: invitationId,
      p_status: "failed",
      p_auth_user_id: null,
      p_failure_reason: "Invitation email is not configured on this deployment.",
      p_correlation: input.correlationId,
    });
    return fail(
      error instanceof SupabaseElevatedConfigError ? "not_configured" : "conflict",
    );
  }

  const { data: invited, error: inviteError } = await client.auth.admin.inviteUserByEmail(
    input.email,
    { redirectTo: input.redirectTo },
  );

  if (inviteError || !invited?.user?.id) {
    // Do not expose raw provider text, but classify its duplicate-account case
    // so an administrator gets an actionable message instead of a silent failure.
    const providerText = `${inviteError?.code ?? ""} ${inviteError?.message ?? ""}`.toLowerCase();
    const alreadyRegistered =
      providerText.includes("email_exists") ||
      providerText.includes("already registered") ||
      providerText.includes("user already exists");
    await callStaffRpc("staff_mark_invitation", {
      p_actor: input.actor.userId,
      p_invitation: invitationId,
      p_status: "failed",
      p_auth_user_id: null,
      p_failure_reason: alreadyRegistered
        ? "An authentication account already exists for this address."
        : "The authentication provider rejected the invitation.",
      p_correlation: input.correlationId,
    });
    return fail(alreadyRegistered ? "account_exists" : "invite_failed");
  }

  const marked = await callStaffRpc("staff_mark_invitation", {
    p_actor: input.actor.userId,
    p_invitation: invitationId,
    p_status: "sent",
    p_auth_user_id: invited.user.id,
    p_failure_reason: null,
    p_correlation: input.correlationId,
  });
  if (!marked.ok) return fail("partial_failure");

  return {
    ok: true,
    data: {
      invitationId,
      email: created.data.email,
      role: created.data.role,
      status: "sent",
    },
  };
}

type RevokedInvitation = {
  invitation_id: string;
  email: string;
  role: AssignableRole;
  status: "revoked";
  auth_user_id: string | null;
};

async function revokeInvitation(input: {
  actor: AdminIdentity;
  invitationId: string;
  correlationId: string;
}): Promise<StaffResult<RevokedInvitation>> {
  return callStaffRpc<RevokedInvitation>("staff_revoke_invitation", {
    p_actor: input.actor.userId,
    p_invitation: input.invitationId,
    p_correlation: input.correlationId,
  });
}

type AuthAdminUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
};

/** Find the Auth account for an invitation without trusting a client-supplied ID. */
async function findAuthUserForInvitation(
  client: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
  linkedUserId: string | null,
): Promise<StaffResult<{ user: AuthAdminUser | null }>> {
  const normalized = email.trim().toLowerCase();
  if (linkedUserId) {
    const linked = await client.auth.admin.getUserById(linkedUserId);
    if (!linked.error && linked.data.user?.email?.trim().toLowerCase() === normalized)
      return { ok: true, data: { user: linked.data.user } };
  }

  // The invitation may have created an Auth user before delivery-state recording
  // failed, leaving auth_user_id empty. Auth Admin has no email-specific lookup,
  // so scan bounded pages and compare the exact normalised address.
  const perPage = 1000;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) return fail("conflict");
    const user = data.users.find((candidate) => candidate.email?.trim().toLowerCase() === normalized);
    if (user) return { ok: true, data: { user } };
    if (data.users.length < perPage) break;
  }
  return { ok: true, data: { user: null } };
}

/**
 * Remove only a never-confirmed, never-used Auth user with no staff profile.
 * Confirmed, signed-in, or provisioned users are deliberately preserved.
 */
async function clearUnconfirmedAuthUser(input: {
  email: string;
  linkedUserId: string | null;
}): Promise<StaffResult<{ deleted: boolean; protected: boolean }>> {
  let client;
  try {
    client = createSupabaseAdminClient();
  } catch (error) {
    return fail(error instanceof SupabaseElevatedConfigError ? "not_configured" : "conflict");
  }

  const found = await findAuthUserForInvitation(client, input.email, input.linkedUserId);
  if (!found.ok) return found;
  const user = found.data.user;
  if (!user) return { ok: true, data: { deleted: false, protected: false } };

  const { data: profile, error: profileError } = await client
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) return fail("conflict");

  if (user.email_confirmed_at || user.last_sign_in_at || profile)
    return { ok: true, data: { deleted: false, protected: true } };

  // Re-read immediately before deletion so the decision is based on current Auth
  // state, not a stale invitation-list result.
  const latest = await client.auth.admin.getUserById(user.id);
  if (latest.error || !latest.data.user) return fail("revoked_cleanup_failed");
  if (
    latest.data.user.email?.trim().toLowerCase() !== input.email.trim().toLowerCase() ||
    latest.data.user.email_confirmed_at ||
    latest.data.user.last_sign_in_at
  )
    return { ok: true, data: { deleted: false, protected: true } };

  const { data: latestProfile, error: latestProfileError } = await client
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (latestProfileError) return fail("revoked_cleanup_failed");
  if (latestProfile) return { ok: true, data: { deleted: false, protected: true } };

  const { error: deleteError } = await client.auth.admin.deleteUser(user.id);
  if (deleteError) return fail("revoked_cleanup_failed");
  return { ok: true, data: { deleted: true, protected: false } };
}

/** Revoke an invitation; never delete a confirmed, active, or profiled user. */
export async function cancelStaffInvitation(input: {
  actor: AdminIdentity;
  invitationId: string;
  correlationId: string;
}): Promise<StaffResult<{ email: string; preservedAccount: boolean }>> {
  const revoked = await revokeInvitation(input);
  if (!revoked.ok) return revoked;
  const cleared = await clearUnconfirmedAuthUser({
    email: revoked.data.email,
    linkedUserId: revoked.data.auth_user_id,
  });
  if (!cleared.ok) return cleared;
  return {
    ok: true,
    data: {
      email: revoked.data.email,
      preservedAccount: cleared.data.protected,
    },
  };
}

/** Revoke, safely clear an unused Auth user, then send a replacement invite. */
export async function resendStaffInvitation(input: {
  actor: AdminIdentity;
  invitationId: string;
  redirectTo: string;
  correlationId: string;
}): Promise<StaffResult<InvitationOutcome>> {
  const revoked = await revokeInvitation(input);
  if (!revoked.ok) return revoked;

  const cleared = await clearUnconfirmedAuthUser({
    email: revoked.data.email,
    linkedUserId: revoked.data.auth_user_id,
  });
  if (!cleared.ok) return cleared;
  if (cleared.data.protected) return fail("account_exists");

  return inviteStaff({
    actor: input.actor,
    email: revoked.data.email,
    role: revoked.data.role,
    redirectTo: input.redirectTo,
    correlationId: input.correlationId,
  });
}

export async function changeStaffRole(input: {
  actor: AdminIdentity;
  targetUserId: string;
  role: AssignableRole;
  expectedUpdatedAt: string | null;
  reason?: string;
  correlationId: string;
}): Promise<StaffResult<{ userId: string; role: string; updatedAt: string }>> {
  const result = await callStaffRpc<{
    user_id: string;
    previous_role: string;
    role: string;
    disabled_at: string | null;
    updated_at: string;
  }>("staff_change_role", {
    p_actor: input.actor.userId,
    p_target: input.targetUserId,
    p_role: input.role,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_reason: input.reason ?? null,
    p_correlation: input.correlationId,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      userId: result.data.user_id,
      role: result.data.role,
      updatedAt: result.data.updated_at,
    },
  };
}

export async function setStaffDisabled(input: {
  actor: AdminIdentity;
  targetUserId: string;
  disabled: boolean;
  expectedUpdatedAt: string | null;
  reason?: string;
  correlationId: string;
}): Promise<StaffResult<{ userId: string; disabledAt: string | null; updatedAt: string }>> {
  const result = await callStaffRpc<{
    user_id: string;
    role: string;
    disabled_at: string | null;
    updated_at: string;
  }>("staff_set_disabled", {
    p_actor: input.actor.userId,
    p_target: input.targetUserId,
    p_disabled: input.disabled,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_reason: input.reason ?? null,
    p_correlation: input.correlationId,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      userId: result.data.user_id,
      disabledAt: result.data.disabled_at,
      updatedAt: result.data.updated_at,
    },
  };
}

export type InvitationReconciliation = {
  reconciled: boolean;
  role?: string;
};

/**
 * Turns an accepted invitation into an administrator profile.
 *
 * Called only from the verified sign-in / auth-callback path, after Supabase Auth
 * has confirmed the account. The authority is the invitation row (its email must
 * match the verified address) plus the invited role — never anything supplied by
 * the request. Idempotent, so repeated sign-ins are safe.
 *
 * Returns `{ reconciled: false }` when the account has no outstanding invitation;
 * the caller then continues with the normal (unauthenticated) flow. Failures never
 * block sign-in: the account simply has no profile and resolves to no role.
 */
export async function reconcileInvitationForUser(user: {
  id: string;
  email?: string | null;
  correlationId: string;
}): Promise<StaffResult<InvitationReconciliation>> {
  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) return { ok: true, data: { reconciled: false } };

  let client;
  try {
    client = createSupabaseAdminClient();
  } catch (error) {
    return fail(
      error instanceof SupabaseElevatedConfigError ? "not_configured" : "conflict",
    );
  }

  const { data: invitation, error } = await client
    .from("admin_invitations")
    .select("id, email, status")
    .eq("email", email)
    .in("status", ["pending", "sent"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !invitation) return { ok: true, data: { reconciled: false } };

  const completed = await callStaffRpc<{
    status: string;
    profile_role: string;
    idempotent: boolean;
  }>("staff_complete_invitation", {
    p_invitation: invitation.id,
    p_user_id: user.id,
    p_email: email,
    p_correlation: user.correlationId,
  });

  if (!completed.ok) return completed;
  return {
    ok: true,
    data: { reconciled: true, role: completed.data.profile_role },
  };
}
