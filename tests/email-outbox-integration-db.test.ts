import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Sprint 2D.1 end-to-end database tests through the real trusted functions.
 *
 * Unlike `email-outbox-db.test.ts` (a focused outbox harness), this file applies
 * every repository migration in order to a disposable in-process PostgreSQL
 * (PGlite/WASM) and then drives the actual `booking_submit`,
 * `booking_update_arrangement` and `booking_transition` functions.
 *
 * Supabase-only infrastructure is stubbed exactly as needed: `auth.users` with an
 * `auth.uid()` returning NULL (the functions take an explicit actor and
 * re-validate it), and an empty `storage.buckets` table for the photo-bucket
 * migration. RLS policies, grants, triggers, transactions and PL/pgSQL are real.
 *
 * Never run this against the hosted project. Nothing here sends email.
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
`;

let db: PGlite;
let actor: string;
let branchId: string;

before(async () => {
  db = new PGlite();
  await db.exec(PRELUDE);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`migration failed: ${file}: ${(error as Error).message}`);
    }
  }

  actor = randomUUID();
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    actor,
    "admin@example.test",
  ]);
  await db.query(
    "INSERT INTO public.admin_profiles (user_id, role, display_name) VALUES ($1, 'full_admin', 'Test Admin')",
    [actor],
  );

  const { rows: branches } = await db.query<{ id: string }>(
    "SELECT id FROM public.branches ORDER BY sort_order LIMIT 1",
  );
  branchId = branches[0].id;
});

after(async () => {
  await db.close();
});

type BookingPayload = Record<string, unknown>;

function payload(overrides: BookingPayload = {}): BookingPayload {
  return {
    customer_name: "Ama Mensah",
    customer_phone: "+233595224280",
    customer_email: "ama@example.test",
    whatsapp_phone: null,
    same_whatsapp: true,
    contact_method: "phone",
    item_category: "clothing",
    load_size: "1 Standard Bag",
    customer_notes: "",
    pickup_address: "1 Test Street",
    pickup_landmark: "",
    pickup_map_url: null,
    transport_preference: "no_preference",
    requested_date: "2099-01-01",
    requested_time: "09:00",
    express_requested: false,
    notice_version: "2026-10-01",
    ...overrides,
  };
}

async function submit(
  data: BookingPayload,
  key: string,
  services: string[] = ["wash-ironing-fold"],
) {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.booking_submit(
              $1::jsonb, $2::jsonb, $3, 'public_booking_form', $4
            ) AS result`,
    [JSON.stringify(data), JSON.stringify(services), key, randomUUID()],
  );
  return rows[0].result as {
    booking_id: string;
    reference: string;
    status: string;
    version: number;
    replayed: boolean;
  };
}

async function arrange(id: string, expectedVersion: number) {
  const { rows } = await db.query<{ result: { version: number } }>(
    `SELECT public.booking_update_arrangement(
              $1, $2, $3, $4, $5::timestamptz, 50, NULL, 0,
              'Called customer', 'Arrangement agreed', NULL, $6
            ) AS result`,
    [
      actor,
      id,
      expectedVersion,
      branchId,
      "2099-01-01T09:00:00+00:00",
      randomUUID(),
    ],
  );
  return rows[0].result.version;
}

async function transition(
  id: string,
  expectedVersion: number,
  next: string,
  reason: string | null = null,
) {
  const { rows } = await db.query<{ result: { version: number } }>(
    `SELECT public.booking_transition(
              $1, $2, $3, $4::public.booking_status, $5, $6
            ) AS result`,
    [actor, id, expectedVersion, next, reason, randomUUID()],
  );
  return rows[0].result.version;
}

async function templates(id: string): Promise<string[]> {
  const { rows } = await db.query<{ template: string }>(
    "SELECT template::text FROM public.email_outbox WHERE booking_id = $1 ORDER BY created_at, template::text",
    [id],
  );
  return rows.map((row) => row.template);
}

test("a real booking submission commits exactly one creation notification", async () => {
  const key = randomUUID();
  const result = await submit(payload(), key);

  assert.equal(result.replayed, false);
  assert.equal(result.status, "pending");
  assert.equal(result.version, 1);

  assert.deepEqual(await templates(result.booking_id), ["booking_created"]);

  const { rows } = await db.query<{
    recipient_email: string;
    payload: { booking_reference: string; status: string };
    status: string;
    idempotency_key: string;
  }>(
    `SELECT recipient_email, payload, status::text, idempotency_key
     FROM public.email_outbox WHERE booking_id = $1`,
    [result.booking_id],
  );

  assert.equal(rows[0].recipient_email, "ama@example.test");
  assert.deepEqual(rows[0].payload, {
    booking_reference: result.reference,
    status: "pending",
  });
  assert.equal(rows[0].status, "pending");
});

test("replaying the exact submission key is a no-op for the outbox", async () => {
  const key = randomUUID();
  const first = await submit(payload(), key);
  const second = await submit(payload(), key);

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(first.booking_id, second.booking_id);
  assert.deepEqual(await templates(first.booking_id), ["booking_created"]);
});

test("a booking without an email commits but queues nothing", async () => {
  const result = await submit(payload({ customer_email: null }), randomUUID());
  assert.equal(result.replayed, false);
  assert.deepEqual(await templates(result.booking_id), []);
});

