import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * Phase 5 MVP newsletter interest database tests.
 *
 * Runs the real forward-only migrations against an in-process disposable
 * PostgreSQL (PGlite/WASM). This exercises the deployed behaviour: the
 * deny-by-default table, the trusted submit function, the single manager alert
 * per first-time address, the widened outbox checks and the append-only rule.
 *
 * No network call and no email is involved.
 */

const OUTBOX_MIGRATION = "supabase/migrations/20261019120000_email_outbox.sql";
const RECIPIENTS_MIGRATION = "supabase/migrations/20261022120000_booking_alert_recipients.sql";
const STAFF_ALERTS_MIGRATION = "supabase/migrations/20261022120100_staff_order_email_alerts.sql";
const PHASE4_MIGRATION = "supabase/migrations/20261027100000_email_phase4_operations.sql";
const TABLE_MIGRATION = "supabase/migrations/20261027120000_newsletter_interest.sql";
const FUNCTIONS_MIGRATION = "supabase/migrations/20261027120100_newsletter_interest_alerts.sql";

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

CREATE TYPE public.admin_role AS ENUM ('full_admin', 'operational_admin');

CREATE TABLE public.admin_profiles (
    user_id uuid PRIMARY KEY,
    role public.admin_role,
    display_name text NOT NULL DEFAULT '',
    email text,
    disabled_at timestamptz
);

CREATE OR REPLACE FUNCTION private.insert_audit_event(
    p_actor uuid, p_action text, p_entity_type text, p_entity_id text,
    p_before jsonb, p_after jsonb, p_reason text, p_correlation uuid
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id bigint;
BEGIN
    INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id, before_state, after_state, reason, correlation_id)
    VALUES (p_actor, p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason, p_correlation)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE IF NOT EXISTS public.audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    before_state jsonb,
    after_state jsonb,
    reason text,
    correlation_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
`;

const MANAGER = "manager@2ndwavelaundry.com";
const CONSENT_VERSION = "2026-10-27";
const KEY = "newsletter-db-key-0123456789";

let db: PGlite;

before(async () => {
    db = new PGlite();
    await db.exec(HARNESS);
    await db.exec(readFileSync(OUTBOX_MIGRATION, "utf8"));
    await db.exec(readFileSync(RECIPIENTS_MIGRATION, "utf8"));
    await db.exec(readFileSync(STAFF_ALERTS_MIGRATION, "utf8"));
    await db.exec(readFileSync(PHASE4_MIGRATION, "utf8"));
    await db.exec(readFileSync(TABLE_MIGRATION, "utf8"));
    await db.exec(readFileSync(FUNCTIONS_MIGRATION, "utf8"));
});

after(async () => {
    await db.close();
});

beforeEach(async () => {
    await db.exec(
        "TRUNCATE TABLE public.newsletter_interest, public.email_outbox, public.audit_events RESTART IDENTITY CASCADE",
    );
});

async function submit(overrides: Record<string, unknown> = {}, idempotencyKey = KEY) {
    const input = {
        email: "Ama@Example.test",
        consent: true,
        consentVersion: CONSENT_VERSION,
        sourceIpHash: "a".repeat(32),
        recipientEmail: MANAGER,
        correlation: randomUUID(),
        ...overrides,
    };
    const { rows } = await db.query<{ result: { interest_id: string; is_new: boolean } }>(
        `SELECT public.newsletter_interest_submit(
      $1::text, $2::boolean, $3::text, $4::text, $5::text, $6::text, $7::uuid
    ) AS result`,
        [
            input.email,
            input.consent,
            input.consentVersion,
            input.sourceIpHash,
            input.recipientEmail,
            idempotencyKey,
            input.correlation,
        ],
    );
    return rows[0].result;
}

async function counts() {
    const { rows } = await db.query<{ interests: number; outbox: number; audit: number }>(
        `SELECT
      (SELECT count(*)::int FROM public.newsletter_interest) AS interests,
      (SELECT count(*)::int FROM public.email_outbox) AS outbox,
      (SELECT count(*)::int FROM public.audit_events) AS audit`,
    );
    return rows[0];
}

async function insertOutboxRow(overrides: Record<string, unknown> = {}) {
    const values = {
        idempotencyKey: `newsletter-interest:test:${randomUUID()}`,
        template: "newsletter_interest_received",
        recipientEmail: MANAGER,
        payload: {
            subscriber_email: "ama@example.test",
            submitted_at: "2026-10-27T09:30:00Z",
            source: "public_newsletter_form",
        },
        ...overrides,
    };
    return db.query(
        `INSERT INTO public.email_outbox (idempotency_key, template, recipient_email, payload)
     VALUES ($1, $2::public.email_template, $3, $4)`,
        [values.idempotencyKey, values.template, values.recipientEmail, JSON.stringify(values.payload)],
    );
}

test("both migrations apply; table, RLS, trigger, enum value and trusted function exist", async () => {
    const { rows } = await db.query<{ rls: boolean; policies: number; function_exists: boolean; prosecdef: boolean }>(
        `SELECT c.relrowsecurity AS rls,
      (SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.newsletter_interest'::regclass) AS policies,
      to_regprocedure('public.newsletter_interest_submit(text,boolean,text,text,text,text,uuid)') IS NOT NULL AS function_exists,
      (SELECT prosecdef FROM pg_proc WHERE oid = 'public.newsletter_interest_submit(text,boolean,text,text,text,text,uuid)'::regprocedure) AS prosecdef
     FROM pg_class c WHERE c.oid = 'public.newsletter_interest'::regclass`,
    );
    assert.equal(rows[0].rls, true);
    assert.equal(rows[0].policies, 0);
    assert.equal(rows[0].function_exists, true);
    assert.equal(rows[0].prosecdef, true);

    const enumRow = await db.query<{ exists: boolean }>(
        `SELECT exists(
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'newsletter_interest_received'
        AND enumtypid = 'public.email_template'::regtype
    ) AS exists`,
    );
    assert.equal(enumRow.rows[0].exists, true);

    const index = await db.query<{ exists: boolean }>(
        "SELECT to_regclass('public.newsletter_interest_created_idx') IS NOT NULL AS exists",
    );
    assert.equal(index.rows[0].exists, true);

    const trigger = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_trigger
     WHERE tgrelid = 'public.newsletter_interest'::regclass
       AND tgname = 'newsletter_interest_immutable' AND NOT tgisinternal`,
    );
    assert.equal(trigger.rows[0].count, 1);
});

