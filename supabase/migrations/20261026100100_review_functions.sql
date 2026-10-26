-- Sprint 3A — trusted review submission function.
-- The Next.js server calls this through the elevated server-only Supabase client;
-- browser roles never receive INSERT or EXECUTE privileges.

BEGIN;

CREATE OR REPLACE FUNCTION public.review_submit(
    p_customer_name text,
    p_body_original text,
    p_rating smallint,
    p_branch text,
    p_consent boolean,
    p_consent_version text,
    p_notice_version text,
    p_source_ip_hash text,
    p_idempotency_key text,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name text := btrim(coalesce(p_customer_name, ''));
    v_body text := btrim(coalesce(p_body_original, ''));
    v_branch text := nullif(btrim(coalesce(p_branch, '')), '');
    v_consent_version text := btrim(coalesce(p_consent_version, ''));
    v_key text := btrim(coalesce(p_idempotency_key, ''));
    v_hash text;
    v_existing public.review_submissions;
    v_review public.review_submissions;
    v_links integer;
BEGIN
    IF char_length(v_key) NOT BETWEEN 16 AND 128 THEN
        RAISE EXCEPTION 'REVIEW_IDEMPOTENCY_REQUIRED: a valid idempotency key is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF char_length(v_name) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'REVIEW_INVALID_NAME: enter a name between 1 and 120 characters.'
            USING ERRCODE = 'P0001';
    END IF;
    IF char_length(v_body) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION 'REVIEW_INVALID_BODY: enter a review between 1 and 4000 characters.'
            USING ERRCODE = 'P0001';
    END IF;
    IF p_rating IS NOT NULL AND p_rating NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'REVIEW_INVALID_RATING: choose a rating from 1 to 5.'
            USING ERRCODE = 'P0001';
    END IF;
    IF v_branch IS NOT NULL AND char_length(v_branch) > 120 THEN
        RAISE EXCEPTION 'REVIEW_INVALID_BRANCH: choose a valid branch.'
            USING ERRCODE = 'P0001';
    END IF;
    IF p_consent IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'REVIEW_CONSENT_REQUIRED: permission to display the review is required.'
            USING ERRCODE = 'P0001';
    END IF;
    IF char_length(v_consent_version) NOT BETWEEN 1 AND 60 THEN
        RAISE EXCEPTION 'REVIEW_NOTICE_UNAVAILABLE: the approved notice version is not configured.'
            USING ERRCODE = 'P0001';
    END IF;
    IF p_source_ip_hash IS NOT NULL AND p_source_ip_hash !~ '^[a-f0-9]{32,64}$' THEN
        RAISE EXCEPTION 'REVIEW_INVALID_PAYLOAD: the submission could not be processed.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*) INTO v_links
    FROM regexp_matches(v_body, '(https?://|www\.)', 'gi');
    IF v_links > 2 THEN
        RAISE EXCEPTION 'REVIEW_SPAM_REJECTED: the review contains too many links.'
            USING ERRCODE = 'P0001';
    END IF;

    v_hash := md5(jsonb_build_object(
        'customer_name', v_name,
        'body_original', v_body,
        'rating', p_rating,
        'branch', v_branch,
        'consent', p_consent,
        'consent_version', v_consent_version,
        'notice_version', p_notice_version
    )::text);

    -- Return the original successful result for exact retries. A changed payload
    -- under the same key is a conflict, not a second review.
    SELECT * INTO v_existing
    FROM public.review_submissions
    WHERE submission_scope = 'public_review_form'
      AND idempotency_key = v_key;

    IF FOUND THEN
        IF v_existing.submission_hash <> v_hash THEN
            RAISE EXCEPTION 'REVIEW_IDEMPOTENCY_MISMATCH: this request changed; review it and submit again.'
                USING ERRCODE = 'P0001';
        END IF;
        RETURN jsonb_build_object('review_id', v_existing.id, 'replayed', true);
    END IF;

    INSERT INTO public.review_submissions (
        customer_name,
        body_original,
        rating,
        branch,
        consent,
        consent_version,
        notice_version,
        source_ip_hash,
        moderation_status,
        submission_scope,
        idempotency_key,
        submission_hash
    ) VALUES (
        v_name,
        v_body,
        p_rating,
        v_branch,
        true,
        v_consent_version,
        p_notice_version,
        p_source_ip_hash,
        'pending',
        'public_review_form',
        v_key,
        v_hash
    )
    ON CONFLICT (submission_scope, idempotency_key) DO NOTHING
    RETURNING * INTO v_review;

    IF NOT FOUND THEN
        SELECT * INTO v_existing
        FROM public.review_submissions
        WHERE submission_scope = 'public_review_form'
          AND idempotency_key = v_key;
        IF v_existing.submission_hash <> v_hash THEN
            RAISE EXCEPTION 'REVIEW_IDEMPOTENCY_MISMATCH: this request changed; review it and submit again.'
                USING ERRCODE = 'P0001';
        END IF;
        RETURN jsonb_build_object('review_id', v_existing.id, 'replayed', true);
    END IF;

    PERFORM private.insert_audit_event(
        NULL,
        'review.submitted',
        'review',
        v_review.id::text,
        NULL,
        jsonb_build_object('moderation_status', 'pending'),
        NULL,
        p_correlation
    );

    RETURN jsonb_build_object('review_id', v_review.id, 'replayed', false);
END;
$$;

COMMENT ON FUNCTION public.review_submit(text, text, smallint, text, boolean, text, text, text, text, uuid) IS
'Validates and persists one consented public review with idempotency and an atomic submission audit event. Trusted server only.';

REVOKE ALL ON FUNCTION public.review_submit(text, text, smallint, text, boolean, text, text, text, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_submit(text, text, smallint, text, boolean, text, text, text, text, uuid)
    TO service_role;

COMMIT;
