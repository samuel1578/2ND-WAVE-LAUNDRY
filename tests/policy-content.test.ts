import test from "node:test";
import assert from "node:assert/strict";
import { copy } from "../src/lib/content";

test("policy bodies are supplied for all three pages", () => {
  assert.ok(copy("18", "Privacy preamble").length > 20);
  assert.match(copy("18", "Privacy intro"), /2nd Wave Laundry Services/);
  [1, 2, 3].forEach((n) => {
    assert.ok(copy("18", `Privacy ${n} heading`), `privacy ${n} heading`);
    assert.ok(copy("18", `Privacy ${n} body`).length > 40, `privacy ${n} body`);
  });
  assert.equal(copy("18", "Privacy 4 heading"), "");
  [1, 2, 3].forEach((n) => {
    assert.ok(copy("18", `Terms ${n} heading`), `terms ${n} heading`);
    assert.ok(
      copy("18", `Terms ${n} intro`).length > 20,
      `terms ${n} intro`,
    );
    assert.ok(
      copy("18", `Terms ${n} list`).split("\n").length >= 3,
      `terms ${n} list`,
    );
  });
  assert.equal(copy("18", "Terms 4 heading"), "");
  assert.ok(copy("18", "Care 1 heading"));
  assert.equal(copy("18", "Care 1 list").split("\n").length, 4);
  assert.equal(copy("18", "Care 2 heading"), "");
});
test("policy text preserves the approved figures from the client PDF", () => {
  const all = [
    ...[1, 2, 3].map((n) => copy("18", `Privacy ${n} body`)),
    ...[1, 2, 3].flatMap((n) => [
      copy("18", `Terms ${n} intro`),
      copy("18", `Terms ${n} list`),
    ]),
    copy("18", "Care 1 intro"),
    copy("18", "Care 1 list"),
  ].join(" ");
  [
    "3 hours",
    "48 hours",
    "30 days",
    "10x",
    "7:00 AM",
    "8:00 PM",
    "30 minutes",
    "059 522 4280",
  ].forEach((figure) => {
    assert.ok(all.includes(figure), `missing approved figure: ${figure}`);
  });
});