test("Phase 5 operator security SQL passes against the local PGlite schema", async () => {
    await db.exec(readFileSync("supabase/tests/newsletter_interest_security.sql", "utf8"));
});

test("a first-time sign-up stores the row, queues exactly one manager alert and audits atomically", async () => {
    const correlation = randomUUID();
    const result = await submit({ correlation });
    assert.equal(result.is_new, true);

    const { rows: interests } = await db.query<{
        email: string; consent_version: string; source: string; source_ip_hash: string;
    }>("SELECT email, consent_version, source, source_ip_hash FROM public.newsletter_interest");
    assert.equal(interests.length, 1);
    assert.equal(interests[0].email, "ama@example.test");
    assert.equal(interests[0].consent_version, CONSENT_VERSION);
    assert.equal(interests[0].source, "public_newsletter_form");
    assert.equal(interests[0].source_ip_hash, "a".repeat(32));

    const { rows: outbox } = await db.query<{
        template: string; recipient_email: string; payload: Record<string, string>;
        idempotency_key: string; status: string; booking_id: string | null;
    }>("SELECT template, recipient_email, payload, idempotency_key, status, booking_id FROM public.email_outbox");
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].template, "newsletter_interest_received");
    assert.equal(outbox[0].recipient_email, MANAGER);
    assert.equal(outbox[0].status, "pending");
    assert.equal(outbox[0].booking_id, null);
    assert.deepEqual(Object.keys(outbox[0].payload).sort(), ["source", "submitted_at", "subscriber_email"]);
    assert.equal(outbox[0].payload.subscriber_email, "ama@example.test");
    assert.equal(outbox[0].payload.source, "public_newsletter_form");
    const digest = createHash("md5").update("ama@example.test").digest("hex");
    assert.equal(outbox[0].idempotency_key, `newsletter-interest:${digest}:${KEY}`);

    const { rows: audit } = await db.query<{
        action: string; entity_type: string; after_state: Record<string, unknown>; correlation_id: string;
    }>("SELECT action, entity_type, after_state, correlation_id FROM public.audit_events");
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "newsletter_interest.submitted");
    assert.equal(audit[0].entity_type, "newsletter_interest");
    assert.equal(audit[0].correlation_id, correlation);
    assert.equal(audit[0].after_state.email_hash, digest);
    assert.equal(audit[0].after_state.alert_queued, true);
    assert.equal(audit[0].after_state.consent_version, CONSENT_VERSION);
    // The audit trail never stores the raw address.
    assert.equal(JSON.stringify(audit[0]).includes("ama@example.test"), false);
});

