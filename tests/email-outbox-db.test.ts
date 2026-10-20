import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * Sprint 2D.1 transactional outbox database tests.
 *
 * These run the real forward-only migration against an in-process disposable
 * PostgreSQL (PGlite/WASM), not against the hosted Supabase project. PGlite is a
 * genuine PostgreSQL engine, so enum types, CHECK constraints, unique indexes,
 * PL/pgSQL triggers, transactions and RLS privilege checks are exercised for real.
 *
 * It is not the Supabase stack: auth users, PostgREST and the hosted service_role
 * configuration are absent. A minimal booking table with the columns the outbox
 * triggers read is created before the migration runs. The employee/operator SQL
 * script `supabase/tests/sprint_2d1_email_outbox.sql` repeats these assertions for
 * a full local Supabase or PostgreSQL instance.
 */

const MIGRATION = "supabase/migrations/20261019120000_email_outbox.sql";

const HARNESS = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA private;

-- The only piece of the Sprint 2A schema the outbox migration reuses.
CREATE OR REPLACE FUNCTION private.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.touch_updated_at()
FROM PUBLIC, anon, authenticated;

CREATE TYPE public.booking_status AS ENUM (
    'pending',
    'confirmed',
    'scheduled',
    'picked_up',
    'processing',
    'ready',
    'out_for_delivery',
    'completed',
    'cancelled'
);

-- Booking columns read by the outbox triggers, plus the lifecycle fields the
-- tests update. This is a harness stub, not the production table.
CREATE TABLE public.bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference text NOT NULL UNIQUE,
    customer_email text,
    status public.booking_status NOT NULL DEFAULT 'pending',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER bookings_touch
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION private.touch_updated_at();
`;

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(HARNESS);
  await db.exec(readFileSync(MIGRATION, "utf8"));
});

after(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("TRUNCATE TABLE public.email_outbox, public.bookings CASCADE");
});

type NewBooking = {
  id?: string;
  reference?: string;
  email?: string | null;
  status?: string;
};

function reference(): string {
  return `2W-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

async function insertBooking(overrides: NewBooking = {}) {
  const booking = {
    id: overrides.id ?? randomUUID(),
    reference: overrides.reference ?? reference(),
    email: overrides.email === undefined ? "Customer@Example.test" : overrides.email,
    status: overrides.status ?? "pending",
  };

  await db.query(
    `INSERT INTO public.bookings (id, reference, customer_email, status, version)
     VALUES ($1, $2, $3, $4, 1)`,
    [booking.id, booking.reference, booking.email, booking.status],
  );

  return booking;
}

async function changeStatus(bookingId: string, status: string, version: number) {
  await db.query(
    "UPDATE public.bookings SET status = $1, version = $2 WHERE id = $3",
    [status, version, bookingId],
  );
}

async function outboxRows(bookingId: string) {
  const { rows } = await db.query<{
    id: string;
    template: string;
    recipient_email: string;
    payload: { booking_reference: string; status: string };
    status: string;
    attempt_count: number;
    next_attempt_at: string;
    idempotency_key: string;
    provider_message_id: string | null;
    last_error: string | null;
  }>(
    `SELECT id, template::text, recipient_email, payload, status::text, attempt_count,
            next_attempt_at, idempotency_key, provider_message_id, last_error
     FROM public.email_outbox
     WHERE booking_id = $1
     ORDER BY created_at, template::text`,
    [bookingId],
  );
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                   */
/* -------------------------------------------------------------------------- */

test("a valid creation with an email enqueues exactly one minimal row", async () => {
  const booking = await insertBooking();
  const rows = await outboxRows(booking.id);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].template, "booking_created");
  assert.equal(rows[0].recipient_email, "customer@example.test");
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].attempt_count, 0);
  assert.equal(rows[0].provider_message_id, null);
  assert.equal(rows[0].last_error, null);
  assert.deepEqual(rows[0].payload, {
    booking_reference: booking.reference,
    status: "pending",
  });
  assert.equal(
    rows[0].idempotency_key,
    `booking:${booking.id}:booking_created:v1`,
  );
  // No unnecessary customer information in the payload.
  assert.deepEqual(Object.keys(rows[0].payload).sort(), [
    "booking_reference",
    "status",
  ]);
});

