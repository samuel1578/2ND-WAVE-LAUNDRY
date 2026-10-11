-- Sprint 1A — change an existing administrator's role.
--
-- This is the ONLY supported way to change a provisioned role. Ordinary
-- provisioning (001/002) refuses to overwrite an existing profile, so a repeated
-- or mistaken run can never silently change who is a Full Admin.
--
-- Run deliberately, after review, in the Supabase SQL editor or with psql as a
-- project owner / trusted operator. There is no application endpoint that accepts
-- a role value, and no staff-management UI in this sprint.
--
-- Safety properties
-- * `target_user` and `new_role` start as NULL, so nothing runs accidentally.
-- * An explicit confirmation flag must be set.
-- * Exactly one user id (the primary key) is targeted, and the statement asserts
--   that exactly one row changed, so no other administrator can be affected.
-- * Setting the role it already holds is reported as a no-op instead of a change.
-- * Disabled administrators keep their role change but still resolve to no role
--   until restored (003_disable_restore_admin.sql).

do $$
declare
  -- REPLACE: '<auth-user-uid>'
  target_user uuid := null;
  -- REPLACE with 'full_admin' or 'operational_admin'.
  new_role public.admin_role := null;
  -- Set to true to authorise this one change.
  confirm_change boolean := false;
  current_role public.admin_role;
  affected integer;
begin
  if target_user is null then
    raise exception 'Refused: set target_user before running this statement.';
  end if;
  if new_role is null then
    raise exception 'Refused: set new_role to ''full_admin'' or ''operational_admin''.';
  end if;

  select ap.role into current_role
    from public.admin_profiles ap
   where ap.user_id = target_user;

  if not found then
    raise exception 'Refused: no administrator profile for %. Provision a new administrator with 001 or 002 first.', target_user;
  end if;

  if current_role = new_role then
    raise notice 'No change: % already has role %.', target_user, current_role;
    return;
  end if;

  if confirm_change is not true then
    raise exception 'Refused: set confirm_change := true to authorise changing % from % to %.',
      target_user, current_role, new_role;
  end if;

  update public.admin_profiles
     set role = new_role
   where user_id = target_user;
  get diagnostics affected = row_count;

  if affected <> 1 then
    raise exception 'Refused: expected exactly 1 row to change, % matched for %.', affected, target_user;
  end if;

  -- Sprint 1C: record the change so break-glass SQL is not the one privileged
  -- action missing from the audit history. Requires
  -- 20261011120100_audit_events.sql to be applied.
  insert into public.audit_events
    (actor_id, action, entity_type, entity_id, before_state, after_state, reason, correlation_id)
  values (
    auth.uid(),
    'staff.role_changed',
    'admin_profile',
    target_user::text,
    jsonb_build_object('role', current_role),
    jsonb_build_object('role', new_role),
    'Break-glass role change (supabase/bootstrap/004_change_admin_role.sql)',
    null
  );

  raise notice 'Administrator % changed from % to % and an audit event recorded.', target_user, current_role, new_role;
end $$;

-- Verification: expect the intended role for exactly one administrator.
select user_id, role, display_name, created_at, updated_at, disabled_at
from public.admin_profiles
order by created_at;
