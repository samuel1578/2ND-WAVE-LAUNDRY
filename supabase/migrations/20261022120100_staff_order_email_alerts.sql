-- 2ND WAVE — Phase 2E.1
-- Staff/admin order alert enqueueing on the existing transactional outbox.
--
-- Requires:
--   * 20261019120000_email_outbox.sql            (outbox, enum, customer triggers)
--   * 20261011130200_booking_functions.sql       (booking lifecycle + history)
--   * 20261022120000_booking_alert_recipients.sql (staff templates + recipient list)
--
-- Scope of this migration:
--   * widen the outbox constraints so staff_order_* templates can share the
--     existing claim/retry/dead-letter delivery system;
--   * one private enqueue helper that resolves the central recipient list;
--   * two DEFERRED booking triggers for the five required order events.
--
-- Why deferred triggers: a genuine transition writes its history row (trusted
-- actor id, actor kind and reason) in the same transaction as the status update.
-- Deferring to commit lets the alert read that committed history instead of
-- trusting a caller-supplied actor or status. The booking insert and status
-- update remain the authoritative lifecycle; no client claim is consulted.
--
-- Failure isolation: the trigger function catches every error. A notification
-- problem must never roll back a committed order operation. Delivery failures
-- are already handled by the Phase 2D outbox/worker.
--
-- Forward-only: no earlier migration is edited and the six customer templates,
-- their trigger, their parameters and their wording are untouched.

BEGIN;

-- ============================================================
-- 1. OUTBOX CONSTRAINTS FOR STAFF ALERTS
-- ============================================================

-- A staff event fans out to every enabled recipient, so the per-event identity
-- must include the recipient. One recipient still gets at most one message for a
-- given booking, template and committed version.
ALTER TABLE public.email_outbox
DROP CONSTRAINT email_outbox_booking_event_unique;

ALTER TABLE public.email_outbox
ADD CONSTRAINT email_outbox_booking_event_recipient_unique
    UNIQUE (booking_id, template, booking_version, recipient_email);

COMMENT ON CONSTRAINT email_outbox_booking_event_recipient_unique ON public.email_outbox IS
'One message per booking event and recipient. A fan-out to several staff addresses is distinct; a replay of the same event is a no-op.';

-- Customer rows keep the minimal two-key payload. Staff rows carry the event
-- metadata (previous status, trusted actor, event time, recorded reason) that
-- cannot be reconstructed when the worker later renders the message.
ALTER TABLE public.email_outbox
DROP CONSTRAINT email_outbox_payload_shape;

ALTER TABLE public.email_outbox
ADD CONSTRAINT email_outbox_payload_shape
    CHECK (
        jsonb_typeof(payload) = 'object'
        AND payload ? 'booking_reference'
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
    );

-- ============================================================
-- 2. STAFF ALERT ENQUEUE HELPER
-- ============================================================
--
-- SECURITY DEFINER because no client role may insert into the outbox or read the
-- alert recipient list. The helper:
--   * re-reads the committed booking, so the status and version are never
--     supplied by a caller;
--   * rejects an event whose template does not match the committed status, so an
--     unchanged status, a rolled-back operation or a stale duplicate cannot
--     produce a message;
--   * verifies an admin actor against public.admin_profiles and never accepts an
--     actor name from a request;
--   * copies the recipient list at enqueue time through one unique-keyed row per
--     address, making replay a no-op;
--   * returns 0 for an empty or fully disabled recipient list, without an error.

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

    SELECT * INTO v_booking
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

        -- The actor name and role come from the trusted profile row, never from
        -- the event payload or a client request. `role` is the
        -- `public.admin_role` enum, so it is cast before coalescing: comparing it
        -- with a text literal would fail at execution and silently lose every
        -- administrator alert.
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
        -- The customer actor is identified from the persisted booking, not from a
        -- request parameter.
        v_actor_name := btrim(coalesce(v_booking.customer_name, ''));
    END IF;

    IF v_expected_status = 'pending' THEN
        v_previous := '';
    ELSE
        v_previous := lower(btrim(coalesce(p_previous_status, '')));
    END IF;

    -- The cancellation reason is only carried for a cancellation, and only from
    -- the committed history (or the persisted booking fallback). It is never
    -- included in a non-cancellation alert.
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
        'occurred_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'cancellation_reason', v_reason
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

COMMENT ON FUNCTION private.enqueue_staff_order_alert(
    uuid, public.email_template, integer, text, text, uuid, text
) IS
'Fans one committed staff order event out to the enabled central recipient list on the existing outbox. Re-reads the booking status/version, verifies an admin actor against admin_profiles, and is idempotent per recipient. Trigger-only.';

