import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Branch pickup schedule administration database tests.
 *
 * Applies every repository migration to a disposable in-process PostgreSQL
 * (PGlite/WASM) and exercises the RPCs from
 * 20261113180000_branch_pickup_schedule_admin.sql: shape validation, the Full
 * Admin check, optimistic concurrency on branches.version, the past-date rule,
 * exception precedence through branch_effective_pickup_window, the audit trail
 * and the service_role-only privilege boundary.
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
let fullAdmin: string;
let operationalAdmin: string;
let branch: string;

type Window = { weekday: number; is_closed: boolean; opens: string; closes: string };

const week = (overrides: Partial<Record<number, Partial<Window>>> = {}): Window[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    is_closed: false,
    opens: "07:00",
    closes: "17:00",
    ...overrides[weekday],
  }));

async function version(): Promise<number> {
  const result = await db.query<{ version: number }>(
    "SELECT version FROM public.branches WHERE id = $1",
    [branch],
  );
  return Number(result.rows[0].version);
}

/** A date `days` from today in Africa/Accra, as YYYY-MM-DD. */
async function accraDate(days: number): Promise<string> {
  const result = await db.query<{ d: string }>(
    "SELECT to_char((now() AT TIME ZONE 'Africa/Accra')::date + $1::integer, 'YYYY-MM-DD') AS d",
    [days],
  );
  return result.rows[0].d;
}

async function saveWeek(actor: string, windows: unknown, expected?: number) {
  return db.query<{ result: { version: number; windows: Window[] } }>(
    "SELECT public.branch_pickup_windows_save($1, $2, $3, $4::jsonb) AS result",
    [actor, branch, expected ?? (await version()), JSON.stringify(windows)],
  );
}

async function effective(date: string, branchId: string | null = branch) {
  const result = await db.query<{ w: { opens: string | null; closes: string | null; is_closed: boolean; source: string } }>(
    "SELECT public.branch_effective_pickup_window($1, $2::date) AS w",
    [branchId, date],
  );
  return result.rows[0].w;
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

  fullAdmin = randomUUID();
  operationalAdmin = randomUUID();
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, 'full@example.test'), ($2, 'ops@example.test')", [
    fullAdmin,
    operationalAdmin,
  ]);
  await db.query(
    `INSERT INTO public.admin_profiles (user_id, role, display_name)
     VALUES ($1, 'full_admin', 'Full'), ($2, 'operational_admin', 'Ops')`,
    [fullAdmin, operationalAdmin],
  );
  const seeded = await db.query<{ id: string }>(
    "SELECT id FROM public.branches WHERE slug = 'katamanso-no-1'",
  );
  branch = seeded.rows[0].id;
});

after(async () => {
  await db.close();
});

test("the weekly window payload must be exactly seven valid, unique weekdays", async () => {
  await assert.rejects(saveWeek(fullAdmin, week().slice(0, 6)), /CONTENT_INVALID/);
  await assert.rejects(
    saveWeek(fullAdmin, [...week().slice(0, 6), { weekday: 1, is_closed: false, opens: "07:00", closes: "17:00" }]),
    /CONTENT_INVALID/,
  );
  await assert.rejects(
    saveWeek(fullAdmin, week().map((day, i) => (i === 0 ? { weekday: 1, opens: "07:00", closes: "17:00" } : day))),
    /CONTENT_INVALID/,
    "a missing is_closed key is rejected",
  );
  await assert.rejects(saveWeek(fullAdmin, week({ 2: { opens: "7:00" } })), /CONTENT_INVALID/);
  await assert.rejects(saveWeek(fullAdmin, week({ 3: { opens: "17:00", closes: "09:00" } })), /CONTENT_INVALID/);
  await assert.rejects(saveWeek(fullAdmin, week({ 4: { weekday: 9 } })), /CONTENT_INVALID/);
});

test("only an active Full Admin may save a schedule", async () => {
  await assert.rejects(saveWeek(operationalAdmin, week()), /CONTENT_FORBIDDEN/);
  await assert.rejects(saveWeek(randomUUID(), week()), /CONTENT_FORBIDDEN/);
});

test("a stale version is a conflict and a save bumps the branch version", async () => {
  const start = await version();
  await assert.rejects(saveWeek(fullAdmin, week(), start - 1), /CONTENT_CONFLICT/);

  const saved = await saveWeek(fullAdmin, week({ 7: { is_closed: true }, 2: { opens: "08:00", closes: "16:00" } }), start);
  assert.equal(saved.rows[0].result.version, start + 1);
  assert.equal(await version(), start + 1);
  const tuesday = saved.rows[0].result.windows.find((day) => day.weekday === 2);
  assert.deepEqual(tuesday, { weekday: 2, is_closed: false, opens: "08:00", closes: "16:00" });

  // A closed day may keep equal or reversed times (they are ignored).
  await saveWeek(fullAdmin, week({ 7: { is_closed: true, opens: "17:00", closes: "07:00" } }));

  const audit = await db.query<{ before_state: { windows: Window[] }; after_state: { windows: Window[]; version: number } }>(
    `SELECT before_state, after_state FROM public.audit_events
     WHERE action = 'branch.pickup_windows_updated' AND entity_id = $1
     ORDER BY id`,
    [branch],
  );
  assert.equal(audit.rows.length, 2);
  assert.equal(audit.rows[0].before_state.windows.length, 7);
  assert.equal(audit.rows[0].after_state.version, start + 1);
});

