"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
import {
  BOOKING_LIST_PAGE_SIZE,
  accraInputValue,
  accraLocalToIso,
  agreedPickupAtWindowError,
  type AdminBookingDetail,
  type AdminBookingSummary,
  type BranchOption,
} from "@/lib/bookings/admin";
import { allowedTransitions, confirmationFieldErrors } from "@/lib/bookings/lifecycle";
import {
  addBookingNoteAction,
  changeBookingStatus,
  saveBookingArrangement,
  type BookingActionResult,
} from "@/lib/bookings/admin-actions";
import { Empty, Heading, Skeleton } from "@/components/ui";
import { BookingImagePanel } from "@/components/admin/booking-image-panel";
import { Dialog } from "@/components/dialog";
import {
  DemoFailure,
  Field,
  Notice,
  Submit,
  TextField,
} from "@/components/forms/controls";

/**
 * Administrator bookings.
 *
 * Two isolated experiences share this entry point:
 *
 *  - the **demo** workspace (no verified session) renders the in-memory sample
 *    repository exactly as before;
 *  - the **live** workspace (a verified administrator session) reads persisted
 *    Supabase bookings through `/api/admin/bookings` and mutates them through the
 *    guarded server actions. A database failure surfaces as an error state and
 *    never falls back to sample data.
 */
export function Bookings({
  id,
  state,
  demo,
}: {
  id?: string;
  state?: string;
  demo: boolean;
}) {
  return demo ? <DemoBookings id={id} state={state} /> : <LiveBookings id={id} />;
}

/* -------------------------------------------------------------------------- */
/* Demo workspace — isolated, in-memory sample data                            */
/* -------------------------------------------------------------------------- */

