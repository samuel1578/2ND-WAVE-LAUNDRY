import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * Phase 2E.1 staff/admin order alert database tests.
 *
 * Runs the real forward-only migrations against an in-process disposable
 * PostgreSQL (PGlite/WASM). This exercises the deployed behaviour: the shared
 * outbox, the deferred booking triggers, status/version validation, trusted
 * actor resolution, per-recipient idempotency and recipient-list semantics.
 *
 * It is not the hosted Supabase stack, so a minimal Sprint 2A harness supplies
 * the booking, history and administrator profile tables the triggers read.
 * No network call and no email is involved.
 */

const OUTBOX_MIGRATION = "supabase/migrations/20261019120000_email_outbox.sql";
const RECIPIENTS_MIGRATION =
  "supabase/migrations/20261022120000_booking_alert_recipients.sql";
const STAFF_ALERTS_MIGRATION =
  "supabase/migrations/20261022120100_staff_order_email_alerts.sql";

const HARNESS = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA private;

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

REVOKE ALL ON FUNCTION private.touch_updated_at() FROM PUBLIC, anon, authenticated;

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

CREATE TABLE public.bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference text NOT NULL UNIQUE,
    customer_name text NOT NULL DEFAULT 'Ama Mensah',
    customer_email text,
    status public.booking_status NOT NULL DEFAULT 'pending',
    version integer NOT NULL DEFAULT 1,
    requested_date date,
    requested_time time,
    agreed_pickup_at timestamptz,
    agreed_fee numeric,
    agreed_fee_currency text,
    assigned_branch_id uuid,
    cancellation_reason text,
    cancelled_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER bookings_touch
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION private.touch_updated_at();

CREATE TABLE public.booking_status_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id uuid NOT NULL
        REFERENCES public.bookings(id) ON DELETE CASCADE,
    from_status public.booking_status,
    to_status public.booking_status NOT NULL,
    actor_id uuid,
    actor_kind text NOT NULL DEFAULT 'admin',
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT booking_status_history_actor_kind
        CHECK (actor_kind IN ('customer', 'system', 'admin'))
);

-- The real profile role is an enum. Keeping it typed faithfully here means a
-- text/enum mismatch in the trigger fails this focused test too, instead of only
-- appearing against the full schema in the integration test.
CREATE TYPE public.admin_role AS ENUM ('full_admin', 'operational_admin');

CREATE TABLE public.admin_profiles (
    user_id uuid PRIMARY KEY,
    role public.admin_role,
    display_name text NOT NULL DEFAULT '',
    email text,
    disabled_at timestamptz
);
`;

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(HARNESS);
  await db.exec(readFileSync(OUTBOX_MIGRATION, "utf8"));
  await db.exec(readFileSync(RECIPIENTS_MIGRATION, "utf8"));
  await db.exec(readFileSync(STAFF_ALERTS_MIGRATION, "utf8"));
});

after(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(
    "TRUNCATE TABLE public.email_outbox, public.booking_status_history, public.bookings, public.booking_alert_recipients, public.admin_profiles CASCADE",
  );
});

type NewBooking = {
  id?: string;
  reference?: string;
  customerName?: string;
  email?: string | null;
};

function reference(): string {
  return `2W-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

/**
 * Mirrors `public.booking_submit`: the booking insert and its initial history
 * row commit in one transaction, which is what the deferred trigger reads.
 */
