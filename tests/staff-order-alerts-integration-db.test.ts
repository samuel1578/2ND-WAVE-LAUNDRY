import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Phase 2E acceptance: end-to-end database tests through the real trusted
 * functions.
 *
 * Every repository migration is applied in order to a disposable in-process
 * PostgreSQL (PGlite/WASM), and the tests then drive the actual
 * `booking_submit`, `booking_update_arrangement` and `booking_transition`
 * functions. That is the same code path the application uses, so the five staff
 * alerts are verified at their authoritative source rather than through a
 * hand-written status update.
 *
 * Supabase-only infrastructure is stubbed exactly as in
 * `email-outbox-integration-db.test.ts`: `auth.users` and an `auth.uid()`
 * returning NULL (the functions take and re-validate an explicit actor), plus an
 * empty `storage.buckets`. RLS policies, grants, triggers, deferred constraints
 * and PL/pgSQL are the real deployed objects.
 *
 * No network call and no email is involved. This is code-level verification
 * only; the Brevo account and its templates are not touched.
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
    "INSERT INTO public.admin_profiles (user_id, role, display_name, email) VALUES ($1, 'full_admin', 'Test Admin', 'admin@example.test')",
    [actor],
  );

  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM public.branches ORDER BY sort_order LIMIT 1",
  );
  branchId = rows[0].id;
});

after(async () => {
  await db.close();
});

