-- Phase 4B — email template verification and deliberate resend operations.
-- Forward-only. The existing transactional enqueue triggers and worker policy
-- remain unchanged for ordinary customer and staff notifications.

BEGIN;

ALTER TABLE public.email_outbox
    ADD COLUMN is_test boolean NOT NULL DEFAULT false,
    ADD COLUMN test_context jsonb,
    ADD COLUMN resend_of uuid REFERENCES public.email_outbox(id) ON DELETE SET NULL;

ALTER TABLE public.email_outbox
    ADD CONSTRAINT email_outbox_test_context_shape
    CHECK (
        (is_test = false AND test_context IS NULL)
        OR (
            is_test = true
            AND booking_id IS NULL
            AND booking_version IS NULL
            AND test_context IS NOT NULL
            AND jsonb_typeof(test_context) = 'object'
            AND test_context ? 'booking'
            AND (test_context - 'booking' - 'staff') = '{}'::jsonb
            AND jsonb_typeof(test_context->'booking') = 'object'
            AND pg_column_size(test_context) <= 8192
        )
    );

-- Resends are new delivery rows, not edits to a sent row. Preserve one normal
-- event per booking/template/version/recipient while allowing audited resend
-- rows to share that business-event identity.
ALTER TABLE public.email_outbox
    DROP CONSTRAINT email_outbox_booking_event_recipient_unique;

CREATE UNIQUE INDEX email_outbox_booking_event_recipient_unique
    ON public.email_outbox (booking_id, template, booking_version, recipient_email)
    WHERE booking_id IS NOT NULL AND booking_version IS NOT NULL AND resend_of IS NULL;

COMMENT ON COLUMN public.email_outbox.is_test IS
'Identifies a controlled administrator template test. Test rows have no booking link and use a fixed, non-customer fixture context.';
COMMENT ON COLUMN public.email_outbox.test_context IS
'Fixed template-preview fixture used only for controlled test deliveries; it contains no customer or booking data.';
COMMENT ON COLUMN public.email_outbox.resend_of IS
'Original provider-accepted outbox row for a deliberate, audited resend. The resend is a new outbox row with a fresh idempotency key.';

