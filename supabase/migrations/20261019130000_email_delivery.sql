-- 2ND WAVE — Sprint 2D.2
-- Brevo transactional delivery foundation.
--
-- Requires 20261019120000_email_outbox.sql (Sprint 2D.1).
--
-- Scope of this migration:
--   * atomic, lease-based claim/reap/completion functions used by the worker;
--   * per-provider-message delivery event persistence for Brevo webhooks;
--   * a narrow relaxation of the dead-letter CHECK so a permanent provider
--     rejection can be terminal after the first attempt.
--
-- Still NOT implemented here:
--   * no provider credentials, no HTTP call, no scheduler;
--   * no destructive retention job (Sprint 2F).
--
-- This migration is forward-only. It does not edit the Sprint 2D.1 file and does
-- not change any booking lifecycle rule.

BEGIN;

-- ============================================================
-- 1. PERMANENT FAILURE CAN TERMINATE AFTER ONE ATTEMPT
-- ============================================================
--
-- Sprint 2D.1 required `dead` only after max_attempts, which was correct for
-- transient failures but makes a permanent provider rejection (for example 401
-- or a rejected sender) wait through the whole retry budget. A dead row must
-- still have been attempted at least once; claim() increments attempt_count
-- before the provider call, so this remains a real delivery attempt.

ALTER TABLE public.email_outbox
DROP CONSTRAINT email_outbox_dead_attempts;

ALTER TABLE public.email_outbox
ADD CONSTRAINT email_outbox_dead_attempts
    CHECK (status <> 'dead' OR attempt_count >= 1);

COMMENT ON CONSTRAINT email_outbox_dead_attempts ON public.email_outbox IS
'A dead row must have been attempted at least once. Permanent rejections may terminate before max_attempts.';

-- ============================================================
-- 2. DELIVERY EVENT TYPE
-- ============================================================

CREATE TYPE public.email_delivery_event AS ENUM (
    'delivered',
    'deferred',
    'bounced',
    'complained'
);

COMMENT ON TYPE public.email_delivery_event IS
'Provider delivery events persisted from verified Brevo transactional webhooks. Opened/clicked events are deliberately ignored.';

-- ============================================================
-- 3. DELIVERY EVENTS
-- ============================================================
--
-- Only the minimum is stored: the outbox association, the normalised event,
-- a replay-deduplication digest, a short sanitised provider reason and the event
-- time. The raw Brevo payload (recipient email, subject, message body, tags,
-- sending IP, links, user agent) is never persisted.

CREATE TABLE public.email_delivery_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    outbox_id uuid NOT NULL
        REFERENCES public.email_outbox(id) ON DELETE CASCADE,
    event public.email_delivery_event NOT NULL,

    -- SHA-256 hex digest of a minimal provider-event identity. The unique
    -- constraint makes a replayed webhook a no-op instead of a duplicate row.
    dedupe_key text NOT NULL,

    -- Provider reason for a deferral/bounce/complaint, sanitised and bounded.
    reason text,
    provider_event_at timestamptz,
    received_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT email_delivery_events_dedupe_unique
        UNIQUE (dedupe_key),
    CONSTRAINT email_delivery_events_dedupe_shape
        CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
    CONSTRAINT email_delivery_events_reason
        CHECK (reason IS NULL
            OR (char_length(reason) <= 200
                AND reason !~ '[\r\n]')),
    CONSTRAINT email_delivery_events_event_time
        CHECK (provider_event_at IS NULL
            OR provider_event_at > timestamptz '2000-01-01 00:00:00+00')
);

COMMENT ON TABLE public.email_delivery_events IS
'Append-only provider delivery events for the transactional outbox. Contains no recipient address, subject, body or raw webhook payload.';

CREATE INDEX email_delivery_events_outbox_idx
ON public.email_delivery_events (outbox_id, received_at DESC);

CREATE INDEX email_delivery_events_event_idx
ON public.email_delivery_events (event, received_at DESC);