test("a duplicate address is a no-op: same record, no second alert, no second audit", async () => {
    const first = await submit();
    const replay = await submit({ email: "  AMA@example.test  " });
    assert.equal(replay.is_new, false);
    assert.equal(replay.interest_id, first.interest_id);
    assert.deepEqual(await counts(), { interests: 1, outbox: 1, audit: 1 });
});

test("one idempotency key cannot swallow two different addresses", async () => {
    await submit({ email: "first@example.test" }, KEY);
    const second = await submit({ email: "second@example.test" }, KEY);
    assert.equal(second.is_new, true);
    const { rows } = await db.query<{ keys: string[] }>(
        "SELECT array_agg(idempotency_key ORDER BY idempotency_key) AS keys FROM public.email_outbox",
    );
    assert.equal(rows[0].keys.length, 2);
    assert.notEqual(rows[0].keys[0], rows[0].keys[1]);
    assert.equal(rows[0].keys.every((key) => key.startsWith(`newsletter-interest:`)), true);
    assert.deepEqual(await counts(), { interests: 2, outbox: 2, audit: 2 });
});

test("every documented validation marker raises before anything is written", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
        [{ consent: false }, "NEWSLETTER_CONSENT_REQUIRED"],
        [{ email: "not-an-email" }, "NEWSLETTER_INVALID_EMAIL"],
        [{ consentVersion: "" }, "NEWSLETTER_NOTICE_UNAVAILABLE"],
        [{ sourceIpHash: "not-hex" }, "NEWSLETTER_INVALID_PAYLOAD"],
        [{ recipientEmail: "" }, "NEWSLETTER_RECIPIENT_INVALID"],
    ];
    for (const [overrides, marker] of cases) {
        await assert.rejects(
            submit(overrides),
            (error: unknown) => String(error).includes(marker),
            marker,
        );
    }
    await assert.rejects(
        submit({}, "short-key"),
        (error: unknown) => String(error).includes("NEWSLETTER_IDEMPOTENCY_REQUIRED"),
    );
    assert.deepEqual(await counts(), { interests: 0, outbox: 0, audit: 0 });
});

test("the interest record is append-only for every original field", async () => {
    const result = await submit();
    for (const statement of [
        `UPDATE public.newsletter_interest SET email = 'moved@example.test' WHERE id = '${result.interest_id}'`,
        `UPDATE public.newsletter_interest SET consent_version = 'other' WHERE id = '${result.interest_id}'`,
        `UPDATE public.newsletter_interest SET source = 'elsewhere' WHERE id = '${result.interest_id}'`,
        `UPDATE public.newsletter_interest SET created_at = now() - interval '1 day' WHERE id = '${result.interest_id}'`,
    ]) {
        await assert.rejects(
            db.exec(statement),
            (error: unknown) => String(error).includes("NEWSLETTER_INTEREST_IMMUTABLE"),
        );
    }
});

test("the table rejects un-normalised, malformed or re-sourced rows", async () => {
    const insert = (email: string, source = "public_newsletter_form") =>
        db.query(
            `INSERT INTO public.newsletter_interest (email, consent_version, source)
     VALUES ($1, $2, $3)`,
            [email, CONSENT_VERSION, source],
        );
    for (const [email, reason] of [
        ["Ama@example.test", "newsletter_interest_email_normalised"],
        ["nope", "newsletter_interest_email_shape"],
        ["a@b.c" + "x".repeat(250), "newsletter_interest_email_shape"],
    ] as const) {
        await assert.rejects(insert(email), new RegExp(reason), reason);
    }
    await assert.rejects(insert("ok@example.test", "attacker_controlled"), /source_shape|newsletter_interest_source_shape/);
    const { rows } = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.newsletter_interest");
    assert.equal(rows[0].count, 0);
});