/** Each test starts from an empty booking and recipient state. */
beforeEach(async () => {
  await db.exec("TRUNCATE TABLE public.bookings CASCADE");
  await db.exec("DELETE FROM public.booking_alert_recipients");
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

async function submit(data: BookingPayload = payload(), key = randomUUID()) {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.booking_submit(
              $1::jsonb, $2::jsonb, $3, 'public_booking_form', $4
            ) AS result`,
    [JSON.stringify(data), JSON.stringify(["wash-ironing-fold"]), key, randomUUID()],
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

async function addRecipient(email: string, enabled = true) {
  await db.query(
    `INSERT INTO public.booking_alert_recipients (email, label, enabled)
     VALUES ($1, 'Operations', $2)`,
    [email.toLowerCase(), enabled],
  );
}

type OutboxRow = {
  template: string;
  recipient_email: string;
  booking_version: number;
  idempotency_key: string;
  payload: Record<string, string>;
};

async function rowsFor(bookingId: string, prefix = ""): Promise<OutboxRow[]> {
  const { rows } = await db.query<OutboxRow>(
    `SELECT template::text, recipient_email, booking_version,
            idempotency_key, payload
     FROM public.email_outbox
     WHERE booking_id = $1 AND template::text LIKE $2
     ORDER BY template::text, recipient_email`,
    [bookingId, `${prefix}%`],
  );
  return rows;
}

const staffFor = (bookingId: string) => rowsFor(bookingId, "staff_order_");

/* -------------------------------------------------------------------------- */
/* Order placed                                                               */
/* -------------------------------------------------------------------------- */

test("a real submission fans the pending alert out to every enabled recipient", async () => {
  await addRecipient("Ops.One@2ndwave.example");
  await addRecipient("ops.two@2ndwave.example");
  await addRecipient("ops.disabled@2ndwave.example", false);

  const created = await submit();

  const staff = await staffFor(created.booking_id);
  assert.equal(staff.length, 2);
  assert.deepEqual(
    staff.map((row) => row.recipient_email).sort(),
    ["ops.one@2ndwave.example", "ops.two@2ndwave.example"],
  );

  for (const row of staff) {
    assert.equal(row.template, "staff_order_pending");
    assert.equal(row.booking_version, 1);
    assert.equal(row.payload.booking_reference, created.reference);
    assert.equal(row.payload.status, "pending");
    assert.equal(row.payload.previous_status, "");
    assert.equal(row.payload.actor_kind, "customer");
    assert.equal(row.payload.actor_name, "Ama Mensah");
    assert.equal(row.payload.actor_role, "");
    assert.equal(row.payload.cancellation_reason, "");
    assert.match(
      row.payload.occurred_at,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
  }

  // Distinct deterministic keys: fan-out is not a duplicate, replay is.
  assert.equal(new Set(staff.map((row) => row.idempotency_key)).size, 2);

  // Phase 2D customer mail is still exactly one row with its two-key payload.
  const customer = await rowsFor(created.booking_id, "booking_created");
  assert.equal(customer.length, 1);
  assert.equal(customer[0].recipient_email, "ama@example.test");
  assert.deepEqual(Object.keys(customer[0].payload).sort(), [
    "booking_reference",
    "status",
  ]);
});

test("replaying the submission key adds no second alert", async () => {
  await addRecipient("ops.one@2ndwave.example");
  await addRecipient("ops.two@2ndwave.example");

  const key = randomUUID();
  const first = await submit(payload(), key);
  const second = await submit(payload(), key);

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.booking_id, first.booking_id);
  assert.equal((await staffFor(first.booking_id)).length, 2);
  assert.equal((await rowsFor(first.booking_id, "booking_created")).length, 1);
});

/* -------------------------------------------------------------------------- */
/* Genuine transitions                                                        */
/* -------------------------------------------------------------------------- */

test("the real lifecycle sends each staff event once and none for intermediate states", async () => {
  await addRecipient("ops@2ndwave.example");
  const created = await submit();
  const id = created.booking_id;

  let version = await arrange(id, 1);
  assert.equal(version, 2);
  version = await transition(id, version, "confirmed");
  version = await transition(id, version, "picked_up");
  version = await transition(id, version, "processing");
  version = await transition(id, version, "ready");
  version = await transition(id, version, "completed");

  const staff = await staffFor(id);
  assert.deepEqual(
    staff.map((row) => row.template),
    [
      "staff_order_completed",
      "staff_order_pending",
      "staff_order_processing",
      "staff_order_ready",
    ],
  );

  // Exactly one row per event per recipient: no duplicated transition alerts.
  assert.equal(new Set(staff.map((row) => row.template)).size, staff.length);

  const byTemplate = new Map(staff.map((row) => [row.template, row]));
  // The real lifecycle reaches processing through pickup, and the alert reports
  // the committed previous status rather than a client-supplied one.
  assert.equal(byTemplate.get("staff_order_processing")?.payload.previous_status, "picked_up");
  assert.equal(byTemplate.get("staff_order_ready")?.payload.previous_status, "processing");
  assert.equal(byTemplate.get("staff_order_completed")?.payload.previous_status, "ready");

  for (const template of [
    "staff_order_processing",
    "staff_order_ready",
    "staff_order_completed",
  ]) {
    const row = byTemplate.get(template);
    assert.ok(row, template);
    assert.equal(row.payload.actor_kind, "admin", template);
    assert.equal(row.payload.actor_name, "Test Admin", template);
    assert.equal(row.payload.actor_role, "full_admin", template);
    assert.equal(row.payload.status, template.replace("staff_order_", ""), template);
    assert.equal(row.payload.cancellation_reason, "", template);
  }

  // Customer Phase 2D notifications are unchanged and independent.
  assert.deepEqual(
    (await rowsFor(id, "booking_")).map((row) => row.template),
    [
      "booking_completed",
      "booking_confirmed",
      "booking_created",
      "booking_processing_started",
      "booking_ready",
    ],
  );
});

test("a real cancellation carries the recorded reason and the verified actor", async () => {
  await addRecipient("ops@2ndwave.example");
  const created = await submit();

  await transition(created.booking_id, 1, "cancelled", "Customer changed plans");

  const staff = await staffFor(created.booking_id);
  const cancellation = staff.find((row) => row.template === "staff_order_cancelled");
  assert.ok(cancellation);
  assert.equal(cancellation.payload.cancellation_reason, "Customer changed plans");
  assert.equal(cancellation.payload.previous_status, "pending");
  assert.equal(cancellation.payload.actor_kind, "admin");
  assert.equal(cancellation.payload.actor_name, "Test Admin");
  assert.equal(cancellation.payload.actor_role, "full_admin");

  assert.deepEqual(
    (await rowsFor(created.booking_id, "booking_")).map((row) => row.template),
    ["booking_cancelled", "booking_created"],
  );
});

test("a rejected transition queues no staff alert", async () => {
  await addRecipient("ops@2ndwave.example");
  const created = await submit();

  await assert.rejects(
    transition(created.booking_id, 1, "completed"),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P0001",
  );

  assert.deepEqual(
    (await staffFor(created.booking_id)).map((row) => row.template),
    ["staff_order_pending"],
  );

  const { rows } = await db.query<{ status: string; version: number }>(
    "SELECT status::text, version FROM public.bookings WHERE id = $1",
    [created.booking_id],
  );
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].version, 1);
});

/* -------------------------------------------------------------------------- */
/* Auditability                                                               */
/* -------------------------------------------------------------------------- */

test("the persisted history and audit trail identify the actor and time", async () => {
  const created = await submit();
  await transition(created.booking_id, 1, "cancelled", "Customer changed plans");

  const { rows: history } = await db.query<{
    from_status: string;
    to_status: string;
    actor_id: string;
    actor_kind: string;
    reason: string;
    created_at: string;
    booking_reference: string;
  }>(
    `SELECT h.from_status::text, h.to_status::text, h.actor_id, h.actor_kind,
            h.reason, h.created_at, b.reference AS booking_reference
     FROM public.booking_status_history AS h
     JOIN public.bookings AS b ON b.id = h.booking_id
     WHERE h.booking_id = $1
     ORDER BY h.id`,
    [created.booking_id],
  );

  assert.equal(history.length, 2);
  assert.equal(history[0].to_status, "pending");
  assert.equal(history[0].actor_kind, "customer");
  assert.equal(history[0].actor_id, null);
  assert.equal(history[0].booking_reference, created.reference);

  assert.equal(history[1].from_status, "pending");
  assert.equal(history[1].to_status, "cancelled");
  assert.equal(history[1].actor_kind, "admin");
  assert.equal(history[1].actor_id, actor);
  assert.equal(history[1].reason, "Customer changed plans");
  assert.ok(Number.isFinite(Date.parse(history[1].created_at)));

  const { rows: audit } = await db.query<{
    action: string;
    actor_id: string;
    entity_id: string;
    reason: string;
    created_at: string;
  }>(
    `SELECT action, actor_id, entity_id, reason, created_at
     FROM public.audit_events
     WHERE entity_type = 'booking' AND entity_id = $1
     ORDER BY id`,
    [created.booking_id],
  );

  assert.deepEqual(
    audit.map((row) => row.action),
    ["booking.created", "booking.cancelled"],
  );
  assert.equal(audit[0].actor_id, null);
  assert.equal(audit[1].actor_id, actor);
  assert.equal(audit[1].reason, "Customer changed plans");
  assert.ok(Number.isFinite(Date.parse(audit[1].created_at)));
});

/* -------------------------------------------------------------------------- */
/* Recipient list changes                                                     */
/* -------------------------------------------------------------------------- */

test("recipient changes apply to subsequent events only", async () => {
  const first = "ops.one@2ndwave.example";
  const second = "ops.two@2ndwave.example";
  await addRecipient(first);

  const created = await submit();
  assert.deepEqual(
    (await staffFor(created.booking_id)).map((row) => row.recipient_email),
    [first],
  );

  await addRecipient(second);
  let version = await arrange(created.booking_id, 1);
  version = await transition(created.booking_id, version, "confirmed");
  version = await transition(created.booking_id, version, "picked_up");
  version = await transition(created.booking_id, version, "processing");

  const processing = (await staffFor(created.booking_id)).filter(
    (row) => row.template === "staff_order_processing",
  );
  assert.deepEqual(
    processing.map((row) => row.recipient_email).sort(),
    [first, second],
  );

  // The earlier pending alert is never resent to the new address.
  assert.deepEqual(
    (await staffFor(created.booking_id))
      .filter((row) => row.template === "staff_order_pending")
      .map((row) => row.recipient_email),
    [first],
  );

  await db.query("DELETE FROM public.booking_alert_recipients WHERE email = $1", [
    second,
  ]);
  version = await transition(created.booking_id, version, "ready");
  assert.ok(version > 0);

  const ready = (await staffFor(created.booking_id)).filter(
    (row) => row.template === "staff_order_ready",
  );
  assert.deepEqual(
    ready.map((row) => row.recipient_email),
    [first],
  );

  // Renaming an address never rewrites a queued message.
  await db.query(
    "UPDATE public.booking_alert_recipients SET email = 'renamed@2ndwave.example' WHERE email = $1",
    [first],
  );
  const pending = (await staffFor(created.booking_id)).filter(
    (row) => row.template === "staff_order_pending",
  );
  assert.deepEqual(
    pending.map((row) => row.recipient_email),
    [first],
  );
});

test("an empty central list queues nothing and never blocks the order", async () => {
  const created = await submit();

  assert.equal(created.status, "pending");
  assert.equal((await staffFor(created.booking_id)).length, 0);
  assert.equal((await rowsFor(created.booking_id, "booking_created")).length, 1);
});

/* -------------------------------------------------------------------------- */
/* Security                                                                   */
/* -------------------------------------------------------------------------- */

test("the central recipient list is denied to every client role", async () => {
  const { rows } = await db.query<Record<string, boolean>>(
    `SELECT
        has_table_privilege('anon', 'public.booking_alert_recipients', 'SELECT') AS anon_select,
        has_table_privilege('anon', 'public.booking_alert_recipients', 'INSERT') AS anon_insert,
        has_table_privilege('authenticated', 'public.booking_alert_recipients', 'SELECT') AS auth_select,
        has_table_privilege('authenticated', 'public.booking_alert_recipients', 'INSERT') AS auth_insert,
        has_table_privilege('authenticated', 'public.booking_alert_recipients', 'UPDATE') AS auth_update,
        has_table_privilege('authenticated', 'public.booking_alert_recipients', 'DELETE') AS auth_delete,
        has_table_privilege('service_role', 'public.booking_alert_recipients', 'SELECT') AS service_select`,
  );

  assert.equal(rows[0].anon_select, false);
  assert.equal(rows[0].anon_insert, false);
  assert.equal(rows[0].auth_select, false);
  assert.equal(rows[0].auth_insert, false);
  assert.equal(rows[0].auth_update, false);
  assert.equal(rows[0].auth_delete, false);
  assert.equal(rows[0].service_select, true);

  // The enqueue helper remains trigger-only.
  const { rows: functions } = await db.query<Record<string, boolean>>(
    `SELECT
        has_function_privilege(
          'anon',
          'private.enqueue_staff_order_alert(uuid,public.email_template,integer,text,text,uuid,text)',
          'EXECUTE'
        ) AS anon_enqueue,
        has_function_privilege(
          'authenticated',
          'private.enqueue_staff_order_alert(uuid,public.email_template,integer,text,text,uuid,text)',
          'EXECUTE'
        ) AS auth_enqueue`,
  );
  assert.equal(functions[0].anon_enqueue, false);
  assert.equal(functions[0].auth_enqueue, false);
});