REVOKE ALL ON FUNCTION private.enqueue_staff_order_alert(
    uuid, public.email_template, integer, text, text, uuid, text
)
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. DEFERRED BOOKING TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION private.queue_staff_order_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_template public.email_template;
    v_history public.booking_status_history;
    v_previous text;
    v_actor_kind text := 'system';
    v_actor_id uuid;
    v_reason text;
    v_inserted integer;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- A committed booking always starts pending. Anything else is not a
        -- creation event.
        IF NEW.status <> 'pending' THEN
            RETURN NEW;
        END IF;
        v_template := 'staff_order_pending';
    ELSE
        IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
            RETURN NEW;
        END IF;

        v_template := CASE NEW.status
            WHEN 'processing' THEN 'staff_order_processing'
            WHEN 'ready' THEN 'staff_order_ready'
            WHEN 'completed' THEN 'staff_order_completed'
            WHEN 'cancelled' THEN 'staff_order_cancelled'
            ELSE NULL
        END;

        -- confirmed, scheduled, picked_up and out_for_delivery deliberately
        -- produce no staff alert.
        IF v_template IS NULL THEN
            RETURN NEW;
        END IF;
    END IF;

    -- The history row for this committed event is visible because the trigger is
    -- deferred to commit. It supplies the verified actor and the recorded reason.
    SELECT * INTO v_history
    FROM public.booking_status_history AS h
    WHERE h.booking_id = NEW.id
      AND h.to_status = NEW.status
    ORDER BY h.id DESC
    LIMIT 1;

    IF FOUND THEN
        v_previous := v_history.from_status::text;
        v_actor_kind := coalesce(v_history.actor_kind, 'system');
        v_actor_id := v_history.actor_id;
        v_reason := v_history.reason;
    END IF;

    v_inserted := private.enqueue_staff_order_alert(
        NEW.id,
        v_template,
        NEW.version,
        v_previous,
        v_actor_kind,
        v_actor_id,
        v_reason
    );

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Notification enrichment must never fail the order transaction. The
        -- message content deliberately contains no personal data.
        RAISE WARNING 'STAFF_ALERT_ENQUEUE_FAILED template=% sqlstate=%',
            v_template, SQLSTATE;
        RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.queue_staff_order_alert() IS
'Maps a committed booking insert/status change onto its staff order alert using the committed history actor. Deferred-to-commit and failure-isolated. Trigger-only.';

REVOKE ALL ON FUNCTION private.queue_staff_order_alert()
FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER bookings_staff_alert_created
AFTER INSERT ON public.bookings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.queue_staff_order_alert();

COMMENT ON TRIGGER bookings_staff_alert_created ON public.bookings IS
'Queues the staff order-pending alert at commit, after the initial history row exists. Never fails the booking.';

CREATE CONSTRAINT TRIGGER bookings_staff_alert_status_changed
AFTER UPDATE OF status ON public.bookings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION private.queue_staff_order_alert();

COMMENT ON TRIGGER bookings_staff_alert_status_changed ON public.bookings IS
'Queues the matching staff alert at commit for processing, ready, completed and cancelled only. Unchanged statuses produce nothing.';

COMMIT;

-- ============================================================
-- 4. READ-ONLY VERIFICATION
-- ============================================================

-- Expected: one row per enabled recipient per committed event (0 when the list is empty).
SELECT
    o.template,
    count(*) AS queued_rows,
    count(DISTINCT o.booking_id) AS bookings
FROM public.email_outbox AS o
WHERE o.template::text LIKE 'staff_order_%'
GROUP BY o.template
ORDER BY o.template;

-- Expected: both constraint triggers present, enabled, and deferred.
SELECT
    t.tgname AS trigger_name,
    t.tgenabled AS enabled,
    t.tgdeferrable AS deferrable,
    t.tginitdeferred AS initially_deferred,
    p.proname AS function_name
FROM pg_trigger AS t
JOIN pg_class AS c ON c.oid = t.tgrelid
JOIN pg_proc AS p ON p.oid = t.tgfoid
WHERE c.oid = 'public.bookings'::regclass
  AND t.tgname IN ('bookings_staff_alert_created', 'bookings_staff_alert_status_changed')
ORDER BY t.tgname;

-- Expected: EXECUTE false for anon/authenticated on every staff alert function.
SELECT
    p.proname AS function_name,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_execute
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'private'
  AND p.proname IN ('enqueue_staff_order_alert', 'queue_staff_order_alert')
ORDER BY p.proname;
