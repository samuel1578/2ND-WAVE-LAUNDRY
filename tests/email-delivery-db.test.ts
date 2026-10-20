import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Sprint 2D.2 delivery database tests.
 *
 * Applies every repository migration to a disposable in-process PostgreSQL
 * (PGlite/WASM) and exercises the real claim/reap/completion functions, the
 * delivery-event constraints and the privilege boundary.
 *
 * Supabase-only infrastructure is stubbed exactly as in the Sprint 2D.1
 * integration test. Nothing here contacts Brevo or sends email.
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

  actor = randomUUID();
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    actor,
    "admin@example.test",
  ]);
  await db.query(
    "INSERT INTO public.admin_profiles (user_id, role, display_name) VALUES ($1, 'full_admin', 'Test Admin')",
    [actor],
  );

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

async function createBooking(): Promise<string> {
  const { rows } = await db.query<{ result: { booking_id: string } }>(
    `SELECT public.booking_submit(
              $1::jsonb, $2::jsonb, $3, 'public_booking_form', $4
            ) AS result`,
    [
      JSON.stringify(payload()),
      JSON.stringify(["wash-ironing-fold"]),
      randomUUID(),
      randomUUID(),
    ],
  );
  return rows[0].result.booking_id;
}

async function outboxFor(bookingId: string) {
  const { rows } = await db.query<{
    id: string;
    status: string;
    attempt_count: number;
    max_attempts: number;
    locked_by: string | null;
    lease_expires_at: string | null;
    next_attempt_at: string;
    provider_message_id: string | null;
    last_error: string | null;
  }>(
    `SELECT id, status::text, attempt_count, max_attempts, locked_by,
            lease_expires_at::text, next_attempt_at::text,
            provider_message_id, last_error
     FROM public.email_outbox WHERE booking_id = $1`,
    [bookingId],
  );
  return rows[0];
}

async function claim(worker: string, limit = 10) {
  const { rows } = await db.query<{
    id: string;
    status: string;
    attempt_count: number;
    locked_by: string;
    lease_expires_at: string;
    last_attempt_at: string | null;
  }>(
    "SELECT id, status::text, attempt_count, locked_by, lease_expires_at::text, last_attempt_at::text FROM public.email_outbox_claim($1, $2, 120)",
    [worker, limit],
  );
  return rows;
}

async function queueBooking() {
  const bookingId = await createBooking();
  const row = await outboxFor(bookingId);
  return { bookingId, id: row.id };
}

/* -------------------------------------------------------------------------- */
/* Claiming and completion                                                    */
/* -------------------------------------------------------------------------- */

test("claim leases a due row exactly once and increments its attempt", async () => {
  const { id } = await queueBooking();

  const first = await claim("worker-a");
  assert.equal(first.length, 1);
  assert.equal(first[0].id, id);
  assert.equal(first[0].status, "sending");
  assert.equal(first[0].attempt_count, 1);
  assert.equal(first[0].locked_by, "worker-a");
  assert.ok(first[0].last_attempt_at);

  // The active lease excludes a concurrent worker.
  assert.equal((await claim("worker-b")).length, 0);
});

test("mark_sent records the provider id only for the owning worker", async () => {
  const { bookingId, id } = await queueBooking();
  await claim("worker-a");

  const { rows: wrong } = await db.query<{ result: boolean }>(
    "SELECT public.email_outbox_mark_sent($1, 'worker-b', 'provider-1') AS result",
    [id],
  );
  assert.equal(wrong[0].result, false);

  const { rows: right } = await db.query<{ result: boolean }>(
    "SELECT public.email_outbox_mark_sent($1, 'worker-a', 'provider-1') AS result",
    [id],
  );
  assert.equal(right[0].result, true);

  const row = await outboxFor(bookingId);
  assert.equal(row.status, "sent");
  assert.equal(row.provider_message_id, "provider-1");
  assert.equal(row.locked_by, null);
  assert.equal(row.lease_expires_at, null);

  // A second completion cannot overwrite the sent row.
  const { rows: again } = await db.query<{ result: boolean }>(
    "SELECT public.email_outbox_mark_sent($1, 'worker-a', 'provider-2') AS result",
    [id],
  );
  assert.equal(again[0].result, false);
});

