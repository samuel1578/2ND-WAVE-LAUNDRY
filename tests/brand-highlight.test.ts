import test from "node:test";
import assert from "node:assert/strict";
import {
  brandHighlights,
  createHighlightPattern,
  splitHighlighted,
} from "../src/lib/brand-highlight";

const roundTrip = (parts: ReturnType<typeof splitHighlighted>) =>
  parts.map((part) => part.text).join("");

test("longest keyword wins so the full company name glows whole", () => {
  const parts = splitHighlighted("Contact 2nd Wave Laundry Services today.");
  assert.deepEqual(
    parts.filter((part) => part.match).map((part) => part.text),
    ["2nd Wave Laundry Services"],
  );
});

test("shorter form still matches on its own", () => {
  const parts = splitHighlighted("Proudly served by 2nd Wave since day one.");
  assert.deepEqual(
    parts.filter((part) => part.match).map((part) => part.text),
    ["2nd Wave"],
  );
});

test("matching is case-insensitive", () => {
  const parts = splitHighlighted("2ND WAVE LAUNDRY SERVICES is here");
  assert.equal(parts[0].match, true);
  assert.equal(parts[0].text, "2ND WAVE LAUNDRY SERVICES");
});

test("possessive keeps the glow on the brand name only", () => {
  const parts = splitHighlighted("2nd Wave's team arrived early");
  assert.deepEqual(parts, [
    { text: "2nd Wave", match: true },
    { text: "'s team arrived early", match: false },
  ]);
});

test("typographic apostrophe form still matches the brand name", () => {
  const parts = splitHighlighted("2nd Wave’s fleet");
  assert.deepEqual(parts, [
    { text: "2nd Wave", match: true },
    { text: "’s fleet", match: false },
  ]);
});

test("plain text is untouched", () => {
  assert.deepEqual(splitHighlighted("Same-day service"), [
    { text: "Same-day service", match: false },
  ]);
  assert.deepEqual(splitHighlighted(""), []);
});

test("split preserves the original string exactly", () => {
  const samples = [
    "About 2nd Wave Laundry Services",
    "2nd Wave and 2ND WAVE and nothing else",
    "2nd Wave's 2nd Wave Laundry Services 2nd Wave",
  ];
  for (const sample of samples)
    assert.equal(roundTrip(splitHighlighted(sample)), sample);
});

test("pattern is built longest-first and regex-escaped", () => {
  const pattern = createHighlightPattern(["a.b", "a.b.c"]);
  const found = "a.b.c and a.b".match(pattern);
  assert.deepEqual(found, ["a.b.c", "a.b"]);
  assert.equal(createHighlightPattern(["("]).test("("), true);
});

test("keyword list ships spaced forms, longest first", () => {
  const sorted = [...brandHighlights].sort((a, b) => b.length - a.length);
  assert.deepEqual([...brandHighlights], sorted);
  assert.ok(brandHighlights.includes("2nd Wave"));
});
