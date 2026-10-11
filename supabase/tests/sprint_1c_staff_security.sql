-- Sprint 1C — database security tests for staff management and the audit log.
--
-- STATUS: NOT EXECUTED in the implementation environment. There is no PostgreSQL
-- server and no Supabase CLI available here, so this file has NOT been run, and
-- nothing in the Sprint 1C report claims that it passes. Run it against a
-- disposable local/test database (never the hosted project) before relying on the
-- policies in production.
--
-- How to run (disposable environment only)
--   1. supabase start               # or: a local Postgres with the Supabase roles
--   2. apply the migrations in order:
--        20261010120000_admin_profiles.sql
--        20261010120100_admin_profiles_rls.sql
--        20261011120000_admin_profiles_email.sql
--        20261011120100_audit_events.sql
--        20261011120200_admin_invitations.sql
--        20261011120300_admin_staff_functions.sql
--   3. create the synthetic auth users below (they are inserted by this script)
--   4. psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sprint_1c_staff_security.sql
--
-- Every check raises an exception on failure, so the script stops at the first
-- broken expectation. It cleans up after itself in a single transaction and is
-- rolled back at the end: it never leaves synthetic administrators behind.
--
-- It does NOT prove hosted RLS behaviour: passing locally is evidence about these
-- policies, not about the production project.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create or replace function pg_temp.assert(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;

-- Synthetic identities. Inserted directly into auth.users because a local test
-- database has no email delivery.
insert into auth.users (id, email, instance_id, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'second.full@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'operational@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'invitee@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.admin_profiles (user_id, role, display_name, email)
values
  ('11111111-1111-1111-1111-111111111111', 'full_admin', 'Owner', 'owner@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'full_admin', 'Second Full', 'second.full@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'operational_admin', 'Operational', 'operational@test.local');

-- ---------------------------------------------------------------------------
-- 1. RLS is enabled on every new table
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['audit_events', 'admin_invitations']
  loop
    perform pg_temp.assert(
      (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass),
      format('row level security must be enabled on public.%s', t)
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Clients cannot write audit history or invitations
-- ---------------------------------------------------------------------------

do $$
declare
  role_name text;
  statement text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    foreach statement in array array[
      'insert into public.audit_events (action, entity_type) values (''staff.invited'', ''admin_profile'')',
      'update public.audit_events set reason = ''tampered''',
      'delete from public.audit_events',
      'insert into public.admin_invitations (email, role) values (''x@test.local'', ''full_admin'')',
      'update public.admin_invitations set status = ''accepted''',
      'delete from public.admin_invitations'
    ]
    loop
      begin
        execute format('set local role %I', role_name);
        execute statement;
        raise exception 'ASSERTION FAILED: % was allowed to run: %', role_name, statement;
      exception
        when insufficient_privilege or check_violation then
          execute 'reset role';
      end;
      execute 'reset role';
    end loop;
  end loop;
end;
$$;

-- An Operational Admin can read their own profile but no other administrator's,
-- and never the audit log.
do $$
declare
  visible integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

  select count(*) into visible from public.admin_profiles;
  perform pg_temp.assert(visible = 1, 'an Operational Admin must see only their own profile');

  select count(*) into visible from public.audit_events;
  perform pg_temp.assert(visible = 0, 'an Operational Admin must not read the audit log');

  reset role;
end;
$$;

-- A Full Admin sees every administrator and the audit history.
do $$
declare
  visible integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  select count(*) into visible from public.admin_profiles;
  perform pg_temp.assert(visible = 3, 'a Full Admin must see every administrator profile');

  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Privileged functions are not callable by client roles
-- ---------------------------------------------------------------------------

do $$
begin
  perform pg_temp.assert(
    not has_function_privilege('anon', 'public.staff_change_role(uuid,uuid,public.admin_role,timestamptz,text,uuid)', 'execute'),
    'anon must not execute staff_change_role'
  );
  perform pg_temp.assert(
    not has_function_privilege('authenticated', 'public.staff_change_role(uuid,uuid,public.admin_role,timestamptz,text,uuid)', 'execute'),
    'authenticated must not execute staff_change_role'
  );
  perform pg_temp.assert(
    not has_function_privilege('authenticated', 'public.staff_create_invitation(uuid,text,public.admin_role,uuid)', 'execute'),
    'authenticated must not execute staff_create_invitation'
  );
  perform pg_temp.assert(
    has_function_privilege('service_role', 'public.staff_change_role(uuid,uuid,public.admin_role,timestamptz,text,uuid)', 'execute'),
    'service_role must be able to execute staff_change_role'
  );
  -- The internal helpers stay unreachable from the Data API.
  perform pg_temp.assert(
    not has_function_privilege('authenticated', 'private.insert_audit_event(uuid,text,text,text,jsonb,jsonb,text,uuid)', 'execute'),
    'authenticated must not write audit events directly'
  );
end;
$$;

-- A client-role call is refused by PostgreSQL before the body runs.
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  begin
    perform public.staff_change_role(
      '11111111-1111-1111-1111-111111111111',
      '33333333-3333-3333-3333-333333333333',
      'full_admin', null, 'attempted escalation', null
    );
    raise exception 'ASSERTION FAILED: an authenticated session executed staff_change_role';
  exception
    when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Actor validation
-- ---------------------------------------------------------------------------

do $$
declare
  audit_before bigint;
  audit_after bigint;
begin
  select count(*) into audit_before from public.audit_events;

  -- An Operational Admin is not an acceptable actor.
  begin
    perform public.staff_change_role(
      '33333333-3333-3333-3333-333333333333',
      '22222222-2222-2222-2222-222222222222',
      'operational_admin', null, 'operational actor', null
    );
    raise exception 'ASSERTION FAILED: an Operational Admin was accepted as an actor';
  exception
    when others then
      perform pg_temp.assert(position('STAFF_FORBIDDEN' in sqlerrm) > 0, 'expected STAFF_FORBIDDEN, got: ' || sqlerrm);
  end;

  -- No actor at all.
  begin
    perform public.staff_change_role(null, '22222222-2222-2222-2222-222222222222', 'operational_admin', null, 'no actor', null);
    raise exception 'ASSERTION FAILED: a missing actor was accepted';
  exception
    when others then
      perform pg_temp.assert(position('STAFF_ACTOR_REQUIRED' in sqlerrm) > 0, 'expected STAFF_ACTOR_REQUIRED, got: ' || sqlerrm);
  end;

  -- A disabled actor is not an acceptable actor either.
  update public.admin_profiles set disabled_at = now()
   where user_id = '11111111-1111-1111-1111-111111111111';
  begin
    perform public.staff_change_role(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      'operational_admin', null, 'disabled actor', null
    );
    raise exception 'ASSERTION FAILED: a suspended account was accepted as an actor';
  exception
    when others then
      perform pg_temp.assert(position('STAFF_FORBIDDEN' in sqlerrm) > 0, 'expected STAFF_FORBIDDEN, got: ' || sqlerrm);
  end;
  update public.admin_profiles set disabled_at = null
   where user_id = '11111111-1111-1111-1111-111111111111';

  -- A failed privileged change must not have written an audit row.
  select count(*) into audit_after from public.audit_events;
  perform pg_temp.assert(
    audit_before = audit_after,
    'a refused change must not write an audit event'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Role changes: success path, audit row, self-change, no-op, conflict
-- ---------------------------------------------------------------------------

do $$
declare
  audit_before bigint;
  audit_after bigint;
  event public.audit_events;
begin
  select count(*) into audit_before from public.audit_events;

  perform public.staff_change_role(
    '11111111-1111-1111-1111-111111111111',  -- actor: active Full Admin
    '33333333-3333-3333-3333-333333333333',  -- target: Operational Admin
    'full_admin',
    null,
    'Promotion approved by the owner',
    '99999999-9999-9999-9999-999999999999'
  );

  select count(*) into audit_after from public.audit_events;
  perform pg_temp.assert(audit_after = audit_before + 1, 'a role change must write exactly one audit event');

  select * into event from public.audit_events order by id desc limit 1;
  perform pg_temp.assert(event.action = 'staff.role_changed', 'audit action must be staff.role_changed');
  perform pg_temp.assert(event.actor_id = '11111111-1111-1111-1111-111111111111', 'audit actor must be the acting Full Admin');
  perform pg_temp.assert(event.before_state ->> 'role' = 'operational_admin', 'audit must record the previous role');
  perform pg_temp.assert(event.after_state ->> 'role' = 'full_admin', 'audit must record the new role');
  perform pg_temp.assert(event.reason = 'Promotion approved by the owner', 'audit must record the reason');
  perform pg_temp.assert(event.correlation_id = '99999999-9999-9999-9999-999999999999', 'audit must record the correlation id');
  perform pg_temp.assert(event.created_at is not null, 'audit must carry a database timestamp');
  -- No credential material may appear anywhere in the payload.
  perform pg_temp.assert(
    not (event.before_state::text || event.after_state::text || coalesce(event.reason, '')) ~* '(password|token|secret|key|refresh)',
    'audit payload must not contain credential material'
  );

  -- Self-service change is refused.
  begin
    perform public.staff_change_role(
      '11111111-1111-1111-1111-111111111111',
      '11111111-1111-1111-1111-111111111111',
      'operational_admin', null, 'self demotion', null
    );
    raise exception 'ASSERTION FAILED: an administrator changed their own role';
  exception
    when others then
      perform pg_temp.assert(position('STAFF_SELF_CHANGE' in sqlerrm) > 0, 'expected STAFF_SELF_CHANGE, got: ' || sqlerrm);
  end;

  -- No-op is reported as unchanged, not as success.
  begin
    perform public.staff_change_role(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      'full_admin', null, 'no-op', null
    );
    raise exception 'ASSERTION FAILED: a no-op role change was reported as success';
  exception
    when others then
      perform pg_temp.assert(position('STAFF_STATE_UNCHANGED' in sqlerrm) > 0, 'expected STAFF_STATE_UNCHANGED, got: ' || sqlerrm);
  end;

  -- Concurrent-edit protection: a stale expected timestamp is refused.
  begin
    perform public.staff_change_role(
      '11111111-1111-1111-1111-111111111111',
      '33333333-3333-3333-3333-333333333333',
      'operational_admin',
      '2000-01-01T00:00:00Z',
      'stale write', null
    );
    raise exception 'ASSERTION FAILED: a stale role change overwrote a newer change';
  exception
    when others then
      perform pg_temp.assert(position('STAFF_CONFLICT' in sqlerrm) > 0, 'expected STAFF_CONFLICT, got: ' || sqlerrm);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Last active Full Admin protection
-- ---------------------------------------------------------------------------

do $$
declare
  only_full uuid := '11111111-1111-1111-1111-111111111111';
begin
  -- Leave exactly one active Full Admin.
  update public.admin_profiles set disabled_at = now()
   where user_id in ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
  update public.admin_profiles set role = 'operational_admin'
   where user_id = '33333333-3333-3333-3333-333333333333';

  -- Both demotion and suspension of that account must fail.
  begin
    perform public.staff_change_role(only_full, only_full, 'operational_admin', null, 'x', null);
    raise exception 'ASSERTION FAILED: reached an unexpected code path';
  exception
    when others then
      perform pg_temp.assert(position('STAFF_SELF_CHANGE' in sqlerrm) > 0, 'self-change check must run first, got: ' || sqlerrm);
    end;

  -- Promote the Operational Admin so a second Full Admin exists, then suspend it,
  -- then attempt to demote the remaining (only) active Full Admin.
  update public.admin_profiles set disabled_at = null
   where user_id = '33333333-3333-3333-3333-333333333333';
  perform public.staff_change_role(only_full, '33333333-3333-3333-3333-333333333333', 'full_admin', null, 'second full admin', null);

  -- Now suspend the second Full Admin through the trusted function.
  perform public.staff_set_disabled(only_full, '33333333-3333-3333-3333-333333333333', true, null, 'handover', null);

  -- A different Full Admin must exist for the actor check to pass; use the
  -- restored account as the actor and target the original Full Admin.
  update public.admin_profiles set disabled_at = null
   where user_id = '33333333-3333-3333-3333-333333333333';
  update public.admin_profiles set disabled_at = now()
   where user_id = '22222222-2222-2222-2222-222222222222';

  -- Suspend one of the two active Full Admins, leaving one, then attempt to
  -- suspend the survivor: refused.
  perform public.staff_set_disabled('33333333-3333-3333-3333-333333333333', only_full, true, null, 'suspending owner', null);
  begin
    perform public.staff_set_disabled(only_full, '33333333-3333-3333-3333-333333333333', true, null, 'suspending the last full admin', null);
    raise exception 'ASSERTION FAILED: the last active Full Admin was suspended';
  exception
    when others then
      perform pg_temp.assert(
        position('STAFF_LAST_FULL_ADMIN' in sqlerrm) > 0 or position('STAFF_FORBIDDEN' in sqlerrm) > 0,
        'expected last-Full-Admin or actor protection, got: ' || sqlerrm
      );
  end;

  -- Restore for the invitation checks below.
  update public.admin_profiles set disabled_at = null, role = 'full_admin'
   where user_id in (only_full, '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
end;
$$;

-- Repeated disable / restore are reported, never silently "succeeded".
do $$
begin
  begin
    perform public.staff_set_disabled('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', false, null, 'already active', null);
    raise exception 'ASSERTION FAILED: restoring an active account was reported as a change';
  exception
    when others then
      perform pg_temp.assert(position('STAFF_STATE_UNCHANGED' in sqlerrm) > 0, 'expected STAFF_STATE_UNCHANGED, got: ' || sqlerrm);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Invitation lifecycle and reconciliation
-- ---------------------------------------------------------------------------

do $$
declare
  invitation jsonb;
  invitation_id uuid;
  profile_count integer;
begin
  invitation := public.staff_create_invitation(
    '11111111-1111-1111-1111-111111111111',
    ' Invitee@Test.Local ',
    'operational_admin',
    '88888888-8888-8888-8888-888888888888'
  );
  invitation_id := (invitation ->> 'invitation_id')::uuid;
  perform pg_temp.assert(invitation ->> 'email' = 'invitee@test.local', 'the invitation email must be normalised');
  perform pg_temp.assert(invitation ->> 'status' = 'pending', 'a new invitation must be pending');

  -- A pending invitation grants nothing: no profile was created.
  select count(*) into profile_count from public.admin_profiles
   where user_id = '44444444-4444-4444-4444-444444444444';
  perform pg_temp.assert(profile_count = 0, 'a pending invitation must not create an administrator profile');

  -- Duplicate invitation is refused.
  begin
    perform public.staff_create_invitation(
      '11111111-1111-1111-1111-111111111111', 'invitee@test.local', 'full_admin', null
    );
    raise exception 'ASSERTION FAILED: a duplicate invitation was created';
  exception
    when others then
      perform pg_temp.assert(position('STAFF_INVITATION_EXISTS' in sqlerrm) > 0, 'expected STAFF_INVITATION_EXISTS, got: ' || sqlerrm);
  end;

  -- An existing administrator cannot be invited again.
  begin
    perform public.staff_create_invitation(
      '11111111-1111-1111-1111-111111111111', 'operational@test.local', 'full_admin', null
    );
    raise exception 'ASSERTION FAILED: an existing administrator was invited again';
  exception
    when others then
      perform pg_temp.assert(position('STAFF_ALREADY_ADMIN' in sqlerrm) > 0, 'expected STAFF_ALREADY_ADMIN, got: ' || sqlerrm);
  end;

  -- An invalid address is refused server-side too.
  begin
    perform public.staff_create_invitation('11111111-1111-1111-1111-111111111111', 'not-an-email', 'full_admin', null);
    raise exception 'ASSERTION FAILED: an invalid invitation address was accepted';
  exception
    when others then
      perform pg_temp.assert(position('STAFF_INVALID_EMAIL' in sqlerrm) > 0, 'expected STAFF_INVALID_EMAIL, got: ' || sqlerrm);
  end;

  -- Provider failure is recorded honestly and creates no profile.
  perform public.staff_mark_invitation(
    '11111111-1111-1111-1111-111111111111',
    invitation_id,
    'failed',
    null,
    'The authentication provider rejected the invitation.',
    null
  );
  select count(*) into profile_count from public.admin_profiles
   where user_id = '44444444-4444-4444-4444-444444444444';
  perform pg_temp.assert(profile_count = 0, 'a failed invitation must not create a profile');

  -- A failed invitation is closed, so a fresh attempt for the same address is
  -- allowed (idempotent retry / reconciliation).
  invitation := public.staff_create_invitation(
    '11111111-1111-1111-1111-111111111111', 'invitee@test.local', 'operational_admin', null
  );
  invitation_id := (invitation ->> 'invitation_id')::uuid;

  perform public.staff_mark_invitation(
    '11111111-1111-1111-1111-111111111111',
    invitation_id,
    'sent',
    '44444444-4444-4444-4444-444444444444',
    null,
    null
  );

  -- Acceptance creates the profile from the invited role and is idempotent.
  perform public.staff_complete_invitation(
    invitation_id, '44444444-4444-4444-4444-444444444444', 'invitee@test.local', null
  );
  perform pg_temp.assert(
    (select role from public.admin_profiles where user_id = '44444444-4444-4444-4444-444444444444') = 'operational_admin',
    'the invited role must be applied at acceptance'
  );

  select count(*) into profile_count from public.admin_profiles
   where user_id = '44444444-4444-4444-4444-444444444444';
  perform pg_temp.assert(profile_count = 1, 'acceptance must create exactly one profile');

  begin
    perform public.staff_complete_invitation(invitation_id, '44444444-4444-4444-4444-444444444444', 'invitee@test.local', null);
  exception
    when others then
      raise exception 'ASSERTION FAILED: reconciliation was not idempotent: %', sqlerrm;
  end;

  -- A forged acceptance for a different address is refused.
  begin
    perform public.staff_complete_invitation(invitation_id, '22222222-2222-2222-2222-222222222222', 'someone.else@test.local', null);
    raise exception 'ASSERTION FAILED: an invitation was completed for a different address';
  exception
    when others then
      perform pg_temp.assert(
        position('STAFF_EMAIL_MISMATCH' in sqlerrm) > 0 or position('STAFF_INVITATION_STATE' in sqlerrm) > 0,
        'expected a mismatch/state refusal, got: ' || sqlerrm
      );
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Audit history is immutable, even for the table owner
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    update public.audit_events set reason = 'tampered' where id = (select max(id) from public.audit_events);
    raise exception 'ASSERTION FAILED: an audit event was updated';
  exception
    when others then
      perform pg_temp.assert(position('append-only' in sqlerrm) > 0, 'expected the append-only trigger, got: ' || sqlerrm);
  end;

  begin
    delete from public.audit_events where id = (select max(id) from public.audit_events);
    raise exception 'ASSERTION FAILED: an audit event was deleted';
  exception
    when others then
      perform pg_temp.assert(position('append-only' in sqlerrm) > 0, 'expected the append-only trigger, got: ' || sqlerrm);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Role changes cannot bypass account-state checks
-- ---------------------------------------------------------------------------

do $$
declare
  role_after public.admin_role;
begin
  -- A suspended Full Admin keeps their role but must hold no effective access, and
  -- suspending an account must never quietly change its role.
  perform public.staff_set_disabled(
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    true, null, 'suspended for review', null
  );
  select role into role_after from public.admin_profiles where user_id = '22222222-2222-2222-2222-222222222222';
  perform pg_temp.assert(role_after = 'full_admin', 'suspension must not change the stored role');

  -- `private.is_full_admin()` must ignore suspended rows.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  perform pg_temp.assert(private.is_full_admin() = false, 'a suspended Full Admin must not resolve as a Full Admin');
  perform pg_temp.assert(private.current_admin_role() is null, 'a suspended administrator must resolve to no role');
  reset role;
end;
$$;

-- Report success. The transaction is rolled back so no synthetic data remains.
do $$
declare
  events integer;
begin
  select count(*) into events from public.audit_events;
  raise notice 'Sprint 1C database security checks passed. Audit events written during the test: %', events;
end;
$$;

rollback;
