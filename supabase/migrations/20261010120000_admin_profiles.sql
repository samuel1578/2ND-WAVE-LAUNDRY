-- Sprint 1A — foundational administrator schema.
--
-- Creates the constrained administrator role type and the admin_profiles table
-- that binds a Supabase Auth user to exactly one administrator role.
--
-- Nothing in this migration grants Full Admin: `role` has no default, so a row
-- can only appear through a reviewed, trusted provisioning statement
-- (supabase/bootstrap/).
--
-- Apply manually after review. Do not run the Supabase CLI reset commands.
-- Execution order: this file, then 20261010120100_admin_profiles_rls.sql.

-- ---------------------------------------------------------------------------
-- private schema — internal helpers, NOT reachable from the Data API
--
-- Only `public` (and `graphql_public`) are exposed by the Supabase Data API, so
-- helpers and trigger functions live in `private` and cannot be called by a
-- client, even accidentally. Application code never reads this schema.
-- ---------------------------------------------------------------------------

create schema if not exists private;

comment on schema private is
  'Internal, non-exposed schema for security-definer role helpers and trigger functions. Not part of the Supabase Data API.';

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

-- ---------------------------------------------------------------------------
-- Role type
-- ---------------------------------------------------------------------------

create type public.admin_role as enum ('full_admin', 'operational_admin');

comment on type public.admin_role is
  'Authorised administrator roles. full_admin covers the whole console; operational_admin is limited to bookings and review moderation once Sprint 1B lands.';

-- ---------------------------------------------------------------------------
-- Administrator profiles
-- ---------------------------------------------------------------------------

create table public.admin_profiles (
  user_id uuid primary key
    references auth.users (id) on delete restrict,
  role public.admin_role not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
    references auth.users (id) on delete set null,
  disabled_at timestamptz,
  constraint admin_profiles_display_name_length
    check (char_length(display_name) <= 120)
);

comment on table public.admin_profiles is
  'Administrator role and lifecycle state per Supabase Auth user. One row per administrator. Written only by a trusted provisioning workflow; no client role or delete access.';

comment on column public.admin_profiles.role is
  'Authorised role. Never defaulted, so a newly authenticated user cannot receive elevated access.';
comment on column public.admin_profiles.created_by is
  'Auth user id of the operator that provisioned this profile. NULL is expected when the provisioning statement is run from the Supabase SQL editor, which has no end-user JWT.';
comment on column public.admin_profiles.disabled_at is
  'Set when access is revoked. Disabled profiles keep their history but are rejected by role resolution and every privileged operation.';

-- Supports role-scoped lookups of active administrators.
create index admin_profiles_active_role_idx
  on public.admin_profiles (role)
  where disabled_at is null;

-- ---------------------------------------------------------------------------
-- updated_at maintenance (private schema: not client-callable)
-- ---------------------------------------------------------------------------

create or replace function private.touch_admin_profiles()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function private.touch_admin_profiles() is
  'Keeps public.admin_profiles.updated_at authoritative on every update. Trigger-only; no client execution privileges.';

-- Functions are executable by PUBLIC by default: revoke, then grant nothing.
revoke all on function private.touch_admin_profiles() from public;
revoke all on function private.touch_admin_profiles() from anon;
revoke all on function private.touch_admin_profiles() from authenticated;

-- Trigger functions are executed by the table, not by the caller, and the
-- EXECUTE check on CREATE TRIGGER is satisfied by this migration's owner role.
create trigger admin_profiles_touch
  before update on public.admin_profiles
  for each row execute function private.touch_admin_profiles();
