-- =========================================================================
-- 2ND WAVE — Sprint 2A — DISPOSABLE DATABASE TEST SCRIPT
-- =========================================================================
--
-- DO NOT RUN AGAINST THE HOSTED SUPABASE PROJECT.
--
-- This script creates temporary Auth users, profiles and bookings, asserts the
-- booking invariants, and then ROLLS BACK so nothing is left behind. It is meant
-- for a disposable local or branch database on which the migrations and the
-- Phase 1 bootstrap have been applied.
--
-- How to run (disposable database only):
--   1. apply every migration in supabase/migrations/ in filename order;
--   2. open this file in the SQL editor of the disposable database and run it;
--   3. every assertion that fails raises `FAIL …`; reaching the final SELECT
--      means all assertions passed.
--
-- Status in Sprint 2A: NOT EXECUTED. No local Postgres or Supabase CLI was
-- available in this environment, so this script has been reviewed statically but
-- not run. It must not be reported as a passing result until it has actually
-- been executed against a disposable database.
--
-- SECURITY DEFINER helpers are called here directly, which is only possible for a
-- superuser/session owner in a disposable database. That is intentional: it lets
-- the script drive the scheduling helpers with a fixed clock. It is NOT a claim
-- that a client can call them.

BEGIN;

-- -------------------------------------------------------------------------
-- Test identities
-- -------------------------------------------------------------------------

