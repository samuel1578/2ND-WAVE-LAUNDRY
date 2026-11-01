-- Correct the audit action for newsletter sign-ups on both fresh installs and
-- deployments that already applied the original newsletter-alert migration.
-- Historical audit events are left intact; this only fixes future submissions.
BEGIN;
DO $$
DECLARE
    v_signature regprocedure := to_regprocedure(
        'public.newsletter_interest_submit(text,boolean,text,text,text,text,uuid)'
    );
    v_definition text;
    v_corrected text;
BEGIN
    IF v_signature IS NULL THEN
        RAISE EXCEPTION 'newsletter_interest_submit function is missing';
    END IF;

    v_definition := pg_get_functiondef(v_signature);
    v_corrected := replace(
        v_definition,
        'newsletter_interest.submitted',
        'newsletter.interest_submitted'
    );

    IF v_corrected = v_definition THEN
        IF position('newsletter.interest_submitted' IN v_definition) > 0 THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'newsletter audit action could not be corrected';
    END IF;

    EXECUTE v_corrected;
END;
$$;
COMMIT;