test("the trusted lifecycle functions queue each supported status event", async () => {
  const created = await submit(payload(), randomUUID());
  const id = created.booking_id;

  const version = await arrange(id, 1);
  assert.equal(version, 2);

  let current = await transition(id, 2, "confirmed");
  assert.equal(current, 3);
  // The agreed lifecycle requires pickup before processing; `picked_up`
  // deliberately has no customer template.
  current = await transition(id, current, "picked_up");
  assert.equal(current, 4);
  current = await transition(id, current, "processing");
  assert.equal(current, 5);
  current = await transition(id, current, "ready");
  assert.equal(current, 6);
  current = await transition(id, current, "completed");
  assert.equal(current, 7);

  assert.deepEqual(await templates(id), [
    "booking_created",
    "booking_confirmed",
    "booking_processing_started",
    "booking_ready",
    "booking_completed",
  ]);
});

test("cancellation is queued atomically through booking_transition", async () => {
  const created = await submit(payload(), randomUUID());
  const { rows } = await db.query<{ result: { version: number } }>(
    `SELECT public.booking_transition(
              $1, $2, 1, 'cancelled', 'Customer changed plans', $3
            ) AS result`,
    [actor, created.booking_id, randomUUID()],
  );
  assert.equal(rows[0].result.version, 2);

  assert.deepEqual(await templates(created.booking_id), [
    "booking_created",
    "booking_cancelled",
  ]);
});

test("a rejected transition leaves no outbox row and no status change", async () => {
  const created = await submit(payload(), randomUUID());
  assert.deepEqual(await templates(created.booking_id), ["booking_created"]);

  await assert.rejects(
    transition(created.booking_id, 1, "completed"),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P0001",
  );

  assert.deepEqual(await templates(created.booking_id), ["booking_created"]);
  const { rows } = await db.query<{ status: string; version: number }>(
    "SELECT status::text, version FROM public.bookings WHERE id = $1",
    [created.booking_id],
  );
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].version, 1);
});

test("a rolled-back arrangement and confirmation leaves no outbox row", async () => {
  const created = await submit(payload(), randomUUID());

  await db.exec("BEGIN");
  const version = await arrange(created.booking_id, 1);
  await transition(created.booking_id, version, "confirmed");
  assert.deepEqual(await templates(created.booking_id), [
    "booking_created",
    "booking_confirmed",
  ]);
  await db.exec("ROLLBACK");

  assert.deepEqual(await templates(created.booking_id), ["booking_created"]);
  const { rows } = await db.query<{ status: string; version: number }>(
    "SELECT status::text, version FROM public.bookings WHERE id = $1",
    [created.booking_id],
  );
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].version, 1);
});

test("the operator SQL verification script passes against the full local schema", async () => {
  const script = readFileSync(
    "supabase/tests/sprint_2d1_email_outbox.sql",
    "utf8",
  );
  const result = await db.exec(script);
  const last = result.at(-1) as
    | { rows?: Array<{ result?: string }> }
    | undefined;

  assert.equal(
    last?.rows?.[0]?.result,
    "Sprint 2D.1 email outbox tests passed (transaction rolled back).",
  );
});

test("the existing booking security boundary is preserved", async () => {
  const { rows } = await db.query<{ relrowsecurity: boolean }>(
    "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bookings'::regclass",
  );
  assert.equal(rows[0].relrowsecurity, true);

  const { rows: privileges } = await db.query<Record<string, boolean>>(
    `SELECT
        has_table_privilege('anon', 'public.bookings', 'SELECT') AS anon_select,
        has_table_privilege('anon', 'public.bookings', 'INSERT') AS anon_insert,
        has_table_privilege('authenticated', 'public.bookings', 'SELECT') AS auth_select,
        has_table_privilege('authenticated', 'public.bookings', 'INSERT') AS auth_insert,
        has_table_privilege('authenticated', 'public.bookings', 'UPDATE') AS auth_update,
        has_table_privilege('authenticated', 'public.bookings', 'DELETE') AS auth_delete,
        has_table_privilege('anon', 'public.email_outbox', 'INSERT') AS anon_outbox_insert,
        has_table_privilege('authenticated', 'public.email_outbox', 'SELECT') AS auth_outbox_select`,
  );

  assert.equal(privileges[0].anon_select, false);
  assert.equal(privileges[0].anon_insert, false);
  assert.equal(privileges[0].auth_select, true);
  assert.equal(privileges[0].auth_insert, false);
  assert.equal(privileges[0].auth_update, false);
  assert.equal(privileges[0].auth_delete, false);
  assert.equal(privileges[0].anon_outbox_insert, false);
  assert.equal(privileges[0].auth_outbox_select, false);

  // The trusted functions remain service-role only.
  const { rows: functions } = await db.query<Record<string, boolean>>(
    `SELECT
        has_function_privilege(
          'anon',
          'public.booking_submit(jsonb,jsonb,text,text,uuid)',
          'EXECUTE'
        ) AS anon_submit,
        has_function_privilege(
          'authenticated',
          'public.booking_transition(uuid,uuid,integer,public.booking_status,text,uuid)',
          'EXECUTE'
        ) AS auth_transition`,
  );
  assert.equal(functions[0].anon_submit, false);
  assert.equal(functions[0].auth_transition, false);
});
