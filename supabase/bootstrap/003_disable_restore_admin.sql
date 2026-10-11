-- Sprint 1A — disable or restore an administrator.
--
-- Disabling keeps the profile row (and its history) but removes all access:
-- private.current_admin_role() and private.is_full_admin() ignore disabled rows,
-- so the administrator resolves to no role and every privileged operation fails
-- closed.
--
-- Prefer disabling over deleting. There is no delete path through the
-- application and public.admin_profiles.user_id references auth.users with
-- ON DELETE RESTRICT.
--
-- Safety properties
-- * `target_user` starts as NULL, so nothing runs accidentally.
-- * An explicit confirmation flag must be set for each operation.
-- * Each statement targets exactly one user id (the primary key) and asserts
--   that exactly one row changed, so no other administrator can be affected.
-- * A no-op raises instead of silently reporting success.
--
-- Run each block separately, in the Supabase SQL editor or with psql as a
-- project owner / trusted operator.

-- ---------------------------------------------------------------------------
-- Disable
-- ---------------------------------------------------------------------------

-- Sprint 1C: each block now also writes an audit event. Apply
-- 20261011120100_audit_events.sql before running them.

do $$
declare
  -- REPLACE: '<auth-user-uid>'
  target_user uuid := null;
  -- Set to true to authorise this one change.
  confirm_disable boolean := false;
  affected integer;
  current_role public.admin_role;
begin
  if target_user is null then
    raise exception 'Refused: set target_user before running this statement.';
  end if;
  if confirm_disable is not true then
    raise exception 'Refused: set confirm_disable := true to authorise disabling this administrator.';
  end if;

  update public.admin_profiles
     set disabled_at = now()
   where user_id = target_user
     and disabled_at is null;
  get diagnostics affected = row_count;

  if affected <> 1 then
    raise exception 'Refused: expected to disable exactly 1 profile, % row(s) matched for %.', affected, target_user;
  end if;

  select ap.role into current_role from public.admin_profiles ap where ap.user_id = target_user;

  insert into public.audit_events
    (actor_id, action, entity_type, entity_id, before_state, after_state, reason, correlation_id)
  values (
    auth.uid(),
    'staff.suspended',
    'admin_profile',
    target_user::text,
    jsonb_build_object('role', current_role, 'active', true),
    jsonb_build_object('role', current_role, 'active', false),
    'Break-glass suspension (supabase/bootstrap/003_disable_restore_admin.sql)',
    null
  );

  raise notice 'Administrator % disabled and an audit event recorded.', target_user;
end $$;

-- ---------------------------------------------------------------------------
-- Restore
-- ---------------------------------------------------------------------------

do $$
declare
  -- REPLACE: '<auth-user-uid>'
  target_user uuid := null;
  -- Set to true to authorise this one change.
  confirm_restore boolean := false;
  affected integer;
  current_role public.admin_role;
begin
  if target_user is null then
    raise exception 'Refused: set target_user before running this statement.';
  end if;
  if confirm_restore is not true then
    raise exception 'Refused: set confirm_restore := true to authorise restoring this administrator.';
  end if;

  update public.admin_profiles
     set disabled_at = null
   where user_id = target_user
     and disabled_at is not null;
  get diagnostics affected = row_count;

  if affected <> 1 then
    raise exception 'Refused: expected to restore exactly 1 profile, % row(s) matched for %.', affected, target_user;
  end if;

  select ap.role into current_role from public.admin_profiles ap where ap.user_id = target_user;

  insert into public.audit_events
    (actor_id, action, entity_type, entity_id, before_state, after_state, reason, correlation_id)
  values (
    auth.uid(),
    'staff.restored',
    'admin_profile',
    target_user::text,
    jsonb_build_object('role', current_role, 'active', false),
    jsonb_build_object('role', current_role, 'active', true),
    'Break-glass restoration (supabase/bootstrap/003_disable_restore_admin.sql)',
    null
  );

  raise notice 'Administrator % restored and an audit event recorded.', target_user;
end $$;

-- Verification: expect one row per provisioned administrator.
select user_id, role, display_name, created_at, disabled_at
from public.admin_profiles
order by created_at;
