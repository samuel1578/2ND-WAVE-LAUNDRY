-- 2ND WAVE — Sprint 2A
-- Trusted booking functions: public submission plus administrative lifecycle
-- mutations, idempotency and reference generation.
--
-- Requires 20261011130000_booking_schema.sql and 20261011130100_booking_rls.sql.
--
-- Every public function here is callable by `service_role` only. The application
-- must validate the caller and establish their actual permissions in the trusted
-- Next.js server before invoking a function, and the database re-validates the
-- acting administrator inside each administrative function. A browser request can
-- therefore never forge an administrator, a status, a fee or an audit actor.

BEGIN;

-- ============================================================
-- 1. REFERENCE GENERATION
-- ============================================================

CREATE OR REPLACE FUNCTION private.booking_reference()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
    -- Opaque and non-sequential: ten random hexadecimal characters. Not derived
    -- from the booking id, so it cannot be used to enumerate or guess records.
    SELECT '2W-' || upper(
        substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
    );
$$;

COMMENT ON FUNCTION private.booking_reference() IS
'Generates an opaque customer-facing booking reference. Collisions are retried by the submission function.';

REVOKE ALL ON FUNCTION private.booking_reference()
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. SUBMISSION HASH
-- ============================================================

CREATE OR REPLACE FUNCTION private.booking_submission_hash(
    p_scope text,
    p_payload jsonb,
    p_services jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    -- jsonb text output is canonical (keys sorted, insignificant whitespace
    -- removed), so an identical submission always produces the same digest.
    SELECT md5(
        coalesce(p_scope, '') || '|' ||
        coalesce(p_payload, 'null'::jsonb)::text || '|' ||
        coalesce(p_services, 'null'::jsonb)::text
    );
$$;

COMMENT ON FUNCTION private.booking_submission_hash(text, jsonb, jsonb) IS
'Deterministic digest of a submission. An idempotency-key retry with a different digest is rejected as a conflict.';

REVOKE ALL ON FUNCTION private.booking_submission_hash(text, jsonb, jsonb)
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. ADMINISTRATOR GUARD
-- ============================================================

CREATE OR REPLACE FUNCTION private.assert_active_admin(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION
            'BOOKING_ACTOR_REQUIRED: no verified administrator identity.'
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_profiles
        WHERE user_id = p_actor
          AND disabled_at IS NULL
    ) THEN
        RAISE EXCEPTION
            'BOOKING_FORBIDDEN: an active administrator is required.'
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

COMMENT ON FUNCTION private.assert_active_admin(uuid) IS
'Re-validates the acting account against the database. Both administrator roles are permitted; a disabled or unknown account is rejected.';

REVOKE ALL ON FUNCTION private.assert_active_admin(uuid)
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4. SCHEDULING HELPERS
-- ============================================================

-- Resolves the pickup operating window for one branch and date.
--
-- Precedence:
--   1. an explicit date-specific exception for that branch;
--   2. the branch's weekly window for that weekday;
--   3. the approved settings default (07:00–17:00, open).
--
-- The fallback is the documented default, never an unrestricted window, so an
-- unconfigured or unknown branch still rejects out-of-hours requests.
CREATE OR REPLACE FUNCTION private.pickup_window(
    p_branch uuid,
    p_date date
)
RETURNS TABLE (opens time, closes time, is_closed boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_weekday smallint := extract(isodow FROM p_date)::smallint;
    v_default_start time;
    v_default_end time;
BEGIN
    IF p_branch IS NOT NULL THEN
        RETURN QUERY
        SELECT e.opens, e.closes, e.is_closed
        FROM public.branch_pickup_exceptions AS e
        WHERE e.branch_id = p_branch
          AND e.exception_date = p_date;

        IF FOUND THEN
            RETURN;
        END IF;

        RETURN QUERY
        SELECT w.opens, w.closes, w.is_closed
        FROM public.branch_pickup_windows AS w
        WHERE w.branch_id = p_branch
          AND w.weekday = v_weekday;

        IF FOUND THEN
            RETURN;
        END IF;
    END IF;

    SELECT bs.pickup_start, bs.pickup_end
    INTO v_default_start, v_default_end
    FROM public.booking_settings AS bs
    LIMIT 1;

    RETURN QUERY SELECT
        coalesce(v_default_start, time '07:00'),
        coalesce(v_default_end, time '17:00'),
        false;
END;
$$;

REVOKE ALL ON FUNCTION private.pickup_window(uuid, date)
FROM PUBLIC, anon, authenticated;

-- Validates a requested time against the window only (no "today" closure rule).
-- Used for administratively agreed appointments.
CREATE OR REPLACE FUNCTION private.assert_pickup_window(
    p_branch uuid,
    p_date date,
    p_time time
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_window record;
BEGIN
    SELECT * INTO v_window
    FROM private.pickup_window(p_branch, p_date);

    IF v_window.is_closed THEN
        RAISE EXCEPTION
            'BOOKING_PICKUP_CLOSED: pickup is not available on that date.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_time IS NOT NULL
       AND (p_time < v_window.opens OR p_time > v_window.closes) THEN
        RAISE EXCEPTION
            'BOOKING_PICKUP_WINDOW: pickup is available between % and % only.',
            v_window.opens,
            v_window.closes
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_pickup_window(uuid, date, time)
FROM PUBLIC, anon, authenticated;

-- Validates a customer's requested pickup. `p_now` is trusted server time; the
-- browser clock is never used. Same-day requests are rejected once the window has
-- closed, but a later date is always accepted.
CREATE OR REPLACE FUNCTION private.assert_pickup_request(
    p_branch uuid,
    p_date date,
    p_time time,
    p_now timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_local timestamp := p_now AT TIME ZONE 'Africa/Accra';
    v_today date := v_local::date;
    v_local_time time := v_local::time;
    v_window record;
BEGIN
    IF p_date IS NULL OR p_date < v_today THEN
        RAISE EXCEPTION
            'BOOKING_PICKUP_DATE: choose a valid pickup date.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_window
    FROM private.pickup_window(p_branch, p_date);

    IF v_window.is_closed THEN
        RAISE EXCEPTION
            'BOOKING_PICKUP_CLOSED: pickup is not available on that date.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_time IS NOT NULL
       AND (p_time < v_window.opens OR p_time > v_window.closes) THEN
        RAISE EXCEPTION
            'BOOKING_PICKUP_WINDOW: choose a preferred time between % and %.',
            v_window.opens,
            v_window.closes
            USING ERRCODE = 'P0001';
    END IF;

    -- Do not accept a specific same-day pickup time that has already passed.
    IF p_date = v_today AND p_time IS NOT NULL AND p_time < v_local_time THEN
        RAISE EXCEPTION
            'BOOKING_PICKUP_TIME_PAST: choose a future pickup time.'
            USING ERRCODE = 'P0001';
    END IF;

    -- The window is inclusive at its closing boundary for a requested time, but a
    -- same-day request is no longer accepted once the window has closed.
    IF p_date = v_today AND v_local_time >= v_window.closes THEN
        RAISE EXCEPTION
            'BOOKING_PICKUP_CLOSED: pickup hours have ended for today.'
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_pickup_request(uuid, date, time, timestamptz)
FROM PUBLIC, anon, authenticated;

-- Validates express/same-day eligibility separately from the pickup window. The
-- 11:00 cutoff applies only to an express booking requested for today.
CREATE OR REPLACE FUNCTION private.assert_express_request(
    p_date date,
    p_express boolean,
    p_now timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_local timestamp := p_now AT TIME ZONE 'Africa/Accra';
    v_today date := v_local::date;
    v_local_time time := v_local::time;
    v_cutoff time;
BEGIN
    IF NOT coalesce(p_express, false) THEN
        RETURN;
    END IF;

    IF p_date IS DISTINCT FROM v_today THEN
        RETURN;
    END IF;

    SELECT bs.express_cutoff INTO v_cutoff
    FROM public.booking_settings AS bs
    LIMIT 1;

    v_cutoff := coalesce(v_cutoff, time '11:00');

    -- Equality is accepted: a submission at exactly 11:00:00 local time is valid.
    IF v_local_time > v_cutoff THEN
        RAISE EXCEPTION
            'BOOKING_EXPRESS_CUTOFF: express pickup for today must be requested by %.',
            v_cutoff
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_express_request(date, boolean, timestamptz)
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5. LIFECYCLE RULES
-- ============================================================

CREATE OR REPLACE FUNCTION private.booking_transition_allowed(
    p_from public.booking_status,
    p_to public.booking_status
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_from = 'pending'
             AND p_to IN ('confirmed', 'cancelled') THEN true
        WHEN p_from = 'confirmed'
             AND p_to IN ('scheduled', 'picked_up', 'cancelled') THEN true
        WHEN p_from = 'scheduled'
             AND p_to IN ('picked_up', 'cancelled') THEN true
        WHEN p_from = 'picked_up'
             AND p_to IN ('processing', 'cancelled') THEN true
        WHEN p_from = 'processing'
             AND p_to IN ('ready', 'cancelled') THEN true
        WHEN p_from = 'ready'
             AND p_to IN ('out_for_delivery', 'completed', 'cancelled') THEN true
        WHEN p_from = 'out_for_delivery'
             AND p_to IN ('completed', 'cancelled') THEN true
        ELSE false
    END;
$$;

REVOKE ALL ON FUNCTION private.booking_transition_allowed(
    public.booking_status, public.booking_status
)
FROM PUBLIC, anon, authenticated;

-- Confirmation prerequisites (PRD §7, SRS ADM-03). The agreed appointment is
-- never inferred from the customer's request: it must have been recorded.
CREATE OR REPLACE FUNCTION private.assert_confirmation_ready(
    p_booking public.bookings
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_local timestamp;
BEGIN
    IF p_booking.assigned_branch_id IS NULL THEN
        RAISE EXCEPTION
            'BOOKING_CONFIRMATION_INCOMPLETE: assign a branch before confirming.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_booking.agreed_pickup_at IS NULL THEN
        RAISE EXCEPTION
            'BOOKING_CONFIRMATION_INCOMPLETE: record the agreed pickup date and time.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_booking.agreed_fee IS NULL THEN
        RAISE EXCEPTION
            'BOOKING_CONFIRMATION_INCOMPLETE: record the agreed pickup fee.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_booking.agreed_fee = 0
       AND (p_booking.zero_fee_reason IS NULL
            OR btrim(p_booking.zero_fee_reason) = '') THEN
        RAISE EXCEPTION
            'BOOKING_CONFIRMATION_INCOMPLETE: record the reason for a zero pickup fee.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_booking.contact_outcome IS NULL
       OR btrim(p_booking.contact_outcome) = '' THEN
        RAISE EXCEPTION
            'BOOKING_CONFIRMATION_INCOMPLETE: record the customer contact outcome.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_booking.confirmation_note IS NULL
       OR btrim(p_booking.confirmation_note) = '' THEN
        RAISE EXCEPTION
            'BOOKING_CONFIRMATION_INCOMPLETE: record the confirmation note.'
            USING ERRCODE = 'P0001';
    END IF;

    -- The agreed appointment must fall inside the branch pickup window.
    v_local := p_booking.agreed_pickup_at AT TIME ZONE 'Africa/Accra';
    PERFORM private.assert_pickup_window(
        p_booking.assigned_branch_id,
        v_local::date,
        v_local::time
    );
END;
$$;

REVOKE ALL ON FUNCTION private.assert_confirmation_ready(public.bookings)
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 6. PUBLIC SUBMISSION
-- ============================================================
--
-- The only path that creates a booking. It always starts as `pending`, never
-- assigns a branch, never sets an agreed appointment or fee and never marks
-- payment. Replay with the same key returns the original committed result, and a
-- replay after the cutoff is not re-evaluated.
CREATE OR REPLACE FUNCTION public.booking_submit(
    p_payload jsonb,
    p_services jsonb,
    p_idempotency_key text,
    p_submission_scope text,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_scope text := coalesce(
        nullif(btrim(p_submission_scope), ''),
        'public_booking_form'
    );
    v_key text := btrim(coalesce(p_idempotency_key, ''));
    v_now timestamptz := now();
    v_today date := (v_now AT TIME ZONE 'Africa/Accra')::date;
    v_hash text;
    v_reference text;
    v_booking public.bookings;
    v_attempt integer;
    v_name text;
    v_phone text;
    v_email text;
    v_whatsapp text;
    v_contact text;
    v_category text;
    v_load_size text;
    v_notes text;
    v_address text;
    v_landmark text;
    v_map text;
    v_transport text;
    v_date date;
    v_time time;
    v_time_raw text;
    v_express boolean;
    v_service jsonb;
    v_service_row public.services;
    v_service_count integer;
    v_accept boolean;
BEGIN
    -- Idempotency and payload shape.
    IF char_length(v_scope) < 3 OR char_length(v_scope) > 60 THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_SCOPE: invalid submission scope.'
            USING ERRCODE = 'P0001';
    END IF;

    IF char_length(v_key) < 16 OR char_length(v_key) > 128 THEN
        RAISE EXCEPTION
            'BOOKING_IDEMPOTENCY_REQUIRED: a valid idempotency key is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_PAYLOAD: a booking payload object is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_services IS NULL
       OR jsonb_typeof(p_services) <> 'array'
       OR jsonb_array_length(p_services) = 0 THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_SERVICE: select at least one service.'
            USING ERRCODE = 'P0001';
    END IF;

    v_service_count := jsonb_array_length(p_services);
    IF v_service_count > 12 THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_SERVICE: too many services selected.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Resolve an existing, committed request before current-time scheduling
    -- rules or the pause flag. A retry must return its original result even
    -- if today's cutoff has since passed or submissions were paused.
    v_hash := private.booking_submission_hash(v_scope, p_payload, p_services);
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE submission_scope = v_scope AND idempotency_key = v_key;

    IF FOUND THEN
        IF v_booking.submission_hash <> v_hash THEN
            RAISE EXCEPTION
                'BOOKING_IDEMPOTENCY_MISMATCH: this request changed. Review and submit again.'
                USING ERRCODE = 'P0001';
        END IF;
        RETURN jsonb_build_object(
            'booking_id', v_booking.id,
            'reference', v_booking.reference,
            'status', v_booking.status,
            'version', v_booking.version,
            'replayed', true
        );
    END IF;

    -- Collection may have been paused by a Full Admin.
    SELECT bs.accept_public_bookings INTO v_accept
    FROM public.booking_settings AS bs
    LIMIT 1;

    IF v_accept IS NOT NULL AND NOT v_accept THEN
        RAISE EXCEPTION
            'BOOKING_PAUSED: online pickup requests are paused for now.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Required customer details.
    v_name := btrim(coalesce(p_payload->>'customer_name', ''));
    IF char_length(v_name) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_NAME: enter the customer name.'
            USING ERRCODE = 'P0001';
    END IF;

    v_phone := btrim(coalesce(p_payload->>'customer_phone', ''));
    IF v_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_PHONE: enter a valid phone number.'
            USING ERRCODE = 'P0001';
    END IF;

    v_email := nullif(lower(btrim(coalesce(p_payload->>'customer_email', ''))), '');
    IF v_email IS NOT NULL
       AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
            OR char_length(v_email) > 254) THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_EMAIL: enter a valid email address.'
            USING ERRCODE = 'P0001';
    END IF;

    v_whatsapp := nullif(
        btrim(coalesce(p_payload->>'whatsapp_phone', '')), ''
    );
    IF v_whatsapp IS NOT NULL
       AND v_whatsapp !~ '^\+[1-9][0-9]{6,14}$' THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_PHONE: enter a valid WhatsApp number.'
            USING ERRCODE = 'P0001';
    END IF;

    v_contact := lower(coalesce(p_payload->>'contact_method', 'phone'));
    v_contact := CASE
        WHEN v_contact IN ('phone', 'phone call', 'call') THEN 'phone'
        WHEN v_contact IN ('whatsapp', 'whatsapp message') THEN 'whatsapp'
        ELSE NULL
    END;

    IF v_contact IS NULL THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_CONTACT: choose a contact method.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Laundry request.
    v_category := lower(coalesce(p_payload->>'item_category', ''));
    IF v_category NOT IN ('clothing', 'bedding', 'both', 'other') THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_PAYLOAD: choose an item category.'
            USING ERRCODE = 'P0001';
    END IF;

    v_load_size := btrim(coalesce(p_payload->>'load_size', ''));
    IF char_length(v_load_size) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_PAYLOAD: select a load size.'
            USING ERRCODE = 'P0001';
    END IF;

    v_notes := left(coalesce(p_payload->>'customer_notes', ''), 4000);

    -- Pickup / location.
    v_address := btrim(coalesce(p_payload->>'pickup_address', ''));
    IF char_length(v_address) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_ADDRESS: enter the pickup address.'
            USING ERRCODE = 'P0001';
    END IF;

    v_landmark := left(coalesce(p_payload->>'pickup_landmark', ''), 200);

    v_map := nullif(btrim(coalesce(p_payload->>'pickup_map_url', '')), '');
    IF v_map IS NOT NULL
       AND (v_map !~ '^https://' OR char_length(v_map) > 2048) THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_MAP: use a valid https map link.'
            USING ERRCODE = 'P0001';
    END IF;

    v_transport := lower(
        coalesce(p_payload->>'transport_preference', 'no_preference')
    );
    v_transport := replace(v_transport, ' ', '_');
    IF v_transport = 'none' THEN
        v_transport := 'no_preference';
    END IF;
    IF v_transport NOT IN ('no_preference', 'cab', 'motorbike', 'courier') THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_PAYLOAD: choose a transport preference.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Requested date and optional preferred time.
    IF (p_payload->>'requested_date') IS NULL
       OR (p_payload->>'requested_date') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_DATE: choose a valid pickup date.'
            USING ERRCODE = 'P0001';
    END IF;

    v_date := (p_payload->>'requested_date')::date;

    v_time_raw := nullif(btrim(coalesce(p_payload->>'requested_time', '')), '');
    IF v_time_raw IS NOT NULL
       AND v_time_raw !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_TIME: choose a valid preferred time.'
            USING ERRCODE = 'P0001';
    END IF;
    v_time := v_time_raw::time;

    v_express := coalesce((p_payload->>'express_requested')::boolean, false);

    -- Scheduling: pickup-window checks are independent of express eligibility.
    PERFORM private.assert_pickup_request(NULL, v_date, v_time, v_now);

    -- Resolve and snapshot the selected services. Unknown, inactive or
    -- non-bookable slugs are rejected.
    FOR v_service IN SELECT value FROM jsonb_array_elements(p_services)
    LOOP
        IF jsonb_typeof(v_service) <> 'string' THEN
            RAISE EXCEPTION
                'BOOKING_INVALID_SERVICE: each service must be a slug.'
                USING ERRCODE = 'P0001';
        END IF;

        SELECT * INTO v_service_row
        FROM public.services AS s
        WHERE s.slug = (v_service #>> '{}')
          AND s.active
          AND s.bookable;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'BOOKING_INVALID_SERVICE: one of the selected services is unavailable.'
                USING ERRCODE = 'P0001';
        END IF;

        IF v_service_row.kind = 'modifier'
           AND v_service_row.slug = 'express-same-day-laundry' THEN
            v_express := true;
        END IF;
    END LOOP;

    -- Reject repeated service slugs before INSERT to avoid a raw unique-index
    -- error from booking_services for otherwise valid-looking submissions.
    IF (SELECT count(DISTINCT value #>> '{}')
        FROM jsonb_array_elements(p_services)) <> v_service_count THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_SERVICE: each service may be selected only once.'
            USING ERRCODE = 'P0001';
    END IF;

    -- The express option can come from the selected modifier even when the
    -- separate express_requested flag is false or absent.
    PERFORM private.assert_express_request(v_date, v_express, v_now);

    v_hash := private.booking_submission_hash(v_scope, p_payload, p_services);

    -- Insert with idempotency handling. A concurrent identical submission blocks
    -- on the unique index and is resolved by the replay branch below.
    FOR v_attempt IN 1..5
    LOOP
        v_reference := private.booking_reference();
        BEGIN
            INSERT INTO public.bookings (
                reference,
                submission_scope,
                idempotency_key,
                submission_hash,
                customer_name,
                customer_phone,
                customer_email,
                whatsapp_phone,
                same_whatsapp,
                contact_method,
                item_category,
                load_size,
                customer_notes,
                pickup_address,
                pickup_landmark,
                pickup_map_url,
                transport_preference,
                requested_date,
                requested_time,
                express_requested,
                notice_version
            )
            VALUES (
                v_reference,
                v_scope,
                v_key,
                v_hash,
                v_name,
                v_phone,
                v_email,
                v_whatsapp,
                coalesce((p_payload->>'same_whatsapp')::boolean, true),
                v_contact,
                v_category,
                v_load_size,
                v_notes,
                v_address,
                v_landmark,
                v_map,
                v_transport,
                v_date,
                v_time,
                v_express,
                left(coalesce(p_payload->>'notice_version', ''), 60)
            )
            ON CONFLICT (submission_scope, idempotency_key) DO NOTHING
            RETURNING * INTO v_booking;

            EXIT;
        EXCEPTION
            WHEN unique_violation THEN
                IF v_attempt >= 5 THEN
                    RAISE;
                END IF;
        END;
    END LOOP;

    -- No row inserted: the key already committed. Return the original result
    -- unless the payload changed, which is a conflict.
    IF v_booking.id IS NULL THEN
        SELECT * INTO v_booking
        FROM public.bookings
        WHERE submission_scope = v_scope
          AND idempotency_key = v_key
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'BOOKING_CONFLICT: the submission could not be committed.'
                USING ERRCODE = 'P0001';
        END IF;

        IF v_booking.submission_hash <> v_hash THEN
            RAISE EXCEPTION
                'BOOKING_IDEMPOTENCY_MISMATCH: this request changed. Review and submit again.'
                USING ERRCODE = 'P0001';
        END IF;

        RETURN jsonb_build_object(
            'booking_id', v_booking.id,
            'reference', v_booking.reference,
            'status', v_booking.status,
            'version', v_booking.version,
            'replayed', true
        );
    END IF;

    -- Service snapshots.
    FOR v_service IN SELECT value FROM jsonb_array_elements(p_services)
    LOOP
        SELECT * INTO v_service_row
        FROM public.services AS s
        WHERE s.slug = (v_service #>> '{}');

        INSERT INTO public.booking_services (
            booking_id, service_id, service_slug, service_title
        )
        VALUES (
            v_booking.id, v_service_row.id, v_service_row.slug, v_service_row.title
        );
    END LOOP;

    -- Initial history entry (customer submission).
    INSERT INTO public.booking_status_history (
        booking_id, from_status, to_status, actor_id, actor_kind
    )
    VALUES (v_booking.id, NULL, 'pending', NULL, 'customer');

    PERFORM private.insert_audit_event(
        NULL,
        'booking.created',
        'booking',
        v_booking.id::text,
        NULL,
        jsonb_build_object(
            'reference', v_booking.reference,
            'status', v_booking.status,
            'requested_date', v_booking.requested_date,
            'requested_time', v_booking.requested_time,
            'express', v_booking.express_requested,
            'services', (SELECT count(*) FROM public.booking_services bs WHERE bs.booking_id = v_booking.id)
        ),
        NULL,
        p_correlation
    );

    RETURN jsonb_build_object(
        'booking_id', v_booking.id,
        'reference', v_booking.reference,
        'status', v_booking.status,
        'version', v_booking.version,
        'replayed', false
    );
END;
$$;

COMMENT ON FUNCTION public.booking_submit(jsonb, jsonb, text, text, uuid) IS
'Creates a pending booking from a validated public submission. Idempotent by (scope, key); a mismatched retry is rejected. Callable by service_role only.';

-- ============================================================
-- 7. ADMINISTRATIVE TRANSITION
-- ============================================================

CREATE OR REPLACE FUNCTION public.booking_transition(
    p_actor uuid,
    p_booking uuid,
    p_expected_version integer,
    p_next public.booking_status,
    p_reason text,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_booking public.bookings;
    v_previous public.booking_status;
BEGIN
    PERFORM private.assert_active_admin(p_actor);

    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'BOOKING_NOT_FOUND: booking missing.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_expected_version IS NULL
       OR v_booking.version <> p_expected_version THEN
        RAISE EXCEPTION
            'BOOKING_CONFLICT: this booking changed while you were editing it. Reload the latest details.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_next IS NULL THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_TRANSITION: a target status is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_next = v_booking.status THEN
        RAISE EXCEPTION
            'BOOKING_STATE_UNCHANGED: the booking is already %.',
            v_booking.status
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT private.booking_transition_allowed(v_booking.status, p_next) THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_TRANSITION: % cannot move to %.',
            v_booking.status,
            p_next
            USING ERRCODE = 'P0001';
    END IF;

    IF p_next = 'cancelled'
       AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
        RAISE EXCEPTION
            'BOOKING_CANCELLATION_REASON: enter a reason for cancellation.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_next = 'confirmed' THEN
        PERFORM private.assert_confirmation_ready(v_booking);
    END IF;

    v_previous := v_booking.status;

    UPDATE public.bookings
    SET
        status = p_next,
        version = version + 1,
        confirmed_at = CASE
            WHEN p_next = 'confirmed' THEN now() ELSE confirmed_at END,
        scheduled_at = CASE
            WHEN p_next = 'scheduled' THEN now() ELSE scheduled_at END,
        picked_up_at = CASE
            WHEN p_next = 'picked_up' THEN now() ELSE picked_up_at END,
        processing_at = CASE
            WHEN p_next = 'processing' THEN now() ELSE processing_at END,
        ready_at = CASE
            WHEN p_next = 'ready' THEN now() ELSE ready_at END,
        out_for_delivery_at = CASE
            WHEN p_next = 'out_for_delivery' THEN now() ELSE out_for_delivery_at END,
        completed_at = CASE
            WHEN p_next = 'completed' THEN now() ELSE completed_at END,
        cancelled_at = CASE
            WHEN p_next = 'cancelled' THEN now() ELSE cancelled_at END,
        cancelled_by = CASE
            WHEN p_next = 'cancelled' THEN p_actor ELSE cancelled_by END,
        cancellation_reason = CASE
            WHEN p_next = 'cancelled'
                THEN left(btrim(p_reason), 2000)
            ELSE cancellation_reason END
    WHERE id = p_booking
    RETURNING * INTO v_booking;

    INSERT INTO public.booking_status_history (
        booking_id, from_status, to_status, actor_id, actor_kind, reason
    )
    VALUES (
        p_booking,
        v_previous,
        p_next,
        p_actor,
        'admin',
        left(nullif(btrim(coalesce(p_reason, '')), ''), 2000)
    );

    PERFORM private.insert_audit_event(
        p_actor,
        CASE
            WHEN p_next = 'confirmed' THEN 'booking.confirmed'
            WHEN p_next = 'cancelled' THEN 'booking.cancelled'
            ELSE 'booking.status_changed'
        END,
        'booking',
        p_booking::text,
        jsonb_build_object('status', v_previous),
        jsonb_build_object('status', p_next),
        left(nullif(btrim(coalesce(p_reason, '')), ''), 500),
        p_correlation
    );

    RETURN jsonb_build_object(
        'booking_id', v_booking.id,
        'reference', v_booking.reference,
        'status', v_booking.status,
        'previous_status', v_previous,
        'version', v_booking.version
    );
END;
$$;

COMMENT ON FUNCTION public.booking_transition(uuid, uuid, integer, public.booking_status, text, uuid) IS
'Applies one allowed lifecycle transition with a version check, confirmation prerequisites, history and audit in one transaction. Callable by service_role only.';

-- ============================================================
-- 8. AGREED ARRANGEMENTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.booking_update_arrangement(
    p_actor uuid,
    p_booking uuid,
    p_expected_version integer,
    p_branch uuid,
    p_agreed_pickup_at timestamptz,
    p_agreed_fee numeric,
    p_zero_fee_reason text,
    p_service_charge numeric,
    p_contact_outcome text,
    p_confirmation_note text,
    p_return_details text,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_booking public.bookings;
    v_before jsonb;
    v_local timestamp;
BEGIN
    PERFORM private.assert_active_admin(p_actor);

    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'BOOKING_NOT_FOUND: booking missing.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_expected_version IS NULL
       OR v_booking.version <> p_expected_version THEN
        RAISE EXCEPTION
            'BOOKING_CONFLICT: this booking changed while you were editing it. Reload the latest details.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_branch IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE id = p_branch AND active
    ) THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_BRANCH: choose an available branch.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_agreed_fee IS NOT NULL AND p_agreed_fee < 0 THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_FEE: the agreed fee cannot be negative.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_agreed_fee = 0
       AND (p_zero_fee_reason IS NULL OR btrim(p_zero_fee_reason) = '') THEN
        RAISE EXCEPTION
            'BOOKING_ZERO_FEE_REASON: record the reason for a zero pickup fee.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_service_charge IS NOT NULL AND p_service_charge < 0 THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_FEE: the service charge cannot be negative.'
            USING ERRCODE = 'P0001';
    END IF;

    -- An agreed appointment must fall inside the branch pickup window.
    IF p_agreed_pickup_at IS NOT NULL
       AND coalesce(p_branch, v_booking.assigned_branch_id) IS NOT NULL THEN
        v_local := p_agreed_pickup_at AT TIME ZONE 'Africa/Accra';
        PERFORM private.assert_pickup_window(
            coalesce(p_branch, v_booking.assigned_branch_id),
            v_local::date,
            v_local::time
        );
    END IF;

    v_before := jsonb_build_object(
        'branch_id', v_booking.assigned_branch_id,
        'agreed_pickup_at', v_booking.agreed_pickup_at,
        'agreed_fee', v_booking.agreed_fee,
        'service_charge', v_booking.service_charge
    );

    UPDATE public.bookings
    SET
        assigned_branch_id = p_branch,
        agreed_pickup_at = p_agreed_pickup_at,
        agreed_fee = p_agreed_fee,
        zero_fee_reason = nullif(btrim(coalesce(p_zero_fee_reason, '')), ''),
        service_charge = p_service_charge,
        contact_outcome = nullif(btrim(coalesce(p_contact_outcome, '')), ''),
        confirmation_note = nullif(btrim(coalesce(p_confirmation_note, '')), ''),
        return_details = nullif(btrim(coalesce(p_return_details, '')), ''),
        version = version + 1
    WHERE id = p_booking
    RETURNING * INTO v_booking;

    PERFORM private.insert_audit_event(
        p_actor,
        'booking.arrangement_updated',
        'booking',
        p_booking::text,
        v_before,
        jsonb_build_object(
            'branch_id', v_booking.assigned_branch_id,
            'agreed_pickup_at', v_booking.agreed_pickup_at,
            'agreed_fee', v_booking.agreed_fee,
            'service_charge', v_booking.service_charge
        ),
        NULL,
        p_correlation
    );

    RETURN jsonb_build_object(
        'booking_id', v_booking.id,
        'reference', v_booking.reference,
        'status', v_booking.status,
        'version', v_booking.version
    );
END;
$$;

COMMENT ON FUNCTION public.booking_update_arrangement(uuid, uuid, integer, uuid, timestamptz, numeric, text, numeric, text, text, text, uuid) IS
'Updates the administratively agreed branch, appointment, fee and notes with a version check and audit. Callable by service_role only.';

-- ============================================================
-- 9. INTERNAL NOTES
-- ============================================================

CREATE OR REPLACE FUNCTION public.booking_add_note(
    p_actor uuid,
    p_booking uuid,
    p_expected_version integer,
    p_body text,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_booking public.bookings;
    v_body text := btrim(coalesce(p_body, ''));
BEGIN
    PERFORM private.assert_active_admin(p_actor);

    IF char_length(v_body) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION
            'BOOKING_INVALID_NOTE: enter a note between 1 and 4000 characters.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = p_booking
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'BOOKING_NOT_FOUND: booking missing.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_expected_version IS NULL
       OR v_booking.version <> p_expected_version THEN
        RAISE EXCEPTION
            'BOOKING_CONFLICT: this booking changed while you were editing it. Reload the latest details.'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.booking_notes (booking_id, author_id, body)
    VALUES (p_booking, p_actor, v_body);

    UPDATE public.bookings
    SET version = version + 1
    WHERE id = p_booking
    RETURNING * INTO v_booking;

    -- The note body itself is never copied into the audit payload.
    PERFORM private.insert_audit_event(
        p_actor,
        'booking.note_added',
        'booking',
        p_booking::text,
        NULL,
        jsonb_build_object('note_length', char_length(v_body)),
        NULL,
        p_correlation
    );

    RETURN jsonb_build_object(
        'booking_id', v_booking.id,
        'reference', v_booking.reference,
        'status', v_booking.status,
        'version', v_booking.version
    );
END;
$$;

COMMENT ON FUNCTION public.booking_add_note(uuid, uuid, integer, text, uuid) IS
'Appends a private administrative note with a version check and audit. The note body is never written to the audit log. Callable by service_role only.';

-- ============================================================
-- 10. FUNCTION EXECUTION PRIVILEGES
-- ============================================================

REVOKE ALL ON FUNCTION public.booking_submit(jsonb, jsonb, text, text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_submit(jsonb, jsonb, text, text, uuid)
TO service_role;

REVOKE ALL ON FUNCTION
public.booking_transition(uuid, uuid, integer, public.booking_status, text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
public.booking_transition(uuid, uuid, integer, public.booking_status, text, uuid)
TO service_role;

REVOKE ALL ON FUNCTION
public.booking_update_arrangement(
    uuid, uuid, integer, uuid, timestamptz, numeric, text, numeric, text, text, text, uuid
)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
public.booking_update_arrangement(
    uuid, uuid, integer, uuid, timestamptz, numeric, text, numeric, text, text, text, uuid
)
TO service_role;

REVOKE ALL ON FUNCTION public.booking_add_note(uuid, uuid, integer, text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_add_note(uuid, uuid, integer, text, uuid)
TO service_role;

GRANT USAGE ON SCHEMA private TO service_role;

COMMIT;

-- ============================================================
-- 11. READ-ONLY VERIFICATION
-- ============================================================

SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'booking_%'
ORDER BY p.proname;

SELECT
    has_function_privilege(
        'anon',
        'public.booking_submit(jsonb,jsonb,text,text,uuid)',
        'EXECUTE'
    ) AS anon_can_submit,
    has_function_privilege(
        'authenticated',
        'public.booking_submit(jsonb,jsonb,text,text,uuid)',
        'EXECUTE'
    ) AS authenticated_can_submit,
    has_function_privilege(
        'service_role',
        'public.booking_submit(jsonb,jsonb,text,text,uuid)',
        'EXECUTE'
    ) AS service_role_can_submit;
