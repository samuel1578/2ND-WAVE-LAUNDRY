/**
 * Branch pickup schedule rules shared by the Locations editor, the server
 * actions and the tests. Framework-free: no Supabase or `server-only` import.
 *
 * The database is the authority (supabase/migrations/
 * 20261113180000_branch_pickup_schedule_admin.sql); these checks mirror it so
 * staff get field-level messages before a round trip.
 */

import type { PickupException, PickupWindowDay } from "@/lib/contracts";

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

export const PICKUP_EXCEPTION_REASON_MAX = 200;
/** Time inputs offer 15-minute steps (seconds). */
export const PICKUP_TIME_STEP_SECONDS = 900;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isPickupClock = (value: unknown): value is string =>
  typeof value === "string" && CLOCK.test(value);

const minutes = (clock: string): number => {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
};

/** Field errors keyed by weekday; empty when valid. */
export function pickupWindowErrors(windows: PickupWindowDay[]): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const day of windows) {
    if (!isPickupClock(day.opens) || !isPickupClock(day.closes))
      errors[day.weekday] = "Enter opening and closing times as HH:MM.";
    else if (!day.isClosed && minutes(day.opens) >= minutes(day.closes))
      errors[day.weekday] = "Opening time must be before closing time.";
  }
  return errors;
}

/** Shape check for a full week (exactly the seven ISO weekdays, once each). */
export function isCompleteWeek(windows: unknown): windows is PickupWindowDay[] {
  if (!Array.isArray(windows) || windows.length !== 7) return false;
  const seen = new Set<number>();
  for (const day of windows) {
    if (
      !day ||
      typeof day !== "object" ||
      !Number.isInteger((day as PickupWindowDay).weekday) ||
      (day as PickupWindowDay).weekday < 1 ||
      (day as PickupWindowDay).weekday > 7 ||
      typeof (day as PickupWindowDay).isClosed !== "boolean" ||
      !isPickupClock((day as PickupWindowDay).opens) ||
      !isPickupClock((day as PickupWindowDay).closes)
    )
      return false;
    seen.add((day as PickupWindowDay).weekday);
  }
  return seen.size === 7;
}

/** Field errors for a closure / special-hours entry; empty when valid. */
export function pickupExceptionErrors(
  exception: PickupException,
  todayAccra: string,
): Record<"date" | "hours" | "reason", string> {
  const errors = {} as Record<"date" | "hours" | "reason", string>;
  if (!DATE.test(exception.date)) errors.date = "Choose a date.";
  else if (exception.date < todayAccra) errors.date = "Choose today or a later date.";
  if (!exception.isClosed) {
    if (!isPickupClock(exception.opens) || !isPickupClock(exception.closes))
      errors.hours = "Enter opening and closing times as HH:MM.";
    else if (minutes(exception.opens) >= minutes(exception.closes))
      errors.hours = "Opening time must be before closing time.";
  }
  if (exception.reason.trim().length > PICKUP_EXCEPTION_REASON_MAX)
    errors.reason = `Use ${PICKUP_EXCEPTION_REASON_MAX} characters or fewer.`;
  return errors;
}

/**
 * Open weekdays whose branch window is narrower than the global window. Customers
 * choose times inside the global window, so such days can produce requests the
 * branch cannot confirm as asked. Informational only.
 */
export function narrowerThanGlobal(
  windows: PickupWindowDay[],
  global: { start: string; end: string },
): number[] {
  if (!isPickupClock(global.start) || !isPickupClock(global.end)) return [];
  return windows
    .filter(
      (day) =>
        !day.isClosed &&
        isPickupClock(day.opens) &&
        isPickupClock(day.closes) &&
        (minutes(day.opens) > minutes(global.start) || minutes(day.closes) < minutes(global.end)),
    )
    .map((day) => day.weekday);
}

/** A full week filled from stored rows, using the global window for gaps. */
export function completeWeek(
  rows: PickupWindowDay[],
  global: { start: string; end: string },
): PickupWindowDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map(
    (weekday) =>
      rows.find((row) => row.weekday === weekday) ?? {
        weekday,
        isClosed: false,
        opens: global.start,
        closes: global.end,
      },
  );
}

export type ScheduleWriteCode =
  | "forbidden"
  | "conflict"
  | "invalid"
  | "not_found"
  | "rate_limited"
  | "unavailable";

export const SCHEDULE_WRITE_MESSAGES: Record<ScheduleWriteCode, string> = {
  forbidden: "Your administrator role does not allow this action.",
  conflict:
    "This branch changed while you were editing it. Reload the latest details before saving.",
  invalid: "Some of the schedule details are not valid. Check the highlighted fields.",
  not_found: "That closure or special-hours entry no longer exists. Reload the latest details.",
  rate_limited: "Too many website content writes. Wait before trying again.",
  unavailable: "The pickup schedule could not be saved. Reload and try again.",
};

/** Maps a PostgREST/Postgres error code from the schedule RPCs. */
export function scheduleWriteCode(code: string | null | undefined): ScheduleWriteCode {
  if (code === "40001" || code === "PT409") return "conflict";
  if (code === "42501") return "forbidden";
  if (code === "22023") return "invalid";
  if (code === "P0002") return "not_found";
  return "unavailable";
}