test("closures cannot be in the past and special hours must be ordered", async () => {
  const yesterday = await accraDate(-1);
  const nextWeek = await accraDate(7);
  const call = (date: string, closed: boolean, opens: string | null, closes: string | null, reason = "") =>
    db.query(
      "SELECT public.branch_pickup_exception_upsert($1, $2, $3, $4::date, $5, $6::time, $7::time, $8)",
      [fullAdmin, branch, 0, date, closed, opens, closes, reason],
    );
  // Version is checked first, so use the current one for validation cases.
  const current = await version();
  const at = (date: string, closed: boolean, opens: string | null, closes: string | null, reason = "") =>
    db.query(
      "SELECT public.branch_pickup_exception_upsert($1, $2, $3, $4::date, $5, $6::time, $7::time, $8)",
      [fullAdmin, branch, current, date, closed, opens, closes, reason],
    );
  await assert.rejects(call(nextWeek, true, null, null), /CONTENT_CONFLICT/);
  await assert.rejects(at(yesterday, true, null, null), /CONTENT_INVALID/);
  await assert.rejects(at(nextWeek, false, "15:00", "09:00"), /CONTENT_INVALID/);
  await assert.rejects(at(nextWeek, false, null, null), /CONTENT_INVALID/);
  await assert.rejects(at(nextWeek, true, null, null, "x".repeat(201)), /CONTENT_INVALID/);
  await assert.rejects(
    db.query(
      "SELECT public.branch_pickup_exception_upsert($1, $2, $3, $4::date, true, NULL, NULL, '')",
      [operationalAdmin, branch, current, nextWeek],
    ),
    /CONTENT_FORBIDDEN/,
  );
});

test("an exception takes precedence over the weekly window until it is deleted", async () => {
  const date = await accraDate(10);
  const weekly = await effective(date);
  assert.equal(weekly.source, "weekly");

  await db.query(
    "SELECT public.branch_pickup_exception_upsert($1, $2, $3, $4::date, true, NULL, NULL, '  Public holiday  ')",
    [fullAdmin, branch, await version(), date],
  );
  const closed = await effective(date);
  assert.deepEqual(closed, { opens: null, closes: null, is_closed: true, source: "exception" });

  const stored = await db.query<{ reason: string; opens: string | null }>(
    "SELECT reason, opens FROM public.branch_pickup_exceptions WHERE branch_id = $1 AND exception_date = $2::date",
    [branch, date],
  );
  assert.equal(stored.rows[0].reason, "Public holiday", "the reason is trimmed");
  assert.equal(stored.rows[0].opens, null, "a closed day stores no hours");

  // Replacing the entry with special hours on the same date.
  await db.query(
    "SELECT public.branch_pickup_exception_upsert($1, $2, $3, $4::date, false, '10:00', '13:00', 'Short day')",
    [fullAdmin, branch, await version(), date],
  );
  assert.deepEqual(await effective(date), { opens: "10:00", closes: "13:00", is_closed: false, source: "exception" });

  const deleted = await db.query<{ result: { version: number; date: string } }>(
    "SELECT public.branch_pickup_exception_delete($1, $2, $3, $4::date) AS result",
    [fullAdmin, branch, await version(), date],
  );
  assert.equal(deleted.rows[0].result.version, await version());
  assert.equal((await effective(date)).source, "weekly");

  await assert.rejects(
    db.query("SELECT public.branch_pickup_exception_delete($1, $2, $3, $4::date)", [fullAdmin, branch, await version(), date]),
    /CONTENT_NOT_FOUND/,
  );

  const audit = await db.query<{ action: string }>(
    `SELECT action FROM public.audit_events
     WHERE entity_id = $1 AND action IN ('branch.pickup_exception_saved', 'branch.pickup_exception_deleted')
     ORDER BY id`,
    [branch],
  );
  assert.deepEqual(
    audit.rows.map((row) => row.action),
    ["branch.pickup_exception_saved", "branch.pickup_exception_saved", "branch.pickup_exception_deleted"],
  );
});

test("the effective window falls back to booking_settings without a branch or weekly row", async () => {
  const date = await accraDate(3);
  const settings = await effective(date, null);
  assert.equal(settings.source, "settings");
  assert.equal(settings.is_closed, false);
  assert.equal(settings.opens, "07:00");
  assert.equal(settings.closes, "17:00");

  const other = await db.query<{ id: string }>("SELECT id FROM public.branches WHERE slug = 'newland-katamanso'");
  await db.query(
    "DELETE FROM public.branch_pickup_windows WHERE branch_id = $1 AND weekday = extract(isodow FROM $2::date)::smallint",
    [other.rows[0].id, date],
  );
  assert.equal((await effective(date, other.rows[0].id)).source, "settings");
});

test("every schedule RPC is executable by service_role only", async () => {
  const functions = [
    "public.branch_pickup_windows_save(uuid, uuid, integer, jsonb)",
    "public.branch_pickup_exception_upsert(uuid, uuid, integer, date, boolean, time, time, text)",
    "public.branch_pickup_exception_delete(uuid, uuid, integer, date)",
    "public.branch_effective_pickup_window(uuid, date)",
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
