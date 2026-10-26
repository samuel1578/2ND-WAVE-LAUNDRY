-- Sprint 3B review moderation/publication/override operator checks.
-- Run only against a disposable local Supabase/PostgreSQL database after all
-- migrations are applied. This file does not apply migrations or mutate data.

BEGIN;

DO $$
DECLARE
    v_policy_count integer;
BEGIN
    IF to_regprocedure('public.review_moderate(uuid,uuid,text,text,integer,uuid)') IS NULL
       OR to_regprocedure('public.review_publish(uuid,uuid,text,text,integer,uuid)') IS NULL
       OR to_regprocedure('public.review_open(uuid,uuid,text,integer,uuid)') IS NULL
       OR to_regprocedure('public.review_override(uuid,uuid,text,text,text,integer,uuid)') IS NULL THEN
        RAISE EXCEPTION 'review moderation functions are missing';
    END IF;

    IF has_function_privilege('anon', 'public.review_moderate(uuid,uuid,text,text,integer,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.review_moderate(uuid,uuid,text,text,integer,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.review_moderate(uuid,uuid,text,text,integer,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'review_moderate grants do not match the trusted-server-only contract';
    END IF;

    IF has_function_privilege('anon', 'public.review_publish(uuid,uuid,text,text,integer,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.review_publish(uuid,uuid,text,text,integer,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.review_publish(uuid,uuid,text,text,integer,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'review_publish grants do not match the trusted-server-only contract';
    END IF;

    IF has_function_privilege('anon', 'public.review_open(uuid,uuid,text,integer,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.review_open(uuid,uuid,text,integer,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.review_open(uuid,uuid,text,integer,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'review_open grants do not match the trusted-server-only contract';
    END IF;

    IF has_function_privilege('anon', 'public.review_override(uuid,uuid,text,text,text,integer,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.review_override(uuid,uuid,text,text,text,integer,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.review_override(uuid,uuid,text,text,text,integer,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'review_override grants do not match the trusted-server-only contract';
    END IF;

    IF has_table_privilege('anon', 'public.review_submissions', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.review_submissions', 'UPDATE') THEN
        RAISE EXCEPTION 'browser role has direct update privilege on review_submissions';
    END IF;

    SELECT count(*) INTO v_policy_count
    FROM pg_policy
    WHERE polrelid = 'public.audit_events'::regclass
      AND polname = 'audit_events_select_review_history';
    IF v_policy_count <> 1 THEN
        RAISE EXCEPTION 'review history audit policy is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.review_submissions'::regclass
          AND tgname = 'review_submission_immutable'
    ) THEN
        RAISE EXCEPTION 'original review immutability trigger is missing';
    END IF;
END;
$$;

ROLLBACK;
