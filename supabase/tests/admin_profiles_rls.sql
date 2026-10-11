-- Sprint 1A — database-level checks for the admin_profiles privileges and policies.
--
-- STATUS: NOT EXECUTED. No local Postgres or Supabase CLI was available, and the
-- migrations have not been applied to the hosted project. Do not report these as
-- passing until they have actually been run.
--
-- How to run (disposable database only — never production, and never
-- `supabase db reset` against the hosted project):
--   supabase db reset                       # local stack, or a temporary branch
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_profiles_rls.sql
--
-- Design notes
-- * Every probe runs inside its own nested BEGIN … EXCEPTION block that only
--   records a boolean. All assertions are raised OUTSIDE that block, so a
--   deliberate test failure can never be swallowed by the handler that is
--   watching for the expected privilege error.
-- * Everything runs in one transaction that is rolled back at the end, and the
--   seed rows are local test users only. Nothing here touches production data.
-- * Role switching uses `set local role` plus `request.jwt.claims`, which is how
--   Supabase resolves auth.uid().

begin;

-- Seed three auth users and profiles directly. Local/dev databases only.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'full@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'operational@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'disabled@example.test')
on conflict (id) do nothing;

insert into public.admin_profiles (user_id, role, display_name, disabled_at) values
  ('11111111-1111-1111-1111-111111111111', 'full_admin', 'Full', null),
  ('22222222-2222-2222-2222-222222222222', 'operational_admin', 'Ops', null),
  ('33333333-3333-3333-3333-333333333333', 'full_admin', 'Disabled', now())
on conflict (user_id) do update
  set role = excluded.role, disabled_at = excluded.disabled_at;

-- ---------------------------------------------------------------------------
-- 0. Static configuration guards
-- ---------------------------------------------------------------------------

do $$
declare
  role_default text;
  rls_enabled integer;
  unexpected integer;
begin
  -- The role must never be defaulted: a default could grant elevated access.
  select c.column_default into role_default
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'admin_profiles'
     and c.column_name = 'role';
  if role_default is not null then
    raise exception 'FAIL: admin_profiles.role has default % — a default may grant elevated access', role_default;
  end if;

  select count(*) into rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'admin_profiles'
     and c.relrowsecurity;
  if rls_enabled <> 1 then
    raise exception 'FAIL: row level security is not enabled on public.admin_profiles';
  end if;

  -- Only SELECT policies may exist: no client write path.
  select count(*) into unexpected
    from pg_policies
   where schemaname = 'public'
     and tablename = 'admin_profiles'
     and cmd <> 'SELECT';
  if unexpected <> 0 then
    raise exception 'FAIL: % non-SELECT policy/policies exist on admin_profiles', unexpected;
  end if;

  select count(*) into unexpected
    from pg_policies
   where schemaname = 'public'
     and tablename = 'admin_profiles'
     and cmd = 'SELECT';
  if unexpected <> 2 then
    raise exception 'FAIL: expected exactly 2 SELECT policies, found %', unexpected;
  end if;

  -- No permissive USING (true) policy anywhere on this table.
  select count(*) into unexpected
    from pg_policies
   where schemaname = 'public'
     and tablename = 'admin_profiles'
     and qual in ('true', '(true)');
  if unexpected <> 0 then
    raise exception 'FAIL: % permissive USING (true) policy/policies found', unexpected;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 0b. Function hardening guards
-- ---------------------------------------------------------------------------

