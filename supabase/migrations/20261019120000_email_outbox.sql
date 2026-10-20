-- 2ND WAVE — Sprint 2D.1
-- Customer email foundation: a durable transactional outbox.
--
-- Requires every Sprint 2A migration, in particular:
--   20261011130000_booking_schema.sql   (public.bookings, booking_status)
--   20261011130200_booking_functions.sql (booking_submit / booking_transition)
--   20261011130300_booking_retention.sql (retention conventions)
--
-- Scope of this migration:
--   * public.email_outbox — one durable row per eligible customer notification;
--   * six typed booking notification templates;
--   * two AFTER triggers on public.bookings that enqueue the notification in the
--     SAME transaction as the committed booking insert or status change;
--   * a deterministic, database-enforced idempotency key plus a second unique
--     identity on (booking_id, template, booking_version);
--   * RLS with no client policies and no client grants.
--
-- Deliberately NOT implemented here:
--   * no provider client, no Brevo call, no email is sent;
--   * no worker, no claim function and no retry scheduler (Sprint 2D.2);
--   * no destructive retention job (Sprint 2F).
--
-- This file is forward-only. It does not edit any earlier migration and does not
-- alter the booking lifecycle, the confirmation gate, booking RLS or the existing
-- trusted booking functions.

BEGIN;

-- ============================================================
-- 1. NOTIFICATION AND DELIVERY TYPES
-- ============================================================

-- One value per customer-visible commercial event. The lifecycle itself is not
-- redeclared here: these templates map onto statuses that already exist in
-- public.booking_status.
CREATE TYPE public.email_template AS ENUM (
    'booking_created',
    'booking_confirmed',
    'booking_processing_started',
    'booking_ready',
    'booking_completed',
    'booking_cancelled'
);

COMMENT ON TYPE public.email_template IS
'Customer transactional notification templates. A new value requires a new forward-only migration and a rendered template in the delivery sprint.';

-- Delivery states for the future worker.
--   pending          — committed, waiting for an eligible attempt
--   sending          — claimed by a worker with a live lease
--   sent             — provider accepted the message and returned (or may return)
--                      a provider message identifier
--   retryable_failed — a transient failure; another attempt is allowed
--   dead             — attempts exhausted; requires administrative attention
CREATE TYPE public.email_delivery_status AS ENUM (
    'pending',
    'sending',
    'sent',
    'retryable_failed',
    'dead'
);

COMMENT ON TYPE public.email_delivery_status IS
'Outbox delivery state. `dead` is terminal and reachable only after max_attempts. Delivery is not implemented in Sprint 2D.1.';

-- ============================================================
-- 2. OUTBOX TABLE
-- ============================================================
--
-- Personal data is minimised:
--   * recipient_email is required to deliver and is the only contact field;
--   * payload contains only the booking reference and the resulting status, so a
--     renderer can address the message without copying name, phone, address or
--     notes into a second table;
--   * no password, API key, signed URL, provider credential or raw provider error
--     is ever stored in this table.
--
-- booking_id is nullable for future non-booking notifications (staff alerts).
-- Every booking notification created by this migration sets it. ON DELETE CASCADE
-- means the booking retention deletion also removes its outbox rows, so customer
-- email is not kept beyond the booking record's own lifetime by this table.