async function createBooking(overrides: NewBooking = {}) {
  const booking = {
    id: overrides.id ?? randomUUID(),
    reference: overrides.reference ?? reference(),
    customerName: overrides.customerName ?? "Ama Mensah",
    email: overrides.email === undefined ? "Customer@Example.test" : overrides.email,
  };

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO public.bookings
         (id, reference, customer_name, customer_email, status, version)
       VALUES ($1, $2, $3, $4, 'pending', 1)`,
      [booking.id, booking.reference, booking.customerName, booking.email],
    );
    await tx.query(
      `INSERT INTO public.booking_status_history
         (booking_id, from_status, to_status, actor_id, actor_kind)
       VALUES ($1, NULL, 'pending', NULL, 'customer')`,
      [booking.id],
    );
  });

  return booking;
}

/** Mirrors `public.booking_transition`: status update + history in one transaction. */
async function transition(
  bookingId: string,
  next: string,
  options: {
    reason?: string | null;
    actorId?: string | null;
    actorKind?: "admin" | "system" | "customer";
    fromStatus: string;
  },
) {
  const actorId = options.actorId ?? null;
  const actorKind = options.actorKind ?? (actorId ? "admin" : "system");

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE public.bookings
       SET status = $2::public.booking_status,
           version = version + 1,
           cancellation_reason = CASE
             WHEN $2 = 'cancelled' THEN $3 ELSE cancellation_reason END,
           cancelled_by = CASE
             WHEN $2 = 'cancelled' THEN $4::uuid ELSE cancelled_by END
       WHERE id = $1`,
      [bookingId, next, options.reason ?? null, actorId],
    );
    await tx.query(
      `INSERT INTO public.booking_status_history
         (booking_id, from_status, to_status, actor_id, actor_kind, reason)
       VALUES ($1, $2::public.booking_status, $3::public.booking_status, $4, $5, $6)`,
      [
        bookingId,
        options.fromStatus,
        next,
        actorId,
        actorKind,
        options.reason ?? null,
      ],
    );
  });
}

async function addRecipient(email: string, enabled = true) {
  await db.query(
    `INSERT INTO public.booking_alert_recipients (email, label, enabled)
     VALUES ($1, 'Operations', $2)`,
    [email.toLowerCase(), enabled],
  );
}

async function addAdmin(role: "full_admin" | "operational_admin" = "full_admin") {
  const userId = randomUUID();
  await db.query(
    `INSERT INTO public.admin_profiles (user_id, role, display_name, email)
     VALUES ($1, $2, 'Kofi Operator', 'kofi@2ndwave.example')`,
    [userId, role],
  );
  return userId;
}

type OutboxRow = {
  template: string;
  recipient_email: string;
  idempotency_key: string;
  payload: Record<string, string>;
  booking_version: number;
};

async function outbox(templatePrefix = ""): Promise<OutboxRow[]> {
  const { rows } = await db.query<OutboxRow>(
    `SELECT template, recipient_email, idempotency_key, payload, booking_version
     FROM public.email_outbox
     WHERE template::text LIKE $1
     ORDER BY template, recipient_email`,
    [`${templatePrefix}%`],
  );
  return rows;
}

const staffRows = () => outbox("staff_order_");

/* -------------------------------------------------------------------------- */
/* Order placed                                                               */
/* -------------------------------------------------------------------------- */

test("a newly placed order queues one pending alert per enabled recipient", async () => {
  await addRecipient("Ops.One@2ndwave.example");
  await addRecipient("ops.two@2ndwave.example");
  await addRecipient("ops.disabled@2ndwave.example", false);

  const booking = await createBooking();

  const staff = await staffRows();
  assert.equal(staff.length, 2);
  assert.deepEqual(
    staff.map((row) => row.recipient_email).sort(),
    ["ops.one@2ndwave.example", "ops.two@2ndwave.example"],
  );

  for (const row of staff) {
    assert.equal(row.template, "staff_order_pending");
    assert.equal(row.booking_version, 1);
    assert.equal(row.payload.booking_reference, booking.reference);
    assert.equal(row.payload.status, "pending");
    assert.equal(row.payload.previous_status, "");
    assert.equal(row.payload.actor_kind, "customer");
    assert.equal(row.payload.actor_name, booking.customerName);
    assert.equal(row.payload.actor_role, "");
    assert.equal(row.payload.cancellation_reason, "");
    assert.match(row.payload.occurred_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  }

  // Distinct per-recipient keys, so replay and fan-out are both deterministic.
  assert.equal(new Set(staff.map((row) => row.idempotency_key)).size, 2);

  // The Phase 2D customer notification is unchanged.
  const customer = await outbox("booking_created");
  assert.equal(customer.length, 1);
  assert.deepEqual(Object.keys(customer[0].payload).sort(), [
    "booking_reference",
    "status",
  ]);
});

test("an empty or fully disabled recipient list queues nothing and breaks nothing", async () => {
  await createBooking();

  assert.equal((await staffRows()).length, 0);

  await addRecipient("ops.disabled@2ndwave.example", false);
  const booking = await createBooking();

  // The booking itself still committed with its customer notification.
  assert.equal((await staffRows()).length, 0);
  assert.equal((await outbox("booking_created")).length, 2);
  assert.ok(booking.id);
});

/* -------------------------------------------------------------------------- */
/* Transitions                                                                */
/* -------------------------------------------------------------------------- */

test("each genuine status transition maps to the correct staff template", async () => {
  await addRecipient("ops@2ndwave.example");
  const booking = await createBooking();

  await transition(booking.id, "processing", { fromStatus: "pending" });
  let rows = (await staffRows()).filter((row) => row.template === "staff_order_processing");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.previous_status, "pending");
  assert.equal(rows[0].payload.status, "processing");

  await transition(booking.id, "ready", { fromStatus: "processing" });
  rows = (await staffRows()).filter((row) => row.template === "staff_order_ready");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.previous_status, "processing");

  await transition(booking.id, "completed", { fromStatus: "ready" });
  rows = (await staffRows()).filter((row) => row.template === "staff_order_completed");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.previous_status, "ready");

  // Intermediate lifecycle states deliberately produce no staff alert.
  assert.equal((await staffRows()).length, 4);
});

