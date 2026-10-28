-- Phase 5 MVP — manager alert enqueueing for newsletter interest submissions.
--
-- Requires:
--   * 20261027120000_newsletter_interest.sql   (table + newsletter_interest_received enum value)
--   * 20261019120000_email_outbox.sql          (outbox)
--   * 20261022120100_staff_order_email_alerts.sql (current payload/template_status checks)
--   * 20261011120100_audit_events.sql + 20261011120300_admin_staff_functions.sql
--
-- Scope of this migration:
--   * widen the outbox payload and template/status checks so one non-booking
--     template can share the existing claim/retry/dead-letter delivery system;
--   * public.newsletter_interest_submit — validates a consented submission,
--     inserts the interest row (first-time-only via the unique email index),
--     and, only for a newly inserted row, queues exactly one manager alert to
--     the server-supplied recipient and writes an atomic audit event.
--
-- The recipient address is passed by the server (the hardcoded manager
-- constant in src/lib/newsletter/config.ts). No client value reaches this
-- function: only the elevated server role can execute it.
--
-- Forward-only: no earlier migration is edited. Customer and staff booking
-- payload shapes and their triggers are untouched.

BEGIN;

-- ============================================================
-- 1. OUTBOX CONSTRAINTS FOR THE MANAGER ALERT
-- ============================================================
--
-- Customer rows keep the minimal two-key payload and staff rows keep their
-- event metadata. The newsletter manager alert is not a booking event: it has
-- no booking link and carries only the submitted address, an enqueue
-- timestamp and the fixed provenance string.

ALTER TABLE public.email_outbox
DROP CONSTRAINT email_outbox_payload_shape;

ALTER TABLE public.email_outbox
ADD CONSTRAINT email_outbox_payload_shape
    CHECK (
        jsonb_typeof(payload) = 'object'
        AND (
            (
                payload ? 'booking_reference'
                AND payload ? 'status'
                AND jsonb_typeof(payload->'booking_reference') = 'string'
                AND jsonb_typeof(payload->'status') = 'string'
                AND (
                    (
                        template IN (
                            'booking_created',
                            'booking_confirmed',
                            'booking_processing_started',
                            'booking_ready',
                            'booking_completed',
                            'booking_cancelled'
                        )
                        AND (payload - 'booking_reference' - 'status') = '{}'::jsonb
                    )
                    OR
                    (
                        template IN (
                            'staff_order_pending',
                            'staff_order_processing',
                            'staff_order_ready',
                            'staff_order_completed',
                            'staff_order_cancelled'
                        )
                        AND (payload
                            - 'booking_reference'
                            - 'status'
                            - 'previous_status'
                            - 'actor_kind'
                            - 'actor_name'
                            - 'actor_role'
                            - 'occurred_at'
                            - 'cancellation_reason') = '{}'::jsonb
                        AND jsonb_typeof(payload->'previous_status') = 'string'
                        AND jsonb_typeof(payload->'actor_kind') = 'string'
                        AND jsonb_typeof(payload->'actor_name') = 'string'
                        AND jsonb_typeof(payload->'actor_role') = 'string'
                        AND jsonb_typeof(payload->'occurred_at') = 'string'
                        AND jsonb_typeof(payload->'cancellation_reason') = 'string'
                        AND char_length(payload->>'cancellation_reason') <= 500
                    )
                )
            )
            OR
            (
                template = 'newsletter_interest_received'
                AND payload ? 'subscriber_email'
                AND payload ? 'submitted_at'
                AND payload ? 'source'
                AND (payload
                    - 'subscriber_email'
                    - 'submitted_at'
                    - 'source') = '{}'::jsonb
                AND jsonb_typeof(payload->'subscriber_email') = 'string'
                AND jsonb_typeof(payload->'submitted_at') = 'string'
                AND jsonb_typeof(payload->'source') = 'string'
                AND payload->>'subscriber_email'
                    ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                AND char_length(payload->>'subscriber_email') BETWEEN 3 AND 254
                AND payload->>'source' = 'public_newsletter_form'
            )
        )
    );

ALTER TABLE public.email_outbox
DROP CONSTRAINT email_outbox_template_status;

ALTER TABLE public.email_outbox
ADD CONSTRAINT email_outbox_template_status
    CHECK (
        (template = 'booking_created'
            AND payload->>'status' = 'pending')
        OR (template = 'booking_confirmed'
            AND payload->>'status' = 'confirmed')
        OR (template = 'booking_processing_started'
            AND payload->>'status' = 'processing')
        OR (template = 'booking_ready'
            AND payload->>'status' = 'ready')
        OR (template = 'booking_completed'
            AND payload->>'status' = 'completed')
        OR (template = 'booking_cancelled'
            AND payload->>'status' = 'cancelled')
        OR (template = 'staff_order_pending'
            AND payload->>'status' = 'pending')
        OR (template = 'staff_order_processing'
            AND payload->>'status' = 'processing')
        OR (template = 'staff_order_ready'
            AND payload->>'status' = 'ready')
        OR (template = 'staff_order_completed'
            AND payload->>'status' = 'completed')
        OR (template = 'staff_order_cancelled'
            AND payload->>'status' = 'cancelled')
        -- The manager alert is not a booking status event; the payload shape
        -- check above is its only structural guard.
        OR template = 'newsletter_interest_received'
    );