CREATE TABLE public.email_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Business association. Nullable by design for later non-booking templates.
    booking_id uuid
        REFERENCES public.bookings(id) ON DELETE CASCADE,
    -- The committed booking version that caused this event. Together with the
    -- booking and template it forms a second uniqueness guarantee, independent of
    -- the textual idempotency key.
    booking_version integer,

    -- Deterministic key: booking:<uuid>:<template>:v<version>.
    idempotency_key text NOT NULL,

    template public.email_template NOT NULL,
    recipient_email text NOT NULL,

    -- Minimal render input. Extra keys are rejected by a CHECK constraint.
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Delivery state and scheduling.
    status public.email_delivery_status NOT NULL DEFAULT 'pending',
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),

    -- Worker lease. Only a `sending` row may hold one.
    locked_at timestamptz,
    locked_by text,
    lease_expires_at timestamptz,

    -- Provider and sanitised error information.
    provider_message_id text,
    last_error text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,

    CONSTRAINT email_outbox_idempotency_unique
        UNIQUE (idempotency_key),

    -- A booking event happens once. This also rejects a duplicate enqueue that
    -- somehow used a different textual key for the same committed version.
    CONSTRAINT email_outbox_booking_event_unique
        UNIQUE (booking_id, template, booking_version),

    CONSTRAINT email_outbox_idempotency_key_shape
        CHECK (
            idempotency_key = btrim(idempotency_key)
            AND char_length(idempotency_key) BETWEEN 8 AND 200
        ),

    CONSTRAINT email_outbox_recipient_shape
        CHECK (
            recipient_email = btrim(recipient_email)
            AND char_length(recipient_email) BETWEEN 3 AND 254
            AND recipient_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        ),

    -- Only a JSON object with exactly the two allowed render keys.
    CONSTRAINT email_outbox_payload_shape
        CHECK (
            jsonb_typeof(payload) = 'object'
            AND payload ? 'booking_reference'
            AND payload ? 'status'
            AND (payload - 'booking_reference' - 'status') = '{}'::jsonb
            AND jsonb_typeof(payload->'booking_reference') = 'string'
            AND jsonb_typeof(payload->'status') = 'string'
        ),

    CONSTRAINT email_outbox_reference_shape
        CHECK (payload->>'booking_reference' ~ '^2W-[0-9A-HJKMNP-TV-Z]{10}$'),

    -- The template and the status stored in the payload cannot disagree.
    CONSTRAINT email_outbox_template_status
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
        ),

    -- A version is supplied exactly when a booking is associated.
    CONSTRAINT email_outbox_booking_link
        CHECK (
            (booking_id IS NULL AND booking_version IS NULL)
            OR (booking_id IS NOT NULL
                AND booking_version IS NOT NULL
                AND booking_version >= 1)
        ),

    CONSTRAINT email_outbox_attempts
        CHECK (
            max_attempts BETWEEN 1 AND 20
            AND attempt_count BETWEEN 0 AND max_attempts
        ),

    -- Lease shape: a `sending` row must hold a live, bounded lease; every other
    -- state must not hold one.
    CONSTRAINT email_outbox_lease_required
        CHECK (
            status <> 'sending'
            OR (locked_at IS NOT NULL
                AND locked_by IS NOT NULL
                AND lease_expires_at IS NOT NULL
                AND lease_expires_at > locked_at)
        ),
    CONSTRAINT email_outbox_lease_cleared
        CHECK (
            status = 'sending'
            OR (locked_at IS NULL
                AND locked_by IS NULL
                AND lease_expires_at IS NULL)
        ),

    -- A sent row records its delivery time and cannot later pretend to be
    -- undelivered.
    CONSTRAINT email_outbox_sent_at
        CHECK (
            (status = 'sent' AND sent_at IS NOT NULL)
            OR (status <> 'sent' AND sent_at IS NULL)
        ),

    -- A failure state always carries a sanitised message. `dead` is only reachable
    -- once the configured attempt budget is exhausted.
    CONSTRAINT email_outbox_failure_reason
        CHECK (
            status NOT IN ('retryable_failed', 'dead')
            OR (last_error IS NOT NULL AND btrim(last_error) <> '')
        ),
    CONSTRAINT email_outbox_dead_attempts
        CHECK (status <> 'dead' OR attempt_count >= max_attempts),

    CONSTRAINT email_outbox_locked_by_length
        CHECK (locked_by IS NULL OR char_length(btrim(locked_by)) BETWEEN 1 AND 120),
    CONSTRAINT email_outbox_provider_id_length
        CHECK (provider_message_id IS NULL
            OR char_length(btrim(provider_message_id)) BETWEEN 1 AND 200),
    CONSTRAINT email_outbox_error_sanitised
        CHECK (last_error IS NULL
            OR (char_length(last_error) <= 500
                AND last_error !~ '[\r\n]'))
);

COMMENT ON TABLE public.email_outbox IS
'Durable transactional email outbox. Rows are inserted only by trusted booking functions (via triggers) in the same transaction as the business event. No email is sent in Sprint 2D.1.';

COMMENT ON COLUMN public.email_outbox.idempotency_key IS
'Deterministic event identity (booking:<uuid>:<template>:v<version>). Enforced unique by PostgreSQL.';

COMMENT ON COLUMN public.email_outbox.payload IS
'Minimal render input only: booking_reference and the resulting booking status. Deliberately contains no name, phone, address, notes, credentials or signed URLs.';

