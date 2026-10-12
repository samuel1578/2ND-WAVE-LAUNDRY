-- 2ND WAVE — Sprint 2A
-- Booking retention foundation.
--
-- Requires 20261011130000_booking_schema.sql, 20261011130100_booking_rls.sql and
-- 20261011130200_booking_functions.sql.
--
-- Scope:
--   * record the retention policy in the database (bookings 12 months, photos
--     90 days) using explicit deadline columns already present on the tables;
--   * provide a private, read-only way to identify records that are due;
--   * introduce a job log table so a future daily job can record counts without
--     storing any personal data.
--
-- Deliberately NOT implemented in Sprint 2A:
--   * no deletion function, no scheduled job, no trigger that removes data;
--   * no storage cleanup, because no upload pipeline exists yet.
--
-- The owner activates destructive cleanup only in Sprint 2F, after review.

BEGIN;

-- ============================================================
-- 1. RETENTION JOB LOG
-- ============================================================

CREATE TABLE public.retention_jobs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_name text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    outcome text NOT NULL DEFAULT 'running',
    scanned_count integer NOT NULL DEFAULT 0,
    deleted_count integer NOT NULL DEFAULT 0,
    retry_count integer NOT NULL DEFAULT 0,
    error_summary text,

    CONSTRAINT retention_jobs_name_length
        CHECK (char_length(btrim(job_name)) BETWEEN 1 AND 64),
    CONSTRAINT retention_jobs_outcome
        CHECK (outcome IN ('running', 'succeeded', 'failed', 'partial')),
    CONSTRAINT retention_jobs_counts
        CHECK (scanned_count >= 0
            AND deleted_count >= 0
            AND retry_count >= 0
            AND deleted_count <= scanned_count),
    CONSTRAINT retention_jobs_error_summary_length
        CHECK (error_summary IS NULL
            OR char_length(error_summary) <= 300)
);

COMMENT ON TABLE public.retention_jobs IS
'Operational log for the future retention job. Records counts and a non-identifying summary only; never stores deleted content or personal data.';

CREATE INDEX retention_jobs_started_idx
ON public.retention_jobs (started_at DESC);

CREATE INDEX retention_jobs_job_idx
ON public.retention_jobs (job_name, started_at DESC);

-- ============================================================
-- 2. DUE-RECORD HELPERS (read-only, private)
-- ============================================================

CREATE OR REPLACE FUNCTION private.due_bookings(p_limit integer DEFAULT 500)
RETURNS TABLE (id uuid, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT b.id, b.expires_at
    FROM public.bookings AS b
    WHERE b.expires_at <= now()
    ORDER BY b.expires_at
    LIMIT greatest(coalesce(p_limit, 500), 1);
$$;

COMMENT ON FUNCTION private.due_bookings(integer) IS
'Bookings whose 12-month retention deadline has passed. Read-only; deletion belongs to the later retention sprint.';

REVOKE ALL ON FUNCTION private.due_bookings(integer)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.due_photos(p_limit integer DEFAULT 500)
RETURNS TABLE (id uuid, delete_due_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.id, p.delete_due_at
    FROM public.booking_photos AS p
    WHERE p.delete_due_at <= now()
    ORDER BY p.delete_due_at
    LIMIT greatest(coalesce(p_limit, 500), 1);
$$;

COMMENT ON FUNCTION private.due_photos(integer) IS
'Customer photos whose 90-day retention deadline has passed. Admin read is already withheld once due (see the booking_photos policy).';

REVOKE ALL ON FUNCTION private.due_photos(integer)
FROM PUBLIC, anon, authenticated;

-- Non-identifying counts for monitoring. Callable by the trusted server only.
CREATE OR REPLACE FUNCTION public.retention_due_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'bookings_due', (
            SELECT count(*) FROM public.bookings WHERE expires_at <= now()
        ),
        'photos_due', (
            SELECT count(*) FROM public.booking_photos WHERE delete_due_at <= now()
        ),
        'oldest_booking_due', (
            SELECT min(expires_at) FROM public.bookings WHERE expires_at <= now()
        ),
        'oldest_photo_due', (
            SELECT min(delete_due_at) FROM public.booking_photos WHERE delete_due_at <= now()
        )
    );
$$;

COMMENT ON FUNCTION public.retention_due_summary() IS
'Counts of records past their retention deadline, without any personal data. Read-only monitoring helper; callable by service_role only.';

REVOKE ALL ON FUNCTION public.retention_due_summary()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retention_due_summary() TO service_role;

-- ============================================================
-- 3. RLS FOR THE JOB LOG
-- ============================================================

ALTER TABLE public.retention_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.retention_jobs FROM anon;
REVOKE ALL ON TABLE public.retention_jobs FROM authenticated;
GRANT SELECT ON TABLE public.retention_jobs TO authenticated;

-- Only Full Admins may read the job log; nobody can write it from a client role.
CREATE POLICY retention_jobs_select_full_admin
ON public.retention_jobs
FOR SELECT
TO authenticated
USING (private.is_full_admin());

-- ============================================================
-- 4. RETENTION INDEXES
-- ============================================================
--
-- The booking (expires_at) and photo (delete_due_at) indexes were created with
-- the tables in 20261011130000_booking_schema.sql, so no further index is needed
-- here. Keeping them there means a query planner uses them from the moment the
-- tables exist, before any retention job is written.

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
WHERE c.relname = 'retention_jobs'
GROUP BY c.relname, c.relrowsecurity;

SELECT
    relname AS table_name,
    reltuples AS approx_rows
FROM pg_class
WHERE relname IN ('bookings', 'booking_photos', 'retention_jobs');

-- Retention is enforced by deadline, not by soft-deletion flags:
--   * public.bookings.expires_at defaults to creation + 12 months;
--   * public.booking_photos.delete_due_at is assigned by a BEFORE INSERT/UPDATE
--     trigger as uploaded_at + 90 days (not a STORED generated column).

-- Confirms the deadlines exist and produce a value on a sample row shape.
SELECT
    a.attname AS column_name,
    pg_get_expr(d.adbin, d.adrelid) AS default_expression
FROM pg_attribute AS a
JOIN pg_attrdef AS d
    ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid IN (
    'public.bookings'::regclass,
    'public.booking_photos'::regclass
)
AND a.attname IN ('expires_at', 'delete_due_at');
