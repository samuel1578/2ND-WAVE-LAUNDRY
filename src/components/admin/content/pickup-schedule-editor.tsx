"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Dialog } from "@/components/dialog";
import { Notice, Submit, TextField } from "@/components/forms/controls";
import type { BranchPickupSchedule, PickupException, PickupWindowDay } from "@/lib/contracts";
import { accraDate } from "@/lib/bookings/scheduling";
import {
  PICKUP_EXCEPTION_REASON_MAX,
  PICKUP_TIME_STEP_SECONDS,
  WEEKDAY_LABELS,
  narrowerThanGlobal,
  pickupExceptionErrors,
  pickupWindowErrors,
} from "@/lib/website/pickup-schedule";
import {
  deleteLiveBranchPickupException,
  saveLiveBranchPickupException,
  saveLiveBranchPickupWindows,
} from "@/lib/website/actions";
import styles from "./content.module.css";

/**
 * Locations editor: the branch pickup schedule (Full Admin, `content.manage`).
 *
 * Weekly windows and date-specific closures / special hours share the branch's
 * optimistic version with the branch details form, so every successful save
 * reports the new version upward (`onVersionChange`). A version conflict offers
 * "Reload latest details" (`onReload`).
 */

type FormNotice = { kind: "success" | "error"; text: string; conflict?: boolean };

type ExceptionDraft = {
  date: string;
  isClosed: boolean;
  opens: string;
  closes: string;
  reason: string;
};

const sortByDate = (items: PickupException[]) =>
  [...items].sort((a, b) => a.date.localeCompare(b.date));

function formatDate(date: string): string {
  const instant = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(instant.getTime())
    ? date
    : instant.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Africa/Accra",
      });
}

