import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Database tests for 20261113190000_handover_cleanup.sql:
 *   * anon has no table or column access to review_submissions / published_reviews;
 *   * service_role can read the view (the server-side public reader);
 *   * newsletter_interest_remove is Full Admin only, deletes the subscriber and
 *     their newsletter alert outbox rows, and audits without the address.
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

async function subscribe(email: string): Promise<string> {
  const { rows } = await db.query<{ result: { interest_id: string } }>(
    `SELECT public.newsletter_interest_submit(
       $1::text, true, '2026-10-27', $2::text, 'manager@2ndwavelaundry.com', $3::text, $4::uuid
     ) AS result`,
    [email, "a".repeat(32), `newsletter-cleanup-${randomUUID()}`, randomUUID()],
  );
  return rows[0].result.interest_id;
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
});

after(async () => {
  await db.close();
});

test("anon has no access to reviews; service_role can read the published view", async () => {
  const { rows } = await db.query<Record<string, boolean>>(
    `SELECT
       has_table_privilege('anon', 'public.review_submissions', 'SELECT') AS anon_table,
       has_table_privilege('anon', 'public.published_reviews', 'SELECT') AS anon_view,
       has_table_privilege('anon', 'public.published_reviews', 'INSERT') AS anon_view_insert,
       has_column_privilege('anon', 'public.review_submissions', 'reply_body', 'SELECT') AS anon_reply,
       has_column_privilege('anon', 'public.review_submissions', 'customer_name', 'SELECT') AS anon_name,
       has_table_privilege('authenticated', 'public.review_submissions', 'SELECT') AS auth_table,
       has_table_privilege('service_role', 'public.published_reviews', 'SELECT') AS service_view`,
  );
  assert.deepEqual(rows[0], {
    anon_table: false,
    anon_view: false,
    anon_view_insert: false,
    anon_reply: false,
    anon_name: false,
    auth_table: true,
    service_view: true,
  });

  const columns = await db.query<{ attname: string }>(
    `SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = 'public.review_submissions'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT')`,
  );
  assert.equal(columns.rows.length, 0);
});

test("only an active Full Admin can remove a newsletter subscriber", async () => {
  const id = await subscribe("ops-check@example.test");
  await assert.rejects(
    db.query("SELECT public.newsletter_interest_remove($1, $2)", [operationalAdmin, id]),
    /NEWSLETTER_FORBIDDEN/,
  );
  await assert.rejects(
    db.query("SELECT public.newsletter_interest_remove($1, $2)", [randomUUID(), id]),
    /NEWSLETTER_FORBIDDEN/,
  );
  const still = await db.query("SELECT 1 FROM public.newsletter_interest WHERE id = $1", [id]);
  assert.equal(still.rows.length, 1);
});

test("removal deletes the subscriber and their alert outbox rows, and audits without the address", async () => {
  const email = "withdraw@example.test";
  const id = await subscribe(email);
  const keep = await subscribe("stays@example.test");

  const queued = await db.query<{ n: number }>(
    `SELECT count(*)::integer AS n FROM public.email_outbox
     WHERE template = 'newsletter_interest_received' AND payload->>'subscriber_email' = $1`,
    [email],
  );
  assert.ok(queued.rows[0].n >= 1, "the sign-up queued a manager alert");

  const removed = await db.query<{ result: { removed: boolean; outbox_removed: number } }>(
    "SELECT public.newsletter_interest_remove($1, $2) AS result",
    [fullAdmin, id],
  );
  assert.equal(removed.rows[0].result.removed, true);
  assert.equal(removed.rows[0].result.outbox_removed, queued.rows[0].n);

  const interest = await db.query("SELECT 1 FROM public.newsletter_interest WHERE id = $1", [id]);
  assert.equal(interest.rows.length, 0);
  const outbox = await db.query(
    `SELECT 1 FROM public.email_outbox
     WHERE template = 'newsletter_interest_received' AND payload->>'subscriber_email' = $1`,
    [email],
  );
  assert.equal(outbox.rows.length, 0);
  const other = await db.query("SELECT 1 FROM public.newsletter_interest WHERE id = $1", [keep]);
  assert.equal(other.rows.length, 1, "other subscribers are untouched");

  const audit = await db.query<{ actor_id: string; after_state: Record<string, unknown>; before_state: unknown }>(
    `SELECT actor_id, before_state, after_state FROM public.audit_events
     WHERE action = 'newsletter.interest_removed' AND entity_id = $1`,
    [id],
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].actor_id, fullAdmin);
  assert.deepEqual(audit.rows[0].after_state, { removed: true });
  assert.equal(audit.rows[0].before_state, null);
  assert.equal(JSON.stringify(audit.rows[0]).includes(email), false, "the address is never audited");

  await assert.rejects(
    db.query("SELECT public.newsletter_interest_remove($1, $2)", [fullAdmin, id]),
    /NEWSLETTER_NOT_FOUND/,
  );
});

test("newsletter_interest_remove is executable by service_role only", async () => {
  const { rows } = await db.query<{ anon: boolean; auth: boolean; service: boolean }>(
    `SELECT has_function_privilege('anon', 'public.newsletter_interest_remove(uuid, uuid)', 'EXECUTE') AS anon,
            has_function_privilege('authenticated', 'public.newsletter_interest_remove(uuid, uuid)', 'EXECUTE') AS auth,
            has_function_privilege('service_role', 'public.newsletter_interest_remove(uuid, uuid)', 'EXECUTE') AS service`,
  );
  assert.deepEqual(rows[0], { anon: false, auth: false, service: true });
});
