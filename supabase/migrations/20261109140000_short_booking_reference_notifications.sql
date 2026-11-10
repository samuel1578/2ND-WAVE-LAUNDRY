BEGIN;

-- =========================================================
-- Accept the short (4-character) booking reference in the
-- customer notification enqueue helper.
--
-- `private.enqueue_booking_email` runs from the AFTER INSERT
-- trigger on public.bookings. Its reference guard still required
-- a ten-character suffix, so every newly created booking with a
-- customer email raised EMAIL_OUTBOX_REFERENCE inside the
-- trigger, rolled back the whole submission and surfaced through
-- the API error mapping as a generic `conflict`.
--
-- Only the reference shape changes. The function signature,
-- optional-email behaviour, version/template/status checks and
-- idempotent insert are unchanged.
-- =========================================================

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
BEGIN
    -- Customer email is optional. Never queue, and never record a failure, for an
    -- absent or malformed address.
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

    -- Four characters for new bookings, ten for historical references. Both
    -- remain notifiable so an older booking can still receive status emails.
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
        )
    )
    ON CONFLICT DO NOTHING;

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION private.enqueue_booking_email(
    uuid, public.email_template, integer, text, text, text
) IS
'Inserts one idempotent outbox row for a committed booking event. Accepts the current four-character reference and historical ten-character references; skips an absent/invalid customer email; duplicate enqueue is a no-op. Trigger-only.';

REVOKE ALL ON FUNCTION private.enqueue_booking_email(
    uuid, public.email_template, integer, text, text, text
)
FROM PUBLIC, anon, authenticated;

COMMIT;
