-- Sprint 1A — provision an Operational Admin.
--
-- Same trusted procedure and safety properties as 001_provision_full_admin.sql.
-- Use this for staff who should reach bookings and review moderation only.
--
-- Operational Admins cannot enter the console in Sprint 1A: the existing
-- dashboard modules are demo data and are not yet role-scoped, so access is
-- conservatively withheld until Sprint 1B ships role-filtered routes. The role
-- is provisioned now so sessions and role resolution can be verified.
--
-- There is no staff-management UI in this sprint and no application endpoint
-- that accepts a role value.

-- Sprint 1C: this statement now also writes an audit event. Apply
-- 20261011120100_audit_events.sql before running it.

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
  values (target_user, 'operational_admin', nullif(btrim(target_name), ''), auth.uid());

  if not found then
    raise exception 'Refused: no administrator profile was created for %.', target_user;
  end if;

  select lower(u.email) into target_email from auth.users u where u.id = target_user;

  insert into public.audit_events
    (actor_id, action, entity_type, entity_id, before_state, after_state, reason, correlation_id)
  values (
    auth.uid(),
    'staff.provisioned',
    'admin_profile',
    target_user::text,
    null,
    jsonb_build_object('role', 'operational_admin', 'email', target_email),
    'Bootstrap provisioning (supabase/bootstrap/002_provision_operational_admin.sql)',
    null
  );

  raise notice 'Provisioned % as operational_admin and recorded an audit event.', target_user;
end $$;

-- Verification: expect one operational_admin row with disabled_at NULL.
select user_id, role, display_name, created_at, created_by, disabled_at
from public.admin_profiles
where role = 'operational_admin' and disabled_at is null;
