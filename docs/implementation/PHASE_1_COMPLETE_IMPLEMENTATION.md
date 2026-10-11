# 2nd Wave Laundry Services — Phase 1 Complete Implementation

**Document status:** single authoritative Phase 1 technical reference (Sprints 1A, 1B and 1C consolidated).
**Date:** 10 October 2026.
**Overall status:** **PHASE 1 CODE COMPLETE — AWAITING DATABASE ACTIVATION / LIVE VERIFICATION.**

Phase 1 application code, six SQL migrations, reviewed provisioning scripts and the automated test suite are complete. `npm run check` passes and the built server was exercised over HTTP. **No migration has been applied to the hosted Supabase project, no real administrator has signed in through a hosted project, no real invitation has been sent, and the database security tests are NOT EXECUTED.** Everything in this document describes implemented code and prepared database changes, not verified hosted behaviour. Where something has not been run, it is marked as such.

Individual sprint histories remain available and are not superseded as detailed records:

- `docs/implementation/SPRINT_1A_SUPABASE_AUTH.md`
- `docs/implementation/SPRINT_1B_ROLE_BASED_ADMIN.md`
- `docs/implementation/SPRINT_1C_SECURITY_STAFF_AUDIT.md`

The original investigation report `docs/investigations/ADMIN_OPERATIONS_EMAIL_ARCHITECTURE.md` is retained unchanged.

---

## 1. Phase 1 Executive Summary

Phase 1 turns an intentionally frontend-only prototype into a secure, role-aware administration foundation without changing the public website or the existing console design.

| Sprint | Delivered | Verification |
| --- | --- | --- |
| **1A — Supabase foundation** | Real Supabase Auth with cookie sessions, Next.js 16 Proxy, `admin_profiles` + `private` role helpers, RLS, invite-only accounts, reviewed bootstrap scripts, isolated demo mode | typecheck, lint, 80 tests, production build, HTTP smoke on the unauthenticated paths |
| **1B — Role-based administration** | Central permission registry, server-side per-route authorisation, role-specific landing pages, role-filtered desktop/mobile navigation, honest demo/production data states | typecheck, lint, 90 tests, production build, HTTP smoke in demo and production-mode builds |
| **1C — Security, staff management, audit** | Append-only `audit_events`, Full Admin staff management (`/admin/staff`), server-only invitations, role changes, suspension/restoration, origin + rate-limit hardening, 4 new migrations | typecheck, lint, **106 tests**, production build, HTTP smoke (401 / 307 / no-store), client-bundle credential review |

What Phase 1 does **not** include: booking persistence, Brevo or Cloudflare email, newsletters, review replies/overrides, CMS/media persistence, customer accounts, or true `403` page statuses. Those remain Phase 2+ work (§31, §32).

Two facts govern everything below:

1. **Identity and role are always server-verified** from a Supabase session plus the `admin_profiles` row. No client-supplied role, user id or flag can grant access.
2. **The business-data layer is still the in-memory demo repository.** Authentication is real; bookings, enquiries, reviews, CMS, media and settings are not. Where production data is absent, the interface says so rather than pretending.

## 2. Original Frontend Demo Baseline

Before Phase 1 the repository was a complete, responsive frontend preview:

- Public website: home, eleven service routes, how-it-works, three branches, about, contact, gallery with lightbox, FAQs, blog/article templates, reviews and submission, commercial quote form, four-step pickup flow and policy pages.
- An administration console rendered entirely from an in-memory mock store (`src/lib/mock-store.ts`): dashboard metrics, bookings with lifecycle states, enquiries, review moderation, newsletter interest, CMS modules (services, locations, gallery, blog, FAQs, promotions), media library and settings.
- Design system in a single stylesheet (`src/app/globals.css`): light/dark themes via `next-themes`, `.panel`, `.table-wrap`, `.record-row`, `.badge`, `.dialog`, `.field`, `.notice`, `.grid`, responsive breakpoints, reduced-motion support.
- A demonstration admin entry that was purely cosmetic, a public API boundary that fails closed with `503 BACKEND_NOT_CONFIGURED`, and no database anywhere.

Phase 1 preserves all of this. The public site, the console layout, the booking lifecycle, the review behaviour, the design tokens and the demo mode are unchanged; Phase 1 adds authentication and authorisation around them and records administrative actions that change access itself.

## 3. Overall Architecture

```text
Browser
  ├── Public website                         no authentication, no Supabase dependency
  ├── /admin/login | reset-password | set-password | auth/callback
  │                                          Supabase Auth through server actions/route handlers
  └── /admin/*                               server-authorised render, then client shell

Next.js 16 (App Router)
  ├── src/proxy.ts                           session refresh + unauthenticated redirect (NOT the auth boundary)
  ├── /admin/[[...segments]] (RSC)           re-verifies the administrator and authorises the route per request
  ├── /admin/auth/callback (route)           recovery + invitation code/token exchange, invitation reconciliation
  ├── /api/admin/session (route)             server-verified session probe (navigation display only)
  ├── /api/admin/staff (route)               staff list + audit history, 401/403, Full Admin only
  ├── src/lib/auth/*                         roles, identity resolution, redirects, server actions
  ├── src/lib/admin/*                        staff domain logic, server service, server actions
  └── src/lib/security/*                     origin verification, rate limiting

Supabase
  ├── Auth                                   cookie sessions, invite-only accounts, password recovery
  ├── public.admin_profiles + RLS            role and lifecycle state (source of truth)
  ├── public.admin_invitations + RLS         staged invitation lifecycle
  ├── public.audit_events + RLS              append-only administrative audit log
  ├── public.staff_* functions               SECURITY DEFINER, service_role-only, transactional change + audit
  └── private.*                              role helpers, audit write path, advisory lock (not exposed by the Data API)
```

Enforcement is independent at three layers:

1. **Proxy** — refreshes the session and redirects unauthenticated visitors away from `/admin` when demo mode is disabled. Explicitly a redirect convenience, never the authorisation boundary.
2. **Server** — every protected render and privileged operation calls `getCurrentAdmin()` / `requireAdminRole([...])`, which re-verify the token with `auth.getUser()` and resolve the role from the database. Missing configuration, no session, missing profile, unknown role, disabled profile, RLS denial or transport error all resolve to *no access*.
3. **Database** — RLS with explicit narrow policies and no write policies; `SECURITY DEFINER` functions with `search_path = ''`, fully qualified identifiers and revoked execution; a `service_role`-only path for privileged staff operations.

