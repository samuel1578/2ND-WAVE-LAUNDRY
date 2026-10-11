
BEGIN;

-- 2ND WAVE — Sprint 1C
-- Trusted Staff Administration Functions
-- Requires migrations 1, 2 and 3.
--
-- All exposed staff RPCs are restricted to service_role.
-- The application must validate the authenticated actor
-- before invoking them with its server-only secret key.

-- =========================================================
-- 1. PRIVATE AUDIT HELPER
-- =========================================================

CREATE OR REPLACE FUNCTION private.insert_audit_event(
    p_actor uuid,
    p_action text,
    p_entity_type text,
    p_entity_id text,
    p_before jsonb,
    p_after jsonb,
    p_reason text,
    p_correlation uuid
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
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
        p_actor,
        p_action,
        p_entity_type,
        p_entity_id,
        p_before,
        p_after,
        p_reason,
        p_correlation
    )
    RETURNING id;
$$;

REVOKE ALL ON FUNCTION
private.insert_audit_event(
    uuid, text, text, text,
    jsonb, jsonb, text, uuid
)
FROM PUBLIC, anon, authenticated;

-- =========================================================
-- 2. TRANSACTION LOCK
-- =========================================================

CREATE OR REPLACE FUNCTION private.staff_lock()
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_advisory_xact_lock(
        hashtext('2ndwave.admin_profiles.staff_change')
    );
$$;

REVOKE ALL ON FUNCTION private.staff_lock()
FROM PUBLIC, anon, authenticated;

-- =========================================================
-- 3. ACTIVE FULL ADMIN COUNT
-- =========================================================

CREATE OR REPLACE FUNCTION private.active_full_admin_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(*)::integer
    FROM public.admin_profiles
    WHERE role = 'full_admin'
      AND disabled_at IS NULL;
$$;

REVOKE ALL ON FUNCTION
private.active_full_admin_count()
FROM PUBLIC, anon, authenticated;

-- =========================================================
-- 4. VERIFY FULL ADMIN ACTOR
-- =========================================================

CREATE OR REPLACE FUNCTION private.assert_active_full_admin(
    p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION
            'STAFF_ACTOR_REQUIRED: no administrator identity.'
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_profiles
        WHERE user_id = p_actor
          AND role = 'full_admin'
          AND disabled_at IS NULL
    ) THEN
        RAISE EXCEPTION
            'STAFF_FORBIDDEN: active Full Admin required.'
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION
private.assert_active_full_admin(uuid)
FROM PUBLIC, anon, authenticated;

-- =========================================================
-- 5. CREATE STAFF INVITATION
-- =========================================================

CREATE OR REPLACE FUNCTION public.staff_create_invitation(
    p_actor uuid,
    p_email text,
    p_role public.admin_role,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_email text := lower(btrim(coalesce(p_email, '')));
    v_invitation public.admin_invitations%ROWTYPE;
    v_status text;
BEGIN
    PERFORM private.staff_lock();
    PERFORM private.assert_active_full_admin(p_actor);

    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       OR char_length(v_email) > 254 THEN
        RAISE EXCEPTION
            'STAFF_INVALID_EMAIL: invalid invitation email.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_role IS NULL THEN
        RAISE EXCEPTION
            'STAFF_UNKNOWN_ROLE: administrator role required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.admin_profiles
        WHERE lower(email) = v_email
    ) THEN
        RAISE EXCEPTION
            'STAFF_ALREADY_ADMIN: address already has an administrator profile.'
            USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM auth.users
        WHERE lower(email) = v_email
    ) THEN
        RAISE EXCEPTION
            'STAFF_ACCOUNT_EXISTS: existing Auth account cannot be re-invited.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT status INTO v_status
    FROM public.admin_invitations
    WHERE lower(email) = v_email
      AND status IN ('pending', 'sent')
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'STAFF_INVITATION_EXISTS: outstanding invitation.'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.admin_invitations (
        email, role, status, invited_by, correlation_id
    )
    VALUES (
        v_email, p_role, 'pending', p_actor, p_correlation
    )
    RETURNING * INTO v_invitation;

    PERFORM private.insert_audit_event(
        p_actor,
        'staff.invited',
        'admin_invitation',
        v_invitation.id::text,
        NULL,
        jsonb_build_object(
            'email', v_email,
            'role', p_role,
            'status', 'pending'
        ),
        NULL,
        p_correlation
    );

    RETURN jsonb_build_object(
        'invitation_id', v_invitation.id,
        'email', v_invitation.email,
        'role', v_invitation.role,
        'status', v_invitation.status
    );
END;
$$;

-- =========================================================
-- 6. RECORD INVITATION DELIVERY RESULT
-- =========================================================