test("a cancellation alert carries only the recorded reason", async () => {
  await addRecipient("ops@2ndwave.example");
  const adminId = await addAdmin();

  const cancelled = await createBooking();
  await transition(cancelled.id, "cancelled", {
    fromStatus: "pending",
    reason: "Customer changed plans.",
    actorId: adminId,
  });

  const cancelRows = await staffRows();
  const cancellation = cancelRows.find(
    (row) => row.template === "staff_order_cancelled",
  );
  assert.ok(cancellation);
  assert.equal(cancellation.payload.cancellation_reason, "Customer changed plans.");
  assert.equal(cancellation.payload.actor_kind, "admin");
  assert.equal(cancellation.payload.actor_name, "Kofi Operator");
  assert.equal(cancellation.payload.actor_role, "full_admin");

  const other = await createBooking();
  await transition(other.id, "processing", {
    fromStatus: "pending",
    actorId: adminId,
    reason: "Internal note that must not leak into the alert.",
  });

  const processing = (await staffRows()).find(
    (row) => row.template === "staff_order_processing",
  );
  assert.ok(processing);
  assert.equal(processing.payload.cancellation_reason, "");
  assert.equal(processing.payload.previous_status, "pending");
});

test("a rolled-back order operation generates no alert", async () => {
  await addRecipient("ops@2ndwave.example");
  const booking = await createBooking();

  await db.exec("TRUNCATE TABLE public.email_outbox");

  await assert.rejects(async () => {
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE public.bookings SET status = 'processing', version = version + 1 WHERE id = $1",
        [booking.id],
      );
      await tx.query(
        `INSERT INTO public.booking_status_history
           (booking_id, from_status, to_status, actor_id, actor_kind)
         VALUES ($1, 'pending', 'processing', NULL, 'system')`,
        [booking.id],
      );
      throw new Error("simulated downstream failure");
    });
  }, /simulated downstream failure/);

  assert.equal((await staffRows()).length, 0);
  const { rows } = await db.query<{ status: string }>(
    "SELECT status FROM public.bookings WHERE id = $1",
    [booking.id],
  );
  assert.equal(rows[0].status, "pending");
});

test("an unchanged status produces no status-transition alert", async () => {
  await addRecipient("ops@2ndwave.example");
  const booking = await createBooking();

  await db.exec("TRUNCATE TABLE public.email_outbox");

  // Version change without a status change.
  await db.query("UPDATE public.bookings SET version = version + 1 WHERE id = $1", [
    booking.id,
  ]);
  // Explicit rewrite of the same status.
  await db.query(
    "UPDATE public.bookings SET status = 'pending', version = version + 1 WHERE id = $1",
    [booking.id],
  );

  assert.equal((await staffRows()).length, 0);
});

test("duplicate processing of the same event sends nothing further", async () => {
  await addRecipient("ops.one@2ndwave.example");
  await addRecipient("ops.two@2ndwave.example");
  const booking = await createBooking();
  await transition(booking.id, "processing", { fromStatus: "pending" });

  const before = (await staffRows()).length;
  assert.equal(before, 4); // two pending + two processing rows (one per recipient)

  const { rows } = await db.query<{ inserted: number }>(
    `SELECT private.enqueue_staff_order_alert(
        $1, 'staff_order_processing', 2, 'pending', 'system', NULL, NULL
     ) AS inserted`,
    [booking.id],
  );
  assert.equal(Number(rows[0].inserted), 0);
  assert.equal((await staffRows()).length, before);
});

