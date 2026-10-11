/**
 * Pure staff-management domain logic: validation, invariants and error mapping.
 *
 * Everything here is deterministic and free of I/O so the security rules can be
 * unit-tested directly and shared by the server actions, the API route and the
 * UI. The database re-enforces the same invariants inside a single transaction
 * (see `20261011120300_admin_staff_functions.sql`) — this module decides whether
 * a request is *allowed to be attempted*, the database decides whether it is
 * *applied*.
 */

import { adminRoles, type AdminRole } from "@/lib/auth/roles";

export const STAFF_ROLES = adminRoles;

/** Only the roles that may be handed out through the staff console. */
export type AssignableRole = (typeof STAFF_ROLES)[number];

export const REASON_MIN_LENGTH = 3;
export const REASON_MAX_LENGTH = 200;

/**
 * Error taxonomy. A single code is produced by validation/planning, translated to
 * a user-facing message for the console and to a status code for API responses.
 */
export type StaffErrorCode =
  | "permission_denied"
  | "invalid_request"
  | "invalid_email"
  | "invalid_role"
  | "reason_required"
  | "not_found"
  | "self_action"
  | "role_unchanged"
  | "no_change"
  | "already_disabled"
  | "already_active"
  | "already_admin"
  | "account_exists"
  | "invitation_exists"
  | "invitation_not_found"
  | "email_mismatch"
  | "last_full_admin"
  | "conflict"
  | "rate_limited"
  | "not_configured"
  | "invite_failed"
  | "partial_failure";

export const STAFF_ERROR_MESSAGES: Record<StaffErrorCode, string> = {
  permission_denied:
    "You do not have permission to manage staff accounts.",
  invalid_request: "That request was not valid. Please review and try again.",
  invalid_email: "Enter a valid email address.",
  invalid_role: "Choose either Full Admin or Operational Admin.",
  reason_required: `Add a short reason (at least ${REASON_MIN_LENGTH} characters) for the record.`,
  not_found: "That administrator account could not be found.",
  self_action:
    "For your own account, ask another Full Admin to make this change.",
  role_unchanged: "That account already has the selected role.",
  no_change: "No change was needed: that account is already in that state.",
  already_disabled: "That account is already disabled.",
  already_active: "That account is already active.",
  already_admin:
    "That address already has an administrator profile. Change or restore the existing account instead.",
  account_exists:
    "An account already exists for that address. Review the account and provision access rather than inviting it again.",
  invitation_exists:
    "An invitation for that address is already outstanding.",
  invitation_not_found: "That invitation no longer exists.",
  email_mismatch:
    "That invitation was issued to a different email address.",
  last_full_admin:
    "The last active Full Admin cannot be removed. Add another Full Admin first.",
  conflict:
    "Another administrator changed this account. Reload the page and try again.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  not_configured:
    "Staff invitations are not configured on this deployment. Add the server-only Supabase secret key and try again.",
  invite_failed:
    "The invitation could not be sent. No account or access was created.",
  partial_failure:
    "The invitation email was sent, but the staff profile could not be created. Retry to reconcile the account.",
};

/** Errors that are the caller's fault (4xx) versus our own infrastructure (5xx). */
export function staffErrorStatus(code: StaffErrorCode): number {
  switch (code) {
    case "permission_denied":
      return 403;
    case "rate_limited":
      return 429;
    case "not_found":
      return 404;
    case "invite_failed":
    case "partial_failure":
      return 502;
    case "not_configured":
      return 503;
    case "conflict":
    case "last_full_admin":
    case "already_disabled":
    case "already_active":
    case "no_change":
      return 409;
    case "invalid_request":
    case "invalid_email":
    case "invalid_role":
    case "reason_required":
    case "self_action":
    case "role_unchanged":
    case "already_admin":
    case "account_exists":
    case "invitation_exists":
    case "invitation_not_found":
    case "email_mismatch":
      return 400;
    default:
      return 400;
  }
}

/** True when the code may safely be shown verbatim to an authenticated admin. */
export function isClientVisibleError(code: string): code is StaffErrorCode {
  return Object.prototype.hasOwnProperty.call(STAFF_ERROR_MESSAGES, code);
}

export function staffErrorMessage(code: string): string {
  return isClientVisibleError(code)
    ? STAFF_ERROR_MESSAGES[code]
    : STAFF_ERROR_MESSAGES.invalid_request;
}

/**
 * Maps a `staff_*` database function error (raised as `STAFF:<code>`) or a
 * PostgREST/network failure onto the taxonomy above. Anything unrecognised
 * becomes a generic conflict so raw database text never reaches the browser.
 */
/**
 * `STAFF_<CODE>` markers raised by the trusted database functions in
 * `supabase/migrations/20261011120300_admin_staff_functions.sql`, translated to
 * the taxonomy above. Keeping the database codes explicit means a new failure mode
 * cannot accidentally leak raw SQL text to the browser: anything unmapped becomes
 * a generic conflict.
 */
