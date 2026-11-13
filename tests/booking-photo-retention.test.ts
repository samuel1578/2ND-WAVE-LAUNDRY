import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizeInternalJobRequest,
  isDryRunRequest,
  RetentionStepError,
  runBookingPhotoRetentionWith,
  type DuePhoto,
  type FinishJobInput,
  type PhotoStorage,
  type RetentionRepository,
} from "../src/lib/retention/booking-photos-core";

/**
 * Booking photo retention job logic with in-memory doubles for the database and
 * Storage. The route module imports `server-only`, which only the Next.js bundler
 * resolves, so the route is checked at the source-contract level (as in
 * tests/newsletter-admin.test.ts) and its bearer rule through the shared helper.
 */

type Calls = {
  deleted: string[][];
  removed: string[][];
  finished: FinishJobInput[];
  orphanAudits: number[];
  started: number;
};

function fakeRepository(
  due: DuePhoto[],
  orphans: string[],
  calls: Calls,
  overrides: Partial<RetentionRepository> = {},
): RetentionRepository {
  let duePool = [...due];
  return {
    async startJob() {
      calls.started += 1;
      return 42;
    },
    async countDuePhotos() {
      return duePool.length;
    },
    async listDuePhotos(limit) {
      return duePool.slice(0, limit);
    },
    async deletePhotoRows(_jobId, ids) {
      calls.deleted.push(ids);
      duePool = duePool.filter((photo) => !ids.includes(photo.id));
      return ids.length;
    },
    // Objects removed from Storage disappear from storage.objects, as in production.
    async listOrphanObjects(limit) {
      const removed = new Set(calls.removed.flat());
      return orphans.filter((name) => !removed.has(name)).slice(0, limit);
    },
    async recordOrphansDeleted(_jobId, count) {
      calls.orphanAudits.push(count);
    },
    async finishJob(input) {
      calls.finished.push(input);
    },
    ...overrides,
  };
}

function okStorage(calls: Calls): PhotoStorage {
  return {
    async remove(keys) {
      calls.removed.push(keys);
      return { ok: true, removed: keys.length };
    },
  };
}

const newCalls = (): Calls => ({ deleted: [], removed: [], finished: [], orphanAudits: [], started: 0 });

const photos = (n: number): DuePhoto[] =>
  Array.from({ length: n }, (_, i) => ({ id: `photo-${i}`, storageKey: `bookings/b/${i}.jpg` }));

test("a dry run only counts and never starts a job, removes objects or deletes rows", async () => {
  const calls = newCalls();
  const summary = await runBookingPhotoRetentionWith(
    { repository: fakeRepository(photos(2), ["bookings/x/a.jpg", "bookings/x/b.jpg", "bookings/x/c.jpg"], calls), storage: okStorage(calls) },
    { dryRun: true },
  );
  assert.deepEqual(summary, {
    jobId: null,
    dryRun: true,
    due: 2,
    deleted: 0,
    orphansFound: 3,
    orphansDeleted: 0,
    retryable: 0,
    outcome: "dry_run",
  });
  assert.equal(calls.started, 0);
  assert.equal(calls.removed.length, 0);
  assert.equal(calls.deleted.length, 0);
  assert.equal(calls.finished.length, 0);
});

test("due photos are removed from Storage before their rows, in batches of 50", async () => {
  const calls = newCalls();
  const summary = await runBookingPhotoRetentionWith({
    repository: fakeRepository(photos(120), [], calls),
    storage: okStorage(calls),
  });
  assert.equal(summary.outcome, "succeeded");
  assert.equal(summary.due, 120);
  assert.equal(summary.deleted, 120);
  assert.deepEqual(calls.removed.map((batch) => batch.length), [50, 50, 20]);
  assert.deepEqual(calls.deleted.map((batch) => batch.length), [50, 50, 20]);
  assert.deepEqual(calls.finished, [
    { jobId: 42, outcome: "succeeded", scanned: 120, deleted: 120, retry: 0, error: null },
  ]);
});

test("a Storage failure keeps the rows, counts them as retryable and ends partial", async () => {
  const calls = newCalls();
  const failingStorage: PhotoStorage = {
    async remove(keys) {
      calls.removed.push(keys);
      return { ok: false };
    },
  };
  const summary = await runBookingPhotoRetentionWith({
    repository: fakeRepository(photos(3), [], calls),
    storage: failingStorage,
  });
  assert.equal(calls.deleted.length, 0, "no row is deleted when its object was not removed");
  assert.equal(summary.retryable, 3);
  assert.equal(summary.deleted, 0);
  assert.equal(summary.outcome, "partial");
  assert.equal(calls.finished[0].outcome, "partial");
  assert.equal(calls.finished[0].retry, 3);
  assert.match(calls.finished[0].error ?? "", /^storage_remove_failed/);
});