-- Updates are never needed. Deletes remain possible for the future retention
-- job and for ON DELETE CASCADE when the outbox row is removed.
CREATE OR REPLACE FUNCTION private.email_delivery_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION
        'EMAIL_DELIVERY_EVENTS_IMMUTABLE: delivery events cannot be updated.'
        USING ERRCODE = 'P0001';
END;
$$;

COMMENT ON FUNCTION private.email_delivery_events_immutable() IS
'Rejects updates to append-only delivery events. Trigger-only.';

REVOKE ALL ON FUNCTION private.email_delivery_events_immutable()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER email_delivery_events_immutable
BEFORE UPDATE ON public.email_delivery_events
FOR EACH ROW
EXECUTE FUNCTION private.email_delivery_events_immutable();

-- ============================================================
-- 4. WORKER CLAIM, REAP AND COMPLETION FUNCTIONS
-- ============================================================
--
-- All functions are SECURITY DEFINER, search_path-pinned, and callable only by
-- the elevated server role. Rows are claimed with FOR UPDATE SKIP LOCKED so two
-- concurrent workers receive disjoint batches.
--
-- Delivery semantics are at-least-once: a provider timeout is ambiguous and the
-- row may be retried. The provider idempotency key (the outbox UUID) narrows
-- duplicate sends to Brevo's documented 30-minute idempotency window.