const DATABASE_CODE_MAP: Record<string, StaffErrorCode> = {
  FORBIDDEN: "permission_denied",
  ACTOR_REQUIRED: "permission_denied",
  SELF_CHANGE: "self_action",
  SELF_ACTION: "self_action",
  TARGET_REQUIRED: "not_found",
  NOT_FOUND: "not_found",
  UNKNOWN_ROLE: "invalid_role",
  INVALID_EMAIL: "invalid_email",
  INVALID_REQUEST: "invalid_request",
  STATE_REQUIRED: "invalid_request",
  STATE_UNCHANGED: "no_change",
  ALREADY_ADMIN: "already_admin",
  ACCOUNT_EXISTS: "account_exists",
  INVITATION_EXISTS: "invitation_exists",
  INVITATION_NOT_FOUND: "invitation_not_found",
  INVITATION_STATE: "no_change",
  EMAIL_MISMATCH: "email_mismatch",
  LAST_FULL_ADMIN: "last_full_admin",
  CONFLICT: "conflict",
};

export function mapStaffDatabaseError(
  message: string | null | undefined,
): StaffErrorCode {
  const raw = (message ?? "").toUpperCase();
  const marker = raw.match(/STAFF_([A-Z_]+)\s*:/) ?? raw.match(/STAFF:([A-Z_]+)/);
  const code = marker?.[1];
  if (code && DATABASE_CODE_MAP[code]) return DATABASE_CODE_MAP[code];
  if (code && isClientVisibleError(code.toLowerCase()))
    return code.toLowerCase() as StaffErrorCode;
  // Transport/PostgREST failures carry no STAFF marker. Treat them as a conflict
  // the operator can retry, never as a success.
  return "conflict";
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Pragmatic email validation for invitations: a single `@`, a dotted domain, no
 * whitespace. Supabase Auth performs the authoritative check; this exists so the
 * request is rejected before any privileged call is made.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const email = normaliseEmail(raw);
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function isAssignableRole(raw: unknown): raw is AssignableRole {
  return typeof raw === "string" && (STAFF_ROLES as readonly string[]).includes(raw);
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: StaffErrorCode };

export type InvitationInput = { email: string; role: AssignableRole };

/** Validates and normalises an invitation request. */
export function validateInvitationInput(input: {
  email?: unknown;
  role?: unknown;
}): ValidationResult<InvitationInput> {
  const rawEmail = typeof input.email === "string" ? input.email : "";
  const email = normaliseEmail(rawEmail);
  if (!email) return { ok: false, code: "invalid_request" };
  if (!isValidEmail(email)) return { ok: false, code: "invalid_email" };
  if (!isAssignableRole(input.role)) return { ok: false, code: "invalid_role" };
  return { ok: true, value: { email, role: input.role } };
}

export function validateReason(raw: unknown): ValidationResult<string | undefined> {
  const reason = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!reason) return { ok: true, value: undefined };
  if (reason.length < REASON_MIN_LENGTH || reason.length > REASON_MAX_LENGTH) {
    return { ok: false, code: "reason_required" };
  }
  return { ok: true, value: reason };
}

// ---------------------------------------------------------------------------
// Planning: role changes and account state changes
// ---------------------------------------------------------------------------

export type StaffProfile = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: AdminRole;
  disabled_at: string | null;
  created_at: string;
};

/**
 * Wire shapes shared by the staff API, the server service and the console UI.
 * Declared in this dependency-free module so the client component can import the
 * types without pulling a server-only module into the browser bundle.
 */
export type StaffAccount = {
  userId: string;
  email: string | null;
  displayName: string;
  role: string;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  failureReason: string | null;
};

export type StaffDecision =
  | { ok: true; reasonRequired: boolean }
  | { ok: false; code: StaffErrorCode };

export type ActorCapability = { canManageStaff: boolean };

const allowed: StaffDecision = { ok: true, reasonRequired: false };

/**
 * Active Full Admins excluding any account that is being demoted or disabled.
 * The database performs the same count inside a transaction with the target row
 * locked; this helper only lets the UI explain the rule before submitting.
 */
export function activeFullAdminsExcluding(
  staff: StaffAccount[],
  excludedUserId?: string,
): number {
  return staff.filter(
    (member) =>
      member.role === "full_admin" &&
      !member.disabledAt &&
      member.userId !== excludedUserId,
  ).length;
}

/**
 * Plans a role change. Reason is required whenever the change crosses the
 * Full Admin boundary (promotion or demotion), so every privilege elevation
 * carries a written justification for the audit trail.
 */
