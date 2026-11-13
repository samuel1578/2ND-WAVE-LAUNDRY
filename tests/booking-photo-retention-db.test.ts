import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Booking photo retention database tests.
 *
 * Applies every repository migration to a disposable in-process PostgreSQL
 * (PGlite/WASM) and exercises the retention RPCs from
 * 20261113170000_booking_photo_retention.sql: due selection, the deadline
 * re-check on delete, orphan detection, job finishing rules, the aggregate audit
 * events and the service_role-only privilege boundary.
 *
 * Supabase-only infrastructure is stubbed as in the other database tests, plus a
 * minimal storage.objects table for the orphan sweep. Nothing touches Storage.
 */

const MIGRATIONS_DIR = "supabase/migrations";

const PRELUDE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
    id uuid PRIMARY KEY,
    email text,
    email_confirmed_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULL::uuid $$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL,
    public boolean NOT NULL DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[]
);
CREATE TABLE storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text NOT NULL,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
`;

let db: PGlite;

async function createBooking(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.bookings (
        id, reference, idempotency_key, submission_hash, customer_name,
        customer_phone, item_category, load_size, pickup_address, requested_date
     ) VALUES ($1, $2, $3, $4, 'Retention Customer', '+233595224280',
               'clothing', '1 Standard Bag', '1 Test Street', '2026-11-05')`,
    [
      id,
      `2W-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
      randomUUID(),
      "a".repeat(32),
    ],
  );
  return id;
}

/** Inserts a photo uploaded `ageDays` ago; the trigger derives delete_due_at. */
async function createPhoto(bookingId: string, ageDays: number): Promise<{ id: string; key: string }> {
  const id = randomUUID();
  const key = `bookings/${bookingId}/${randomUUID().replace(/-/g, "")}.jpg`;
  await db.query(
    `INSERT INTO public.booking_photos (id, booking_id, storage_key, mime_type, byte_size, uploaded_at)
     VALUES ($1, $2, $3, 'image/jpeg', 1000, now() - make_interval(days => $4))`,
    [id, bookingId, key, ageDays],
  );
  return { id, key };
}

async function startJob(): Promise<number> {
  const result = await db.query<{ id: number }>(
    "SELECT public.retention_job_start('test_job') AS id",
  );
  return Number(result.rows[0].id);
}

before(async () => {
  db = new PGlite();
  await db.exec(PRELUDE);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`migration failed: ${file}: ${(error as Error).message}`);
    }
  }
});

after(async () => {
  await db.close();
});

test("only photos past their 90-day deadline are listed as due", async () => {
  const booking = await createBooking();
  const due = await createPhoto(booking, 91);
  const fresh = await createPhoto(booking, 10);

  const rows = await db.query<{ id: string; storage_key: string }>(
    "SELECT * FROM public.retention_due_photos(200)",
  );
  const ids = rows.rows.map((row) => row.id);
  assert.ok(ids.includes(due.id));
  assert.ok(!ids.includes(fresh.id));
  assert.equal(rows.rows.find((row) => row.id === due.id)?.storage_key, due.key);
});

test("the delete re-checks the deadline, so a not-yet-due photo is never deleted", async () => {
  const booking = await createBooking();
  const due = await createPhoto(booking, 95);
  const fresh = await createPhoto(booking, 1);
  const job = await startJob();

  const result = await db.query<{ count: number }>(
    "SELECT public.retention_photos_delete($1, $2::uuid[]) AS count",
    [job, [due.id, fresh.id]],
  );
  assert.equal(Number(result.rows[0].count), 1);

  const remaining = await db.query<{ id: string }>(
    "SELECT id FROM public.booking_photos WHERE id = ANY($1::uuid[])",
    [[due.id, fresh.id]],
  );
  assert.deepEqual(remaining.rows.map((row) => row.id), [fresh.id]);

  const audit = await db.query<{ actor_id: string | null; after_state: { count: number } }>(
    `SELECT actor_id, after_state FROM public.audit_events
     WHERE action = 'retention.booking_photos_deleted' AND entity_id = $1`,
    [String(job)],
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].actor_id, null);
  assert.deepEqual(audit.rows[0].after_state, { count: 1 });
});

test("deleting requires a running job", async () => {
  const booking = await createBooking();
  const due = await createPhoto(booking, 100);
  await assert.rejects(
    db.query("SELECT public.retention_photos_delete(NULL, $1::uuid[])", [[due.id]]),
    /RETENTION_JOB_NOT_RUNNING/,
  );
  const job = await startJob();
  await db.query("SELECT public.retention_job_finish($1, 'succeeded', 0, 0, 0, NULL)", [job]);
  await assert.rejects(
    db.query("SELECT public.retention_photos_delete($1, $2::uuid[])", [job, [due.id]]),
    /RETENTION_JOB_NOT_RUNNING/,
  );
});

test("orphan detection lists only old, unreferenced booking-photos objects", async () => {
  const booking = await createBooking();
  const referenced = await createPhoto(booking, 5);
  const orphanOld = `bookings/${randomUUID()}/orphan-old.jpg`;
  const orphanNew = `bookings/${randomUUID()}/orphan-new.jpg`;
  const otherBucket = `elsewhere/${randomUUID()}.jpg`;

  await db.query(
    `INSERT INTO storage.objects (bucket_id, name, created_at) VALUES
       ('booking-photos', $1, now() - interval '3 days'),
       ('booking-photos', $2, now() - interval '3 days'),
       ('booking-photos', $3, now() - interval '1 hour'),
       ('marketing-assets', $4, now() - interval '3 days')`,
    [referenced.key, orphanOld, orphanNew, otherBucket],
  );

  const rows = await db.query<{ name: string }>(
    "SELECT name FROM public.retention_orphan_photo_objects(500)",
  );
  const names = rows.rows.map((row) => row.name);
  assert.ok(names.includes(orphanOld));
  assert.ok(!names.includes(referenced.key), "a referenced object is not an orphan");
  assert.ok(!names.includes(orphanNew), "objects younger than 24 hours are skipped");
  assert.ok(!names.includes(otherBucket), "other buckets are ignored");
});

test("finishing respects the retention_jobs constraints", async () => {
  const job = await startJob();
  // deleted > scanned is raised to scanned = deleted rather than violating the CHECK.
  await db.query(
    "SELECT public.retention_job_finish($1, 'partial', 1, 3, 2, $2)",
    [job, `line one\nline two ${"x".repeat(400)}`],
  );
  const row = await db.query<{
    outcome: string;
    scanned_count: number;
    deleted_count: number;
    retry_count: number;
    error_summary: string;
    finished_at: string | null;
  }>("SELECT * FROM public.retention_jobs WHERE id = $1", [job]);
  const finished = row.rows[0];
  assert.equal(finished.outcome, "partial");
  assert.equal(finished.scanned_count, 3);
  assert.equal(finished.deleted_count, 3);
  assert.equal(finished.retry_count, 2);
  assert.ok(finished.finished_at);
  assert.ok(finished.error_summary.length <= 300);
  assert.doesNotMatch(finished.error_summary, /[\r\n]/);

  // A job is finished once, and only with a known outcome.
  await assert.rejects(
    db.query("SELECT public.retention_job_finish($1, 'succeeded', 0, 0, 0, NULL)", [job]),
    /RETENTION_JOB_NOT_RUNNING/,
  );
  const other = await startJob();
  await assert.rejects(
    db.query("SELECT public.retention_job_finish($1, 'running', 0, 0, 0, NULL)", [other]),
    /RETENTION_OUTCOME/,
  );
});

test("the orphan sweep is audited with a count only", async () => {
  const job = await startJob();
  await db.query("SELECT public.retention_orphans_deleted($1, 3)", [job]);
  await db.query("SELECT public.retention_orphans_deleted($1, 0)", [job]);
  const audit = await db.query<{ after_state: { count: number } }>(
    `SELECT after_state FROM public.audit_events
     WHERE action = 'retention.booking_photo_objects_deleted' AND entity_id = $1`,
    [String(job)],
  );
  assert.equal(audit.rows.length, 1, "a zero count writes no event");
  assert.deepEqual(audit.rows[0].after_state, { count: 3 });
});

test("job names are validated", async () => {
  await assert.rejects(db.query("SELECT public.retention_job_start('')"), /RETENTION_JOB_NAME/);
  await assert.rejects(
    db.query("SELECT public.retention_job_start($1)", ["x".repeat(65)]),
    /RETENTION_JOB_NAME/,
  );
});

test("every retention RPC is executable by service_role only", async () => {
  const functions = [
    "public.retention_job_start(text)",
    "public.retention_due_photos(integer)",
    "public.retention_photos_delete(bigint, uuid[])",
    "public.retention_orphan_photo_objects(integer)",
    "public.retention_orphans_deleted(bigint, integer)",
    "public.retention_job_finish(bigint, text, integer, integer, integer, text)",
  ];
  for (const fn of functions) {
    const result = await db.query<{ anon: boolean; auth: boolean; service: boolean }>(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
              has_function_privilege('service_role', $1, 'EXECUTE') AS service`,
      [fn],
    );
    assert.deepEqual(result.rows[0], { anon: false, auth: false, service: true }, fn);
  }
});
