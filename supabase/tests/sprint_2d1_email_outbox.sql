-- =========================================================================
-- 2ND WAVE — Sprint 2D.1 — DISPOSABLE DATABASE TEST SCRIPT
-- =========================================================================
--
-- DO NOT RUN AGAINST THE HOSTED SUPABASE PROJECT.
--
-- This script creates a temporary administrator and bookings, drives the real
-- trusted booking functions, asserts the outbox invariants, and then ROLLS BACK.
-- It is meant for a disposable local or branch database on which every migration
-- in supabase/migrations/ has been applied in filename order.
--
-- How to run (disposable database only):
--   1. apply every migration in supabase/migrations/ in filename order;
--   2. open this file in the disposable database and run it;
--   3. every assertion that fails raises `FAIL …`; reaching the final SELECT
--      means all assertions passed.
--
-- The same behaviour is also executed automatically, without a server, by
-- `tests/email-outbox-db.test.ts` and `tests/email-outbox-integration-db.test.ts`
-- (PGlite/WASM PostgreSQL). This script is the full Supabase-role equivalent for
-- an operator with a disposable Postgres instance.
--
-- Nothing here sends email and nothing is applied to a hosted project.
BEGIN;

-- -------------------------------------------------------------------------
-- Fixtures
-- -------------------------------------------------------------------------

