import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const TABLE_MIGRATION = "supabase/migrations/20261026100000_review_submissions.sql";
const SUBMIT_MIGRATION = "supabase/migrations/20261026100100_review_functions.sql";
const MODERATION_MIGRATION =
  "supabase/migrations/20261026100200_review_moderation_functions.sql";
const REPLY_MIGRATION = "supabase/migrations/20261026100300_review_replies.sql";
const OPERATOR_SQL = "supabase/tests/sprint_3b_review_moderation.sql";
const OPERATOR_SQL_3C = "supabase/tests/sprint_3c_review_public_rls.sql";

const FULL_ADMIN = "11111111-1111-1111-1111-111111111111";
const OPERATIONAL_ADMIN = "22222222-2222-2222-2222-222222222222";
const SECOND_FULL_ADMIN = "33333333-3333-3333-3333-333333333333";

const PRELUDE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE SCHEMA private;
CREATE TYPE public.admin_role AS ENUM ('full_admin', 'operational_admin');
CREATE TABLE public.admin_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.admin_role NOT NULL,
  disabled_at timestamptz
);
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
  await db.exec(readFileSync(SUBMIT_MIGRATION, "utf8"));
  await db.exec(readFileSync(MODERATION_MIGRATION, "utf8"));
  await db.exec(readFileSync(REPLY_MIGRATION, "utf8"));
  await db.exec(`
    INSERT INTO auth.users (id) VALUES
      ('${FULL_ADMIN}'), ('${OPERATIONAL_ADMIN}'), ('${SECOND_FULL_ADMIN}');
    INSERT INTO public.admin_profiles (user_id, role) VALUES
      ('${FULL_ADMIN}', 'full_admin'),
      ('${OPERATIONAL_ADMIN}', 'operational_admin'),
      ('${SECOND_FULL_ADMIN}', 'full_admin');
  `);
});

after(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(
    "TRUNCATE TABLE public.review_submissions, public.audit_events RESTART IDENTITY CASCADE",
  );
});

type MutationResult = {
  review_id: string;
  moderation_status: string;
  published: boolean;
  published_version: number | null;
  version: number;
};

let keyCounter = 0;

async function submit(overrides: Record<string, unknown> = {}) {
  keyCounter += 1;
  const key = `review-moderation-key-${String(keyCounter).padStart(6, "0")}`;
  const input = {
    name: "Ama Mensah",
    body: "The laundry was carefully handled and returned on time.",
    rating: 5,
    branch: "Ashaiman",
    consent: true,
    consentVersion: "review-copy-v1",
    sourceIpHash: "a".repeat(32),
    ...overrides,
  };
  const { rows } = await db.query<{ result: { review_id: string } }>(
    `SELECT public.review_submit(
      $1::text, $2::text, $3::smallint, $4::text, $5::boolean,
      $6::text, $7::text, $8::text, $9::text, $10::uuid
    ) AS result`,
    [
      input.name,
      input.body,
      input.rating,
      input.branch,
      input.consent,
      input.consentVersion,
      null,
      input.sourceIpHash,
      key,
      randomUUID(),
    ],
  );
  return rows[0].result.review_id;
}

async function callRpc<T>(fn: string, args: unknown[]): Promise<T> {
  const placeholders = args
    .map((_, index) => `$${index + 1}`)
    .join(", ");
  const { rows } = await db.query<{ result: T }>(
    `SELECT public.${fn}(${placeholders}) AS result`,
    args,
  );
  return rows[0].result;
}

async function call(fn: string, args: unknown[]): Promise<MutationResult> {
  return callRpc<MutationResult>(fn, args);
}

async function moderate(
  actor: string,
  reviewId: string,
  decision: string,
  note: string | null,
  version = 1,
) {
  return call("review_moderate", [actor, reviewId, decision, note, version, randomUUID()]);
}

async function publish(
  actor: string,
  reviewId: string,
  action: string,
  body: string | null,
  version: number,
) {
  return call("review_publish", [actor, reviewId, action, body, version, randomUUID()]);
}

async function open(actor: string, reviewId: string, reason: string, version: number) {
  return call("review_open", [actor, reviewId, reason, version, randomUUID()]);
}

