-- Sprint 3C public read-path and reply security operator checks.
-- Run only against a disposable local Supabase/PostgreSQL database after all
-- migrations are applied. This file does not apply migrations or mutate data.

BEGIN;

DO $$
DECLARE
    v_reloptions text;
    v_policy_count integer;
BEGIN
    IF to_regclass('public.published_reviews') IS NULL THEN
        RAISE EXCEPTION 'published_reviews view is missing';
    END IF;

    SELECT coalesce(array_to_string(c.reloptions, ','), '')
    INTO v_reloptions
    FROM pg_class AS c
    WHERE c.oid = 'public.published_reviews'::regclass;
    IF v_reloptions NOT LIKE '%security_invoker=true%' THEN
        RAISE EXCEPTION 'published_reviews is not a security_invoker view';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE attrelid = 'public.published_reviews'::regclass
          AND attnum > 0
          AND attname IN (
              'body_original', 'source_ip_hash', 'moderation_note',
              'idempotency_key', 'submission_hash', 'moderated_by'
          )
    ) THEN
        RAISE EXCEPTION 'published_reviews exposes a private review column';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE attrelid = 'public.published_reviews'::regclass
          AND attnum > 0
          AND attname = 'body_published'
    ) THEN
        RAISE EXCEPTION 'published_reviews does not expose the published body';
    END IF;

    SELECT count(*) INTO v_policy_count
    FROM pg_policy
    WHERE polrelid = 'public.review_submissions'::regclass
      AND polname = 'review_submissions_public_published_read';
    IF v_policy_count <> 1 THEN
        RAISE EXCEPTION 'published-only review read policy is missing';
    END IF;

    IF has_table_privilege('anon', 'public.review_submissions', 'INSERT')
       OR has_table_privilege('anon', 'public.review_submissions', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.review_submissions', 'INSERT')
       OR has_table_privilege('authenticated', 'public.review_submissions', 'UPDATE') THEN
        RAISE EXCEPTION 'browser role has direct write privilege on review_submissions';
    END IF;

    IF has_column_privilege('anon', 'public.review_submissions', 'body_original', 'SELECT')
       OR has_column_privilege('anon', 'public.review_submissions', 'source_ip_hash', 'SELECT')
       OR has_column_privilege('anon', 'public.review_submissions', 'moderation_note', 'SELECT') THEN
        RAISE EXCEPTION 'anon can select private review fields directly';
    END IF;

    IF NOT has_table_privilege('anon', 'public.published_reviews', 'SELECT') THEN
        RAISE EXCEPTION 'anon cannot select the published review view';
    END IF;

    -- Reply revisions: administrator read only, append-only, never anon-visible.
    IF to_regclass('public.review_reply_revisions') IS NULL THEN
        RAISE EXCEPTION 'review_reply_revisions table is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = 'public.review_reply_revisions'::regclass
          AND relrowsecurity
    ) THEN
        RAISE EXCEPTION 'review_reply_revisions RLS is not enabled';
    END IF;
    IF has_table_privilege('anon', 'public.review_reply_revisions', 'SELECT')
       OR has_table_privilege('anon', 'public.review_reply_revisions', 'INSERT')
       OR has_table_privilege('authenticated', 'public.review_reply_revisions', 'INSERT') THEN
        RAISE EXCEPTION 'reply revisions are writable or anon-readable';
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.review_reply_revisions', 'SELECT') THEN
        RAISE EXCEPTION 'administrators cannot read retained replies';
    END IF;
    SELECT count(*) INTO v_policy_count
    FROM pg_policy
    WHERE polrelid = 'public.review_reply_revisions'::regclass
      AND polname = 'review_reply_revisions_admin_read';
    IF v_policy_count <> 1 THEN
        RAISE EXCEPTION 'reply revision administrator read policy is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.review_reply_revisions'::regclass
          AND tgname = 'review_reply_revision_immutable'
    ) THEN
        RAISE EXCEPTION 'reply revision immutability trigger is missing';
    END IF;

    IF has_function_privilege('anon', 'public.review_draft_reply(uuid,uuid,text,integer,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.review_draft_reply(uuid,uuid,text,integer,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.review_draft_reply(uuid,uuid,text,integer,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'review_draft_reply grants do not match the trusted-server-only contract';
    END IF;

    IF has_function_privilege('anon', 'public.review_reply_publish(uuid,uuid,integer,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.review_reply_publish(uuid,uuid,integer,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.review_reply_publish(uuid,uuid,integer,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'review_reply_publish grants do not match the trusted-server-only contract';
    END IF;
END;
$$;

ROLLBACK;