test("an alert cannot be queued for a status the booking is not in", async () => {
  await addRecipient("ops@2ndwave.example");
  const booking = await createBooking();
  await transition(booking.id, "processing", { fromStatus: "pending" });

  await assert.rejects(
    () =>
      db.query(
        `SELECT private.enqueue_staff_order_alert(
            $1, 'staff_order_ready', 2, 'processing', 'system', NULL, NULL
         )`,
        [booking.id],
      ),
    /STAFF_ALERT_STATUS/,
  );

  await assert.rejects(
    () =>
      db.query(
        `SELECT private.enqueue_staff_order_alert(
            $1, 'staff_order_processing', 9, 'pending', 'system', NULL, NULL
         )`,
        [booking.id],
      ),
    /STAFF_ALERT_VERSION/,
  );

  await assert.rejects(
    () =>
      db.query(
        `SELECT private.enqueue_staff_order_alert(
            $1, 'booking_created', 2, NULL, 'system', NULL, NULL
         )`,
        [booking.id],
      ),
    /STAFF_ALERT_TEMPLATE/,
  );
});

/* -------------------------------------------------------------------------- */
/* Actor metadata                                                             */
/* -------------------------------------------------------------------------- */

test("administrator actor metadata is read from the trusted profile", async () => {
  await addRecipient("ops@2ndwave.example");
  const adminId = await addAdmin("operational_admin");

  const booking = await createBooking();
  await transition(booking.id, "ready", {
    fromStatus: "processing",
    actorId: adminId,
    actorKind: "admin",
  });

  const ready = (await staffRows()).find((row) => row.template === "staff_order_ready");
  assert.ok(ready);
  assert.equal(ready.payload.actor_kind, "admin");
  assert.equal(ready.payload.actor_name, "Kofi Operator");
  assert.equal(ready.payload.actor_role, "operational_admin");
});

test("an unverifiable administrator actor is not fabricated", async () => {
  await addRecipient("ops@2ndwave.example");
  const booking = await createBooking();

  // The trigger's failure isolation means the booking commits with no alert
  // rather than inventing an actor or rejecting the lifecycle operation.
  await transition(booking.id, "completed", {
    fromStatus: "ready",
    actorId: randomUUID(),
    actorKind: "admin",
  });

  const completed = (await staffRows()).filter(
    (row) => row.template === "staff_order_completed",
  );
  assert.equal(completed.length, 0);

  const { rows } = await db.query<{ status: string }>(
    "SELECT status FROM public.bookings WHERE id = $1",
    [booking.id],
  );
  assert.equal(rows[0].status, "completed");

  // Direct use of the helper also refuses to invent an identity.
  await assert.rejects(
    () =>
      db.query(
        `SELECT private.enqueue_staff_order_alert(
            $1, 'staff_order_completed', 2, 'pending', 'admin', $2, NULL
         )`,
        [booking.id, randomUUID()],
      ),
    /STAFF_ALERT_ACTOR/,
  );
});

test("a system actor is represented honestly", async () => {
  await addRecipient("ops@2ndwave.example");
  const booking = await createBooking();

  await transition(booking.id, "processing", {
    fromStatus: "pending",
    actorId: null,
    actorKind: "system",
  });

  const processing = (await staffRows()).find(
    (row) => row.template === "staff_order_processing",
  );
  assert.ok(processing);
  assert.equal(processing.payload.actor_kind, "system");
  assert.equal(processing.payload.actor_name, "");
  assert.equal(processing.payload.actor_role, "");
});

/* -------------------------------------------------------------------------- */
/* Recipient list                                                             */
/* -------------------------------------------------------------------------- */

test("the enabled recipient list is capped", async () => {
  for (let index = 0; index < 10; index += 1)
    await addRecipient(`ops.${index}@2ndwave.example`);

  await assert.rejects(() => addRecipient("ops.eleven@2ndwave.example"), /LIMIT/);

  // Disabled rows do not count against the cap.
  await addRecipient("ops.archived@2ndwave.example", false);
});