COMMENT ON COLUMN public.email_outbox.recipient_email IS
'Customer address supplied on the original booking. Never chosen by a browser or derived from a request to the outbox.';

COMMENT ON COLUMN public.email_outbox.last_error IS
'Sanitised failure summary (no newlines, at most 500 characters). Never a raw provider payload or credential.';

COMMENT ON COLUMN public.email_outbox.booking_version IS
'Committed public.bookings.version that caused the event. Part of the uniqueness guarantee and of the deterministic idempotency key.';

-- ============================================================
-- 3. INDEXES
-- ============================================================

-- The future worker polls due pending rows.
CREATE INDEX email_outbox_dispatch_idx
ON public.email_outbox (status, next_attempt_at);

CREATE INDEX email_outbox_booking_idx
ON public.email_outbox (booking_id);

-- Expired leases are the only rows a worker may reclaim.
CREATE INDEX email_outbox_lease_idx
ON public.email_outbox (lease_expires_at)
WHERE status = 'sending';

-- Retention review (Sprint 2F) needs an age-based access path.
CREATE INDEX email_outbox_created_idx
ON public.email_outbox (created_at);

-- ============================================================
-- 4. updated_at
-- ============================================================

CREATE TRIGGER email_outbox_touch
BEFORE UPDATE ON public.email_outbox
FOR EACH ROW
EXECUTE FUNCTION private.touch_updated_at();

-- ============================================================
-- 5. IDENTITY IMMUTABILITY
-- ============================================================
--
-- Delivery may change status, attempts, lease, provider id, error and
-- timestamps. It must not be able to redirect an existing message to a different
-- recipient, swap its template/payload or rewrite its idempotency key.

CREATE OR REPLACE FUNCTION private.email_outbox_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
       OR NEW.booking_version IS DISTINCT FROM OLD.booking_version
       OR NEW.template IS DISTINCT FROM OLD.template
       OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email
       OR NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'EMAIL_OUTBOX_IMMUTABLE: the enqueued message identity cannot be changed.'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.email_outbox_identity_immutable() IS
'Rejects changes to the recipient, template, payload, booking link or idempotency key of an enqueued message. Trigger-only.';

REVOKE ALL ON FUNCTION private.email_outbox_identity_immutable()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER email_outbox_identity_immutable
BEFORE UPDATE ON public.email_outbox
FOR EACH ROW
EXECUTE FUNCTION private.email_outbox_identity_immutable();

-- ============================================================
-- 6. TRANSACTIONAL ENQUEUE HELPER
-- ============================================================
--
-- SECURITY DEFINER so the trigger can insert even though no client role has a
-- table grant. The helper is private, search_path-pinned and never granted to a
-- client role. It derives the destination from the booking row, never from a
-- caller-supplied request, and it silently skips an absent or invalid customer
-- email: optional email means no row and no delivery failure.
--
-- ON CONFLICT DO NOTHING makes a duplicate enqueue (idempotent replay, retried
-- statement or concurrent attempt) a no-op rather than an error. The unique
-- constraints, not application code, are the guarantee.

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

    IF v_reference !~ '^2W-[0-9A-HJKMNP-TV-Z]{10}$' THEN
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
'Inserts one idempotent outbox row for a committed booking event. Skips an absent/invalid customer email; duplicate enqueue is a no-op. Trigger-only.';

REVOKE ALL ON FUNCTION private.enqueue_booking_email(
    uuid, public.email_template, integer, text, text, text
)
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 7. BOOKING TRIGGERS
-- ============================================================
--
-- The trigger fires inside the statement that changed the booking, so it shares
-- that transaction. A failed or rolled-back booking operation removes the outbox
-- row with everything else; no compensating delete exists or is needed.
--
-- Only the six required events are mapped. scheduled, picked_up and
-- out_for_delivery deliberately produce no customer email in this foundation.

