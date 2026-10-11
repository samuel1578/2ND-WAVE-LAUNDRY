"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  History,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  UserPlus,
  Users,
} from "lucide-react";
import { Dialog } from "@/components/dialog";
import { Empty, Heading, Skeleton } from "@/components/ui";
import { Field, Notice, TextField } from "@/components/forms/controls";
import {
  changeAdministratorRole,
  inviteAdministrator,
  setAdministratorStatus,
} from "@/lib/admin/staff-actions";
import {
  activeFullAdminsExcluding,
  auditActionLabel,
  describeAuditEvent,
  planInvitation,
  planRoleChange,
  planStatusChange,
  staffDisplayName,
  staffErrorMessage,
  staffStatus,
  validateInvitationInput,
  type AssignableRole,
  type AuditEvent,
  type StaffAccount,
  type StaffInvitation,
} from "@/lib/admin/staff";

/**
 * Staff management console (Sprint 1C). Full Admin only.
 *
 * The page is only rendered after the server has authorised the route, and every
 * mutation re-authorises on the server: this component decides what to *show* and
 * gives immediate validation feedback, while the database enforces the
 * invariants. It never sends an actor id — the acting administrator is resolved
 * from the verified session inside each server action.
 *
 * Reads come from `/api/admin/staff`, which returns 401/403 for anyone without the
 * `staff.manage` capability and whose queries run under row level security with
 * the caller's own client.
 */

type Directory = {
  members: StaffAccount[];
  invitations: StaffInvitation[];
  activeFullAdmins: number;
};

const ROLE_LABELS: Record<string, string> = {
  full_admin: "Full Admin",
  operational_admin: "Operational Admin",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateFormatter.format(parsed);
}

function invitationStatusLabel(status: string): string {
  return (
    {
      pending: "Not yet sent",
      sent: "Awaiting acceptance",
      accepted: "Accepted",
      failed: "Failed",
      revoked: "Revoked",
    }[status] ?? status
  );
}

