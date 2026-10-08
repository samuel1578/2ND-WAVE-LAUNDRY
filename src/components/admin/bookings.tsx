"use client";
import Link from "next/link";
import { useState } from "react";
import { branches, services } from "@/lib/content";
import { repository, useDemoStore } from "@/lib/mock-store";
import type { Booking } from "@/lib/contracts";
import {
  normalisePhone,
  statuses,
  statusLabel,
  transitions,
  type BookingStatus,
} from "@/lib/rules";
import { Empty, Heading } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import {
  DemoFailure,
  Field,
  Notice,
  Submit,
  TextField,
} from "@/components/forms/controls";
export function Bookings({ id, state }: { id?: string; state?: string }) {
  const store = useDemoStore();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [branch, setBranch] = useState("");
  const [date, setDate] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  if (id) {
    const booking = store.bookings.find((b) => b.id === id);
    return booking ? (
      <BookingDetails key={id} booking={booking} />
    ) : (
      <Empty
        title="Record not found"
        body="This booking may no longer be available."
      >
        <Link className="button" href="/admin/bookings">
          View All Bookings
        </Link>
      </Empty>
    );
  }
  const rows =
    state === "empty"
      ? []
      : store.bookings.filter(
          (b) =>
            (!search ||
              `${b.reference} ${b.input.name} ${b.input.phone}`
                .toLowerCase()
                .includes(search.toLowerCase())) &&
            (!status || b.status === status) &&
            (!branch ||
              (branch === "unassigned"
                ? !b.arrangement.branch
                : b.arrangement.branch === branch)) &&
            (!date || b.input.date === date),
        );
  const statusActions = (b: Booking) =>
    transitions[b.status].filter((s) => s !== "cancelled");
  async function changeStatus(b: Booking, next: BookingStatus) {
    if (next === b.status) return;
    setBusyId(b.id);
    setNotice(null);
    try {
      await repository.updateBooking(b.id, b.version, { status: next });
      setNotice({
        kind: "success",
        text: `Status updated to ${statusLabel(next)}.`,
      });
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }
  async function changeBranch(b: Booking, slug: string) {
    if (slug === b.arrangement.branch) return;
    setBusyId(b.id);
    setNotice(null);
    try {
      await repository.updateBooking(b.id, b.version, {
        arrangement: { ...b.arrangement, branch: slug },
      });
      setNotice({
        kind: "success",
        text: slug
          ? `Branch assigned to ${branches.find((v) => v.slug === slug)?.title}.`
          : "Branch set to Unassigned.",
      });
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }
  return (
    <>
      <Heading title="Bookings" />
      <div className="filter-panel">
        <TextField
          id="search-bookings"
          label="Search bookings"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Field id="status-filter" label="Status">
          <select
            id="status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="branch-filter" label="Assigned branch">
          <select
            id="branch-filter"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">All branches</option>
            <option value="unassigned">Unassigned</option>
            {branches.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.title}
              </option>
            ))}
          </select>
        </Field>
        <TextField
          id="date-filter"
          label="Requested date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <button
        className="text-link"
        onClick={() => {
          setSearch("");
          setStatus("");
          setBranch("");
          setDate("");
        }}
      >
        Clear filters
      </button>
      {notice && (
        <Notice
          error={notice.kind === "error"}
          success={notice.kind === "success"}
        >
          {notice.text}
        </Notice>
      )}
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Reference",
                  "Customer",
                  "Services",
                  "Requested pickup",
                  "Status",
                  "Assigned branch",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/admin/bookings/${b.id}`}>
                      {b.reference} ↗
                    </Link>
                  </td>
                  <td>{b.input.name}</td>
                  <td>
                    {b.input.services
                      .map((s) => services.find((v) => v.slug === s)?.title)
                      .join(", ")}
                  </td>
                  <td>
                    {b.input.date}
                    <small>{b.input.time || "As soon as possible"}</small>
                  </td>
                  <td>
                    {statusActions(b).length ? (
                      <select
                        className={`cell-select ${b.status}`}
                        aria-label={`Status for ${b.reference}`}
                        value={b.status}
                        disabled={busyId === b.id}
                        onChange={(e) =>
                          void changeStatus(
                            b,
                            e.target.value as BookingStatus,
                          )
                        }
                      >
                        <option value={b.status} disabled>
                          {statusLabel(b.status)}
                        </option>
                        {statusActions(b).map((s) => (
                          <option key={s} value={s}>
                            {s === "confirmed"
                              ? "Confirm Booking"
                              : `Mark ${statusLabel(s)}`}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`badge ${b.status}`}>
                        {statusLabel(b.status)}
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      className="cell-select branch"
                      aria-label={`Assigned branch for ${b.reference}`}
                      value={b.arrangement.branch}
                      disabled={busyId === b.id}
                      onChange={(e) => void changeBranch(b, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {branches.map((v) => (
                        <option key={v.slug} value={v.slug}>
                          {v.title}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No bookings match these filters." />
      )}
    </>
  );
}
function BookingDetails({ booking }: { booking: Booking }) {
  const [arrangement, setArrangement] = useState({ ...booking.arrangement });
  const [version, setVersion] = useState(booking.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [cancel, setCancel] = useState(false);
  const [draft, setDraft] = useState(false);
  const [message, setMessage] = useState("");
  const [nextStatus, setNextStatus] = useState<BookingStatus | "">("");
  async function save(status?: BookingStatus, addNote = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const next = await repository.updateBooking(booking.id, version, {
        arrangement,
        status,
        ...(addNote ? { note } : {}),
        reason,
      });
      setVersion(next.version);
      setSuccess(status ? "Booking status updated." : "Changes saved.");
      setCancel(false);
      setNextStatus("");
      if (addNote) setNote("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = booking.input;
  const possible = transitions[booking.status].filter((s) => s !== "cancelled");
  return (
    <>
      <Link className="back-link" href="/admin/bookings">
        ← Bookings
      </Link>
      <Heading title={booking.reference} description={input.name}>
        <span className={`badge ${booking.status}`}>
          {statusLabel(booking.status)}
        </span>
      </Heading>
      {error && (
        <Notice error>
          {error}
          {error.includes("changed while") && (
            <button
              className="text-link"
              onClick={() => {
                setArrangement({ ...booking.arrangement });
                setVersion(booking.version);
                setError("");
              }}
            >
              Reload latest details
            </button>
          )}
        </Notice>
      )}
      {success && <Notice success>{success}</Notice>}
      <div className="admin-columns">
        <div className="stack">
          <section className="panel">
            <h2>Customer details</h2>
            <dl className="review-list">
              <div>
                <dt>Full name</dt>
                <dd>{input.name}</dd>
              </div>
              <div>
                <dt>Phone number</dt>
                <dd>
                  <a href={`tel:${normalisePhone(input.phone)}`}>
                    {input.phone}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Email address</dt>
                <dd>{input.email || "Not provided"}</dd>
              </div>
              <div>
                <dt>Preferred contact method</dt>
                <dd>{input.contactMethod}</dd>
              </div>
            </dl>
          </section>
          <section className="panel">
            <h2>Laundry details</h2>
            <p>
              {input.services
                .map((s) => services.find((v) => v.slug === s)?.title)
                .join(" · ")}
            </p>
            <p>{input.items}</p>
            <p>{input.notes || "No special requests."}</p>
            <h3>Photos</h3>
            {input.photoNames.length ? (
              <>
                <p>{input.photoNames.join(", ")}</p>
                <small>
                  Preview filenames only. Private upload storage is not
                  connected.
                </small>
              </>
            ) : (
              <p>No photos attached.</p>
            )}
          </section>
          <section className="panel">
            <h2>Pickup request</h2>
            <dl className="review-list">
              {Object.entries({
                Address: input.address,
                Landmark: input.landmark || "Not provided",
                Date: input.date,
                "Preferred time": input.time || "As soon as possible",
                Transport: input.transport,
              }).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        <form
          className="panel form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2>Agreed arrangements</h2>
          <p>
            Record the agreed fee, pickup time and contact outcome before
            confirming.
          </p>
          <Field id="assign-branch" label="Assign branch">
            <select
              id="assign-branch"
              value={arrangement.branch}
              onChange={(e) =>
                setArrangement({ ...arrangement, branch: e.target.value })
              }
            >
              <option value="">Unassigned</option>
              {branches.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.title}
                </option>
              ))}
            </select>
          </Field>
          {(
            [
              ["agreedPickup", "Agreed pickup date and time", "datetime-local"],
              ["fee", "Pickup fee (GHS)", "number"],
              ["zeroReason", "Reason for zero fee", "text"],
              ["contactOutcome", "Contact outcome", "text"],
              ["confirmationNotes", "Confirmation notes", "text"],
              ["returnDetails", "Agreed return details", "text"],
            ] as const
          ).map(([key, label, type]) => (
            <TextField
              key={key}
              id={`agreement-${key}`}
              label={label}
              type={type}
              min={type === "number" ? 0 : undefined}
              step={type === "number" ? ".01" : undefined}
              maxLength={2000}
              value={arrangement[key]}
              onChange={(e) =>
                setArrangement({ ...arrangement, [key]: e.target.value })
              }
            />
          ))}
          <Submit busy={busy} />
          {possible.length > 0 && (
            <>
              <Field id="next-status" label="Update Status">
                <select
                  id="next-status"
                  value={nextStatus}
                  onChange={(e) =>
                    setNextStatus(e.target.value as BookingStatus)
                  }
                >
                  <option value="">Select next status</option>
                  {possible.map((s) => (
                    <option value={s} key={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className="button"
                disabled={busy || !nextStatus}
                onClick={() => void save(nextStatus as BookingStatus)}
              >
                {nextStatus === "confirmed"
                  ? "Confirm Booking"
                  : "Update Status"}
              </button>
            </>
          )}
          <DemoFailure />
        </form>
      </div>
      <div className="admin-columns section">
        <section className="panel">
          <h2>Internal notes</h2>
          {booking.notes.map((n, i) => (
            <p className="internal-note" key={i}>
              {n}
            </p>
          ))}
          <Field id="internal-note" label="Add Note">
            <textarea
              id="internal-note"
              value={note}
              maxLength={4000}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <button
            className="button secondary"
            disabled={!note.trim() || busy}
            onClick={() => void save(undefined, true)}
          >
            Add Note
          </button>
        </section>
        <section className="panel">
          <h2>Status history</h2>
          <ol className="history">
            {booking.history.map((h, i) => (
              <li key={i}>
                <strong>{h.text}</strong>
                <time>
                  {new Date(h.at).toLocaleString("en-GB", {
                    timeZone: "Africa/Accra",
                  })}
                </time>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="actions">
        <button
          className="button secondary"
          onClick={() => {
            setMessage(
              `Hello ${input.name}. Your request ${booking.reference} is now marked ${statusLabel(booking.status)}. Please contact us if you have any questions.`,
            );
            setDraft(true);
          }}
        >
          Draft WhatsApp Update
        </button>
        {transitions[booking.status].includes("cancelled") && (
          <button className="button danger" onClick={() => setCancel(true)}>
            Cancel Booking
          </button>
        )}
      </div>
      <Dialog
        open={cancel}
        onClose={() => setCancel(false)}
        title="Cancel Booking"
      >
        <Field id="cancel-reason" label="Reason for cancellation">
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
          />
        </Field>
        <div className="actions">
          <button
            className="button danger"
            disabled={!reason.trim() || busy}
            onClick={() => void save("cancelled")}
          >
            Cancel Booking
          </button>
          <button className="button secondary" onClick={() => setCancel(false)}>
            Keep Booking
          </button>
        </div>
      </Dialog>
      <Dialog
        open={draft}
        onClose={() => setDraft(false)}
        title="Draft WhatsApp Update"
      >
        <p>
          Review this message before opening WhatsApp. You will send it
          manually.
        </p>
        <Field id="admin-message" label="Message">
          <textarea
            id="admin-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
          />
        </Field>
        <div className="actions">
          <a
            className="button whatsapp"
            target="_blank"
            rel="noreferrer"
            href={`https://wa.me/${normalisePhone(input.sameWhatsapp ? input.phone : input.whatsapp).replace("+", "")}?text=${encodeURIComponent(message)}`}
          >
            Open WhatsApp
          </a>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message);
                setSuccess("Message copied");
              } catch {
                setError(
                  "Copy is unavailable. Select the message and copy it manually.",
                );
              }
            }}
          >
            Copy Message
          </button>
        </div>
      </Dialog>
    </>
  );
}