async function override(
  actor: string,
  reviewId: string,
  operation: string,
  reason: string,
  body: string | null,
  version: number,
) {
  return call("review_override", [
    actor,
    reviewId,
    operation,
    reason,
    body,
    version,
    randomUUID(),
  ]);
}

async function draftReply(
  actor: string,
  reviewId: string,
  body: string,
  version: number,
) {
  return callRpc<{ reply_status: string; version: number }>("review_draft_reply", [
    actor,
    reviewId,
    body,
    version,
    randomUUID(),
  ]);
}

async function publishReply(actor: string, reviewId: string, version: number) {
  return callRpc<{ reply_status: string; version: number }>(
    "review_reply_publish",
    [actor, reviewId, version, randomUUID()],
  );
}

async function auditRows() {
  const { rows } = await db.query<{
    action: string;
    actor_id: string | null;
    reason: string | null;
    before_state: Record<string, unknown> | null;
    after_state: Record<string, unknown> | null;
  }>("SELECT action, actor_id, reason, before_state, after_state FROM public.audit_events ORDER BY id");
  return rows;
}

test("moderation migration applies and the operator security SQL passes locally", async () => {
  const functions = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN
       ('review_moderate', 'review_publish', 'review_open', 'review_override',
        'review_draft_reply', 'review_reply_publish')`,
  );
  assert.equal(functions.rows[0].count, 6);
  await db.exec(readFileSync(OPERATOR_SQL, "utf8"));
  await db.exec(readFileSync(OPERATOR_SQL_3C, "utf8"));
});

test("approving a pending review updates the decision atomically with an audit event", async () => {
  const reviewId = await submit();
  const result = await moderate(FULL_ADMIN, reviewId, "approved", "Clear, genuine review");

  assert.equal(result.moderation_status, "approved");
  assert.equal(result.published, false);
  assert.equal(result.version, 2);

  const row = await db.query<{
    moderation_status: string;
    moderated_by: string;
    moderated_at: string;
    moderation_note: string;
  }>(
    "SELECT moderation_status, moderated_by, moderated_at, moderation_note FROM public.review_submissions WHERE id = $1",
    [reviewId],
  );
  assert.equal(row.rows[0].moderation_status, "approved");
  assert.equal(row.rows[0].moderated_by, FULL_ADMIN);
  assert.ok(row.rows[0].moderated_at);
  assert.equal(row.rows[0].moderation_note, "Clear, genuine review");

  const audit = await auditRows();
  assert.deepEqual(
    audit.map((entry) => entry.action),
    ["review.submitted", "review.approved"],
  );
  assert.equal(audit[1].actor_id, FULL_ADMIN);
  assert.equal(audit[1].reason, "Clear, genuine review");
  assert.equal(JSON.stringify(audit).includes("carefully handled"), false);
});

test("rejection requires a reason and a decided review cannot be decided again", async () => {
  const reviewId = await submit();

  await assert.rejects(
    moderate(OPERATIONAL_ADMIN, reviewId, "rejected", "   "),
    (error: unknown) => String(error).includes("REVIEW_NOTE_REQUIRED"),
  );

  const rejected = await moderate(
    OPERATIONAL_ADMIN,
    reviewId,
    "rejected",
    "Cannot verify the customer",
  );
  assert.equal(rejected.moderation_status, "rejected");

  await assert.rejects(
    moderate(FULL_ADMIN, reviewId, "approved", null, 2),
    (error: unknown) => String(error).includes("REVIEW_INVALID_TRANSITION"),
  );

  // The review still holds the first decision.
  const row = await db.query<{ moderation_status: string }>(
    "SELECT moderation_status FROM public.review_submissions WHERE id = $1",
    [reviewId],
  );
  assert.equal(row.rows[0].moderation_status, "rejected");
  const audit = await auditRows();
  assert.deepEqual(
    audit.map((entry) => entry.action),
    ["review.submitted", "review.rejected"],
  );
});

test("a stale optimistic version is a conflict, never a silent overwrite", async () => {
  const reviewId = await submit();
  await moderate(FULL_ADMIN, reviewId, "approved", null, 1);

  await assert.rejects(
    moderate(SECOND_FULL_ADMIN, reviewId, "rejected", "Late decision", 1),
    (error: unknown) => String(error).includes("REVIEW_CONFLICT"),
  );

  const row = await db.query<{ moderation_status: string; version: number }>(
    "SELECT moderation_status, version FROM public.review_submissions WHERE id = $1",
    [reviewId],
  );
  assert.deepEqual(row.rows[0], { moderation_status: "approved", version: 2 });
});

test("only a Full Admin can re-open a rejected review, with a mandatory reason", async () => {
  const reviewId = await submit();
  await moderate(OPERATIONAL_ADMIN, reviewId, "rejected", "Duplicate submission");

  await assert.rejects(
    open(OPERATIONAL_ADMIN, reviewId, "Second look", 2),
    (error: unknown) => String(error).includes("REVIEW_FORBIDDEN"),
  );
  await assert.rejects(
    open(FULL_ADMIN, reviewId, "   ", 2),
    (error: unknown) => String(error).includes("REVIEW_REASON_REQUIRED"),
  );

  const reopened = await open(FULL_ADMIN, reviewId, "Customer supplied details", 2);
  assert.equal(reopened.moderation_status, "pending");
  assert.equal(reopened.version, 3);

  const row = await db.query<{
    moderation_status: string;
    moderated_by: string | null;
    moderated_at: string | null;
    moderation_note: string | null;
  }>(
    "SELECT moderation_status, moderated_by, moderated_at, moderation_note FROM public.review_submissions WHERE id = $1",
    [reviewId],
  );
  assert.deepEqual(row.rows[0], {
    moderation_status: "pending",
    moderated_by: null,
    moderated_at: null,
    moderation_note: null,
  });

  const audit = await auditRows();
  assert.equal(audit.at(-1)?.action, "review.reopened");
  assert.equal(audit.at(-1)?.reason, "Customer supplied details");
});

test("publish, edit the public version and unpublish without touching the original", async () => {
  const reviewId = await submit({ body: "Original customer wording." });
  await moderate(FULL_ADMIN, reviewId, "approved", null, 1);

  await assert.rejects(
    publish(FULL_ADMIN, reviewId, "update", "Edited text", 2),
    (error: unknown) => String(error).includes("REVIEW_INVALID_TRANSITION"),
  );

  const published = await publish(
    OPERATIONAL_ADMIN,
    reviewId,
    "publish",
    "Published wording, version one.",
    2,
  );
  assert.equal(published.published, true);
  assert.equal(published.published_version, 1);
  assert.equal(published.version, 3);

  const edited = await publish(
    OPERATIONAL_ADMIN,
    reviewId,
    "update",
    "Published wording, version two.",
    3,
  );
  assert.equal(edited.published_version, 2);
  assert.equal(edited.version, 4);

  const original = await db.query<{ body_original: string; body_published: string }>(
    "SELECT body_original, body_published FROM public.review_submissions WHERE id = $1",
    [reviewId],
  );
  assert.equal(original.rows[0].body_original, "Original customer wording.");
  assert.equal(original.rows[0].body_published, "Published wording, version two.");

  const unpublished = await publish(
    OPERATIONAL_ADMIN,
    reviewId,
    "unpublish",
    null,
    4,
  );
  assert.equal(unpublished.published, false);
  assert.equal(unpublished.published_version, null);

  const cleared = await db.query<{
    body_published: string | null;
    published_at: string | null;
    published_version: number | null;
  }>(
    "SELECT body_published, published_at, published_version FROM public.review_submissions WHERE id = $1",
    [reviewId],
  );
  assert.deepEqual(cleared.rows[0], {
    body_published: null,
    published_at: null,
    published_version: null,
  });

  const actions = (await auditRows()).map((entry) => entry.action);
  assert.deepEqual(actions, [
    "review.submitted",
    "review.approved",
    "review.published",
    "review.publication_updated",
    "review.unpublished",
  ]);
  // Publication audit payloads record state, never customer or published text.
  const serialised = JSON.stringify(await auditRows());
  assert.equal(serialised.includes("Published wording"), false);
  assert.equal(serialised.includes("Original customer wording"), false);
});

test("an unapproved or unconsented review cannot be published", async () => {
  const pending = await submit();
  await assert.rejects(
    publish(FULL_ADMIN, pending, "publish", "Too early", 1),
    (error: unknown) => String(error).includes("REVIEW_INVALID_TRANSITION"),
  );

  const unconsented = await submit({ name: "No permission", body: "No consent here." });
  await db.query("UPDATE public.review_submissions SET consent = false WHERE id = $1", [
    unconsented,
  ]);
  // Approval records the internal decision; publication is what requires consent.
  await moderate(FULL_ADMIN, unconsented, "approved", null, 1);
  await assert.rejects(
    publish(FULL_ADMIN, unconsented, "publish", "Not allowed", 2),
    (error: unknown) => String(error).includes("REVIEW_CONSENT_REQUIRED"),
  );
});

test("overrides are Full Admin only, require a reason and use distinct audit actions", async () => {
  const reviewId = await submit();
  await moderate(FULL_ADMIN, reviewId, "approved", null, 1);

  await assert.rejects(
    override(OPERATIONAL_ADMIN, reviewId, "reject", "Not allowed", null, 2),
    (error: unknown) => String(error).includes("REVIEW_FORBIDDEN"),
  );
  await assert.rejects(
    override(FULL_ADMIN, reviewId, "reject", "  ", null, 2),
    (error: unknown) => String(error).includes("REVIEW_REASON_REQUIRED"),
  );

  const rejected = await override(
    FULL_ADMIN,
    reviewId,
    "reject",
    "Customer withdrew permission",
    null,
    2,
  );
  assert.equal(rejected.moderation_status, "rejected");

  const published = await override(
    FULL_ADMIN,
    reviewId,
    "publish",
    "Emergency correction",
    "Corrected public wording.",
    3,
  );
  assert.equal(published.moderation_status, "approved");
  assert.equal(published.published, true);

  const unpublished = await override(
    FULL_ADMIN,
    reviewId,
    "unpublish",
    "Owner request",
    null,
    4,
  );
  assert.equal(unpublished.published, false);

  const audit = await auditRows();
  assert.deepEqual(
    audit.map((entry) => entry.action),
    [
      "review.submitted",
      "review.approved",
      "review.override_reject",
      "review.override_publish",
      "review.override_unpublish",
    ],
  );
  assert.equal(audit[2].reason, "Customer withdrew permission");
  assert.equal(audit[2].actor_id, FULL_ADMIN);
  // The rejected decision removed the publication; the override publish restored
  // exactly what was supplied, not the immutable original.
  const row = await db.query<{ body_original: string }>(
    "SELECT body_original FROM public.review_submissions WHERE id = $1",
    [reviewId],
  );
  assert.equal(row.rows[0].body_original, "The laundry was carefully handled and returned on time.");
});

test("reply drafts stay private and publishing is gated on a published review", async () => {
  const reviewId = await submit();
  await moderate(FULL_ADMIN, reviewId, "approved", null, 1);

  const draft = await draftReply(
    OPERATIONAL_ADMIN,
    reviewId,
    "Thank you for the feedback.",
    2,
  );
  assert.equal(draft.reply_status, "draft");
  assert.equal(draft.version, 3);

  // The review is approved but not published yet, so the reply cannot go public.
  await assert.rejects(
    publishReply(FULL_ADMIN, reviewId, 3),
    (error: unknown) => String(error).includes("REVIEW_INVALID_TRANSITION"),
  );

  await assert.rejects(
    draftReply(FULL_ADMIN, reviewId, "   ", 3),
    (error: unknown) => String(error).includes("REVIEW_INVALID_REPLY"),
  );
  await assert.rejects(
    draftReply(FULL_ADMIN, reviewId, "Stale edit", 1),
    (error: unknown) => String(error).includes("REVIEW_CONFLICT"),
  );

  // A draft reply is not visible through the public view.
  await db.exec("SET ROLE anon");
  try {
    const visible = await db.query<{ reply_body: string | null }>(
      "SELECT reply_body FROM public.published_reviews",
    );
    assert.equal(visible.rows.length, 0);
  } finally {
    await db.exec("RESET ROLE");
  }
});

test("submit -> approve -> publish -> reply keeps prior text and the publication visible", async () => {
  const reviewId = await submit({ body: "Original customer wording." });
  await moderate(FULL_ADMIN, reviewId, "approved", null, 1);
  await publish(FULL_ADMIN, reviewId, "publish", "Published customer text.", 2);

  const firstDraft = await draftReply(
    OPERATIONAL_ADMIN,
    reviewId,
    "Thank you for your review.",
    3,
  );
  assert.equal(firstDraft.reply_status, "draft");
  const firstReply = await publishReply(OPERATIONAL_ADMIN, reviewId, 4);
  assert.equal(firstReply.reply_status, "published");

  await db.exec("SET ROLE anon");
  try {
    const visible = await db.query<{
      body_published: string;
      reply_body: string | null;
    }>("SELECT body_published, reply_body FROM public.published_reviews");
    assert.equal(visible.rows.length, 1);
    assert.equal(visible.rows[0].body_published, "Published customer text.");
    assert.equal(visible.rows[0].reply_body, "Thank you for your review.");
  } finally {
    await db.exec("RESET ROLE");
  }

  const replacement = await draftReply(
    FULL_ADMIN,
    reviewId,
    "An updated response.",
    5,
  );
  assert.equal(replacement.reply_status, "draft");

  const revisions = await db.query<{ body: string; replaced_by: string }>(
    "SELECT body, replaced_by FROM public.review_reply_revisions",
  );
  assert.equal(revisions.rows.length, 1);
  assert.equal(revisions.rows[0].body, "Thank you for your review.");
  assert.equal(revisions.rows[0].replaced_by, FULL_ADMIN);

  // The approved publication stays visible while the replacement reply is a draft;
  // the draft text is withheld.
  await db.exec("SET ROLE anon");
  try {
    const visible = await db.query<{
      body_published: string;
      reply_body: string | null;
    }>("SELECT body_published, reply_body FROM public.published_reviews");
    assert.equal(visible.rows.length, 1);
    assert.equal(visible.rows[0].body_published, "Published customer text.");
    assert.equal(visible.rows[0].reply_body, null);
  } finally {
    await db.exec("RESET ROLE");
  }

  const secondReply = await publishReply(FULL_ADMIN, reviewId, 6);
  assert.equal(secondReply.reply_status, "published");

  await db.exec("SET ROLE anon");
  try {
    const visible = await db.query<{ reply_body: string }>(
      "SELECT reply_body FROM public.published_reviews",
    );
    assert.equal(visible.rows.length, 1);
    assert.equal(visible.rows[0].reply_body, "An updated response.");
  } finally {
    await db.exec("RESET ROLE");
  }

  const original = await db.query<{ body_original: string }>(
    "SELECT body_original FROM public.review_submissions WHERE id = $1",
    [reviewId],
  );
  assert.equal(original.rows[0].body_original, "Original customer wording.");

  const audit = await auditRows();
  assert.deepEqual(
    audit.map((entry) => entry.action),
    [
      "review.submitted",
      "review.approved",
      "review.published",
      "review.reply_drafted",
      "review.reply_published",
      "review.reply_drafted",
      "review.reply_published",
    ],
  );
  const serialised = JSON.stringify(audit);
  assert.equal(serialised.includes("Thank you for your review."), false);
  assert.equal(serialised.includes("An updated response."), false);

  // Retained replies are append-only.
  await assert.rejects(
    db.query("UPDATE public.review_reply_revisions SET body = 'changed'"),
    (error: unknown) =>
      String(error).includes("REVIEW_REPLY_REVISION_IMMUTABLE"),
  );
});

test("a disabled administrator is rejected by the trusted functions", async () => {
  const reviewId = await submit();
  await db.query(
    "UPDATE public.admin_profiles SET disabled_at = now() WHERE user_id = $1",
    [FULL_ADMIN],
  );
  try {
    await assert.rejects(
      moderate(FULL_ADMIN, reviewId, "approved", null, 1),
      (error: unknown) => String(error).includes("REVIEW_FORBIDDEN"),
    );
  } finally {
    await db.query(
      "UPDATE public.admin_profiles SET disabled_at = NULL WHERE user_id = $1",
      [FULL_ADMIN],
    );
  }
  const row = await db.query<{ moderation_status: string }>(
    "SELECT moderation_status FROM public.review_submissions WHERE id = $1",
    [reviewId],
  );
  assert.equal(row.rows[0].moderation_status, "pending");
});
