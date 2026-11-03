-- Allow post-commit dispatches to claim only the template family that caused
-- the kick. The scheduled worker passes NULL and retains its all-template drain.
-- This prevents a public enquiry submission from opportunistically sending an
-- older booking/order or newsletter notification from the shared queue.
--
-- Remove the old unscoped three-argument overload. It cannot distinguish a
-- public form kick from the scheduled all-template drain, so retaining it lets
-- an old application deployment consume and send unrelated queued templates.
-- The four-argument function remains the only claim API; scheduled workers pass
-- NULL explicitly when they are authorized to drain all template families.

BEGIN;

CREATE OR REPLACE FUNCTION public.email_outbox_claim(
    p_worker_id text,
    p_limit integer,
    p_lease_seconds integer,
    p_templates public.email_template[]
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

    IF p_templates IS NOT NULL AND (
        cardinality(p_templates) NOT BETWEEN 1 AND 25
        OR EXISTS (SELECT 1 FROM unnest(p_templates) AS selected(template) WHERE selected.template IS NULL)
    ) THEN
        RAISE EXCEPTION
            'EMAIL_WORKER_TEMPLATES: template filter must contain between 1 and 25 non-null templates.'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY
    WITH candidates AS (
        SELECT o.id
        FROM public.email_outbox AS o
        WHERE o.status IN ('pending', 'retryable_failed')
          AND o.next_attempt_at <= now()
          AND o.attempt_count < o.max_attempts
          AND (p_templates IS NULL OR o.template = ANY(p_templates))
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

COMMENT ON FUNCTION public.email_outbox_claim(text, integer, integer, public.email_template[]) IS
'Atomically leases a bounded batch of due outbox rows; optional template allowlist scopes event-specific dispatch. NULL allows the scheduled worker to drain all templates.';

REVOKE ALL ON FUNCTION public.email_outbox_claim(text, integer, integer, public.email_template[])
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_outbox_claim(text, integer, integer, public.email_template[])
TO service_role;

-- Fail closed for older deployments that still call the unscoped signature.
-- A missed dispatch is recoverable from the outbox after the new deployment;
-- sending an unrelated template from a public form trigger is not.
DROP FUNCTION IF EXISTS public.email_outbox_claim(text, integer, integer);

COMMIT;

-- Read-only verification: the scoped signature exists and the legacy unscoped
-- overload does not.
SELECT
    to_regprocedure('public.email_outbox_claim(text,integer,integer,public.email_template[])') AS scoped_signature,
    to_regprocedure('public.email_outbox_claim(text,integer,integer)') AS legacy_unscoped_signature;