test("the widened outbox accepts exactly the newsletter payload and nothing else", async () => {
    await insertOutboxRow();

    const extraKey = await insertOutboxRow({
        payload: {
            subscriber_email: "ama@example.test",
            submitted_at: "2026-10-27T09:30:00Z",
            source: "public_newsletter_form",
            injected: "value",
        },
    }).then(() => null, (error: unknown) => error);
    assert.match(String(extraKey), /email_outbox_payload_shape/);

    const missingKey = await insertOutboxRow({
        payload: { subscriber_email: "ama@example.test", submitted_at: "2026-10-27T09:30:00Z" },
    }).then(() => null, (error: unknown) => error);
    assert.match(String(missingKey), /email_outbox_payload_shape/);

    const wrongSource = await insertOutboxRow({
        payload: {
            subscriber_email: "ama@example.test",
            submitted_at: "2026-10-27T09:30:00Z",
            source: "attacker",
        },
    }).then(() => null, (error: unknown) => error);
    assert.match(String(wrongSource), /email_outbox_payload_shape/);

    const wrongTemplate = await insertOutboxRow({ template: "booking_created" }).then(
        () => null,
        (error: unknown) => error,
    );
    assert.match(String(wrongTemplate), /email_outbox_payload_shape/);

    const { rows } = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.email_outbox");
    assert.equal(rows[0].count, 1);
});

test("customer and staff booking payloads still satisfy their original checks", async () => {
    await insertOutboxRow({
        idempotencyKey: "booking:customer-regression-1",
        template: "booking_created",
        payload: { booking_reference: "2W-ABCD234567", status: "pending" },
    });
    await insertOutboxRow({
        idempotencyKey: "booking:staff-regression-1",
        template: "staff_order_pending",
        payload: {
            booking_reference: "2W-ABCD234567",
            status: "pending",
            previous_status: "confirmed",
            actor_kind: "admin",
            actor_name: "Ama Mensah",
            actor_role: "full_admin",
            occurred_at: "2026-10-27T09:30:00Z",
            cancellation_reason: "",
        },
    });
    // A template/status disagreement must still be rejected.
    await assert.rejects(
        insertOutboxRow({
            idempotencyKey: "booking:status-mismatch-1",
            template: "booking_created",
            payload: { booking_reference: "2W-ABCD234567", status: "confirmed" },
        }),
        /email_outbox_template_status/,
    );
    const { rows } = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.email_outbox");
    assert.equal(rows[0].count, 2);
});

test("the reference shape stays tolerant of booking-free newsletter rows", async () => {
    const { rows } = await db.query<{ constrained: boolean }>(
        `SELECT convalidated AS constrained FROM pg_constraint
     WHERE conname = 'email_outbox_reference_shape'`,
    );
    assert.equal(rows[0].constrained, true);
    await insertOutboxRow();
    const { rows: newsletterRows } = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM public.email_outbox
     WHERE template = 'newsletter_interest_received'
       AND NOT (payload ? 'booking_reference')`,
    );
    assert.equal(newsletterRows[0].count, 1);
});

test("browser roles hold no privilege and only the elevated role may submit", async () => {
    const { rows } = await db.query<{
        anon_table: boolean; auth_table: boolean; service_table: boolean;
        anon_exec: boolean; auth_exec: boolean; service_exec: boolean;
    }>(
        `SELECT
      has_table_privilege('anon', 'public.newsletter_interest', 'INSERT') AS anon_table,
      has_table_privilege('authenticated', 'public.newsletter_interest', 'SELECT') AS auth_table,
      has_table_privilege('service_role', 'public.newsletter_interest', 'SELECT') AS service_table,
      has_function_privilege('anon', 'public.newsletter_interest_submit(text,boolean,text,text,text,text,uuid)', 'EXECUTE') AS anon_exec,
      has_function_privilege('authenticated', 'public.newsletter_interest_submit(text,boolean,text,text,text,text,uuid)', 'EXECUTE') AS auth_exec,
      has_function_privilege('service_role', 'public.newsletter_interest_submit(text,boolean,text,text,text,text,uuid)', 'EXECUTE') AS service_exec`,
    );
    assert.deepEqual(rows[0], {
        anon_table: false,
        auth_table: false,
        service_table: true,
        anon_exec: false,
        auth_exec: false,
        service_exec: true,
    });
    // Append-only: even the elevated role holds no update or delete right.
    const { rows: writeRows } = await db.query<{ can_update: boolean; can_delete: boolean }>(
        `SELECT has_table_privilege('service_role', 'public.newsletter_interest', 'UPDATE') AS can_update,
                has_table_privilege('service_role', 'public.newsletter_interest', 'DELETE') AS can_delete`,
    );
    assert.deepEqual(writeRows[0], { can_update: false, can_delete: false });
});
