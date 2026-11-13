-- 2ND WAVE — Booking photo retention (90-day deletion)
--
-- Requires 20261011130000_booking_schema.sql (public.booking_photos and its
-- delete_due_at trigger), 20261011120300_admin_staff_functions.sql
-- (private.insert_audit_event) and 20261011130300_booking_retention.sql
-- (public.retention_jobs).
--
-- Scope:
--   * service_role-only helpers used by the protected route
--     /api/internal/retention/photos (src/lib/retention/booking-photos.ts);
--   * the route removes Storage objects through the Storage API first, then
--     calls retention_photos_delete for the rows whose objects are gone;
--   * an orphan sweep lists booking-photos objects older than 24 hours that no
--     booking_photos row references.
--
-- Deliberately NOT implemented here:
--   * no deletion of storage.objects rows from SQL (that would not remove the
--     underlying file);
--   * no booking (12-month) retention;
--   * no scheduler: the Vercel cron in vercel.json invokes the route.
--
-- Safe to re-run: every object uses CREATE OR REPLACE.

BEGIN;

-- ============================================================
-- 1. JOB START
-- ============================================================

CREATE OR REPLACE FUNCTION public.retention_job_start(p_job_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name text := btrim(coalesce(p_job_name, ''));
    v_id bigint;
BEGIN
    IF char_length(v_name) < 1 OR char_length(v_name) > 64 THEN
        RAISE EXCEPTION
            'RETENTION_JOB_NAME: the job name must be 1 to 64 characters.'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.retention_jobs (job_name, outcome)
    VALUES (v_name, 'running')
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.retention_job_start(text) IS
'Opens a retention_jobs row in the running state and returns its id. Service-role only.';

REVOKE ALL ON FUNCTION public.retention_job_start(text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retention_job_start(text) TO service_role;

-- ============================================================
-- 2. DUE PHOTOS
-- ============================================================
--
-- private.due_photos(limit) returns (id, delete_due_at) without the storage key,
-- so this function queries the table directly.

CREATE OR REPLACE FUNCTION public.retention_due_photos(p_limit integer)
RETURNS TABLE (id uuid, storage_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
BEGIN
    RETURN QUERY
    SELECT p.id, p.storage_key
    FROM public.booking_photos AS p
    WHERE p.delete_due_at <= now()
    ORDER BY p.delete_due_at, p.id
    LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.retention_due_photos(integer) IS
'Booking photos whose 90-day deadline has passed, oldest first, with their Storage keys. Limit clamped to 1..200. Service-role only.';

REVOKE ALL ON FUNCTION public.retention_due_photos(integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retention_due_photos(integer) TO service_role;

-- ============================================================
-- 3. DELETE DUE PHOTO ROWS
-- ============================================================
--
-- Called only after the Storage objects were removed. The deadline is checked
-- again here so a caller can never delete a photo before it is due.

CREATE OR REPLACE FUNCTION public.retention_photos_delete(
    p_job_id bigint,
    p_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count integer := 0;
BEGIN
    IF p_job_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.retention_jobs AS j
        WHERE j.id = p_job_id AND j.outcome = 'running'
    ) THEN
        RAISE EXCEPTION
            'RETENTION_JOB_NOT_RUNNING: a running retention job is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
        RETURN 0;
    END IF;

    IF cardinality(p_ids) > 200 THEN
        RAISE EXCEPTION
            'RETENTION_BATCH_TOO_LARGE: at most 200 photos per call.'
            USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.booking_photos AS p
    WHERE p.id = ANY (p_ids)
      AND p.delete_due_at <= now();

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
        PERFORM private.insert_audit_event(
            NULL,
            'retention.booking_photos_deleted',
            'retention_job',
            p_job_id::text,
            NULL,
            jsonb_build_object('count', v_count),
            NULL,
            NULL
        );
    END IF;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.retention_photos_delete(bigint, uuid[]) IS
'Deletes booking_photos rows from the given ids that are past delete_due_at (re-checked here) and writes one aggregate audit event (count only). Service-role only.';

REVOKE ALL ON FUNCTION public.retention_photos_delete(bigint, uuid[])
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retention_photos_delete(bigint, uuid[]) TO service_role;

-- ============================================================
-- 4. ORPHAN STORAGE OBJECTS
-- ============================================================
--
-- booking_photos.storage_key is the object name inside the bucket
-- ("bookings/<booking id>/<sha256>.<ext>", src/lib/bookings/photos.ts), with no
-- bucket prefix, so it is compared with storage.objects.name directly. Objects
-- younger than 24 hours are skipped so an upload that has not yet written its
-- row is never treated as an orphan.

CREATE OR REPLACE FUNCTION public.retention_orphan_photo_objects(p_limit integer)
RETURNS TABLE (name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
BEGIN
    RETURN QUERY
    SELECT o.name
    FROM storage.objects AS o
    WHERE o.bucket_id = 'booking-photos'
      AND o.created_at < now() - interval '24 hours'
      AND NOT EXISTS (
          SELECT 1
          FROM public.booking_photos AS p
          WHERE p.storage_key = o.name
      )
    ORDER BY o.created_at, o.name
    LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.retention_orphan_photo_objects(integer) IS
'booking-photos Storage objects older than 24 hours that no booking_photos row references. Limit clamped to 1..500. Service-role only; deletion happens through the Storage API.';

REVOKE ALL ON FUNCTION public.retention_orphan_photo_objects(integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retention_orphan_photo_objects(integer) TO service_role;

-- ============================================================
-- 5. AUDIT THE ORPHAN SWEEP
-- ============================================================

CREATE OR REPLACE FUNCTION public.retention_orphans_deleted(
    p_job_id bigint,
    p_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_job_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.retention_jobs AS j
        WHERE j.id = p_job_id AND j.outcome = 'running'
    ) THEN
        RAISE EXCEPTION
            'RETENTION_JOB_NOT_RUNNING: a running retention job is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF coalesce(p_count, 0) <= 0 THEN
        RETURN;
    END IF;

    PERFORM private.insert_audit_event(
        NULL,
        'retention.booking_photo_objects_deleted',
        'retention_job',
        p_job_id::text,
        NULL,
        jsonb_build_object('count', p_count),
        NULL,
        NULL
    );
END;
$$;

COMMENT ON FUNCTION public.retention_orphans_deleted(bigint, integer) IS
'Records one aggregate audit event (count only) for orphaned booking-photos objects removed through the Storage API. Service-role only.';

REVOKE ALL ON FUNCTION public.retention_orphans_deleted(bigint, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retention_orphans_deleted(bigint, integer) TO service_role;

-- ============================================================
-- 6. JOB FINISH
-- ============================================================

CREATE OR REPLACE FUNCTION public.retention_job_finish(
    p_job_id bigint,
    p_outcome text,
    p_scanned integer,
    p_deleted integer,
    p_retry integer,
    p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deleted integer := greatest(coalesce(p_deleted, 0), 0);
    -- The table CHECK requires deleted_count <= scanned_count.
    v_scanned integer := greatest(coalesce(p_scanned, 0), v_deleted, 0);
    v_retry integer := greatest(coalesce(p_retry, 0), 0);
    v_error text := nullif(
        left(btrim(regexp_replace(coalesce(p_error, ''), '[\r\n\t]+', ' ', 'g')), 300),
        ''
    );
BEGIN
    IF p_outcome IS NULL OR p_outcome NOT IN ('succeeded', 'failed', 'partial') THEN
        RAISE EXCEPTION
            'RETENTION_OUTCOME: the outcome must be succeeded, failed or partial.'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.retention_jobs AS j
    SET
        finished_at = now(),
        outcome = p_outcome,
        scanned_count = v_scanned,
        deleted_count = v_deleted,
        retry_count = v_retry,
        error_summary = v_error
    WHERE j.id = p_job_id
      AND j.outcome = 'running';

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'RETENTION_JOB_NOT_RUNNING: a running retention job is required.'
            USING ERRCODE = 'P0001';
    END IF;
END;
$$;

COMMENT ON FUNCTION public.retention_job_finish(bigint, text, integer, integer, integer, text) IS
'Closes a running retention_jobs row with its outcome and counts. scanned is raised to at least deleted; the error summary is single-line and at most 300 characters. Service-role only.';

REVOKE ALL ON FUNCTION public.retention_job_finish(bigint, text, integer, integer, integer, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retention_job_finish(bigint, text, integer, integer, integer, text)
TO service_role;

COMMIT;
