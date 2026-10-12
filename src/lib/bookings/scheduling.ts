/**
 * Timezone-aware scheduling rules for booking requests.
 *
 * These are pure functions with an explicit `now` so they can be unit tested at
 * exact boundaries. They mirror the trusted database helpers in
 * `supabase/migrations/20261011130200_booking_functions.sql`; the database remains
 * the final authority, and eligibility always uses trusted server time, never the
 * customer's browser clock.
 *
 * Two independent rules live here and must never be conflated:
 *   * the pickup operating window (07:00–17:00, seven days including holidays);
 *   * the express/same-day 11:00 cutoff, which applies only to an express request
 *     for today.
 */

import type { BookingErrorCode } from "./errors";

export const ACCRA_TIME_ZONE = "Africa/Accra";

/** Approved pickup operating window (PRD §5). */
export const DEFAULT_PICKUP_WINDOW = { start: "07:00", end: "17:00" } as const;
/** Approved express/same-day cutoff. */
export const DEFAULT_EXPRESS_CUTOFF = "11:00";
/** Walk-in branch hours, kept separate from pickup (default 07:00–20:00). */
export const DEFAULT_BRANCH_HOURS = { start: "07:00", end: "20:00" } as const;

export type PickupWindow = {
  start: string;
  end: string;
  closed: boolean;
};

export type SchedulingFailure = { code: BookingErrorCode; message: string };

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isValidClock = (value: string): boolean => CLOCK.test(value);

export const isValidDateString = (value: string): boolean => {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** Seconds since local midnight for an `HH:MM` or `HH:MM:SS` clock value. */
export function clockToSeconds(value: string): number {
  const [h, m, s = "0"] = value.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

type AccraParts = { date: string; time: string; seconds: number };

/** Splits an instant into its Africa/Accra calendar date and local clock time. */
export function accraParts(now: Date): AccraParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ACCRA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  const date = `${read("year")}-${read("month")}-${read("day")}`;
  const time = `${read("hour")}:${read("minute")}:${read("second")}`;
  return { date, time, seconds: clockToSeconds(time) };
}

/** Africa/Accra calendar date (`YYYY-MM-DD`) for an instant. */
export const accraDate = (now: Date): string => accraParts(now).date;

/** ISO-8601 weekday (1 = Monday … 7 = Sunday) for an Africa/Accra date. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Validates a requested pickup against the operating window.
 *
 * The window is inclusive at its closing boundary for a requested time, but a
 * same-day request is rejected once the window has closed.
 */
export function pickupWindowError(
  request: { date: string; time: string | null },
  now: Date,
  window: PickupWindow = { ...DEFAULT_PICKUP_WINDOW, closed: false },
): SchedulingFailure | null {
  const local = accraParts(now);
  const today = local.date;

  if (!isValidDateString(request.date) || request.date < today)
    return { code: "pickup_date", message: "Choose a valid pickup date." };

  if (window.closed)
    return {
      code: "pickup_closed",
      message: "Pickup is not available on that date.",
    };

  if (request.time !== null && !isValidClock(request.time))
    return { code: "invalid_time", message: "Choose a valid preferred time." };

  if (request.time !== null && clockToSeconds(request.time) < clockToSeconds(window.start))
    return {
      code: "pickup_window",
      message: `Choose a preferred time between ${window.start} and ${window.end}.`,
    };

  if (request.time !== null && clockToSeconds(request.time) > clockToSeconds(window.end))
    return {
      code: "pickup_window",
      message: `Choose a preferred time between ${window.start} and ${window.end}.`,
    };

  // A specific same-day time that has already passed is rejected, mirroring the
  // database's `BOOKING_PICKUP_TIME_PAST` guard.
  if (
    request.date === today &&
    request.time !== null &&
    clockToSeconds(request.time) < local.seconds
  )
    return {
      code: "pickup_time_past",
      message: "Choose a pickup time that has not already passed today.",
    };

  if (request.date === today && local.seconds >= clockToSeconds(window.end))
    return {
      code: "pickup_closed",
      message: "Pickup hours have ended for today. Choose another date or contact the team.",
    };

  return null;
}

/**
 * Validates express/same-day eligibility, separately from the window.
 *
 * Equality is accepted: a submission at exactly the cutoff is valid.
 */
export function expressEligibilityError(
  request: { date: string; express: boolean },
  now: Date,
  cutoff: string = DEFAULT_EXPRESS_CUTOFF,
): SchedulingFailure | null {
  if (!request.express) return null;
  const local = accraParts(now);
  if (request.date !== local.date) return null;
  if (local.seconds > clockToSeconds(cutoff))
    return {
      code: "express_cutoff",
      message: `Express same-day pickup must be requested by ${cutoff}. Choose another date or contact the team.`,
    };
  return null;
}

/** The first applicable scheduling failure, or `null`. */
export function schedulingFailure(
  request: { date: string; time: string | null; express: boolean },
  now: Date,
  options: { window?: PickupWindow; cutoff?: string } = {},
): SchedulingFailure | null {
  return (
    pickupWindowError(request, now, options.window) ??
    expressEligibilityError(request, now, options.cutoff)
  );
}
