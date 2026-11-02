BEGIN;

-- Revoke an outstanding staff invitation while preserving its history. Auth-user
-- deletion is intentionally performed separately through the Auth Admin API,
-- where the application can verify confirmation and sign-in state first.
CREATE OR REPLACE   FUNCTION public.staff_revoke_invitation(
    p_actor uuid,
    p_invitation uuid,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_invitation public.admin_invitations%ROWTYPE;
    v_previous text;
BEGIN
    PERFORM private.staff_lock();
    PERFORM private.assert_active_full_admin(p_actor);

    SELECT * INTO v_invitation
    FROM public.admin_invitations
    WHERE id = p_invitation
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'STAFF_INVITATION_NOT_FOUND: invitation missing.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_invitation.status = 'revoked' THEN
        RETURN jsonb_build_object(
            'invitation_id', v_invitation.id,
            'email', v_invitation.email,
            'role', v_invitation.role,
            'status', v_invitation.status,
            'auth_user_id', v_invitation.auth_user_id
        );
    END IF;

    IF v_invitation.status NOT IN ('pending', 'sent') THEN
        RAISE EXCEPTION
            'STAFF_INVITATION_STATE: invitation cannot be revoked.'
            USING ERRCODE = 'P0001';
    END IF;

    v_previous := v_invitation.status;

    UPDATE public.admin_invitations
    SET status = 'revoked'
    WHERE id = p_invitation
    RETURNING * INTO v_invitation;

    PERFORM private.insert_audit_event(
        p_actor,
        'staff.invitation_revoked',
        'admin_invitation',
        v_invitation.id::text,
        jsonb_build_object(
            'email', v_invitation.email,
            'role', v_invitation.role,
            'status', v_previous
        ),
        jsonb_build_object(
            'email', v_invitation.email,
            'role', v_invitation.role,
            'status', 'revoked'
        ),
        NULL,
        p_correlation
    );

    RETURN jsonb_build_object(
        'invitation_id', v_invitation.id,
        'email', v_invitation.email,
        'role', v_invitation.role,
        'status', v_invitation.status,
        'auth_user_id', v_invitation.auth_user_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_revoke_invitation(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_revoke_invitation(uuid, uuid, uuid)
TO service_role;

COMMIT;

-- Read-only privilege verification: expected false, false, true.
SELECT
    has_function_privilege('anon', 'public.staff_revoke_invitation(uuid,uuid,uuid)', 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', 'public.staff_revoke_invitation(uuid,uuid,uuid)', 'EXECUTE') AS authenticated_can_execute,
    has_function_privilege('service_role', 'public.staff_revoke_invitation(uuid,uuid,uuid)', 'EXECUTE') AS service_role_can_execute;