CREATE OR REPLACE FUNCTION public.email_outbox_claim(
    p_worker_id text,
    p_limit integer DEFAULT 10,
    p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_worker text := btrim(coalesce(p_worker_id, ''));
    v_limit integer := coalesce(p_limit, 10);
    v_lease integer := coalesce(p_lease_seconds, 120);
BEGIN
    IF char_length(v_worker) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION
            'EMAIL_WORKER_ID: a worker identifier is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_limit < 1 OR v_limit > 25 THEN
        RAISE EXCEPTION
            'EMAIL_WORKER_LIMIT: the batch size must be between 1 and 25.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_lease < 30 OR v_lease > 900 THEN
        RAISE EXCEPTION
            'EMAIL_WORKER_LEASE: the lease must be between 30 and 900 seconds.'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY
    WITH candidates AS (
        SELECT o.id
        FROM public.email_outbox AS o
        WHERE o.status IN ('pending', 'retryable_failed')
          AND o.next_attempt_at <= now()
          AND o.attempt_count < o.max_attempts
        ORDER BY o.next_attempt_at, o.created_at, o.id
        FOR UPDATE SKIP LOCKED
        LIMIT v_limit
    )
    UPDATE public.email_outbox AS o
    SET
        status = 'sending',
        attempt_count = o.attempt_count + 1,
        locked_at = now(),
        locked_by = v_worker,
        lease_expires_at = now() + make_interval(secs => v_lease)
    FROM candidates AS c
    WHERE o.id = c.id
    RETURNING o.*;
END;
$$;

COMMENT ON FUNCTION public.email_outbox_claim(text, integer, integer) IS
'Atomically leases a bounded batch of due outbox rows to one worker. Callable by service_role only.';

REVOKE ALL ON FUNCTION public.email_outbox_claim(text, integer, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_outbox_claim(text, integer, integer)
TO service_role;

-- Recovers abandoned `sending` rows whose lease has expired. A row that has not
-- exhausted its attempts becomes retryable; a row at its attempt limit becomes
-- dead. The lease is always cleared so the shape constraints stay satisfied.
CREATE OR REPLACE FUNCTION public.email_outbox_reap(
    p_limit integer DEFAULT 50
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limit integer := coalesce(p_limit, 50);
    v_count integer := 0;
BEGIN
    IF v_limit < 1 OR v_limit > 100 THEN
        RAISE EXCEPTION
            'EMAIL_REAP_LIMIT: the reap batch size must be between 1 and 100.'
            USING ERRCODE = 'P0001';
    END IF;

    WITH expired AS (
        SELECT o.id, o.attempt_count, o.max_attempts
        FROM public.email_outbox AS o
        WHERE o.status = 'sending'
          AND o.lease_expires_at <= now()
        ORDER BY o.lease_expires_at, o.id
        FOR UPDATE SKIP LOCKED
        LIMIT v_limit
    )
    UPDATE public.email_outbox AS o
    SET
        status = (CASE
            WHEN e.attempt_count >= e.max_attempts THEN 'dead'
            ELSE 'retryable_failed'
        END)::public.email_delivery_status,
        last_error = 'EMAIL_OUTBOX_LEASE_EXPIRED: the previous worker did not finish.',
        next_attempt_at = CASE
            WHEN e.attempt_count >= e.max_attempts THEN now()
            ELSE now() + interval '60 seconds'
        END,
        locked_at = NULL,
        locked_by = NULL,
        lease_expires_at = NULL
    FROM expired AS e
    WHERE o.id = e.id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.email_outbox_reap(integer) IS
'Recovers expired worker leases, returning abandoned rows to the retry queue or dead-lettering exhausted rows. Callable by service_role only.';

REVOKE ALL ON FUNCTION public.email_outbox_reap(integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_outbox_reap(integer)
TO service_role;

-- Provider accepted the message. The lease is cleared; a stale worker whose row
-- was already reaped/reclaimed cannot mark it, because the worker identifier no
-- longer matches.
CREATE OR REPLACE FUNCTION public.email_outbox_mark_sent(
    p_id uuid,
    p_worker_id text,
    p_provider_message_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_worker text := btrim(coalesce(p_worker_id, ''));
    v_provider_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
    v_updated boolean := false;
BEGIN
    IF p_id IS NULL OR char_length(v_worker) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION
            'EMAIL_MARK_SENT: a message and worker identifier are required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_provider_id IS NOT NULL AND char_length(v_provider_id) > 200 THEN
        RAISE EXCEPTION
            'EMAIL_MARK_SENT: invalid provider message identifier.'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.email_outbox
    SET
        status = 'sent',
        sent_at = now(),
        provider_message_id = v_provider_id,
        last_error = NULL,
        locked_at = NULL,
        locked_by = NULL,
        lease_expires_at = NULL
    WHERE id = p_id
      AND status = 'sending'
      AND locked_by = v_worker;

    v_updated := FOUND;
    RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.email_outbox_mark_sent(uuid, text, text) IS
'Records provider acceptance for the worker that currently owns the row. Callable by service_role only.';

REVOKE ALL ON FUNCTION public.email_outbox_mark_sent(uuid, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_outbox_mark_sent(uuid, text, text)
TO service_role;

-- Retryable failure. If the just-completed attempt exhausted the row's budget,
-- the same statement terminates it as dead; otherwise it is scheduled with the
-- bounded delay computed by the worker.
CREATE OR REPLACE FUNCTION public.email_outbox_mark_retry(
    p_id uuid,
    p_worker_id text,
    p_error text,
    p_delay_seconds integer
)
RETURNS public.email_delivery_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_worker text := btrim(coalesce(p_worker_id, ''));
    v_error text;
    v_delay integer := coalesce(p_delay_seconds, 60);
    v_status public.email_delivery_status;
BEGIN
    IF p_id IS NULL OR char_length(v_worker) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION
            'EMAIL_MARK_RETRY: a message and worker identifier are required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_delay < 1 OR v_delay > 3600 THEN
        RAISE EXCEPTION
            'EMAIL_MARK_RETRY: the retry delay must be between 1 and 3600 seconds.'
            USING ERRCODE = 'P0001';
    END IF;

    v_error := left(
        regexp_replace(
            btrim(coalesce(p_error, 'email_delivery_failed')),
            '[\r\n]+',
            ' ',
            'g'
        ),
        500
    );

    IF v_error = '' THEN
        v_error := 'email_delivery_failed';
    END IF;

    UPDATE public.email_outbox
    SET
        status = (CASE
            WHEN attempt_count >= max_attempts THEN 'dead'
            ELSE 'retryable_failed'
        END)::public.email_delivery_status,
        last_error = v_error,
        next_attempt_at = CASE
            WHEN attempt_count >= max_attempts THEN now()
            ELSE now() + make_interval(secs => v_delay)
        END,
        locked_at = NULL,
        locked_by = NULL,
        lease_expires_at = NULL
    WHERE id = p_id
      AND status = 'sending'
      AND locked_by = v_worker
    RETURNING status INTO v_status;

    RETURN v_status;
END;
$$;

COMMENT ON FUNCTION public.email_outbox_mark_retry(uuid, text, text, integer) IS
'Records a retryable failure, or dead-letters the row when its attempt budget is exhausted. Callable by service_role only.';

REVOKE ALL ON FUNCTION public.email_outbox_mark_retry(uuid, text, text, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_outbox_mark_retry(uuid, text, text, integer)
TO service_role;

-- Permanent failure (invalid configuration, rejected sender, invalid recipient
-- data, render failure). Terminal immediately, but only after the claim incremented
-- attempt_count, so the dead-letter CHECK remains truthful.
CREATE OR REPLACE FUNCTION public.email_outbox_mark_dead(
    p_id uuid,
    p_worker_id text,
    p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_worker text := btrim(coalesce(p_worker_id, ''));
    v_error text;
    v_updated boolean := false;
BEGIN
    IF p_id IS NULL OR char_length(v_worker) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION
            'EMAIL_MARK_DEAD: a message and worker identifier are required.'
            USING ERRCODE = 'P0001';
    END IF;

    v_error := left(
        regexp_replace(
            btrim(coalesce(p_error, 'email_delivery_failed')),
            '[\r\n]+',
            ' ',
            'g'
        ),
        500
    );

    IF v_error = '' THEN
        v_error := 'email_delivery_failed';
    END IF;

    UPDATE public.email_outbox
    SET
        status = 'dead',
        last_error = v_error,
        next_attempt_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        lease_expires_at = NULL
    WHERE id = p_id
      AND status = 'sending'
      AND locked_by = v_worker;

    v_updated := FOUND;
    RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.email_outbox_mark_dead(uuid, text, text) IS
'Records a permanent delivery failure for the worker that owns the row. Callable by service_role only.';

REVOKE ALL ON FUNCTION public.email_outbox_mark_dead(uuid, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_outbox_mark_dead(uuid, text, text)
TO service_role;

-- ============================================================
-- 5. DELIVERY EVENT SECURITY
-- ============================================================

ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_delivery_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.email_delivery_events FROM service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.email_delivery_events TO service_role;

-- No SELECT policy is added for administrators in this sprint. The delivery
-- events are operational data read by the trusted server; an admin monitoring
-- view belongs to a later, separately reviewed surface.

COMMIT;

-- ============================================================
-- 6. READ-ONLY VERIFICATION
-- ============================================================

-- Expected: rls_enabled = true, policies = 0.
SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    count(p.polname) AS policies
FROM pg_class AS c
LEFT JOIN pg_policy AS p ON p.polrelid = c.oid
WHERE c.oid = 'public.email_delivery_events'::regclass
GROUP BY c.relname, c.relrowsecurity;

-- Expected: anon/authenticated false for every operation.
SELECT
    has_table_privilege('anon', 'public.email_delivery_events', 'SELECT') AS anon_select,
    has_table_privilege('anon', 'public.email_delivery_events', 'INSERT') AS anon_insert,
    has_table_privilege('authenticated', 'public.email_delivery_events', 'SELECT') AS auth_select,
    has_table_privilege('authenticated', 'public.email_delivery_events', 'INSERT') AS auth_insert,
    has_table_privilege('service_role', 'public.email_delivery_events', 'SELECT') AS service_select,
    has_table_privilege('service_role', 'public.email_delivery_events', 'INSERT') AS service_insert;

-- Expected: true for service_role, false for anon/authenticated.
SELECT
    p.proname AS function_name,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_can_execute
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'email_outbox_claim',
      'email_outbox_reap',
      'email_outbox_mark_sent',
      'email_outbox_mark_retry',
      'email_outbox_mark_dead'
  )
ORDER BY p.proname;