do $$
begin
  if has_schema_privilege('anon', 'private', 'USAGE') then
    raise exception 'FAIL: anon has USAGE on the private schema';
  end if;

  if has_function_privilege('anon', 'private.current_admin_role()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.current_admin_role()';
  end if;
  if has_function_privilege('anon', 'private.is_full_admin()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.is_full_admin()';
  end if;

  -- RLS policies are evaluated as the querying role, so authenticated must be
  -- able to reach the helpers.
  if not has_function_privilege('authenticated', 'private.current_admin_role()', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute private.current_admin_role(); the SELECT policy would fail';
  end if;
  if not has_function_privilege('authenticated', 'private.is_full_admin()', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute private.is_full_admin(); the SELECT policy would fail';
  end if;

  -- Helpers must not live in a Data API schema.
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'graphql_public')
       and p.proname in ('current_admin_role', 'is_full_admin', 'touch_admin_profiles')
  ) then
    raise exception 'FAIL: role helper functions are still exposed in a Data API schema';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Anonymous callers cannot read administrator profiles
-- ---------------------------------------------------------------------------

set local role anon;

do $$
declare
  denied boolean := false;
  visible bigint := -1;
begin
  begin
    execute 'select count(*) from public.admin_profiles' into visible;
  exception
    when insufficient_privilege then denied := true;
  end;

  if not denied and visible <> 0 then
    raise exception 'FAIL: anonymous caller read % administrator profile row(s)', visible;
  end if;
end $$;

do $$
declare
  denied boolean := false;
begin
  begin
    execute 'select private.current_admin_role()';
  exception
    when insufficient_privilege then denied := true;
  end;

  if not denied then
    raise exception 'FAIL: anonymous caller executed private.current_admin_role()';
  end if;
end $$;

do $$
declare
  denied boolean := false;
begin
  begin
    execute 'select private.is_full_admin()';
  exception
    when insufficient_privilege then denied := true;
  end;

  if not denied then
    raise exception 'FAIL: anonymous caller executed private.is_full_admin()';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 2. An active Full Admin reads all profiles and resolves as full_admin
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  visible bigint;
  resolved public.admin_role;
  full boolean;
begin
  execute 'select count(*) from public.admin_profiles' into visible;
  if visible <> 3 then
    raise exception 'FAIL: active full admin saw % rows, expected 3', visible;
  end if;

  execute 'select private.current_admin_role()' into resolved;
  if resolved is distinct from 'full_admin' then
    raise exception 'FAIL: current_admin_role() returned % for an active full admin', resolved;
  end if;

  execute 'select private.is_full_admin()' into full;
  if full is distinct from true then
    raise exception 'FAIL: is_full_admin() returned % for an active full admin', full;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. An Operational Admin sees only their own row and cannot promote itself
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  visible bigint;
  resolved public.admin_role;
  full boolean;
begin
  execute 'select count(*) from public.admin_profiles' into visible;
  if visible <> 1 then
    raise exception 'FAIL: operational admin saw % rows, expected only their own', visible;
  end if;

  execute $q$select count(*) from public.admin_profiles
              where user_id = '11111111-1111-1111-1111-111111111111'$q$ into visible;
  if visible <> 0 then
    raise exception 'FAIL: operational admin read an unrelated administrator profile';
  end if;

  execute 'select private.current_admin_role()' into resolved;
  if resolved is distinct from 'operational_admin' then
    raise exception 'FAIL: current_admin_role() returned % for an operational admin', resolved;
  end if;

  execute 'select private.is_full_admin()' into full;
  if full is distinct from false then
    raise exception 'FAIL: operational admin reported as full admin';
  end if;
end $$;

do $$
declare
  denied boolean := false;
  affected bigint := -1;
begin
  begin
    execute $q$update public.admin_profiles set role = 'full_admin'
               where user_id = '22222222-2222-2222-2222-222222222222'$q$;
    get diagnostics affected = row_count;
  exception
    when insufficient_privilege then denied := true;
  end;

  if not denied and affected <> 0 then
    raise exception 'FAIL: operational admin promoted itself (% row(s) updated)', affected;
  end if;
end $$;

do $$
declare
  still public.admin_role;
begin
  execute $q$select role from public.admin_profiles
              where user_id = '22222222-2222-2222-2222-222222222222'$q$ into still;
  if still is distinct from 'operational_admin' then
    raise exception 'FAIL: self-promotion attempt changed the stored role to %', still;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. No client can insert, update or delete administrator profiles
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  denied boolean := false;
  visible bigint;
begin
  begin
    execute $q$insert into public.admin_profiles (user_id, role)
               values ('44444444-4444-4444-4444-444444444444', 'full_admin')$q$;
  exception
    when insufficient_privilege then denied := true;
  end;

  if not denied then
    execute 'select count(*) from public.admin_profiles' into visible;
    if visible <> 3 then
      raise exception 'FAIL: a client inserted an administrator profile (% rows present)', visible;
    end if;
  end if;
end $$;

do $$
declare
  denied boolean := false;
  affected bigint := -1;
begin
  begin
    execute $q$delete from public.admin_profiles
               where user_id = '22222222-2222-2222-2222-222222222222'$q$;
    get diagnostics affected = row_count;
  exception
    when insufficient_privilege then denied := true;
  end;

  if not denied and affected <> 0 then
    raise exception 'FAIL: a client deleted an administrator profile (% row(s))', affected;
  end if;
end $$;

do $$
declare
  denied boolean := false;
  affected bigint := -1;
begin
  begin
    -- A full admin must not be able to change another administrator's role.
    execute $q$update public.admin_profiles set role = 'operational_admin'
               where user_id = '33333333-3333-3333-3333-333333333333'$q$;
    get diagnostics affected = row_count;
  exception
    when insufficient_privilege then denied := true;
  end;

  if not denied and affected <> 0 then
    raise exception 'FAIL: a client changed another administrator role (% row(s))', affected;
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 5. A disabled administrator resolves to no privileged role
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  resolved public.admin_role;
  full boolean;
  visible bigint;
begin
  execute 'select private.current_admin_role()' into resolved;
  if resolved is not null then
    raise exception 'FAIL: disabled administrator resolved role %', resolved;
  end if;

  execute 'select private.is_full_admin()' into full;
  if full is distinct from false then
    raise exception 'FAIL: disabled administrator reported as full admin';
  end if;

  -- The disabled account may still read its own row; it grants nothing.
  execute 'select count(*) from public.admin_profiles' into visible;
  if visible <> 1 then
    raise exception 'FAIL: disabled administrator saw % rows, expected only their own', visible;
  end if;
end $$;

reset role;

rollback;