CREATE TEMP TABLE test_ids (
    key text PRIMARY KEY,
    id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO test_ids (key, id) VALUES
    ('admin', '33333333-3333-3333-3333-333333333333');

INSERT INTO auth.users (id, email, email_confirmed_at, created_at, updated_at)
VALUES (
    '33333333-3333-3333-3333-333333333333',
    'sprint2d1.admin@example.test',
    now(), now(), now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_profiles (user_id, role, display_name)
VALUES (
    '33333333-3333-3333-3333-333333333333',
    'full_admin',
    'Sprint 2D.1 Test Admin'
)
ON CONFLICT (user_id) DO NOTHING;

-- A fixed, valid future pickup request. The date is far enough ahead that the
-- scheduling rules and the express cutoff are not time-sensitive.
CREATE FUNCTION pg_temp.booking_payload(p_email text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_build_object(
        'customer_name', 'Sprint 2D.1 Customer',
        'customer_phone', '+233595224280',
        'customer_email', p_email,
        'whatsapp_phone', NULL,
        'same_whatsapp', true,
        'contact_method', 'phone',
        'item_category', 'clothing',
        'load_size', '1 Standard Bag',
        'customer_notes', '',
        'pickup_address', '1 Test Street',
        'pickup_landmark', '',
        'pickup_map_url', NULL,
        'transport_preference', 'no_preference',
        'requested_date', '2099-01-01',
        'requested_time', '09:00',
        'express_requested', false,
        'notice_version', NULL
    );
$$;

CREATE FUNCTION pg_temp.create_booking(p_email text, p_key text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_result jsonb;
BEGIN
    v_result := public.booking_submit(
        pg_temp.booking_payload(p_email),
        '["wash-ironing-fold"]'::jsonb,
        p_key,
        'public_booking_form',
        gen_random_uuid()
    );
    RETURN (v_result->>'booking_id')::uuid;
END;
$$;

-- -------------------------------------------------------------------------
-- 1. CREATION: ONE ROW, MINIMAL PAYLOAD, OPTIONAL EMAIL
-- -------------------------------------------------------------------------

DO $$
DECLARE
    v_id uuid;
    v_count integer;
    v_row public.email_outbox;
    v_replay jsonb;
BEGIN
    v_id := pg_temp.create_booking('customer@example.test', 'sprint2d1-create-0001');
    INSERT INTO test_ids (key, id) VALUES ('booking', v_id);

    SELECT count(*) INTO v_count
    FROM public.email_outbox WHERE booking_id = v_id;

    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FAIL expected exactly one creation row, got %', v_count;
    END IF;

    SELECT * INTO v_row FROM public.email_outbox WHERE booking_id = v_id;

    IF v_row.template <> 'booking_created' THEN
        RAISE EXCEPTION 'FAIL expected booking_created, got %', v_row.template;
    END IF;

    IF v_row.status <> 'pending' THEN
        RAISE EXCEPTION 'FAIL expected pending delivery state, got %', v_row.status;
    END IF;

    IF v_row.payload <> jsonb_build_object(
        'booking_reference', (SELECT reference FROM public.bookings WHERE id = v_id),
        'status', 'pending'
    ) THEN
        RAISE EXCEPTION 'FAIL unexpected creation payload: %', v_row.payload;
    END IF;

    -- An idempotent replay must return the committed booking and queue nothing.
    v_replay := public.booking_submit(
        pg_temp.booking_payload('customer@example.test'),
        '["wash-ironing-fold"]'::jsonb,
        'sprint2d1-create-0001',
        'public_booking_form',
        gen_random_uuid()
    );

    IF NOT (v_replay->>'replayed')::boolean THEN
        RAISE EXCEPTION 'FAIL replay was not reported as replayed';
    END IF;

    SELECT count(*) INTO v_count
    FROM public.email_outbox WHERE booking_id = v_id;

    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FAIL replay created a duplicate outbox row (%)', v_count;
    END IF;
END;
$$;

DO $$
DECLARE
    v_id uuid;
    v_count integer;
BEGIN
    v_id := pg_temp.create_booking(NULL, 'sprint2d1-create-0002');
    INSERT INTO test_ids (key, id) VALUES ('no_email_booking', v_id);

    SELECT count(*) INTO v_count
    FROM public.email_outbox WHERE booking_id = v_id;

    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FAIL a booking without an email created % outbox rows', v_count;
    END IF;
END;
$$;

-- -------------------------------------------------------------------------
-- 2. LIFECYCLE MAPPING THROUGH THE REAL FUNCTIONS
-- -------------------------------------------------------------------------

DO $$
DECLARE
    v_booking uuid := (SELECT id FROM test_ids WHERE key = 'booking');
    v_actor uuid := (SELECT id FROM test_ids WHERE key = 'admin');
    v_branch uuid;
    v_version integer;
    v_templates text[];
BEGIN
    SELECT id INTO v_branch FROM public.branches ORDER BY sort_order LIMIT 1;

    SELECT version INTO v_version FROM public.bookings WHERE id = v_booking;

    v_version := (
        public.booking_update_arrangement(
            v_actor,
            v_booking,
            v_version,
            v_branch,
            timestamptz '2099-01-01 09:00:00+00',
            50,
            NULL,
            0,
            'Called customer',
            'Arrangement agreed',
            NULL,
            gen_random_uuid()
        )->>'version'
    )::integer;

    v_version := (
        public.booking_transition(
            v_actor, v_booking, v_version, 'confirmed', NULL, gen_random_uuid()
        )->>'version'
    )::integer;

    v_version := (
        public.booking_transition(
            v_actor, v_booking, v_version, 'picked_up', NULL, gen_random_uuid()
        )->>'version'
    )::integer;

    v_version := (
        public.booking_transition(
            v_actor, v_booking, v_version, 'processing', NULL, gen_random_uuid()
        )->>'version'
    )::integer;

    v_version := (
        public.booking_transition(
            v_actor, v_booking, v_version, 'ready', NULL, gen_random_uuid()
        )->>'version'
    )::integer;

    PERFORM public.booking_transition(
        v_actor, v_booking, v_version, 'completed', NULL, gen_random_uuid()
    );

    SELECT array_agg(
        template::text
        ORDER BY CASE template
            WHEN 'booking_created' THEN 1
            WHEN 'booking_confirmed' THEN 2
            WHEN 'booking_processing_started' THEN 3
            WHEN 'booking_ready' THEN 4
            WHEN 'booking_completed' THEN 5
            WHEN 'booking_cancelled' THEN 6
        END
    )
    INTO v_templates
    FROM public.email_outbox
    WHERE booking_id = v_booking;

    IF v_templates IS DISTINCT FROM ARRAY[
        'booking_created',
        'booking_confirmed',
        'booking_processing_started',
        'booking_ready',
        'booking_completed'
    ] THEN
        RAISE EXCEPTION 'FAIL unexpected lifecycle templates: %', v_templates;
    END IF;
END;
$$;

DO $$
DECLARE
    v_id uuid;
    v_templates text[];
BEGIN
    v_id := pg_temp.create_booking('cancel@example.test', 'sprint2d1-create-0003');

    PERFORM public.booking_transition(
        (SELECT id FROM test_ids WHERE key = 'admin'),
        v_id,
        1,
        'cancelled',
        'Customer changed plans',
        gen_random_uuid()
    );

    SELECT array_agg(
        template::text
        ORDER BY CASE template
            WHEN 'booking_created' THEN 1
            WHEN 'booking_cancelled' THEN 2
        END
    )
    INTO v_templates
    FROM public.email_outbox WHERE booking_id = v_id;

    IF v_templates IS DISTINCT FROM ARRAY[
        'booking_created',
        'booking_cancelled'
    ] THEN
        RAISE EXCEPTION 'FAIL unexpected cancellation templates: %', v_templates;
    END IF;
END;
$$;

-- -------------------------------------------------------------------------
-- 3. ATOMICITY: REJECTED OR ROLLED-BACK WORK LEAVES NO OUTBOX ROW
-- -------------------------------------------------------------------------

DO $$
DECLARE
    v_id uuid;
    v_count_before integer;
    v_count_after integer;
BEGIN
    v_id := pg_temp.create_booking('rollback@example.test', 'sprint2d1-create-0004');

    SELECT count(*) INTO v_count_before
    FROM public.email_outbox WHERE booking_id = v_id;

    -- Force an error after the status trigger has fired. The nested block rolls
    -- back its own work, so neither status nor notification survives.
    BEGIN
        UPDATE public.bookings
        SET status = 'confirmed', version = version + 1
        WHERE id = v_id;

        RAISE EXCEPTION 'rollback probe';
    EXCEPTION
        WHEN raise_exception THEN
            NULL;
    END;

    SELECT count(*) INTO v_count_after
    FROM public.email_outbox WHERE booking_id = v_id;

    IF v_count_after <> v_count_before THEN
        RAISE EXCEPTION
            'FAIL rolled-back status change left an outbox row (% -> %)',
            v_count_before, v_count_after;
    END IF;

    -- An invalid trusted transition must also leave nothing behind.
    DECLARE
        v_rejected boolean := false;
    BEGIN
        BEGIN
            PERFORM public.booking_transition(
                (SELECT id FROM test_ids WHERE key = 'admin'),
                v_id,
                1,
                'completed',
                NULL,
                gen_random_uuid()
            );
        EXCEPTION
            WHEN raise_exception THEN
                v_rejected := true;
        END;

        IF NOT v_rejected THEN
            RAISE EXCEPTION 'FAIL pending -> completed was accepted';
        END IF;
    END;

    SELECT count(*) INTO v_count_after
    FROM public.email_outbox WHERE booking_id = v_id;

    IF v_count_after <> v_count_before THEN
        RAISE EXCEPTION 'FAIL rejected transition left an outbox row';
    END IF;
END;
$$;

-- -------------------------------------------------------------------------
-- 4. FORGED DATA AND UNIQUE ENFORCEMENT
-- -------------------------------------------------------------------------

DO $$
DECLARE
    v_booking uuid := (SELECT id FROM test_ids WHERE key = 'booking');
    v_key text;
    v_reference text;
    v_recipient text;
    v_rejected boolean;
BEGIN
    SELECT idempotency_key, payload->>'booking_reference', recipient_email
    INTO v_key, v_reference, v_recipient
    FROM public.email_outbox
    WHERE booking_id = v_booking
      AND template = 'booking_created';

    -- Duplicate idempotency key.
    v_rejected := false;
    BEGIN
        INSERT INTO public.email_outbox (
            booking_id, booking_version, idempotency_key, template,
            recipient_email, payload
        ) VALUES (
            v_booking, 99, v_key, 'booking_completed', v_recipient,
            jsonb_build_object('booking_reference', v_reference, 'status', 'completed')
        );
    EXCEPTION
        WHEN unique_violation THEN
            v_rejected := true;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'FAIL duplicate idempotency key was accepted';
    END IF;

    -- Extra customer data in the payload.
    v_rejected := false;
    BEGIN
        INSERT INTO public.email_outbox (
            booking_id, booking_version, idempotency_key, template,
            recipient_email, payload
        ) VALUES (
            v_booking, 98, 'booking:forged:payload:1', 'booking_ready', v_recipient,
            jsonb_build_object(
                'booking_reference', v_reference,
                'status', 'ready',
                'customer_name', 'Full Name'
            )
        );
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := true;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'FAIL extra payload data was accepted';
    END IF;

    -- Arbitrary recipient and terminal state without exhausted attempts.
    v_rejected := false;
    BEGIN
        INSERT INTO public.email_outbox (
            booking_id, booking_version, idempotency_key, template,
            recipient_email, payload, status
        ) VALUES (
            v_booking, 97, 'booking:forged:dead:1', 'booking_ready',
            'attacker@example.test',
            jsonb_build_object('booking_reference', v_reference, 'status', 'ready'),
            'dead'
        );
    EXCEPTION
        WHEN check_violation THEN
            v_rejected := true;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'FAIL dead row without exhausted attempts was accepted';
    END IF;

    -- A caller cannot redirect an enqueued message.
    v_rejected := false;
    BEGIN
        UPDATE public.email_outbox
        SET recipient_email = 'other@example.test'
        WHERE booking_id = v_booking;
    EXCEPTION
        WHEN raise_exception THEN
            v_rejected := true;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'FAIL recipient rewrite was accepted';
    END IF;

    -- A forged template/status pair is rejected by the trusted helper.
    v_rejected := false;
    BEGIN
        PERFORM private.enqueue_booking_email(
            v_booking, 'booking_completed', 96, v_recipient, v_reference, 'pending'
        );
    EXCEPTION
        WHEN raise_exception THEN
            v_rejected := true;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'FAIL template/status mismatch was accepted';
    END IF;
END;
$$;

-- -------------------------------------------------------------------------
-- 5. RLS, GRANTS AND THE EXISTING BOOKING BOUNDARY
-- -------------------------------------------------------------------------

DO $$
DECLARE
    v_rls boolean;
    v_policies integer;
BEGIN
    SELECT relrowsecurity INTO v_rls
    FROM pg_class WHERE oid = 'public.email_outbox'::regclass;

    IF v_rls IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL email_outbox does not have RLS enabled';
    END IF;

    SELECT count(*) INTO v_policies
    FROM pg_policy WHERE polrelid = 'public.email_outbox'::regclass;

    IF v_policies <> 0 THEN
        RAISE EXCEPTION 'FAIL email_outbox has % client policies', v_policies;
    END IF;

    IF has_table_privilege('anon', 'public.email_outbox', 'SELECT')
       OR has_table_privilege('anon', 'public.email_outbox', 'INSERT')
       OR has_table_privilege('anon', 'public.email_outbox', 'UPDATE')
       OR has_table_privilege('anon', 'public.email_outbox', 'DELETE') THEN
        RAISE EXCEPTION 'FAIL anon holds an outbox table privilege';
    END IF;

    IF has_table_privilege('authenticated', 'public.email_outbox', 'SELECT')
       OR has_table_privilege('authenticated', 'public.email_outbox', 'INSERT')
       OR has_table_privilege('authenticated', 'public.email_outbox', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.email_outbox', 'DELETE') THEN
        RAISE EXCEPTION 'FAIL authenticated holds an outbox table privilege';
    END IF;

    IF NOT has_table_privilege('service_role', 'public.email_outbox', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.email_outbox', 'INSERT') THEN
        RAISE EXCEPTION 'FAIL service_role is missing the worker privileges';
    END IF;

    -- The existing booking boundary must be unchanged.
    IF NOT (SELECT relrowsecurity FROM pg_class
            WHERE oid = 'public.bookings'::regclass) THEN
        RAISE EXCEPTION 'FAIL bookings lost RLS';
    END IF;

    IF has_table_privilege('anon', 'public.bookings', 'SELECT')
       OR has_table_privilege('authenticated', 'public.bookings', 'INSERT') THEN
        RAISE EXCEPTION 'FAIL the existing booking grants were weakened';
    END IF;
END;
$$;

DO $$
DECLARE
    v_rejected boolean := false;
BEGIN
    -- A client role cannot forge an outbox row, even with a valid-looking one.
    BEGIN
        SET LOCAL ROLE anon;

        BEGIN
            INSERT INTO public.email_outbox (
                idempotency_key, template, recipient_email, payload
            ) VALUES (
                'booking:forged:anon:1',
                'booking_created',
                'attacker@example.test',
                jsonb_build_object(
                    'booking_reference', '2W-AAAAAAAAAA',
                    'status', 'pending'
                )
            );
        EXCEPTION
            WHEN insufficient_privilege THEN
                v_rejected := true;
        END;

        RESET ROLE;
    EXCEPTION
        WHEN OTHERS THEN
            RESET ROLE;
            RAISE;
    END;

    IF NOT v_rejected THEN
        RAISE EXCEPTION 'FAIL anon inserted an outbox row';
    END IF;
END;
$$;

-- -------------------------------------------------------------------------
-- Roll back every test row and identity.
-- -------------------------------------------------------------------------

ROLLBACK;

SELECT 'Sprint 2D.1 email outbox tests passed (transaction rolled back).' AS result;