test("no customer-email row is created when the email is absent or invalid", async () => {
  const missing = await insertBooking({ email: null });
  const empty = await insertBooking({ email: "" });
  const invalid = await insertBooking({ email: "not-an-email" });

  assert.equal((await outboxRows(missing.id)).length, 0);
  assert.equal((await outboxRows(empty.id)).length, 0);
  // The booking itself still commits; optional email never records a failure.
  assert.equal((await outboxRows(invalid.id)).length, 0);

  const { rows } = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM public.email_outbox",
  );
  assert.equal(rows[0].count, 0);
});

test("replaying the enqueue for the same committed event is a no-op", async () => {
  const booking = await insertBooking();

  const { rows } = await db.query<{ inserted: boolean }>(
    `SELECT private.enqueue_booking_email(
              $1, 'booking_created', 1, $2, $3, 'pending'
            ) AS inserted`,
    [booking.id, booking.email, booking.reference],
  );

  assert.equal(rows[0].inserted, false);
  assert.equal((await outboxRows(booking.id)).length, 1);
});

test("idempotency and the booking/event identity are unique in PostgreSQL", async () => {
  const booking = await insertBooking();
  const [row] = await outboxRows(booking.id);

  // Same key, same event.
  await assert.rejects(
    db.query(
      `INSERT INTO public.email_outbox (
         booking_id, booking_version, idempotency_key, template,
         recipient_email, payload
       ) VALUES ($1, 1, $2, 'booking_created', $3, $4)`,
      [
        booking.id,
        row.idempotency_key,
        row.recipient_email,
        JSON.stringify(row.payload),
      ],
    ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "23505",
  );

  // A different textual key cannot smuggle in the same event version.
  await assert.rejects(
    db.query(
      `INSERT INTO public.email_outbox (
         booking_id, booking_version, idempotency_key, template,
         recipient_email, payload
       ) VALUES ($1, 1, $2, 'booking_created', $3, $4)`,
      [
        booking.id,
        `booking:${booking.id}:booking_created:manual`,
        row.recipient_email,
        JSON.stringify(row.payload),
      ],
    ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "23505",
  );

  assert.equal((await outboxRows(booking.id)).length, 1);
});

/* -------------------------------------------------------------------------- */
/* Lifecycle mapping                                                          */
/* -------------------------------------------------------------------------- */

test("each supported lifecycle status maps to its template", async () => {
  const completed = await insertBooking();
  await changeStatus(completed.id, "confirmed", 2);
  await changeStatus(completed.id, "processing", 3);
  await changeStatus(completed.id, "ready", 4);
  await changeStatus(completed.id, "completed", 5);

  assert.deepEqual(
    (await outboxRows(completed.id)).map((row) => row.template),
    [
      "booking_created",
      "booking_confirmed",
      "booking_processing_started",
      "booking_ready",
      "booking_completed",
    ],
  );

  const cancelled = await insertBooking();
  await changeStatus(cancelled.id, "cancelled", 2);
  assert.deepEqual(
    (await outboxRows(cancelled.id)).map((row) => row.template),
    ["booking_created", "booking_cancelled"],
  );
});

test("statuses without a customer template do not enqueue anything", async () => {
  const booking = await insertBooking();
  await changeStatus(booking.id, "scheduled", 2);
  await changeStatus(booking.id, "picked_up", 3);
  await changeStatus(booking.id, "out_for_delivery", 4);

  assert.deepEqual(
    (await outboxRows(booking.id)).map((row) => row.template),
    ["booking_created"],
  );
});

test("a replayed creation (no second INSERT) cannot enqueue a second row", async () => {
  const booking = await insertBooking();

  // The real replay path returns the original committed booking before any
  // INSERT, so the AFTER INSERT trigger does not fire. A duplicate insert is
  // rejected by the booking unique constraint and rolls back its trigger work.
  await assert.rejects(
    db.query(
      `INSERT INTO public.bookings (id, reference, customer_email, status, version)
       VALUES ($1, $2, $3, 'pending', 1)`,
      [randomUUID(), booking.reference, booking.email],
    ),
  );

  assert.equal((await outboxRows(booking.id)).length, 1);
});

/* -------------------------------------------------------------------------- */
/* Atomicity                                                                  */
/* -------------------------------------------------------------------------- */

test("no outbox row survives a rolled-back status transaction", async () => {
  const booking = await insertBooking();
  assert.equal((await outboxRows(booking.id)).length, 1);

  await db.exec("BEGIN");
  await changeStatus(booking.id, "confirmed", 2);
  assert.equal((await outboxRows(booking.id)).length, 2);
  await db.exec("ROLLBACK");

  assert.deepEqual(
    (await outboxRows(booking.id)).map((row) => row.template),
    ["booking_created"],
  );
});

test("no outbox row survives a rolled-back booking insert", async () => {
  const bookingReference = reference();

  await db.exec("BEGIN");
  await db.query(
    `INSERT INTO public.bookings (id, reference, customer_email, status, version)
     VALUES ($1, $2, $3, 'pending', 1)`,
    [randomUUID(), bookingReference, "rollback@example.test"],
  );
  await db.exec("ROLLBACK");

  const { rows } = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM public.email_outbox",
  );
  assert.equal(rows[0].count, 0);
});

/* -------------------------------------------------------------------------- */
/* Forged or invalid data                                                     */
/* -------------------------------------------------------------------------- */

test("a forged template/status pair is rejected by the trusted helper", async () => {
  const booking = await insertBooking();

  await assert.rejects(
    db.query(
      `SELECT private.enqueue_booking_email(
                $1, 'booking_completed', 9, $2, $3, 'pending'
              )`,
      [booking.id, booking.email, booking.reference],
    ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P0001",
  );
});

test("arbitrary recipients, payloads and delivery states are rejected", async () => {
  const booking = await insertBooking();

  const insert = (values: {
    idempotencyKey: string;
    recipient: string;
    payload: unknown;
    status?: string;
  }) =>
    db.query(
      `INSERT INTO public.email_outbox (
         booking_id, booking_version, idempotency_key, template,
         recipient_email, payload, status
       ) VALUES ($1, 7, $2, 'booking_ready', $3, $4, $5)`,
      [
        booking.id,
        values.idempotencyKey,
        values.recipient,
        JSON.stringify(values.payload),
        values.status ?? "pending",
      ],
    );

  const goodPayload = { booking_reference: booking.reference, status: "ready" };

  await assert.rejects(
    insert({
      idempotencyKey: "booking:forged:recipient:1",
      recipient: "attacker@example.test\nBcc: victim@example.test",
      payload: goodPayload,
    }),
  );

  await assert.rejects(
    insert({
      idempotencyKey: "booking:forged:payload:1",
      recipient: "attacker@example.test",
      payload: { ...goodPayload, customer_name: "Full Name" },
    }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "23514",
  );

  await assert.rejects(
    insert({
      idempotencyKey: "booking:forged:dead:1",
      recipient: "attacker@example.test",
      payload: goodPayload,
      status: "dead",
    }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "23514",
  );
});

test("delivery state transitions keep the lease and timestamp invariants", async () => {
  const booking = await insertBooking();
  const [row] = await outboxRows(booking.id);

  // Sending without a lease is invalid.
  await assert.rejects(
    db.query("UPDATE public.email_outbox SET status = 'sending' WHERE id = $1", [
      row.id,
    ]),
  );

  const outboxId = row.id;

  await db.query(
    `UPDATE public.email_outbox
     SET status = 'sending', locked_at = now(), locked_by = 'worker-1',
         lease_expires_at = now() + interval '60 seconds', attempt_count = 1
     WHERE id = $1`,
    [outboxId],
  );

  // Sent requires sent_at and must clear the lease.
  await assert.rejects(
    db.query("UPDATE public.email_outbox SET status = 'sent' WHERE id = $1", [
      outboxId,
    ]),
  );

  await db.query(
    `UPDATE public.email_outbox
     SET status = 'sent', sent_at = now(), locked_at = NULL, locked_by = NULL,
         lease_expires_at = NULL, provider_message_id = 'provider-123'
     WHERE id = $1`,
    [outboxId],
  );

  const { rows } = await db.query<{ status: string; provider_message_id: string }>(
    "SELECT status::text, provider_message_id FROM public.email_outbox WHERE id = $1",
    [outboxId],
  );
  assert.equal(rows[0].status, "sent");
  assert.equal(rows[0].provider_message_id, "provider-123");
});

test("the enqueued message identity cannot be redirected or rewritten", async () => {
  const booking = await insertBooking();
  const { rows: ids } = await db.query<{ id: string }>(
    "SELECT id FROM public.email_outbox WHERE booking_id = $1",
    [booking.id],
  );

  await assert.rejects(
    db.query(
      "UPDATE public.email_outbox SET recipient_email = 'other@example.test' WHERE id = $1",
      [ids[0].id],
    ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P0001",
  );

  await assert.rejects(
    db.query(
      "UPDATE public.email_outbox SET template = 'booking_cancelled', payload = jsonb_build_object('booking_reference', payload->>'booking_reference', 'status', 'cancelled') WHERE id = $1",
      [ids[0].id],
    ),
  );
});

/* -------------------------------------------------------------------------- */
/* RLS and privileges                                                         */
/* -------------------------------------------------------------------------- */

test("RLS is enabled with no policies and no client grants", async () => {
  const { rows: rls } = await db.query<{ relrowsecurity: boolean }>(
    "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_outbox'::regclass",
  );
  assert.equal(rls[0].relrowsecurity, true);

  const { rows: policies } = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM pg_policy WHERE polrelid = 'public.email_outbox'::regclass",
  );
  assert.equal(policies[0].count, 0);

  const { rows: grants } = await db.query<Record<string, boolean>>(
    `SELECT
        has_table_privilege('anon', 'public.email_outbox', 'SELECT') AS anon_select,
        has_table_privilege('anon', 'public.email_outbox', 'INSERT') AS anon_insert,
        has_table_privilege('anon', 'public.email_outbox', 'UPDATE') AS anon_update,
        has_table_privilege('anon', 'public.email_outbox', 'DELETE') AS anon_delete,
        has_table_privilege('authenticated', 'public.email_outbox', 'SELECT') AS auth_select,
        has_table_privilege('authenticated', 'public.email_outbox', 'INSERT') AS auth_insert,
        has_table_privilege('authenticated', 'public.email_outbox', 'UPDATE') AS auth_update,
        has_table_privilege('authenticated', 'public.email_outbox', 'DELETE') AS auth_delete,
        has_table_privilege('service_role', 'public.email_outbox', 'SELECT') AS service_select,
        has_table_privilege('service_role', 'public.email_outbox', 'INSERT') AS service_insert`,
  );

  const row = grants[0];
  for (const key of [
    "anon_select",
    "anon_insert",
    "anon_update",
    "anon_delete",
    "auth_select",
    "auth_insert",
    "auth_update",
    "auth_delete",
  ]) {
    assert.equal(row[key], false, key);
  }
  assert.equal(row.service_select, true);
  assert.equal(row.service_insert, true);
});

test("client roles cannot select, insert, update or delete outbox rows", async () => {
  const booking = await insertBooking();
  const { rows: ids } = await db.query<{ id: string }>(
    "SELECT id FROM public.email_outbox WHERE booking_id = $1",
    [booking.id],
  );

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);

    await assert.rejects(
      db.query("SELECT * FROM public.email_outbox"),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "42501",
    );

    await assert.rejects(
      db.query(
        `INSERT INTO public.email_outbox (
           booking_id, booking_version, idempotency_key, template,
           recipient_email, payload
         ) VALUES ($1, 2, $2, 'booking_confirmed', $3, $4)`,
        [
          booking.id,
          `booking:${booking.id}:forged:${role}`,
          "forged@example.test",
          JSON.stringify({ booking_reference: booking.reference, status: "confirmed" }),
        ],
      ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "42501",
    );

    await assert.rejects(
      db.query("UPDATE public.email_outbox SET status = 'sent' WHERE id = $1", [
        ids[0].id,
      ]),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "42501",
    );

    await assert.rejects(
      db.query("DELETE FROM public.email_outbox WHERE id = $1", [ids[0].id]),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "42501",
    );

    await db.exec("RESET ROLE");
  }

  // The legitimate row is untouched.
  assert.equal((await outboxRows(booking.id)).length, 1);
});

test("client roles cannot execute the outbox trigger helpers", async () => {
  const { rows } = await db.query<Record<string, boolean>>(
    `SELECT
        has_function_privilege(
          'anon',
          'private.enqueue_booking_email(uuid,public.email_template,integer,text,text,text)',
          'EXECUTE'
        ) AS anon_execute,
        has_function_privilege(
          'authenticated',
          'private.enqueue_booking_email(uuid,public.email_template,integer,text,text,text)',
          'EXECUTE'
        ) AS auth_execute,
        has_function_privilege(
          'anon',
          'private.queue_booking_email()',
          'EXECUTE'
        ) AS anon_trigger_execute`,
  );

  assert.equal(rows[0].anon_execute, false);
  assert.equal(rows[0].auth_execute, false);
  assert.equal(rows[0].anon_trigger_execute, false);
});
