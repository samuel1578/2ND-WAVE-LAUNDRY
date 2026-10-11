-- Sprint 1A — row level security for admin_profiles.
--
-- Semantics implemented here:
--   * anonymous visitors cannot read administrator profiles at all;
--   * an authenticated administrator can read their own profile row;
--   * a Full Admin can read all profile rows (used by later staff management);
--   * Operational Admins cannot browse other administrators;
--   * no client role may insert, update or delete profiles — role assignment
--     and account provisioning only happen through a trusted workflow;
--   * disabled profiles resolve to no role, so privileged operations reject them.
--
-- Apply manually after review. Do not run the Supabase CLI reset commands.
-- Execution order: after 20261010120000_admin_profiles.sql.

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------

alter table public.admin_profiles enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges
--
-- Supabase grants broad default privileges on new public tables. Remove them and
-- grant read-only access to authenticated; row visibility is then decided by the
-- policies below. Anonymous callers receive no grant at all.
-- ---------------------------------------------------------------------------

revoke all on table public.admin_profiles from anon;
revoke all on table public.admin_profiles from authenticated;
grant select on table public.admin_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Narrow role-resolution helpers (private schema, not exposed to the Data API)
--
-- SECURITY DEFINER so a policy on admin_profiles can read the caller's own row
-- without re-entering that table's policies (no recursive RLS). They are
-- read-only, scoped to auth.uid(), and cannot mutate any data.
--
-- Hardening applied:
--   * live in `private`, which the Data API does not expose;
--   * `search_path` pinned to empty, so every identifier must be schema-
--     qualified and a shadowing object cannot be introduced by a caller;
--   * execution revoked from PUBLIC and anon;
--   * USAGE on `private` granted only to authenticated (RLS policies run as the
--     querying role, so authenticated needs both USAGE and EXECUTE).
-- ---------------------------------------------------------------------------

create or replace function private.current_admin_role()
returns public.admin_role
language sql
stable
security definer
set search_path = ''
as $$
  select ap.role
  from public.admin_profiles ap
  where ap.user_id = auth.uid()
    and ap.disabled_at is null
$$;

comment on function private.current_admin_role() is
  'Active administrator role for the current authenticated user, or NULL. Read-only, search_path pinned, not exposed to the Data API, execution restricted to authenticated.';

create or replace function private.is_full_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_profiles ap
    where ap.user_id = auth.uid()
      and ap.role = 'full_admin'
      and ap.disabled_at is null
  )
$$;

comment on function private.is_full_admin() is
  'True only for an active Full Admin. Read-only, search_path pinned, not exposed to the Data API, execution restricted to authenticated.';

-- Functions are executable by PUBLIC by default: revoke, then grant narrowly.
revoke all on function private.current_admin_role() from public;
revoke all on function private.current_admin_role() from anon;
revoke all on function private.current_admin_role() from authenticated;
grant execute on function private.current_admin_role() to authenticated;

revoke all on function private.is_full_admin() from public;
revoke all on function private.is_full_admin() from anon;
revoke all on function private.is_full_admin() from authenticated;
grant execute on function private.is_full_admin() to authenticated;

grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
--
-- There is deliberately no insert, update or delete policy: with RLS enabled the
-- default is deny, so no client can assign a role, promote itself, disable
-- another administrator or delete a profile.
-- ---------------------------------------------------------------------------

create policy admin_profiles_select_self
  on public.admin_profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy admin_profiles_select_full_admin
  on public.admin_profiles
  for select
  to authenticated
  using (private.is_full_admin());
