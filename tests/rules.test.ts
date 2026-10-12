import test from "node:test";
import assert from "node:assert/strict";
import {
  schedulingError,
  uploadError,
  confirmationError,
  transitions,
  validEmail,
  validPhone,
  validMap,
  defaultPickupDate,
  promoActive,
} from "../src/lib/rules";
const day = "2026-10-05";
const at = (time: string) => new Date(`${day}T${time}Z`);
test("ordinary pickup remains eligible after 11am", () =>
  assert.equal(schedulingError(day, "", false, at("14:00:00")), ""));
test("express cutoff accepts exact equality only", () => {
  assert.equal(schedulingError(day, "", true, at("11:00:00")), "");
  assert.match(schedulingError(day, "", true, at("11:00:01")), /cutoff/);
});
test("ordinary cutoff at 17:00", () => {
  assert.equal(schedulingError(day, "", false, at("16:59:59")), "");
  assert.match(schedulingError(day, "", false, at("17:00:00")), /ended/);
});
test("before opening can request today without a time guarantee", () =>
  assert.equal(schedulingError(day, "", false, at("05:00:00")), ""));
test("future express date is not blocked by current cutoff", () =>
  assert.equal(
    schedulingError("2026-10-06", "07:00", true, at("18:00:00")),
    "",
  ));
test("past and malformed dates rejected", () => {
  for (const d of ["2026-10-04", "2026-02-30", "bad"])
    assert.notEqual(schedulingError(d, "", false, at("09:00:00")), "");
});
test("past preferred time rejected", () =>
  assert.notEqual(schedulingError(day, "08:00", false, at("09:00:00")), ""));
test("demo pickup window rejects 06:30 and accepts the 07:00–17:00 boundaries", () => {
  const future = "2026-10-06";
  // The client-reported defect: a 06:30 pickup request must not be accepted.
  assert.notEqual(schedulingError(future, "06:30", false, at("09:00:00")), "");
  assert.equal(schedulingError(future, "07:00", false, at("09:00:00")), "");
  assert.equal(schedulingError(future, "17:00", false, at("09:00:00")), "");
  assert.notEqual(schedulingError(future, "17:30", false, at("09:00:00")), "");
  assert.notEqual(schedulingError(future, "19:00", false, at("09:00:00")), "");
});
test("default advances after pickup closure", () =>
  assert.equal(defaultPickupDate(at("17:00:00")), "2026-10-06"));
test("three decimal 5MB files accepted; fourth and oversize rejected", () => {
  const file = { type: "image/jpeg", size: 5000000 };
  assert.equal(uploadError([file, file, file]), "");
  assert.match(uploadError([file, file, file, file]), /no more/);
  assert.match(uploadError([{ ...file, size: 5000001 }]), /5MB/);
});
test("SVG and HEIC not accepted", () => {
  for (const type of ["image/svg+xml", "image/heic"])
    assert.match(uploadError([{ type, size: 100 }]), /supported/);
});
test("confirmation requires deliberate zero fee reason", () => {
  const a = {
    branch: "ashaiman-atadeka",
    agreedPickup: "2026-10-06T10:00",
    fee: "0",
    zeroReason: "",
    contactOutcome: "Called",
    confirmationNotes: "Agreed",
    returnDetails: "",
  };
  assert.match(confirmationError(a), /zero/);
  assert.equal(
    confirmationError({ ...a, zeroReason: "Recorded agreement" }),
    "",
  );
  assert.notEqual(confirmationError({ ...a, fee: "-1" }), "");
});
test("terminal states cannot transition ordinarily", () => {
  assert.deepEqual(transitions.completed, []);
  assert.deepEqual(transitions.cancelled, []);
  assert.ok(!transitions.pending.includes("completed"));
});
test("maps disallow executable and unrecognised URLs", () => {
  assert.equal(validMap("javascript:alert(1)"), false);
  assert.equal(validMap("https://example.com"), false);
  assert.equal(validMap("https://maps.app.goo.gl/MfrvXSLGNtUu22HL8"), true);
});
test("Ghana and international phone validation", () => {
  assert.equal(validPhone("0595224280"), true);
  assert.equal(validPhone("+442079460018"), true);
  assert.equal(validPhone("123"), false);
});
test("email validation", () => {
  assert.equal(validEmail("test@example.com"), true);
  assert.equal(validEmail("not-email"), false);
});
test("promotion expires at exclusive boundary", () => {
  assert.equal(
    promoActive(
      true,
      "2026-10-01",
      "2026-10-31",
      new Date("2026-10-30T23:59:59Z"),
    ),
    true,
  );
  assert.equal(
    promoActive(
      true,
      "2026-10-01",
      "2026-10-31",
      new Date("2026-10-31T00:00:00Z"),
    ),
    false,
  );
});
