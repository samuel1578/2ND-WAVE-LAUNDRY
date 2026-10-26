import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const TABLE_MIGRATION = "supabase/migrations/20261026100000_review_submissions.sql";
const FUNCTIONS_MIGRATION = "supabase/migrations/20261026100100_review_functions.sql";

const PRELUDE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE SCHEMA private;
CREATE TABLE public.audit_events (
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
CREATE FUNCTION private.current_admin_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT NULL::text $$;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_admin_role() TO authenticated;
CREATE FUNCTION private.insert_audit_event(
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
`;

let db: PGlite;

before(async () => {
    db = new PGlite();
    await db.exec(PRELUDE);
    await db.exec(readFileSync(TABLE_MIGRATION, "utf8"));
    await db.exec(readFileSync(FUNCTIONS_MIGRATION, "utf8"));
});

after(async () => {
    await db.close();
});

beforeEach(async () => {
    await db.exec("TRUNCATE TABLE public.review_submissions, public.audit_events RESTART IDENTITY CASCADE");
});

async function submit(overrides: Record<string, unknown> = {}, idempotencyKey = "review-db-key-0123456789") {
    const input = {
        name: "Ama Mensah",
        body: "The laundry was carefully handled.",
        rating: 5,
        branch: "Ashaiman",
        consent: true,
        consentVersion: "review-copy-v1",
        noticeVersion: null,
        sourceIpHash: "a".repeat(32),
        correlation: randomUUID(),
        ...overrides,
    };
    const { rows } = await db.query<{ result: { review_id: string; replayed: boolean } }>(
        `SELECT public.review_submit(
      $1::text, $2::text, $3::smallint, $4::text, $5::boolean,
      $6::text, $7::text, $8::text, $9::text, $10::uuid
    ) AS result`,
        [input.name, input.body, input.rating, input.branch, input.consent, input.consentVersion,
        input.noticeVersion, input.sourceIpHash, idempotencyKey, input.correlation],
    );
    return rows[0].result;
}

test("both migrations apply; table, index, RLS, constraints, view and trusted function exist", async () => {
    const { rows } = await db.query<{ rls: boolean; function_exists: boolean }>(
        `SELECT c.relrowsecurity AS rls,
      to_regprocedure('public.review_submit(text,text,smallint,text,boolean,text,text,text,text,uuid)') IS NOT NULL AS function_exists
     FROM pg_class c WHERE c.oid = 'public.review_submissions'::regclass`,
    );
    assert.equal(rows[0].rls, true);
    assert.equal(rows[0].function_exists, true);
    const view = await db.query<{ exists: boolean }>("SELECT to_regclass('public.published_reviews') IS NOT NULL AS exists");
    assert.equal(view.rows[0].exists, true);
    const index = await db.query<{ exists: boolean }>("SELECT to_regclass('public.review_submissions_moderation_created_idx') IS NOT NULL AS exists");
    assert.equal(index.rows[0].exists, true);
});

test("Sprint 3A operator security SQL passes against the local PGlite schema", async () => {
    await db.exec(readFileSync("supabase/tests/sprint_3a_review_security.sql", "utf8"));
});

test("valid submission persists pending and consented; audit event is transactional and contains no review text", async () => {
    const result = await submit();
    assert.equal(result.replayed, false);
    const { rows } = await db.query<{
        id: string; customer_name: string; body_original: string; moderation_status: string;
        consent: boolean; source_ip_hash: string; version: number;
    }>("SELECT id, customer_name, body_original, moderation_status, consent, source_ip_hash, version FROM public.review_submissions");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].customer_name, "Ama Mensah");
    assert.equal(rows[0].body_original, "The laundry was carefully handled.");
    assert.equal(rows[0].moderation_status, "pending");
    assert.equal(rows[0].consent, true);
    assert.equal(rows[0].source_ip_hash, "a".repeat(32));
    assert.equal(rows[0].version, 1);

    const audit = await db.query<{ action: string; after_state: Record<string, unknown> }>(
        "SELECT action, after_state FROM public.audit_events",
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].action, "review.submitted");
    assert.deepEqual(audit.rows[0].after_state, { moderation_status: "pending" });
});

test("same idempotency key and payload replays; altered payload conflicts without another insert", async () => {
    const first = await submit();
    const replay = await submit();
    assert.equal(replay.review_id, first.review_id);
    assert.equal(replay.replayed, true);
    await assert.rejects(
        submit({ body: "An altered review text." }),
        (error: unknown) => String(error).includes("REVIEW_IDEMPOTENCY_MISMATCH"),
    );
    const count = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.review_submissions");
    assert.equal(count.rows[0].count, 1);
    const events = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.audit_events");
    assert.equal(events.rows[0].count, 1);
});

test("database function independently rejects invalid consent, rating and excessive links", async () => {
    await assert.rejects(submit({ consent: false }, "review-consent-key-012345678"), (error: unknown) => String(error).includes("REVIEW_CONSENT_REQUIRED"));
    await assert.rejects(submit({ rating: 8 }, "review-rating-key-0123456789"), (error: unknown) => String(error).includes("REVIEW_INVALID_RATING"));
    await assert.rejects(submit({ body: "https://a.test https://b.test www.c.test" }, "review-links-key-01234567890"), (error: unknown) => String(error).includes("REVIEW_SPAM_REJECTED"));
    const count = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.review_submissions");
    assert.equal(count.rows[0].count, 0);
});

test("original customer name, original text and creation time cannot be changed", async () => {
    const result = await submit();
    for (const statement of [
        "UPDATE public.review_submissions SET body_original = 'changed' WHERE id = $1",
        "UPDATE public.review_submissions SET customer_name = 'Changed' WHERE id = $1",
        "UPDATE public.review_submissions SET created_at = now() + interval '1 day' WHERE id = $1",
    ]) {
        await assert.rejects(db.query(statement, [result.review_id]), (error: unknown) => String(error).includes("REVIEW_ORIGINAL_IMMUTABLE"));
    }
});

test("anon has no writes, no private-column read, and only approved consented publication rows are visible", async () => {
    const pending = await submit({}, "review-pending-key-0123456789");
    const draftRow = await submit({ name: "Draft reviewer", body: "Approved review with an in-progress draft reply", sourceIpHash: "b".repeat(32) }, "review-draft-key-01234567890");
    const publicRow = await submit({ name: "Public reviewer", body: "Approved customer text", sourceIpHash: "c".repeat(32) }, "review-public-key-01234567890");
    await db.query(
        `UPDATE public.review_submissions
     SET moderation_status = 'approved', moderated_by = NULL, moderated_at = now(),
         body_published = 'Draft review text', published_at = now(), published_version = 1,
         reply_body = 'Draft reply must stay private', reply_status = 'draft'
     WHERE id = $1`,
        [draftRow.review_id],
    );
    await db.query(
        `UPDATE public.review_submissions
     SET moderation_status = 'approved', moderated_by = NULL, moderated_at = now(),
         body_published = 'Edited public version', published_at = now(), published_version = 1,
         reply_body = 'Published response', reply_status = 'published', reply_published_at = now()
     WHERE id = $1`,
        [publicRow.review_id],
    );

    const grants = await db.query<{ anon_insert: boolean; auth_insert: boolean; anon_original: boolean; submit_anon: boolean; submit_service: boolean }>(
        `SELECT
      has_table_privilege('anon', 'public.review_submissions', 'INSERT') AS anon_insert,
      has_table_privilege('authenticated', 'public.review_submissions', 'INSERT') AS auth_insert,
      has_column_privilege('anon', 'public.review_submissions', 'body_original', 'SELECT') AS anon_original,
      has_function_privilege('anon', 'public.review_submit(text,text,smallint,text,boolean,text,text,text,text,uuid)', 'EXECUTE') AS submit_anon,
      has_function_privilege('service_role', 'public.review_submit(text,text,smallint,text,boolean,text,text,text,text,uuid)', 'EXECUTE') AS submit_service`,
    );
    assert.deepEqual(grants.rows[0], {
        anon_insert: false,
        auth_insert: false,
        anon_original: false,
        submit_anon: false,
        submit_service: true,
    });

    await db.exec("SET ROLE anon");
    try {
        const visible = await db.query<{ id: string; customer_name: string; body_published: string; reply_body: string | null }>(
            "SELECT id, customer_name, body_published, reply_body FROM public.published_reviews",
        );
        assert.equal(visible.rows.length, 1);
        assert.equal(visible.rows[0].id, publicRow.review_id);
        assert.equal(visible.rows[0].body_published, "Edited public version");
        assert.equal(visible.rows[0].reply_body, "Published response");
        assert.equal(visible.rows.some((row) => row.id === draftRow.review_id), false);
        const hiddenDraft = await db.query<{ reply_body: string }>(
            "SELECT reply_body FROM public.review_submissions WHERE id = $1",
            [draftRow.review_id],
        );
        assert.equal(hiddenDraft.rows.length, 0);
        await assert.rejects(
            db.query("SELECT body_original FROM public.review_submissions WHERE id = $1", [pending.review_id]),
            (error: unknown) => String(error).includes("permission denied"),
        );
    } finally {
        await db.exec("RESET ROLE");
    }
});