CREATE TEMP TABLE test_ids (
    key text PRIMARY KEY,
    id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO test_ids (key, id) VALUES
    ('admin',     '11111111-1111-1111-1111-111111111111'),
    ('outsider',  '22222222-2222-2222-2222-222222222222');

-- An active Operational Admin: both roles may manage bookings.
INSERT INTO auth.users (id, email, email_confirmed_at, created_at, updated_at)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'sprint2a.admin@example.test', now(), now(), now()),
    ('22222222-2222-2222-2222-222222222222', 'sprint2a.outsider@example.test', now(), now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_profiles (user_id, role, email)
VALUES ('11111111-1111-1111-1111-111111111111', 'operational_admin', 'sprint2a.admin@example.test')
ON CONFLICT (user_id) DO NOTHING;

-- -------------------------------------------------------------------------
-- Assertion helpers
-- -------------------------------------------------------------------------

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_marker text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF position(p_marker IN SQLERRM) > 0 THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAIL %: wrong error: %', p_label, SQLERRM;
    END;
    RAISE EXCEPTION 'FAIL %: expected an error containing "%" but none was raised',
        p_label, p_marker;
END;
$$;

CREATE FUNCTION pg_temp.expect_ok(p_sql text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'FAIL %: unexpected error: %', p_label, SQLERRM;
    END;
END;
$$;

CREATE FUNCTION pg_temp.as_admin(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM set_config('request.jwt.claims',
        '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE 'SELECT ' || p_sql INTO v_result;
    PERFORM set_config('role', 'none', true);
    RETURN v_result;
END;
$$;

CREATE FUNCTION pg_temp.valid_payload(p_date text, p_time text, p_express boolean)
RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'customer_name', 'Sprint 2A Customer',
        'customer_phone', '+233595224280',
        'customer_email', 'customer@example.test',
        'contact_method', 'phone',
        'item_category', 'clothing',
        'load_size', '1 Standard Bag',
        'pickup_address', '1 Test Street',
        'requested_date', p_date,
        'requested_time', nullif(p_time, ''),
        'express_requested', coalesce(p_express, false),
        'same_whatsapp', true,
        'notice_version', 'test'
    );
$$;

-- =========================================================================
-- 1. SCHEDULING — PICKUP WINDOW (deterministic fixed clock)
-- =========================================================================
-- 2026-10-11 is a Sunday, so these also prove the window is open at weekends.

DO $$
BEGIN
    -- 06:30 is before the 07:00 opening.
    PERFORM pg_temp.expect_error(
        $q$SELECT private.assert_pickup_request(NULL, date '2026-10-11', time '06:30', timestamptz '2026-10-11 05:00+00')$q$,
        'BOOKING_PICKUP_WINDOW', 'pickup at 06:30 is rejected'
    );

    -- 07:00 is the inclusive opening boundary.
    PERFORM pg_temp.expect_ok(
        $q$SELECT private.assert_pickup_request(NULL, date '2026-10-11', time '07:00', timestamptz '2026-10-11 05:00+00')$q$,
        'pickup at 07:00 is accepted'
    );

    -- 12:00 is inside the window on a non-express request.
    PERFORM pg_temp.expect_ok(
        $q$SELECT private.assert_pickup_request(NULL, date '2026-10-11', time '12:00', timestamptz '2026-10-11 11:30+00')$q$,
        'ordinary pickup at 12:00 is accepted'
    );

    -- 17:00 is the inclusive closing boundary for a requested time.
    PERFORM pg_temp.expect_ok(
        $q$SELECT private.assert_pickup_request(NULL, date '2026-10-12', time '17:00', timestamptz '2026-10-11 08:00+00')$q$,
        'pickup at 17:00 boundary is accepted'
    );

    -- 17:30 is after the window.
    PERFORM pg_temp.expect_error(
        $q$SELECT private.assert_pickup_request(NULL, date '2026-10-12', time '17:30', timestamptz '2026-10-11 08:00+00')$q$,
        'BOOKING_PICKUP_WINDOW', 'pickup at 17:30 is rejected'
    );

    -- Same-day request once the window has closed is rejected even with no time.
    PERFORM pg_temp.expect_error(
        $q$SELECT private.assert_pickup_request(NULL, date '2026-10-11', NULL, timestamptz '2026-10-11 17:00+00')$q$,
        'BOOKING_PICKUP_CLOSED', 'same-day request after 17:00 is rejected'
    );

    -- A past date is rejected.
    PERFORM pg_temp.expect_error(
        $q$SELECT private.assert_pickup_request(NULL, date '2026-10-10', time '09:00', timestamptz '2026-10-11 08:00+00')$q$,
        'BOOKING_PICKUP_DATE', 'a past pickup date is rejected'
    );

    -- A future Sunday (a weekend) is accepted: no weekday-derived closure.
    PERFORM pg_temp.expect_ok(
        $q$SELECT private.assert_pickup_request(NULL, date '2026-10-18', time '09:00', timestamptz '2026-10-11 08:00+00')$q$,
        'weekend pickup is accepted'
    );
END;
$$;

-- =========================================================================
-- 2. SCHEDULING — EXPRESS CUTOFF IS SEPARATE FROM THE WINDOW
-- =========================================================================

DO $$
BEGIN
    PERFORM pg_temp.expect_ok(
        $q$SELECT private.assert_express_request(date '2026-10-11', true, timestamptz '2026-10-11 10:59:59+00')$q$,
        'express at 10:59:59 is accepted'
    );
    PERFORM pg_temp.expect_ok(
        $q$SELECT private.assert_express_request(date '2026-10-11', true, timestamptz '2026-10-11 11:00:00+00')$q$,
        'express at exactly 11:00:00 is accepted'
    );
    PERFORM pg_temp.expect_error(
        $q$SELECT private.assert_express_request(date '2026-10-11', true, timestamptz '2026-10-11 11:00:01+00')$q$,
        'BOOKING_EXPRESS_CUTOFF', 'express at 11:00:01 is rejected'
    );
    -- Ordinary (non-express) requests are unaffected by the express cutoff.
    PERFORM pg_temp.expect_ok(
        $q$SELECT private.assert_express_request(date '2026-10-11', false, timestamptz '2026-10-11 16:00:00+00')$q$,
        'ordinary request after the express cutoff is accepted'
    );
    -- Express requested for a later date is not subject to today's cutoff.
    PERFORM pg_temp.expect_ok(
        $q$SELECT private.assert_express_request(date '2026-10-20', true, timestamptz '2026-10-11 16:00:00+00')$q$,
        'express for a later date is accepted'
    );
END;
$$;

-- =========================================================================
-- 3. SUBMISSION, IDEMPOTENCY AND REFERENCES
-- =========================================================================

CREATE TEMP TABLE submission (reference text, booking_id uuid) ON COMMIT DROP;

INSERT INTO submission (reference, booking_id)
SELECT
    result->>'reference',
    (result->>'booking_id')::uuid
FROM (
    SELECT public.booking_submit(
        pg_temp.valid_payload('2099-01-01', '09:00', false),
        '["wash-ironing-fold"]'::jsonb,
        'idem-sprint2a-0000000000000001',
        'public_booking_form',
        NULL
    ) AS result
) AS created;

DO $$
DECLARE
    v_reference text;
    v_status public.booking_status;
    v_replay jsonb;
BEGIN
    SELECT reference INTO v_reference FROM submission;
    SELECT status INTO v_status FROM public.bookings WHERE reference = v_reference;

    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'FAIL new booking is not pending: %', v_status;
    END IF;

    IF (SELECT count(*) FROM public.booking_services bs
        JOIN public.bookings b ON b.id = bs.booking_id
        WHERE b.reference = v_reference) <> 1 THEN
        RAISE EXCEPTION 'FAIL service snapshot was not written';
    END IF;

    IF (SELECT count(*) FROM public.booking_status_history h
        JOIN public.bookings b ON b.id = h.booking_id
        WHERE b.reference = v_reference) <> 1 THEN
        RAISE EXCEPTION 'FAIL initial history was not written';
    END IF;

    -- Idempotent replay: same key, same payload returns the original reference.
    v_replay := public.booking_submit(
        pg_temp.valid_payload('2099-01-01', '09:00', false),
        '["wash-ironing-fold"]'::jsonb,
        'idem-sprint2a-0000000000000001',
        'public_booking_form',
        NULL
    );
    IF (v_replay->>'replayed')::boolean IS NOT TRUE
       OR v_replay->>'reference' <> v_reference THEN
        RAISE EXCEPTION 'FAIL idempotent replay did not return the original result';
    END IF;
END;
$$;

-- Same key, different payload → conflict.
DO $$
BEGIN
    PERFORM pg_temp.expect_error(
        format(
            $q$SELECT public.booking_submit(%L::jsonb, '["ironing"]'::jsonb, %L, 'public_booking_form', NULL)$q$,
            pg_temp.valid_payload('2099-01-02', '09:00', false)::text,
            'idem-sprint2a-0000000000000001'
        ),
        'BOOKING_IDEMPOTENCY_MISMATCH',
        'reused key with a different payload is a conflict'
    );
END;
$$;

-- Reference uniqueness is enforced by the database.
DO $$
DECLARE
    v_reference text;
BEGIN
    SELECT reference INTO v_reference FROM submission;
    PERFORM pg_temp.expect_error(
        format(
            $q$INSERT INTO public.bookings (reference, idempotency_key, submission_hash, customer_name, customer_phone, item_category, load_size, pickup_address, requested_date) VALUES (%L, 'idem-sprint2a-0000000000000099', md5('x'), 'A', '+233595224280', 'clothing', '1', 'x', date '2099-01-01')$q$,
            v_reference
        ),
        'duplicate key',
        'duplicate reference is rejected'
    );
END;
$$;

-- =========================================================================
-- 4. VALIDATION — REQUIRED PHONE, OPTIONAL EMAIL, NO PARTIAL WRITES
-- =========================================================================

DO $$
DECLARE
    v_before bigint;
    v_after bigint;
BEGIN
    SELECT count(*) INTO v_before FROM public.bookings;

    -- Missing phone is rejected.
    PERFORM pg_temp.expect_error(
        $q$SELECT public.booking_submit(
            (jsonb_build_object(
                'customer_name', 'No Phone',
                'customer_phone', '',
                'contact_method', 'phone',
                'item_category', 'clothing',
                'load_size', '1 Standard Bag',
                'pickup_address', '1 Test Street',
                'requested_date', '2099-01-01'
            )),
            '["ironing"]'::jsonb,
            'idem-sprint2a-0000000000000002',
            'public_booking_form',
            NULL
        )$q$,
        'BOOKING_INVALID_PHONE', 'missing phone is rejected'
    );

    -- Unknown service is rejected.
    PERFORM pg_temp.expect_error(
        $q$SELECT public.booking_submit(
            pg_temp.valid_payload('2099-01-01', '09:00', false),
            '["not-a-service"]'::jsonb,
            'idem-sprint2a-0000000000000003',
            'public_booking_form',
            NULL
        )$q$,
        'BOOKING_INVALID_SERVICE', 'unknown service is rejected'
    );

    SELECT count(*) INTO v_after FROM public.bookings;
    IF v_after <> v_before THEN
        RAISE EXCEPTION 'FAIL failed validation left a partial record (% → %)',
            v_before, v_after;
    END IF;

    -- Optional email: an empty email is accepted.
    PERFORM pg_temp.expect_ok(
        $q$SELECT public.booking_submit(
            (pg_temp.valid_payload('2099-01-01', '09:00', false) - 'customer_email'),
            '["ironing"]'::jsonb,
            'idem-sprint2a-0000000000000004',
            'public_booking_form',
            NULL
        )$q$,
        'a booking without an email is accepted'
    );
END;
$$;

-- =========================================================================
-- 5. LIFECYCLE — CONFIRMATION PREREQUISITES, TRANSITIONS, CONCURRENCY
-- =========================================================================

DO $$
DECLARE
    v_booking public.bookings;
    v_actor uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
    SELECT * INTO v_booking FROM public.bookings
    WHERE reference = (SELECT reference FROM submission);

    -- Confirmation without agreed arrangements is rejected.
    PERFORM pg_temp.expect_error(
        format(
            $q$SELECT public.booking_transition(%L::uuid, %L::uuid, %s, 'confirmed', NULL, NULL)$q$,
            v_actor, v_booking.id, v_booking.version
        ),
        'BOOKING_CONFIRMATION_INCOMPLETE',
        'confirmation without arrangements is rejected'
    );

    -- An invalid transition is rejected.
    PERFORM pg_temp.expect_error(
        format(
            $q$SELECT public.booking_transition(%L::uuid, %L::uuid, %s, 'processing', NULL, NULL)$q$,
            v_actor, v_booking.id, v_booking.version
        ),
        'BOOKING_INVALID_TRANSITION',
        'pending → processing is rejected'
    );

    -- A stale version is a conflict.
    PERFORM pg_temp.expect_error(
        format(
            $q$SELECT public.booking_transition(%L::uuid, %L::uuid, %s, 'cancelled', 'test', NULL)$q$,
            v_actor, v_booking.id, v_booking.version + 99
        ),
        'BOOKING_CONFLICT',
        'a stale version is a conflict'
    );

    -- Record the agreed arrangements, then confirm.
    PERFORM public.booking_update_arrangement(
        v_actor,
        v_booking.id,
        v_booking.version,
        (SELECT id FROM public.branches WHERE slug = 'ashaiman-atadeka'),
        timestamptz '2099-01-01 09:00+00',
        50.00,
        NULL,
        NULL,
        'Customer confirmed by phone',
        'Collected and confirmed',
        NULL,
        NULL
    );

    SELECT * INTO v_booking FROM public.bookings WHERE id = v_booking.id;

    PERFORM public.booking_transition(v_actor, v_booking.id, v_booking.version, 'confirmed', NULL, NULL);

    SELECT * INTO v_booking FROM public.bookings WHERE id = v_booking.id;
    IF v_booking.status <> 'confirmed' THEN
        RAISE EXCEPTION 'FAIL valid confirmation did not commit';
    END IF;

    -- Cancellation requires a reason.
    PERFORM pg_temp.expect_error(
        format(
            $q$SELECT public.booking_transition(%L::uuid, %L::uuid, %s, 'cancelled', NULL, NULL)$q$,
            v_actor, v_booking.id, v_booking.version
        ),
        'BOOKING_CANCELLATION_REASON',
        'cancellation without a reason is rejected'
    );

    -- A terminal booking cannot be mutated further.
    PERFORM public.booking_transition(v_actor, v_booking.id, v_booking.version, 'cancelled', 'Customer request', NULL);
    SELECT * INTO v_booking FROM public.bookings WHERE id = v_booking.id;
    PERFORM pg_temp.expect_error(
        format(
            $q$SELECT public.booking_transition(%L::uuid, %L::uuid, %s, 'confirmed', NULL, NULL)$q$,
            v_actor, v_booking.id, v_booking.version
        ),
        'BOOKING_INVALID_TRANSITION',
        'a cancelled booking cannot be confirmed'
    );
END;
$$;

-- =========================================================================
-- 6. AUTHORISATION — ANONYMOUS AND NON-ADMIN DENIALS
-- =========================================================================

DO $$
DECLARE
    v_count bigint;
BEGIN
    ------------------------------------------------------------------
    -- anon has no grant and no policy on booking data.
    ------------------------------------------------------------------
    PERFORM set_config('role', 'anon', true);
    BEGIN
        PERFORM count(*) FROM public.bookings;
        RAISE EXCEPTION 'FAIL anon was able to read bookings';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL; -- expected
    END;
    PERFORM set_config('role', 'none', true);

    ------------------------------------------------------------------
    -- anon cannot create a booking through the trusted function.
    ------------------------------------------------------------------
    PERFORM set_config('role', 'anon', true);
    BEGIN
        PERFORM public.booking_submit(
            pg_temp.valid_payload('2099-01-01', '09:00', false),
            '["ironing"]'::jsonb,
            'idem-sprint2a-0000000000000005',
            'public_booking_form',
            NULL
        );
        RAISE EXCEPTION 'FAIL anon was able to call booking_submit';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL; -- expected
    END;
    PERFORM set_config('role', 'none', true);

    ------------------------------------------------------------------
    -- An authenticated user without an admin profile sees nothing.
    ------------------------------------------------------------------
    PERFORM set_config('request.jwt.claims',
        '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO v_count FROM public.bookings;
    PERFORM set_config('role', 'none', true);
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FAIL a non-admin authenticated user read % bookings', v_count;
    END IF;

    -- …and cannot write directly.
    PERFORM set_config('request.jwt.claims',
        '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
        UPDATE public.bookings SET status = 'completed';
        RAISE EXCEPTION 'FAIL an authenticated user updated bookings directly';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL; -- expected
    END;
    PERFORM set_config('role', 'none', true);

    ------------------------------------------------------------------
    -- An active admin (either role) can read bookings under RLS.
    ------------------------------------------------------------------
    v_count := (pg_temp.as_admin('(SELECT count(*) FROM public.bookings)'))::text::bigint;
    IF v_count < 1 THEN
        RAISE EXCEPTION 'FAIL an active admin could not read bookings';
    END IF;
END;
$$;

-- =========================================================================
-- 7. RETENTION FOUNDATION
-- =========================================================================

DO $$
DECLARE
    v_summary jsonb;
BEGIN
    v_summary := public.retention_due_summary();
    IF v_summary->>'bookings_due' IS NULL OR v_summary->>'photos_due' IS NULL THEN
        RAISE EXCEPTION 'FAIL retention_due_summary missing expected keys';
    END IF;

    -- Nothing is due yet, so the counts are zero in this transaction.
    IF (v_summary->>'bookings_due')::bigint <> 0 THEN
        RAISE EXCEPTION 'FAIL unexpected due bookings in a fresh transaction';
    END IF;
END;
$$;

-- Roll back every test row and identity.
ROLLBACK;

SELECT 'Sprint 2A booking security/invariant tests passed (transaction rolled back).' AS result;
