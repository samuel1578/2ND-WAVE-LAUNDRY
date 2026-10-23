"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Pencil, RefreshCw, Trash2, Users } from "lucide-react";
import { Notice, TextField } from "@/components/forms/controls";
import { Skeleton } from "@/components/ui";
import {
  addBookingAlertRecipientAction,
  removeBookingAlertRecipientAction,
  updateBookingAlertRecipientAction,
} from "@/lib/email/recipient-actions";
import {
  MAX_ENABLED_BOOKING_ALERT_RECIPIENTS,
  validateBookingAlertRecipientEmail,
  type BookingAlertRecipient,
} from "@/lib/email/recipient-rules";

/**
 * Order alert recipients (Phase 2E.2). Full Admin only.
 *
 * The section lives inside the existing `/admin/settings` page rather than a new
 * route, and every change is a server action that re-authorises the verified
 * session and `settings.manage` capability. The browser never supplies an actor,
 * never holds an elevated key and never talks to Brevo.
 *
 * Changes apply to subsequent notifications only: the outbox copies addresses at
 * enqueue time, so the list is not retroactive.
 */

type ListPayload = {
  recipients: BookingAlertRecipient[];
  maxEnabled: number;
};

export function BookingAlertRecipients({ live }: { live: boolean }) {
  const [recipients, setRecipients] = useState<BookingAlertRecipient[] | null>(
    null,
  );
  const [maxEnabled, setMaxEnabled] = useState(
    MAX_ENABLED_BOOKING_ALERT_RECIPIENTS,
  );
  const [loading, setLoading] = useState(live);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editError, setEditError] = useState("");

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setLoadError("");
    try {
      const response = await fetch("/api/admin/booking-alert-recipients", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("unavailable");
      const payload = (await response.json()) as ListPayload;
      setRecipients(payload.recipients);
      if (Number.isFinite(payload.maxEnabled) && payload.maxEnabled > 0)
        setMaxEnabled(payload.maxEnabled);
    } catch {
      setRecipients(null);
      setLoadError(
        "The alert recipient list could not be loaded. Reload the page or try again.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (live) void load("initial");
  }, [live, load]);

  if (!live)
    return (
      <section className="panel form-stack">
        <h2>
          <Users size={20} aria-hidden="true" /> Order alert recipients
        </h2>
        <p>
          Sign in as a Full Admin to manage the central list of addresses that
          receive staff order alerts.
        </p>
        <p className="demo-caption">
          Demo mode never stores alert recipients and never sends staff emails.
        </p>
      </section>
    );

  // The database cap counts enabled rows only, so a paused row must not consume
  // the administrator's remaining allowance.
  const enabledCount = recipients?.filter((recipient) => recipient.enabled).length ?? 0;
  const atLimit = enabledCount >= maxEnabled;

  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFeedback(null);

    const validated = validateBookingAlertRecipientEmail(email);
    if (!validated.ok) {
      setEmailError(validated.message);
      return;
    }
    setEmailError("");
    setBusy(true);
    try {
      const result = await addBookingAlertRecipientAction({
        email: validated.email,
      });
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.message });
        return;
      }
      setEmail("");
      setFeedback({ kind: "success", message: result.message });
      await load("refresh");
    } catch {
      setFeedback({
        kind: "error",
        message: "The recipient could not be saved. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(recipient: BookingAlertRecipient) {
    setEditingId(recipient.id);
    setEditEmail(recipient.email);
    setEditError("");
    setFeedback(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditEmail("");
    setEditError("");
  }

  async function saveEdit(
    event: FormEvent,
    recipient: BookingAlertRecipient,
  ) {
    event.preventDefault();
    if (busy) return;

    const validated = validateBookingAlertRecipientEmail(editEmail);
    if (!validated.ok) {
      setEditError(validated.message);
      return;
    }
    if (validated.email === recipient.email) {
      cancelEdit();
      return;
    }

    setEditError("");
    setBusy(true);
    try {
      const result = await updateBookingAlertRecipientAction({
        id: recipient.id,
        email: validated.email,
        expectedVersion: recipient.version,
      });
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.message });
        if (result.code === "conflict" || result.code === "not_found") {
          cancelEdit();
          await load("refresh");
        }
        return;
      }
      cancelEdit();
      setFeedback({ kind: "success", message: result.message });
      await load("refresh");
    } catch {
      setFeedback({
        kind: "error",
        message: "The address could not be updated. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(recipient: BookingAlertRecipient) {
    if (busy) return;
    if (
      !window.confirm(
        `Remove ${recipient.email} from order alert recipients? It will not receive future staff alerts.`,
      )
    )
      return;

    setFeedback(null);
    setBusy(true);
    try {
      const result = await removeBookingAlertRecipientAction({
        id: recipient.id,
      });
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.message });
        return;
      }
      if (editingId === recipient.id) cancelEdit();
      setFeedback({ kind: "success", message: result.message });
      await load("refresh");
    } catch {
      setFeedback({
        kind: "error",
        message: "The recipient could not be removed. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel form-stack">
      <div className="section-title">
        <h2>
          <Users size={20} aria-hidden="true" /> Order alert recipients
        </h2>
        <button
          type="button"
          className="text-link"
          onClick={() => void load("refresh")}
          disabled={refreshing || busy}
        >
          {refreshing ? (
            <>
              <LoaderCircle size={16} className="spin" aria-hidden="true" />{" "}
              Refreshing…
            </>
          ) : (
            <>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </>
          )}
        </button>
      </div>

      <p>
        Every pending, processing, ready, completed and cancelled order alert is
        sent to every address on this list. This is one central list for the whole
        application; there are no per-order recipients.
      </p>
      <p className="demo-caption">
        Changes apply to subsequent alerts only. Notifications already queued or
        sent are never resent. Each address receives its own copy, so recipients do
        not see one another&apos;s addresses.
      </p>

      {feedback && (
        <Notice
          error={feedback.kind === "error"}
          success={feedback.kind === "success"}
        >
          {feedback.message}
        </Notice>
      )}
      {loadError && (
        <Notice error>
          {loadError}{" "}
          <button
            type="button"
            className="text-link"
            onClick={() => void load("initial")}
          >
            Reload
          </button>
        </Notice>
      )}

      {loading ? (
        <Skeleton count={2} />
      ) : recipients ? (
        recipients.length === 0 ? (
          <Notice>
            No alert recipients are configured. Staff order alerts will not be
            sent until at least one address is added.
          </Notice>
        ) : (
          <div className="table-wrap">
            <table aria-busy={busy}>
              <caption className="sr-only">
                Order alert recipients and their available actions
              </caption>
              <thead>
                <tr>
                  <th scope="col">Email address</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((recipient) =>
                  editingId === recipient.id ? (
                    <tr key={recipient.id}>
                      <td colSpan={2}>
                        <form
                          className="form-grid"
                          onSubmit={(event) => void saveEdit(event, recipient)}
                          noValidate
                        >
                          <TextField
                            id={`alert-recipient-edit-${recipient.id}`}
                            label="Email address"
                            type="email"
                            required
                            autoComplete="off"
                            value={editEmail}
                            error={editError}
                            disabled={busy}
                            onChange={(event) => setEditEmail(event.target.value)}
                          />
                          <div className="full-span actions">
                            <button
                              type="submit"
                              className="button"
                              disabled={busy}
                            >
                              Save address
                            </button>
                            <button
                              type="button"
                              className="button secondary"
                              disabled={busy}
                              onClick={cancelEdit}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={recipient.id}>
                      <td>
                        <strong>{recipient.email}</strong>
                        {(recipient.label || !recipient.enabled) && (
                          <span className="demo-caption">
                            {" "}
                            · {recipient.label}
                            {recipient.label && !recipient.enabled ? " " : ""}
                            {!recipient.enabled ? "(paused)" : ""}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="actions">
                          <button
                            type="button"
                            className="text-link"
                            disabled={busy || editingId !== null}
                            onClick={() => startEdit(recipient)}
                          >
                            <Pencil size={16} aria-hidden="true" /> Edit
                          </button>
                          <button
                            type="button"
                            className="text-link"
                            disabled={busy}
                            onClick={() => void remove(recipient)}
                          >
                            <Trash2 size={16} aria-hidden="true" /> Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      <form className="form-grid" onSubmit={(event) => void add(event)} noValidate>
        <TextField
          id="alert-recipient-email"
          label="Add an email address"
          type="email"
          required
          autoComplete="off"
          value={email}
          error={emailError}
          disabled={busy || atLimit}
          help={`All five order alerts go to every enabled address here. ${enabledCount} of ${maxEnabled} used.`}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div className="full-span actions">
          <button
            type="submit"
            className="button"
            disabled={busy || atLimit || loading}
          >
            {busy ? (
              <>
                <LoaderCircle size={18} className="spin" aria-hidden="true" />{" "}
                Saving…
              </>
            ) : (
              "Add recipient"
            )}
          </button>
        </div>
      </form>

      {atLimit && (
        <p className="demo-caption">
          The maximum of {maxEnabled} recipients has been reached. Remove an
          address before adding another.
        </p>
      )}
    </section>
  );
}
