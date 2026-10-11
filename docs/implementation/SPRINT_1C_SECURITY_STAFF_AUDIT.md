# Sprint 1C — Security Hardening, Staff Management & Audit Logging

**Date:** 10 October 2026
**Status:** **PHASE 1 CODE COMPLETE — AWAITING DATABASE ACTIVATION / LIVE VERIFICATION.**

The application code, four new migrations, the automated tests and the documentation are complete. `npm run check` passes (typecheck, lint, 106 tests, production build) and the built server was exercised over HTTP for the unauthenticated paths. **No Sprint 1C migration has been applied to the hosted Supabase project**, no real administrator was invited, and the database security tests are **NOT EXECUTED**. Until the activation steps in §9 are performed, staff management is code-complete but not live.

**Scope:** Sprint 1C only. Phase 2 (booking persistence), Brevo, Cloudflare email, newsletter campaigns, review replies/overrides and CMS persistence are out of scope (§12).

---

## 1. What this sprint adds

Sprint 1A made authentication real and Sprint 1B separated the two administrator roles. Both deliberately left the *administrative* actions that change access itself — inviting staff, changing roles, disabling accounts — as reviewed SQL run by a project owner, with no audit record anywhere.

Sprint 1C closes that gap:

| Objective | Delivered as |
| --- | --- |
| Foundational audit logging | `public.audit_events`, append-only, Full-Admin-readable, written only inside the transaction that performs the change |
| Full Admin staff management | `/admin/staff` module behind `staff.manage` (Full Admin only) |
| Invitation / provisioning workflow | Server-only Supabase Auth Admin API through `src/lib/supabase/admin.ts`, with a staged invitation lifecycle |
| Suspension and restoration | `staff_set_disabled` with a reason, a confirmation step and last-Full-Admin protection |
| Explicit role changes | `staff_change_role` with reason, optional elevation confirmation and optimistic concurrency |
| Safe account lifecycle | `admin_invitations` lifecycle + reconciliation so a failed invitation can never grant access |
| Mutation hardening | Verified session → capability → origin → rate limit → validation → transactional RPC |
| Session/authorisation failure handling | 401/403 on the staff API, existing forbidden/not-found page states preserved, role re-resolved every request |
| Documentation consolidation | `docs/implementation/PHASE_1_COMPLETE_IMPLEMENTATION.md` (single authoritative Phase 1 document) |

Nothing in the public website, the existing console design, the booking lifecycle or the review behaviour was redesigned. No new npm dependency was added.

## 2. Architecture

```text
Browser (client component: staff-manager.tsx)
  └── server actions (src/lib/admin/staff-actions.ts)          "use server"
        ├── requireAdminRole(["full_admin"])  ← verified session + admin_profiles row
        ├── hasPermission(role, "staff.manage")  ← central registry
        ├── checkRequestOrigin(...)            ← Origin vs Host / X-Forwarded-Host / SITE_URL
        ├── consumeRateLimit(kind, actorId)    ← per-actor, in-process
        ├── pure validation + invariant planner (src/lib/admin/staff.ts)
        └── staff service (src/lib/admin/staff-service.ts)   SERVER ONLY
              ├── reads: caller's session client, under RLS
              └── writes: createSupabaseAdminClient() → public.staff_* RPCs (service_role only)
                            └── private.* helpers → change + audit event, one transaction

Read endpoints
  GET /api/admin/staff            401 unauthenticated · 403 without staff.manage
  GET /api/admin/staff?events=1   audit history (Full Admin only)
```

Three properties matter:

1. **No client can reach the privileged functions.** `EXECUTE` on every `public.staff_*` function is revoked from `PUBLIC`, `anon` and `authenticated` and granted only to `service_role`. PostgreSQL checks that privilege *before* the body runs, so an authenticated administrator calling `/rest/v1/rpc/staff_change_role` by hand is refused regardless of the arguments.
2. **No actor id is accepted from the browser.** The acting administrator is resolved from the verified session inside the server action and passed to the function, which then re-validates that the actor is an *active Full Admin* inside the same transaction — so a demoted or suspended actor cannot complete an in-flight request.
3. **A privileged change cannot succeed without its audit event.** The change and its `audit_events` row are written by the same function in the same transaction. There is no separate "audit afterwards" call that could be skipped.