export function PickupScheduleEditor({
  branchId,
  version,
  schedule,
  onVersionChange,
  onDirtyChange,
  onReload,
}: {
  branchId: string;
  version: number;
  schedule: BranchPickupSchedule;
  onVersionChange: (version: number) => void;
  onDirtyChange: (dirty: boolean) => void;
  onReload: () => void;
}) {
  const today = accraDate(new Date());
  const global = schedule.globalWindow;

  /* ---- Weekly windows --------------------------------------------------- */
  const [windows, setWindows] = useState<PickupWindowDay[]>(() => structuredClone(schedule.windows));
  const [savedWindows, setSavedWindows] = useState(() => JSON.stringify(schedule.windows));
  const [windowErrors, setWindowErrors] = useState<Record<number, string>>({});
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const [weeklyNotice, setWeeklyNotice] = useState<FormNotice | null>(null);
  const weeklyDirty = JSON.stringify(windows) !== savedWindows;
  const narrowDays = useMemo(() => narrowerThanGlobal(windows, global), [windows, global]);

  function changeDay(weekday: number, patch: Partial<PickupWindowDay>) {
    setWindows((current) =>
      current.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)),
    );
    setWeeklyNotice(null);
    setWindowErrors((current) => {
      const next = { ...current };
      delete next[weekday];
      return next;
    });
  }

  async function saveWeekly(event: FormEvent) {
    event.preventDefault();
    if (weeklyBusy) return;
    const errors = pickupWindowErrors(windows);
    setWindowErrors(errors);
    if (Object.keys(errors).length) {
      setWeeklyNotice({ kind: "error", text: "Fix the highlighted days before saving." });
      return;
    }
    setWeeklyBusy(true);
    setWeeklyNotice(null);
    try {
      const result = await saveLiveBranchPickupWindows(branchId, version, windows);
      if (result.ok) {
        setWindows(result.windows);
        setSavedWindows(JSON.stringify(result.windows));
        onVersionChange(result.version);
        setWeeklyNotice({ kind: "success", text: "Pickup schedule saved." });
      } else {
        setWeeklyNotice({ kind: "error", text: result.message, conflict: result.code === "conflict" });
      }
    } catch {
      setWeeklyNotice({ kind: "error", text: "The pickup schedule could not be saved. Reload and try again." });
    } finally {
      setWeeklyBusy(false);
    }
  }

  /* ---- Closures and special hours --------------------------------------- */
  const [exceptions, setExceptions] = useState<PickupException[]>(() => sortByDate(schedule.exceptions));
  const [draft, setDraft] = useState<ExceptionDraft | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [draftErrors, setDraftErrors] = useState<Partial<Record<"date" | "hours" | "reason", string>>>({});
  const [exceptionBusy, setExceptionBusy] = useState(false);
  const [exceptionNotice, setExceptionNotice] = useState<FormNotice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PickupException | null>(null);

  useEffect(() => {
    onDirtyChange(weeklyDirty || draft !== null);
  }, [weeklyDirty, draft, onDirtyChange]);

  function openAdd() {
    setEditingDate(null);
    setDraft({ date: today, isClosed: true, opens: global.start, closes: global.end, reason: "" });
    setDraftErrors({});
    setExceptionNotice(null);
  }

  function openEdit(item: PickupException) {
    setEditingDate(item.date);
    setDraft({
      date: item.date,
      isClosed: item.isClosed,
      opens: item.opens ?? global.start,
      closes: item.closes ?? global.end,
      reason: item.reason,
    });
    setDraftErrors({});
    setExceptionNotice(null);
  }

  function closeDraft() {
    setDraft(null);
    setEditingDate(null);
    setDraftErrors({});
  }

  async function saveException(event: FormEvent) {
    event.preventDefault();
    if (!draft || exceptionBusy) return;
    const candidate: PickupException = {
      date: draft.date,
      isClosed: draft.isClosed,
      opens: draft.isClosed ? null : draft.opens,
      closes: draft.isClosed ? null : draft.closes,
      reason: draft.reason,
    };
    const errors = pickupExceptionErrors(candidate, today);
    setDraftErrors(errors);
    if (Object.keys(errors).length) return;
    setExceptionBusy(true);
    setExceptionNotice(null);
    try {
      const result = await saveLiveBranchPickupException(branchId, version, candidate);
      if (result.ok) {
        setExceptions((current) =>
          sortByDate([...current.filter((item) => item.date !== result.exception.date), result.exception]),
        );
        onVersionChange(result.version);
        closeDraft();
        setExceptionNotice({ kind: "success", text: "Closure or special hours saved." });
      } else {
        setExceptionNotice({ kind: "error", text: result.message, conflict: result.code === "conflict" });
      }
    } catch {
      setExceptionNotice({ kind: "error", text: "The entry could not be saved. Reload and try again." });
    } finally {
      setExceptionBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || exceptionBusy) return;
    setExceptionBusy(true);
    setExceptionNotice(null);
    try {
      const result = await deleteLiveBranchPickupException(branchId, version, deleteTarget.date);
      if (result.ok) {
        setExceptions((current) => current.filter((item) => item.date !== deleteTarget.date));
        onVersionChange(result.version);
        setExceptionNotice({ kind: "success", text: "Entry deleted." });
      } else {
        setExceptionNotice({ kind: "error", text: result.message, conflict: result.code === "conflict" });
      }
    } catch {
      setExceptionNotice({ kind: "error", text: "The entry could not be deleted. Reload and try again." });
    } finally {
      setExceptionBusy(false);
      setDeleteTarget(null);
    }
  }

  const noticeView = (notice: FormNotice | null) =>
    notice && (
      <Notice error={notice.kind === "error"} success={notice.kind === "success"}>
        {notice.text}
        {notice.conflict && (
          <button type="button" className="text-link" onClick={onReload}>
            Reload latest details
          </button>
        )}
      </Notice>
    );

  return (
    <div className="stack section">
      <section className="panel form-stack" aria-labelledby="pickup-schedule-heading">
        <h2 id="pickup-schedule-heading">Pickup schedule</h2>
        <p className={styles.inlineNote}>
          Customers choose a preferred time within the global pickup hours in Settings ({global.start}–
          {global.end}). This branch&apos;s schedule is enforced when staff record the agreed pickup
          and confirm a booking (Africa/Accra).
        </p>
        {narrowDays.length > 0 && (
          <Notice>
            {narrowDays.map((weekday) => WEEKDAY_LABELS[weekday]).join(", ")}:{" "}
            {narrowDays.length === 1 ? "this window is" : "these windows are"} narrower than the global
            pickup hours ({global.start}–{global.end}). Customers can request times this branch will not
            accept at confirmation.
          </Notice>
        )}
        {noticeView(weeklyNotice)}
        <form className="form-stack" noValidate onSubmit={saveWeekly}>
          <div className={styles.scheduleGrid}>
            {windows.map((day) => {
              const label = WEEKDAY_LABELS[day.weekday];
              const error = windowErrors[day.weekday];
              return (
                <fieldset className={styles.scheduleRow} key={day.weekday} aria-invalid={!!error}>
                  <legend className="sr-only">{label} pickup hours</legend>
                  <strong className={styles.scheduleDay} aria-hidden="true">
                    {label}
                  </strong>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={day.isClosed}
                      disabled={weeklyBusy}
                      onChange={(event) => changeDay(day.weekday, { isClosed: event.target.checked })}
                    />
                    Closed
                  </label>
                  <TextField
                    id={`pickup-${day.weekday}-opens`}
                    label="Opens"
                    type="time"
                    step={PICKUP_TIME_STEP_SECONDS}
                    value={day.opens}
                    disabled={weeklyBusy || day.isClosed}
                    error={error}
                    onChange={(event) => changeDay(day.weekday, { opens: event.target.value })}
                  />
                  <TextField
                    id={`pickup-${day.weekday}-closes`}
                    label="Closes"
                    type="time"
                    step={PICKUP_TIME_STEP_SECONDS}
                    value={day.closes}
                    disabled={weeklyBusy || day.isClosed}
                    onChange={(event) => changeDay(day.weekday, { closes: event.target.value })}
                  />
                </fieldset>
              );
            })}
          </div>
          <div className={styles.cardActions}>
            <Submit busy={weeklyBusy} disabled={!weeklyDirty} label="Save Pickup Schedule" />
          </div>
        </form>
      </section>

      <section className="panel form-stack" aria-labelledby="pickup-exceptions-heading">
        <h2 id="pickup-exceptions-heading">Closures &amp; special hours</h2>
        <p className={styles.inlineNote}>
          An entry for a date replaces this branch&apos;s weekly pickup hours on that date only.
        </p>
        {noticeView(exceptionNotice)}
        {exceptions.length ? (
          <div className={styles.detailRows}>
            {exceptions.map((item) => (
              <div className={styles.exceptionRow} key={item.date}>
                <div>
                  <strong>{formatDate(item.date)}</strong>
                  <span className={styles.inlineNote}>
                    {" "}
                    · {item.isClosed ? "Closed" : `${item.opens}–${item.closes}`}
                    {item.reason ? ` · ${item.reason}` : ""}
                  </span>
                </div>
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={exceptionBusy}
                    onClick={() => openEdit(item)}
                  >
                    Edit<span className="sr-only"> {formatDate(item.date)}</span>
                  </button>
                  <button
                    type="button"
                    className="button danger small"
                    disabled={exceptionBusy}
                    onClick={() => setDeleteTarget(item)}
                  >
                    Delete<span className="sr-only"> {formatDate(item.date)}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p>No closures or special hours scheduled.</p>
        )}
        {schedule.pastExceptionCount > 0 && (
          <p className={styles.inlineNote}>
            {schedule.pastExceptionCount} past {schedule.pastExceptionCount === 1 ? "entry" : "entries"} hidden.
          </p>
        )}

        {draft ? (
          <form className="form-stack" noValidate onSubmit={saveException}>
            <h3>{editingDate ? `Edit ${formatDate(editingDate)}` : "Add closure or special hours"}</h3>
            <TextField
              id="pickup-exception-date"
              label="Date"
              type="date"
              min={today}
              value={draft.date}
              disabled={exceptionBusy || editingDate !== null}
              error={draftErrors.date}
              help={editingDate ? "To change the date, delete this entry and add a new one." : undefined}
              onChange={(event) => setDraft({ ...draft, date: event.target.value })}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.isClosed}
                disabled={exceptionBusy}
                onChange={(event) => setDraft({ ...draft, isClosed: event.target.checked })}
              />
              Closed all day
            </label>
            {!draft.isClosed && (
              <div className={styles.twoColumnGrid}>
                <TextField
                  id="pickup-exception-opens"
                  label="Opens"
                  type="time"
                  step={PICKUP_TIME_STEP_SECONDS}
                  value={draft.opens}
                  disabled={exceptionBusy}
                  error={draftErrors.hours}
                  onChange={(event) => setDraft({ ...draft, opens: event.target.value })}
                />
                <TextField
                  id="pickup-exception-closes"
                  label="Closes"
                  type="time"
                  step={PICKUP_TIME_STEP_SECONDS}
                  value={draft.closes}
                  disabled={exceptionBusy}
                  onChange={(event) => setDraft({ ...draft, closes: event.target.value })}
                />
              </div>
            )}
            <TextField
              id="pickup-exception-reason"
              label="Reason"
              value={draft.reason}
              maxLength={PICKUP_EXCEPTION_REASON_MAX}
              disabled={exceptionBusy}
              error={draftErrors.reason}
              help="Optional, for staff (for example a public holiday)."
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
            />
            <div className={styles.cardActions}>
              <Submit busy={exceptionBusy} label="Save Entry" />
              <button type="button" className="button secondary" disabled={exceptionBusy} onClick={closeDraft}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div>
            <button type="button" className="button secondary" disabled={exceptionBusy} onClick={openAdd}>
              Add closure or special hours
            </button>
          </div>
        )}
      </section>

      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete this closure or special hours?"
      >
        <p>
          {deleteTarget ? formatDate(deleteTarget.date) : "This date"} will use this branch&apos;s weekly
          pickup hours again.
        </p>
        <div className="actions">
          <button type="button" className="button secondary" onClick={() => setDeleteTarget(null)}>
            Keep Entry
          </button>
          <button
            type="button"
            className="button danger"
            disabled={exceptionBusy}
            onClick={() => void confirmDelete()}
          >
            Delete Entry
          </button>
        </div>
      </Dialog>
    </div>
  );
}