test("a terminal provider rejection dead-letters after one attempt", async () => {
  const { bookingId, id } = await queueBooking();
  await claim("worker-a");

  const { rows } = await db.query<{ result: boolean }>(
    `SELECT public.email_outbox_mark_dead(
              $1, 'worker-a', 'brevo_http_401_unauthorized'
            ) AS result`,
    [id],
  );
  assert.equal(rows[0].result, true);

  const row = await outboxFor(bookingId);
  assert.equal(row.status, "dead");
  assert.equal(row.attempt_count, 1);
  assert.equal(row.last_error, "brevo_http_401_unauthorized");
});

test("a retryable failure schedules the row and clears the lease", async () => {
  const { bookingId, id } = await queueBooking();
  await claim("worker-a");

  const { rows } = await db.query<{ result: string }>(
    `SELECT public.email_outbox_mark_retry(
              $1, 'worker-a', 'brevo_http_500_internal_error', 60
            )::text AS result`,
    [id],
  );
  assert.equal(rows[0].result, "retryable_failed");

  const row = await outboxFor(bookingId);
  assert.equal(row.status, "retryable_failed");
  assert.equal(row.last_error, "brevo_http_500_internal_error");
  assert.equal(row.locked_by, null);
  assert.equal(row.lease_expires_at, null);
  assert.ok(
    new Date(row.next_attempt_at).getTime() > Date.now(),
    "the row is not immediately eligible",
  );

  assert.equal((await claim("worker-b")).length, 0);
});

test("an exhausted retry budget terminates the row", async () => {
  const { bookingId, id } = await queueBooking();
  await db.query("UPDATE public.email_outbox SET max_attempts = 1 WHERE id = $1", [
    id,
  ]);
  await claim("worker-a");

  const { rows } = await db.query<{ result: string }>(
    `SELECT public.email_outbox_mark_retry(
              $1, 'worker-a', 'brevo_http_503_unavailable', 60
            )::text AS result`,
    [id],
  );
  assert.equal(rows[0].result, "dead");
  assert.equal((await outboxFor(bookingId)).status, "dead");
});

test("an abandoned lease is recovered by reap and can be reclaimed", async () => {
  const { bookingId, id } = await queueBooking();
  await claim("worker-a");

  await db.query(
    `UPDATE public.email_outbox
     SET locked_at = now() - interval '10 minutes',
         lease_expires_at = now() - interval '1 minute'
     WHERE id = $1`,
    [id],
  );

  const { rows } = await db.query<{ result: number }>(
    "SELECT public.email_outbox_reap(10) AS result",
  );
  assert.equal(Number(rows[0].result), 1);

  const recovered = await outboxFor(bookingId);
  assert.equal(recovered.status, "retryable_failed");
  assert.equal(recovered.locked_by, null);
  assert.match(recovered.last_error ?? "", /LEASE_EXPIRED/);

  await db.query(
    "UPDATE public.email_outbox SET next_attempt_at = now() - interval '1 second' WHERE id = $1",
    [id],
  );
  const reclaimed = await claim("worker-b");
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].locked_by, "worker-b");
});

test("reap dead-letters an abandoned row at its attempt limit", async () => {
  const { bookingId, id } = await queueBooking();
  await db.query("UPDATE public.email_outbox SET max_attempts = 1 WHERE id = $1", [
    id,
  ]);
  await claim("worker-a");
  await db.query(
    `UPDATE public.email_outbox
     SET locked_at = now() - interval '10 minutes',
         lease_expires_at = now() - interval '1 minute'
     WHERE id = $1`,
    [id],
  );

  await db.query("SELECT public.email_outbox_reap(10)");
  assert.equal((await outboxFor(bookingId)).status, "dead");
});