## 4. Sprint 1A — Supabase Foundation

Delivered modules and their responsibilities:

| Path | Responsibility |
| --- | --- |
| `src/lib/demo-mode.ts` | Single source of `NEXT_PUBLIC_DEMO_MODE`, importable by the proxy without pulling content data |
| `src/lib/supabase/config.ts` | Validates the public URL/key, produces safe non-secret messages, fails closed (`requireSupabaseConfig`) |
| `src/lib/supabase/client.ts` | Browser SSR client (public URL + publishable key only) |
| `src/lib/supabase/server.ts` | Request-scoped server client using `@supabase/ssr` `getAll`/`setAll` cookie handling |
| `src/lib/supabase/proxy.ts` | Session refresh with cookie propagation and `PRIVATE_HEADERS` (`private, no-store`) |
| `src/proxy.ts` | Next.js 16 Proxy entry: refresh, admin redirect when demo mode is off |
| `src/lib/auth/roles.ts` | Role model (`full_admin`, `operational_admin`), `resolveAdminIdentity`, `authorizeAdmin`, stable denial codes |
| `src/lib/auth/admin.ts` | `getAuthenticatedUser`, `getCurrentAdmin`, `requireAdmin`, `requireAdminRole` |
| `src/lib/auth/redirect.ts` | Protected/public route classification, `safeAdminPath`, auth origin allow-list |
| `src/lib/auth/actions.ts` | Sign in, sign out, request reset, update password (server actions) |
| `src/lib/auth/client-navigation.ts` | Distinguishes framework navigation errors from real failures |
| `src/app/admin/auth/callback/route.ts` | Fixed-target code/token exchange |
| `src/app/api/admin/session/route.ts` | Server-verified session probe |

Foundation principles established here and used everywhere since:

- **No public registration** and **no automatic promotion** — a profile row can only appear through a reviewed, trusted statement or (since 1C) an accepted invitation; `admin_profiles.role` has no default.
- **No endpoint accepts a role or user id.** Identity is derived from the caller's own session.
- **Fail closed** on missing configuration, rather than silently degrading to demo access.

## 5. Sprint 1A — Authentication and Sessions

- **Sign in** (`signInAdmin`): validates presence of fields, calls `signInWithPassword`, then requires an active administrator profile. If authentication succeeds but no profile resolves (missing, unknown role, disabled, unreadable), the session is immediately ended and one generic message is returned. The screen never reveals whether an address belongs to an administrator.
- **Sign out** (`signOutAdmin`): ends the Supabase session and returns to `/admin/login`; the UI also clears the demo flag and still navigates away if the server action fails unexpectedly.
- **Password recovery**: `requestAdminPasswordReset` uses a trusted origin (`SITE_URL`, or loopback in development), returns identical feedback regardless of whether the address is an administrator, and never forwards provider errors. `updateAdminPassword` requires a session created by the callback and an existing active administrator profile — recovery never grants access or creates a profile.
- **Callback**: exchanges a PKCE `code` or a `token_hash` (`recovery` or, since 1C, `invite`) for a session and always redirects to the fixed `/admin/set-password` target, so a crafted URL cannot redirect elsewhere.
- **Session exposure**: only `getUser()` (token re-validated with Supabase Auth) is used for authorisation; `getSession()` is never an authorisation source.
- **Cookie lifetime**: `@supabase/ssr` cookie handling with refreshed cookies propagated by the proxy; no cross-request shared client.
- **Revocation boundary**: signing out ends the current browser session. Other devices are not force-revoked; Supabase's own refresh-token reuse detection applies. There is no "sign out everywhere" feature. Disabling an *administrator profile* denies access on the next verified request but is not provider-level session revocation (§11).

## 6. Sprint 1A — Database Schema and RLS

`public.admin_role` — constrained enum `('full_admin', 'operational_admin')`, **no default**.