export function StaffAdmin({ viewerId }: { viewerId?: string }) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Invitation form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("operational_admin");
  const [inviteError, setInviteError] = useState("");

  // Confirmation dialogs
  const [roleDialog, setRoleDialog] = useState<StaffAccount | null>(null);
  const [roleValue, setRoleValue] = useState<AssignableRole>("operational_admin");
  const [roleReason, setRoleReason] = useState("");
  const [roleConfirmed, setRoleConfirmed] = useState(false);
  const [roleError, setRoleError] = useState("");

  const [statusDialog, setStatusDialog] = useState<{
    member: StaffAccount;
    disabled: boolean;
  } | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [statusConfirmed, setStatusConfirmed] = useState(false);
  const [statusError, setStatusError] = useState("");

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    try {
      const response = await fetch("/api/admin/staff", { cache: "no-store" });
      if (!response.ok) {
        setLoadError(
          response.status === 403
            ? "Your administrator role does not include staff management."
            : "Staff accounts could not be loaded. Reload the page and try again.",
        );
        setDirectory(null);
        return;
      }
      const payload = (await response.json()) as Directory;
      setDirectory({
        members: payload.members ?? [],
        invitations: payload.invitations ?? [],
        activeFullAdmins: payload.activeFullAdmins ?? 0,
      });
      setLoadError("");
    } catch {
      setLoadError("Staff accounts could not be loaded. Reload the page and try again.");
      setDirectory(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  const knownEmails = useMemo(
    () =>
      (directory?.members ?? [])
        .map((member) => member.email)
        .filter((email): email is string => Boolean(email)),
    [directory],
  );

  async function loadEvents() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/staff?events=1&limit=50", {
        cache: "no-store",
      });
      if (!response.ok) {
        setFeedback({
          kind: "error",
          message: "Activity history could not be loaded.",
        });
        return;
      }
      const payload = (await response.json()) as { events: AuditEvent[] };
      setEvents(payload.events ?? []);
    } catch {
      setFeedback({
        kind: "error",
        message: "Activity history could not be loaded.",
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function submitInvitation(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setInviteError("");
    setFeedback(null);

    // Immediate feedback using the same pure rules the server applies.
    const validated = validateInvitationInput({ email: inviteEmail, role: inviteRole });
    if (!validated.ok) {
      setInviteError(staffErrorMessage(validated.code));
      return;
    }
    const planned = planInvitation({
      actor: { canManageStaff: true },
      actorEmail: null,
      email: validated.value.email,
      role: validated.value.role,
      existingEmails: knownEmails,
    });
    if (!planned.ok) {
      setInviteError(staffErrorMessage(planned.code));
      return;
    }

    setBusy(true);
    try {
      const result = await inviteAdministrator({
        email: validated.value.email,
        role: validated.value.role,
      });
      if (!result.ok) {
        setInviteError(result.message);
        return;
      }
      setFeedback({ kind: "success", message: result.message });
      setInviteEmail("");
      setInviteRole("operational_admin");
      await load("refresh");
    } finally {
      setBusy(false);
    }
  }

  function openRoleDialog(member: StaffAccount) {
    setRoleDialog(member);
    setRoleValue(member.role === "full_admin" ? "operational_admin" : "full_admin");
    setRoleReason("");
    setRoleConfirmed(false);
    setRoleError("");
    setFeedback(null);
  }

  function openStatusDialog(member: StaffAccount) {
    setStatusDialog({ member, disabled: !member.disabledAt });
    setStatusReason("");
    setStatusConfirmed(false);
    setStatusError("");
    setFeedback(null);
  }

  const rolePlan = roleDialog
    ? planRoleChange({
        actor: { canManageStaff: true },
        actorId: viewerId ?? "",
        targetId: roleDialog.userId,
        currentRole: roleDialog.role === "full_admin" ? "full_admin" : "operational_admin",
        nextRole: roleValue,
        reason: roleReason,
        activeFullAdmins: activeFullAdminsExcluding(
          directory?.members ?? [],
          roleDialog.userId,
        ),
      })
    : null;

  const statusPlan = statusDialog
    ? planStatusChange({
        actor: { canManageStaff: true },
        actorId: viewerId ?? "",
        targetId: statusDialog.member.userId,
        targetRole:
          statusDialog.member.role === "full_admin" ? "full_admin" : "operational_admin",
        targetDisabled: Boolean(statusDialog.member.disabledAt),
        desiredDisabled: statusDialog.disabled,
        reason: statusReason,
        activeFullAdmins: activeFullAdminsExcluding(
          directory?.members ?? [],
          statusDialog.member.userId,
        ),
      })
    : null;

  async function confirmRoleChange() {
    if (!roleDialog || busy) return;
    setRoleError("");
    if (rolePlan && !rolePlan.ok) {
      setRoleError(staffErrorMessage(rolePlan.code));
      return;
    }
    setBusy(true);
    try {
      const result = await changeAdministratorRole({
        userId: roleDialog.userId,
        role: roleValue,
        expectedUpdatedAt: roleDialog.updatedAt,
        reason: roleReason,
        confirmed: roleValue === "full_admin" ? roleConfirmed : true,
      });
      if (!result.ok) {
        setRoleError(result.message);
        return;
      }
      setFeedback({ kind: "success", message: result.message });
      setRoleDialog(null);
      await load("refresh");
    } finally {
      setBusy(false);
    }
  }

  async function confirmStatusChange() {
    if (!statusDialog || busy) return;
    setStatusError("");
    if (statusPlan && !statusPlan.ok) {
      setStatusError(staffErrorMessage(statusPlan.code));
      return;
    }
    setBusy(true);
    try {
      const result = await setAdministratorStatus({
        userId: statusDialog.member.userId,
        disabled: statusDialog.disabled,
        expectedUpdatedAt: statusDialog.member.updatedAt,
        reason: statusReason,
        confirmed: statusConfirmed,
      });
      if (!result.ok) {
        setStatusError(result.message);
        return;
      }
      setFeedback({ kind: "success", message: result.message });
      setStatusDialog(null);
      await load("refresh");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading
        title="Staff Management"
        description="Invite administrators, manage roles and suspend or restore access. Every change is recorded in the audit log."
      >
        {directory && (
          <span className="badge">
            {directory.activeFullAdmins} active Full Admin
            {directory.activeFullAdmins === 1 ? "" : "s"}
          </span>
        )}
      </Heading>

      {feedback && (
        <Notice error={feedback.kind === "error"} success={feedback.kind === "success"}>
          {feedback.message}
        </Notice>
      )}
      {loadError && <Notice error>{loadError}</Notice>}

      <section className="panel form-stack">
        <h2>
          <UserPlus size={20} aria-hidden="true" /> Invite an administrator
        </h2>
        <p>
          The invitation email is sent by Supabase Auth from the server only. The
          invitee gains no access until they accept the invitation and their staff
          profile is created from the invited role.
        </p>
        {inviteError && <Notice error>{inviteError}</Notice>}
        <form className="form-grid" onSubmit={submitInvitation} noValidate>
          <TextField
            id="staff-invite-email"
            label="Email address"
            type="email"
            required
            autoComplete="off"
            aria-describedby="staff-invite-email-help"
            value={inviteEmail}
            help="The address that will receive the invitation link."
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <Field label="Role" id="staff-invite-role">
            <select
              id="staff-invite-role"
              value={inviteRole}
              disabled={busy}
              onChange={(e) => setInviteRole(e.target.value as AssignableRole)}
            >
              <option value="operational_admin">Operational Admin</option>
              <option value="full_admin">Full Admin</option>
            </select>
          </Field>
          <div className="full-span actions">
            <button type="submit" className="button" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle size={18} className="spin" aria-hidden="true" /> Sending…
                </>
              ) : (
                "Send Invitation"
              )}
            </button>
          </div>
        </form>
        <p className="demo-caption">
          Invitation emails are limited by the Supabase project&apos;s built-in email
          service (a small hourly quota, and the default sender is not suitable for
          production deliverability). Configure a custom SMTP provider in Supabase
          before relying on invitations in production.
        </p>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>
            <Users size={20} aria-hidden="true" /> Administrator accounts
          </h2>
          <button
            type="button"
            className="text-link"
            onClick={() => void load("refresh")}
            disabled={refreshing}
          >
            {refreshing ? (
              <>
                <LoaderCircle size={16} className="spin" aria-hidden="true" /> Refreshing…
              </>
            ) : (
              <>
                <RefreshCw size={16} aria-hidden="true" /> Refresh
              </>
            )}
          </button>
        </div>
        {loading ? (
          <Skeleton count={2} />
        ) : directory && directory.members.length ? (
          <div className="table-wrap">
            <table aria-busy={busy}>
              <caption className="sr-only">
                Administrator accounts, their role, account status and available
                actions
              </caption>
              <thead>
                <tr>
                  <th scope="col">Administrator</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Added</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {directory.members.map((member) => {
                  const status = staffStatus({ disabledAt: member.disabledAt });
                  const isSelf = viewerId === member.userId;
                  return (
                    <tr key={member.userId}>
                      <td>
                        <strong>{staffDisplayName(member)}</strong>
                        <br />
                        <small>{member.email ?? "Email not recorded"}</small>
                        {isSelf && (
                          <>
                            {" "}
                            <span className="badge">You</span>
                          </>
                        )}
                      </td>
                      <td>{ROLE_LABELS[member.role] ?? member.role}</td>
                      <td>
                        <span
                          className={`badge ${
                            status.label === "Disabled" ? "cancelled" : "completed"
                          }`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td>{formatDate(member.createdAt)}</td>
                      <td>
                        <div className="actions">
                          <button
                            type="button"
                            className="button secondary small"
                            disabled={busy || isSelf}
                            onClick={() => openRoleDialog(member)}
                          >
                            <KeyRound size={15} aria-hidden="true" /> Change role
                          </button>
                          <button
                            type="button"
                            className={`button small ${member.disabledAt ? "" : "danger"}`}
                            disabled={busy || isSelf}
                            onClick={() => openStatusDialog(member)}
                          >
                            {member.disabledAt ? (
                              <>
                                <ShieldCheck size={15} aria-hidden="true" /> Restore
                              </>
                            ) : (
                              <>
                                <ShieldOff size={15} aria-hidden="true" /> Disable
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No administrator accounts to show yet."
            body="Invite the first administrator above."
          />
        )}
        <p className="demo-caption">
          For your own account the actions are disabled: role changes, suspension and
          restoration always require a different Full Admin, so no one can escalate
          their own privileges.
        </p>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>Invitations</h2>
        </div>
        {directory && directory.invitations.length ? (
          <div>
            {directory.invitations.map((invitation) => (
              <li className="record-row" key={invitation.id}>
                <div>
                  <small>{invitationStatusLabel(invitation.status)}</small>
                  <h3>{invitation.email}</h3>
                  <p>
                    {ROLE_LABELS[invitation.role] ?? invitation.role} · invited{" "}
                    {formatDate(invitation.createdAt)}
                    {invitation.failureReason ? ` · ${invitation.failureReason}` : ""}
                  </p>
                </div>
                <span
                  className={`badge ${invitation.status === "failed" ? "cancelled" : ""}`}
                >
                  {invitation.status === "accepted" ? "Active" : "Pending"}
                </span>
              </li>
            ))}
          </div>
        ) : (
          <p>No invitations have been recorded yet.</p>
        )}
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>
            <History size={20} aria-hidden="true" /> Account activity
          </h2>
          <button
            type="button"
            className="text-link"
            onClick={() => void loadEvents()}
            disabled={refreshing}
          >
            {events ? "Reload activity" : "Load activity"}
          </button>
        </div>
        {events === null ? (
          <p>
            Audit history is not loaded by default. Load it to review invitations,
            provisioning, role changes and account suspensions.
          </p>
        ) : events.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Recent account activity</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Account</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDate(event.created_at)}</td>
                    <td>{auditActionLabel(event.action)}</td>
                    <td>
                      <small>{event.entity_id ?? "—"}</small>
                    </td>
                    <td>
                      {describeAuditEvent(event) || "—"}
                      {event.reason ? <em> · {event.reason}</em> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No account activity has been recorded yet.</p>
        )}
      </section>

      <Dialog
        open={roleDialog !== null}
        onClose={() => setRoleDialog(null)}
        title={`Change role for ${roleDialog ? staffDisplayName(roleDialog) : ""}`}
      >
        {roleDialog && (
          <div className="form-stack">
            {roleError && <Notice error>{roleError}</Notice>}
            <p>
              Current role: <strong>{ROLE_LABELS[roleDialog.role] ?? roleDialog.role}</strong>
            </p>
            <Field label="New role" id="staff-role-value">
              <select
                id="staff-role-value"
                value={roleValue}
                disabled={busy}
                onChange={(e) => setRoleValue(e.target.value as AssignableRole)}
              >
                <option value="operational_admin">Operational Admin</option>
                <option value="full_admin">Full Admin</option>
              </select>
            </Field>
            {rolePlan && !rolePlan.ok && (
              <Notice error>{staffErrorMessage(rolePlan.code)}</Notice>
            )}
            <TextField
              id="staff-role-reason"
              label="Reason (recorded in the audit log)"
              value={roleReason}
              maxLength={200}
              help="Required: at least 3 characters."
              onChange={(e) => setRoleReason(e.target.value)}
            />
            {roleValue === "full_admin" && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={roleConfirmed}
                  disabled={busy}
                  onChange={(e) => setRoleConfirmed(e.target.checked)}
                />
                I confirm this account should receive full administrative access to
                every console module.
              </label>
            )}
            <div className="actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setRoleDialog(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void confirmRoleChange()}
                disabled={
                  busy ||
                  (roleValue === "full_admin" && !roleConfirmed) ||
                  (rolePlan ? !rolePlan.ok : false)
                }
              >
                {busy ? "Applying…" : "Change Role"}
              </button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={statusDialog !== null}
        onClose={() => setStatusDialog(null)}
        title={
          !statusDialog
            ? "Account status"
            : statusDialog.disabled
              ? `Disable ${staffDisplayName(statusDialog.member)}?`
              : `Restore ${staffDisplayName(statusDialog.member)}?`
        }
      >
        {statusDialog && (
          <div className="form-stack">
            {statusError && <Notice error>{statusError}</Notice>}
            <p>
              {statusDialog.disabled
                ? "Disabling keeps the profile and its history but removes all access: their next verified request is rejected. Existing Supabase sessions are not revoked at the provider, so sign that account out separately if you need to end them immediately."
                : "Restoring clears the disabled state and returns the account to its existing role. No new role is assigned."}
            </p>
            {statusPlan && !statusPlan.ok && (
              <Notice error>{staffErrorMessage(statusPlan.code)}</Notice>
            )}
            <TextField
              id="staff-status-reason"
              label="Reason (recorded in the audit log)"
              value={statusReason}
              maxLength={200}
              help="Required: at least 3 characters."
              onChange={(e) => setStatusReason(e.target.value)}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={statusConfirmed}
                disabled={busy}
                onChange={(e) => setStatusConfirmed(e.target.checked)}
              />
              {statusDialog.disabled
                ? "I understand this account will lose access until it is restored."
                : "I confirm this account should regain access with its existing role."}
            </label>
            <div className="actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setStatusDialog(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`button ${statusDialog.disabled ? "danger" : ""}`}
                onClick={() => void confirmStatusChange()}
                disabled={busy || !statusConfirmed || (statusPlan ? !statusPlan.ok : false)}
              >
                {busy
                  ? "Applying…"
                  : statusDialog.disabled
                    ? "Disable Account"
                    : "Restore Account"}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