CREATE OR REPLACE FUNCTION public.email_outbox_create_test_send(
    p_template public.email_template,
    p_recipient_email text,
    p_test_context jsonb,
    p_actor_id uuid,
    p_correlation uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_email text := lower(btrim(coalesce(p_recipient_email, '')));
    v_status text;
    v_id uuid := gen_random_uuid();
    v_payload jsonb;
BEGIN
    IF p_actor_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.admin_profiles AS profile
        WHERE profile.user_id = p_actor_id
          AND profile.role = 'full_admin'
          AND profile.disabled_at IS NULL
        FOR UPDATE
    ) THEN
        RAISE EXCEPTION 'EMAIL_TEST_FORBIDDEN: an active Full Admin is required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_template IS NULL OR p_test_context IS NULL
       OR jsonb_typeof(p_test_context) <> 'object'
       OR NOT (p_test_context ? 'booking')
       OR (p_test_context - 'booking'::text - 'staff'::text) <> '{}'::jsonb
       OR jsonb_typeof(p_test_context->'booking') <> 'object'
       OR (p_test_context->'booking') - 'reference'::text - 'customerName'::text - 'serviceTitles'::text
            - 'requestedDate'::text - 'requestedTime'::text - 'agreedPickupAt'::text - 'agreedFee'::text
            - 'currency'::text - 'branch'::text <> '{}'::jsonb
       OR jsonb_typeof(p_test_context->'booking'->'reference') <> 'string'
       OR jsonb_typeof(p_test_context->'booking'->'customerName') <> 'string'
       OR jsonb_typeof(p_test_context->'booking'->'serviceTitles') <> 'array'
       OR jsonb_typeof(p_test_context->'booking'->'currency') <> 'string'
       OR pg_column_size(p_test_context) > 8192 THEN
        RAISE EXCEPTION 'EMAIL_TEST_CONTEXT: a valid fixed template fixture is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       OR char_length(v_email) > 254 THEN
        RAISE EXCEPTION 'EMAIL_TEST_RECIPIENT: a valid controlled recipient is required.'
            USING ERRCODE = 'P0001';
    END IF;

    v_status := CASE p_template::text
        WHEN 'booking_created' THEN 'pending'
        WHEN 'booking_confirmed' THEN 'confirmed'
        WHEN 'booking_processing_started' THEN 'processing'
        WHEN 'booking_ready' THEN 'ready'
        WHEN 'booking_completed' THEN 'completed'
        WHEN 'booking_cancelled' THEN 'cancelled'
        WHEN 'staff_order_pending' THEN 'pending'
        WHEN 'staff_order_processing' THEN 'processing'
        WHEN 'staff_order_ready' THEN 'ready'
        WHEN 'staff_order_completed' THEN 'completed'
        WHEN 'staff_order_cancelled' THEN 'cancelled'
    END;

    v_payload := jsonb_build_object(
        'booking_reference', '2W-0000000000',
        'status', v_status
    );
    IF p_template::text LIKE 'staff_order_%' THEN
        IF NOT (p_test_context ? 'staff')
           OR jsonb_typeof(p_test_context->'staff') <> 'object'
           OR ((p_test_context->'staff') - 'previousStatus'::text - 'actorType'::text - 'actorName'::text
                - 'actorRole'::text - 'occurredAt'::text - 'cancellationReason'::text) <> '{}'::jsonb THEN
            RAISE EXCEPTION 'EMAIL_TEST_CONTEXT: a valid staff fixture is required.'
                USING ERRCODE = 'P0001';
        END IF;
        v_payload := v_payload || jsonb_build_object(
            'previous_status', CASE WHEN v_status = 'pending' THEN '' ELSE 'pending' END,
            'actor_kind', 'system',
            'actor_name', 'Template test',
            'actor_role', '',
            'occurred_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'cancellation_reason', CASE WHEN v_status = 'cancelled' THEN 'Controlled template test.' ELSE '' END
        );
    ELSIF p_test_context ? 'staff' THEN
        RAISE EXCEPTION 'EMAIL_TEST_CONTEXT: customer fixtures cannot include staff metadata.'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.email_outbox (
        id, idempotency_key, template, recipient_email, payload,
        is_test, test_context
    ) VALUES (
        v_id, 'email-test:' || v_id::text, p_template, v_email, v_payload,
        true, p_test_context
    );

    PERFORM private.insert_audit_event(
        p_actor_id,
        'email.test_queued',
        'email_outbox',
        v_id::text,
        NULL,
        jsonb_build_object('template', p_template::text, 'status', 'pending', 'test', true),
        'Queued a controlled template test to the configured test recipient.',
        p_correlation
    );

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.email_outbox_create_test_send(
    public.email_template, text, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_outbox_create_test_send(
    public.email_template, text, jsonb, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION public.email_outbox_create_test_send(
    public.email_template, text, jsonb, uuid, uuid
) IS
'Queues one controlled template test to a server-configured recipient using a non-customer fixture, with Full Admin revalidation and an atomic audit event.';

CREATE OR REPLACE FUNCTION public.email_outbox_resend(
    p_id uuid,
    p_actor_id uuid,
    p_reason text,
    p_correlation uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_source public.email_outbox%ROWTYPE;
    v_reason text := btrim(coalesce(p_reason, ''));
    v_new_id uuid := gen_random_uuid();
BEGIN
    IF p_actor_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.admin_profiles AS profile
        WHERE profile.user_id = p_actor_id
          AND profile.role = 'full_admin'
          AND profile.disabled_at IS NULL
        FOR UPDATE
    ) THEN
        RAISE EXCEPTION 'EMAIL_RESEND_FORBIDDEN: an active Full Admin is required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_id IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500
       OR v_reason ~ '[\r\n]' THEN
        RAISE EXCEPTION 'EMAIL_RESEND_REASON: a short, single-line reason is required.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_source
    FROM public.email_outbox
    WHERE id = p_id
      AND status = 'sent'
      AND is_test = false
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EMAIL_RESEND_NOT_AVAILABLE: only accepted live messages can be resent.'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.email_outbox (
        id, booking_id, booking_version, idempotency_key, template,
        recipient_email, payload, status, attempt_count, max_attempts,
        next_attempt_at, is_test, test_context, resend_of
    ) VALUES (
        v_new_id, v_source.booking_id, v_source.booking_version,
        'email-resend:' || v_new_id::text, v_source.template,
        v_source.recipient_email, v_source.payload, 'pending', 0, 5,
        now(), false, NULL, v_source.id
    );

    PERFORM private.insert_audit_event(
        p_actor_id,
        'email.resent',
        'email_outbox',
        v_new_id::text,
        jsonb_build_object('source_outbox_id', v_source.id, 'status', 'sent', 'template', v_source.template::text),
        jsonb_build_object('source_outbox_id', v_source.id, 'status', 'pending', 'template', v_source.template::text),
        v_reason,
        p_correlation
    );

    RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.email_outbox_resend(uuid, uuid, text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_outbox_resend(uuid, uuid, text, uuid)
TO service_role;

COMMENT ON FUNCTION public.email_outbox_resend(uuid, uuid, text, uuid) IS
'Creates a new idempotent outbox row for a deliberate resend of a provider-accepted live email, with a mandatory reason and atomic Full Admin audit record.';

COMMIT;

-- Operator verification: public clients have no execution rights; only service_role.
SELECT
    p.proname,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('email_outbox_create_test_send', 'email_outbox_resend')
ORDER BY p.proname;
