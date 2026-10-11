
BEGIN;

-- Sprint 1C: Staff invitation lifecycle.
-- Requires public.admin_role and private.is_full_admin().

CREATE TABLE public.admin_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    email text NOT NULL,
    role public.admin_role NOT NULL,

    status text NOT NULL DEFAULT 'pending',

    invited_by uuid
        REFERENCES auth.users(id)
        ON DELETE SET NULL,

    auth_user_id uuid
        REFERENCES auth.users(id)
        ON DELETE SET NULL,

    correlation_id uuid,
    failure_reason text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    accepted_at timestamptz,

    CONSTRAINT admin_invitations_status_check
        CHECK (
            status IN (
                'pending',
                'sent',
                'accepted',
                'failed',
                'revoked'
            )
        ),

    CONSTRAINT admin_invitations_email_normalised
        CHECK (
            email = lower(btrim(email))
            AND char_length(email) BETWEEN 3 AND 254
        ),

    CONSTRAINT admin_invitations_failure_reason_length
        CHECK (
            failure_reason IS NULL
            OR char_length(failure_reason) <= 300
        )
);

COMMENT ON TABLE public.admin_invitations IS
'Staff invitation lifecycle. Invitations do not grant
administrator access before verified acceptance.';

COMMENT ON COLUMN public.admin_invitations.role IS
'Role assigned by the inviting Full Admin, not the invitee.';

-- Only one pending or sent invitation per address.
CREATE UNIQUE INDEX admin_invitations_open_email_idx
ON public.admin_invitations (lower(email))
WHERE status IN ('pending', 'sent');

CREATE INDEX admin_invitations_status_idx
ON public.admin_invitations (
    status,
    created_at DESC
);

-- Maintain updated_at automatically.
CREATE OR REPLACE FUNCTION private.touch_admin_invitations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION private.touch_admin_invitations()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER admin_invitations_touch
BEFORE UPDATE ON public.admin_invitations
FOR EACH ROW
EXECUTE FUNCTION private.touch_admin_invitations();

-- Row Level Security.
ALTER TABLE public.admin_invitations
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_invitations
FROM anon, authenticated;

GRANT SELECT ON TABLE public.admin_invitations
TO authenticated;

-- Only Full Admins can view invitations.
CREATE POLICY admin_invitations_select_full_admin
ON public.admin_invitations
FOR SELECT
TO authenticated
USING (private.is_full_admin());

COMMIT;

-- Read-only verification.
SELECT
    relname AS table_name,
    relrowsecurity AS rls_enabled
FROM pg_class
WHERE oid = 'public.admin_invitations'::regclass;