test("claim arguments are bounded and a worker id is required", async () => {
  await assert.rejects(
    db.query("SELECT public.email_outbox_claim('', 10, 120)"),
    /EMAIL_WORKER_ID/,
  );
  await assert.rejects(
    db.query("SELECT public.email_outbox_claim('worker', 0, 120)"),
    /EMAIL_WORKER_LIMIT/,
  );
  await assert.rejects(
    db.query("SELECT public.email_outbox_claim('worker', 10, 5)"),
    /EMAIL_WORKER_LEASE/,
  );
});

/* -------------------------------------------------------------------------- */
/* Delivery events                                                            */
/* -------------------------------------------------------------------------- */

test("delivery events are append-only, deduplicated and minimal", async () => {
  const { id } = await queueBooking();
  const dedupe = createHash("sha256").update(`event:${id}`).digest("hex");

  await db.query(
    `INSERT INTO public.email_delivery_events (outbox_id, event, dedupe_key, reason)
     VALUES ($1, 'delivered', $2, NULL)`,
    [id, dedupe],
  );

  await assert.rejects(
    db.query(
      `INSERT INTO public.email_delivery_events (outbox_id, event, dedupe_key)
       VALUES ($1, 'delivered', $2)`,
      [id, dedupe],
    ),
    /email_delivery_events_dedupe_unique/,
  );

  await assert.rejects(
    db.query(
      "UPDATE public.email_delivery_events SET event = 'bounced' WHERE dedupe_key = $1",
      [dedupe],
    ),
    /DELIVERY_EVENTS_IMMUTABLE/,
  );

  const { rows } = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM public.email_delivery_events WHERE outbox_id = $1",
    [id],
  );
  assert.equal(rows[0].count, 1);

  // Removing the outbox row removes its events (retention cascade).
  await db.query("DELETE FROM public.email_outbox WHERE id = $1", [id]);
  const { rows: after } = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM public.email_delivery_events WHERE outbox_id = $1",
    [id],
  );
  assert.equal(after[0].count, 0);
});

