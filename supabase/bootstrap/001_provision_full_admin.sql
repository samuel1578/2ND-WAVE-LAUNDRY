-- Sprint 1A — provision the FIRST Full Admin.
--
-- Run this manually, after review, in the Supabase SQL editor or with psql as a
-- project owner / trusted operator. It is deliberately not a migration, because
-- it needs a real auth user id that must never be committed to the repository.
--
-- Procedure
-- 1. In the Supabase dashboard: Authentication → Users → Add user (or Invite).
--    Use the administrator's own address. Never create a shared account.
-- 2. Copy that user's UID.
-- 3. In this file ONLY, set `target_user` to the UID and run the statement.
--    Do not save or commit the file with a real id in it.
-- 4. Confirm with the verification query at the bottom.
--
-- Safety properties
-- * `target_user` starts as NULL, so the statement cannot run accidentally and
--   cannot match an unrelated account.
-- * The target must already exist in auth.users.
-- * Repeated provisioning never overwrites an existing role: it raises instead.
--   Changing an existing role requires 004_change_admin_role.sql, run
--   deliberately.
-- * Nothing here creates an account, contains a password, promotes "whoever
--   logs in first", or is reachable from the application.
-- * `created_by` records auth.uid(). In the SQL editor there is no end-user JWT,
--   so it is stored as NULL; that is expected.

-- Sprint 1C: this statement now also writes an audit event. Apply
-- 20261011120100_audit_events.sql before running it. The event carries no
-- credential, only the role and the address of the account being provisioned.

do $$
declare
  -- REPLACE: '<auth-user-uid>' — keep NULL until you are ready to run it.
  target_user uuid := null;
  target_name text := '';
  existing_role public.admin_role;
  target_email text;
begin
  if target_user is null then
    raise exception 'Refused: set target_user to the Supabase Auth user id before running this statement.';
  end if;

  if not exists (select 1 from auth.users u where u.id = target_user) then
    raise exception 'Refused: no auth.users row for %. Create or invite the administrator first.', target_user;
  end if;

  select ap.role into existing_role
    from public.admin_profiles ap
   where ap.user_id = target_user;

  if found then
    raise exception 'Refused: % is already provisioned as %. Repeated provisioning never changes an existing role; use 004_change_admin_role.sql deliberately.',
      target_user, existing_role;
  end if;

  insert into public.admin_profiles (user_id, role, display_name, created_by)
  values (target_user, 'full_admin', nullif(btrim(target_name), ''), auth.uid());

  if not found then
    raise exception 'Refused: no administrator profile was created for %.', target_user;
  end if;

  select lower(u.email) into target_email from auth.users u where u.id = target_user;

  -- actor_id is NULL when run from the SQL editor, which has no end-user JWT: the
  -- audit row still records that a break-glass provisioning statement ran, and
  -- the reason names this file.
  insert into public.audit_events
    (actor_id, action, entity_type, entity_id, before_state, after_state, reason, correlation_id)
  values (
    auth.uid(),
    'staff.provisioned',
    'admin_profile',
    target_user::text,
    null,
    jsonb_build_object('role', 'full_admin', 'email', target_email),
    'Bootstrap provisioning (supabase/bootstrap/001_provision_full_admin.sql)',
    null
  );

  raise notice 'Provisioned % as full_admin and recorded an audit event.', target_user;
end $$;

-- Verification: expect exactly one row with role full_admin and disabled_at NULL.
select user_id, role, display_name, created_at, created_by, disabled_at
from public.admin_profiles
where role = 'full_admin' and disabled_at is null;
