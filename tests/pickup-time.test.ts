import test from "node:test";
import assert from "node:assert/strict";
import { formatPickupWindow } from "../src/lib/pickup-time";

test("pickup window omits zero minutes", () => {
    assert.equal(formatPickupWindow("07:00", "17:00"), "7am–5pm");
});

test("pickup window includes non-zero minutes", () => {
    assert.equal(formatPickupWindow("07:30", "17:45"), "7:30am–5:45pm");
});

test("missing or invalid pickup times fall back to the current window", () => {
    assert.equal(formatPickupWindow(), "7am–5pm");
    assert.equal(formatPickupWindow("bad", null), "7am–5pm");
});