`public.admin_profiles` — one row per administrator:

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` PK → `auth.users(id) on delete restrict` | One profile per auth user |
| `role` | `public.admin_role not null` | No default, so authentication alone grants nothing |
| `display_name` | `text not null default ''` | ≤ 120 characters |
| `created_at`, `updated_at` | `timestamptz not null default now()` | `updated_at` maintained by `private.touch_admin_profiles()` |
| `created_by` | `uuid` → `auth.users(id) on delete set null` | `NULL` when provisioning from the SQL editor (no end-user JWT) |
| `disabled_at` | `timestamptz` | Set to suspend; disabled profiles resolve to no role everywhere |
| `email` *(1C)* | `text` | Added in Sprint 1C for staff listing; nullable, backfilled from `auth.users`, index on `lower(email)` |

Guarantees:

- RLS enabled; grants revoked from `anon`; `select` granted to `authenticated`; **no insert/update/delete policy at all**, so no client can assign a role, promote itself, disable another administrator or delete a profile.
- Policies: `admin_profiles_select_self` (`auth.uid() = user_id`) and `admin_profiles_select_full_admin` (using `private.is_full_admin()`).
- `private.current_admin_role()` and `private.is_full_admin()` are `SECURITY DEFINER`, `stable`, `search_path = ''`, schema-qualified, read-only, in a schema the Data API does not expose, with `EXECUTE` granted only to `authenticated` (RLS policies run as the querying role) — no recursive RLS.
- An index on `(role) where disabled_at is null` supports active-role lookups.

## 7. Sprint 1B — Central Permission Registry

`src/lib/auth/permissions.ts` is the single source of truth for capabilities and routes. Nothing else compares roles.

- **Permission list** (14): `dashboard.read`, `bookings.read`/`bookings.manage`, `reviews.read`/`reviews.moderate`/`reviews.reply`/`reviews.override`, `enquiries.manage`, `newsletter.manage`, `content.manage`, `media.manage`, `settings.manage`, `staff.manage`, `email.manage`.
- **Role mapping**: `full_admin` holds every permission; `operational_admin` holds `bookings.read`, `bookings.manage`, `reviews.read`, `reviews.moderate`, `reviews.reply`.
- **Unknown roles grant nothing**: `permissionsFor` returns `[]` for any value that is not one of the two roles, including client-supplied strings.
- **Route table** (`adminRoutes`) drives authorisation, navigation and dashboard shortcuts. Icons are resolved by route key, never by position.
- **Pure, framework-free, dependency-free** so the same functions are unit-tested and reused in the browser (display only) and on the server (authorisation).

`staff.manage` and `email.manage` were declared in Sprint 1B as explicit Full Admin boundaries before any module implemented them; Sprint 1C implements `staff.manage`.

## 8. Sprint 1B — Role-Based Route Authorisation

`src/app/admin/[[...segments]]/page.tsx` resolves the administrator, then asks `resolveAdminRouteAccess(role, pathname)`:

| Outcome | Meaning | Rendering |
| --- | --- | --- |
| `allowed` | Role holds the route permission | Module renders |
| `redirect` | Dashboard requested by a role without `dashboard.read` | Server redirect to the role's landing page |
| `forbidden` | Known route, permission absent | Existing access-denied state; **no module data resolved or sent** |
| `unknown` | No canonical route matches | Existing not-found state — never a dashboard fallback |

Matching respects segment boundaries: a route matches its exact path or a `/`-separated descendant, so `/admin/bookings/42` is Bookings while `/admin/bookingsX` and `/admin/<unknown>` match nothing. `/admin` is matched **exactly** — a regression found and fixed during Sprint 1B was `/admin` prefix-matching every nested path, briefly making `/admin/bookings` resolve to the dashboard; a test now covers it.

Landing pages: Full Admin → `/admin`; Operational Admin → `/admin/bookings`. `?next=` is honoured only when the resolved role may reach it, only for same-origin `/admin` paths (`safeAdminPath` rejects protocol-relative, backslash, control-character, cross-origin and public-auth destinations), and it is re-evaluated on every render, so a refresh cannot bypass it.

HTTP note: a denied *page* returns `200` with the access-denied state (App Router pages cannot set a status), but no protected data is fetched. Denied *API* endpoints return `401`/`403` correctly (`/api/admin/session`, `/api/admin/staff`).

## 9. Sprint 1B — Desktop/Mobile Admin Navigation

| Surface | Role source | Behaviour |
| --- | --- | --- |
| Desktop sidebar (`AdminSidebar`) | Role from the server-authorised render | `adminNavigationFor(role)`; shows identifier and role label |
| Mobile console menu (`Header` dialog) | `/api/admin/session` (server-verified, `no-store`) | Same filtered list, route-keyed icons |
| Dashboard module shortcuts | Same filtered list, dashboard excluded | Only permitted modules appear |

- Restricted modules are **omitted, never disabled**, so their existence is not advertised.
- While the role is unknown no module link renders, so an inaccessible module never flashes before the check completes.
- A failed or tampered session probe yields no links in production (the demo preview role only in demo mode). The probe is display-only: every route and mutation is authorised again on the server.
- Sprint 1C added the `staff` entry (`Staff Management`, `/admin/staff`, `staff.manage`) at the end of the Full Admin list. The Operational Admin list remains **exactly** Bookings and Reviews, asserted by a test.

## 10. Sprint 1B — Production/Demo Separation

`NEXT_PUBLIC_DEMO_MODE` remains the only demo control, and it never grants production access.

| | Demo (`true`) | Production (`false`) |
| --- | --- | --- |
| Public site / preview | Unchanged | Unchanged |
| Demo workspace entry | Available, labelled simulated | Removed; the `sessionStorage` flag is inert |
| `/admin/*` without a session | Demo workspace renders (no database read) | Redirect to `/admin/login?next=<validated>` |
| Real sign-in | Works when Supabase is configured and a profile is active | Required |
| Missing Supabase configuration | Notice; demo stays clearly labelled | Fail closed: no admin content, no demo fallback |
| Business data | In-memory mock, resets on refresh | Same code, mutations fail closed; notice shown |
| Admin caching | `private, no-store, max-age=0` | Same |

`src/lib/features.ts` is the single place describing backend availability (`dataBackendState`, `dataBackendNotice`), consumed once in the console shell. Sprint 1C does not change this: staff management is durable, but bookings, reviews, enquiries, newsletter, content, media and settings remain demo-only and are labelled as such.

## 11. Sprint 1C — Staff Management

Route `/admin/staff`, Full Admin only, reusing the existing design system (`.panel`, `.table-wrap`, `.record-row`, `.badge`, `.field`, `.checkbox`, `.dialog`, `.notice`, `.form-grid`). No CSS was added.

Capabilities:

- **Account list** — display name, email, role, active/disabled status, created date, available actions. Actions for the signed-in administrator's own row are disabled in the UI (and refused by the database).
- **Invite** — email + role selection, inline validation, loading state, honest success/error feedback, duplicate and existing-account handling.
- **Role change** — confirmation dialog with current role, new role, a required reason, and an explicit acknowledgement when promoting to Full Admin.
- **Suspend / restore** — confirmation dialog with a required reason and an explicit acknowledgement; the dialog states that provider sessions are not revoked.
- **Activity log** — recent audit history (when, action, account, detail, reason), loaded on demand.
- **Accessibility** — native `<dialog>` with focus management and Escape handling, labelled fields and table headers with screen-reader captions, `aria-busy` during mutations, loading/disabled states, keyboard-operable controls, clear validation feedback, and a scrollable table wrapper so narrow viewports do not overflow.

Server-side controls repeated in every action (never relying on the UI): verified session → `staff.manage` → origin check → rate limit → validation → trusted RPC. Errors are mapped to a small taxonomy (`StaffErrorCode`) so raw SQL text and provider messages never reach the browser.

Operational Admins are excluded from the module, the navigation entry and the API by the single `staff.manage` registry entry; `/api/admin/staff` returns `403` for them and page routes render the access-denied state.

## 12. Sprint 1C — Invitations and Account Lifecycle

Supabase Auth and the application database cannot share a transaction, so the lifecycle is explicit rather than pretend-atomic:

| State | Meaning | Access granted |
| --- | --- | --- |
| `pending` | Invitation row exists; email not yet sent | None (no profile) |
| `sent` | Auth user exists; email queued | None (no profile) |
| `accepted` | Invitee verified; profile created from the invited role | Administrator access with the invited role |
| `failed` | Provider rejected, or the email could not be sent | None; retry is safe |
| `revoked` | Reserved for a future withdrawal flow | — |

Flow: `staff_create_invitation` (refuses duplicates, existing profiles, existing auth accounts and invalid addresses; bans one outstanding invitation per address) → `auth.admin.inviteUserByEmail` through the server-only elevated client → `staff_mark_invitation(sent|failed)` → on acceptance, `staff_complete_invitation` creates the profile from the invitation row and marks it accepted (idempotent).

Honesty rules: a failure at the email step is recorded as `failed` and reported as `invite_failed`; a failure recording the outcome is reported as `partial_failure` (the email went out, state unrecorded, retry reconciles); no success message is shown unless the operation reached its intended lifecycle state. The role always comes from the invitation row, never from the caller, and never defaults to Full Admin. Acceptance requires the verified address to match the invitation (`STAFF_EMAIL_MISMATCH`).

Reconciliation happens in `signInAdmin` and in `/admin/auth/callback` (which now also handles `type=invite`), and can never block a redirect — a failure simply leaves the account with no role.

**Email limitations:** the built-in Supabase Auth email service is quota-limited and its default sender is unsuitable for production deliverability. Custom SMTP must be configured before invitations or password recovery are relied upon. Brevo is deliberately not integrated in Phase 1.

## 13. Sprint 1C — Audit Logging

`public.audit_events` (see §15 for the full column list) is the append-only administrative audit log.

- **Written only by trusted functions**, in the same transaction as the change they record — a privileged change cannot succeed without its event.
- **Readable only by Full Admins** (one `select` policy using `private.is_full_admin()`); no client write access of any kind.
- **Immutable**: a `before update or delete` trigger raises for every role, including the table owner. A future retention job must disable it in its own reviewed migration.
- **Database timestamps** (`now()`) and **server-generated correlation ids**; the actor is the verified administrator, and `NULL` only for reviewed break-glass SQL run by a database owner.
- **Payload discipline**: identifiers, roles, account state, email and the operator's reason — never credentials, tokens, secrets or customer records. Size-capped (8 KiB per state object, 500 characters of reason).

Recorded actions: `staff.invited`, `staff.invitation_sent`, `staff.invitation_failed`, `staff.invitation_accepted`, `staff.provisioned`, `staff.role_changed`, `staff.suspended`, `staff.restored`. The reviewed bootstrap scripts (`supabase/bootstrap/001`–`004`) write the corresponding events for break-glass SQL, including `staff.provisioned` at first provisioning.

`private.insert_audit_event(...)` is the single write path, designed so Phase 2 booking operations and Phase 3 review moderation can record events without a second mechanism.

## 14. Sprint 1C — Security Hardening

| Control | Implementation |
| --- | --- |
| Server-side role + capability checks | `requireAdminRole(["full_admin"])` plus `hasPermission(role, "staff.manage")` per action |
| Origin validation | `checkRequestOrigin` compares `Origin` with `Host`, `X-Forwarded-Host` and `SITE_URL` (request-relative, so preview deployments work) |
| CSRF | Next.js Server Actions already reject cross-origin submissions; the explicit origin check documents and reinforces that contract for route handlers too. No redundant double-submit token was added |
| Input validation | Shared pure validators (`validateInvitationInput`, `validateReason`, `isAssignableRole`) on the server; the UI reuses them for immediate feedback |
| Request size limits | Reason ≤ 200 characters; no large bodies accepted; the staff API has no write verb |
| Rate limiting | 10 invitations / 15 min, 30 other staff changes / 15 min, per acting account (`src/lib/security/rate-limit.ts`). In-process and therefore defence in depth, not a distributed limit |
| Non-sensitive errors | `StaffErrorCode` taxonomy with fixed messages; raw SQL/provider text is mapped, never forwarded |
| Idempotency | Invitation lifecycle keyed on address; invitation completion idempotent; no-op role/status changes reported instead of "succeeding" |
| Transactional audit | Change + audit event in one function/transaction under a transaction-scoped advisory lock |
| Elevated credentials | Server-only module, key-shape validation (rejects a pasted publishable key), no logging, `persistSession: false`, refuses to run in a browser, never in a `NEXT_PUBLIC_*` variable |
| Invariant enforcement | Last active Full Admin, no self role changes, no self suspension/restoration, optimistic concurrency on stale writes |
| Provider vs application revocation | Disabling denies authorisation on the next verified request; it is documented as **not** provider-level multi-device revocation |

## 15. Consolidated Database Schema

**Types and tables**

| Object | Kind | Columns / notes |
| --- | --- | --- |
| `public.admin_role` | enum | `full_admin`, `operational_admin`; no default |
| `public.admin_profiles` | table | `user_id` PK/FK, `role`, `display_name`, `email` (1C), `created_at`, `updated_at`, `created_by`, `disabled_at` |
| `public.admin_invitations` | table (1C) | `id`, `email` (normalised, lower-case), `role`, `status` (`pending/sent/accepted/failed/revoked`), `invited_by`, `auth_user_id`, `correlation_id`, `failure_reason`, `created_at`, `updated_at`, `sent_at`, `accepted_at` |
| `public.audit_events` | table (1C) | `id` identity, `actor_id`, `action`, `entity_type`, `entity_id`, `before_state`, `after_state`, `reason`, `correlation_id`, `created_at` |

**Functions**

| Function | Schema | Security | Purpose |
| --- | --- | --- | --- |
| `current_admin_role()` | `private` | definer, `search_path = ''`, execute → `authenticated` | Caller's active role or `NULL` |
| `is_full_admin()` | `private` | definer, as above | `true` only for an active Full Admin |
| `touch_admin_profiles()`, `touch_admin_invitations()` | `private` | invoker, trigger-only | Maintain `updated_at` |
| `audit_events_immutable()` | `private` | invoker, trigger-only | Block update/delete on audit history |
| `insert_audit_event(...)` | `private` | definer, revoked from all API roles | Single audit write path |
| `staff_lock()` | `private` | definer, revoked | Transaction-scoped advisory lock for staff changes |
| `active_full_admin_count()` | `private` | definer, revoked | Active Full Admin count |
| `assert_active_full_admin(uuid)` | `private` | definer, revoked | Re-validate the acting administrator in-transaction |
| `staff_create_invitation(...)`, `staff_mark_invitation(...)`, `staff_complete_invitation(...)`, `staff_change_role(...)`, `staff_set_disabled(...)` | `public` | definer, `search_path = ''`, **execute → `service_role` only** | Staged invitation lifecycle, role change and suspension/restoration, each with its audit event |

**Indexes**: `admin_profiles (role) where disabled_at is null`; `admin_profiles (lower(email)) where email is not null`; `admin_invitations (lower(email)) where status in ('pending','sent')` (unique); `admin_invitations (status, created_at desc)`; `audit_events (created_at desc)`, `(entity_type, entity_id, created_at desc)`, `(actor_id, created_at desc)`.

**Why the callable staff functions live in `public`**: the Data API only resolves schemas in its `db-schemas` setting, so a `private` function is unreachable even for the server's elevated client. Exposing `private` would be worse; the entry points therefore sit in `public` and are protected by `EXECUTE` privileges (revoked from `PUBLIC`, `anon`, `authenticated`; granted to `service_role`), with all internal machinery in `private`.

## 16. Complete SQL Migration Inventory

Migrations are applied manually, after review, in filename order. **None has been applied to the hosted project by this work.**

| # | File | Scope | Purpose | Applied? |
| --- | --- | --- | --- | --- |
| 1 | `supabase/migrations/20261010120000_admin_profiles.sql` | 1A | `private` schema, `admin_role` enum, `admin_profiles` table, indexes, `updated_at` trigger | **No** |
| 2 | `supabase/migrations/20261010120100_admin_profiles_rls.sql` | 1A | RLS enable, grants, `current_admin_role()` / `is_full_admin()`, two read policies, no write policy | **No** |
| 3 | `supabase/migrations/20261011120000_admin_profiles_email.sql` | 1C | `admin_profiles.email`, backfill from `auth.users`, lookup index (forward-only) | **No** |
| 4 | `supabase/migrations/20261011120100_audit_events.sql` | 1C | `audit_events`, constraints, indexes, append-only trigger, RLS + Full Admin read policy | **No** |
| 5 | `supabase/migrations/20261011120200_admin_invitations.sql` | 1C | Invitation lifecycle table, one-outstanding-per-address index, `updated_at` trigger, RLS + Full Admin read policy | **No** |
| 6 | `supabase/migrations/20261011120300_admin_staff_functions.sql` | 1C | `private` helpers + five `public.staff_*` functions, `service_role`-only, transactional change + audit | **No** |

Supporting, non-migration SQL:

| Path | Purpose | Status |
| --- | --- | --- |
| `supabase/bootstrap/001_provision_full_admin.sql` | Provision the first Full Admin (placeholders start `NULL`; refuses to overwrite; writes an audit event) | Reviewed, **not run** |
| `supabase/bootstrap/002_provision_operational_admin.sql` | Provision an Operational Admin (same safety properties) | Reviewed, **not run** |
| `supabase/bootstrap/003_disable_restore_admin.sql` | Break-glass suspension/restoration with explicit confirmation flags, one-row assertions and audit events | Reviewed, **not run** |
| `supabase/bootstrap/004_change_admin_role.sql` | Deliberate role change with `confirm_change`, single primary key, one-row assertion and an audit event | Reviewed, **not run** |
| `supabase/tests/admin_profiles_rls.sql` | Sprint 1A policy checks | **NOT EXECUTED** |
| `supabase/tests/sprint_1c_staff_security.sql` | Sprint 1C RLS, privilege, immutability, invitation-lifecycle and last-Full-Admin checks | **NOT EXECUTED** |

Sprint 1A migrations were **not** rewritten by Sprint 1C; the email column is added by a forward migration, and nothing in 1C is destructive.

## 17. Supabase Dashboard Configuration

- **Project** — existing project (West EU / Ireland), owner-held. The URL and publishable key are not reproduced in this repository.
- **Authentication → URL Configuration → Site URL** — `http://localhost:3000` during development; the verified production origin only once the domain is cut over.
- **Redirect URLs** — every origin that must receive a recovery or invitation link, e.g. `http://localhost:3000/admin/auth/callback`. Vercel previews must be added explicitly; wildcard hosts (including `*.vercel.app`) are deliberately not trusted.
- **Email templates** — recovery and invitation links must use the default `{{ .ConfirmationURL }}` (or `{{ .TokenHash }}` with `type=recovery` / `type=invite`); both are handled by `/admin/auth/callback`.
- **SMTP** — the default Supabase email service is rate-limited and not production-grade. Configure custom SMTP before staff rely on recovery or invitations (Brevo integration is deferred).
- **API keys** — the publishable key is used by the browser; the secret/service-role key is used only by the server (see §18).

## 18. Environment Variables

| Variable | Visibility | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public (inlined at build) | yes for real auth | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | yes for real auth | Publishable project key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | optional fallback | Legacy anon key for older projects |
| `NEXT_PUBLIC_DEMO_MODE` | public | no (defaults on) | `false` disables the demo workspace and requires real administrator authentication |
| `SITE_URL` | server | production, and for recovery/invitations on any non-loopback host | Verified origin used to build auth redirect and invitation links |
| `SUPABASE_SECRET_KEY` | **server only** (1C) | for staff invitations | Modern Supabase secret key used by `src/lib/supabase/admin.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** (1C) | legacy alternative | Legacy service-role key, still accepted |

Rules: no privileged key may ever appear in a `NEXT_PUBLIC_*` name; the elevated module validates the key *shape* (rejecting a pasted publishable key) and never logs or returns it; `NEXT_PUBLIC_*` values are inlined at build time, so changing `NEXT_PUBLIC_DEMO_MODE` requires a redeploy. `.env.local` is git-ignored and `.env.example` contains placeholders and comments only.

## 19. Initial Full Admin Provisioning

1. Supabase dashboard → **Authentication → Users → Add user** (or Invite) for the administrator's own address. Never a shared account.
2. Copy that user's UUID.
3. In `supabase/bootstrap/001_provision_full_admin.sql`, replace the `target_user` placeholder (it starts `NULL` and the statement refuses to run until it is set) and run it once. It refuses an id with no `auth.users` row, refuses to overwrite an existing profile, asserts the insert succeeded, and now writes a `staff.provisioned` audit event.
4. Confirm with the verification query at the end of the file: exactly one active `full_admin` row.
5. Sign in at `/admin/login`; the workspace badge should read *Full administrator* and `/admin` should render.

`created_by` is `NULL` when run from the SQL editor (no end-user JWT); that is expected. Provisioning must be performed by a trusted project owner. There is no application endpoint that accepts a role.

## 20. Operational Admin Provisioning

**Preferred (Phase 1C):** sign in as a Full Admin, open `/admin/staff`, **Invite an administrator**, choose *Operational Admin*. The invitee receives a Supabase invitation email, accepts it, and their profile is created from the invited role with `staff.invited` / `staff.invitation_sent` / `staff.provisioned` events in the activity log. Duplicate invitations, existing profiles and existing auth accounts are refused with clear messages; a failed email is recorded as failed and creates no access.

**Break-glass (reviewed SQL):** `supabase/bootstrap/002_provision_operational_admin.sql`, with the same placeholder guards as `001`, now also writing an audit event.

**Changing a role:** use the staff console (preferred) — it requires a reason, refuses self-changes, refuses removal of the last active Full Admin and audits the change. The break-glass alternative is `004_change_admin_role.sql`, which requires an explicit `confirm_change` flag, targets one primary key, asserts exactly one row changed and writes an audit event.

**Suspending/restoring:** prefer the staff console (reason + confirmation + audit + last-Full-Admin protection). Break-glass: `003_disable_restore_admin.sql`, which requires an explicit confirmation flag per operation and writes an audit event. Prefer suspension over deletion — there is no delete path, and `admin_profiles.user_id` references `auth.users` with `ON DELETE RESTRICT`.

## 21. Complete Role Permission Matrix

| Permission | `full_admin` | `operational_admin` | Notes |
| --- | --- | --- | --- |
| `dashboard.read` | Yes | **No** | Operational Admin is redirected to `/admin/bookings` |
| `bookings.read` | Yes | Yes | Module exists (demo data) |
| `bookings.manage` | Yes | Yes | Mutation-level enforcement lands with Phase 2 persistence |
| `reviews.read` | Yes | Yes | |
| `reviews.moderate` | Yes | Yes | Approve/reject (demo, consent-gated) |
| `reviews.reply` | Yes | Yes | Declared; no reply UI yet |
| `reviews.override` | Yes | **No** | Declared; no override mutation or audit yet |
| `enquiries.manage` | Yes | **No** | |
| `newsletter.manage` | Yes | **No** | |
| `content.manage` | Yes | **No** | |
| `media.manage` | Yes | **No** | |
| `settings.manage` | Yes | **No** | |
| `staff.manage` | Yes | **No** | **Implemented in 1C** — `/admin/staff`, `/api/admin/staff`, all staff RPCs |
| `email.manage` | Yes | **No** | Declared for the later inbox/composer phase |

Unknown, missing or client-supplied roles resolve to **no permissions**. The effective permission set is derived solely from `admin_profiles.role`, read server-side under RLS on every request.

## 22. Administrative Routes and Access Rules

| Route key | Path | Permission | Full Admin | Operational Admin | Anonymous |
| --- | --- | --- | --- | --- | --- |
| `dashboard` | `/admin` | `dashboard.read` | allowed | **redirect** → `/admin/bookings` | 307 → `/admin/login` |
| `bookings` | `/admin/bookings` (`/<id>`) | `bookings.read` | allowed | allowed | redirect |
| `enquiries` | `/admin/enquiries` (`/<id>`) | `enquiries.manage` | allowed | **forbidden** | redirect |
| `reviews` | `/admin/reviews` | `reviews.read` | allowed | allowed | redirect |
| `newsletter` | `/admin/newsletter` | `newsletter.manage` | allowed | **forbidden** | redirect |
| `content` | `/admin/content` (`/<module>/<id>`) | `content.manage` | allowed | **forbidden** | redirect |
| `media` | `/admin/media` (`/<id>`) | `media.manage` | allowed | **forbidden** | redirect |
| `settings` | `/admin/settings` | `settings.manage` | allowed | **forbidden** | redirect |
| `staff` | `/admin/staff` | `staff.manage` | allowed | **forbidden** | redirect |

Public (pre-authorisation) admin routes: `/admin/login`, `/admin/reset-password`, `/admin/set-password`, `/admin/auth/callback`.

API endpoints: `/api/admin/session` → `401` without an active administrator; `/api/admin/staff` → `401` unauthenticated, `403` without `staff.manage`, otherwise the account list or (`?events=1`) the audit history, always `Cache-Control: private, no-store`.

## 23. Authentication and Staff User Flows

**Full Admin sign-in** — `/admin/login` → `signInAdmin` → password check → active profile required → `resolveLoginDestination` (Permitted `?next=` or `/admin`) → console with all nine entries.

**Operational Admin sign-in** — same path; lands on `/admin/bookings`; navigation shows exactly Bookings and Reviews; direct navigation to any Full-Admin module renders the access-denied state.

**Invited administrator** — Full Admin sends an invitation → invitee receives the Supabase email → link opens `/admin/auth/callback` (`code` or `type=invite` token) → session established → reconciliation creates the profile from the invited role → `/admin/set-password` → sign-in with the invited role. If the invitee instead signs in with a password later, `signInAdmin` performs the same reconciliation before denying a profile-less session.

**Password recovery** — `/admin/reset-password` → identical feedback for every address → email link → callback → `/admin/set-password` (requires an active administrator profile) → `/admin?notice=password-updated`.

**Sign out** — from the desktop sidebar, the mobile menu or the header; ends the Supabase session and returns to `/admin/login`.

**Role change / suspension** — applied in the database with an audit event; the affected administrator experiences it on their **next verified request** (role re-read, or profile no longer resolving).

No flow creates customer accounts. Every flow that fails (missing configuration, missing profile, disabled profile, unknown role, denied origin, rate limit, provider error, stale write) fails closed with a specific, non-sensitive message.

## 24. Audit Events and Security Controls

**Event vocabulary** (all written transactionally by the trusted functions, or by reviewed bootstrap SQL):

| Action | Trigger | Payload |
| --- | --- | --- |
| `staff.invited` | Invitation created | email, role, status |
| `staff.invitation_sent` | Auth accepted the invite | status before/after |
| `staff.invitation_failed` | Provider rejection or unconfigured email | non-sensitive reason |
| `staff.provisioned` | Profile created (invitation accepted, or bootstrap provisioning) | role, email, invitation id |
| `staff.invitation_accepted` | Invitation completed | status before/after |
| `staff.role_changed` | Role changed (console or break-glass) | previous role, new role, active flag, reason |
| `staff.suspended` / `staff.restored` | Suspension / restoration | role, active flag, reason |

**Control summary**

- Authentication: Supabase cookie sessions, token re-validated with `getUser()`, no public registration, generic failure messages.
- Authorisation: central permission registry, server-side route decisions, capability checks per mutation, database re-validation of the actor inside the transaction.
- Mutation protection: origin verification, rate limiting, input validation, size caps, idempotency, transactional audit.
- Data protection: RLS everywhere, narrow policies, no client writes, non-exposed `private` internals, `service_role`-only privileged functions, immutable audit history.
- Credential protection: no privileged key in the browser bundle or any `NEXT_PUBLIC_*` variable, no secret in logs/errors, `.env.local` git-ignored.
- Browser/transport headers: `Cache-Control: private, no-store` on `/admin` (proxy and `next.config.ts`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, restrictive `Permissions-Policy`, `poweredByHeader: false`.
- Role boundaries declared before implementation (`reviews.override`, `email.manage`) so they cannot drift.

## 25. Error Handling and Failure Recovery

| Failure | Behaviour |
| --- | --- |
| Supabase configuration missing/malformed | Fail closed; safe configuration notice; no demo fallback in production |
| No session on a protected route | `307` to `/admin/login?next=<validated same-origin path>` |
| Session without an active profile | Session ended at sign-in; generic message |
| Disabled profile | Resolves to no identity; access denied on the next request |
| Unknown/None role value | No permissions; route forbidden |
| Denied route | Access-denied state with the module name and a link to the landing page; no module data fetched |
| Unknown route | Not-found state; never a privileged fallback |
| Missing profile table / RLS denial / transport error | Fails closed (treated as "not an administrator") |
| Invitation email failure | Recorded as `failed` with a non-sensitive reason; reported as a failure; no access created |
| Invitation state not recorded after a successful send | Reported as `partial_failure`; retry reconciles the same invitation |
| Provider/DB error in a staff mutation | Mapped to the error taxonomy; raw text never surfaced; no success reported |
| Concurrent staff edit | `409`-class conflict: reload and review |
| No-op role/status change | Reported as unchanged (not as success) |
| Rate limit exceeded | Clear "wait a few minutes" message; no operation performed |
| Stale client-side navigation | No effect: authorisation is re-evaluated server-side on every request |
| Business-data write in production | Fails closed with the "not connected" notice; nothing reported as saved |

## 26. Automated Test Results

`npm run check` = `typecheck && lint && test && build`. Results on the final Phase 1 code, executed 10 October 2026 (Node 22, Windows, Git Bash):

| Command | Result |
| --- | --- |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | **Pass** |
| `npm run lint` (`eslint .`) | **Pass** — 0 errors; 1 pre-existing warning in `.opencode/plugins/graphify.js` (tooling file, not application source) |
| `npm test` (`node --import tsx --test tests/*.test.ts`) | **Pass** — **106 tests, 0 failures** across 8 files |
| `npm run build` (`next build --webpack`) | **Pass** — `/admin/[[...segments]]`, `/admin/auth/callback`, `/api/admin/session`, `/api/admin/staff`, `/api/[...path]`, `/[...slug]` dynamic; `ƒ Proxy (Middleware)` |

Test files and emphasis: `tests/auth.test.ts` (identity resolution, configuration failure, redirect safety), `tests/permissions.test.ts` (role matrix, route boundaries, navigation, staff capability), `tests/staff.test.ts` (validation, invariants, error mapping, audit presentation), `tests/repository.test.ts` and `tests/rules.test.ts` (booking lifecycle and rules), `tests/website-content.test.ts`, `tests/brand-highlight.test.ts`, `tests/dotted-glow.test.ts` (content and presentation).

Growth by sprint: 80 (1A) → 90 (1B) → **106** (1C).

**HTTP smoke checks** (built server, `.env.local` with `NEXT_PUBLIC_DEMO_MODE=false` and Supabase public configuration; no session):

| Request | Result (1C run) |
| --- | --- |
| `GET /api/admin/staff` | **401** `{"code":"unauthenticated","message":"Sign in with an administrator account."}` |
| `GET /admin/staff` | **307** → `/admin/login?next=%2Fadmin%2Fstaff` |
| `GET /admin/login` | **200** |
| `GET /` | **200** — public site unchanged |
| `Cache-Control` on `/admin/staff` | `private, no-store, max-age=0` |

Earlier sprint runs additionally covered demo-mode `200`s for the console routes, `401` from `/api/admin/session`, and production-mode `307`s for `/admin`, `/admin/bookings`, `/admin/reviews`, `/admin/settings`, `/admin/content`, `/admin/media`, `/admin/newsletter`, `/admin/enquiries` and `/admin/unknown`.

## 27. Database/RLS Verification Results

**No database test has been executed.** There is no PostgreSQL server and no Supabase CLI in the implementation environment, and hosted migrations are deliberately not applied by this work.

| Test file | Covers | Status |
| --- | --- | --- |
| `supabase/tests/admin_profiles_rls.sql` (1A) | RLS enabled, exactly two read policies and no write policy, helper privileges, no `USING (true)`, no client insert/update/delete, Operational Admin cannot read another profile or promote itself | **NOT EXECUTED** |
| `supabase/tests/sprint_1c_staff_security.sql` (1C) | RLS on `admin_invitations`/`audit_events`; client writes refused; Operational Admin cannot read the audit log; privilege checks (`anon`/`authenticated` cannot execute `staff_*`, `service_role` can, `authenticated` cannot write audit history); actor validation (operational, missing, suspended actors refused with no audit row); role-change success + audit payload (actor, before/after role, reason, correlation id, timestamp, no credential material), self-change, no-op and stale-write refusals; last-active-Full-Admin protection for demotion and suspension; repeated disable/restore; full invitation lifecycle including duplicate/existing-account/invalid-address refusals, failure recorded honestly, idempotent acceptance, forged-address refusal; audit immutability against update and delete; suspended Full Admin resolving to no role | **NOT EXECUTED** |

What *has* been verified without a database: the TypeScript invariants, error mapping and route/permission decisions (unit tests), the SQL by static review, and the unauthenticated HTTP behaviour of the built application. Passing those does **not** prove hosted RLS. The database tests must be run against a disposable local/test database (never the hosted project) before Phase 1 is considered verified.

## 28. Manual QA Checklist

**Demo preview** (`NEXT_PUBLIC_DEMO_MODE=true`, no Supabase values needed)

1. `/` and every public route render unchanged; the preview banner is present.
2. `/admin/login` → **Enter Demo Workspace** opens the full console; all nine navigation items appear in the demo role.
3. Existing bookings, reviews, content, media and settings screens behave exactly as before; the booking lifecycle (confirmation gate, cancellation reason, version conflict) is unchanged.

**Production-mode, unauthenticated** (`NEXT_PUBLIC_DEMO_MODE=false`)

4. `/admin`, `/admin/bookings`, `/admin/staff` and any other protected path redirect to `/admin/login?next=<validated path>`; no demo entry is offered; a configuration notice appears if Supabase is unconfigured.
5. `GET /api/admin/session` and `GET /api/admin/staff` return `401`.

**Full Admin** (Sprint 1A activation complete)

6. Sign in → lands on `/admin`; badge reads *Full administrator*; all nine modules visible in the sidebar and mobile menu; the "sample data" notice is shown.
7. `/admin/staff`: account list shows name, email, role, status and dates.
8. Invite a test address as *Operational Admin* → success message; the invitation appears as *Awaiting acceptance*; activity log shows `staff.invited` and `staff.invitation_sent`.
9. Attempt to invite the same address again, an existing administrator, and an invalid address → each shows a specific error and creates nothing.
10. Change a role → confirmation dialog requires a reason; promoting to Full Admin additionally requires the acknowledgement; the activity log gains `staff.role_changed` with before/after roles.
11. Suspend and then restore an account → each requires a reason and confirmation; the list status updates; the activity log gains `staff.suspended` / `staff.restored`.
12. Attempt to suspend or demote the **last active Full Admin** → refused with a clear message.
13. Confirm the actions on your own row are disabled (and that a hand-crafted request is refused server-side).
14. Invite with the elevated key removed from the environment → invitation fails closed with the "not configured" message and no access is created.
15. Sign in as the invited Operational Admin → lands on `/admin/bookings`; sidebar and mobile menu show exactly Bookings and Reviews.
16. As that account, open `/admin/staff` and `/admin/settings` directly → access-denied state, no module content; `GET /api/admin/staff` returns `403`.
17. Sign out from both the sidebar and the mobile menu → returns to `/admin/login`; protected routes stop rendering.
18. Narrow viewport (~320–440px): the staff table scrolls horizontally inside its wrapper, dialogs remain usable, no page-level horizontal overflow.

## 29. Known Limitations

- **Nothing is hosted-verified.** No migration applied, no live sign-in, no real invitation, no database test executed (§27, §30).
- Denied **pages** return `200` with the access-denied state; only API endpoints set `401`/`403`.
- The business-data layer is still the in-memory demo store; bookings, enquiries, reviews, CMS, media and settings are not durable and fail closed in production.
- `reviews.override` has no mutation, mandatory-reason prompt or audit record yet; the permission is withheld from Operational Admins so the boundary cannot drift.
- `reviews.reply` has no reply UI yet.
- Rate limiting is per process (not distributed) and applies to staff mutations only; public submissions have no abuse controls yet.
- Suspension denies authorisation on the next verified request but does **not** revoke provider sessions across devices; there is no "sign out everywhere".
- Invitation and recovery email depends on the Supabase project's SMTP; the shared service is quota-limited and not production-grade. Brevo is deferred.
- `audit_events` has no retention/export policy; it is intentionally immutable, so retention needs a reviewed migration that disables the trigger deliberately.
- The mobile navigation role probe is display-only (it cannot grant access, but it does reveal the signed-in user's own role).
- Demo mode `200`s the console without a session; that is by design and grants nothing in production, but it means demo deployments should never point at production data.
- No CSRF token was added beyond Next.js's built-in Server Action origin protection and the explicit origin check.

## 30. Production Activation Checklist

1. Review the six migrations in `supabase/migrations/` in order; confirm the Sprint 1A files are already applied and only 3–6 are pending.
2. Apply the pending migrations (`supabase migration list` → `supabase db push --dry-run` → `supabase db push`, or the SQL editor once per file). Never `supabase db reset` against a hosted project.
3. Run the read-only verification queries in `SPRINT_1C_SECURITY_STAFF_AUDIT.md` §9: RLS enabled on all three tables, one read policy each on the new tables and no write policy, `authenticated` cannot execute `staff_*`, `service_role` can.
4. Set environment variables: the two public Supabase values, `NEXT_PUBLIC_DEMO_MODE=false`, `SITE_URL=<verified origin>`, and the server-only `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`).
5. Configure Supabase Auth: Site URL, redirect allow-list including `/admin/auth/callback`, email templates using the default confirmation URL, and custom SMTP.
6. Provision or verify the first Full Admin (`001` or the staff console once it is reachable).
7. Run both SQL test files against a **disposable local** database and record the result; do not treat the unit tests as a substitute.
8. Perform the manual QA checklist (§28) with a real Full Admin and a real Operational Admin.
9. Confirm the audit log records the real invitation, role change and suspension, and that no credential material appears in any payload.
10. Redeploy after changing `NEXT_PUBLIC_DEMO_MODE` (it is inlined at build time).

## 31. Outstanding Requirements

Phase 1 backlog (not started, by instruction):

1. Hosted activation and a live end-to-end confirmation for both roles, including a real invitation round-trip.
2. Database/RLS test execution against a disposable database, wired into the check routine where tooling allows.
3. True `403` page semantics if a status-code response is required for denied routes.
4. Distributed rate limiting and public-submission abuse controls.
5. Provider-level session revocation ("sign out everywhere") if required by operations.
6. Audit retention/export policy and, if needed, a reviewed retention migration.
7. Review phase: replies, edited publication versions, moderation history, and the emergency override mutation with mandatory reason + audit.
8. `email.manage` phase: staff email inbox/composer (Brevo + Cloudflare) — explicitly deferred.
9. Replace `src/lib/features.ts` constants with real capability detection once a durable backend exists.
10. A second administrator account/recovery story for a locked-out sole Full Admin (currently break-glass SQL).

## 32. Phase 2 Readiness and Dependencies

Phase 1 provides the security substrate Phase 2 needs, and nothing more:

**Available to Phase 2**

- Verified identity + role resolution (`getCurrentAdmin`, `requireAdminRole`) with a stable denial model.
- A central permission registry where new capabilities and routes are declared once.
- `bookings.manage` already scoped to both roles for mutation-level authorisation.
- `private.insert_audit_event(...)` as the single, transactional audit write path.
- A reviewed pattern for privileged server operations: server-only client, origin check, rate limit, validation, `SECURITY DEFINER` function with `service_path=''`, `service_role`-only execution, transactional audit.
- RLS conventions (`private` helpers, narrow policies, no client writes) to extend to booking, review and media tables.

**Dependencies before real booking persistence**

1. Apply migrations and complete activation (§30), including the database tests.
2. Decide whether denied pages need `403` statuses before exposing real booking data on those routes.
3. Move rate limiting to a shared store once mutations become durable.
4. Define and implement retention for booking records (SRS: 12 calendar months) and customer photos (90 days) before storing real data.
5. Add mutation-level authorisation for every write, not just route-level.
6. Extend audit coverage to booking mutations and, later, review moderation, reusing the existing event vocabulary and write path.
7. Configure custom SMTP before customer-facing email exists (Brevo/Cloudflare remain out of Phase 1 scope).
8. Keep customer accounts out of scope: Phase 2 bookings are staff-managed, and no public account creation exists.