CREATE OR REPLACE FUNCTION private.queue_booking_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_template public.email_template;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- A committed public booking always starts pending. Anything else is not
        -- a valid creation event.
        IF NEW.status <> 'pending' THEN
            RETURN NEW;
        END IF;
        v_template := 'booking_created';
    ELSE
        IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
            RETURN NEW;
        END IF;

        v_template := CASE NEW.status
            WHEN 'confirmed' THEN 'booking_confirmed'
            WHEN 'processing' THEN 'booking_processing_started'
            WHEN 'ready' THEN 'booking_ready'
            WHEN 'completed' THEN 'booking_completed'
            WHEN 'cancelled' THEN 'booking_cancelled'
            ELSE NULL
        END;

        IF v_template IS NULL THEN
            RETURN NEW;
        END IF;
    END IF;

    -- The recipient is read from the booking row itself. A browser has no path to
    -- this function and cannot supply a recipient, template or payload.
    PERFORM private.enqueue_booking_email(
        NEW.id,
        v_template,
        NEW.version,
        NEW.customer_email,
        NEW.reference,
        NEW.status::text
    );

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.queue_booking_email() IS
'Maps a committed booking insert/status change onto its customer notification and enqueues it atomically. Trigger-only.';

REVOKE ALL ON FUNCTION private.queue_booking_email()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER bookings_email_created
AFTER INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION private.queue_booking_email();

COMMENT ON TRIGGER bookings_email_created ON public.bookings IS
'Queues the booking_created customer email after a valid booking insert. Idempotent replay returns before INSERT and therefore queues nothing.';

CREATE TRIGGER bookings_email_status_changed
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION private.queue_booking_email();

COMMENT ON TRIGGER bookings_email_status_changed ON public.bookings IS
'Queues the matching customer email in the same transaction as the status update and its booking_status_history row.';

-- ============================================================
-- 8. ROW LEVEL SECURITY AND GRANTS
-- ============================================================
--
-- The outbox is exposed as a public-schema table, so RLS is enabled and there is
-- no policy for any client role. That is intentional deny-by-default: anon and
-- authenticated cannot read, insert, update or delete, even if a future grant is
-- added by mistake. The verified server may use its elevated role; browser
-- requests never receive that role.

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_outbox FROM PUBLIC, anon, authenticated;

-- The elevated server role is explicitly granted only the operations a future
-- worker needs. It is never shipped to the browser. No admin read policy is
-- added here; the delivery-failure view belongs to the delivery sprint and must
-- add its own narrowly scoped policy.
REVOKE ALL ON TABLE public.email_outbox FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_outbox TO service_role;

COMMIT;

-- ============================================================
-- 9. READ-ONLY VERIFICATION
-- ============================================================

-- Expected: rls_enabled = true and policies = 0.
SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    count(p.polname) AS policies
FROM pg_class AS c
LEFT JOIN pg_policy AS p ON p.polrelid = c.oid
WHERE c.oid = 'public.email_outbox'::regclass
GROUP BY c.relname, c.relrowsecurity;

-- Expected: anon/authenticated false for every operation; service_role true.
SELECT
    has_table_privilege('anon', 'public.email_outbox', 'SELECT') AS anon_select,
    has_table_privilege('anon', 'public.email_outbox', 'INSERT') AS anon_insert,
    has_table_privilege('anon', 'public.email_outbox', 'UPDATE') AS anon_update,
    has_table_privilege('anon', 'public.email_outbox', 'DELETE') AS anon_delete,
    has_table_privilege('authenticated', 'public.email_outbox', 'SELECT') AS auth_select,
    has_table_privilege('authenticated', 'public.email_outbox', 'INSERT') AS auth_insert,
    has_table_privilege('authenticated', 'public.email_outbox', 'UPDATE') AS auth_update,
    has_table_privilege('authenticated', 'public.email_outbox', 'DELETE') AS auth_delete,
    has_table_privilege('service_role', 'public.email_outbox', 'SELECT') AS service_select,
    has_table_privilege('service_role', 'public.email_outbox', 'INSERT') AS service_insert;

-- Expected: both booking triggers are present and enabled.
SELECT
    t.tgname AS trigger_name,
    c.relname AS table_name,
    p.proname AS function_name,
    t.tgenabled AS enabled
FROM pg_trigger AS t
JOIN pg_class AS c ON c.oid = t.tgrelid
JOIN pg_proc AS p ON p.oid = t.tgfoid
WHERE c.oid = 'public.bookings'::regclass
  AND t.tgname IN ('bookings_email_created', 'bookings_email_status_changed')
ORDER BY t.tgname;

-- Expected: EXECUTE false for anon/authenticated on every new function.
SELECT
    p.proname AS function_name,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_execute
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'private'
  AND p.proname IN (
      'enqueue_booking_email',
      'queue_booking_email',
      'email_outbox_identity_immutable'
  )
ORDER BY p.proname;
