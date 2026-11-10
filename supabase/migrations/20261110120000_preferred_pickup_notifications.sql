BEGIN;

-- ============================================================
-- 1. Extend the existing email outbox payload contract
-- ============================================================

ALTER TABLE public.email_outbox
DROP CONSTRAINT email_outbox_payload_shape;

ALTER TABLE public.email_outbox
ADD CONSTRAINT email_outbox_payload_shape CHECK (
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
                    AND (
                        payload
                        - 'booking_reference'
                        - 'status'
                        - 'requested_date'
                        - 'requested_time'
                    ) = '{}'::jsonb
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
                    AND (
                        payload
                        - 'booking_reference'
                        - 'status'
                        - 'requested_date'
                        - 'requested_time'
                        - 'previous_status'
                        - 'actor_kind'
                        - 'actor_name'
                        - 'actor_role'
                        - 'occurred_at'
                        - 'cancellation_reason'
                    ) = '{}'::jsonb
                    AND jsonb_typeof(payload->'previous_status') = 'string'
                    AND jsonb_typeof(payload->'actor_kind') = 'string'
                    AND jsonb_typeof(payload->'actor_name') = 'string'
                    AND jsonb_typeof(payload->'actor_role') = 'string'
                    AND jsonb_typeof(payload->'occurred_at') = 'string'
                    AND jsonb_typeof(payload->'cancellation_reason') = 'string'
                    AND char_length(payload->>'cancellation_reason') <= 500
                )
            )
            AND (
                NOT (payload ? 'requested_date')
                OR payload->'requested_date' = 'null'::jsonb
                OR (
                    jsonb_typeof(payload->'requested_date') = 'string'
                    AND payload->>'requested_date' ~ '^\d{4}-\d{2}-\d{2}$'
                )
            )
            AND (
                NOT (payload ? 'requested_time')
                OR payload->'requested_time' = 'null'::jsonb
                OR (
                    jsonb_typeof(payload->'requested_time') = 'string'
                    AND payload->>'requested_time' ~ '^([01]\d|2[0-3]):[0-5]\d$'
                )
            )
        )
        OR
        (
            template = 'newsletter_interest_received'
            AND payload ? 'subscriber_email'
            AND payload ? 'submitted_at'
            AND payload ? 'source'
            AND (payload - 'subscriber_email' - 'submitted_at' - 'source') = '{}'::jsonb
            AND jsonb_typeof(payload->'subscriber_email') = 'string'
            AND jsonb_typeof(payload->'submitted_at') = 'string'
            AND jsonb_typeof(payload->'source') = 'string'
            AND payload->>'subscriber_email' ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
            AND char_length(payload->>'subscriber_email') BETWEEN 3 AND 254
            AND payload->>'source' = 'public_newsletter_form'
        )
        OR
        (
            template = 'enquiry_received'
            AND payload ? 'enquiry_id'
            AND payload ? 'kind'
            AND payload ? 'name'
            AND payload ? 'business'
            AND payload ? 'phone'
            AND payload ? 'topic'
            AND (
                payload
                - 'enquiry_id'
                - 'kind'
                - 'name'
                - 'business'
                - 'phone'
                - 'topic'
            ) = '{}'::jsonb
            AND jsonb_typeof(payload->'enquiry_id') = 'string'
            AND jsonb_typeof(payload->'kind') = 'string'
            AND jsonb_typeof(payload->'name') = 'string'
            AND jsonb_typeof(payload->'business') IN ('string', 'null')
            AND jsonb_typeof(payload->'phone') = 'string'
            AND jsonb_typeof(payload->'topic') IN ('string', 'null')
            AND payload->>'enquiry_id' ~ '^[0-9a-fA-F-]{36}$'
            AND payload->>'kind' IN ('general', 'commercial')
            AND char_length(payload->>'name') BETWEEN 1 AND 120
            AND (
                payload->'business' = 'null'::jsonb
                OR char_length(payload->>'business') <= 120
            )
            AND char_length(payload->>'phone') BETWEEN 1 AND 40
            AND (
                payload->'topic' = 'null'::jsonb
                OR char_length(payload->>'topic') <= 80
            )
        )
    )
);

COMMENT ON CONSTRAINT email_outbox_payload_shape
ON public.email_outbox IS
'Closed payload contract per template. Booking and staff notifications may additionally carry the committed requested_date and requested_time pair.';


