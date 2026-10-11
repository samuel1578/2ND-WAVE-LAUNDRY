
BEGIN;

-- Sprint 1C: Administrator audit log.
-- Requires Sprint 1A private.is_full_admin().

CREATE TABLE public.audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    actor_id uuid
        REFERENCES auth.users(id)
        ON DELETE SET NULL,

    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,

    before_state jsonb,
    after_state jsonb,
    reason text,
    correlation_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT audit_events_action_format
        CHECK (
            action ~ '^[a-z]+(\.[a-z_]+)+$'
        ),

    CONSTRAINT audit_events_entity_type_length
        CHECK (
            char_length(entity_type) BETWEEN 1 AND 64
        ),

    CONSTRAINT audit_events_reason_length
        CHECK (
            reason IS NULL
            OR char_length(reason) <= 500
        ),

    CONSTRAINT audit_events_payload_size
        CHECK (
            coalesce(pg_column_size(before_state), 0) <= 8192
            AND
            coalesce(pg_column_size(after_state), 0) <= 8192
        )
);

COMMENT ON TABLE public.audit_events IS
'Append-only audit log for privileged administrative actions.';

CREATE INDEX audit_events_created_at_idx
ON public.audit_events (created_at DESC);

CREATE INDEX audit_events_entity_idx
ON public.audit_events (
    entity_type,
    entity_id,
    created_at DESC
);

CREATE INDEX audit_events_actor_idx
ON public.audit_events (
    actor_id,
    created_at DESC
);

-- Prevent modification or deletion of audit history.
CREATE OR REPLACE FUNCTION private.audit_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION
        'Audit events are append-only: % is not permitted.',
        TG_OP
        USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL
ON FUNCTION private.audit_events_immutable()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE
ON public.audit_events
FOR EACH ROW
EXECUTE FUNCTION private.audit_events_immutable();

-- Enable Row Level Security.
ALTER TABLE public.audit_events
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.audit_events
FROM anon, authenticated;

GRANT SELECT ON TABLE public.audit_events
TO authenticated;

-- Full Admins can read audit records.
-- No browser-facing role can write them.
CREATE POLICY audit_events_select_full_admin
ON public.audit_events
FOR SELECT
TO authenticated
USING (private.is_full_admin());

COMMIT;

-- Read-only verification.
SELECT
    relname AS table_name,
    relrowsecurity AS rls_enabled
FROM pg_class
WHERE oid = 'public.audit_events'::regclass;
