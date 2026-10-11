
BEGIN;

-- Sprint 1C: Administrator email column.
-- Requires the Sprint 1A admin_profiles table.

ALTER TABLE public.admin_profiles
ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN public.admin_profiles.email IS
'Administrator email address, normalised to lower case.
Maintained by trusted staff provisioning functions.';

-- Backfill emails for existing administrators.
UPDATE public.admin_profiles AS ap
SET email = lower(btrim(u.email))
FROM auth.users AS u
WHERE u.id = ap.user_id
  AND ap.email IS NULL
  AND u.email IS NOT NULL;

-- Index for administrator email lookups.
CREATE INDEX IF NOT EXISTS admin_profiles_email_idx
ON public.admin_profiles (lower(email))
WHERE email IS NOT NULL;

COMMIT;

-- Read-only verification.
SELECT user_id, role, display_name, email, disabled_at
FROM public.admin_profiles
ORDER BY created_at;