function DemoBookings({ id, state }: { id?: string; state?: string }) {
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
      <DemoBookingDetails key={id} booking={booking} />
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

function DemoBookingDetails({ booking }: { booking: Booking }) {
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

/* -------------------------------------------------------------------------- */
/* Live workspace — persisted Supabase bookings                                */
/* -------------------------------------------------------------------------- */

const ACCRA_FORMAT = "en-GB";
const accraDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(ACCRA_FORMAT, { timeZone: "Africa/Accra" })
    : "—";

type BookingListPayload = {
  rows: AdminBookingSummary[];
  total: number;
  page: number;
  pageSize: number;
  branches: BranchOption[];
};

function LiveBookings({ id }: { id?: string }) {
  return id ? <LiveBookingDetail id={id} /> : <LiveBookingList />;
}

function LiveBookingList() {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [branch, setBranch] = useState("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<BookingListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (branch) params.set("branch", branch);
      if (date) params.set("date", date);
      params.set("page", String(page));
      const response = await fetch(`/api/admin/bookings?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setError(
          response.status === 403
            ? "Your administrator role does not include bookings."
            : "Bookings could not be loaded. Reload the page and try again.",
        );
        setPayload(null);
        return;
      }
      const data = (await response.json()) as Partial<BookingListPayload>;
      setPayload({
        rows: data.rows ?? [],
        total: data.total ?? 0,
        page: data.page ?? 1,
        pageSize: data.pageSize ?? BOOKING_LIST_PAGE_SIZE,
        branches: data.branches ?? [],
      });
    } catch {
      setError("Bookings could not be loaded. Reload the page and try again.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [search, status, branch, date, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const branchesLoaded = payload?.branches ?? [];
  const rows = payload?.rows ?? [];
  const total = payload?.total ?? 0;
  const pageSize = payload?.pageSize ?? BOOKING_LIST_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <>
      <Heading
        title="Bookings"
        description="Live requests persisted in the booking database."
      />
      <form
        className="filter-panel"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchDraft.trim());
        }}
      >
        <TextField
          id="search-bookings"
          label="Search bookings"
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
        />
        <Field id="status-filter" label="Status">
          <select
            id="status-filter"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
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
            onChange={(e) => {
              setBranch(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All branches</option>
            <option value="unassigned">Unassigned</option>
            {branchesLoaded.map((b) => (
              <option key={b.id} value={b.id}>
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
          onChange={(e) => {
            setDate(e.target.value);
            setPage(1);
          }}
        />
        <button type="submit" className="button">
          Search
        </button>
      </form>
      <button
        className="text-link"
        onClick={() => {
          setSearchDraft("");
          setSearch("");
          setStatus("");
          setBranch("");
          setDate("");
          setPage(1);
        }}
      >
        Clear filters
      </button>

      {loading ? (
        <Skeleton count={6} />
      ) : error ? (
        <Empty title="Bookings are unavailable" body={error}>
          <button className="button" onClick={() => void load()}>
            Try Again
          </button>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty
          title={
            search || status || branch || date
              ? "No bookings match these filters."
              : "No bookings yet."
          }
        />
      ) : (
        <>
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
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/admin/bookings/${row.id}`}>
                        {row.reference} ↗
                      </Link>
                    </td>
                    <td>
                      {row.customerName}
                      <small>{row.customerPhone}</small>
                    </td>
                    <td>
                      {row.services.map((s) => s.title).join(", ") || "—"}
                    </td>
                    <td>
                      {row.requestedDate}
                      <small>
                        {row.requestedTime || "As soon as possible"}
                        {row.expressRequested ? " · Express" : ""}
                      </small>
                    </td>
                    <td>
                      <span className={`badge ${row.status}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td>
                      {row.assignedBranch ? (
                        row.assignedBranch.title
                      ) : (
                        <span className="muted">Unassigned</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              Showing {rangeStart}–{rangeEnd} of {total}
            </span>
            <div className="actions">
              <button
                className="button secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="muted">
                Page {page} of {totalPages}
              </span>
              <button
                className="button secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

type ArrangementForm = {
  branchId: string;
  agreedPickup: string;
  fee: string;
  zeroReason: string;
  contactOutcome: string;
  confirmationNotes: string;
  returnDetails: string;
};

function arrangementFrom(detail: AdminBookingDetail): ArrangementForm {
  return {
    branchId: detail.assignedBranch?.id ?? "",
    agreedPickup: accraInputValue(detail.agreedPickupAt),
    fee: detail.agreedFee === null ? "" : String(detail.agreedFee),
    zeroReason: detail.zeroFeeReason ?? "",
    contactOutcome: detail.contactOutcome ?? "",
    confirmationNotes: detail.confirmationNote ?? "",
    returnDetails: detail.returnDetails ?? "",
  };
}

function LiveBookingDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<AdminBookingDetail | null>(null);
  const [branchesLoaded, setBranchesLoaded] = useState<BranchOption[]>([]);
  const [form, setForm] = useState<ArrangementForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
    conflict?: boolean;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [nextStatus, setNextStatus] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [cancel, setCancel] = useState(false);
  const [draft, setDraft] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/admin/bookings?id=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        if (response.status === 404) {
          setNotFound(true);
          setDetail(null);
          return;
        }
        if (!response.ok) {
          setError(
            "This booking could not be loaded. Reload the page and try again.",
          );
          setDetail(null);
          return;
        }
        const data = (await response.json()) as {
          booking: AdminBookingDetail;
          branches?: BranchOption[];
        };
        setNotFound(false);
        setDetail(data.booking);
        setBranchesLoaded(data.branches ?? []);
        setForm(arrangementFrom(data.booking));
        setFieldErrors({});
      } catch {
        setError(
          "This booking could not be loaded. Reload the page and try again.",
        );
        setDetail(null);
      } finally {
        if (mode === "initial") setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  function applyFailure(result: Extract<BookingActionResult, { ok: false }>) {
    if (result.fieldErrors) setFieldErrors(result.fieldErrors);
    setNotice({
      kind: "error",
      text: result.message,
      conflict: result.code === "conflict",
    });
  }

  async function saveArrangement(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !form || busy) return;
    setBusy(true);
    setNotice(null);
    setFieldErrors({});

    const agreedPickupAt = form.agreedPickup
      ? accraLocalToIso(form.agreedPickup.slice(0, 10), form.agreedPickup.slice(11, 16))
      : null;
    if (form.agreedPickup && !agreedPickupAt) {
      setFieldErrors({
        agreedPickupAt: "Choose a valid agreed pickup date and time.",
      });
      setBusy(false);
      return;
    }
    if (form.branchId && agreedPickupAt) {
      const windowError = agreedPickupAtWindowError(agreedPickupAt);
      if (windowError) {
        setFieldErrors({ agreedPickupAt: windowError.message });
        setBusy(false);
        return;
      }
    }

    const result = await saveBookingArrangement({
      bookingId: detail.id,
      expectedVersion: detail.version,
      branchId: form.branchId || null,
      agreedPickupAt,
      // Send the raw text so the shared validator parses it; never serialise NaN.
      agreedFee: form.fee.trim() === "" ? null : form.fee,
      zeroFeeReason: form.zeroReason || null,
      serviceCharge: detail.serviceCharge,
      contactOutcome: form.contactOutcome || null,
      confirmationNote: form.confirmationNotes || null,
      returnDetails: form.returnDetails || null,
    });
    if (result.ok) {
      setNotice({ kind: "success", text: result.message });
      await load("refresh");
    } else {
      applyFailure(result);
    }
    setBusy(false);
  }

  async function transition(next: BookingStatus) {
    if (!detail || busy) return;
    if (next === "confirmed") {
      const errors = confirmationFieldErrors({
        branchId: form?.branchId ?? null,
        agreedPickupAt: form?.agreedPickup
          ? accraLocalToIso(
              form.agreedPickup.slice(0, 10),
              form.agreedPickup.slice(11, 16),
            )
          : null,
        agreedFee: form && form.fee.trim() !== "" ? Number(form.fee) : null,
        zeroFeeReason: form?.zeroReason || null,
        contactOutcome: form?.contactOutcome || null,
        confirmationNote: form?.confirmationNotes || null,
      });
      if (Object.keys(errors).length) {
        setFieldErrors(errors);
        setNotice({
          kind: "error",
          text: "Complete the agreed branch, pickup time, fee, contact outcome and confirmation note before confirming.",
        });
        return;
      }
    }
    setBusy(true);
    setNotice(null);
    setFieldErrors({});
    const result = await changeBookingStatus({
      bookingId: detail.id,
      expectedVersion: detail.version,
      next,
      reason: next === "cancelled" ? reason : null,
    });
    if (result.ok) {
      setNotice({ kind: "success", text: result.message });
      setNextStatus("");
      setCancel(false);
      setReason("");
      await load("refresh");
    } else {
      applyFailure(result);
    }
    setBusy(false);
  }

  async function addNote() {
    if (!detail || busy || !note.trim()) return;
    setBusy(true);
    setNotice(null);
    setFieldErrors({});
    const result = await addBookingNoteAction({
      bookingId: detail.id,
      expectedVersion: detail.version,
      body: note,
    });
    if (result.ok) {
      setNote("");
      setNotice({ kind: "success", text: result.message });
      await load("refresh");
    } else {
      applyFailure(result);
    }
    setBusy(false);
  }

  if (loading)
    return (
      <>
        <Heading title="Booking" />
        <Skeleton count={4} />
      </>
    );

  if (notFound)
    return (
      <Empty
        title="Record not found"
        body="This booking may no longer be available."
      >
        <Link className="button" href="/admin/bookings">
          View All Bookings
        </Link>
      </Empty>
    );

  if (error || !detail || !form)
    return (
      <Empty title="Booking is unavailable" body={error || undefined}>
        <button className="button" onClick={() => void load("initial")}>
          Try Again
        </button>
      </Empty>
    );

  const possible = allowedTransitions(detail.status).filter(
    (s) => s !== "cancelled",
  );
  const cancellable = allowedTransitions(detail.status).includes("cancelled");

  return (
    <>
      <Link className="back-link" href="/admin/bookings">
        ← Bookings
      </Link>
      <Heading title={detail.reference} description={detail.customerName}>
        <span className={`badge ${detail.status}`}>
          {statusLabel(detail.status)}
        </span>
      </Heading>
      {notice && (
        <Notice error={notice.kind === "error"} success={notice.kind === "success"}>
          {notice.text}
          {notice.conflict && (
            <button
              className="text-link"
              onClick={() => void load("refresh")}
            >
              Reload latest details
            </button>
          )}
        </Notice>
      )}
      <div className="admin-columns">
        <div className="stack">
          <section className="panel">
            <h2>Customer details</h2>
            <dl className="review-list">
              <div>
                <dt>Full name</dt>
                <dd>{detail.customerName}</dd>
              </div>
              <div>
                <dt>Phone number</dt>
                <dd>
                  <a href={`tel:${normalisePhone(detail.customerPhone)}`}>
                    {detail.customerPhone}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Email address</dt>
                <dd>{detail.customerEmail || "Not provided"}</dd>
              </div>
              <div>
                <dt>WhatsApp</dt>
                <dd>
                  {detail.sameWhatsapp
                    ? detail.customerPhone
                    : detail.whatsappPhone || "Not provided"}
                </dd>
              </div>
              <div>
                <dt>Preferred contact method</dt>
                <dd>{statusLabel(detail.contactMethod)}</dd>
              </div>
            </dl>
          </section>
          <section className="panel">
            <h2>Laundry details</h2>
            <p>
              {detail.services.map((s) => s.title).join(" · ") ||
                "No services recorded."}
            </p>
            <p>
              {statusLabel(detail.itemCategory)} · {detail.loadSize}
              {detail.expressRequested ? " · Express/Same-Day" : ""}
            </p>
            <p>{detail.customerNotes || "No special requests."}</p>
          </section>
          <BookingImagePanel
            bookingId={detail.id}
            photos={detail.photos ?? []}
          />
          <section className="panel">
            <h2>Pickup request</h2>
            <dl className="review-list">
              {Object.entries({
                Address: detail.pickupAddress,
                Landmark: detail.pickupLandmark || "Not provided",
                Date: detail.requestedDate,
                "Preferred time": detail.requestedTime || "As soon as possible",
                Transport: statusLabel(detail.transportPreference),
                "Map link": detail.pickupMapUrl || "Not provided",
              }).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          {detail.cancellationReason && (
            <section className="panel">
              <h2>Cancellation</h2>
              <p>{detail.cancellationReason}</p>
              <small>Cancelled {accraDateTime(detail.cancelledAt)}</small>
            </section>
          )}
        </div>
        <form className="panel form-stack" onSubmit={(e) => void saveArrangement(e)}>
          <h2>Agreed arrangements</h2>
          <p>
            Record the agreed branch, pickup time, fee and contact outcome before
            confirming. The agreed time must fall inside the 07:00–17:00 pickup
            window (Africa/Accra).
          </p>
          <Field id="assign-branch" label="Assign branch">
            <select
              id="assign-branch"
              value={form.branchId}
              disabled={busy}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
            >
              <option value="">Unassigned</option>
              {branchesLoaded.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </Field>
          <TextField
            id="agreement-agreedPickup"
            label="Agreed pickup date and time (Africa/Accra)"
            type="datetime-local"
            value={form.agreedPickup}
            error={fieldErrors.agreedPickupAt}
            disabled={busy}
            onChange={(e) => setForm({ ...form, agreedPickup: e.target.value })}
          />
          <TextField
            id="agreement-fee"
            label="Pickup fee (GHS)"
            type="number"
            min={0}
            step=".01"
            value={form.fee}
            error={fieldErrors.agreedFee}
            disabled={busy}
            onChange={(e) => setForm({ ...form, fee: e.target.value })}
          />
          <TextField
            id="agreement-zeroReason"
            label="Reason for zero fee"
            type="text"
            maxLength={2000}
            value={form.zeroReason}
            error={fieldErrors.zeroFeeReason}
            disabled={busy}
            onChange={(e) => setForm({ ...form, zeroReason: e.target.value })}
          />
          <TextField
            id="agreement-contactOutcome"
            label="Contact outcome"
            type="text"
            maxLength={2000}
            value={form.contactOutcome}
            error={fieldErrors.contactOutcome}
            disabled={busy}
            onChange={(e) =>
              setForm({ ...form, contactOutcome: e.target.value })
            }
          />
          <TextField
            id="agreement-confirmationNotes"
            label="Confirmation note"
            type="text"
            maxLength={2000}
            value={form.confirmationNotes}
            error={fieldErrors.confirmationNote}
            disabled={busy}
            onChange={(e) =>
              setForm({ ...form, confirmationNotes: e.target.value })
            }
          />
          <TextField
            id="agreement-returnDetails"
            label="Agreed return details"
            type="text"
            maxLength={2000}
            value={form.returnDetails}
            disabled={busy}
            onChange={(e) => setForm({ ...form, returnDetails: e.target.value })}
          />
          <Submit busy={busy} label="Save Agreed Arrangements" />
          {possible.length > 0 && (
            <>
              <Field id="next-status" label="Update Status">
                <select
                  id="next-status"
                  value={nextStatus}
                  disabled={busy}
                  onChange={(e) => setNextStatus(e.target.value)}
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
                onClick={() => void transition(nextStatus as BookingStatus)}
              >
                {nextStatus === "confirmed" ? "Confirm Booking" : "Update Status"}
              </button>
            </>
          )}
        </form>
      </div>
      <div className="admin-columns section">
        <section className="panel">
          <h2>Internal notes</h2>
          {detail.notes.length ? (
            detail.notes.map((n) => (
              <p className="internal-note" key={n.id || n.at}>
                {n.body}
                <small>{accraDateTime(n.at)}</small>
              </p>
            ))
          ) : (
            <p>No internal notes yet.</p>
          )}
          <Field id="internal-note" label="Add Note">
            <textarea
              id="internal-note"
              value={note}
              maxLength={4000}
              rows={3}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <button
            type="button"
            className="button secondary"
            disabled={!note.trim() || busy}
            onClick={() => void addNote()}
          >
            Add Note
          </button>
        </section>
        <section className="panel">
          <h2>Status history</h2>
          <ol className="history">
            {detail.history.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <strong>
                  {h.fromStatus
                    ? `${statusLabel(h.fromStatus)} → ${statusLabel(h.toStatus)}`
                    : `Created · ${statusLabel(h.toStatus)}`}
                </strong>
                {h.reason && <span>{h.reason}</span>}
                <time>{accraDateTime(h.at)}</time>
              </li>
            ))}
          </ol>
          {detail.audit.length > 0 && (
            <>
              <h3>Audit trail</h3>
              <ol className="history">
                {detail.audit.map((a, i) => (
                  <li key={`${a.at}-${i}`}>
                    <strong>{statusLabel(a.action.replaceAll(".", " "))}</strong>
                    {a.reason && <span>{a.reason}</span>}
                    <time>{accraDateTime(a.at)}</time>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
      <div className="actions">
        <button
          className="button secondary"
          onClick={() => {
            setMessage(
              `Hello ${detail.customerName}. Your request ${detail.reference} is now marked ${statusLabel(detail.status)}. Please contact us if you have any questions.`,
            );
            setDraft(true);
          }}
        >
          Draft WhatsApp Update
        </button>
        {cancellable && (
          <button
            className="button danger"
            disabled={busy}
            onClick={() => setCancel(true)}
          >
            Cancel Booking
          </button>
        )}
      </div>
      <Dialog
        open={cancel}
        onClose={() => setCancel(false)}
        title="Cancel Booking"
      >
        <Field
          id="cancel-reason"
          label="Reason for cancellation"
          error={fieldErrors.reason}
        >
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
            onClick={() => void transition("cancelled")}
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
            href={`https://wa.me/${normalisePhone(
              detail.sameWhatsapp
                ? detail.customerPhone
                : detail.whatsappPhone || detail.customerPhone,
            ).replace("+", "")}?text=${encodeURIComponent(message)}`}
          >
            Open WhatsApp
          </a>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message);
                setNotice({ kind: "success", text: "Message copied" });
              } catch {
                setNotice({
                  kind: "error",
                  text: "Copy is unavailable. Select the message and copy it manually.",
                });
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
