-- 2ND WAVE — Branch pickup schedule administration
--
-- Requires 20261011130000_booking_schema.sql (branches, branch_pickup_windows,
-- branch_pickup_exceptions), 20261011130200_booking_functions.sql
-- (private.pickup_window), 20261011120300_admin_staff_functions.sql
-- (private.insert_audit_event) and 20261028100000_phase6_website_content.sql
-- (website_branch_update, whose error style these functions follow).
--
-- Scope:
--   * Full Admins can save a branch's weekly pickup windows and add, change or
--     remove date-specific closures / special hours from the Locations editor;
--   * every write re-checks the actor, locks the branch row, applies optimistic
--     concurrency on branches.version (bumped on success) and writes one audit
--     event;
--   * branch_effective_pickup_window exposes the window the database enforces at
--     arrangement / confirmation time (exception -> weekly -> booking_settings),
--     so the booking detail hint matches it.
--
-- Not changed: private.pickup_window, private.assert_pickup_window,
-- booking submission rules, branch_operating_hours (unused).
--
-- Errors (same style as website_branch_update):
--   CONTENT_FORBIDDEN (42501), CONTENT_CONFLICT (40001),
--   CONTENT_INVALID (22023), CONTENT_NOT_FOUND (P0002).
--
-- Safe to re-run: every function uses CREATE OR REPLACE.

BEGIN;

-- ============================================================
-- 1. WEEKLY PICKUP WINDOWS
-- ============================================================

CREATE OR REPLACE FUNCTION public.branch_pickup_windows_save(
    p_actor uuid,
    p_branch uuid,
    p_expected_version integer,
    p_windows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_branch public.branches%ROWTYPE;
    v_item jsonb;
    v_weekday integer;
    v_opens time;
    v_closes time;
    v_closed boolean;
    v_seen integer[] := ARRAY[]::integer[];
    v_before jsonb;
    v_after jsonb;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.admin_profiles AS a
        WHERE a.user_id = p_actor AND a.role = 'full_admin' AND a.disabled_at IS NULL
    ) THEN
        RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_branch FROM public.branches AS b WHERE b.id = p_branch FOR UPDATE;
    IF NOT FOUND OR v_branch.version <> p_expected_version THEN
        RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = '40001';
    END IF;

    IF p_windows IS NULL
       OR jsonb_typeof(p_windows) <> 'array'
       OR jsonb_array_length(p_windows) <> 7 THEN
        RAISE EXCEPTION 'CONTENT_INVALID: exactly seven weekday windows are required.'
            USING ERRCODE = '22023';
    END IF;

    -- Validate every element before writing anything.
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_windows) LOOP
        -- An AND chain tested with IS NOT TRUE: a missing key yields NULL and is
        -- rejected rather than silently passing.
        IF (
            jsonb_typeof(v_item) = 'object'
            AND jsonb_typeof(v_item -> 'weekday') = 'number'
            AND jsonb_typeof(v_item -> 'is_closed') = 'boolean'
            AND jsonb_typeof(v_item -> 'opens') = 'string'
            AND jsonb_typeof(v_item -> 'closes') = 'string'
            AND (v_item ->> 'weekday') ~ '^[1-7]$'
            AND (v_item ->> 'opens') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            AND (v_item ->> 'closes') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        ) IS NOT TRUE THEN
            RAISE EXCEPTION 'CONTENT_INVALID: each window needs weekday 1-7, is_closed and HH:MM opens/closes.'
                USING ERRCODE = '22023';
        END IF;

        v_weekday := (v_item ->> 'weekday')::integer;
        IF v_weekday = ANY (v_seen) THEN
            RAISE EXCEPTION 'CONTENT_INVALID: each weekday may appear only once.'
                USING ERRCODE = '22023';
        END IF;
        v_seen := v_seen || v_weekday;

        IF NOT (v_item ->> 'is_closed')::boolean
           AND (v_item ->> 'opens')::time >= (v_item ->> 'closes')::time THEN
            RAISE EXCEPTION 'CONTENT_INVALID: opening time must be before closing time.'
                USING ERRCODE = '22023';
        END IF;
    END LOOP;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'weekday', w.weekday,
               'is_closed', w.is_closed,
               'opens', to_char(w.opens, 'HH24:MI'),
               'closes', to_char(w.closes, 'HH24:MI')
           ) ORDER BY w.weekday), '[]'::jsonb)
    INTO v_before
    FROM public.branch_pickup_windows AS w
    WHERE w.branch_id = p_branch;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_windows) LOOP
        v_weekday := (v_item ->> 'weekday')::integer;
        v_closed := (v_item ->> 'is_closed')::boolean;
        v_opens := (v_item ->> 'opens')::time;
        v_closes := (v_item ->> 'closes')::time;

        INSERT INTO public.branch_pickup_windows (branch_id, weekday, opens, closes, is_closed)
        VALUES (p_branch, v_weekday, v_opens, v_closes, v_closed)
        ON CONFLICT (branch_id, weekday) DO UPDATE
        SET opens = EXCLUDED.opens,
            closes = EXCLUDED.closes,
            is_closed = EXCLUDED.is_closed;
    END LOOP;

    UPDATE public.branches AS b
    SET version = b.version + 1
    WHERE b.id = p_branch
    RETURNING * INTO v_branch;

    SELECT jsonb_agg(jsonb_build_object(
               'weekday', w.weekday,
               'is_closed', w.is_closed,
               'opens', to_char(w.opens, 'HH24:MI'),
               'closes', to_char(w.closes, 'HH24:MI')
           ) ORDER BY w.weekday)
    INTO v_after
    FROM public.branch_pickup_windows AS w
    WHERE w.branch_id = p_branch;

    PERFORM private.insert_audit_event(
        p_actor,
        'branch.pickup_windows_updated',
        'branch',
        p_branch::text,
        jsonb_build_object('windows', v_before),
        jsonb_build_object('windows', v_after, 'version', v_branch.version),
        NULL,
        NULL
    );

    RETURN jsonb_build_object(
        'branch_id', p_branch,
        'version', v_branch.version,
        'windows', v_after
    );
