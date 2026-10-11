# Sprint 1A — Supabase Foundation & Administrator Authentication

**Date:** 10 October 2026
**Status:** **CODE COMPLETE — AWAITING CONFIGURATION.** The application code, migrations and documentation are complete and the pre-patch code passed the automated checks listed in §14; the final security patch (§15) is documented but its npm checks were not re-run at the owner's request. No hosted migration has been applied, no real administrator account has been created and no hosted Supabase project configuration has been changed. Until the activation sequence in §6 is performed, real administrator sign-in is not operational.

**Scope:** Sprint 1A only. Booking persistence, Brevo, Cloudflare email, newsletters, review improvements and role-filtered Operational Admin routes are out of scope (see §16).

---

## 1. Architecture implemented

```text
Browser
  ├── Public website                    unchanged (no authentication, no Supabase dependency)
  ├── /admin/login | reset | set         Supabase Auth via server actions
  └── /admin/*                           server-verified, then client shell

Next.js 16 (App Router)
  ├── src/proxy.ts                       session refresh + unauthenticated redirect (NOT the auth boundary)
  ├── /admin/[[...segments]] (RSC)       independently verifies the administrator on every protected render
  ├── /admin/auth/callback (route)       exchanges the recovery code, fixed redirect target
  ├── /api/admin/session (route)         401 unless an active administrator profile is resolved
  └── src/lib/auth/actions.ts            sign in, sign out, password reset, password update

Supabase
  ├── Auth (cookie sessions, invite-only accounts)
  ├── public.admin_profiles + RLS        role and lifecycle state, database source of truth
  └── private.*                          role helpers (SECURITY DEFINER, not exposed by the Data API)
```

Enforcement is independent at three layers:

1. **Proxy** — refreshes the session and redirects unauthenticated visitors when demo mode is disabled. Explicitly documented as a redirect convenience, not an authorisation mechanism.
2. **Server** — `src/lib/auth/admin.ts` re-verifies the token with `auth.getUser()` and resolves the role from `public.admin_profiles`. Every admin page and privileged server entry point calls it. A missing profile, a disabled profile, an unknown role value or any query error resolves to "not an administrator".
3. **Database** — RLS is enabled on `admin_profiles` with self-read and full-admin-read policies only. No client role can insert, update or delete a profile.

Role model: `full_admin` and `operational_admin`, backed by a constrained Postgres enum with **no default**. A newly authenticated user therefore cannot receive elevated access, and there is no endpoint anywhere that accepts a role value.

## 2. Files created and modified

### Created

| Path | Purpose |
| --- | --- |
| `src/lib/demo-mode.ts` | Single source of the preview flag, importable by the proxy without content data |
| `src/lib/supabase/config.ts` | Public configuration validation and safe, non-secret error messages |
| `src/lib/supabase/client.ts` | SSR browser client factory (public URL + publishable key only) |
| `src/lib/supabase/server.ts` | Request-scoped server client with Next.js cookie handling |
| `src/lib/supabase/proxy.ts` | Session refresh and private cache headers |
| `src/proxy.ts` | Next.js 16 Proxy: session refresh, cookie propagation, admin redirects |
| `src/lib/auth/roles.ts` | Role model, database-backed identity resolution, authorisation core |
| `src/lib/auth/admin.ts` | `getAuthenticatedUser`, `getCurrentAdmin`, `requireAdmin`, `requireAdminRole` |
| `src/lib/auth/redirect.ts` | Protected/public route classification, safe return destinations, redirect allow-list |
| `src/lib/auth/actions.ts` | Server actions: sign in, sign out, password reset request, password update |
| `src/lib/auth/client-navigation.ts` | Distinguishes framework navigation from real errors in client components |
| `src/app/admin/auth/callback/route.ts` | Recovery code/token exchange with a fixed redirect target |
| `src/app/api/admin/session/route.ts` | Server-verified session probe; reference pattern for Sprint 1B endpoints |
| `supabase/migrations/20261010120000_admin_profiles.sql` | Role enum and `admin_profiles` table |
| `supabase/migrations/20261010120100_admin_profiles_rls.sql` | Role helpers, grants and RLS policies |
| `supabase/bootstrap/00{1,2,3,4}_*.sql` | Reviewed provisioning (`001` full admin, `002` operational admin, `003` disable/restore, `004` explicit role change), all with placeholder guards and one-row assertions |
| `supabase/tests/admin_profiles_rls.sql` | Database policy checks (**written, not executed** — see §14) |
| `supabase/README.md` | Migration layout and how to apply it |
| `tests/auth.test.ts` | 10 automated tests for roles, configuration, routing and redirects |
| `docs/implementation/SPRINT_1A_SUPABASE_AUTH.md` | This document |

