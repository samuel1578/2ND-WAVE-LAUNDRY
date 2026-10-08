import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDotGrid,
  parseColor,
  pulse,
} from "../src/lib/dotted-glow";

test("parses six digit hex with full opacity", () =>
  assert.deepEqual(parseColor("#00609a"), { r: 0, g: 96, b: 154, a: 1 }));

test("parses three digit hex by doubling digits", () =>
  assert.deepEqual(parseColor("#f00"), { r: 255, g: 0, b: 0, a: 1 }));

test("parses eight digit hex alpha", () => {
  const parsed = parseColor("#ff000080");
  assert.ok(parsed);
  assert.equal(parsed.r, 255);
  assert.equal(parsed.g, 0);
  assert.equal(parsed.b, 0);
  assert.ok(Math.abs(parsed.a - 0.502) < 0.001);
});

test("parses rgba() with decimal alpha", () =>
  assert.deepEqual(parseColor("rgba(0, 96, 154, 0.7)"), {
    r: 0,
    g: 96,
    b: 154,
    a: 0.7,
  }));

test("parses modern slash syntax and percentages", () =>
  assert.deepEqual(parseColor("rgb(100% 0% 50% / 50%)"), {
    r: 255,
    g: 0,
    b: 127.5,
    a: 0.5,
  }));

test("parses rgb() without alpha as opaque", () =>
  assert.deepEqual(parseColor("rgb(0, 96, 154)"), {
    r: 0,
    g: 96,
    b: 154,
    a: 1,
  }));

test("rejects unresolvable and invalid colors", () => {
  assert.equal(parseColor("var(--primary)"), null);
  assert.equal(parseColor("not-a-color"), null);
  assert.equal(parseColor("rgb(1, 2)"), null);
});

test("grid covers the container with one extra ring on each side", () => {
  const grid = buildDotGrid(100, 100, 10, 0.4, 1.3);
  assert.equal(grid.count, 169);
  assert.equal(grid.positions.length, 169 * 3);
  assert.equal(grid.phases.length, 169);
  assert.equal(grid.speeds.length, 169);
});

test("alternate rows are offset by half a gap", () => {
  const grid = buildDotGrid(100, 100, 10, 0.4, 1.3);
  assert.deepEqual(
    [grid.positions[0], grid.positions[1]],
    [-5, -10],
    "i=-1, j=-1 is offset",
  );
  assert.deepEqual(
    [grid.positions[3], grid.positions[4]],
    [-10, 0],
    "i=-1, j=0 is not offset",
  );
  assert.deepEqual(
    [grid.positions[6], grid.positions[7]],
    [-5, 10],
    "i=-1, j=1 is offset",
  );
});

test("speeds stay inside the configured range", () => {
  const grid = buildDotGrid(60, 60, 12, 0.4, 1.3);
  for (const speed of grid.speeds) {
    assert.ok(speed >= 0.4 && speed <= 1.3);
  }
});

test("phases stay inside one full turn", () => {
  const grid = buildDotGrid(60, 60, 12, 0.4, 1.3);
  for (const phase of grid.phases) {
    assert.ok(phase >= 0 && phase < Math.PI * 2);
  }
});

const closeTo = (
  actual: { alpha: number; glow: number },
  alpha: number,
  glow: number,
) => {
  assert.ok(
    Math.abs(actual.alpha - alpha) < 1e-9,
    `alpha ${actual.alpha} is not ${alpha}`,
  );
  assert.ok(
    Math.abs(actual.glow - glow) < 1e-9,
    `glow ${actual.glow} is not ${glow}`,
  );
};

test("pulse climbs from dim to bright across the first half of the wave", () => {
  closeTo(pulse(0, 0, 0), 0.25, 0);
  closeTo(pulse(0.5, 0, 1), 0.525, 0);
  closeTo(pulse(1, 0, 1), 0.8, 0.5);
});

test("pulse falls back down across the second half of the wave", () => {
  closeTo(pulse(1.5, 0, 1), 0.525, 0);
  closeTo(pulse(1.9, 0, 1), 0.305, 0);
});
