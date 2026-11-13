import test from "node:test";
import assert from "node:assert/strict";
import type { PickupWindowDay } from "../src/lib/contracts";
import {
  completeWeek,
  isCompleteWeek,
  narrowerThanGlobal,
  pickupExceptionErrors,
  pickupWindowErrors,
  scheduleWriteCode,
} from "../src/lib/website/pickup-schedule";

const day = (weekday: number, patch: Partial<PickupWindowDay> = {}): PickupWindowDay => ({
  weekday,
  isClosed: false,
  opens: "07:00",
  closes: "17:00",
  ...patch,
});
const week = () => [1, 2, 3, 4, 5, 6, 7].map((weekday) => day(weekday));

test("a complete week has the seven weekdays once each", () => {
  assert.equal(isCompleteWeek(week()), true);
  assert.equal(isCompleteWeek(week().slice(0, 6)), false);
  assert.equal(isCompleteWeek([...week().slice(0, 6), day(1)]), false);
  assert.equal(isCompleteWeek(week().map((d, i) => (i === 0 ? { ...d, opens: "7:00" } : d))), false);
});

test("an open day needs opens before closes; a closed day does not", () => {
  assert.deepEqual(pickupWindowErrors([day(1, { opens: "17:00", closes: "09:00" })]), {
    1: "Opening time must be before closing time.",
  });
  assert.deepEqual(pickupWindowErrors([day(1, { isClosed: true, opens: "17:00", closes: "09:00" })]), {});
});

test("exceptions must be today or later with ordered hours and a short reason", () => {
  const today = "2026-11-13";
  assert.equal(pickupExceptionErrors({ date: "2026-11-12", isClosed: true, opens: null, closes: null, reason: "" }, today).date, "Choose today or a later date.");
  assert.deepEqual(pickupExceptionErrors({ date: today, isClosed: true, opens: null, closes: null, reason: "Holiday" }, today), {});
  assert.ok(pickupExceptionErrors({ date: today, isClosed: false, opens: "12:00", closes: "10:00", reason: "" }, today).hours);
  assert.ok(pickupExceptionErrors({ date: today, isClosed: true, opens: null, closes: null, reason: "x".repeat(201) }, today).reason);
});

test("open days narrower than the global window are flagged", () => {
  const windows = [day(1), day(2, { opens: "08:00" }), day(3, { closes: "16:00" }), day(4, { isClosed: true, opens: "09:00" })];
  assert.deepEqual(narrowerThanGlobal(windows, { start: "07:00", end: "17:00" }), [2, 3]);
});

test("missing weekly rows are filled from the global window", () => {
  const filled = completeWeek([day(3, { isClosed: true })], { start: "06:00", end: "18:00" });
  assert.equal(filled.length, 7);
  assert.equal(filled[2].isClosed, true);
  assert.deepEqual(filled[0], { weekday: 1, isClosed: false, opens: "06:00", closes: "18:00" });
});

test("database error codes map to editor messages", () => {
  assert.equal(scheduleWriteCode("40001"), "conflict");
  assert.equal(scheduleWriteCode("42501"), "forbidden");
  assert.equal(scheduleWriteCode("22023"), "invalid");
  assert.equal(scheduleWriteCode("P0002"), "not_found");
  assert.equal(scheduleWriteCode("XX000"), "unavailable");
});
