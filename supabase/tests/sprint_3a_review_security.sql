-- Sprint 3A review persistence/security operator checks.
-- Run only against a disposable local Supabase/PostgreSQL database after all
-- migrations are applied. This file does not apply migrations or mutate data.

BEGIN;

DO $$
DECLARE
    v_rls boolean;
    v_policy_count integer;
BEGIN
    SELECT c.relrowsecurity INTO v_rls
    FROM pg_class AS c
    WHERE c.oid = 'public.review_submissions'::regclass;
    IF v_rls IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'review_submissions RLS is not enabled';
    END IF;

    SELECT count(*) INTO v_policy_count
    FROM pg_policy
    WHERE polrelid = 'public.review_submissions'::regclass;
    IF v_policy_count < 2 THEN
        RAISE EXCEPTION 'review_submissions expected administrator and published-read policies';
    END IF;

    IF has_table_privilege('anon', 'public.review_submissions', 'INSERT')
       OR has_table_privilege('authenticated', 'public.review_submissions', 'INSERT')
       OR has_table_privilege('anon', 'public.review_submissions', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.review_submissions', 'UPDATE') THEN
        RAISE EXCEPTION 'browser role has direct write privilege on review_submissions';
    END IF;

    IF has_column_privilege('anon', 'public.review_submissions', 'body_original', 'SELECT')
       OR has_column_privilege('anon', 'public.review_submissions', 'source_ip_hash', 'SELECT')
       OR has_column_privilege('anon', 'public.review_submissions', 'moderation_note', 'SELECT') THEN
        RAISE EXCEPTION 'anon can select private review fields';
    END IF;

    IF has_function_privilege('anon', 'public.review_submit(text,text,smallint,text,boolean,text,text,text,text,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.review_submit(text,text,smallint,text,boolean,text,text,text,text,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.review_submit(text,text,smallint,text,boolean,text,text,text,text,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'review_submit grants do not match the trusted-server-only contract';
    END IF;
END;
$$;

ROLLBACK;