test("the recipient list is not readable or writable by a client role", async () => {
  const { rows } = await db.query<Record<string, boolean>>(
    `SELECT
        has_table_privilege('anon', 'public.booking_alert_recipients', 'SELECT') AS anon_select,
        has_table_privilege('authenticated', 'public.booking_alert_recipients', 'SELECT') AS auth_select,
        has_table_privilege('authenticated', 'public.booking_alert_recipients', 'INSERT') AS auth_insert,
        has_table_privilege('authenticated', 'public.booking_alert_recipients', 'UPDATE') AS auth_update,
        has_table_privilege('authenticated', 'public.booking_alert_recipients', 'DELETE') AS auth_delete`,
  );
  assert.equal(rows[0].anon_select, false);
  assert.equal(rows[0].auth_select, false);
  assert.equal(rows[0].auth_insert, false);
  assert.equal(rows[0].auth_update, false);
  assert.equal(rows[0].auth_delete, false);
});

test("a queued alert keeps its recipient even after the list changes", async () => {
  const recipientId = randomUUID();
  await db.query(
    `INSERT INTO public.booking_alert_recipients (id, email, label, enabled)
     VALUES ($1, 'ops@2ndwave.example', 'Operations', true)`,
    [recipientId],
  );

  await createBooking();
  const queued = await staffRows();
  assert.equal(queued.length, 1);

  await db.query(
    "UPDATE public.booking_alert_recipients SET email = 'replacement@2ndwave.example' WHERE id = $1",
    [recipientId],
  );

  const after = await staffRows();
  assert.equal(after.length, 1);
  assert.equal(after[0].recipient_email, "ops@2ndwave.example");
});

test("the same central list receives all five order events", async () => {
  const first = "ops.one@2ndwave.example";
  const second = "ops.two@2ndwave.example";
  await addRecipient(first);
  await addRecipient(second);

  const progressing = await createBooking();
  await transition(progressing.id, "processing", { fromStatus: "pending" });
  await transition(progressing.id, "ready", { fromStatus: "processing" });
  await transition(progressing.id, "completed", { fromStatus: "ready" });

  const cancelled = await createBooking();
  await transition(cancelled.id, "cancelled", {
    fromStatus: "pending",
    reason: "Customer changed plans.",
  });

  const rows = await staffRows();
  const templates = [
    "staff_order_pending",
    "staff_order_processing",
    "staff_order_ready",
    "staff_order_completed",
    "staff_order_cancelled",
  ];

  // Two bookings produce two pending alerts per recipient; the other four events
  // occur once each. Every alert goes to both addresses on the one list.
  for (const template of templates) {
    const matching = rows.filter((row) => row.template === template);
    const expectedRows = template === "staff_order_pending" ? 4 : 2;
    assert.equal(matching.length, expectedRows, template);
    assert.deepEqual(
      [...new Set(matching.map((row) => row.recipient_email))].sort(),
      [first, second],
      template,
    );
  }
});

test("an address added later receives subsequent alerts only", async () => {
  const first = "ops.one@2ndwave.example";
  const second = "ops.two@2ndwave.example";
  await addRecipient(first);

  const booking = await createBooking();
  assert.deepEqual(
    (await staffRows()).map((row) => row.recipient_email),
    [first],
  );

  await addRecipient(second);
  await transition(booking.id, "processing", { fromStatus: "pending" });

  const pending = (await staffRows()).filter(
    (row) => row.template === "staff_order_pending",
  );
  assert.deepEqual(
    pending.map((row) => row.recipient_email),
    [first],
    "an earlier event is never resent to the new address",
  );

  const processing = (await staffRows()).filter(
    (row) => row.template === "staff_order_processing",
  );
  assert.deepEqual(
    processing.map((row) => row.recipient_email).sort(),
    [first, second],
  );
});

test("a removed address receives no subsequent alerts", async () => {
  const first = "ops.one@2ndwave.example";
  const removed = "ops.two@2ndwave.example";
  await addRecipient(first);
  await addRecipient(removed);

  const booking = await createBooking();
  const before = await staffRows();
  assert.equal(before.length, 2);

  const { rows: removedRows } = await db.query<{ id: string }>(
    "DELETE FROM public.booking_alert_recipients WHERE email = $1 RETURNING id",
    [removed],
  );
  assert.equal(removedRows.length, 1);

  await transition(booking.id, "processing", { fromStatus: "pending" });

  const processing = (await staffRows()).filter(
    (row) => row.template === "staff_order_processing",
  );
  assert.deepEqual(
    processing.map((row) => row.recipient_email),
    [first],
  );

  // Already queued rows keep their original recipient and are never resent.
  const pending = (await staffRows()).filter(
    (row) => row.template === "staff_order_pending",
  );
  assert.equal(pending.length, 2);
});