CREATE OR REPLACE FUNCTION public.staff_mark_invitation(
    p_actor uuid,
    p_invitation uuid,
    p_status text,
    p_auth_user_id uuid,
    p_failure_reason text,
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

    IF p_status IS NULL
       OR p_status NOT IN ('sent', 'failed') THEN
        RAISE EXCEPTION
            'STAFF_INVITATION_STATE: unsupported transition.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_invitation
    FROM public.admin_invitations
    WHERE id = p_invitation
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'STAFF_INVITATION_NOT_FOUND: invitation missing.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_invitation.status NOT IN ('pending', 'sent') THEN
        RAISE EXCEPTION
            'STAFF_INVITATION_STATE: invitation cannot be updated.'
            USING ERRCODE = 'P0001';
    END IF;

    v_previous := v_invitation.status;

    IF p_status = 'sent' THEN
        IF p_auth_user_id IS NULL
           OR NOT EXISTS (
               SELECT 1 FROM auth.users
               WHERE id = p_auth_user_id
                 AND lower(btrim(email)) = v_invitation.email
           ) THEN
            RAISE EXCEPTION
                'STAFF_EMAIL_MISMATCH: invited Auth account does not match.'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    UPDATE public.admin_invitations
    SET
        status = p_status,
        auth_user_id = coalesce(
            p_auth_user_id, auth_user_id
        ),
        sent_at = CASE
            WHEN p_status = 'sent' THEN now()
            ELSE sent_at
        END,
        failure_reason = CASE
            WHEN p_status = 'failed' THEN
                left(
                    coalesce(
                        p_failure_reason,
                        'Invitation could not be sent.'
                    ),
                    300
                )
            ELSE NULL
        END
    WHERE id = p_invitation
    RETURNING * INTO v_invitation;

    PERFORM private.insert_audit_event(
        p_actor,
        CASE
            WHEN p_status = 'sent'
                THEN 'staff.invitation_sent'
            ELSE 'staff.invitation_failed'
        END,
        'admin_invitation',
        p_invitation::text,
        jsonb_build_object('status', v_previous),
        jsonb_build_object('status', p_status),
        v_invitation.failure_reason,
        p_correlation
    );

    RETURN jsonb_build_object(
        'invitation_id', v_invitation.id,
        'email', v_invitation.email,
        'role', v_invitation.role,
        'status', v_invitation.status,
        'failure_reason', v_invitation.failure_reason
    );
END;
$$;

-- =========================================================
-- 7. ACCEPT INVITATION AND CREATE PROFILE
-- =========================================================

CREATE OR REPLACE FUNCTION public.staff_complete_invitation(
    p_invitation uuid,
    p_user_id uuid,
    p_email text,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_invitation public.admin_invitations%ROWTYPE;
    v_profile public.admin_profiles%ROWTYPE;
    v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
    PERFORM private.staff_lock();

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION
            'STAFF_ACTOR_REQUIRED: verified user required.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_invitation
    FROM public.admin_invitations
    WHERE id = p_invitation
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'STAFF_INVITATION_NOT_FOUND: invitation missing.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Never trust the supplied email alone.
    IF v_invitation.email <> v_email THEN
        RAISE EXCEPTION
            'STAFF_EMAIL_MISMATCH: invitation address differs.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Validate the real, confirmed Supabase Auth identity.
    IF NOT EXISTS (
        SELECT 1
        FROM auth.users
        WHERE id = p_user_id
          AND lower(btrim(email)) = v_invitation.email
          AND email_confirmed_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION
            'STAFF_EMAIL_MISMATCH: confirmed Auth identity does not match.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Prevent binding an invitation to another Auth user.
    IF v_invitation.auth_user_id IS NOT NULL
       AND v_invitation.auth_user_id <> p_user_id THEN
        RAISE EXCEPTION
            'STAFF_EMAIL_MISMATCH: invitation belongs to another Auth user.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_profile
    FROM public.admin_profiles
    WHERE user_id = p_user_id;

    -- Idempotent repeat for an already accepted invitation.
    IF v_invitation.status = 'accepted' THEN
        IF v_profile.user_id = p_user_id
           AND v_profile.email = v_invitation.email
           AND v_invitation.auth_user_id = p_user_id THEN
            RETURN jsonb_build_object(
                'status', 'accepted',
                'profile_role', v_profile.role,
                'profile_email', v_profile.email,
                'idempotent', true
            );
        END IF;

        RAISE EXCEPTION
            'STAFF_INVITATION_STATE: accepted invitation mismatch.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_invitation.status NOT IN ('pending', 'sent') THEN
        RAISE EXCEPTION
            'STAFF_INVITATION_STATE: invitation cannot be accepted.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Do not grant a role to an unrelated existing profile.
    IF v_profile.user_id IS NOT NULL THEN
        RAISE EXCEPTION
            'STAFF_ALREADY_ADMIN: profile already exists.'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.admin_profiles (
        user_id,
        role,
        display_name,
        created_by,
        email
    )
    VALUES (
        p_user_id,
        v_invitation.role,
        '',
        v_invitation.invited_by,
        v_invitation.email
    )
    RETURNING * INTO v_profile;

    PERFORM private.insert_audit_event(
        p_user_id,
        'staff.provisioned',
        'admin_profile',
        p_user_id::text,
        NULL,
        jsonb_build_object(
            'role', v_profile.role,
            'email', v_profile.email,
            'invitation_id', v_invitation.id
        ),
        'Invitation accepted; account provisioned.',
        p_correlation
    );

    UPDATE public.admin_invitations
    SET
        status = 'accepted',
        accepted_at = now(),
        auth_user_id = p_user_id,
        failure_reason = NULL
    WHERE id = p_invitation;

    PERFORM private.insert_audit_event(
        p_user_id,
        'staff.invitation_accepted',
        'admin_invitation',
        p_invitation::text,
        jsonb_build_object(
            'status', v_invitation.status
        ),
        jsonb_build_object(
            'status', 'accepted'
        ),
        NULL,
        p_correlation
    );

    RETURN jsonb_build_object(
        'status', 'accepted',
        'profile_role', v_profile.role,
        'profile_email', v_profile.email,
        'idempotent', false
    );
END;
$$;

-- =========================================================
-- 8. CHANGE ADMINISTRATOR ROLE
-- =========================================================

CREATE OR REPLACE FUNCTION public.staff_change_role(
    p_actor uuid,
    p_target uuid,
    p_role public.admin_role,
    p_expected_updated_at timestamptz,
    p_reason text,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target public.admin_profiles%ROWTYPE;
    v_previous_role public.admin_role;
    v_active boolean;
BEGIN
    PERFORM private.staff_lock();
    PERFORM private.assert_active_full_admin(p_actor);

    IF p_target IS NULL THEN
        RAISE EXCEPTION
            'STAFF_TARGET_REQUIRED: target account required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_target = p_actor THEN
        RAISE EXCEPTION
            'STAFF_SELF_CHANGE: cannot change own role.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_role IS NULL THEN
        RAISE EXCEPTION
            'STAFF_UNKNOWN_ROLE: valid role required.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_target
    FROM public.admin_profiles
    WHERE user_id = p_target
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'STAFF_TARGET_REQUIRED: administrator not found.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_expected_updated_at IS NOT NULL
       AND v_target.updated_at <> p_expected_updated_at THEN
        RAISE EXCEPTION
            'STAFF_CONFLICT: account was modified; reload.'
            USING ERRCODE = 'P0001';
    END IF;

    v_previous_role := v_target.role;
    v_active := v_target.disabled_at IS NULL;

    IF v_previous_role = p_role THEN
        RAISE EXCEPTION
            'STAFF_STATE_UNCHANGED: role already assigned.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Prevent removal of the last active Full Admin.
    IF v_active
       AND v_previous_role = 'full_admin'
       AND p_role <> 'full_admin'
       AND private.active_full_admin_count() <= 1 THEN
        RAISE EXCEPTION
            'STAFF_LAST_FULL_ADMIN: cannot demote the last Full Admin.'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.admin_profiles
    SET role = p_role
    WHERE user_id = p_target
    RETURNING * INTO v_target;

    PERFORM private.insert_audit_event(
        p_actor,
        'staff.role_changed',
        'admin_profile',
        p_target::text,
        jsonb_build_object(
            'role', v_previous_role,
            'active', v_active
        ),
        jsonb_build_object(
            'role', v_target.role,
            'active', v_target.disabled_at IS NULL
        ),
        left(
            nullif(btrim(coalesce(p_reason, '')), ''),
            500
        ),
        p_correlation
    );

    RETURN jsonb_build_object(
        'user_id', v_target.user_id,
        'previous_role', v_previous_role,
        'role', v_target.role,
        'disabled_at', v_target.disabled_at,
        'updated_at', v_target.updated_at
    );
END;
$$;

-- =========================================================
-- 9. SUSPEND OR RESTORE ADMINISTRATOR
-- =========================================================

CREATE OR REPLACE FUNCTION public.staff_set_disabled(
    p_actor uuid,
    p_target uuid,
    p_disabled boolean,
    p_expected_updated_at timestamptz,
    p_reason text,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target public.admin_profiles%ROWTYPE;
    v_was_disabled boolean;
BEGIN
    PERFORM private.staff_lock();
    PERFORM private.assert_active_full_admin(p_actor);

    IF p_target IS NULL THEN
        RAISE EXCEPTION
            'STAFF_TARGET_REQUIRED: target account required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_disabled IS NULL THEN
        RAISE EXCEPTION
            'STAFF_STATE_REQUIRED: suspension state required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_target = p_actor THEN
        RAISE EXCEPTION
            'STAFF_SELF_CHANGE: cannot suspend or restore own account.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_target
    FROM public.admin_profiles
    WHERE user_id = p_target
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'STAFF_TARGET_REQUIRED: administrator not found.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_expected_updated_at IS NOT NULL
       AND v_target.updated_at <> p_expected_updated_at THEN
        RAISE EXCEPTION
            'STAFF_CONFLICT: account was modified; reload.'
            USING ERRCODE = 'P0001';
    END IF;

    v_was_disabled := v_target.disabled_at IS NOT NULL;

    IF p_disabled = v_was_disabled THEN
        RAISE EXCEPTION
            'STAFF_STATE_UNCHANGED: account already in requested state.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Last active Full Admin cannot be suspended.
    IF p_disabled
       AND v_target.role = 'full_admin'
       AND private.active_full_admin_count() <= 1 THEN
        RAISE EXCEPTION
            'STAFF_LAST_FULL_ADMIN: cannot suspend the last Full Admin.'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.admin_profiles
    SET disabled_at = CASE
        WHEN p_disabled THEN now()
        ELSE NULL
    END
    WHERE user_id = p_target
    RETURNING * INTO v_target;

    PERFORM private.insert_audit_event(
        p_actor,
        CASE
            WHEN p_disabled THEN 'staff.suspended'
            ELSE 'staff.restored'
        END,
        'admin_profile',
        p_target::text,
        jsonb_build_object(
            'role', v_target.role,
            'active', NOT v_was_disabled
        ),
        jsonb_build_object(
            'role', v_target.role,
            'active', NOT p_disabled
        ),
        left(
            nullif(btrim(coalesce(p_reason, '')), ''),
            500
        ),
        p_correlation
    );

    RETURN jsonb_build_object(
        'user_id', v_target.user_id,
        'role', v_target.role,
        'disabled_at', v_target.disabled_at,
        'updated_at', v_target.updated_at
    );
END;
$$;

-- =========================================================
-- 10. FUNCTION EXECUTION PRIVILEGES
-- =========================================================

-- Remove default PUBLIC execution privileges.
-- These entry points are callable by the server-only
-- service_role, not directly by authenticated browsers.

REVOKE ALL ON FUNCTION
public.staff_create_invitation(
    uuid, text, public.admin_role, uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.staff_create_invitation(
    uuid, text, public.admin_role, uuid
)
TO service_role;

REVOKE ALL ON FUNCTION
public.staff_mark_invitation(
    uuid, uuid, text, uuid, text, uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.staff_mark_invitation(
    uuid, uuid, text, uuid, text, uuid
)
TO service_role;

REVOKE ALL ON FUNCTION
public.staff_complete_invitation(
    uuid, uuid, text, uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.staff_complete_invitation(
    uuid, uuid, text, uuid
)
TO service_role;

REVOKE ALL ON FUNCTION
public.staff_change_role(
    uuid, uuid, public.admin_role,
    timestamptz, text, uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.staff_change_role(
    uuid, uuid, public.admin_role,
    timestamptz, text, uuid
)
TO service_role;

REVOKE ALL ON FUNCTION
public.staff_set_disabled(
    uuid, uuid, boolean,
    timestamptz, text, uuid
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.staff_set_disabled(
    uuid, uuid, boolean,
    timestamptz, text, uuid
)
TO service_role;

-- Do not expose the private schema through Supabase API.
GRANT USAGE ON SCHEMA private TO service_role;

COMMIT;

-- =========================================================
-- 11. READ-ONLY VERIFICATION
-- =========================================================

-- All five public staff RPCs should appear.
SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc AS p
JOIN pg_namespace AS n
    ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'staff_%'
ORDER BY p.proname;

-- Check execution permissions on the role-change RPC.
-- Expected: false, false, true.
SELECT
    has_function_privilege(
        'anon',
        'public.staff_change_role(uuid,uuid,public.admin_role,timestamptz,text,uuid)',
        'EXECUTE'
    ) AS anon_can_execute,

    has_function_privilege(
        'authenticated',
        'public.staff_change_role(uuid,uuid,public.admin_role,timestamptz,text,uuid)',
        'EXECUTE'
    ) AS authenticated_can_execute,

    has_function_privilege(
        'service_role',
        'public.staff_change_role(uuid,uuid,public.admin_role,timestamptz,text,uuid)',
        'EXECUTE'
    ) AS service_role_can_execute;
