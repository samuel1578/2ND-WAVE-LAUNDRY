# Sprint 1B — Role-Based Administration

**Date:** 10 October 2026
**Status:** **CODE COMPLETE — AWAITING CONFIGURATION.** The role-aware console, server-side route authorisation, filtered navigation and honest demo/production data states are implemented and pass the checks in §9. Real end-to-end verification with a signed-in Operational Admin still requires the Sprint 1A activation steps (migrations applied, first administrator provisioned, Supabase environment variables set) — see `docs/implementation/SPRINT_1A_SUPABASE_AUTH.md` §6.

**Scope:** Sprint 1B only. Booking persistence, review replies/publication versions/audit records, Brevo, Cloudflare email, newsletters, media/CMS persistence and staff-management UI remain out of scope (see §12).

---

## 1. Implementation overview

Sprint 1A delivered Supabase Auth, `admin_profiles`, RLS, server-side role resolution and protected `/admin` routes. Sprint 1B turns that foundation into two properly separated administrator experiences without touching the existing visual design.

Three pieces do the work:

1. **A central permission registry** — `src/lib/auth/permissions.ts`. It owns the permission list, the role→permission mapping, the canonical administrative route table, the least-privileged landing page for each role, and the route decision function. Nothing else compares roles.
2. **Server-side route authorisation** — `src/app/admin/[[...segments]]/page.tsx` resolves the authenticated administrator (Sprint 1A's `getCurrentAdmin`), asks the registry about the requested path, and only then renders a module. Forbidden routes render the existing access-denied state with no module data resolved; unknown routes render the existing not-found state; the dashboard is redirected to the role's landing page.
3. **Role-filtered navigation from the same registry** — the desktop sidebar (`AdminSidebar`) and the mobile console menu (`Header`) both render `adminNavigationFor(role)`. The desktop shell is handed the role by the server-authorised render; the mobile menu asks the server-verified `/api/admin/session` endpoint. Inaccessible modules are omitted, never shown disabled.

Demo mode is untouched: the isolated preview still renders the full console for design review, but it never reaches a database-backed operation (see §7).

## 2. Current role permission matrix

Permissions are grouped by capability, not by component. The registry also declares `staff.manage` and `email.manage` so the Full Admin boundary is explicit for later phases; no module implements them yet and they grant nothing on their own.

| Capability / permission | `full_admin` | `operational_admin` |
| --- | --- | --- |
| `dashboard.read` — main dashboard and analytics | Yes | **No** |
| `bookings.read` | Yes | Yes |
| `bookings.manage` — arrangements, branch, status, cancellation, notes | Yes | Yes |
| `reviews.read` | Yes | Yes |
| `reviews.moderate` — approve / reject (consent-gated in the demo) | Yes | Yes |
| `reviews.reply` — reply drafting boundary for the review phase | Yes | Yes |
| `reviews.override` — emergency override on an already-decided review (mandatory reason + audit when the review backend lands) | Yes | **No** |
| `enquiries.manage` — enquiries and commercial quotes | Yes | **No** |
| `newsletter.manage` | Yes | **No** |
| `content.manage` — Website Content CMS | Yes | **No** |
| `media.manage` — Media Library | Yes | **No** |
| `settings.manage` | Yes | **No** |
| `staff.manage` — declared for the later staff phase | Yes | **No** |
| `email.manage` — declared for the later inbox/composer phase | Yes | **No** |

Unknown, missing or client-supplied role values resolve to **no permissions** (`permissionsFor` returns an empty list), so an unrecognised role can never grant access.

## 3. Canonical administrative route mapping

One table drives authorisation, navigation and shortcuts. Matching respects segment boundaries: a route matches its exact path or a `/`-separated descendant, so `/admin/bookings/42` is Bookings while `/admin/bookingsX` and `/admin/<unknown>` match nothing. `/admin` is treated as the dashboard **root only** — it is never a prefix of nested paths.

| Route key | Path | Required permission |
| --- | --- | --- |
| `dashboard` | `/admin` | `dashboard.read` |
| `bookings` | `/admin/bookings` (`/admin/bookings/<id>`) | `bookings.read` |
| `enquiries` | `/admin/enquiries` (`/<id>`) | `enquiries.manage` |
| `reviews` | `/admin/reviews` | `reviews.read` |
| `newsletter` | `/admin/newsletter` | `newsletter.manage` |
| `content` | `/admin/content` (`/<module>/<id>`) | `content.manage` |
| `media` | `/admin/media` (`/<id>`) | `media.manage` |
| `settings` | `/admin/settings` | `settings.manage` |

Decision outcomes (`resolveAdminRouteAccess`):

| Outcome | Meaning | Rendering |
| --- | --- | --- |
| `allowed` | Role holds the route permission | Module renders |
| `redirect` | Dashboard requested by a role without `dashboard.read` | Server redirect to the role's landing page |
| `forbidden` | Known route, role lacks the permission | Access-denied state; no module data resolved or sent |
| `unknown` | No canonical route matches | Not-found state (never a privileged dashboard fallback) |

Public authentication routes (`/admin/login`, `/admin/reset-password`, `/admin/set-password`, `/admin/auth/callback`) are handled before authorisation and remain reachable. HTTP note: a denied page returns the rendered access-denied state with a 200 status (Next.js pages cannot set 403), but no protected data is fetched or rendered, and every privileged server operation is separately authorised.

## 4. Role-specific login destinations

| Role | Landing page | Behaviour on `/admin` |
| --- | --- | --- |
| `full_admin` | `/admin` | Dashboard renders |
| `operational_admin` | `/admin/bookings` | Server redirects to `/admin/bookings` |

A `?next=` return path is honoured only when the resolved role may reach it; otherwise the landing page is used. The requested URL never grants access, and the destination is restricted to same-origin `/admin` paths by Sprint 1A's `safeAdminPath`. This also applies after a refresh, because the redirect is evaluated on every server render.

## 5. Desktop and mobile navigation behaviour

| Surface | Source of role | Behaviour |
| --- | --- | --- |
| Desktop sidebar (`AdminSidebar`) | Role passed from the server-authorised render | Renders `adminNavigationFor(role)`; also shows the signed-in identifier and the role label |
| Mobile console menu (`Header` dialog) | `/api/admin/session` (server-verified, `no-store`) | Renders the same filtered list, keyed by route so icons stay correct |
| Dashboard module shortcuts | Same filtered list, dashboard excluded | Only permitted modules appear |

- Full Admin: all eight existing items, plus the existing account controls (identifier, role label, theme control, return home, sign out).
- Operational Admin: exactly **Bookings** and **Reviews**. Restricted modules are removed entirely, not disabled.
- Until the role is known, no module link is rendered, so an inaccessible module never flashes before the check completes. A failed or tampered session probe falls back to no links (production) or the demo preview role (demo mode only).
- Icons are keyed by route key (`dashboard`, `bookings`, …) rather than by array position, so filtering cannot mis-assign icons.

## 6. Authentication and authorisation boundaries

- **Identity and role** come from Sprint 1A only: `auth.getUser()` plus the `admin_profiles` row, read under RLS on the server. No duplicated Supabase client, no second role query path.
- **Server is authoritative.** The page resolves the role per request and authorises the route before rendering. `sessionStorage`, `localStorage`, query strings, the demo flag and the client-fetched role are display inputs only.
- **Proxy** still refreshes sessions and redirects unauthenticated visitors away from protected routes when demo mode is disabled (unchanged from Sprint 1A).
- **Denied means denied:** a forbidden route renders the existing access-denied state with the module name, an explanation and a link to the role's landing page; a not-found route renders the existing not-found state. Neither falls back to a privileged view.
- **Role changes take effect on the next request.** Because the role is re-read from the database on every protected render, an administrator whose role changes or whose profile is disabled loses access immediately, regardless of what their browser currently shows. Disabled, missing and unrecognised profiles resolve to no identity and are redirected to sign-in.
- **Client role manipulation grants nothing.** A tampered session response or a hand-written role string cannot reach a module that the server did not authorise.

## 7. Production-versus-demo data behaviour

Sprint 1A made authentication real; it did not make the data layer real. Sprint 1B keeps the two explicitly separate.

| | Demo mode (`NEXT_PUBLIC_DEMO_MODE=true`) | Production (`=false`) |
| --- | --- | --- |
| Console access | Isolated preview; full console for design review | Requires a real session and a permitted role |
| Business data | In-memory mock repository, resets on refresh | Same code, but every mutation fails closed (`src/lib/mock-store.ts` `operation()`) — nothing is written or reported as saved |
| Interface honesty | Existing preview banner and "Demo workspace" badge | Persistent notice: sample records are for layout review, nothing is stored, plus the "Sample data" badge |
| Writes | Interactive demo behaviour preserved | No client-side production write path exists; the existing failure/retry states surface the unavailable backend |

`src/lib/features.ts` is the single place that describes backend availability (`dataBackendState`, `dataBackendNotice`). It is consumed once, in the console shell, instead of scattering conditionals through the modules; when a real backend is connected it becomes a capability check rather than a constant.

No simulated booking confirmation, review publication or CMS save is presented as a durable production operation, and no browser-controlled flag can bypass authorisation.

## 8. Files created and modified

### Created

| Path | Purpose |
| --- | --- |
| `src/lib/auth/permissions.ts` | Permission registry, route table, route decision, landing pages, navigation filter, post-login destination |
| `src/lib/features.ts` | Single feature-availability mechanism for the business-data backend |
| `tests/permissions.test.ts` | 11 tests covering the role matrix, route boundaries, navigation filtering and safe return destinations |
| `docs/implementation/SPRINT_1B_ROLE_BASED_ADMIN.md` | This document |

### Modified

| Path | Change |
| --- | --- |
| `src/app/admin/[[...segments]]/page.tsx` | Server-side per-route authorisation, dashboard redirect for scoped roles, denial states |
| `src/components/admin/admin-app.tsx` | Role from the verified session, denial rendering (no module data), filtered dashboard shortcuts, honest data notice, account identifier; removed the Sprint 1A coarse gate |
| `src/components/shell.tsx` | Route-keyed icons, role-filtered desktop sidebar and mobile console menu, account block in the sidebar |
| `src/lib/content.ts` | `adminNav` now derived from the permission registry (same tuples, single source of labels/hrefs) |
| `src/lib/auth/roles.ts` | Removed the superseded `canAccessAdminModules` gate; documents where route decisions live |
| `src/lib/auth/actions.ts` | Sign-in destination resolved through `resolveLoginDestination` (role-aware, still same-origin only) |
| `src/app/api/admin/session/route.ts` | Returns role, display name, landing page and permissions instead of the obsolete `modulesEnabled` flag |
| `tests/auth.test.ts` | Sprint 1A coarse-gate assertion replaced by the Sprint 1B matrix (now in `tests/permissions.test.ts`) |
| `README.md`, `docs/source/2ND_WAVE_SRS.md`, `docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md`, `docs/IMPLEMENTATION_REVIEW.md` | Role-filtered console recorded as delivered |

No CSS, booking rule, contract or migration file was changed.

## 9. Tests executed and results

Executed 10 October 2026, Node 22, Windows (Git Bash):

| Command | Result |
| --- | --- |
| `npm run typecheck` | **Pass** |
| `npm run lint` | **Pass** (0 errors, 0 warnings) |
| `npm test` | **Pass** — 90 tests, 0 failures (11 new in `tests/permissions.test.ts`) |
| `npm run build` | **Pass** — `/admin/[[...segments]]`, `/admin/auth/callback`, `/api/admin/session` dynamic; Proxy registered |
| HTTP smoke, demo build | `/`, `/admin`, `/admin/bookings`, `/admin/reviews`, `/admin/settings` → `200`; `/api/admin/session` → `401` |
| HTTP smoke, `NEXT_PUBLIC_DEMO_MODE=false` build | `/admin`, `/admin/bookings`, `/admin/reviews`, `/admin/settings`, `/admin/content`, `/admin/media`, `/admin/newsletter`, `/admin/enquiries`, `/admin/unknown` → `307` to `/admin/login?next=<validated>`; login page shows the configuration notice and no demo entry |

New automated coverage (all 17 rows of the role matrix plus navigation):

- Anonymous, unknown-role and `null`-role callers are denied every canonical route and get an empty navigation list.
- Full Admin reaches every canonical route (including nested booking, review and content paths).
- Operational Admin reaches Bookings and Reviews (including `/admin/bookings/<id>`) and is **forbidden** on settings, content, media, newsletter and enquiries.
- Operational Admin is **redirected** from `/admin` to `/admin/bookings`; Full Admin is allowed.
- Route resolution respects segment boundaries (`/admin/bookingsX`, `/admin/reviewsfoo`, `/admin/administrator`, `/adminstrator`, `/admin/<unknown>` and nested unknown paths are all unknown).
- Navigation: Full Admin sees all eight items; Operational Admin sees exactly Bookings and Reviews; restricted items are absent rather than disabled; dashboard shortcuts use the same filtered list.
- Sign-in destination: a permitted `next` is honoured, a non-permitted one falls back to the landing page, and off-site, protocol-relative, public-auth, unknown and empty values never win.
- Role change and disablement are re-evaluated server-side on the next verification.
- Operational Admin does not hold `reviews.override`; Full Admin does.

One regression was found and fixed during this sprint: `/admin` was prefix-matching nested paths, so `/admin/bookings` briefly resolved to the dashboard route. The route matcher now treats `/admin` as an exact-match root, and a test covers it.

### Not executed / not verified

- **No signed-in end-to-end run.** With no Supabase credentials or provisioned administrator in this environment, the HTTP checks above cover the unauthenticated and demo paths only. The authenticated role decisions are covered by the unit tests of the same decision function the page calls, plus static review — not by a live session.
- **No database tests.** Sprint 1B added no migrations; `supabase/tests/admin_profiles_rls.sql` remains **NOT EXECUTED**.
- **No browser, screenshot or visual testing** (excluded by the brief); the owner reviews the interface manually.

## 10. Security limitations

- A denied page returns `200` with the access-denied state, not a `403` status (App Router pages cannot set one). Denial is still server-decided and no protected data is fetched. A future route-handler or proxy-level status could be added if a true 403 is required.
- `reviews.override` is a declared boundary only: there is no override mutation, no mandatory-reason prompt and no durable audit record until the dedicated review phase. The permission is deliberately withheld from Operational Admins now so the boundary cannot drift.
- Authorisation protects *routes*, not the demo repository: with demo mode on, every console module still reads in-memory sample data. There is no production data to protect yet, and real data access stays unconfigured.
- The mobile console menu fetches the role from `/api/admin/session`; that response is display-only and cannot grant access, but it does tell a signed-in administrator their own role (no other account's data).
- Role changes are audited only by provisioning SQL notices; `audit_events` is not implemented.
- Rate limiting, CSRF/origin checks on cookie-authenticated writes and multi-device session revocation remain Sprint 1C work.

## 11. Manual verification checklist

Demo mode (`NEXT_PUBLIC_DEMO_MODE=true`, `npm run dev`):

1. `/admin/login` → **Enter Demo Workspace** opens the full console with all eight navigation items (desktop sidebar and mobile menu).
2. Confirm the existing bookings, reviews, content, media and settings screens behave exactly as before.
3. Confirm the booking lifecycle (confirmation gate, cancellation reason, version conflict) is unchanged.

Production mode (Sprint 1A activation done; `NEXT_PUBLIC_DEMO_MODE=false`):

4. Sign in as a **Full Admin** → lands on `/admin`, sees all eight modules, the "Full administrator" badge, the "Sample data" badge and the preview-data notice.
5. Sign in as an **Operational Admin** → lands on `/admin/bookings`; the sidebar and mobile menu show only Bookings and Reviews; the role label and identifier are shown.
6. As the Operational Admin, open `/admin/settings`, `/admin/content`, `/admin/media`, `/admin/newsletter`, `/admin/enquiries` directly → access-denied state, no module content, and a working link back to Bookings.
7. As the Operational Admin, open `/admin` → redirected to `/admin/bookings`.
8. As the Operational Admin, attempt a booking save → fails closed with the unavailable-backend message; nothing is reported as saved.
9. Change the account's role to `full_admin` in the database and reload the Operational Admin's browser without signing out → the console now shows the wider navigation (role re-read server-side).
10. Set `disabled_at` on the account and reload → redirected to `/admin/login`.
11. Sign out from the sidebar and the mobile menu → returns to `/admin/login` and protected routes no longer render.
12. Spot-check narrow (≈320–440px) and desktop widths in both roles: navigation usable, active item correct, no horizontal overflow, no inaccessible module visible.

## 12. Sprint 1C dependencies

1. Apply the Sprint 1A migrations to the hosted project and provision real administrators, then repeat checklist steps 4–12 for a live end-to-end confirmation.
2. `audit_events` plus actor attribution, starting with emergency review overrides (mandatory reason) and role changes.
3. Staff-management UI (invite, change role, disable) built on `requireAdminRole(["full_admin"])`, replacing the manual provisioning scripts.
4. Origin/CSRF checks and rate limiting on cookie-authenticated writes before any module becomes durable.
5. Booking persistence behind the existing `Repository` contract, with the role checks reused for mutation-level authorisation (`bookings.manage`) rather than route-level only.
6. Reviews phase: persistent replies, edited publication versions, moderation history and the override mutation with audit.
7. True 403 semantics for denied routes if a status-code response is required.
8. Revisit `src/lib/features.ts` when a real backend exists so the availability state is derived from capability rather than configuration.
