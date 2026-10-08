import test from "node:test";
import assert from "node:assert/strict";
import {
  repository,
  getDemoSnapshot,
  saveContent,
  deleteMedia,
  saveMedia,
  saveSettings,
  simulateNextFailure,
} from "../src/lib/mock-store";
import { services, commercial, branches } from "../src/lib/content";
import { contentModules } from "../src/components/admin/content/content-config";
import type { BookingInput } from "../src/lib/contracts";
const input: BookingInput = {
  services: ["wash-ironing-fold"],
  category: "Clothing",
  items: "Sample",
  notes: "",
  address: "Sample address",
  landmark: "",
  map: "",
  date: "2099-01-01",
  time: "",
  transport: "No preference",
  name: "Sample name",
  phone: "0595224280",
  email: "",
  sameWhatsapp: true,
  whatsapp: "",
  contactMethod: "Phone call",
  acknowledged: true,
  photoNames: [],
};
test("catalogue, branches and modules match approved scope", () => {
  assert.equal(services.length + 1, 11);
  assert.equal(commercial.title, "Commercial Laundry");
  assert.equal(branches.length, 3);
  assert.deepEqual(
    contentModules.map((m) => m.name),
    ["Services", "Locations", "Gallery", "Blog", "FAQs", "Promotions"],
  );
  assert.equal(
    contentModules.filter((m) => m.publicationStates).length,
    3,
  );
  assert.equal(services.filter((s) => s.bookable).length, 9);
  for (const s of services) {
    assert.ok(s.image, `${s.slug} is missing an image`);
    if (s.image.src.endsWith(".png"))
      assert.ok(
        !/2nd wave|logo|brand/i.test(s.image.alt),
        `${s.slug} uses a mislabeled logo PNG`,
      );
  }
});
test("booking replay is idempotent, including concurrent calls", async () => {
  const key = crypto.randomUUID();
  const [a, b] = await Promise.all([
    repository.createBooking(input, key),
    repository.createBooking(input, key),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(
    getDemoSnapshot().bookings.filter((v) => v.id === a.id).length,
    1,
  );
  await assert.rejects(
    repository.createBooking({ ...input, items: "Changed" }, key),
    /changed/,
  );
});
test("failed save can retry without losing payload", async () => {
  simulateNextFailure();
  const key = crypto.randomUUID();
  await assert.rejects(repository.createBooking(input, key), /couldn’t save/);
  const saved = await repository.createBooking(input, key);
  assert.deepEqual(saved.input, input);
});
test("booking rejects stale version and missing agreement", async () => {
  const b = await repository.createBooking(input, crypto.randomUUID());
  await assert.rejects(
    repository.updateBooking(b.id, b.version, { status: "confirmed" }),
    /Assign a branch/,
  );
  await repository.updateBooking(b.id, b.version, { note: "Test note" });
  await assert.rejects(
    repository.updateBooking(b.id, b.version, { note: "Stale" }),
    /changed while/,
  );
});
test("draft editing leaves published snapshot unchanged", async () => {
  const original = await saveContent(
    {
      id: "",
      module: "Blog",
      title: "Original title",
      slug: "test-original-article",
      summary: "Summary",
      body: "Body",
      image: "",
      alt: "",
      status: "Draft",
      sort: 0,
      version: 0,
      extra: {},
    },
    "publish",
  );
  const draft = await saveContent(
    { ...original, title: "Draft title" },
    "draft",
  );
  assert.equal(draft.published?.title, original.title);
  assert.equal(draft.title, "Draft title");
  const published = await saveContent(draft, "publish");
  assert.equal(published.published?.title, "Draft title");
});
test("in-use media cannot be deleted", async () => {
  await assert.rejects(deleteMedia("media-0"), /still in use/);
  assert.ok(getDemoSnapshot().media.find((m) => m.id === "media-0"));
});
test("aborted media upload never commits", async () => {
  const abort = new AbortController();
  abort.abort();
  const before = getDemoSnapshot().media.length;
  await assert.rejects(
    saveMedia(
      {
        id: "cancelled-upload",
        src: "blob:test",
        name: "test.jpg",
        alt: "Test",
        caption: "",
        source: "Test",
        permission: "Test",
        uses: [],
        archived: false,
      },
      abort.signal,
    ),
    /cancelled/,
  );
  assert.equal(getDemoSnapshot().media.length, before);
});
test("paused bookings refuse new requests but committed replay succeeds", async () => {
  const key = crypto.randomUUID();
  const saved = await repository.createBooking(input, key);
  await saveSettings({ ...getDemoSnapshot().settings, acceptBookings: false });
  await assert.rejects(
    repository.createBooking(input, crypto.randomUUID()),
    /paused/,
  );
  assert.equal((await repository.createBooking(input, key)).id, saved.id);
  await saveSettings({ ...getDemoSnapshot().settings, acceptBookings: true });
});