END;
$$;

COMMENT ON FUNCTION public.branch_pickup_windows_save(uuid, uuid, integer, jsonb) IS
'Full Admin only. Replaces a branch''s seven weekly pickup windows atomically, bumps branches.version (optimistic concurrency) and audits before/after windows.';

REVOKE ALL ON FUNCTION public.branch_pickup_windows_save(uuid, uuid, integer, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.branch_pickup_windows_save(uuid, uuid, integer, jsonb)
TO service_role;

-- ============================================================
-- 2. CLOSURES AND SPECIAL HOURS (EXCEPTIONS)
-- ============================================================

CREATE OR REPLACE FUNCTION public.branch_pickup_exception_upsert(
    p_actor uuid,
    p_branch uuid,
    p_expected_version integer,
    p_date date,
    p_is_closed boolean,
    p_opens time,
    p_closes time,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_branch public.branches%ROWTYPE;
    v_today date := (now() AT TIME ZONE 'Africa/Accra')::date;
    v_reason text := btrim(coalesce(p_reason, ''));
    v_existing public.branch_pickup_exceptions%ROWTYPE;
    v_before jsonb;
    v_saved public.branch_pickup_exceptions%ROWTYPE;
    v_after jsonb;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.admin_profiles AS a
        WHERE a.user_id = p_actor AND a.role = 'full_admin' AND a.disabled_at IS NULL
    ) THEN
        RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_branch FROM public.branches AS b WHERE b.id = p_branch FOR UPDATE;
    IF NOT FOUND OR v_branch.version <> p_expected_version THEN
        RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = '40001';
    END IF;

    IF p_date IS NULL OR p_date < v_today THEN
        RAISE EXCEPTION 'CONTENT_INVALID: the date must be today or later (Africa/Accra).'
            USING ERRCODE = '22023';
    END IF;

    IF p_is_closed IS NULL THEN
        RAISE EXCEPTION 'CONTENT_INVALID: choose closed or special hours.'
            USING ERRCODE = '22023';
    END IF;

    IF NOT p_is_closed AND (p_opens IS NULL OR p_closes IS NULL OR p_opens >= p_closes) THEN
        RAISE EXCEPTION 'CONTENT_INVALID: special hours need an opening time before the closing time.'
            USING ERRCODE = '22023';
    END IF;

    IF char_length(v_reason) > 200 THEN
        RAISE EXCEPTION 'CONTENT_INVALID: the reason must be 200 characters or fewer.'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_existing
    FROM public.branch_pickup_exceptions AS e
    WHERE e.branch_id = p_branch AND e.exception_date = p_date;

    v_before := CASE WHEN v_existing.id IS NULL THEN NULL ELSE jsonb_build_object(
        'date', v_existing.exception_date,
        'is_closed', v_existing.is_closed,
        'opens', to_char(v_existing.opens, 'HH24:MI'),
        'closes', to_char(v_existing.closes, 'HH24:MI'),
        'reason', v_existing.reason
    ) END;

    INSERT INTO public.branch_pickup_exceptions (
        branch_id, exception_date, opens, closes, is_closed, reason
    )
    VALUES (
        p_branch,
        p_date,
        CASE WHEN p_is_closed THEN NULL ELSE p_opens END,
        CASE WHEN p_is_closed THEN NULL ELSE p_closes END,
        p_is_closed,
        v_reason
    )
    ON CONFLICT (branch_id, exception_date) DO UPDATE
    SET opens = EXCLUDED.opens,
        closes = EXCLUDED.closes,
        is_closed = EXCLUDED.is_closed,
        reason = EXCLUDED.reason
    RETURNING * INTO v_saved;

    UPDATE public.branches AS b
    SET version = b.version + 1
    WHERE b.id = p_branch
    RETURNING * INTO v_branch;

    v_after := jsonb_build_object(
        'date', v_saved.exception_date,
        'is_closed', v_saved.is_closed,
        'opens', to_char(v_saved.opens, 'HH24:MI'),
        'closes', to_char(v_saved.closes, 'HH24:MI'),
        'reason', v_saved.reason
    );

    PERFORM private.insert_audit_event(
        p_actor,
        'branch.pickup_exception_saved',
        'branch',
        p_branch::text,
        v_before,
        v_after || jsonb_build_object('version', v_branch.version),
        NULL,
        NULL
    );

    RETURN jsonb_build_object(
        'branch_id', p_branch,
        'version', v_branch.version,
        'exception', v_after
    );
END;
$$;

COMMENT ON FUNCTION public.branch_pickup_exception_upsert(uuid, uuid, integer, date, boolean, time, time, text) IS
'Full Admin only. Adds or replaces a branch closure / special-hours entry for a date today or later (Africa/Accra), bumps branches.version and audits the change.';

REVOKE ALL ON FUNCTION public.branch_pickup_exception_upsert(uuid, uuid, integer, date, boolean, time, time, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.branch_pickup_exception_upsert(uuid, uuid, integer, date, boolean, time, time, text)
TO service_role;

CREATE OR REPLACE FUNCTION public.branch_pickup_exception_delete(
    p_actor uuid,
    p_branch uuid,
    p_expected_version integer,
    p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_branch public.branches%ROWTYPE;
    v_deleted public.branch_pickup_exceptions%ROWTYPE;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.admin_profiles AS a
        WHERE a.user_id = p_actor AND a.role = 'full_admin' AND a.disabled_at IS NULL
    ) THEN
        RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_branch FROM public.branches AS b WHERE b.id = p_branch FOR UPDATE;
    IF NOT FOUND OR v_branch.version <> p_expected_version THEN
        RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = '40001';
    END IF;

    DELETE FROM public.branch_pickup_exceptions AS e
    WHERE e.branch_id = p_branch AND e.exception_date = p_date
    RETURNING * INTO v_deleted;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CONTENT_NOT_FOUND: no closure or special hours exist for that date.'
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.branches AS b
    SET version = b.version + 1
    WHERE b.id = p_branch
    RETURNING * INTO v_branch;

    PERFORM private.insert_audit_event(
        p_actor,
        'branch.pickup_exception_deleted',
        'branch',
        p_branch::text,
        jsonb_build_object(
            'date', v_deleted.exception_date,
            'is_closed', v_deleted.is_closed,
            'opens', to_char(v_deleted.opens, 'HH24:MI'),
            'closes', to_char(v_deleted.closes, 'HH24:MI'),
            'reason', v_deleted.reason
        ),
        jsonb_build_object('version', v_branch.version),
        NULL,
        NULL
    );

    RETURN jsonb_build_object(
        'branch_id', p_branch,
        'version', v_branch.version,
        'date', p_date
    );
END;
$$;

COMMENT ON FUNCTION public.branch_pickup_exception_delete(uuid, uuid, integer, date) IS
'Full Admin only. Removes a branch closure / special-hours entry, bumps branches.version and audits the removed values.';

REVOKE ALL ON FUNCTION public.branch_pickup_exception_delete(uuid, uuid, integer, date)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.branch_pickup_exception_delete(uuid, uuid, integer, date)
TO service_role;

-- ============================================================
-- 3. EFFECTIVE WINDOW (READ)
-- ============================================================
--
-- Thin wrapper over private.pickup_window (the function the arrangement and
-- confirmation checks use), adding which rule supplied the window.

CREATE OR REPLACE FUNCTION public.branch_effective_pickup_window(
    p_branch uuid,
    p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_window record;
    v_source text;
BEGIN
    IF p_date IS NULL THEN
        RAISE EXCEPTION 'CONTENT_INVALID: a date is required.' USING ERRCODE = '22023';
    END IF;

    IF p_branch IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.branch_pickup_exceptions AS e
        WHERE e.branch_id = p_branch AND e.exception_date = p_date
    ) THEN
        v_source := 'exception';
    ELSIF p_branch IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.branch_pickup_windows AS w
        WHERE w.branch_id = p_branch
          AND w.weekday = extract(isodow FROM p_date)::smallint
    ) THEN
        v_source := 'weekly';
    ELSE
        v_source := 'settings';
    END IF;

    SELECT * INTO v_window FROM private.pickup_window(p_branch, p_date);

    RETURN jsonb_build_object(
        'opens', to_char(v_window.opens, 'HH24:MI'),
        'closes', to_char(v_window.closes, 'HH24:MI'),
        'is_closed', coalesce(v_window.is_closed, false),
        'source', v_source
    );
END;
$$;

COMMENT ON FUNCTION public.branch_effective_pickup_window(uuid, date) IS
'Service-role only. The pickup window the database enforces for a branch and date (exception -> weekly -> booking_settings) with its source, for the booking detail hint.';

REVOKE ALL ON FUNCTION public.branch_effective_pickup_window(uuid, date)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.branch_effective_pickup_window(uuid, date)
TO service_role;

COMMIT;