### Why the callable functions are in `public`, not `private`

Sprint 1A placed the role helpers in the non-exposed `private` schema. That works for RLS policies, which run inside the database, but Supabase's Data API only resolves requests against the schemas in its `db-schemas` setting (`public, graphql_public, storage`). A function in `private` is therefore unreachable through `supabase.rpc()` — including from the server's elevated client, which uses the same API. Exposing `private` to the API would be the wrong fix, so the *entry points* are in `public` and are protected by privileges rather than placement:

- callable: `public.staff_create_invitation`, `public.staff_mark_invitation`, `public.staff_complete_invitation`, `public.staff_change_role`, `public.staff_set_disabled` — `service_role` only;
- internal: `private.insert_audit_event`, `private.staff_lock`, `private.active_full_admin_count`, `private.assert_active_full_admin` — revoked from every API role, called only from the functions above.

Client roles lose nothing by this: they could never call them either way.

## 3. Audit infrastructure

`public.audit_events` (migration `20261011120100_audit_events.sql`):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigint generated always as identity` | Immutable ordering |
| `actor_id` | `uuid` → `auth.users(id) on delete set null` | `NULL` only for reviewed break-glass SQL run by a database owner |
| `action` | `text not null` | Constrained to `namespace.verb` (`staff.role_changed`) |
| `entity_type` | `text not null` | `admin_profile`, `admin_invitation` |
| `entity_id` | `text` | Target key (a UUID string) |
| `before_state` / `after_state` | `jsonb` | Minimal state: role, active flag, email. Size-capped at 8 KiB each |
| `reason` | `text` | Operator-supplied justification (≤ 500) |
| `correlation_id` | `uuid` | Server-generated, groups related events without exposing request data |
| `created_at` | `timestamptz not null default now()` | Database-authoritative |

Guarantees:

- **Clients can read only, and only Full Admins.** `revoke all` then `grant select` to `authenticated`; one policy, `audit_events_select_full_admin`, using `private.is_full_admin()`. There is no insert/update/delete policy, so RLS denies by default.
- **Immutable even for the table owner.** A `before update or delete` trigger raises, so history cannot be edited by accident; a future retention job must disable it in its own reviewed migration.
- **Payload discipline.** The functions write only identifiers, roles, account state and the operator's reason. No credential, token, API key or customer record is written, and the database test asserts the payload does not match `password|token|secret|key|refresh`.
- **Reusable for later phases.** `private.insert_audit_event(...)` is the single write path, so Phase 2 booking operations and Phase 3 review moderation can record events without inventing a second mechanism.

`audit_events` is also written by the reviewed bootstrap scripts (`supabase/bootstrap/001`–`004`), so break-glass provisioning, suspension, restoration and role changes are no longer invisible in the history.

## 4. Secure staff invitations

`src/lib/supabase/admin.ts` is the only module that reads an elevated key. It:

- reads `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`) — **never** a `NEXT_PUBLIC_*` variable;
- refuses to initialise in a browser, uses `persistSession: false`, and is created per operation rather than shared;
- validates the key *shape* (a legacy service JWT `eyJ…` or a modern `sb_secret_…`), which rejects a publishable key pasted in by mistake;
- never logs, returns or embeds the value in an error message.

The workflow is explicitly staged because Supabase Auth and the application database cannot share a transaction:

```text
1. staff_create_invitation   → admin_invitations row (status pending) + audit 'staff.invited'
                                · refuses duplicates, existing profiles, existing auth accounts, invalid addresses
                                · grants NOTHING: no admin_profiles row exists
2. auth.admin.inviteUserByEmail(email, { redirectTo: <SITE_URL>/admin/auth/callback })
                                · failure → staff_mark_invitation(failed) + audit 'staff.invitation_failed'
                                  → reported as invite_failed (never as success)
