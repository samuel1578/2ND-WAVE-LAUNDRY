-- 2ND WAVE — Sprint 2A
-- Row level security and least-privilege grants for the booking tables.
--
-- Requires 20261011130000_booking_schema.sql.
-- Apply before 20261011130200_booking_functions.sql.
--
-- Model:
--   * anonymous visitors receive no grant at all on booking data;
--   * an authenticated administrator (either role) may read booking data;
--   * no client role may insert, update or delete booking rows — every write goes
--     through the trusted functions in 20261011130200_booking_functions.sql;
--   * customer photos become unreadable once their retention date is due, even
--     though the deletion job is not activated in this sprint.
--
-- Both administrator roles have booking-management capability (PRD §7), so the
-- booking policies use `private.is_active_admin()` rather than a Full-Admin-only
-- helper. The Staff Management surface remains Full-Admin only through its own
-- `staff.manage` capability and Phase 1 policies.

BEGIN;

-- ============================================================
-- 1. ACTIVE ADMINISTRATOR HELPER
-- ============================================================

CREATE OR REPLACE FUNCTION private.is_active_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.admin_profiles AS ap
        WHERE ap.user_id = auth.uid()
          AND ap.disabled_at IS NULL
    );
$$;

COMMENT ON FUNCTION private.is_active_admin() IS
'True when the current authenticated user has an active administrator profile of either role. Read-only, search_path pinned, not exposed to the Data API.';

REVOKE ALL ON FUNCTION private.is_active_admin()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.is_active_admin()
TO authenticated;

GRANT USAGE ON SCHEMA private TO authenticated;

-- ============================================================
-- 2. ENABLE RLS AND REMOVE DEFAULT PRIVILEGES
-- ============================================================

DO $$
DECLARE
    v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'branches',
        'services',
        'branch_operating_hours',
        'branch_pickup_windows',
        'branch_pickup_exceptions',
        'booking_settings',
        'bookings',
        'booking_services',
        'booking_status_history',
        'booking_notes',
        'booking_photos'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_table);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', v_table);
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
    END LOOP;
END;
$$;

-- ============================================================
-- 3. POLICIES — REFERENCE AND CONFIGURATION
-- ============================================================

CREATE POLICY branches_select_active_admin
ON public.branches
FOR SELECT
TO authenticated
USING (private.is_active_admin());

CREATE POLICY services_select_active_admin
ON public.services
FOR SELECT
TO authenticated
USING (private.is_active_admin());

CREATE POLICY branch_operating_hours_select_active_admin
ON public.branch_operating_hours
FOR SELECT
TO authenticated
USING (private.is_active_admin());

CREATE POLICY branch_pickup_windows_select_active_admin
ON public.branch_pickup_windows
FOR SELECT
TO authenticated
USING (private.is_active_admin());

CREATE POLICY branch_pickup_exceptions_select_active_admin
ON public.branch_pickup_exceptions
FOR SELECT
TO authenticated
USING (private.is_active_admin());

CREATE POLICY booking_settings_select_active_admin
ON public.booking_settings
FOR SELECT
TO authenticated
USING (private.is_active_admin());

-- ============================================================
-- 4. POLICIES — BOOKING DATA
-- ============================================================

CREATE POLICY bookings_select_active_admin
ON public.bookings
FOR SELECT
TO authenticated
USING (private.is_active_admin());

CREATE POLICY booking_services_select_active_admin
ON public.booking_services
FOR SELECT
TO authenticated
USING (private.is_active_admin());

CREATE POLICY booking_status_history_select_active_admin
ON public.booking_status_history
FOR SELECT
TO authenticated
USING (private.is_active_admin());

CREATE POLICY booking_notes_select_active_admin
ON public.booking_notes
FOR SELECT
TO authenticated
USING (private.is_active_admin());

-- A photo is unreadable once its retention date is due, regardless of whether the
-- future deletion job has run.
CREATE POLICY booking_photos_select_active_admin
ON public.booking_photos
FOR SELECT
TO authenticated
USING (private.is_active_admin() AND delete_due_at > now());

-- No insert, update or delete policy exists for any booking table. With RLS
-- enabled the default is deny, so no client role can create or modify a booking,
-- forge an administrator actor, set a status or write an audit record.

COMMIT;

-- ============================================================
-- 5. READ-ONLY VERIFICATION
-- ============================================================

SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    count(p.polname) AS policies
FROM pg_class AS c
LEFT JOIN pg_policy AS p ON p.polrelid = c.oid
WHERE c.relname IN (
    'branches',
    'services',
    'branch_operating_hours',
    'branch_pickup_windows',
    'branch_pickup_exceptions',
    'booking_settings',
    'bookings',
    'booking_services',
    'booking_status_history',
    'booking_notes',
    'booking_photos'
)
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;

-- Expected: anon can read nothing; authenticated can read but not write.
SELECT
    has_table_privilege('anon', 'public.bookings', 'SELECT') AS anon_select,
    has_table_privilege('anon', 'public.bookings', 'INSERT') AS anon_insert,
    has_table_privilege('authenticated', 'public.bookings', 'SELECT') AS auth_select,
    has_table_privilege('authenticated', 'public.bookings', 'INSERT') AS auth_insert,
    has_table_privilege('authenticated', 'public.bookings', 'UPDATE') AS auth_update,
    has_table_privilege('authenticated', 'public.bookings', 'DELETE') AS auth_delete;
