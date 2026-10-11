import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_ACTION_LABELS,
  REASON_MAX_LENGTH,
  STAFF_ERROR_MESSAGES,
  STAFF_ROLES,
  activeFullAdminsExcluding,
  auditActionLabel,
  describeAuditEvent,
  isAssignableRole,
  isValidEmail,
  mapStaffDatabaseError,
  normaliseEmail,
  planInvitation,
  planRoleChange,
  planStatusChange,
  staffDisplayName,
  staffErrorStatus,
  staffErrorMessage,
  staffStatus,
  validateInvitationInput,
  validateReason,
  type StaffAccount,
  type StaffErrorCode,
} from "../src/lib/admin/staff";

/**
 * Sprint 1C staff-management domain tests.
 *
 * These cover the pure validation and invariant logic shared by the server actions
 * and the console UI. The database re-enforces the same invariants inside a single
 * transaction (see supabase/migrations/20261011120300_admin_staff_functions.sql);
 * the SQL-level behaviour is covered by the (NOT EXECUTED) database test file
 * supabase/tests/sprint_1c_staff_security.sql, and these tests deliberately do not
 * claim to prove it.
 */

const ACTOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TARGET = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const canManage = { canManageStaff: true };
const cannotManage = { canManageStaff: false };

function account(overrides: Partial<StaffAccount>): StaffAccount {
  return {
    userId: TARGET,
    email: "staff@example.test",
    displayName: "Staff Member",
    role: "operational_admin",
    disabledAt: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}

test("role list is the existing two-role enum", () => {
  assert.deepEqual([...STAFF_ROLES], ["full_admin", "operational_admin"]);
  assert.equal(isAssignableRole("full_admin"), true);
  assert.equal(isAssignableRole("operational_admin"), true);
  for (const value of ["super_admin", "FULL_ADMIN", "", null, 1, {}, undefined])
    assert.equal(isAssignableRole(value), false, String(value));
});

test("every error code has a safe, non-technical message and a status", () => {
  for (const [code, message] of Object.entries(STAFF_ERROR_MESSAGES)) {
    assert.ok(message.length > 10, code);
    assert.ok(!/SQL|stack|relation|column|postgres/i.test(message), code);
    assert.equal(staffErrorMessage(code), message);
    const status = staffErrorStatus(code as StaffErrorCode);
    assert.equal(status >= 400 && status <= 503, true, code);
  }
  // Unknown codes never leak through.
  assert.equal(staffErrorMessage("STAFF_RAW_PG_ERROR: relation does not exist"), STAFF_ERROR_MESSAGES.invalid_request);
  assert.equal(staffErrorStatus("made-up" as StaffErrorCode), 400);
});

test("database error markers map onto the taxonomy", () => {
  const cases: Array<[string, StaffErrorCode]> = [
    // The real markers raised by the trusted functions.
    ["STAFF_LAST_FULL_ADMIN: this is the only active Full Admin.", "last_full_admin"],
    ["STAFF_SELF_CHANGE: an administrator cannot change their own role.", "self_action"],
    ["STAFF_CONFLICT: this account changed while you were editing it.", "conflict"],
    ["STAFF_ALREADY_ADMIN: that address already has an administrator profile.", "already_admin"],
    ["STAFF_ACCOUNT_EXISTS: an account already exists for that address.", "account_exists"],
    ["STAFF_INVITATION_EXISTS: an invitation for that address is already sent .", "invitation_exists"],
    ["STAFF_INVALID_EMAIL: the invitation address is not valid.", "invalid_email"],
    ["STAFF_UNKNOWN_ROLE: a role of full_admin or operational_admin is required.", "invalid_role"],
    ["STAFF_FORBIDDEN: the acting account is not an active Full Admin.", "permission_denied"],
    ["STAFF_ACTOR_REQUIRED: no verified administrator identity was supplied.", "permission_denied"],
    ["STAFF_STATE_UNCHANGED: that account already has the operational_admin role.", "no_change"],
    ["STAFF_TARGET_REQUIRED: that account is not an administrator.", "not_found"],
  ];
  for (const [message, expected] of cases)
    assert.equal(mapStaffDatabaseError(message), expected, message);

  // Transport failures and unrecognised text never surface as a success or as raw
  // SQL: they become a retryable conflict.
  assert.equal(mapStaffDatabaseError(null), "conflict");
  assert.equal(mapStaffDatabaseError("Failed to fetch"), "conflict");
  assert.equal(mapStaffDatabaseError("permission denied for table admin_profiles"), "conflict");
});

test("email validation normalises and rejects unusable addresses", () => {
  assert.equal(normaliseEmail("  Staff@Example.TEST "), "staff@example.test");
  for (const valid of ["a@b.co", "first.last+tag@sub.example.com"])
    assert.equal(isValidEmail(valid), true, valid);
  for (const invalid of [
    "",
    "not-an-email",
    "@example.com",
    "staff@",
    "staff@example",
    "staff example@test.com",
    "staff@example.test extra",
    `${"a".repeat(250)}@example.test`,
  ])
    assert.equal(isValidEmail(invalid), false, invalid);
});

test("invitation input validation", () => {
  const good = validateInvitationInput({
    email: " New.Staff@Example.test ",
    role: "operational_admin",
  });
  assert.deepEqual(good, {
    ok: true,
    value: { email: "new.staff@example.test", role: "operational_admin" },
  });

  assert.deepEqual(validateInvitationInput({ email: "", role: "full_admin" }), {
    ok: false,
    code: "invalid_request",
  });
  assert.deepEqual(validateInvitationInput({ email: "nope", role: "full_admin" }), {
    ok: false,
    code: "invalid_email",
  });
  assert.deepEqual(
    validateInvitationInput({ email: "a@b.co", role: "super_admin" }),
    { ok: false, code: "invalid_role" },
  );
  assert.deepEqual(
    validateInvitationInput({ email: "a@b.co", role: undefined }),
    { ok: false, code: "invalid_role" },
  );
});

test("reason validation trims, collapses whitespace and bounds length", () => {
  assert.deepEqual(validateReason(""), { ok: true, value: undefined });
  assert.deepEqual(validateReason("   "), { ok: true, value: undefined });
  assert.deepEqual(validateReason(null), { ok: true, value: undefined });
  assert.deepEqual(validateReason("  New   starter  "), {
    ok: true,
    value: "New starter",
  });
  assert.deepEqual(validateReason("ab"), { ok: false, code: "reason_required" });
  assert.deepEqual(validateReason("a".repeat(REASON_MAX_LENGTH + 1)), {
    ok: false,
    code: "reason_required",
  });
});

test("role change planning enforces every invariant", () => {
  const base = {
    actor: canManage,
    actorId: ACTOR,
    targetId: TARGET,
    currentRole: "operational_admin" as const,
    nextRole: "operational_admin",
    reason: "Promotion approved by the owner",
    activeFullAdmins: 2,
  };

  // Without the capability nothing is allowed, whatever else is true.
  assert.deepEqual(planRoleChange({ ...base, actor: cannotManage }), {
    ok: false,
    code: "permission_denied",
  });

  // No self-service changes: escalation and accidental self-demotion both refused.
  assert.deepEqual(planRoleChange({ ...base, targetId: ACTOR }), {
    ok: false,
    code: "self_action",
  });

  assert.deepEqual(planRoleChange({ ...base, nextRole: "super_admin" }), {
    ok: false,
    code: "invalid_role",
  });

  assert.deepEqual(planRoleChange({ ...base, nextRole: "operational_admin" }), {
    ok: false,
    code: "role_unchanged",
  });

  // Elevation and demotion both require a written reason.
  assert.deepEqual(
    planRoleChange({ ...base, nextRole: "full_admin", reason: undefined }),
    { ok: false, code: "reason_required" },
  );
  assert.deepEqual(
    planRoleChange({
      ...base,
      currentRole: "full_admin",
      nextRole: "operational_admin",
      reason: " ",
    }),
    { ok: false, code: "reason_required" },
  );

  // The last active Full Admin cannot be demoted.
  assert.deepEqual(
    planRoleChange({
      ...base,
      currentRole: "full_admin",
      nextRole: "operational_admin",
      activeFullAdmins: 0,
    }),
    { ok: false, code: "last_full_admin" },
  );

  assert.deepEqual(planRoleChange({ ...base, nextRole: "full_admin" }), {
    ok: true,
    reasonRequired: true,
  });
  // A demotion with another Full Admin present is allowed, with a reason.
  assert.deepEqual(
    planRoleChange({
      ...base,
      currentRole: "full_admin",
      nextRole: "operational_admin",
      activeFullAdmins: 1,
    }),
    { ok: true, reasonRequired: true },
  );
});

test("role changes for a suspended account are still planned safely", () => {
  // A suspended Full Admin is not part of the active count, so demoting them can
  // never remove the last active Full Admin.
  assert.deepEqual(
    planRoleChange({
      actor: canManage,
      actorId: ACTOR,
      targetId: TARGET,
      currentRole: "full_admin",
      nextRole: "operational_admin",
      reason: "Leaver handover",
      activeFullAdmins: 1,
    }),
    { ok: true, reasonRequired: true },
  );
});

test("account state planning handles disable, restore and repeats", () => {
  const base = {
    actor: canManage,
    actorId: ACTOR,
    targetId: TARGET,
    targetRole: "operational_admin" as const,
    targetDisabled: false,
    desiredDisabled: true,
    reason: "Left the company",
    activeFullAdmins: 1,
  };

  assert.deepEqual(planStatusChange({ ...base, actor: cannotManage }), {
    ok: false,
    code: "permission_denied",
  });
  assert.deepEqual(planStatusChange({ ...base, targetId: ACTOR }), {
    ok: false,
    code: "self_action",
  });
  // Repeated disable / repeated restore are reported, not silently "succeeded".
  assert.deepEqual(planStatusChange({ ...base, targetDisabled: true }), {
    ok: false,
    code: "already_disabled",
  });
  assert.deepEqual(
    planStatusChange({
      ...base,
      desiredDisabled: false,
      targetDisabled: false,
    }),
    { ok: false, code: "already_active" },
  );
  // Both operations require a reason.
  assert.deepEqual(planStatusChange({ ...base, reason: undefined }), {
    ok: false,
    code: "reason_required",
  });
  assert.deepEqual(
    planStatusChange({ ...base, desiredDisabled: false, targetDisabled: true, reason: "Returning" }),
    { ok: true, reasonRequired: true },
  );
  assert.deepEqual(planStatusChange(base), { ok: true, reasonRequired: true });
});

test("the last active Full Admin cannot be suspended", () => {
  assert.deepEqual(
    planStatusChange({
      actor: canManage,
      actorId: ACTOR,
      targetId: TARGET,
      targetRole: "full_admin",
      targetDisabled: false,
      desiredDisabled: true,
      reason: "Account review",
      activeFullAdmins: 0,
    }),
    { ok: false, code: "last_full_admin" },
  );
  // With another Full Admin present it is allowed (and audited).
  assert.deepEqual(
    planStatusChange({
      actor: canManage,
      actorId: ACTOR,
      targetId: TARGET,
      targetRole: "full_admin",
      targetDisabled: false,
      desiredDisabled: true,
      reason: "Handover complete",
      activeFullAdmins: 1,
    }),
    { ok: true, reasonRequired: true },
  );
  // Restoring a suspended Full Admin is always allowed.
  assert.deepEqual(
    planStatusChange({
      actor: canManage,
      actorId: ACTOR,
      targetId: TARGET,
      targetRole: "full_admin",
      targetDisabled: true,
      desiredDisabled: false,
      reason: "Returning from leave",
      activeFullAdmins: 0,
    }),
    { ok: true, reasonRequired: true },
  );
});

test("the active Full Admin count excludes suspended and target accounts", () => {
  const staff = [
    account({ userId: ACTOR, role: "full_admin", email: "owner@example.test" }),
    account({ userId: OTHER, role: "full_admin", disabledAt: "2026-09-01T00:00:00.000Z" }),
    account({ userId: "dddddddd-dddd-dddd-dddd-dddddddddddd", role: "operational_admin" }),
  ];
  assert.equal(activeFullAdminsExcluding(staff), 1);
  assert.equal(activeFullAdminsExcluding(staff, ACTOR), 0);
  assert.equal(activeFullAdminsExcluding([], ACTOR), 0);
});

test("invitation planning refuses self-invites and duplicates", () => {
  const base = {
    actor: canManage,
    actorEmail: "owner@example.test",
    email: "new.staff@example.test",
    role: "operational_admin" as const,
    existingEmails: ["owner@example.test"],
  };
  assert.deepEqual(planInvitation(base), { ok: true, reasonRequired: false });

  assert.deepEqual(planInvitation({ ...base, actor: cannotManage }), {
    ok: false,
    code: "permission_denied",
  });
  assert.deepEqual(planInvitation({ ...base, email: "broken" }), {
    ok: false,
    code: "invalid_email",
  });
  assert.deepEqual(planInvitation({ ...base, email: "owner@example.test" }), {
    ok: false,
    code: "self_action",
  });
  // Duplicate detection is case-insensitive, and covers suspended accounts.
  assert.deepEqual(
    planInvitation({ ...base, email: "Existing.Admin@Example.test", existingEmails: ["existing.admin@example.test"] }),
    { ok: false, code: "already_active" },
  );
});

test("staff display helpers describe accounts safely", () => {
  assert.equal(
    staffDisplayName({ displayName: "  Ana Silva ", email: "ana@example.test" }),
    "Ana Silva",
  );
  assert.equal(staffDisplayName({ displayName: "", email: "ana@example.test" }), "ana@example.test");
  assert.equal(staffDisplayName({ displayName: null, email: null }), "Unnamed administrator");
  assert.deepEqual(staffStatus({ disabledAt: null }), { label: "Active", tone: "positive" });
  assert.deepEqual(staffStatus({ disabledAt: "2026-10-01T00:00:00.000Z" }), {
    label: "Disabled",
    tone: "muted",
  });
});

test("audit events render a readable, bounded description", () => {
  assert.equal(
    describeAuditEvent({
      action: "staff.role_changed",
      before_state: { role: "operational_admin", active: true },
      after_state: { role: "full_admin", active: true },
    }),
    "Operational Admin → Full Admin",
  );
  assert.equal(
    describeAuditEvent({
      action: "staff.role_changed",
      before_state: { role: "full_admin" },
      after_state: { role: "operational_admin" },
    }),
    "Full Admin → Operational Admin",
  );
  assert.equal(
    describeAuditEvent({
      action: "staff.invited",
      before_state: null,
      after_state: { role: "full_admin" },
    }),
    "Invited as Full Admin",
  );
  assert.equal(
    describeAuditEvent({
      action: "staff.suspended",
      before_state: { role: "full_admin", active: true },
      after_state: { role: "full_admin", active: false },
    }),
    "Disabled",
  );
  assert.equal(
    describeAuditEvent({
      action: "staff.restored",
      before_state: { active: false },
      after_state: { active: true },
    }),
    "Active",
  );
  // An unknown action never fabricates detail.
  assert.equal(
    describeAuditEvent({ action: "booking.updated", before_state: null, after_state: null }),
    "",
  );
  assert.equal(auditActionLabel("staff.role_changed"), AUDIT_ACTION_LABELS["staff.role_changed"]);
  assert.equal(auditActionLabel("booking.updated"), "booking.updated");
});