3. staff_mark_invitation(sent, auth_user_id) + audit 'staff.invitation_sent'
                                · failure here → reported as partial_failure: the email went out, the
                                  state was not recorded, and a retry reconciles the same address
4. invitee accepts → /admin/auth/callback (or a later sign-in) verifies the account, then
   staff_complete_invitation creates the profile from the INVITED role + audit 'staff.provisioned'
   and marks the invitation accepted (idempotent)
```

Honest-failure rules enforced by code and tests:

- a failed invitation creates **no** profile, so it can never grant access;
- the email is normalised once (lower-cased, trimmed) and the invitation can only be completed for the address it was issued to (`STAFF_EMAIL_MISMATCH`);
- the role always comes from the invitation row, never from the caller, and never defaults to Full Admin;
- retries are safe: the lifecycle is keyed on the address, a `failed` invitation is closed, and completion is idempotent.

**Documented email limitation.** Invitations use the Supabase Auth email service. The built-in service is rate-limited (a small hourly quota) and its default sender is not suitable for production deliverability; a custom SMTP provider must be configured in the Supabase project before staff rely on invitations or password recovery. Brevo is deliberately not integrated in this sprint.

## 5. Role changes and account lifecycle

`public.staff_change_role(p_actor, p_target, p_role, p_expected_updated_at, p_reason, p_correlation)`:

- re-validates the actor as an **active Full Admin**;
- takes a transaction-scoped advisory lock (`private.staff_lock()`), so concurrent staff changes are serialised and the last-Full-Admin check cannot be raced;
- refuses self-changes (`STAFF_SELF_CHANGE`) — a Full Admin cannot promote or demote themselves;
- refuses an unknown role and a no-op;
- enforces **last active Full Admin** protection inside the transaction via `private.active_full_admin_count()`, not from a client-side count;
- supports **optimistic concurrency**: a stale `updated_at` is refused (`STAFF_CONFLICT`) so two administrators cannot silently overwrite each other;
- writes `staff.role_changed` with before/after role and the reason.

`public.staff_set_disabled(...)` follows the same shape for suspension/restoration: no self-actions, no-ops reported (`STAFF_STATE_UNCHANGED`), last-Full-Admin protection, and `staff.suspended` / `staff.restored` events. Restoration never assigns a new role.

`admin_invitations` mirrors the same discipline: full-admin read-only, no client writes, `updated_at` maintained by a private trigger.

### Disabling a profile vs revoking a provider session

Disabling sets `admin_profiles.disabled_at`, which is re-checked on **every** protected request — the next verified request is rejected and `getCurrentAdmin()` returns `null`. It does **not** revoke that account's Supabase Auth refresh tokens across devices: an existing session can still authenticate, it simply resolves to no administrator role. Ending the sessions as well requires provider-level revocation (Supabase's "sign out user" admin API or removing the auth user), which this sprint deliberately does not claim to perform. The console states this distinction in the confirmation dialog rather than implying immediate multi-device revocation.

## 6. Mutation security

Every new authenticated mutation runs this chain (repeated per action, not centralised in a way that could be bypassed):

| Control | Implementation |
| --- | --- |
| Server-side role check | `requireAdminRole(["full_admin"])` → verified session + `admin_profiles` row |
| Capability check | `hasPermission(role, "staff.manage")` from the central registry |
| Origin validation | `checkRequestOrigin` compares `Origin` against `Host`, `X-Forwarded-Host` and `SITE_URL` |
| CSRF | Next.js Server Actions already reject cross-origin submissions; the explicit origin check makes the contract visible and covers route handlers. No double-submit token was added, because it would duplicate a control Next.js already applies |
| Input validation | `validateInvitationInput`, `validateReason`, `isAssignableRole` — all shared with the UI |
| Request size limits | Reasons capped at 200 characters; no large body accepted; the API has no write verb at all |
| Rate limiting | `consumeRateLimit`: 10 invitations / 15 min and 30 other changes / 15 min, per acting account |
| Non-sensitive errors | the `StaffErrorCode` taxonomy; raw SQL text and provider messages are never forwarded |
| Idempotency | invitation lifecycle keyed on the address; invitation completion is idempotent; role/status no-ops are reported |
| Audit logging | written by the same transaction as the change |

Preview deployments keep working: the origin check compares the request's *own* hosts and accepts the configured `SITE_URL`, so no hard-coded production domain is required. Rate-limit state is per process and documented as defence in depth, not a distributed guarantee.

Client input is always treated as untrusted: the browser may suggest a role or a reason, but the database decides.

## 7. Database migrations (new in Sprint 1C)

| # | File | Purpose | Applied? |
| --- | --- | --- | --- |
| 3 | `supabase/migrations/20261011120000_admin_profiles_email.sql` | Adds `admin_profiles.email` (nullable, backfilled from `auth.users`), lookup index. Forward-only; API roles cannot write it | **No** |
| 4 | `supabase/migrations/20261011120100_audit_events.sql` | `audit_events` table, constraints, indexes, append-only trigger, RLS + full-admin read policy | **No** |
| 5 | `supabase/migrations/20261011120200_admin_invitations.sql` | Invitation lifecycle table, one-outstanding-per-address index, `updated_at` trigger, RLS + full-admin read policy | **No** |
| 6 | `supabase/migrations/20261011120300_admin_staff_functions.sql` | `private` helpers + five `public.staff_*` functions, all `SECURITY DEFINER`, `search_path = ''`, `service_role`-only, with the change and audit write in one transaction | **No** |

Execution order continues from Sprint 1A: `20261010120000` → `20261010120100` → the four files above, in filename order. Sprint 1A migrations were **not** rewritten.

## 8. Files created and modified

### Created

| Path | Purpose |
| --- | --- |
| `src/lib/supabase/admin.ts` | Server-only elevated client; validated key shape; refuses to run in a browser |
| `src/lib/security/request-origin.ts` | Origin verification for cookie-authenticated writes |
| `src/lib/security/rate-limit.ts` | Per-actor in-process rate limiting for staff operations |
| `src/lib/admin/staff.ts` | Pure domain logic: validation, invariant planners, error taxonomy/mapping, audit presentation |
| `src/lib/admin/staff-service.ts` | Server-only reads (session client, RLS) and writes (elevated client → trusted RPCs) |
| `src/lib/admin/staff-actions.ts` | Full control chain per action: role → capability → origin → rate limit → validation → RPC |
| `src/app/api/admin/staff/route.ts` | Staff list / audit history; `401` unauthenticated, `403` without `staff.manage` |
| `src/components/admin/staff-manager.tsx` | Staff console: list, invitations, role dialog, disable/restore dialog, activity log |
| `tests/staff.test.ts` | 15 tests for validation, invariants, error mapping and audit presentation |
| `supabase/tests/sprint_1c_staff_security.sql` | Database security tests (**written, NOT EXECUTED**) |
| `docs/implementation/SPRINT_1C_SECURITY_STAFF_AUDIT.md` | This document |
| `docs/implementation/PHASE_1_COMPLETE_IMPLEMENTATION.md` | Consolidated Phase 1 document |

### Modified

| Path | Change |
| --- | --- |
| `src/lib/auth/permissions.ts` | Registers the `staff` route (`/admin/staff`, `staff.manage`) as Full Admin only |
| `src/components/shell.tsx` | `staff` icon key for the route-keyed navigation |
| `src/components/admin/admin-app.tsx` | Renders `StaffAdmin` for the `staff` route (server-authorised before render) |
| `src/app/admin/auth/callback/route.ts` | Handles `type=invite` and reconciles an outstanding invitation after a verified session |
| `src/lib/auth/actions.ts` | Reconciles an invitation on sign-in before denying a profile-less session |
| `supabase/bootstrap/001`–`004` | Now record audit events for break-glass provisioning, suspension/restoration and role changes |
| `tests/permissions.test.ts` | Staff route/capability assertions; Full Admin navigation and shortcuts updated; Operational Admin navigation assertion unchanged and re-asserted |
| `.env.example` | Documents the server-only elevated key and the invitation redirect origin |
| `README.md`, `docs/IMPLEMENTATION_REVIEW.md`, `docs/source/*.md` | Sprint 1C status recorded |

No CSS file was changed: the module reuses `.panel`, `.table-wrap`, `.record-row`, `.badge`, `.field`, `.checkbox`, `.dialog`, `.notice` and `.form-grid`.

## 9. Manual Supabase activation guide

Nothing below has been performed by this sprint. Order matters; do not rerun the Sprint 1A migrations.

1. **Sprint 1A migrations** — already applied by the owner, or apply them now:
   `20261010120000_admin_profiles.sql`, `20261010120100_admin_profiles_rls.sql`.
2. **Sprint 1C migrations** — apply in filename order (see §7). Recommended:
   `supabase migration list` → `supabase db push --dry-run` → `supabase db push`, or paste each file once into the SQL editor.
3. **Environment variables** (server environment only):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_DEMO_MODE=false`,
   `SITE_URL=https://<verified-origin>`, and — for invitations — `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`). Never place the elevated key in a `NEXT_PUBLIC_*` name.
4. **Supabase Auth configuration** — Site URL and redirect allow-list must include `<origin>/admin/auth/callback`; the invitation email template must use the default `{{ .ConfirmationURL }}` (or `{{ .TokenHash }}` with `type=invite`), both of which the callback handles.
5. **Invitation email** — the built-in Supabase email service is quota-limited and not production-grade; configure custom SMTP before relying on invitations.
6. **Verify the migrations** (read-only):
   ```sql
   select relname, relrowsecurity from pg_class
    where relname in ('admin_profiles', 'admin_invitations', 'audit_events');
   select policyname, cmd, roles from pg_policies
    where tablename in ('admin_invitations', 'audit_events');
   select has_function_privilege('authenticated', 'public.staff_change_role(uuid,uuid,public.admin_role,timestamptz,text,uuid)', 'execute') as auth_can_call,
          has_function_privilege('service_role', 'public.staff_change_role(uuid,uuid,public.admin_role,timestamptz,text,uuid)', 'execute') as service_can_call;
   select action, entity_type, reason, created_at from public.audit_events order by created_at desc limit 20;
   ```
   Expected: RLS enabled on all three; exactly one read policy each on the two new tables and no write policy; `auth_can_call = false`, `service_can_call = true`.
7. **Real Full Admin test** — sign in, open `/admin/staff`, invite a test address with the *Operational Admin* role, confirm the invitation appears as *Awaiting acceptance* and an `staff.invited` / `staff.invitation_sent` event appears in the activity log, accept the invitation, then confirm the new account can sign in and sees only Bookings and Reviews.
8. **Real Operational Admin test** — sign in as that account and confirm `/admin/staff` shows the access-denied state and `GET /api/admin/staff` returns `403`.

## 10. Verification results

Executed 10 October 2026, Node 22, Windows (Git Bash).

| Command | Result |
| --- | --- |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | **Pass** |
| `npm run lint` (`eslint .`) | **Pass** — 0 errors; 1 pre-existing warning in `.opencode/plugins/graphify.js` (not part of the application source) |
| `npm test` (`node --import tsx --test tests/*.test.ts`) | **Pass** — **106 tests, 0 failures** (15 new in `tests/staff.test.ts`, 1 new permissions test; 90 before) |
| `npm run build` (`next build --webpack`) | **Pass** — `/api/admin/staff` registered dynamic; `/admin/[[...segments]]`, `/admin/auth/callback`, `/api/admin/session` dynamic; `ƒ Proxy (Middleware)` |
| HTTP smoke against the built server (`next start -p 3123`) | `/api/admin/staff` → **401** `{"code":"unauthenticated"}`; `/admin/staff` → **307** → `/admin/login?next=%2Fadmin%2Fstaff`; `/admin/login` → **200**; `/` → **200** (public site unchanged); `Cache-Control: private, no-store, max-age=0` on `/admin/staff` |
| Client-bundle credential review | No `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` string in `.next/static/**`; no `NEXT_PUBLIC_*` privileged key anywhere in `src/` or `supabase/` |
| Dependency review | No new npm dependency |

New automated coverage: email/role/reason validation; error taxonomy completeness and status mapping; database-marker mapping (`STAFF_LAST_FULL_ADMIN` → `last_full_admin`, etc.); role-change invariants (permission, self, unknown role, no-op, reason required for boundary crossings, last Full Admin); status invariants (repeated disable/restore, last Full Admin, reason required); active-Full-Admin counting; invitation planning (self-invite, duplicates, invalid address); audit presentation; and the permission additions — Full Admin reaches `/admin/staff`, Operational Admin is forbidden, Operational Admin navigation is still **exactly** Bookings and Reviews, anon is denied, and a denied `?next=` cannot reach the module.

### Not executed / not verified

- **Database security tests are NOT EXECUTED.** `supabase/tests/sprint_1c_staff_security.sql` needs a PostgreSQL/Supabase local stack, which is unavailable in this environment. The SQL-level invariants (RLS, kill of write privileges, audit immutability, last-Full-Admin transaction behaviour, service-role-only execution) are therefore **not proven** — only the unit-tested TS logic and the SQL's static review are.
- **No hosted migration was applied** and **no real invitation was sent**; no live signed-in staff flow was exercised.
- **No live 401/403 for a signed-in Operational Admin was observed** (no credentials available); the endpoint's decision comes from the same registry function covered by unit tests.
- **No browser, screenshot or visual testing** (excluded by the brief). The owner reviews the interface manually.
- Rate limiting is in-process, so it is not a distributed limit across serverless instances.

## 11. Security status

**Implemented**

- Verified-session role checks, capability checks, origin validation, rate limiting, input validation and non-sensitive errors on every new mutation.
- Privileged database functions callable only by `service_role`; internal helpers in a non-exposed schema.
- Transactional change + audit write; append-only history that even the table owner cannot edit through SQL.
- Last-active-Full-Admin protection enforced under a transaction-scoped lock; self-service role changes refused; optimistic concurrency on staff edits.
- No elevated key in the browser bundle, no `NEXT_PUBLIC_*` secret, key-shape validation that rejects a publishable key, and no secret in any log or error message.
- Invitations that fail cannot create access; acceptance requires the invited address and applies only the invited role.
- Demo mode remains isolated: it grants nothing and reaches no privileged operation.

**Remaining limitations**

- Denied *pages* still return `200` with the access-denied state (App Router pages cannot set 403); denied *API* endpoints return `401`/`403` correctly.
- Rate limiting is per process, not distributed.
- Disabling does not revoke provider-level sessions across devices (documented in §5).
- Invitation email depends on Supabase's shared SMTP unless a custom provider is configured; no Brevo integration.
- `audit_events` has no retention or export policy yet (intentionally immutable; a future reviewed migration must define retention).
- Staff management is the only durable module; bookings, reviews, CMS, media and settings still run on the in-memory demo repository and fail closed in production.
- The mobile menu and desktop sidebar still rely on the server-verified `/api/admin/session` probe for display only.

## 12. Sprint boundary and Phase 2 handoff

Not started, by instruction: booking persistence, Brevo, Cloudflare email, newsletters, review replies/publication versions/override, CMS/media persistence, customer accounts.

Before Phase 2 introduces real booking persistence:

1. Apply the Sprint 1C migrations and complete the activation checklist (§9), including the database security tests on a disposable database.
2. Confirm the audit history records real invitations, role changes and suspensions.
3. Decide whether denied pages need true `403` responses (a route-handler or proxy change) before real data is exposed on those routes.
4. Replace the in-process rate limiter with a shared store (database table or edge limiter) when mutations become durable.
5. Define audit retention/export and, if needed, a reviewed retention migration that disables the immutability trigger deliberately.
6. Reuse `private.insert_audit_event` for booking mutations, and add mutation-level `bookings.manage` checks rather than route-level only.
7. Wire the database tests into the project's check routine where tooling allows.
