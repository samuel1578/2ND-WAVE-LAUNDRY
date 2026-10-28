-- Phase 5 MVP newsletter interest operator security checks.
-- Run only against a disposable local Supabase/PostgreSQL database after all
-- migrations are applied. This file does not apply migrations or mutate data.

BEGIN;

DO $$
DECLARE
    v_rls boolean;
    v_policy_count integer;
    v_enum_count integer;
    v_trigger_count integer;
BEGIN
    SELECT c.relrowsecurity INTO v_rls
    FROM pg_class AS c
    WHERE c.oid = 'public.newsletter_interest'::regclass;
    IF v_rls IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'newsletter_interest RLS is not enabled';
    END IF;

    SELECT count(*) INTO v_policy_count
    FROM pg_policy
    WHERE polrelid = 'public.newsletter_interest'::regclass;
    IF v_policy_count <> 0 THEN
        RAISE EXCEPTION 'newsletter_interest must stay deny-by-default with zero policies';
    END IF;

    IF has_table_privilege('anon', 'public.newsletter_interest', 'SELECT')
       OR has_table_privilege('anon', 'public.newsletter_interest', 'INSERT')
       OR has_table_privilege('anon', 'public.newsletter_interest', 'UPDATE')
       OR has_table_privilege('anon', 'public.newsletter_interest', 'DELETE')
       OR has_table_privilege('authenticated', 'public.newsletter_interest', 'SELECT')
       OR has_table_privilege('authenticated', 'public.newsletter_interest', 'INSERT')
       OR has_table_privilege('authenticated', 'public.newsletter_interest', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.newsletter_interest', 'DELETE') THEN
        RAISE EXCEPTION 'browser role has a direct privilege on newsletter_interest';
    END IF;

    IF NOT has_table_privilege('service_role', 'public.newsletter_interest', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.newsletter_interest', 'INSERT')
       OR has_table_privilege('service_role', 'public.newsletter_interest', 'UPDATE')
       OR has_table_privilege('service_role', 'public.newsletter_interest', 'DELETE') THEN
        RAISE EXCEPTION 'service_role grants do not match the append-only trusted-server contract';
    END IF;

    IF has_function_privilege('anon', 'public.newsletter_interest_submit(text,boolean,text,text,text,text,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.newsletter_interest_submit(text,boolean,text,text,text,text,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.newsletter_interest_submit(text,boolean,text,text,text,text,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'newsletter_interest_submit grants do not match the trusted-server-only contract';
    END IF;

    SELECT count(*) INTO v_enum_count
    FROM pg_enum
    WHERE enumlabel = 'newsletter_interest_received'
      AND enumtypid = 'public.email_template'::regtype;
    IF v_enum_count <> 1 THEN
        RAISE EXCEPTION 'newsletter_interest_received enum value is missing';
    END IF;

    SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
    WHERE tgrelid = 'public.newsletter_interest'::regclass
      AND tgname = 'newsletter_interest_immutable'
      AND NOT tgisinternal;
    IF v_trigger_count <> 1 THEN
        RAISE EXCEPTION 'newsletter_interest immutability trigger is missing';
    END IF;
END;
$$;

ROLLBACK;