-- ============================================================
-- 2. Shared pickup JSON formatter
-- ============================================================

CREATE OR REPLACE FUNCTION private.booking_requested_pickup_json(
    p_date date,
    p_time time
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'requested_date', to_char(p_date, 'YYYY-MM-DD'),
        'requested_time',
            CASE
                WHEN p_time IS NULL THEN NULL::text
                ELSE to_char(p_time, 'HH24:MI')
            END
    );
$$;

REVOKE ALL ON FUNCTION
private.booking_requested_pickup_json(date, time)
FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 3. Customer notification enqueue
-- ============================================================

CREATE OR REPLACE FUNCTION private.enqueue_booking_email(
    p_booking_id uuid,
    p_template public.email_template,
    p_booking_version integer,
    p_recipient_email text,
    p_booking_reference text,
    p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_email text := lower(btrim(coalesce(p_recipient_email, '')));
    v_reference text := btrim(coalesce(p_booking_reference, ''));
    v_status text := lower(btrim(coalesce(p_status, '')));
    v_expected_status text;
    v_pickup jsonb;
BEGIN
    IF v_email = ''
       OR char_length(v_email) > 254
       OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        RETURN false;
    END IF;

    IF p_booking_id IS NULL THEN
        RAISE EXCEPTION
            'EMAIL_OUTBOX_BOOKING_REQUIRED: a booking notification needs a booking.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_booking_version IS NULL OR p_booking_version < 1 THEN
        RAISE EXCEPTION
            'EMAIL_OUTBOX_VERSION: a committed booking version is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_template IS NULL THEN
        RAISE EXCEPTION
            'EMAIL_OUTBOX_TEMPLATE: a notification template is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_reference !~ '^2W-([0-9A-HJKMNP-TV-Z]{4}|[0-9A-HJKMNP-TV-Z]{10})$' THEN
        RAISE EXCEPTION
            'EMAIL_OUTBOX_REFERENCE: invalid booking reference.'
            USING ERRCODE = 'P0001';
    END IF;

    v_expected_status := CASE p_template
        WHEN 'booking_created' THEN 'pending'
        WHEN 'booking_confirmed' THEN 'confirmed'
        WHEN 'booking_processing_started' THEN 'processing'
        WHEN 'booking_ready' THEN 'ready'
        WHEN 'booking_completed' THEN 'completed'
        WHEN 'booking_cancelled' THEN 'cancelled'
    END;

    IF v_status IS DISTINCT FROM v_expected_status THEN
        RAISE EXCEPTION
            'EMAIL_OUTBOX_TEMPLATE_STATUS: template % does not match status %.',
            p_template,
            v_status
            USING ERRCODE = 'P0001';
    END IF;

    SELECT private.booking_requested_pickup_json(
        b.requested_date,
        b.requested_time
    )
    INTO v_pickup
    FROM public.bookings AS b
    WHERE b.id = p_booking_id;

    INSERT INTO public.email_outbox (
        booking_id,
        booking_version,
        idempotency_key,
        template,
        recipient_email,
        payload
    )
    VALUES (
        p_booking_id,
        p_booking_version,
        'booking:' || p_booking_id::text || ':' || p_template::text
            || ':v' || p_booking_version::text,
        p_template,
        v_email,
        jsonb_build_object(
            'booking_reference', v_reference,
            'status', v_status
        ) || coalesce(v_pickup, '{}'::jsonb)
    )
    ON CONFLICT DO NOTHING;

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION
private.enqueue_booking_email(
    uuid,
    public.email_template,
    integer,
    text,
    text,
    text
)
FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 4. Administrator notification enqueue
-- ============================================================

CREATE OR REPLACE FUNCTION private.enqueue_staff_order_alert(
    p_booking_id uuid,
    p_template public.email_template,
    p_booking_version integer,
    p_previous_status text,
    p_actor_kind text,
    p_actor_id uuid,
    p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_booking public.bookings;
    v_expected_status text;
    v_previous text := '';
    v_actor_kind text := lower(btrim(coalesce(p_actor_kind, '')));
    v_actor_email text := '';
    v_actor_name text := '';
    v_actor_role text := '';
    v_reason text := '';
    v_payload jsonb;
    v_count integer := 0;
BEGIN
    IF p_template IS NULL
       OR p_template::text NOT IN (
            'staff_order_pending',
            'staff_order_processing',
            'staff_order_ready',
            'staff_order_completed',
            'staff_order_cancelled'
       ) THEN
        RAISE EXCEPTION
            'STAFF_ALERT_TEMPLATE: a staff order template is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_booking_id IS NULL THEN
        RAISE EXCEPTION
            'STAFF_ALERT_BOOKING: a booking is required.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT *
    INTO v_booking
    FROM public.bookings
    WHERE id = p_booking_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'STAFF_ALERT_BOOKING: booking missing.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_booking_version IS NULL
       OR v_booking.version IS DISTINCT FROM p_booking_version THEN
        RAISE EXCEPTION
            'STAFF_ALERT_VERSION: the event does not match the committed booking version.'
            USING ERRCODE = 'P0001';
    END IF;

    v_expected_status := CASE p_template
        WHEN 'staff_order_pending' THEN 'pending'
        WHEN 'staff_order_processing' THEN 'processing'
        WHEN 'staff_order_ready' THEN 'ready'
        WHEN 'staff_order_completed' THEN 'completed'
        WHEN 'staff_order_cancelled' THEN 'cancelled'
    END;

    IF v_expected_status IS NULL
       OR v_booking.status::text IS DISTINCT FROM v_expected_status THEN
        RAISE EXCEPTION
            'STAFF_ALERT_STATUS: the booking is not in the state this alert describes.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_actor_kind NOT IN ('customer', 'admin', 'system') THEN
        RAISE EXCEPTION
            'STAFF_ALERT_ACTOR: an unsupported actor kind was supplied.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_actor_kind = 'admin' THEN
        IF p_actor_id IS NULL THEN
            RAISE EXCEPTION
                'STAFF_ALERT_ACTOR: an administrator id is required.'
                USING ERRCODE = 'P0001';
        END IF;

        SELECT
            btrim(ap.display_name),
            coalesce(lower(btrim(ap.email)), ''),
            coalesce(ap.role::text, '')
        INTO v_actor_name, v_actor_email, v_actor_role
        FROM public.admin_profiles AS ap
        WHERE ap.user_id = p_actor_id
          AND ap.disabled_at IS NULL;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'STAFF_ALERT_ACTOR: the acting administrator could not be verified.'
                USING ERRCODE = 'P0001';
        END IF;

        IF v_actor_name = '' THEN
            v_actor_name := v_actor_email;
        END IF;
    ELSIF p_actor_id IS NOT NULL THEN
        RAISE EXCEPTION
            'STAFF_ALERT_ACTOR: only an administrator event may carry an administrator id.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_actor_kind = 'customer' THEN
        v_actor_name := btrim(coalesce(v_booking.customer_name, ''));
    END IF;

    IF v_expected_status = 'pending' THEN
        v_previous := '';
    ELSE
        v_previous := lower(btrim(coalesce(p_previous_status, '')));
    END IF;

    IF v_expected_status = 'cancelled' THEN
        v_reason := left(
            regexp_replace(
                btrim(coalesce(
                    nullif(btrim(coalesce(p_reason, '')), ''),
                    v_booking.cancellation_reason,
                    ''
                )),
                '[[:space:]]+',
                ' ',
                'g'
            ),
            500
        );
    END IF;

    v_payload := jsonb_build_object(
        'booking_reference', v_booking.reference,
        'status', v_booking.status::text,
        'previous_status', v_previous,
        'actor_kind', v_actor_kind,
        'actor_name', v_actor_name,
        'actor_role', v_actor_role,
        'occurred_at',
            to_char(
                now() AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS"Z"'
            ),
        'cancellation_reason', v_reason
    ) || private.booking_requested_pickup_json(
        v_booking.requested_date,
        v_booking.requested_time
    );

    INSERT INTO public.email_outbox (
        booking_id,
        booking_version,
        idempotency_key,
        template,
        recipient_email,
        payload
    )
    SELECT
        v_booking.id,
        v_booking.version,
        'staff:' || v_booking.id::text || ':' || p_template::text
            || ':v' || v_booking.version::text || ':' || md5(r.email),
        p_template,
        r.email,
        v_payload
    FROM public.booking_alert_recipients AS r
    WHERE r.enabled
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION
private.enqueue_staff_order_alert(
    uuid,
    public.email_template,
    integer,
    text,
    text,
    uuid,
    text
)
FROM PUBLIC, anon, authenticated;

COMMIT;