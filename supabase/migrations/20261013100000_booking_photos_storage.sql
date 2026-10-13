BEGIN;

-- Sprint 2C refinement: private customer-photo storage.
--
-- The booking_photos table (20261011130000_booking_schema.sql) already models
-- every metadata and retention rule; what was missing is the private object
-- store its `storage_key` column points at. This migration registers that
-- bucket with the same limits the table enforces:
--
--   * private (never public): this migration creates no storage.objects
--     policies. The verification query lists existing policies so the
--     operator can confirm none grants client access to this bucket; only the
--     server's elevated client (which bypasses RLS) should access its objects;
--   * 5 MB per object and the JPEG/PNG/WebP allow-list mirror the CHECK
--     constraints on public.booking_photos (enforced again on the bytes in
--     trusted server code before any object is stored);
--   * objects are written under `bookings/<booking-id>/<sha256>.<ext>` by the
--     server only; customers never choose a bucket or key.
--
-- Photo retention (90 days) is unchanged: the read policy on booking_photos
-- already withholds rows once due, and the admin image endpoint re-reads the
-- row under the caller's session before signing any URL.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'booking-photos',
    'booking-photos',
    false,
    5000000,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;

-- Read-only verification.
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'booking-photos';

-- Review existing storage.objects policies before enabling uploads. Supabase
-- policies are listed in pg_policies, not storage.policies. Check both the
-- policy expression and roles for any rule that could grant access to this
-- bucket; policies may be shared across buckets and therefore cannot be
-- safely counted by bucket_id alone.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
ORDER BY policyname;