test("the orphan sweep removes unreferenced objects and audits the count", async () => {
  const calls = newCalls();
  const orphans = ["bookings/x/a.jpg", "bookings/x/b.jpg", "bookings/x/c.jpg"];
  const summary = await runBookingPhotoRetentionWith({
    repository: fakeRepository([], orphans, calls),
    storage: okStorage(calls),
  });
  assert.equal(summary.orphansFound, 3);
  assert.equal(summary.orphansDeleted, 3);
  assert.deepEqual(calls.orphanAudits, [3]);
  assert.equal(summary.outcome, "succeeded");
  assert.deepEqual(calls.finished[0], {
    jobId: 42,
    outcome: "succeeded",
    scanned: 3,
    deleted: 3,
    retry: 0,
    error: null,
  });
});

test("an unexpected error ends the job as failed and still finishes it", async () => {
  const calls = newCalls();
  const summary = await runBookingPhotoRetentionWith({
    repository: fakeRepository(photos(1), [], calls, {
      async listDuePhotos() {
        throw new RetentionStepError("due_list_failed");
      },
    }),
    storage: okStorage(calls),
  });
  assert.equal(summary.outcome, "failed");
  assert.equal(calls.finished.length, 1);
  assert.equal(calls.finished[0].outcome, "failed");
  assert.equal(calls.finished[0].error, "due_list_failed");
});

test("the time budget stops the run and records a partial outcome", async () => {
  const calls = newCalls();
  let clock = 0;
  const summary = await runBookingPhotoRetentionWith(
    {
      repository: fakeRepository(photos(10), [], calls),
      storage: okStorage(calls),
      now: () => (clock += 1000),
    },
    { timeBudgetMs: 500 },
  );
  assert.equal(summary.outcome, "partial");
  assert.equal(calls.finished[0].error, "time_budget_exhausted");
});

test("the internal job bearer rule matches the email worker", () => {
  const secret = "s".repeat(40);
  assert.equal(authorizeInternalJobRequest(`Bearer ${secret}`, {}), "not_configured");
  assert.equal(authorizeInternalJobRequest(null, { CRON_SECRET: secret }), "unauthorized");
  assert.equal(authorizeInternalJobRequest("Bearer wrong", { CRON_SECRET: secret }), "unauthorized");
  assert.equal(authorizeInternalJobRequest(`Bearer ${secret}`, { CRON_SECRET: secret }), "ok");
  assert.equal(authorizeInternalJobRequest(`Bearer ${secret}`, { EMAIL_WORKER_SECRET: secret }), "ok");
  // A weak (short) secret is never accepted as configuration.
  assert.equal(authorizeInternalJobRequest("Bearer short", { CRON_SECRET: "short" }), "not_configured");
});

test("dry_run accepts only explicit truthy values", () => {
  assert.equal(isDryRunRequest("1"), true);
  assert.equal(isDryRunRequest("true"), true);
  assert.equal(isDryRunRequest(null), false);
  assert.equal(isDryRunRequest("0"), false);
});

test("the retention route authorises before running and rejects other methods", () => {
  const route = readFileSync("src/app/api/internal/retention/photos/route.ts", "utf8");
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  const authorise = route.indexOf("authorizeInternalJobRequest(request.headers.get(\"authorization\"))");
  const run = route.indexOf("await runBookingPhotoRetention(");
  assert.ok(authorise > 0 && run > authorise, "the bearer check precedes the job");
  assert.match(route, /"unauthorized" \}, 401/);
  for (const method of ["PUT", "PATCH", "DELETE"])
    assert.match(route, new RegExp(`export async function ${method}\\(\\)[\\s\\S]*?method_not_allowed`));
  assert.match(route, /"Cache-Control": "no-store"/);
});

test("vercel.json schedules the retention job without changing the email cron", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  assert.deepEqual(config.crons, [
    { path: "/api/internal/email/worker", schedule: "0 0 * * *" },
    { path: "/api/internal/retention/photos", schedule: "0 1 * * *" },
  ]);
});