test("the database rejects duplicate and malformed addresses", async () => {
  await addRecipient("ops@2ndwave.example");

  await assert.rejects(
    () => addRecipient("ops@2ndwave.example"),
    /duplicate key/,
  );

  await assert.rejects(
    () =>
      db.query(
        `INSERT INTO public.booking_alert_recipients (email)
         VALUES ('OPS@2ndwave.example')`,
      ),
    /booking_alert_recipients_email_normalised/,
  );

  await assert.rejects(
    () =>
      db.query(
        `INSERT INTO public.booking_alert_recipients (email)
         VALUES ('not-an-address')`,
      ),
    /booking_alert_recipients_email_shape/,
  );
});

test("an edit only applies to the version the operator loaded", async () => {
  await addRecipient("ops@2ndwave.example");
  const { rows: loaded } = await db.query<{ id: string; version: number }>(
    "SELECT id, version FROM public.booking_alert_recipients WHERE email = $1",
    ["ops@2ndwave.example"],
  );
  assert.equal(loaded[0].version, 1);

  const { rows: updated } = await db.query<{ id: string; version: number }>(
    `UPDATE public.booking_alert_recipients
     SET email = 'alerts@2ndwave.example', version = version + 1
     WHERE id = $1 AND version = $2
     RETURNING id, version`,
    [loaded[0].id, loaded[0].version],
  );
  assert.equal(updated.length, 1);
  assert.equal(updated[0].version, 2);

  const { rows: stale } = await db.query<{ id: string }>(
    `UPDATE public.booking_alert_recipients
     SET email = 'stale@2ndwave.example', version = version + 1
     WHERE id = $1 AND version = $2
     RETURNING id`,
    [loaded[0].id, loaded[0].version],
  );
  assert.equal(stale.length, 0);

  const { rows: current } = await db.query<{ email: string }>(
    "SELECT email FROM public.booking_alert_recipients WHERE id = $1",
    [loaded[0].id],
  );
  assert.equal(current[0].email, "alerts@2ndwave.example");
});

test("a recipient lookup failure never fails the order operation", async () => {
  await addRecipient("ops@2ndwave.example");

  const bookingId = randomUUID();
  const bookingReference = reference();
  let committed = false;

  // Simulate the central list being temporarily unavailable at commit time. The
  // deferred trigger must isolate the failure: the booking still commits and no
  // alert is fabricated.
  try {
    await db.exec("BEGIN");
    await db.exec(
      "ALTER TABLE public.booking_alert_recipients RENAME TO booking_alert_recipients_offline",
    );
    await db.query(
      `INSERT INTO public.bookings
         (id, reference, customer_name, customer_email, status, version)
       VALUES ($1, $2, 'Ama Mensah', 'customer@example.test', 'pending', 1)`,
      [bookingId, bookingReference],
    );
    await db.query(
      `INSERT INTO public.booking_status_history
         (booking_id, from_status, to_status, actor_id, actor_kind)
       VALUES ($1, NULL, 'pending', NULL, 'customer')`,
      [bookingId],
    );
    await db.exec("COMMIT");
    committed = true;
  } finally {
    if (!committed) {
      try {
        await db.exec("ROLLBACK");
      } catch {
        // No transaction left to abort.
      }
    }
    try {
      await db.exec(
        "ALTER TABLE public.booking_alert_recipients_offline RENAME TO public.booking_alert_recipients",
      );
    } catch {
      // The rollback already restored the original name.
    }
  }

  const { rows } = await db.query<{ status: string }>(
    "SELECT status FROM public.bookings WHERE id = $1",
    [bookingId],
  );
  assert.equal(rows[0].status, "pending");

  const staff = await staffRows();
  assert.equal(staff.length, 0);

  // The customer notification is untouched by the staff failure.
  const customer = await outbox("booking_created");
  assert.equal(customer.length, 1);
});