COMMENT ON CONSTRAINT email_outbox_template_status ON public.email_outbox IS
'Pairs each booking/staff template with its committed status. newsletter_interest_received is exempt: it carries no status key and its payload is validated by email_outbox_payload_shape.';

-- ============================================================
-- 2. TRUSTED SUBMIT FUNCTION
-- ============================================================
--
-- SECURITY DEFINER because no client role may insert into the interest table
-- or the outbox. The Next.js server calls this through the elevated
-- server-only Supabase client. The function:
--   * normalises and validates the address, requires consent and a
--     server-supplied consent version (the browser cannot choose it);
--   * inserts one interest row; the unique email index makes a duplicate a
--     no-op that queues no second alert;
--   * for a newly inserted row only, queues exactly one manager alert and
--     writes one audit event in the same transaction, so a submission is
--     either fully recorded (row + alert + audit) or not at all;
--   * returns is_new so the server can keep the public response generic.

CREATE OR REPLACE FUNCTION public.newsletter_interest_submit(
    p_email text,
    p_consent boolean,
    p_consent_version text,
    p_source_ip_hash text,
    p_recipient_email text,
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
    v_email text := lower(btrim(coalesce(p_email, '')));
    v_consent_version text := btrim(coalesce(p_consent_version, ''));
    v_recipient text := lower(btrim(coalesce(p_recipient_email, '')));
    v_key text := btrim(coalesce(p_idempotency_key, ''));
    v_row public.newsletter_interest;
    v_existing_id uuid;
    v_is_new boolean := false;
BEGIN
    IF char_length(v_key) NOT BETWEEN 16 AND 128 THEN
        RAISE EXCEPTION
            'NEWSLETTER_IDEMPOTENCY_REQUIRED: a valid idempotency key is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF char_length(v_email) NOT BETWEEN 3 AND 254
       OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION
            'NEWSLETTER_INVALID_EMAIL: enter a valid email address.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_consent IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'NEWSLETTER_CONSENT_REQUIRED: consent to receive news and offers by email is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF char_length(v_consent_version) NOT BETWEEN 1 AND 60 THEN
        RAISE EXCEPTION
            'NEWSLETTER_NOTICE_UNAVAILABLE: the approved notice version is not configured.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_source_ip_hash IS NOT NULL
       AND p_source_ip_hash !~ '^[a-f0-9]{32,64}$' THEN
        RAISE EXCEPTION
            'NEWSLETTER_INVALID_PAYLOAD: the submission could not be processed.'
            USING ERRCODE = 'P0001';
    END IF;

    IF char_length(v_recipient) NOT BETWEEN 3 AND 254
       OR v_recipient !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION
            'NEWSLETTER_RECIPIENT_INVALID: the manager alert recipient is not configured.'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.newsletter_interest (
        email,
        consent_version,
        source,
        source_ip_hash
    )
    VALUES (
        v_email,
        v_consent_version,
        'public_newsletter_form',
        p_source_ip_hash
    )
    ON CONFLICT (email) DO NOTHING
    RETURNING * INTO v_row;

    IF FOUND THEN
        v_is_new := true;

        -- One alert per first-time address. The key embeds the address digest
        -- so a key reused across different addresses cannot silently swallow
        -- the second alert. `ON CONFLICT DO NOTHING` keeps a transport-level
        -- replay a no-op.
        INSERT INTO public.email_outbox (
            idempotency_key,
            template,
            recipient_email,
            payload
        )
        VALUES (
            'newsletter-interest:' || md5(v_email) || ':' || v_key,
            'newsletter_interest_received',
            v_recipient,
            jsonb_build_object(
                'subscriber_email', v_email,
                'submitted_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'source', 'public_newsletter_form'
            )
        )
        ON CONFLICT (idempotency_key) DO NOTHING;

        PERFORM private.insert_audit_event(
            NULL,
            'newsletter_interest.submitted',
            'newsletter_interest',
            v_row.id::text,
            NULL,
            jsonb_build_object(
                'email_hash', md5(v_email),
                'consent_version', v_consent_version,
                'source', 'public_newsletter_form',
                'alert_queued', true
            ),
            NULL,
            p_correlation
        );
    ELSE
        SELECT id INTO v_existing_id
        FROM public.newsletter_interest
        WHERE email = v_email;
    END IF;

    RETURN jsonb_build_object(
        'interest_id', coalesce(v_row.id, v_existing_id),
        'is_new', v_is_new
    );
END;
$$;

COMMENT ON FUNCTION public.newsletter_interest_submit(
    text, boolean, text, text, text, text, uuid
) IS
'Validates one consented public newsletter interest submission, inserts the first-time-only record and queues exactly one manager alert with an atomic audit event. A duplicate address returns is_new = false and queues nothing. Trusted server only.';

REVOKE ALL ON FUNCTION public.newsletter_interest_submit(
    text, boolean, text, text, text, text, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.newsletter_interest_submit(
    text, boolean, text, text, text, text, uuid
) TO service_role;

COMMIT;