### Modified

| Path | Change |
| --- | --- |
| `src/app/admin/[[...segments]]/page.tsx` | Server-side session and role resolution, `force-dynamic`, validated `?next=`, recovery readiness |
| `src/components/admin/admin-app.tsx` | Real sign-in/reset/set-password wiring, fail-closed configuration state, Operational Admin restriction, role badge |
| `src/components/shell.tsx` | `SignOutButton` wired to the sign-out server action in the header, sidebar and mobile menu |
| `src/lib/content.ts` | `demoMode` now re-exported from `src/lib/demo-mode.ts` (behaviour unchanged) |
| `next.config.ts` | `Cache-Control: private, no-store` for `/admin/:path*` |
| `.env.example` | Supabase variables, demo-mode and origin documentation |
| `README.md` | Authentication section, local setup, architecture and check notes |
| `docs/source/2ND_WAVE_SRS.md`, `docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md` | Requirement notes recording the implemented Supabase Auth, server-side authorisation and invite-only provisioning arrangements |
| `docs/IMPLEMENTATION_REVIEW.md` | Sprint 1A entry |
| `package.json`, `package-lock.json` | `@supabase/supabase-js`, `@supabase/ssr` |

## 3. Environment variable names

| Variable | Visibility | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | yes for real auth | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | yes for real auth | Publishable project key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | optional fallback | Legacy anon key for older projects |
| `NEXT_PUBLIC_DEMO_MODE` | public | no (default on) | `false` disables the demo workspace and requires real admin authentication |
| `SITE_URL` | server | production | Verified origin used to build auth redirect links |

No service-role or secret key is referenced anywhere in the application, and no secret value is printed, logged or returned to the browser.

## 4. Supabase project configuration

- Region: West EU (Ireland) — as already provisioned by the project owner.
- The project URL and publishable key are already held by the project owner; they are not reproduced in this repository.
- Required dashboard settings:
  - **Authentication → URL Configuration → Site URL**: the development origin
    (`http://localhost:3000`) until the production domain is cut over.
  - **Redirect URLs**: add the origins listed in §9.

## 5. SQL migration files

| Migration | Purpose | Applied? |
| --- | --- | --- |
| `20261010120000_admin_profiles.sql` | `private` helper schema (not exposed by the Data API); `public.admin_role` enum (`full_admin`, `operational_admin`); `admin_profiles` table (`user_id` PK/FK to `auth.users`, `role` NOT NULL with no default, `display_name`, `created_at`, `updated_at`, `created_by`, `disabled_at`); active-role index; `private.touch_admin_profiles()` trigger | **No** |
| `20261010120100_admin_profiles_rls.sql` | `enable row level security`; table grants revoked then `select` granted to `authenticated` only; `private.current_admin_role()` and `private.is_full_admin()` (`SECURITY DEFINER`, pinned `search_path = ''`, schema-qualified identifiers, execution revoked from `public`/`anon`, `USAGE` + `EXECUTE` granted only to `authenticated`); self-read and full-admin-read policies | **No** |

Neither file has been executed against the hosted project. They are reproducible, additive and reviewed but unverified against a database (see §14).

| # | Filename (execution order) |
| --- | --- |
| 1 | `20261010120000_admin_profiles.sql` |
| 2 | `20261010120100_admin_profiles_rls.sql` |

After applying both, verify (read-only):

