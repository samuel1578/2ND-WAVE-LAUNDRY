-- 2ND WAVE — Sprint 2D.3
-- Full Admin-controlled retry of a terminal customer email.
--
-- Monitoring reads use the existing server-only service client after the
-- `email.manage` permission check. This migration adds no second queue and does
-- not change booking lifecycle or outbox enqueue triggers.

BEGIN;

-- Preserve the actual time a row was claimed for a provider attempt. `updated_at`
-- also changes on retry/reap completion and is not an accurate attempt time.
ALTER TABLE public.email_outbox
ADD COLUMN last_attempt_at timestamptz;

UPDATE public.email_outbox
SET last_attempt_at = updated_at
WHERE attempt_count > 0;

CREATE OR REPLACE FUNCTION private.email_outbox_track_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'sending' AND OLD.status IS DISTINCT FROM 'sending' THEN
        NEW.last_attempt_at := now();
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.email_outbox_track_attempt()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER email_outbox_track_attempt
BEFORE UPDATE ON public.email_outbox
FOR EACH ROW
EXECUTE FUNCTION private.email_outbox_track_attempt();

-- The trusted server-side retry function writes an audit row as part of the
-- same transaction as the outbox state change. Browser roles receive no write
-- access to the audit table.
GRANT INSERT ON public.audit_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.audit_events_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.email_outbox_manual_retry(
    p_id uuid,
    p_actor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_attempt_count integer;
    v_max_attempts integer;
BEGIN
    IF p_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION
            'EMAIL_MANUAL_RETRY: a message and administrator are required.'
            USING ERRCODE = 'P0001';
    END IF;

    PERFORM 1
    FROM public.admin_profiles AS profile
    WHERE profile.user_id = p_actor_id
      AND profile.role = 'full_admin'
      AND profile.disabled_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'EMAIL_MANUAL_RETRY: an active Full Admin is required.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.email_outbox AS outbox
    SET
        status = 'pending',
        max_attempts = outbox.max_attempts + 1,
        next_attempt_at = now(),
        provider_message_id = NULL,
        last_error = NULL
    WHERE outbox.id = p_id
      AND outbox.status = 'dead'
      AND outbox.max_attempts < 20
    RETURNING outbox.attempt_count, outbox.max_attempts
    INTO v_attempt_count, v_max_attempts;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    INSERT INTO public.audit_events (
        actor_id,
        action,
        entity_type,
        entity_id,
        before_state,
        after_state,
        reason,
        correlation_id
    )
    VALUES (
        p_actor_id,
        'email.manual_retry',
        'email_outbox',
        p_id::text,
        jsonb_build_object(
            'status', 'dead',
            'attempt_count', v_attempt_count,
            'max_attempts', v_max_attempts - 1
        ),
        jsonb_build_object(
            'status', 'pending',
            'attempt_count', v_attempt_count,
            'max_attempts', v_max_attempts
        ),
        'Full Admin queued one failed notification for retry.',
        gen_random_uuid()
    );

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.email_outbox_manual_retry(uuid, uuid) IS
'Requeues one dead outbox row without creating a new event, increasing its bounded attempt budget and recording a Full Admin audit event. Callable by service_role only.';

REVOKE ALL ON FUNCTION public.email_outbox_manual_retry(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_outbox_manual_retry(uuid, uuid)
TO service_role;

COMMIT;
