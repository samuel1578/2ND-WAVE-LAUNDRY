-- 2ND WAVE — Booking compute maintenance
--
-- PURPOSE
--   Reduce avoidable database work from the shared booking rate limiter.
--   Rate-limit rows are temporary counters, not customer records. Keeping them
--   forever increases the size of the table and its index without improving
--   protection.
--
-- APPLY ORDER
--   1. Confirm that 20261011140000_booking_rate_limit.sql has already been
--      applied. This migration requires public.booking_rate_limits and its
--      existing primary key.
--   2. Apply this file once in the Supabase SQL editor or with the Supabase CLI.
--   3. Check the verification queries at the end of this file.
--   4. Configure the optional scheduler described below. Do not run the
--      scheduler statement unless pg_cron is enabled in the project.
--
-- SAFETY
--   * Only expired rate-limit counters are removed.
--   * No bookings, customer data, auth records, FAQ data, or gallery data are
--     changed.
--   * The cleanup function is executable only by service_role.
--   * This does not disable rate limiting or change its limits.
--
-- IMPORTANT EXPECTATION
--   The supplied pg_stat_statements report did not show a single runaway
--   application query. This migration removes accumulated limiter-state bloat,
--   but the Supabase dashboard warning may also reflect Auth, Studio/MCP, or
--   platform activity. Re-run the filtered pg_stat_statements report after
--   applying this migration.

BEGIN;

-- The original migration already creates this index. IF NOT EXISTS makes this
-- file safe when the target project has it under the expected name.
CREATE INDEX IF NOT EXISTS booking_rate_limits_window_idx
ON public.booking_rate_limits (window_start);

CREATE OR REPLACE FUNCTION public.booking_rate_limit_cleanup()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deleted bigint;
BEGIN
    -- Prevent two cleanup invocations from competing with one another.
    PERFORM pg_advisory_xact_lock(hashtext('booking_rate_limit_cleanup'));

    DELETE FROM public.booking_rate_limits
    WHERE window_start < now() - interval '2 hours';

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.booking_rate_limit_cleanup() IS
'Deletes fixed-window booking rate-limit counters older than two hours. Service-role-only maintenance operation.';

REVOKE ALL ON FUNCTION public.booking_rate_limit_cleanup()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.booking_rate_limit_cleanup()
TO service_role;

-- One initial cleanup is safe: these rows are expired abuse-protection
-- counters, not bookings or customer records.
SELECT public.booking_rate_limit_cleanup() AS deleted_expired_rate_limit_rows;

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================

-- Remaining counters should normally cover only the current and recent
-- fixed-window periods.
SELECT
    count(*) AS rate_limit_rows,
    min(window_start) AS oldest_window,
    max(window_start) AS newest_window,
    count(*) FILTER (
        WHERE window_start < now() - interval '2 hours'
    ) AS expired_rows_remaining
FROM public.booking_rate_limits;

-- Confirm the cleanup function is present and restricted to service_role.
SELECT
    p.oid::regprocedure AS function_name,
    has_function_privilege(
        'service_role',
        'public.booking_rate_limit_cleanup()',
        'EXECUTE'
    ) AS service_role_can_execute,
    has_function_privilege(
        'anon',
        'public.booking_rate_limit_cleanup()',
        'EXECUTE'
    ) AS anon_can_execute,
    has_function_privilege(
        'authenticated',
        'public.booking_rate_limit_cleanup()',
        'EXECUTE'
    ) AS authenticated_can_execute
FROM pg_proc AS p
WHERE p.oid = 'public.booking_rate_limit_cleanup()'::regprocedure;

-- Optional recurring cleanup:
--
-- If pg_cron is enabled, run this separately as a trusted database owner
-- (not as anon/authenticated). Choose one schedule, such as every 15 minutes:
--
-- SELECT cron.schedule(
--     'booking-rate-limit-cleanup',
--     '*/15 * * * *',
--     $$SELECT public.booking_rate_limit_cleanup();$$
-- );
--
-- If pg_cron is not enabled, invoke the function from a trusted server-side
-- maintenance job every 15–60 minutes:
--
-- SELECT public.booking_rate_limit_cleanup();
--
-- Do not run VACUUM inside the transaction above. If the verification query
-- shows that this table was already very large, run this separately during a
-- suitable maintenance window:
--
-- VACUUM (ANALYZE) public.booking_rate_limits;