```sql
select relname, relrowsecurity from pg_class where relname = 'admin_profiles';
select policyname, cmd, roles from pg_policies where tablename = 'admin_profiles';
select n.nspname, p.proname, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.proname in ('current_admin_role', 'is_full_admin', 'touch_admin_profiles');
select has_schema_privilege('anon', 'private', 'USAGE') as anon_usage,
       has_function_privilege('authenticated', 'private.is_full_admin()', 'EXECUTE') as auth_exec;
```

Expected: `relrowsecurity = true`; exactly two `SELECT` policies and no write policy; all three functions in schema `private` with `prosecdef = true` for the two role helpers and `proconfig` containing `search_path=`; `anon_usage = false`; `auth_exec = true`.

## 6. Manual migration application steps

### Activation sequence (in this exact order)

Nothing below has been performed by this sprint. The project owner performs it.

1. **SQL migrations** (§5) — apply file 1 then file 2, in the dashboard SQL editor or with `supabase db push` after a dry run, then run the read-only verification queries in §5.
2. **Auth user creation** (§7 steps 1–2) — Authentication → Users → Add user (or Invite) for the administrator's own address.
3. **First Full Admin provisioning** (§7 steps 3–4) — `supabase/bootstrap/001_provision_full_admin.sql` with that user's UID.
4. **Login verification** (§7 step 5) — sign in at `/admin/login`, confirm the workspace badge reads *Full administrator* and that `/admin/bookings` loads; sign out and confirm the protected route redirects.
5. **Subsequent Operational Admin provisioning** (§8) — `002_provision_operational_admin.sql`, then confirm the account can sign in and sees the *Access restricted* screen.

Choose one method for step 1. Review the SQL first.

**Supabase CLI (recommended, linked project):**

```sh
supabase link --project-ref <project-ref>      # one-off
supabase migration list                         # confirm nothing is pending unexpectedly
supabase db push --dry-run                      # review the plan
supabase db push                                # apply
```

**Dashboard SQL editor:** paste each migration file in filename order and run it once.

**psql:**

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261010120000_admin_profiles.sql \
  -f supabase/migrations/20261010120100_admin_profiles_rls.sql
```

Never use `supabase db reset` or any destructive command against a hosted project: this sprint added no downgrade path and the project already holds data.

The read-only verification queries and their expected results are listed in §5.

### Rollback guidance — unused initial database only

The migrations have never been applied, so there is nothing to roll back today. If they are applied to an empty project and something must be undone before any real use, undo in reverse order:

```sql
-- Only on a database with no administrator data worth keeping.
drop policy if exists admin_profiles_select_full_admin on public.admin_profiles;
drop policy if exists admin_profiles_select_self on public.admin_profiles;
drop table if exists public.admin_profiles;
drop function if exists private.is_full_admin();
drop function if exists private.current_admin_role();
drop function if exists private.touch_admin_profiles();
drop type if exists public.admin_role;
drop schema if exists private;
```

Notes:

- Provisioned auth users are separate objects. `admin_profiles.user_id` references `auth.users` with `ON DELETE RESTRICT`, so delete the profile row (or drop the table) before deleting an auth user.
- A local-only alternative is `supabase db reset`, which rebuilds the local stack from migrations. **Never run it against a hosted project.**
- Once the project holds real data, do not roll back by dropping objects; write a reviewed forward migration instead.
- No rollback was executed by this sprint.

## 7. Initial Full Admin provisioning

1. Supabase dashboard → **Authentication → Users → Add user** (or Invite). Use the
   administrator's own address. Never create a shared account, and never reuse a
   password from any other system.
2. Copy that user's UID.
3. Open `supabase/bootstrap/001_provision_full_admin.sql`, replace the
   `target_user` placeholder with the UID and run the statement.
4. Confirm with the verification query at the end of the file: exactly one active
   `full_admin` row.
5. Sign in at `/admin/login` and confirm the workspace badge reads
   **Full administrator**.

The provisioning statement is transaction-safe, refuses to run with the
placeholder in place, refuses an id that has no `auth.users` row, contains no
password, is never reachable from the application and does not promote "whoever
logs in first".

## 8. Operational Admin provisioning procedure

Same procedure with `supabase/bootstrap/002_provision_operational_admin.sql`.
Use `supabase/bootstrap/003_disable_restore_admin.sql` to revoke (`disabled_at`)
or restore access; disabling removes all access immediately and keeps the row for
history. Prefer disabling to deleting — the application has no delete path and
`admin_profiles.user_id` references `auth.users` with `ON DELETE RESTRICT`.

An Operational Admin can sign in and hold a persistent session, but Sprint 1A
shows a single "Access restricted" screen rather than the console, because the
existing modules still serve demo data that is not role-scoped (§13, §16).

**Role changes.** Ordinary provisioning refuses to overwrite an existing
profile, so a repeated or mistaken run of `001`/`002` can never silently change
who is a Full Admin. Changing a provisioned role requires
`supabase/bootstrap/004_change_admin_role.sql` run deliberately with an explicit
`confirm_change := true` flag; it targets a single primary key and asserts that
exactly one row changed.

**`created_by` semantics.** The provisioning statements record `auth.uid()`. The
Supabase SQL editor runs without an end-user JWT, so this is stored as `NULL`,
which is expected and allowed. Provisioning must be performed by a project
owner / trusted operator with dashboard or database-owner credentials; the
application has no role-assignment endpoint of any kind.

## 9. Supabase Auth redirect configuration

`Authentication → URL Configuration`:

- **Site URL:** `http://localhost:3000` during development; the verified
  production origin only once the domain is cut over (not invented here).