test("delivery event reasons are bounded and single-line", async () => {
  const { id } = await queueBooking();
  const digest = (label: string) =>
    createHash("sha256").update(label).digest("hex");

  await assert.rejects(
    db.query(
      `INSERT INTO public.email_delivery_events (outbox_id, event, dedupe_key, reason)
       VALUES ($1, 'bounced', $2, $3)`,
      [id, digest("long"), "x".repeat(201)],
    ),
    /email_delivery_events_reason/,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO public.email_delivery_events (outbox_id, event, dedupe_key, reason)
       VALUES ($1, 'bounced', $2, $3)`,
      [id, digest("newline"), "first line\nsecond line"],
    ),
    /email_delivery_events_reason/,
  );
});

/* -------------------------------------------------------------------------- */
/* Privileges                                                                 */
/* -------------------------------------------------------------------------- */

test("delivery tables and functions stay outside the client boundary", async () => {
  const { rows } = await db.query<Record<string, boolean>>(
    `SELECT
        c.relrowsecurity AS events_rls,
        (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) = 0 AS no_policies,
        has_table_privilege('anon', 'public.email_delivery_events', 'SELECT') AS anon_select,
        has_table_privilege('anon', 'public.email_delivery_events', 'INSERT') AS anon_insert,
        has_table_privilege('authenticated', 'public.email_delivery_events', 'SELECT') AS auth_select,
        has_table_privilege('authenticated', 'public.email_delivery_events', 'INSERT') AS auth_insert,
        has_table_privilege('service_role', 'public.email_delivery_events', 'SELECT') AS service_select,
        has_table_privilege('service_role', 'public.email_delivery_events', 'INSERT') AS service_insert,
        has_function_privilege('anon', 'public.email_outbox_claim(text,integer,integer)', 'EXECUTE') AS anon_claim,
        has_function_privilege('authenticated', 'public.email_outbox_claim(text,integer,integer)', 'EXECUTE') AS auth_claim,
        has_function_privilege('service_role', 'public.email_outbox_claim(text,integer,integer)', 'EXECUTE') AS service_claim,
        has_function_privilege('anon', 'public.email_outbox_reap(integer)', 'EXECUTE') AS anon_reap,
        has_function_privilege('authenticated', 'public.email_outbox_mark_sent(uuid,text,text)', 'EXECUTE') AS auth_mark_sent,
        has_function_privilege('anon', 'public.email_outbox_mark_retry(uuid,text,text,integer)', 'EXECUTE') AS anon_mark_retry,
        has_function_privilege('service_role', 'public.email_outbox_mark_dead(uuid,text,text)', 'EXECUTE') AS service_mark_dead,
        has_function_privilege('anon', 'public.email_outbox_manual_retry(uuid,uuid)', 'EXECUTE') AS anon_manual_retry,
        has_function_privilege('authenticated', 'public.email_outbox_manual_retry(uuid,uuid)', 'EXECUTE') AS auth_manual_retry,
        has_function_privilege('service_role', 'public.email_outbox_manual_retry(uuid,uuid)', 'EXECUTE') AS service_manual_retry
     FROM pg_class c WHERE c.oid = 'public.email_delivery_events'::regclass`,
  );

  assert.equal(rows[0].events_rls, true);
  assert.equal(rows[0].no_policies, true);
  assert.equal(rows[0].anon_select, false);
  assert.equal(rows[0].anon_insert, false);
  assert.equal(rows[0].auth_select, false);
  assert.equal(rows[0].auth_insert, false);
  assert.equal(rows[0].service_select, true);
  assert.equal(rows[0].service_insert, true);
  assert.equal(rows[0].anon_claim, false);
  assert.equal(rows[0].auth_claim, false);
  assert.equal(rows[0].service_claim, true);
  assert.equal(rows[0].anon_reap, false);
  assert.equal(rows[0].auth_mark_sent, false);
  assert.equal(rows[0].anon_mark_retry, false);
  assert.equal(rows[0].service_mark_dead, true);
  assert.equal(rows[0].anon_manual_retry, false);
  assert.equal(rows[0].auth_manual_retry, false);
  assert.equal(rows[0].service_manual_retry, true);
});

test("a dead row must have been attempted at least once", async () => {
  const { id } = await queueBooking();
  await assert.rejects(
    db.query(
      "UPDATE public.email_outbox SET status = 'dead', attempt_count = 0 WHERE id = $1",
      [id],
    ),
    /email_outbox_dead_attempts/,
  );
});

test("manual retry preserves the same event and audits a Full Admin action", async () => {
  const { id } = await queueBooking();
  await db.query(
    `UPDATE public.email_outbox
     SET status = 'sending', attempt_count = 1, locked_at = now(),
         locked_by = 'manual-retry-test',
         lease_expires_at = now() + interval '2 minutes'
     WHERE id = $1`,
    [id],
  );
  await db.query(
    "SELECT public.email_outbox_mark_dead($1, $2, 'provider_rejected')",
    [id, "manual-retry-test"],
  );

  const operationalId = randomUUID();
  await db.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, 'ops@example.test')",
    [operationalId],
  );
  await db.query(
    "INSERT INTO public.admin_profiles (user_id, role, display_name) VALUES ($1, 'operational_admin', 'Ops')",
    [operationalId],
  );
  await assert.rejects(
    db.query("SELECT public.email_outbox_manual_retry($1, $2)", [
      id,
      operationalId,
    ]),
    /active Full Admin is required/,
  );

  const retried = await db.query<{ result: boolean }>(
    "SELECT public.email_outbox_manual_retry($1, $2) AS result",
    [id, actor],
  );
  assert.equal(retried.rows[0].result, true);

  const booking = (await db.query<{ booking_id: string }>(
    "SELECT booking_id FROM public.email_outbox WHERE id = $1",
    [id],
  )).rows[0];
  const row = await outboxFor(booking.booking_id);
  assert.equal(row.status, "pending");
  assert.equal(row.attempt_count, 1);
  assert.equal(row.max_attempts, 6);

  const audit = await db.query<{
    action: string;
    entity_id: string;
    before_state: { status: string };
    after_state: { status: string };
  }>(
    "SELECT action, entity_id, before_state, after_state FROM public.audit_events WHERE entity_id = $1",
    [id],
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].action, "email.manual_retry");
  assert.equal(audit.rows[0].before_state.status, "dead");
  assert.equal(audit.rows[0].after_state.status, "pending");
});