export function planRoleChange(input: {
  actor: ActorCapability;
  actorId: string;
  targetId: string;
  currentRole: AdminRole;
  nextRole: string;
  reason?: string;
  activeFullAdmins: number;
}): StaffDecision {
  if (!input.actor.canManageStaff) return { ok: false, code: "permission_denied" };
  if (input.actorId === input.targetId) return { ok: false, code: "self_action" };
  if (!isAssignableRole(input.nextRole))
    return { ok: false, code: "invalid_role" };
  if (input.nextRole === input.currentRole)
    return { ok: false, code: "role_unchanged" };

  const crossesFullAdminBoundary =
    input.currentRole === "full_admin" || input.nextRole === "full_admin";

  if (input.currentRole === "full_admin" && input.activeFullAdmins <= 0) {
    return { ok: false, code: "last_full_admin" };
  }

  if (crossesFullAdminBoundary && !input.reason?.trim()) {
    return { ok: false, code: "reason_required" };
  }

  return { ok: true, reasonRequired: crossesFullAdminBoundary };
}

/**
 * Plans a disable/restore. Disabling the last active Full Admin is refused;
 * every state change requires a reason.
 */
export function planStatusChange(input: {
  actor: ActorCapability;
  actorId: string;
  targetId: string;
  targetRole: AdminRole;
  targetDisabled: boolean;
  desiredDisabled: boolean;
  reason?: string;
  activeFullAdmins: number;
}): StaffDecision {
  if (!input.actor.canManageStaff) return { ok: false, code: "permission_denied" };
  if (input.actorId === input.targetId) return { ok: false, code: "self_action" };
  if (input.desiredDisabled === input.targetDisabled) {
    return {
      ok: false,
      code: input.targetDisabled ? "already_disabled" : "already_active",
    };
  }
  if (input.desiredDisabled && input.targetRole === "full_admin") {
    if (input.activeFullAdmins <= 0) return { ok: false, code: "last_full_admin" };
  }
  if (!input.reason?.trim()) return { ok: false, code: "reason_required" };
  return { ok: true, reasonRequired: true };
}

/** Prevents a self-invite or re-inviting an address that already has a profile. */
export function planInvitation(input: {
  actor: ActorCapability;
  actorEmail: string | null;
  email: string;
  role: AssignableRole;
  existingEmails: string[];
}): StaffDecision {
  if (!input.actor.canManageStaff) return { ok: false, code: "permission_denied" };
  if (!isValidEmail(input.email)) return { ok: false, code: "invalid_email" };
  if (!isAssignableRole(input.role)) return { ok: false, code: "invalid_role" };
  const email = normaliseEmail(input.email);
  if (input.actorEmail && normaliseEmail(input.actorEmail) === email) {
    return { ok: false, code: "self_action" };
  }
  if (input.existingEmails.some((known) => normaliseEmail(known) === email)) {
    return { ok: false, code: "already_active" };
  }
  return { ok: true, reasonRequired: false };
}

export function emptyDecision(): StaffDecision {
  return allowed;
}
// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function staffDisplayName(member: {
  displayName?: string | null;
  email: string | null;
}): string {
  return member.displayName?.trim() || member.email || "Unnamed administrator";
}

export function staffStatus(member: { disabledAt: string | null }): {
  label: "Active" | "Disabled";
  tone: "positive" | "muted";
} {
  return member.disabledAt
    ? { label: "Disabled", tone: "muted" }
    : { label: "Active", tone: "positive" };
}

/** Human-readable labels for the actions recorded in `audit_events`. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "staff.invited": "Invitation created",
  "staff.invitation_sent": "Invitation sent",
  "staff.invitation_failed": "Invitation failed",
  "staff.invitation_accepted": "Invitation accepted",
  "staff.provisioned": "Staff profile created",
  "staff.role_changed": "Role changed",
  "staff.suspended": "Account disabled",
  "staff.restored": "Account restored",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export type AuditEvent = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  correlation_id: string | null;
  created_at: string;
};

/**
 * Renders the change described by an audit event as a short, safe sentence.
 * Only state keys the application itself writes are read, and never a secret.
 */
export function describeAuditEvent(event: {
  action: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
}): string {
  const before = event.before_state ?? {};
  const after = event.after_state ?? {};
  if (event.action === "staff.role_changed") {
    return `${roleLabel(before.role)} → ${roleLabel(after.role)}`;
  }
  if (event.action === "staff.invited") {
    return `Invited as ${roleLabel(after.role)}`;
  }
  if (event.action === "staff.suspended" || event.action === "staff.restored") {
    return staffStatus({
      disabledAt: event.action === "staff.suspended" ? "yes" : null,
    }).label;
  }
  return "";
}

function roleLabel(value: unknown): string {
  return value === "full_admin"
    ? "Full Admin"
    : value === "operational_admin"
      ? "Operational Admin"
      : "Unknown role";
}