- **Redirect URLs:** add each origin that must receive a recovery link, e.g.
  `http://localhost:3000/admin/auth/callback`.
- **Vercel previews:** set `SITE_URL` to the deployed preview origin for that
  environment (for example Vercel's `VERCEL_URL` value) **and** add the same
  origin to the redirect allow-list. The application does not trust wildcard
  hosts — `*.vercel.app` is rejected — so a preview deployment without `SITE_URL`
  fails closed with the "origin is not in the configured redirect allow-list"
  message rather than sending a link anywhere unexpected.
- **Email templates:** recovery links must use the default
  `{{ .ConfirmationURL }}` (or `{{ .TokenHash }}` with `type=recovery`), both of
  which the callback route handles.

The application additionally validates the origin against an explicit allow-list
(`SITE_URL`, plus `localhost`/`127.0.0.1` for local development only) and refuses
to send a recovery email for anything else. An absent `x-forwarded-proto` header
(common on local `next start`) falls back to `http` for loopback hosts only.

**Auth SMTP:** this sprint uses the Supabase Auth email service as configured on
the project. Free/default SMTP is rate-limited and intended for development only;
production delivery requires a verified sender domain (Brevo is deferred to a
later sprint) and must be configured before real staff rely on password recovery.

## 10. Local development setup

```sh
npm ci
cp .env.example .env.local      # add the two public Supabase values to enable real sign-in
npm run dev
```

- Demo-only review needs no Supabase values: everything in the public preview and
  the demo workspace behaves exactly as before.
- Real sign-in additionally requires the migrations from §6 to be applied.
- `/admin/login` shows a configuration notice when the values are missing, and
  never silently falls back to demo access.

## 11. Vercel environment configuration

Add to the project's environment variables for **Production** and **Preview**
(and locally in `.env.local`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_DEMO_MODE=false` in Production- `SITE_URL=https://<deployed-origin>`: **required** for password recovery on any non-loopback host, because wildcard hosts (including `*.vercel.app`) are not trusted. For Vercel previews set it to that deployment's origin (`https://$VERCEL_URL`) and add the same origin to the Supabase redirect allow-list.

Environment variables prefixed `NEXT_PUBLIC_` are compiled into the client
bundle — only public project values may be used. Because they are inlined at
build time, changing `NEXT_PUBLIC_DEMO_MODE` requires a redeploy.

Cloudflare Workers remain the intended production host; the implementation uses
only portable Next.js features (App Router, server actions, proxy, route
handlers, `@supabase/ssr` cookie handling) and adds no Vercel-specific dependency.

## 12. Demo versus production behaviour

| Behaviour | Demo enabled (`NEXT_PUBLIC_DEMO_MODE=true`) | Production (`=false`) |
| --- | --- | --- |
| Public website and preview | Unchanged | Unchanged |
| Demo workspace entry | Available, labelled simulated | Removed from the UI; the `sessionStorage` flag is inert |
| Public demo submissions | In-memory mock only, reset on refresh | Same UI, no production writes |
| `/admin/*` without a session | Demo workspace renders (no server data) | Redirected to `/admin/login?next=<validated>` |
| Real sign-in | Works when Supabase is configured and the account has an active profile | Required |
| Missing Supabase configuration | Configuration notice; demo remains available and clearly labelled | Fail closed: no admin content, no demo fallback |
| Caching of admin responses | `private, no-store` | `private, no-store` |

Demo authentication never creates a Supabase session, never reads a database row
and never reaches a privileged server operation, so it cannot become an
alternative path into real administrator work.

## 13. Security decisions

- **Real authentication is server-verified.** The role is resolved with
  `auth.getUser()` plus a database read on every protected render and in the
  session endpoint. `getSession()` is never used for authorisation.
- **No client-supplied identity.** No function accepts a user id or role from the
  request; identity comes only from the caller's verified session.
- **Fail closed.** Missing configuration, a missing profile, an unknown role, a
  disabled profile, an RLS denial or a transport error all resolve to no access.
- **No public registration.** No `/admin/signup`, no client-side invitation, no
  self-service role assignment. Accounts are created by a trusted administrator
  in the dashboard.
- **No automatic promotion.** The role column has no default; the first login
  grants nothing.
- **RLS is explicit and non-permissive.** Two read policies, no `USING (true)`
  policies, no insert/update/delete policies, grants revoked from `anon`, and
  role helpers restricted to `authenticated` with a pinned `search_path`.
- **Security-definer helpers are in a non-exposed schema.** `current_admin_role()`,
  `is_full_admin()` and the `updated_at` trigger function live in `private`, which
  the Supabase Data API does not expose, so they cannot be invoked by a client
  even by accident. `USAGE` on `private` and `EXECUTE` on the helpers are granted
  only to `authenticated` (RLS policies run as the querying role).
- **Role provisioning cannot silently overwrite access.** `001`/`002` raise if
  the account is already provisioned; changing a role requires the deliberate
  `004_change_admin_role.sql` with an explicit confirmation flag, one targeted
  primary key and a one-row assertion. Placeholders start as `NULL`, so a script
  cannot run accidentally.
- **No wildcard auth origins.** Only `SITE_URL` and loopback hosts can receive a
  recovery link; preview deployments must be configured explicitly.
- **Non-enumerating login and recovery.** One generic message for every failed
  sign-in (wrong password, no profile, disabled account) and identical recovery
  feedback, so the screens never confirm whether an email belongs to an
  administrator.
- **No open redirects.** `?next=` is restricted to same-origin `/admin` paths;
  the recovery callback target is fixed.
- **No secrets in the browser or the repository.** Only public project values are
  used, `.env.local` is git-ignored, and credentials, tokens and provider errors
  are never logged.
- **Demo flag kept inert in production.** The `sessionStorage` flag is not an
  authentication mechanism anywhere in the code.
- **Operational Admins are denied rather than trusted.** Sprint 1A does not open
  the demo-data console to them; a full role-filtered console is Sprint 1B.
- **Cache safety.** Admin responses are marked `private, no-store` in both the
  proxy and `next.config.ts`, and the admin route is dynamic.

## 14. Verification results

**Post-patch status (final security patch, 10 October 2026).** The security patch changed SQL migrations, bootstrap scripts, the SQL test file, one TypeScript helper (`resolveAuthOrigin` in `src/lib/auth/redirect.ts`) and its unit-test case, plus documentation. At the project owner's request the npm checks were **not re-run** after this patch, so the results below describe the pre-patch code state and the patch itself is covered by static review only. All SQL remains **NOT EXECUTED**.

Executed on 10 October 2026, Node 22, Windows (Git Bash).

| Command | Result |
| --- | --- |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | **Pass** |
| `npm run lint` (`eslint .`) | **Pass** — 0 errors, 0 warnings |
| `npm test` (`node --import tsx --test tests/*.test.ts`) | **Pass** — 80 tests, 0 failures (10 new in `tests/auth.test.ts`) |
| `npm run build` (`next build --webpack`) | **Pass** — `ƒ Proxy (Middleware)` recognised; `/admin/[[...segments]]`, `/admin/auth/callback`, `/api/admin/session` dynamic |
| `NEXT_PUBLIC_DEMO_MODE=false npm run build` + `next start` | **Pass** — production-mode behaviour below |
| HTTP smoke checks against the built server | **Pass** — see below |

Demo-mode (default) build:

| Request | Result |
| --- | --- |
| `GET /` | `200` — public site unchanged |
| `GET /admin` | `200` — demo workspace available |
| `GET /admin/login` | `200` — demo entry present, labelled simulated |
| `GET /api/admin/session` | `401 {"authenticated":false,"code":"unauthenticated"}` — no session, no profile, denied |

Production-mode build (`NEXT_PUBLIC_DEMO_MODE=false`, no Supabase configuration):

| Request | Result |
| --- | --- |
| `GET /admin` | `307` → `/admin/login?next=%2Fadmin` |
| `GET /admin/bookings` | `307` → `/admin/login?next=%2Fadmin%2Fbookings` |
| `GET /admin/login` | `200` — configuration notice, **no** demo entry |
| `Cache-Control` on `/admin/login` | `private, no-store, max-age=0` |

New automated test coverage (`tests/auth.test.ts`): unauthenticated rejection,
missing profile, disabled profile, unknown role, profile/user mismatch, Full
Admin recognition, Operational Admin recognition, stable denial codes,
Operational Admin console restriction, missing/malformed configuration failure
without value leakage, protected-versus-public route classification, open-redirect
rejection, and the auth redirect origin allow-list.

### Not executed / not verified

- **Database policies are unverified.** `supabase/tests/admin_profiles_rls.sql`
  was written but never run: no local Postgres and no Supabase CLI were available
  in this environment, and hosted migrations were intentionally not applied. The
  policies are **not** claimed to be verified against the hosted project.
- **No hosted sign-in was tested.** There are no credentials in this environment
  and no real administrator account was created.
- **No visual or browser testing was performed** (excluded by the sprint brief);
  the project owner will inspect desktop and mobile manually.
- Rate limiting on public submissions, multi-device session revocation semantics
  beyond Supabase's own behaviour, and the `service_role` path are unchanged from
  before this sprint.

## 15. Final security patch (10 October 2026)

Focused review of the SQL, auth helpers and documentation. Migrations had not
been applied, so the existing migration files were amended directly instead of
adding corrective migrations.

### Issues found and fixed

| # | Issue | Fix |
| --- | --- | --- |
| 1 | `current_admin_role()` / `is_full_admin()` were `SECURITY DEFINER` functions in the exposed `public` schema, so they were callable through the Data API by any client that could reach the schema, and they were a visible surface in the API schema list | Moved both (plus the `updated_at` trigger function) into a `private` schema that the Data API does not expose; `revoke` on the schema for `public`/`anon`/`authenticated`, then `grant usage on schema private` and `grant execute` to `authenticated` only. Policies, tests and docs updated to the new names |
| 2 | RLS test assertions were written inside the same `BEGIN … EXCEPTION` block that caught the expected privilege error, so a future edit could let a deliberate `RAISE EXCEPTION` be swallowed and report a false pass | Every probe now records a boolean inside a narrow nested handler and all assertions are raised **outside** it; added structural guards (no `role` default, RLS enabled, exactly two `SELECT` policies, no write policy, no `USING (true)`, helper privilege checks, functions absent from Data API schemas) and explicit checks that an Operational Admin cannot read an unrelated profile or promote itself, that no client can insert/update/delete, and that anon cannot execute the helpers |
| 3 | Re-running a bootstrap script would silently **overwrite** an existing account's role (`on conflict … do update`) | `001`/`002` now raise if the account is already provisioned and never update; role changes require the new deliberate `004_change_admin_role.sql` with an explicit `confirm_change` flag, a single primary-key target and a one-row assertion |
| 4 | Bootstrap placeholders used an all-zeros UUID that could theoretically be replaced by a careless paste of an unrelated id, and no operation asserted its row count | Placeholders are now `NULL` with an explicit refusal, and disable/restore assert exactly one row changed (raising on zero or multiple) |
| 5 | `created_by` semantics under SQL-editor execution were undocumented | Documented: the SQL editor has no end-user JWT, so `auth.uid()` is `NULL` and that is expected; provisioning must be run by a trusted dashboard/database owner, and no application endpoint accepts a role |
| 6 | `resolveAuthOrigin` trusted every `*.vercel.app` host (anyone can deploy there) and returned `null` when `x-forwarded-proto` was absent, breaking password reset on local `next start` | Wildcard trust removed — only `SITE_URL` and loopback hosts are accepted; an absent protocol header now falls back to `http` for loopback only. Vercel previews must set `SITE_URL` explicitly (documented in §9 and §11) |

### Reviewed and found sound (no change)

- **No RLS recursion:** the helpers remain `SECURITY DEFINER` with `search_path = ''` and fully schema-qualified identifiers, so a policy on `admin_profiles` can read the caller's own row without re-entering that table's policies. Row level security is enabled (not forced), so the migration owner is not subject to the policies it defines; the functions are read-only and cannot mutate data.
- **Server-side identity** is re-verified with `auth.getUser()`; role lookup failures, disabled profiles, unknown role values and missing configuration all resolve to no access.
- **Cookie handling** uses the `@supabase/ssr` `getAll`/`setAll` API with the refreshed headers propagated in the proxy; no shared cross-request server client.
- **Open-redirect prevention** (`safeAdminPath`) rejects protocol-relative, backslash, control-character and cross-origin values and only returns same-origin `/admin` paths.
- **Demo/production separation** holds: the `sessionStorage` demo flag grants nothing when `NEXT_PUBLIC_DEMO_MODE=false`, and missing Supabase configuration fails closed rather than falling back to demo access.
- **Static credential review:** no service-role/secret key is referenced in `src/`, no secret is logged or returned to the browser, and `.env.local` is git-ignored.

## 16. Known limitations and remaining Sprint 1B work

**Known limitations**

- Operational Admins cannot use any console module yet (deliberate, §13).
- The console still reads the in-memory demo store: nothing an administrator sees
  in `/admin/bookings`, `/admin/enquiries`, `/admin/reviews`, `/admin/newsletter`,
  `/admin/content`, `/admin/media` or `/admin/settings` is production data.
- Password recovery depends on the project's Supabase Auth SMTP configuration;
  production delivery needs a verified sender domain.
- Session revocation model: signing out ends the current browser session. Other
  devices are not forcibly revoked (Supabase handles refresh-token reuse
  detection); no "sign out everywhere" feature exists.
- `disabled_at` is enforced at every server resolution point, but an existing
  cookie can remain valid until the next verification — the server re-checks on
  every protected request, so a disabled admin is locked out immediately.

**Sprint 1B dependencies**

1. `supabase/migrations/` must be applied to the hosted project and the first
   Full Admin provisioned (§6, §7).
2. Supabase Auth URL Configuration and environment variables set per §9–§11.
3. ~~Operational Admin route map decided and implemented.~~ **Delivered in Sprint 1B:** the central permission registry (`src/lib/auth/permissions.ts`) replaced `canAccessAdminModules()` with per-route server decisions (allowed / redirect / forbidden / unknown) — see `docs/implementation/SPRINT_1B_ROLE_BASED_ADMIN.md`.
4. ~~Navigation filtered by role.~~ **Delivered in Sprint 1B:** the desktop sidebar and mobile console menu both render `adminNavigationFor(role)` from the same registry, and `adminNav` is derived from it.
5. Privileged server mutations built with `requireAdmin` / `requireAdminRole`
   (Sprint 2 booking writes) — including origin/CSRF checks on cookie-authenticated
   writes.
6. Staff management UI (invite, role change, disable) using the existing
   full-admin read policy; role changes must remain a server-only, audited path.
7. Audit events (`audit_events`) for privileged actions, including the Full Admin
   emergency review override.
8. Session-expiry handling refined per route, reusing the existing
   `session-expired` presentation.
9. Rate limiting and abuse controls on public submissions.
10. Database policy checks executed against a disposable database and wired into
    the check routine where the tooling allows.
