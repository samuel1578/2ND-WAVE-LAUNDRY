import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Enquiry alert recipient fan-out.
 *
 * Verifies the database function reads public.booking_alert_recipients inside
 * the same transaction as the enquiry insert, queues exactly one alert per
 * enabled recipient, and no longer accepts a caller-supplied recipient.
 */

const MIGRATIONS_DIR = "supabase/migrations";
const PRELUDE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
`;

const OPS = "ops@2ndwave.example";
const OWNER = "owner@2ndwave.example";
const DISABLED = "disabled@2ndwave.example";

let db: PGlite;

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

async function setRecipient(email: string, enabled = true) {
  await db.query(
    `INSERT INTO public.booking_alert_recipients (email, enabled) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [email, enabled],
  );
}

async function submitGeneral(key: string) {
  const { rows } = await db.query<{
    result: { enquiry_id: string; is_new: boolean };
  }>(
    `SELECT public.enquiry_submit(
        $1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
        $7::text, $8::jsonb, $9::text, $10::text, $11::uuid
     ) AS result`,
    [
      "general",
      "Amina Mensah",
      null,
      "+233595224280",
      "amina@example.test",
      "Services",
      "Please tell me about wash and fold.",
      JSON.stringify({}),
      key,
      "b".repeat(32),
      randomUUID(),
    ],
  );
  return rows[0].result;
}

async function alertsFor(enquiryId: string) {
  const { rows } = await db.query<{
    template: string;
    recipient_email: string;
    payload: Record<string, unknown>;
    idempotency_key: string;
    status: string;
    booking_id: string | null;
    attempt_count: number;
  }>(
    `SELECT template::text, recipient_email, payload, idempotency_key, status::text,
            booking_id, attempt_count
     FROM public.email_outbox
     WHERE payload->>'enquiry_id' = $1
     ORDER BY recipient_email`,
    [enquiryId],
  );
  return rows;
}

test("one alert is queued per enabled recipient and disabled rows are skipped", async () => {
  await setRecipient(OPS, true);
  await setRecipient(OWNER, true);
  await setRecipient(DISABLED, false);

  const result = await submitGeneral("enquiry-alert-multi-001");
  assert.equal(result.is_new, true);

  const alerts = await alertsFor(result.enquiry_id);
  assert.deepEqual(alerts.map((row) => row.recipient_email), [OPS, OWNER]);
  assert.ok(alerts.every((row) => row.template === "enquiry_received"));
  assert.ok(alerts.every((row) => row.status === "pending"));
  assert.ok(alerts.every((row) => row.booking_id === null));
  assert.ok(alerts.every((row) => row.attempt_count === 0));

  // One outbox row per recipient, with distinct deterministic keys.
  assert.equal(new Set(alerts.map((row) => row.idempotency_key)).size, 2);
  for (const row of alerts) {
    assert.match(
      row.idempotency_key,
      new RegExp(`^enquiry:${result.enquiry_id}:received:[0-9a-f]{32}$`),
    );
    assert.deepEqual(Object.keys(row.payload).sort(), [
      "business",
      "enquiry_id",
      "kind",
      "name",
      "phone",
      "topic",
    ]);
    // The message body and submitter email stay out of the alert payload.
    assert.equal(JSON.stringify(row.payload).includes("Please tell me"), false);
    assert.equal(JSON.stringify(row.payload).includes("amina@example.test"), false);
  }

  const { rows: audit } = await db.query<{
    after_state: Record<string, unknown>;
  }>(
    `SELECT after_state FROM public.audit_events
     WHERE entity_type = 'enquiry' AND entity_id = $1 AND action = 'enquiry.submitted'`,
    [result.enquiry_id],
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].after_state.alert_queued, true);
  assert.equal(audit[0].after_state.alert_recipients, 2);
  // No address is written to the audit trail.
  assert.equal(JSON.stringify(audit[0].after_state).includes("@2ndwave.example"), false);
});

test("no enabled recipient stores the enquiry and queues nothing", async () => {
  await db.query("UPDATE public.booking_alert_recipients SET enabled = false");

  const result = await submitGeneral("enquiry-alert-none-0001");
  assert.equal(result.is_new, true);
  assert.deepEqual(await alertsFor(result.enquiry_id), []);

  const { rows: stored } = await db.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM public.enquiries WHERE id = $1",
    [result.enquiry_id],
  );
  assert.equal(stored[0].count, 1);

  const { rows: audit } = await db.query<{
    after_state: Record<string, unknown>;
  }>(
    `SELECT after_state FROM public.audit_events
     WHERE entity_type = 'enquiry' AND entity_id = $1 AND action = 'enquiry.submitted'`,
    [result.enquiry_id],
  );
  assert.equal(audit[0].after_state.alert_queued, false);
  assert.equal(audit[0].after_state.alert_recipients, 0);
});

test("an idempotent replay never queues a second alert", async () => {
  await setRecipient(OPS, true);
  const key = "enquiry-alert-replay-0001";
  const first = await submitGeneral(key);
  const before = await alertsFor(first.enquiry_id);

  const replay = await submitGeneral(key);
  assert.equal(replay.enquiry_id, first.enquiry_id);
  assert.equal(replay.is_new, false);

  const after = await alertsFor(first.enquiry_id);
  assert.equal(after.length, before.length);
  assert.deepEqual(
    after.map((row) => row.idempotency_key),
    before.map((row) => row.idempotency_key),
  );
});

test("the caller-supplied recipient argument no longer exists", async () => {
  await assert.rejects(
    db.query(
      `SELECT public.enquiry_submit(
          $1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
          $7::text, $8::jsonb, $9::text, $10::text, $11::text, $12::uuid
       ) AS result`,
      [
        "general",
        "Amina Mensah",
        null,
        "+233595224280",
        "amina@example.test",
        "Services",
        "Message",
        JSON.stringify({}),
        "enquiry-alert-legacy-0001",
        "b".repeat(32),
        "manager@2ndwavelaundry.com",
        randomUUID(),
      ],
    ),
    (error: unknown) => {
      assert.match((error as Error).message, /does not exist/);
      return true;
    },
  );

  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'enquiry_submit'`,
  );
  assert.equal(rows[0].count, 1);
});

test("only the elevated server role may submit and fan out", async () => {
  const { rows } = await db.query<{
    anon_exec: boolean;
    auth_exec: boolean;
    service_exec: boolean;
  }>(
    `SELECT
       has_function_privilege('anon', 'public.enquiry_submit(text,text,text,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', 'public.enquiry_submit(text,text,text,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role', 'public.enquiry_submit(text,text,text,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') AS service_exec`,
  );
  assert.deepEqual(rows[0], {
    anon_exec: false,
    auth_exec: false,
    service_exec: true,
  });
});
