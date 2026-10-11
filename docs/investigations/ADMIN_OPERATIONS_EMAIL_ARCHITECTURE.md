# 2ND WAVE — Admin Operations, Reviews & Email Architecture Investigation

**Date:** 10 October 2026
**Scope:** Read-only investigation of the existing 2ND WAVE Laundry Services repository in preparation for administrator roles, booking notifications, review moderation, a Cloudflare inbound inbox, a Brevo custom composer and newsletter campaigns.
**Status:** Investigation only. No code, configuration, schema or infrastructure was modified. No builds, tests or browser sessions were run. No secrets were accessed.

**Decisions recorded (10 October 2026 — documentation updates only, no implementation started):**

1. The two-role admin model (`full_admin`, `operational_admin`) is **formally authorised**. PRD and SRS updated: PRD product goal, PRD §2a (new), PRD excluded-scope note, PRD §7, SRS §1, SRS ADM-01, SRS §6 and the SRS access-control matrix.
2. Business domain confirmed: **`2ndwavelaundry.com`**. Individual mailbox names remain undecided and must not be invented.
3. Hosting: **Vercel during development and testing; production hosting on Cloudflare** once implementation and validation are complete. Next.js runtime compatibility must be confirmed against the chosen Cloudflare product before cutover.
4. Deferred to a later decision (does not block design or Phase 1): mailbox/sender identities, marketing-consent privacy wording, retention periods for mail/reviews/subscribers, and verification of Brevo/Cloudflare/Supabase plan quotas.

The decision log is also recorded in `docs/IMPLEMENTATION_REVIEW.md` (10 October 2026 section).

---

## 1. Executive Summary

The repository is a **frontend-only Next.js preview** of the 2ND WAVE Laundry Services website and administration console. It is a complete, well-structured and well-tested UI implementation, but it has **no backend of any kind**. There is no database, no authentication provider, no email service, no storage service, no Cloudflare integration and no Brevo integration. All data is held in a client-side in-memory store that resets on refresh.

The consequences for the proposed work are absolute rather than incremental:

- **Administrator roles** cannot be added to the existing authentication system, because no real authentication system exists. The role model must be introduced *together with* the first real authentication and authorisation layer, not bolted onto an existing one.
- **Booking alert emails, the Cloudflare inbox, the Brevo composer and newsletter campaigns** cannot reuse an existing email utility, because no email utility exists anywhere in the codebase. Every email capability is greenfield.
- The intended production stack is already documented and should be treated as the integration baseline: **Supabase (Postgres + Auth + RLS) for data and identity, Cloudflare R2 for media, and the Next.js server as the trusted submission and administration boundary** (`docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md` §5, `docs/source/2ND_WAVE_SRS.md` §1). Brevo was explicitly deferred and excluded from the original scope (`docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md` §2, §8; `docs/source/CONTENT LIGHTMODE.md` line 24).

The safest integration strategy is therefore not to extend the mock layer, but to **replace `src/lib/mock-store.ts` behind its existing `Repository` contract with a real server-backed adapter**, while simultaneously introducing real authentication, server-side authorisation and RLS. The mock store already models the correct business rules (status transitions, confirmation gating, cancellation reasons, optimistic version conflicts, idempotency keys, retention display values) and those rules must be preserved, not redesigned.

**Most significant risks, in order:**

1. The admin console is currently gated by a client-side `sessionStorage` flag with no server-side check whatsoever (see §15). This is acceptable for a preview but is a critical vulnerability if this code is deployed with real data behind it.
2. There is no actor attribution on any existing write. Booking history entries record what changed but never who changed it (`src/lib/mock-store.ts:320–329`). Emergency review overrides and all privileged actions require actor attribution from day one.
3. Review moderation currently has no replies, no edited-publication model and no audit trail; the proposal extends it substantially and the current `Lead` record shape will not carry the required data (see §9).

**Recommended first phase:** Phase 1 — Admin Roles and Access Control, implemented as the introduction of real Supabase authentication, an `admin_profiles` table with a `role` column, server-side authorisation on every admin route and mutation, and RLS policies — with the existing demo flag retained only for the preview build.

---

## 2. Repository Architecture Inventory

### CONFIRMED EXISTING

| Concern | Finding | Evidence |
| --- | --- | --- |
| Frontend framework | Next.js **16.3.8**, App Router, React **19.3.0**, React DOM 19.3.0 | `package.json:18–20` |
| Language | TypeScript **6.0.3**, strict mode | `package.json:34`, `tsconfig.json` |
| Styling | Authored responsive CSS (single `globals.css`, ~74 KB), CSS Modules for admin content editors. No Tailwind runtime. | `src/app/globals.css`, `src/components/admin/content/content.module.css` |
| Animation | Motion for React (Framer Motion) **14.0.0** | `package.json:19` |
| Icons | lucide-react **1.52.0** | `package.json:17` |
| Phone validation | libphonenumber-js **1.13.14** (`GH` default region) | `package.json:16`, `src/lib/rules.ts:1–2, 83–88` |
| Theme | next-themes **0.4.6** (system/light/dark) | `package.json:21`, `src/components/shell.tsx:74–100` |
| Other deps | swiper ^14.3.0, three 0.186.1 (pinned but **unmounted**) | `package.json:22–23`, `docs/IMPLEMENTATION_REVIEW.md` §55 |
| Backend / BaaS | **None connected.** Intended: Supabase Postgres/Auth, Cloudflare R2. | `README.md:5`, `docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:67` |
| Data layer | Client-side in-memory store with `useSyncExternalStore`; typed behind a `Repository` interface | `src/lib/mock-store.ts:1–230`, `src/lib/contracts.ts:153–170` |
| API boundary | Single catch-all POST handler that **fails closed** with `503 BACKEND_NOT_CONFIGURED` | `src/app/api/[...path]/route.ts:1–11` |
| Middleware | **None.** No `middleware.ts` exists at the repository root or under `src/`. | Repository-wide search (no matches) |
| Environment | One variable: `NEXT_PUBLIC_DEMO_MODE` (plus optional `SITE_URL` placeholder). No secrets in the repository. | `.env.example` |
| Tests | 5 suites, ~70 tests, Node test runner + tsx; rules, mock repository, website content, policy content, brand highlighting | `package.json:11`, `tests/*.test.ts` |
| Build/check | `npm run check` = typecheck + lint + test + build | `package.json:12` |
| Node engine | `>=22.0.0` | `package.json:38` |
| Hosting | Not configured. PRD names Vercel as intended default. | `docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:67` |

### NOT PRESENT — CONFIRMED ABSENT

- No `@supabase/*`, `@aws-sdk/*`, Brevo/Sendinblue, Resend, SendGrid, Nodemailer or SMTP client in `package.json` or `package-lock.json` dependencies used by `src/`.
- No server actions (`"use server"`) anywhere in `src/`.
- No route handlers other than the failing `src/app/api/[...path]/route.ts` and `src/app/robots.ts`.
- No background workers, queues, cron entries or scheduled job definitions.
- No database migrations, SQL files or schema definitions.
- No audit-log implementation.
- No email templates, sender configuration or delivery code.

### Architecture Map (current)

```text
Browser (client components only)
  ├── Public pages      → src/components/public-pages.tsx, published-content.tsx
  ├── Public forms      → src/components/forms/{booking,public-form}.tsx
  ├── Admin console     → src/components/admin/**   (gated by sessionStorage flag)
  └── Data              → src/lib/mock-store.ts     (in-memory, resets on refresh)

Next.js server
  ├── /admin/[[...segments]]  → renders <AdminApp/> (no server-side auth check)
  └── /api/*                  → 503 fail-closed stub

No database · No auth provider · No email · No storage · No queue
```

### Safest Integration Points

1. **`Repository` interface (`src/lib/contracts.ts:153–170`)** — the single, already-tested seam between UI and data. A production adapter implementing `createBooking`, `updateBooking` and `createLead` against Supabase, executed in a Server Action or route handler, is the least invasive persistence path.
2. **`src/lib/rules.ts`** — pure, framework-free functions for scheduling, transitions, confirmation gating, validation. Already unit-tested; must be reused server-side unchanged.
3. **`AdminApp` routing switch (`src/components/admin/admin-app.tsx:66–95`)** — the single point where admin sub-routes are resolved and where role-based visibility can be introduced.
4. **`adminNav` (`src/lib/content.ts:218–227`)** — the single source for admin navigation, consumed by both `AdminSidebar` and the mobile admin menu in `src/components/shell.tsx`. Role-filtering this array is the only change needed for navigation visibility.
5. **`saveSettings` (`src/lib/mock-store.ts:480–487`)** — the existing optimistic-concurrency settings write; the alert-recipient feature should be a sibling settings section, not a rewrite.

---

## 3. Existing Authentication and Admin Access

### CONFIRMED EXISTING (demo only)

| Capability | Status | Evidence |
| --- | --- | --- |
| Admin login screen (visual) | Yes — email/password form with reset and set-password variants | `src/components/admin/admin-app.tsx:156–288`, route `/admin/login` |
| Real credential verification | **No.** Sign-in always returns an error stating authentication is not connected. | `src/components/admin/admin-app.tsx:183–186` |
| Password reset email | **No.** Reset/set-password flows show success screens without sending mail or changing anything. | `src/components/admin/admin-app.tsx:181–186, 206–215` |
| Session establishment | Client-side `sessionStorage.setItem("wave-demo-session", "active")` | `src/components/admin/admin-app.tsx:278` |
| Session enforcement | Client-side `useEffect` reading the same flag; rendered only in the browser | `src/components/admin/admin-app.tsx:36–40` |
| Route protection | **None server-side.** `/admin/*` renders for any visitor; the gate is purely visual. | `src/app/admin/[[...segments]]/page.tsx:8–20` |
| Middleware | **None.** | No `middleware.ts` in repository |
| Roles / role fields | **None.** No `role`, `is_admin`, `admin_profiles` or equivalent exists in any type, store or component. | `src/lib/contracts.ts`, `src/lib/mock-store.ts` |
| User/staff management UI | **None.** No invitation, creation, listing or editing of admin accounts exists. | Admin route inventory (`admin-app.tsx:66–75`) |
| Server-side authorisation | **None.** All admin reads/writes occur in client components against the in-memory store. | All files under `src/components/admin/` |

### SECURITY CONCERN — Current admin gate

The only access control for the entire administration console is:

```ts
// src/components/admin/admin-app.tsx:36–40
useEffect(() => {
  setAllowed(
    demoMode && sessionStorage.getItem("wave-demo-session") === "active",
  );
}, []);
```

`src/app/admin/[[...segments]]/page.tsx:18` additionally passes the `AdminApp` component through unconditionally. The `state` query parameter can force `access-denied` and `session-expired` UI states (`admin-app.tsx:112–133`), but these are **presentation states only** — they do not gate data.

`docs/IMPLEMENTATION_REVIEW.md:134` already records this correctly: *"The mock adapter is not a security boundary. Never connect it directly to real customer records or use its sessionStorage flag as production authentication."*

### UNVERIFIED

- No deployed environment, hosting platform, DNS or domain configuration was inspected; none exists in the repository.
- No production secrets or provider accounts can be verified from this codebase.

---

## 4. Proposed Role-Based Permission Model

The two proposed roles — **`full_admin`** and **`operational_admin`** — have **no existing counterpart**. The SRS anticipates exactly this shape in its logical schema, describing an `admin_profiles` entity with an *"authorised role"* provisioned only by a trusted workflow (`docs/source/2ND_WAVE_SRS.md:98`), and its access-control matrix assumes a single "Invited admin" tier (`docs/source/2ND_WAVE_SRS.md:123–136`). The PRD, however, lists *"extra staff roles"* under Excluded scope (`docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:27`). **This investigation therefore treats the two-role model as a new, authorised scope extension that supersedes the earlier single-admin assumption and must be recorded as a scope change in the PRD/SRS before implementation.**

### Schema decision

| Option | Assessment |
| --- | --- |
| Extend existing schema | **Not possible** — there is no existing schema. |
| New `admin_profiles` table | **Recommended.** Matches the SRS logical schema, keeps identity (Supabase Auth user) separate from authorisation data, and allows roles to change without touching auth records. |

Recommended columns (logical design only — no migration written):

- `user_id` — PK/FK to `auth.users`, unique.
- `role` — constrained enum: `full_admin` | `operational_admin`. Not nullable, no default that grants `full_admin`.
- `display_name`, `created_at`, `updated_at`, `created_by`.
- `disabled_at` — nullable; disabled accounts retain history but cannot authenticate to privileged endpoints.

### Permission matrix (target state)

| Capability | `operational_admin` | `full_admin` |
| --- | --- | --- |
| Bookings: list, filter, read detail | Yes | Yes |
| Bookings: assign branch, arrangements, notes | Yes | Yes |
| Bookings: status transitions (non-terminal) | Yes | Yes |
| Bookings: cancellation (with reason) | Yes | Yes |
| Reviews: list, filter, read | Yes | Yes |
| Reviews: approve / reject | Yes | Yes |
| Reviews: draft, edit and publish replies | Yes | Yes |
| Reviews: edit proposed publication version | Yes | Yes |
| Reviews: **emergency override** on an already-published or already-decided review | **No** | Yes, with mandatory reason + audit record |
| Enquiries / commercial quotes | **No** | Yes |
| Newsletter interest list and withdrawal | **No** | Yes |
| Website Content (all six CMS modules) | **No** | Yes |
| Media Library | **No** | Yes |
| Settings (contacts, pickup rules, pause, retention display) | **No** | Yes |
| Booking alert recipient management | **No** | Yes |
| Email composer, inbox, newsletter campaigns | **No** | Yes |
| Staff / admin account administration | **No** | Yes |

### Enforcement requirements

Navigation hiding alone is explicitly insufficient per the SRS (`docs/source/2ND_WAVE_SRS.md:136`): *"Middleware/navigation hiding alone is insufficient."* Enforcement must exist at **three independent layers**:

1. **Middleware** — session presence and path-prefix allow-list per role; redirects unauthenticated users.
2. **Server** — every Server Action / route handler resolves the caller's role from the session server-side and rejects unauthorised operations before touching data.
3. **Database** — RLS policies on every exposed table keyed to the caller's role, so a compromised client or a forged request cannot bypass the application layer.

Privileged operations must additionally **not** rely on an elevated service-role key for ordinary admin work; the SRS is explicit that elevated credentials bypass RLS and that privileged code must therefore perform its own trusted validation (`docs/source/2ND_WAVE_SRS.md:136`, `docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:76`).

### Privilege-escalation risks to design against

| Risk | Mitigation direction |
| --- | --- |
| Client-supplied role claim | Role is never read from the request; always resolved server-side from `admin_profiles` via the session user id. |
| Direct URL access to restricted admin routes | Middleware allow-list plus server-side check in each route's loader; the existing `access-denied` UI state (`admin-app.tsx:112–122`) can be reused for the denial presentation. |
| Unauthorised server calls (forged fetch to admin mutation endpoints) | Same server-side role check in every mutation; origin/CSRF checks for cookie-authenticated writes (`docs/source/2ND_WAVE_SRS.md:149`). |
| RLS bypass via service key | Service-role key confined to server runtime; never shipped to the client; no `NEXT_PUBLIC_` prefix. |
| Self-promotion | No endpoint allows an admin to change any `role` value; role changes are a trusted provisioning workflow only (`docs/source/2ND_WAVE_SRS.md:132`). |
| Disabled account reuse | `disabled_at` checked at session validation and in RLS, not only at login. |

### Emergency review overrides — design recommendation

Full Admins may approve, reject or edit a review even where an Operational Admin has already acted, or where the record is in a state that would otherwise block the action. Every override must write an immutable audit row containing at least: administrator id, review id, action, before-values, after-values, free-text reason (mandatory, min/max length), and server timestamp.

The most maintainable enforcement point is **the same server action that performs the moderation write**, not a separate "override" endpoint:

- The mutation resolves the caller's role.
- If the caller is `operational_admin` and the record is in an override-only state, reject with a stable error code.
- If the caller is `full_admin`, require `reason`, apply the change inside the same transaction that inserts the audit row.

This keeps one write path, one validation path and one audit path, and makes it structurally impossible to perform an override without an audit record.

---

## 5. Booking Lifecycle and Existing Operations

### CONFIRMED EXISTING — status model

Nine statuses, defined and enforced in `src/lib/rules.ts:2–26`:

```text
pending → confirmed → scheduled → picked_up → processing → ready → out_for_delivery → completed
              ↘            ↘            ↘           ↘          ↘  ↘
                    cancelled (from any non-terminal state)
```

Valid transitions (`src/lib/rules.ts:16–26`):

| From | Allowed to |
| --- | --- |
| `pending` | `confirmed`, `cancelled` |
| `confirmed` | `scheduled`, `picked_up`, `cancelled` |
| `scheduled` | `picked_up`, `cancelled` |
| `picked_up` | `processing`, `cancelled` |
| `processing` | `ready`, `cancelled` |
| `ready` | `out_for_delivery`, `completed`, `cancelled` |
| `out_for_delivery` | `completed`, `cancelled` |
| `completed` | *(terminal)* |
| `cancelled` | *(terminal)* |

This matches the SRS lifecycle exactly (`docs/source/2ND_WAVE_SRS.md:153–162`). **No new statuses are required for the customer-email proposal.** Every proposed email event in §6 maps onto an existing status; introducing redundant statuses would break the tested transition table and is not justified.

### CONFIRMED EXISTING — lifecycle mechanics

| Concern | Finding | Evidence |
| --- | --- | --- |
| Creation entry point | Public four-step form at `/book` → `repository.createBooking` | `src/components/forms/booking.tsx:168`, routed at `src/app/[...slug]/page.tsx:119–131` |
| Data contracts | `BookingInput`, `Booking` with nested `input`, `arrangement`, `version`, `history[]`, `notes[]` | `src/lib/contracts.ts:2–31` |
| Reference generation | Opaque: `` `DEMO-${crypto.randomUUID().slice(0,8).toUpperCase()}` `` | `src/lib/mock-store.ts:277` |
| Default status | `"pending"` at creation | `src/lib/mock-store.ts:279` |
| Idempotency | Client key + payload hash; replay returns same booking; changed payload throws | `src/lib/mock-store.ts:248–255, 291`; tested in `tests/repository.test.ts:57–72` |
| Optimistic concurrency | `version` integer; stale write rejected with a friendly conflict message | `src/lib/contracts.ts:28`, `src/lib/mock-store.ts:299–302` |
| Confirmation gate | Requires branch, agreed pickup datetime, non-negative fee, zero-fee reason, contact outcome, confirmation notes | `src/lib/rules.ts:132–148`, enforced at `src/lib/mock-store.ts:307–310` |
| Cancellation gate | Requires non-empty reason | `src/lib/mock-store.ts:311–312`, UI at `src/components/admin/bookings.tsx:540–565` |
| History | Append-only array of `{ text, at }`. **No actor recorded.** | `src/lib/mock-store.ts:320–329` |
| Internal notes | String array appended on save; never surfaced publicly | `src/lib/contracts.ts:30`, `src/lib/mock-store.ts:319` |
| Customer contact | `name`, `phone`, optional `email`, `sameWhatsapp` + optional `whatsapp`, `contactMethod` | `src/lib/contracts.ts:13–19` |
| Services | Array of published service slugs, resolved to titles in the admin UI | `src/lib/contracts.ts:3`, `src/components/admin/bookings.tsx:197–200` |
| Branch assignment | `arrangement.branch` — starts empty (unassigned); admin assigns; **no customer branch selector** | `src/lib/mock-store.ts:30–38`, `src/lib/rules.ts:123–131` |
| Photos | Up to 3 files, 5 MB each, JPEG/PNG/WebP — **browser-side preview only**; no upload service | `src/lib/rules.ts:111–122`, `src/components/forms/booking.tsx:129–141` |
| Scheduling rules | Accra timezone; 07:00–17:00 pickup window; **11:00 express same-day cutoff**; server-clock authority documented but demo uses browser clock | `src/lib/rules.ts:27–82`, `docs/source/2ND_WAVE_SRS.md:69–84` |
| Pause / accept bookings | `settings.acceptBookings`; checked at creation; committed idempotent replay still succeeds | `src/lib/mock-store.ts:263–266`, tested `tests/repository.test.ts:146–156` |
| Admin operations | Filter list (search/status/branch/date); inline status change; inline branch assignment; detail view with arrangements, notes, history, cancellation, WhatsApp draft | `src/components/admin/bookings.tsx` |
| WhatsApp handoff | **Manual draft only.** Admin clicks "Draft WhatsApp Update"; a `wa.me` deep link with URL-encoded text opens; message is never sent programmatically and no send receipt is claimed. | `src/components/admin/bookings.tsx:523–608`; PRD §5 and `docs/source/2ND_WAVE_SRS.md:55` |
| Customer WhatsApp draft | Post-booking result page offers open/copy of a pre-written message to `wa.me/233595224280` | `src/components/forms/booking.tsx:214–230` |
| Retention policy (displayed) | Booking records: 12 calendar months. Customer photos: 90 days. **Displayed as read-only text; no cleanup job exists.** | `src/components/admin/settings.tsx:156–174`; requirement in `docs/source/2ND_WAVE_SRS.md:64` |
| Booking audit history | **Partial.** A `history[]` array exists but records no actor and is not a tamper-evident audit log. | `src/lib/mock-store.ts:80, 320–329` |

### Business rules that must be preserved (confirmed intact in code)

1. No customer accounts — confirmed; no auth on the public site.
2. New bookings default to `pending` — confirmed (`src/lib/mock-store.ts:279`).
3. Admin confirmation occurs after contacting the customer — confirmed via the mandatory `contactOutcome` and `confirmationNotes` gate (`src/lib/rules.ts:142–147`).
4. Payment and charges handled outside the website — confirmed; fee is a privately recorded field only; no payment code exists.
5. Same-day express service has an 11:00 a.m. cutoff — confirmed (`src/lib/rules.ts:71–72`), boundary equality at exactly 11:00:00 documented as an engineering convention (`docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:45`).
6. Retention policies must remain intact — the values (12 months / 90 days) are displayed and documented; enforcement is **MISSING** (no cleanup job).

---

## 6. Customer Email Notifications

### CONFIRMED ABSENT

There is **no** email-sending capability of any kind in the repository:

- No SMTP/API client, no template files, no sender identity, no `BREVO_*` environment variable in `.env.example`.
- No transactional emails are promised to customers in the approved content. The PRD explicitly states for newsletter: *"Do not send emails … or promise confirmation emails"* (`docs/source/CONTENT LIGHTMODE.md:24`), and lists *"automated marketing campaigns/Brevo integration"* as excluded scope (`docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:27`).
- The only customer-facing "message" pathway today is the manual WhatsApp draft (see §5).

### Mapping proposed events to the existing status model

| Proposed email event | Existing status / trigger | New status needed? | Notes |
| --- | --- | --- | --- |
| Booking successfully created | `createBooking` commits; status is `pending` | No | Only send when email address was supplied (the email field is optional: `src/lib/contracts.ts:16`). |
| Administrator confirms booking | `pending → confirmed` | No | Arrangement gate must have passed; send after the transaction commits. |
| Processing begins | `picked_up → processing` | No | — |
| Ready for collection or delivery | `processing → ready` | No | Applies whether the return is collected or delivered. |
| Booking completed | `ready\|out_for_delivery → completed` | No | — |
| Booking cancelled | any non-terminal → `cancelled` | No | Cancellation reason is admin-entered; decide whether it is quoted in the email (recommendation: a neutral message, not the internal reason). |

Statuses `confirmed → scheduled`, `scheduled → picked_up` and `ready → out_for_delivery` are operational stages that do not require customer email in the proposed scope; adding emails for them is optional and can be deferred.

### Reliability design requirements (nothing implemented today)

Because there is no queue, outbox or delivery log, the following must be designed as new work:

1. **Transactional outbox.** The status-change transaction must insert an `email_outbox` row in the same database transaction as the booking update and history append. The email is then delivered by a background worker that polls or listens to the outbox. This guarantees no notification is sent for a rolled-back or failed operation — the outbox row simply will not exist.
2. **Idempotency.** Each outbox row carries a deterministic key (e.g. `booking_id + event_type + status_version`) with a unique constraint, so retries and concurrent workers cannot double-send.
3. **Delivery failure isolation.** Delivery attempts update a per-row `attempts`, `last_error`, `next_attempt_at` and `delivered_at`. A failed delivery must never revert a booking status or surface an error to the admin UI beyond a non-blocking indicator.
4. **Retries with backoff and a dead-letter state.** Bounded exponential backoff; after N attempts the row is marked `failed` and surfaced in an admin delivery-failures view.
5. **No email address → no send, no failure.** `input.email` is optional; the outbox should simply not create a row.
6. **Replay safety.** The existing idempotent booking replay (`src/lib/mock-store.ts:248–255`) must not generate a second outbox row on replay — the outbox insert belongs to the commit path only, keyed to the already-assigned booking id.

### Customer-contact gap to resolve before implementation

The SRS and PRD mandate that policy bodies/versions be captured on public submissions (`docs/source/2ND_WAVE_SRS.md:172`, `docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:82`). The current `BookingInput` has no `noticeVersion` field. Since transactional emails constitute new processing of customer contact data, the privacy-notice version captured at submission should be stored alongside the booking before these emails are enabled. This is an open dependency, not a blocker for the design.

---

## 7. Booking Alert Recipient Settings

### CONFIRMED EXISTING

- A single `Settings` object with a `version` integer for optimistic concurrency: `src/lib/contracts.ts:139–152`.
- Persisted via `saveSettings` with a version-conflict guard: `src/lib/mock-store.ts:480–487`.
- The Settings admin page (`src/components/admin/settings.tsx`) already contains six panel sections: Business details, Contacts and social links, Booking requests, Pickup rules, Retention, Newsletter interest. The business `email` field exists but is empty by default with the helper *"Leave unset until the real business email is confirmed."* (`settings.tsx:95`).
- Existing validators reusable for the new section: `validEmail` (`src/lib/rules.ts:89–91`), phone and clock validators, HTTPS-only URL checks.
- The `UnsavedGuard` (`src/components/admin/unsaved.tsx`) and `Dialog` (`src/components/dialog.tsx`) components are reusable for confirmation and discard-warning behaviour.

### MISSING

There is **no** concept of alert recipients anywhere: no recipient list, no enable/disable flag, no test-send, no delivery-failure view, no fan-out logic.

### Where the feature belongs

A **new panel section inside `/admin/settings`** (a sibling of "Booking requests"), not a new top-level route. Rationale: it is configuration data with the same ownership (Full Admin), the same optimistic-concurrency model and the same save action. A new route would fragment the unsaved-changes guard and the single settings save path for no benefit.

### Recommended data model (logical)

| Entity | Purpose | Key columns |
| --- | --- | --- |
| `booking_alert_recipients` | One row per staff alert address | `id`, `email` (normalised lowercase, unique), `enabled` (bool, default true), `label` (optional), `created_by`, `created_at`, `updated_at`, `version` |

Constraints and behaviour:

- **Unique index on normalised email** — prevents duplicates case-insensitively, matching the existing newsletter dedup pattern (`src/lib/mock-store.ts:353–361`).
- **Hard cap on enabled recipients** (e.g. 10) enforced server-side — bounds notification fan-out and Brevo spend.
- **Validation**: reuse/extract `validEmail`; reject display-name injection (`Name <a@b.com>`), multiple addresses in one field, and addresses exceeding 254 characters (already the limit in `validEmail`).
- **RLS**: readable and writable by `full_admin` only; not readable by `operational_admin`; never readable from the client for any other purpose.
- **Test send**: an authenticated Full Admin action that sends a fixed template to one selected recipient through the same outbox path, returning success/failure without exposing provider errors verbatim.
- **Delivery failures**: reuse the outbox table's `failed` rows, filtered to alert-type messages, surfaced read-only in this section.
- **Privacy of the recipient list**: when fanning out a new-booking alert, each recipient should be placed in `Bcc` (or the provider's per-recipient send mode) so staff addresses are not disclosed to one another.

`operational_admin` must be denied at the server and RLS layers for every read and write of this table.

---

## 8. Existing Reviews Architecture

### CONFIRMED EXISTING

| Concern | Finding | Evidence |
| --- | --- | --- |
| Public submission | `/reviews/share` renders `PublicForm kind="review"` | `src/app/[...slug]/page.tsx:116–118`, `src/components/public-pages.tsx:635–654` |
| Form fields | `name` (required), `rating` (optional 1–5 select), `review` (required, ≤4000 chars), `branch` (optional), consent checkbox (required) | `src/components/forms/public-form.tsx:64–75, 131–132, 265–281` |
| Storage | A `Lead` with `kind: "review"`, `fields: Record<string,string>`, `status`, `createdAt`, `notes[]` | `src/lib/contracts.ts:32–40`, `src/lib/mock-store.ts:362–373` |
| Moderation | `moderateReview(id, status, note)` — transitions to `approved`, `rejected` or `withdrawn` | `src/lib/mock-store.ts:662–679` |
| Consent rule | Approval is **blocked** unless `fields.consent === "yes"` | `src/lib/mock-store.ts:671–672`, UI warning at `src/components/admin/reviews.tsx:56–58` |
| Admin UI | `/admin/reviews` — lists only `status === "new"` reviews; Approve / Reject buttons only; no detail view, no filter, no search | `src/components/admin/reviews.tsx:12–15, 48–81` |
| Public display | `PublishedReviews` filters `kind === "review" && status === "approved" && consent === "yes"` and renders name, text, rating | `src/components/published-content.tsx:87–110` |
| Public listing page | `/reviews` shows approved reviews + CTA to share | `src/components/public-pages.tsx:635–654` |
| Abuse prevention | **None** beyond max-length and required-field checks. No rate limiting, no honeypot, no duplicate detection, no content filtering. | `src/components/forms/public-form.tsx:119–161` |
| Association with bookings | **None.** Reviews are standalone leads; no booking reference field exists. | `src/lib/contracts.ts:34` |
| Replies | **None.** No reply field, model or UI anywhere. | Repository-wide search |
| Edited publication version | **None.** Approval publishes the original `fields.review` verbatim. | `src/components/published-content.tsx:100` |
| Moderation history / audit | **None.** `notes[]` exists but is unused by the reviews UI; no actor, no timestamped decision log. | `src/lib/mock-store.ts:673–676` |
| Content sanitisation | Reviews are rendered as React text children, which **escapes HTML by default** — the current rendering path is XSS-safe for the demo store. This must be preserved (never `dangerouslySetInnerHTML`). | `src/components/published-content.tsx:100` |

### Assessment

Reviews are **PARTIALLY IMPLEMENTED**: submission, consent capture, approve/reject moderation and gated public display all exist and behave correctly within the demo. Everything required by the new Operational Admin scope — filtering, detail reading, reply drafting, edited publication versions, publishing, audit history, concurrency control — is **MISSING**.

---

## 9. Review Moderation and Emergency Overrides

### Gap analysis against the required capabilities

| Required capability | Current state | Gap |
| --- | --- | --- |
| View and filter reviews | List of `status === "new"` only, no filters | MISSING — filters for status/branch/rating/date; list must include decided reviews |
| Read individual submissions | Inline panel, no dedicated detail route | MISSING — `/admin/reviews/[id]` detail view |
| Draft public replies | — | MISSING |
| Edit reply drafts | — | MISSING |
| Approve or reject reviews | Yes (`moderateReview`) | CONFIRMED, needs actor + audit + version check |
| Edit a proposed publication version | — | MISSING |
| Publish permitted reviews | Implicit in approval | PARTIALLY — needs an explicit publish step decoupled from approval |
| Emergency override (Full Admin) | — | MISSING |
| Original preserved when edited version exists | — | MISSING |
| Unapproved / unpublished content never public | Yes for approval; no reply concept | CONFIRMED for approval path only |
| Moderation history / audit | — | MISSING |
| Concurrent editing protection | — | MISSING (no `version` on `Lead`) |
| XSS / sanitisation | React text escaping | CONFIRMED (adequate if pattern retained) |
| Spam protection | — | MISSING |

### Recommended review-state model

The existing `Lead.status` union (`new | contacted | closed | approved | rejected | withdrawn`, `src/lib/contracts.ts:36–37`) mixes enquiry states with review states and cannot carry draft/published-reply phases. Rather than overloading it further, the recommendation is a **dedicated review entity** with an explicit state machine:

```text
submission states:      pending → approved | rejected
                        rejected → (re-open → pending, Full Admin only, audited)
publication states:     none → published
                        published → (edited version drafted → published v2)   [original retained]
reply states:           none → draft → published
                        draft ↔ draft (edit) ; published → (new draft → published v2)
```

Recommended logical columns (new `review_submissions` table, aligning with the SRS logical schema at `docs/source/2ND_WAVE_SRS.md:111`):

- **Original (immutable once submitted):** `id`, `customer_name`, `body_original`, `rating`, `branch`, `consent`, `notice_version`, `created_at`, `source_ip_hash` (optional, for abuse review).
- **Publication version:** `body_published` (nullable), `published_at`, `published_by`, `published_version` (integer for optimistic concurrency). Only this column is read by the public site.
- **Moderation:** `moderation_status` (`pending|approved|rejected`), `moderated_by`, `moderated_at`, `moderation_note`.
- **Reply:** `reply_body` (nullable), `reply_status` (`none|draft|published`), `reply_published_at`, `reply_published_by`, `reply_version`.
- **Optimistic concurrency:** a single `version` integer bumped on every write, mirroring the proven `Booking.version` pattern (`src/lib/contracts.ts:28`, conflict message at `src/lib/mock-store.ts:299–302`).
- **Optional booking link:** `booking_id` nullable — reviews are currently unassociated; adding a link is optional and should only be populated where the customer supplies a reference or the flow is authenticated later. Do not require it.

Public read path must filter on `moderation_status = 'approved' AND consent = 'yes' AND body_published IS NOT NULL`, replacing the current filter in `src/components/published-content.tsx:89–94`. Unapproved rows and unpublished replies must be unreachable by any public query — enforced by RLS, not by the UI.

### Content safety

- Customer text must continue to be rendered as escaped plain text. **Do not introduce a rich-text path for customer input.**
- Reply drafts may be plain text initially; if a rich-text editor is later required for replies, sanitisation must be server-side and allow-list based (the SRS requires CMS rich content to be *"sanitised or safely structured"*, `docs/source/2ND_WAVE_SRS.md:90`).
- Enforce the existing 4000-character limit (`public-form.tsx:69`) server-side as well as client-side.
- Add server-side rate limiting on the public `/reviews/share` submission, per the SRS abuse requirement (`docs/source/2ND_WAVE_SRS.md:215`).

### Emergency overrides

As specified in §4: a single server mutation path, a mandatory `reason` for any Full Admin action that an Operational Admin could have performed or that reverses a prior decision, and an audit row written in the same transaction. The override UI should be visually distinct (the existing `Notice` and `Dialog` components are adequate) and must never be the default affordance.

---

## 10. Existing Email and Brevo Infrastructure

### CONFIRMED ABSENT

A repository-wide case-insensitive search for `brevo`, `brevo`, `sendinblue`, `resend`, `sendgrid`, `smtp`, `nodemailer`, `BREVO`, `API_KEY`, `webhook`, `twilio`, `cloudflare` and `supabase` across `src/` returned **no matches**. The same search across `*.md` returned only documentation references.

### What the documentation actually says about Brevo

| Statement | Source |
| --- | --- |
| *"Brevo deferred. Newsletter interest collection only; no campaigns or promised confirmation emails. Production activation requires approved privacy wording."* | `docs/source/CONTENT LIGHTMODE.md:24` |
| *"automated marketing campaigns/Brevo integration"* listed under **Excluded** scope | `docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:27` |
| *"Do not send emails, automatically move lists to Brevo, count bookings as subscribers or promise double opt-in. … Later provider connection is a new authorised phase."* | `docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:108` |
| *"Brevo/campaigns/confirmation emails disabled"* | `docs/source/2ND_WAVE_SRS.md:60` (NEWS-01) |

**Conclusion:** Brevo has never been integrated, no API key environment variable exists, no sender identity is configured, and no transactional template exists. Every Brevo capability is **greenfield work** requiring new secrets, new environment variables, new server-side code and a new data model. The business email/domain is also documented as **unset** (`docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:37`), so a verified sender identity must be established before any sending is enabled.

### Environment variables that will be required (none exist today)

The following are *proposed names only*; they must not be committed and must be added to `.env.example` as placeholders without values during implementation:

- `BREVO_API_KEY` — server-only, never `NEXT_PUBLIC_`.
- `BREVO_TRANSACTIONAL_SENDER_EMAIL` / `BREVO_TRANSACTIONAL_SENDER_NAME` — verified sender identity.
- `BREVO_MARKETING_SENDER_EMAIL` / `BREVO_MARKETING_SENDER_NAME` — if a separate marketing identity is used for newsletters.
- `BREVO_WEBHOOK_SIGNING_KEY` — for delivery/bounce webhook verification.
- `CLOUDFLARE_EMAIL_WEBHOOK_SECRET` — for the inbound-email worker callback.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public), `SUPABASE_SERVICE_ROLE_KEY` (server-only).

### Reusable versus new

| Reusable as-is | New implementation required |
| --- | --- |
| `validEmail` (`src/lib/rules.ts:89–91`) for recipient validation | Brevo API client wrapper (server-only) |
| `Settings` versioned write pattern for sender configuration | Email template definitions (transactional + alert + test) |
| `Notice`, `Submit`, `Dialog`, `UnsavedGuard` UI components | Outbox table, worker, retry/backoff, delivery log |
| Optimistic-concurrency `version` pattern | Full composer UI, draft persistence, attachment handling |
| `DemoFailure` pattern for preview-mode safety | Rate limiting, audit records, webhook verification |

---

## 11. Cloudflare Inbound Email Architecture

### CONFIRMED EXISTING

- **Cloudflare is not integrated.** No Cloudflare SDK, Worker, wrangler configuration, `wrangler.toml`, or DNS configuration exists in the repository.
- The only Cloudflare reference in the entire codebase is documentation: Cloudflare **R2 presigned URLs** as the intended media storage (`docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:67, 149`; `docs/source/2ND_WAVE_SRS.md:227`). R2 is storage, not email routing, and is a separate product.
- No domain configuration, DNS records or mail-hosting documentation exists. The business email/domain is explicitly **unset** (`docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:37`; `README.md:84`).

### Assessment of the proposed architecture

Cloudflare Email Routing delivers inbound messages to an Email Worker but **is not itself a persistent mailbox** — this is correctly understood in the brief. The worker must persist every message somewhere durable. The evaluation:

| Option for persistence | Assessment |
| --- | --- |
| New third-party mailbox provider | Unnecessary infrastructure; contradicts the reuse principle |
| Cloudflare R2 object storage for raw MIME | Possible for blobs, but R2 is planned for media and has no query/search capability; would still need a database index |
| **Supabase Postgres rows + attachments in R2** | **Recommended.** Reuses the already-planned database and storage. Metadata, threading and read state are queryable; only attachment bytes go to object storage. |

### Recommended architecture (design only — nothing configured)

```text
Sender → Cloudflare Email Routing (catch-all for the business domain)
       → Email Worker (Cloudflare Worker, deployed from a new /workers directory or separate repo)
       → HTTPS POST to a new Next.js route handler  (e.g. /api/internal/inbound-email)
       → Authenticated by a shared secret (HMAC signature over the payload)
       → Validates, sanitises, stores message + metadata in Supabase
       → Stores attachment bytes in a PRIVATE R2 bucket; records object keys in the DB
       → Admin dashboard reads via authenticated, role-checked, RLS-protected queries
```

### Security requirements for this path

1. **Worker-to-backend authentication.** The Worker must authenticate to the Next route handler with a shared secret (HMAC-SHA256 over body + timestamp, with replay-window rejection) — never an open endpoint. The route handler must be excluded from any public-cache behaviour and must not log message bodies.
2. **Email spoofing.** Email Routing already enforces SPF/DKIM at the edge; the Worker must still pass the received authentication results (or at minimum the envelope recipient) so the application can record trust level. Do not accept hand-crafted POSTs that merely *claim* to be from a given sender without verifying the signature.
3. **Unsafe HTML.** Inbound HTML bodies must be stored raw but **rendered** through a strict sanitiser (allow-list of safe tags/attributes, no scripts, no event handlers, no remote forms) or rendered as plain text with an "original HTML" opt-in behind a sandboxed iframe with a restrictive CSP. The current codebase escapes all user text and has no HTML-rendering path — this is a new capability and a new XSS surface.
4. **Attachment security.** Enforce per-message and per-attachment size caps; a strict MIME allow-list (PDF, JPEG, PNG, WebP, plain text, common office formats — **never** SVG, HTML or executables); store in a private R2 bucket; serve only via short-lived signed URLs issued after an authorisation check; re-verify retention at read time, consistent with the SRS private-photo rules (`docs/source/2ND_WAVE_SRS.md:168`).
5. **Storage quotas and retention.** Inbound mail is not covered by the existing 12-month booking / 90-day photo retention policy. A **separate, approved retention period for business email** is required before activation; the SRS is explicit that *"subscriber/review retention [is] separate and must be approved"* (`docs/source/2ND_WAVE_SRS.md:170`) and the same principle applies to mail.
6. **Failure handling.** If the application endpoint is unreachable, the Worker must retry with backoff and then write the raw message to a dead-letter location (e.g. R2) rather than dropping it. Silent loss of customer email is unacceptable.

### Feature-by-feature gap status

Every capability listed in the brief — incoming emails, sender/recipient metadata, subject and body, HTML and plain-text rendering, attachments, read/unread, replying, threading, sent messages, drafts, search and filtering, error handling — is **MISSING**. Only the routing/worker/storage *pattern* can be designed now; none of it exists.

**Do not configure Cloudflare or change DNS records as part of this work** — per the investigation rules. Domain and DNS setup remains a separate operational task, and the business domain itself is still unconfirmed.

---

## 12. Business Email Composer

### CONFIRMED EXISTING

Nothing. There is no composer, no rich-text editor dependency, no attachment upload path for outbound mail, no sent-mail history and no draft persistence.

### What can be reused

| Asset | Reuse in the composer |
| --- | --- |
| `Dialog`, `Notice`, `Submit`, `TextField`, `Field` (`src/components/forms/controls.tsx`, `src/components/dialog.tsx`) | Shell, validation display, confirmation dialogs |
| `UnsavedGuard` (`src/components/admin/unsaved.tsx`) | Warn before discarding an unsent draft |
| `validEmail` (`src/lib/rules.ts:89–91`) | Recipient validation (single address, ≤254 chars) |
| `Settings` version pattern | Storing composer defaults (e.g. default Reply-To) |
| `booking_alert_recipients` table (§7) | Optional recipient-picker for common staff addresses |
| Optimistic `version` pattern | Draft conflict detection between concurrent editors |

### What requires new implementation

Everything else: a rich-text editor, image insertion, file attachments, draft persistence, send progress, success/failure feedback and sent history.

### Design constraints (security-critical)

1. **Server-side sending only.** The Brevo API key must exist solely in the server runtime. No fetch to Brevo from a client component; no `NEXT_PUBLIC_` secret. The existing fail-closed API route (`src/app/api/[...path]/route.ts`) demonstrates the correct posture.
2. **Sender identity restriction.** All sends use the single configured, verified business sender identity. Recipients can never set the `From` header. `Reply-To` may default to the business address and must be validated.
3. **HTML sanitisation.** Composer HTML must be sanitised server-side before sending with an allow-list model. Client-side sanitisation alone is bypassable.
4. **Attachment validation.** Enforce total payload limits, per-file limits, MIME allow-list and filename sanitisation (strip path separators, control characters and leading dots) before accepting an attachment. Cap the number of attachments.
5. **Recipient validation and limits.** Cap recipient count per send; validate every address; reject role accounts if desired; record all recipients in the audit row.
6. **Rate limiting.** Per-admin and global send-rate limits to prevent abuse and protect Brevo limits.
7. **Audit records.** Every send writes an immutable record: actor, timestamp, recipients, subject, message id from Brevo, and success/failure.
8. **Delivery reporting.** Brevo webhook (signature-verified) updates the stored send record with delivered/bounced/complained states.
9. **Credentials never exposed.** No provider error body containing credentials should ever be returned to the browser; map to stable error codes and safe messages, consistent with the SRS error contract (`docs/source/2ND_WAVE_SRS.md:149`).
10. **Threading.** If a composer reply is associated with an inbound conversation (§11), set `Reply-To` and `In-Reply-To`/`References` headers from the stored original message id so clients thread correctly. Brevo's transactional API support for custom headers must be verified at implementation time — **Requires current official documentation verification**.

**Full Admin only.** The composer must be denied to `operational_admin` at all three enforcement layers.

---

## 13. Newsletter Campaign Management

### CONFIRMED EXISTING

| Concern | Finding | Evidence |
| --- | --- | --- |
| Public newsletter form | `PublicForm kind="newsletter"` — email + required unchecked-by-default consent checkbox | `src/components/forms/public-form.tsx:76–79, 107–112, 131–132, 265–281` |
| Form visibility gate | Hidden unless `settings.newsletter` is true | `src/components/published-content.tsx:111–123` |
| Persistence | A `Lead` with `kind: "newsletter"` is created — **but only in the in-memory demo store.** Nothing is durable. | `src/lib/mock-store.ts:353–373` |
| Deduplication | Case-insensitive email dedup; an existing non-withdrawn record is returned instead of a duplicate | `src/lib/mock-store.ts:353–361` |
| Consent field | `fields.consent === "yes"` recorded; admin table displays "Consent recorded: Yes/No" | `src/components/admin/leads.tsx:182–184, 213–218` |
| Withdrawal | Admin can record withdrawal (`updateLead(id, "withdrawn")`) | `src/components/admin/leads.tsx:220–236`, `src/lib/mock-store.ts:376–388` |
| Admin list | `/admin/newsletter` — table of email, consent, date, status, detail dialog | `src/components/admin/leads.tsx:154–242` |
| Campaigns, sending, templates, scheduling | **None.** UI states plainly: *"Email campaigns and provider integration are not enabled."* | `src/components/admin/leads.tsx:165`, `src/components/admin/settings.tsx:187` |

### Critical finding — do not assume subscribers exist

The newsletter form **appears** on the public site when the demo toggle is on, and the admin list **appears** to show subscribers, but:

- Records live only in `state.leads` in the browser memory (`src/lib/mock-store.ts:176–210`).
- They are **lost on every full page refresh** (`README.md:41`).
- `NEXT_PUBLIC_DEMO_MODE=false` disables the public form entirely (`public-form.tsx:179–184`).

**Therefore: there is no real subscriber list, and none can be exported or migrated.** Any campaign module must start from a genuinely empty consented subscriber base, collected only after the approved privacy wording is live. This matches NEWS-01 in the SRS (`docs/source/2ND_WAVE_SRS.md:60`).

### Data-protection and consent requirements

- Transactional booking email (a necessary consequence of a customer's own request) and consent-based marketing email are **legally and operationally distinct**. Booking contacts must never be auto-enrolled as newsletter subscribers — the PRD is explicit: *"Do not … count bookings as subscribers"* (`docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:108`).
- Consent must record: the exact wording/version shown, timestamp, source (which form), and the address normalised. The existing `Lead.fields.consent` pattern is the seed of this, but it lacks a notice version and a durable record.
- A working unsubscribe mechanism is mandatory before any campaign send, in addition to the existing admin-recorded withdrawal.
- Suppression and bounce handling should be driven by Brevo's bounce/complaint webhooks (signature-verified) writing to a suppression list that the campaign send honours.

### Brevo Campaign API versus transactional sends

**Strongly prefer the Brevo Campaigns API.** Reasons:

- Campaign sends are counted against Brevo's separate marketing/sends quota, not the transactional quota used by booking notifications and the composer. Coupling them risks booking confirmations failing because a newsletter consumed the quota.
- Campaigns provide audience management, unsubscribe handling, open/click reporting and suppression natively.
- Sending a newsletter as N individual transactional API calls would be slower, costlier, harder to unsubscribe from correctly and would damage sender reputation.

**Requires current official documentation verification:** exact Brevo Campaign API endpoints, free-tier monthly-send allowances, whether the API allows creating/sending campaigns programmatically on the free plan, and the transactional-versus-marketing quota split. No quota figures are asserted in this report.

### Module scope (Full Admin only)

Subscriber management (list, filter, import-via-consented-form only, withdrawal, suppression state), audience selection, campaign subject/preview text, rich-text editing with images, test send, draft state, optional scheduling, send, status history, and unsubscribe/suppression reporting. Everything is **MISSING** today.

---

## 14. Database and Migration Impact

No database exists. Every item below is a **new** logical entity. Where the SRS logical schema already names an entity, that name is adopted to avoid duplication.

| Proposed change | Existing or new | Purpose | Key relationships | Important columns | Constraints | Indexes | Access | Retention implications | Migration dependencies |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `admin_profiles` | **New** (named in SRS §6) | Role and status per authenticated admin | FK → `auth.users` | `user_id` PK, `role` enum, `display_name`, `disabled_at`, `created_by`, timestamps | `role` NOT NULL, no default granting full access | PK on `user_id`; partial index on active profiles | Read: self + full admin. Write: trusted provisioning only | Retain for audit after disable; do not hard-delete | None — foundational |
| `audit_events` | **New** (named in SRS §6) | Immutable log of privileged actions | Actor → `admin_profiles`; polymorphic `entity_id`/`entity_type` | `actor_id`, `action`, `entity_type`, `entity_id`, `before`/`after` JSONB, `reason`, `correlation_id`, `created_at` | Append-only; no update/delete grants | `(entity_type, entity_id, created_at)`; `(actor_id, created_at)` | Read: full admin. Write: server only | Long retention (business decision); no unnecessary PII in payload | `admin_profiles` |
| `booking_alert_recipients` | **New** | Staff addresses notified of new bookings | — | `email` unique normalised, `enabled`, `label`, `version`, timestamps | Unique on lower(email); cap on enabled count enforced in application + check | Unique `email` | Full admin only | Indefinite while enabled; removal stops future sends only | None beyond auth |
| `email_outbox` | **New** | Persistent outbox for all outbound email | → booking (nullable), → admin actor (nullable) | `id`, `idempotency_key` unique, `to`, `cc`, `bcc`, `template`, `payload` JSONB, `status` (`pending|sending|sent|failed|dead`), `attempts`, `next_attempt_at`, `provider_message_id`, `error`, timestamps | Unique `idempotency_key`; `status` enum; bounded `attempts` | `(status, next_attempt_at)`; unique key | Server/worker write; full admin read | Purge sent rows after a defined period (e.g. 90 days); retain failures longer | `admin_profiles`, `audit_events` |
| `email_delivery_events` | **New** | Webhook-driven delivery/bounce/complaint log | → `email_outbox` | `outbox_id`, `event` (`delivered|bounced|complained|deferred`), `provider_payload`, `received_at` | Append-only | `(outbox_id, received_at)` | Server write; full admin read | Align with outbox retention | `email_outbox` |
| `inbound_emails` | **New** (SRS has no equivalent — new entity) | Persistent business inbox | → `conversation_id`; attachments via join | `id`, `conversation_id`, `direction`, `from`, `to`, `cc`, `subject`, `text_body`, `html_body_sanitised`, `raw_object_key` (optional), `message_id_header`, `in_reply_to`, `received_at`, `is_read`, `folder` (`inbox|sent|drafts|archive`) | Size limits on bodies; sanitised HTML stored separately from raw | `(conversation_id, received_at)`; `(folder, is_read)`; GIN on full-text index | Full admin only | **Requires approved retention policy before activation** | Auth, storage bucket |
| `email_conversations` | **New** | Threading container | 1→N `inbound_emails` | `id`, `subject_normalised`, `last_activity_at`, `assigned_state` | — | `(last_activity_at)` | Full admin only | As above | `inbound_emails` |
| `email_attachments` | **New** | Attachment metadata | → `inbound_emails` (and optionally outbound) | `id`, `email_id`, `object_key` (private R2), `filename` (sanitised), `mime`, `size_bytes`, `checksum`, `scan_state` | MIME allow-list; size cap | `(email_id)` | Full admin only; short-lived signed URL read | Deleted with parent email | R2 private bucket |
| `email_drafts` | **New** | Composer and inbox-reply drafts | → admin actor | `id`, `to`, `cc`, `subject`, `body_html`, `body_text`, `attachments` JSONB, `conversation_id` nullable, `version`, timestamps | Version check on save | `(updated_by, updated_at)` | Owner + full admin | Purge stale drafts on a schedule | None |
| `outbound_email_history` | **New** (can be a view over `email_outbox`) | Sent-mail record for the UI | → `email_outbox` | Rendered from outbox `status = 'sent'` | — | — | Full admin read | As outbox | `email_outbox` |
| `newsletter_subscribers` | **New** (replaces the `Lead`-kind approach) | Consent-based marketing list | — | `email` unique normalised, `consent_version`, `consent_text`, `consent_at`, `source`, `withdrawn_at`, `suppressed_at`, `suppression_reason`, `brevo_contact_id` | Unique `email`; consent fields NOT NULL before active | Unique `email`; partial index on active | Full admin read/write; public insert only via consented form path | **Separate approved retention required** — must not reuse the 12-month booking period silently | Policy approval |
| `newsletter_campaigns` | **New** | Campaign definitions and status | → admin actor | `id`, `subject`, `preview_text`, `body_html`, `status` (`draft|scheduled|sending|sent|failed`), `scheduled_at`, `sent_at`, `brevo_campaign_id`, `audience_filter`, `test_sent_at`, `version` | Status enum; version check | `(status, scheduled_at)` | Full admin only | Retain for history per policy | `newsletter_subscribers` |
| `review_submissions` | **New** (replaces review-as-`Lead`) | Moderation, edited publication and replies | Optional → `bookings` | See §9 for full column list | Consent required before public exposure; version integer; original immutable | `(moderation_status, created_at)`; public filter index | Public read of permitted fields only via RLS view; full write path server-side | **Requires approved review retention policy** | `admin_profiles`, `audit_events` |
| `admin_profiles.role` migration path | N/A — no existing table to alter | — | — | — | — | — | — | — | — |

### Explicit non-duplication notes

- Do **not** create a generic `cms_items` table; the SRS allows consolidating typed content modules but the current six-module admin structure (`src/components/admin/content/content-config.ts`) maps cleanly to typed tables (`services`, `locations`, `gallery_items`, `blog_posts`, `faqs`, `promotions`, `content_revisions`) and `docs/IMPLEMENTATION_REVIEW.md:143` explicitly warns against collapsing them into inferred generic CMS columns.
- Do **not** create a separate `booking_audit` table; booking status history belongs in the SRS-named `booking_status_history` (append-only, with actor) and privileged-action audit belongs in `audit_events`. The current `Booking.history[]` string array should migrate into `booking_status_history` with actor attribution added.
- Do **not** store alert recipients inside `site_settings` as a JSON array; a dedicated table is required for per-recipient enable/disable, uniqueness and independent audit.

---

## 15. Security Assessment

### SECURITY CONCERN — findings (current state)

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| S-01 | **Critical (if deployed with data)** | Admin console gated only by a client-side `sessionStorage` flag; no server-side session check, no middleware, no RLS | `src/components/admin/admin-app.tsx:36–40`, `src/app/admin/[[...segments]]/page.tsx:8–20` |
| S-02 | **High (future)** | No server-side authorisation layer exists at all; every admin mutation runs in the browser | All of `src/components/admin/**`, `src/lib/mock-store.ts` |
| S-03 | **High (future)** | No actor attribution on any write; emergency overrides and audit requirements cannot be satisfied by the current history model | `src/lib/mock-store.ts:320–329` |
| S-04 | Medium (current, contained) | The `?state=` query parameter can force access-denied/session-expired UI but does not affect data access; no data is exposed because none is durable | `src/app/admin/[[...segments]]/page.tsx:18`, `admin-app.tsx:112–133` |
| S-05 | Medium (future) | Inbound-email HTML rendering will introduce a new XSS surface that does not currently exist | No HTML-rendering path exists today (confirmed safe by escaping) |
| S-06 | Medium (future) | Composer rich-text HTML introduces stored/reflected XSS into outbound mail and admin UI | No rich-text dependency exists |
| S-07 | Low (current) | Security headers are set correctly (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`) and `poweredByHeader` is disabled — good baseline | `next.config.ts:2–20` |
| S-08 | Low (current) | No secrets in the repository; `.env.example` contains only a demo flag | `.env.example` |
| S-09 | Positive | Public forms render user text as escaped React children; no `dangerouslySetInnerHTML` anywhere in `src/` | Confirmed by search |
| S-10 | Positive | The API boundary fails closed with a safe 503 and no secret material | `src/app/api/[...path]/route.ts` |
| S-11 | Positive | Map-link validation restricts hosts and requires HTTPS; `javascript:`/`data:` URLs rejected | `src/lib/rules.ts:92–110, 198–206` |

### Required controls for the new work

- **Role-based authorisation** at middleware, server and RLS layers (§4).
- **Server-side validation** of every field; client validation is advisory only. Reuse `src/lib/rules.ts` unchanged server-side.
- **API secret isolation** — Brevo and Supabase service-role keys server-only; webhook signing secrets verified before any processing.
- **XSS/HTML sanitisation** for inbound mail rendering and composer content; allow-list based, server-side, output-encoding for plain text.
- **CSRF** — origin checks on all cookie-authenticated admin mutations (`docs/source/2ND_WAVE_SRS.md:149`).
- **Attachment restrictions** — MIME allow-list, size caps, private bucket, signed short-lived URLs, no SVG/HTML/executables (§11).
- **Email abuse prevention** — rate limits on public review/newsletter/booking submissions; recipient caps; no user-controlled `From`; suppression list honoured.
- **Audit logging** — every privileged action including emergency overrides, with actor, before/after and reason.
- **Data exposure risks** — no PII in shared caches, metadata, sitemap or logs; private responses `no-store`; recipient lists never leaked across recipients (Bcc).

---

## 16. Reliability and Failure Scenarios

| Scenario | Current behaviour | Required behaviour |
| --- | --- | --- |
| Email delivery fails | N/A — no email | Outbox row retries with backoff; booking unaffected; failure surfaced in admin delivery view; dead-letter after N attempts |
| Duplicate notification | N/A | Unique idempotency key per (booking, event); worker concurrency-safe |
| Notification for failed/rolled-back booking | N/A | Outbox insert inside the booking transaction; no row, no send |
| Concurrent admin booking edits | Version conflict detected and surfaced with a reload prompt (`src/lib/mock-store.ts:299–302`, UI at `src/components/admin/bookings.tsx:310–326`) | Preserve this exact behaviour server-side (expected-version WHERE clause or equivalent) |
| Concurrent review edits | **No protection** (no version on `Lead`) | Add `version` integer with the same conflict semantics |
| Cloudflare Worker failure / endpoint down | N/A | Worker retries, then dead-letters raw message to private R2; no silent loss |
| Brevo outage | N/A | Outbox retains pending rows; worker retries; admin sees a non-blocking indicator; no status rollback |
| Queue/worker backlog | N/A | Monitor pending-row age; alert on threshold; horizontally safe because of unique idempotency keys |
| Database transaction safety | N/A | Booking update + history + outbox insert in one transaction; review decision + audit row in one transaction |
| Observability | None | Correlation IDs on every request; PII-redacted logs; failed-job alerting (`docs/source/2ND_WAVE_SRS.md:65`) |
| Retention cleanup | Displayed but **not implemented** (`src/components/admin/settings.tsx:156–174`) | Daily protected job per RET-01; extend to mail, reviews and subscribers with their own approved periods |

The existing idempotency, optimistic-concurrency and fail-closed patterns in `src/lib/mock-store.ts` are genuinely good and are already tested (`tests/repository.test.ts`). They should be **carried into the server implementation, not reinvented**.

---

## 17. Infrastructure and Cost Considerations

| Layer | Current | Proposed | Cost/risk notes |
| --- | --- | --- | --- |
| Application hosting | None configured | Vercel during dev/testing; **Cloudflare** for production (decided 10 Oct 2026) | Reuses the existing codebase; confirm Next.js runtime compatibility on Cloudflare before cutover |
| Database + Auth + RLS | None | Supabase | Already the documented intended stack (PRD §5). Free-tier suitability and RLS performance characteristics — **Requires current official documentation verification** |
| Media storage | None | Cloudflare R2 (public marketing + private customer buckets) | Already the documented intended stack; presigned-URL model documented in PRD/SRS |
| Inbound email | None | Cloudflare Email Routing + Email Worker | Free-tier suitability of Email Routing and Workers, and payload limits — **Requires current official documentation verification** |
| Transactional + composer + alert email | None | Brevo | Free-tier monthly send allowance, transactional-versus-marketing quota split, dedicated-IP/threshold behaviour — **Requires current official documentation verification**. Never assume a quota. |
| Newsletter campaigns | None | Brevo Campaigns API | Campaign sends typically draw on a different allowance than transactional; verify before designing volume |
| Attachment storage (mail) | None | Private R2 bucket | Storage growth from inbound attachments is unbounded without a retention policy — a policy decision is mandatory before activation |
| Background workers | None | Options: Supabase scheduled functions, a Next.js cron route, or a small queue worker | Choose based on hosting; the outbox pattern is worker-agnostic |

**Existing infrastructure reuse is high at the application layer** (all UI, rules, tests, design system) and **zero at the service layer** (nothing is connected). Expect the majority of new cost to be operational (domain, email sending volume, storage growth) rather than licensing of new custom software.

Upgrade triggers to watch: Brevo free-tier send volume once booking emails plus newsletters are active; R2 storage once mail attachments accumulate; Supabase row growth on outbox/audit tables.

---

## 18. Reusable Components and Integration Points

### CONFIRMED REUSABLE — keep unchanged

| Asset | Path | Why it is safe to reuse |
| --- | --- | --- |
| Scheduling, transition, validation rules | `src/lib/rules.ts` | Pure functions, framework-free, already unit-tested (`tests/rules.test.ts`) |
| `Repository` interface | `src/lib/contracts.ts:153–170` | The established data seam; a production adapter slots in without UI changes |
| Optimistic `version` conflict pattern | `src/lib/contracts.ts:28`, `mock-store.ts:299–302` | Proven UX and semantics; reuse for reviews and drafts |
| Idempotency-key pattern | `mock-store.ts:248–255`, `338–360` | Already tested for concurrent calls |
| Confirmation gating | `src/lib/rules.ts:132–148` | Business-critical rule, correctly implemented |
| Form controls (`Field`, `TextField`, `Notice`, `Submit`, `DemoFailure`) | `src/components/forms/controls.tsx` | Consistent accessible pattern used by every form |
| `Dialog` and `UnsavedGuard` | `src/components/dialog.tsx`, `src/components/admin/unsaved.tsx` | Native `<dialog>`, focus restoration, Escape support |
| Admin layout shell and navigation | `src/components/shell.tsx:373–410` (`AdminSidebar`), `admin-app.tsx` | Single nav source to filter by role |
| Settings page structure | `src/components/admin/settings.tsx` | New alert-recipient section is a sibling panel |
| Dashboard metrics pattern | `admin-app.tsx:289–417` | Add outbox-failure and pending-review metrics |
| Design system (CSS variables, panels, badges, tables) | `src/app/globals.css` | New modules should follow existing tokens; admin CMS already demonstrates scoped CSS Modules |
| Test harness | `tests/*.test.ts`, `npm run check` | Extend with rule tests for new state machines |
| Security headers | `next.config.ts` | Keep; extend for any new routes as needed |
| Fail-closed API stub pattern | `src/app/api/[...path]/route.ts` | Model for new protected route handlers |

### Integration points (in order of safety)

1. Implement a `SupabaseRepository` conforming to `Repository` and selected admin operations; wire it in place of the mock store behind `demoMode === false`.
2. Add real auth at `/admin/login` and middleware; keep `demoMode` session flag exclusively for the preview build.
3. Add role filtering to `adminNav` and the `AdminApp` route switch.
4. Add new admin sections (alerts, composer, inbox, campaigns) as siblings of existing panels, reusing the shared controls.
5. Add new route handlers under `src/app/api/` for public submissions, webhooks and the inbound-email receiver, each following the fail-closed/validate/authorise pattern.

---

## 19. Missing Functionality and Technical Gaps

| # | Item | Status | Category |
| --- | --- | --- | --- |
| 1 | Real authentication (Supabase Auth or equivalent) | MISSING | SECURITY CONCERN |
| 2 | Server-side session checks and middleware | MISSING | SECURITY CONCERN |
| 3 | `admin_profiles` with `role` | MISSING | SECURITY CONCERN |
| 4 | RLS policies on any table | MISSING | SECURITY CONCERN |
| 5 | Durable database of any kind | MISSING | — |
| 6 | Durable persistence for bookings/leads/settings | MISSING | — |
| 7 | Actor attribution on writes / audit log | MISSING | SECURITY CONCERN |
| 8 | Email sending utility of any kind | MISSING | — |
| 9 | Brevo integration, sender identity, API key config | MISSING | — |
| 10 | Booking alert recipients model and settings UI | MISSING | — |
| 11 | Transactional outbox / queue / retries / delivery log | MISSING | — |
| 12 | Customer transactional booking emails (all six events) | MISSING | — |
| 13 | Review detail view, filtering, search | MISSING | — |
| 14 | Review replies (draft, edit, publish) | MISSING | — |
| 15 | Edited publication version with original preserved | MISSING | — |
| 16 | Review moderation history with actor | MISSING | — |
| 17 | Review version/concurrency control | MISSING | — |
| 18 | Review spam protection / rate limiting | MISSING | — |
| 19 | Review–booking association | MISSING (optional) | — |
| 20 | Emergency override flow with mandatory reason | MISSING | — |
| 21 | Cloudflare Email Routing / Worker | MISSING | — |
| 22 | Inbound email persistence, threading, attachments, read state | MISSING | — |
| 23 | Inbound HTML sanitisation / safe rendering | MISSING | SECURITY CONCERN |
| 24 | Business email composer (rich text, attachments, drafts, sent) | MISSING | — |
| 25 | Newsletter subscriber durable storage with consent version | MISSING | — |
| 26 | Newsletter campaigns, scheduling, unsubscribe, suppression | MISSING | — |
| 27 | Retention/cleanup jobs (bookings, photos, mail, reviews, subscribers) | MISSING (values only displayed) | — |
| 28 | Rate limiting on public submissions | MISSING | SECURITY CONCERN |
| 29 | Observability: correlation IDs, redacted logs, failed-job alerts | MISSING | — |
| 30 | Staff/admin account provisioning and management UI | MISSING | — |
| 31 | `notice_version` captured on public submissions | MISSING | — |
| 32 | Business email/domain configuration | UNVERIFIED (documented as unset) | — |
| 33 | Hosting platform, production environment, DNS | UNVERIFIED (not in repository) | — |
| 34 | Brevo free-tier quotas and Campaign API capabilities | UNVERIFIED | — |
| 35 | Cloudflare free-tier Email Routing/Worker limits | UNVERIFIED | — |
| 36 | Supabase free-tier limits | UNVERIFIED | — |
| 37 | Approved privacy wording for marketing consent | UNVERIFIED (dependency for newsletters) | — |
| 38 | Approved retention periods for mail, reviews, subscribers | UNVERIFIED (dependency for activation) | — |

---

## 20. Recommended Phased Implementation Roadmap

### Phase 1 — Admin Roles and Access Control

**Current state.** Client-side `sessionStorage` demo gate only; no roles, no real auth, no server authorisation, no RLS.

**Required changes.** Introduce Supabase Auth; add `admin_profiles` with a constrained `role`; add middleware for unauthenticated redirects and coarse role gating; add a `requireAdmin(role)` server helper used by every admin mutation; enable RLS on all tables with role-aware policies; provision the first Full Admin via a trusted workflow; filter `adminNav` and the `AdminApp` route switch by role; retain the demo flag only when `NEXT_PUBLIC_DEMO_MODE=true`.

**Files/modules affected.** New: `src/middleware.ts`, `src/lib/auth.ts` (or similar), Supabase client helpers, migrations, RLS policy files. Modified: `src/app/admin/[[...segments]]/page.tsx`, `src/components/admin/admin-app.tsx`, `src/lib/content.ts` (`adminNav`), `src/components/shell.tsx` (sidebar/menu filtering), `src/app/admin/login` flow within `admin-app.tsx`, `.env.example`, `README.md`.

**Schema dependencies.** `admin_profiles` must exist first. All later phases depend on this.

**Security requirements.** Three-layer enforcement; no client-supplied role; service-role key server-only; role changes not self-service; disabled-account checks; CSRF/origin checks on cookie-authenticated writes.

**Acceptance criteria.** Unauthenticated users cannot reach any admin data; an `operational_admin` receives access-denied on every non-permitted route and on every non-permitted server mutation (verified by direct URL and direct server call, not only by hidden nav); an `full_admin` reaches everything; RLS denies anonymous and non-admin access independently of the application layer.

**Regression risks.** The demo preview must keep working for design review. Login UX (reset/set-password screens) will change from mock to real; the existing visual states should be preserved.

**Expected user-visible outcome.** Real sign-in for staff; two role experiences; restricted navigation for Operational Admins.

**Dependencies.** None. **This phase blocks all others.**

**MVP vs deferred.** MVP: auth, roles, middleware, server checks, RLS, navigation filtering, first-admin provisioning. Defer: staff-management UI (invite/disable) to shortly after MVP but before broad Operational Admin onboarding.

---

### Phase 2 — Booking Operations, Customer Emails and Staff Alerts

**Current state.** Full booking lifecycle UI with correct transitions, confirmation gating, cancellation reasons, version conflicts and manual WhatsApp drafts. No email, no alert recipients, no outbox, no actor on history.

**Required changes.** Port the booking repository to Supabase with transactions; add actor to `booking_status_history`; build the `email_outbox` and delivery-event tables plus a worker; add the six customer transactional emails; add `booking_alert_recipients` and the Full Admin settings section with test-send and failure view; keep WhatsApp drafts exactly as they are.

**Files/modules affected.** `src/lib/mock-store.ts` (adapter replacement boundary), `src/lib/rules.ts` (reuse unchanged), `src/components/admin/bookings.tsx` (actor display, delivery indicators), `src/components/admin/settings.tsx` (new panel), new: outbox worker, templates, alert settings components, webhook/route handlers.

**Schema dependencies.** Phase 1. Plus `booking_status_history` with actor, `booking_alert_recipients`, `email_outbox`, `email_delivery_events`.

**Security requirements.** Alert-recipient management Full Admin only; Brevo key server-only; recipient list not disclosed across recipients; no email address on the booking means no send and no failure.

**Acceptance criteria.** Each of the six events produces exactly one email per valid address; replay/duplicate submissions never double-send; a failed delivery never blocks or reverts a booking; alert recipients can be added/edited/disabled/tested only by Full Admins; Operational Admins cannot see or change recipients.

**Regression risks.** The booking confirmation gate and transition table must not change. Email failures must not alter the admin save UX. The idempotent replay behaviour tested in `tests/repository.test.ts` must be preserved.

**Expected user-visible outcome.** Customers receive status emails (where they provided an address); Full Admins manage alert recipients and see delivery failures.

**Dependencies.** Phase 1; a verified sender mailbox under the confirmed domain `2ndwavelaundry.com` (domain confirmed 10 Oct 2026; mailbox name pending).

**MVP vs deferred.** MVP: outbox + the six emails + recipient settings + test send. Defer: rich delivery analytics, per-recipient templates.

---

### Phase 3 — Reviews Moderation and Public Replies

**Current state.** Approve/reject only, consent-gated, no replies, no edited versions, no audit, no concurrency control.

**Required changes.** Introduce `review_submissions` with the state model in §9; migrate the moderation UI to a list + detail route with filters; add reply drafting/editing/publishing; add edited publication versions preserving the original; add actor-attributed moderation history; add emergency override with mandatory reason and audit; add rate limiting and abuse controls on the public form; update the public read path to the published-version columns under RLS.

**Files/modules affected.** `src/components/admin/reviews.tsx` (major expansion), new review detail route, `src/components/published-content.tsx:87–110` (read published version), `src/components/forms/public-form.tsx` (server-side validation parity), `src/lib/mock-store.ts:662–679` (superseded), `src/lib/contracts.ts` (new types).

**Schema dependencies.** Phase 1; `review_submissions`, `audit_events`.

**Security requirements.** Unapproved reviews and unpublished replies unreachable publicly (RLS); customer text always escaped; emergency override Full Admin only with mandatory reason; original immutable.

**Acceptance criteria.** Original customer text is preserved verbatim when an edited publication version exists; a draft reply is never publicly visible; two admins editing concurrently receive a conflict rather than silent overwrite; every decision and override appears in the audit log with actor and reason.

**Regression risks.** The consent rule (`consent === "yes"` before publication) must be preserved. The existing public empty state and review card design must continue to work.

**Expected user-visible outcome.** Operational Admins moderate and reply; Full Admins override with reason; the public site shows only approved, published text and published replies.

**Dependencies.** Phase 1. Can proceed in parallel with Phase 2 after Phase 1.

**MVP vs deferred.** MVP: list/detail/filters, approve/reject with audit, reply draft/edit/publish, edited publication version, concurrency. Deeper spam scoring, review–booking linking and rich-text replies can be deferred.

---

### Phase 4 — Cloudflare Inbox and Brevo Email Composer

**Current state.** Nothing. Domain/email unset.

**Required changes.** Confirm domain; configure Cloudflare Email Routing and an Email Worker (operational task outside this repository); build the authenticated inbound-email route handler; add `inbound_emails`, `email_conversations`, `email_attachments`; private R2 bucket for attachments; admin inbox UI with folders, read state, search, threading, attachment download via short-lived signed URLs, and reply composition; build the Brevo composer with rich text, attachments, drafts, send, progress, sent history and audit; add webhook receivers for delivery events with signature verification.

**Files/modules affected.** New: inbound route handler, composer components, inbox components, sanitiser, Brevo client wrapper, webhook handlers, worker source (in-repo or separate). Modified: `admin-app.tsx` and `adminNav` for two new Full Admin-only modules, `next.config.ts` if headers/routes are needed.

**Schema dependencies.** Phases 1–2 (auth, audit, outbox patterns). Plus inbound/drafts/attachments tables and the private R2 bucket.

**Security requirements.** HMAC-authenticated worker callback with replay-window rejection; strict HTML sanitisation on render; attachment MIME allow-list and size caps; no Brevo credential in the browser; rate-limited sends; audited sends; Full Admin only.

**Acceptance criteria.** A real inbound message appears in the inbox with correct metadata and safe rendering; an attachment downloads only for an authorised Full Admin via a short-lived URL; a composer send is recorded in audit and reflected in sent history; a forged or unsigned worker callback is rejected; a failed Brevo call leaves a retryable outbox row rather than a false success.

**Regression risks.** New HTML-rendering surfaces must not be reachable from untrusted input without sanitisation. Existing public pages must be unaffected.

**Expected user-visible outcome.** Full Admins read and answer business email in the dashboard and send one-off business emails through the composer.

**Dependencies.** Phase 1 and strongly Phase 2 (shared outbox/audit patterns). Domain confirmed (`2ndwavelaundry.com`); DNS/Email Routing activation and Brevo sender verification remain external prerequisites.

**MVP vs deferred.** MVP: inbound persistence + safe rendering + read state + reply via Brevo; composer with plain-text-plus-attachments. Defer: advanced threading UI, snooze/assign, saved templates.

---

### Phase 5 — Newsletter Campaign Management

**Current state.** Interest-only form and admin list, non-durable; campaigns explicitly out of scope until now.

**Required changes.** Durable `newsletter_subscribers` with consent version and source; migrate/replace the `Lead`-kind approach; unsubscribe mechanism; suppression and bounce handling via webhooks; campaign CRUD with subject/preview/rich body/images; test send; scheduling if supported; send via the Brevo Campaigns API; status history and reporting; Full Admin only.

**Files/modules affected.** `src/components/admin/leads.tsx` (superseded for newsletter), new campaign module, `src/components/published-content.tsx:111–123` (form wiring), `src/components/forms/public-form.tsx` (consent version capture), `src/components/admin/settings.tsx` (newsletter toggle remains).

**Schema dependencies.** Phase 1; Phase 2 patterns (outbox not used for campaigns, but audit and webhook verification are shared).

**Security requirements.** Marketing consent must be genuine, versioned and distinct from booking data; suppression honoured; unsubscribe working; no auto-enrolment of booking contacts.

**Acceptance criteria.** A subscriber can only be created through a consented form submission; withdrawal and unsubscribe both suppress future sends; a campaign send never consumes transactional capacity in a way that blocks booking emails (verified against Brevo plan behaviour); campaign history is auditable.

**Regression risks.** The existing public newsletter section and settings toggle must continue to behave; demo mode must not write real subscribers.

**Expected user-visible outcome.** Full Admins build and send consented newsletters with reporting.

**Dependencies.** Phase 1; approved privacy wording for marketing consent (external prerequisite); Brevo marketing sender verification; **Requires current official documentation verification** of Campaign API availability on the chosen plan.

**MVP vs deferred.** MVP: subscriber list with consent version, withdrawal, campaign draft/test/send, suppression import. Defer: scheduling, A/B testing, detailed analytics.

---

## 21. Acceptance Criteria and Verification Strategy

### Cross-cutting verification (all phases)

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` continue to pass; new rule tests are added for every new state machine (review states, outbox states, campaign states) in the existing Node test-runner style.
- **Authorisation matrix tests** for every admin route and mutation: anonymous denied, `operational_admin` denied outside scope, `full_admin` permitted — exercised against the **server** entry points, not the UI.
- **RLS tests** exercised with the anon key, a normal authenticated user and each admin role, per `docs/source/2ND_WAVE_SRS.md:136`.
- **Idempotency and concurrency tests** for booking create/update and review moderation, mirroring `tests/repository.test.ts:57–91`.
- **No secrets in client bundles** — verify `BREVO_*` and `SUPABASE_SERVICE_ROLE_KEY` are absent from client-exposed code paths.
- Manual owner review of every new admin screen at mobile and desktop widths, consistent with the existing review process (`docs/IMPLEMENTATION_REVIEW.md:148–158`).

### Phase-specific highlights

- **Phase 1:** direct URL access to a restricted admin route returns the access-denied state; a forged request with a manipulated role claim is rejected server-side; RLS denies guest access to `admin_profiles`.
- **Phase 2:** exactly one email per event per address across retries and replays; a rolled-back booking transaction produces no outbox row; alert recipients cannot be listed or edited by an Operational Admin.
- **Phase 3:** an unapproved review and an unpublished reply are unreachable via the public read path under RLS; the original review body is byte-identical after an edited publication is published; every override has a non-empty reason in the audit log.
- **Phase 4:** an unsigned/forged inbound callback is rejected; inbound HTML containing `<script>` is stored but rendered inert; an attachment URL expires and cannot be reused; composer sends never expose the API key.
- **Phase 5:** a suppressed or withdrawn subscriber is excluded from a campaign send; booking customers are not present in the subscriber list; unsubscribe links function end-to-end.

### What cannot be verified from this repository

No browser automation, screenshot testing, load testing or cross-provider integration testing is possible until real providers, credentials and a domain exist. All external platform limits remain **Requires current official documentation verification**.

---

## 22. Open Questions and Decisions Required

1. ~~**Scope change approval.**~~ **RESOLVED 10 October 2026.** The two-role model is formally authorised; "extra staff roles" removed from the PRD excluded list and PRD §2a / SRS updated. No further approval needed.
2. ~~**Business domain and email address.**~~ **RESOLVED 10 October 2026 (domain).** Domain confirmed: `2ndwavelaundry.com`. Individual mailbox names remain open — see item 3.
3. **Sender identities.** Confirm the transactional sender mailbox and whether a distinct marketing sender will be used for newsletters. *Deferred; does not block Phase 1.*
4. **Privacy wording.** Approved marketing-consent wording and versioning scheme must exist before newsletter collection is activated (`docs/source/CONTENT LIGHTMODE.md:24`). *Deferred; gates Phase 5 activation, not Phase 1.*
5. **Retention periods.** Approved retention for inbound business email, outbound history, review submissions and newsletter subscribers — these must not silently inherit the 12-month booking period. *Deferred; gates Phase 4/5 activation, not Phase 1.*
6. **Which status transitions email the customer.** The six proposed events are recommended; confirm whether `scheduled` and `out_for_delivery` should also notify. *Open; needed before Phase 2 implementation.*
7. **Cancellation email content.** Should the customer-facing cancellation email include the internal cancellation reason? (Recommendation: no.) *Open; needed before Phase 2 implementation.*
8. **Emergency override semantics.** Confirm whether Full Admin overrides are permitted on already-published reviews visible to the public, and whether a published review can be unpublished. *Open; needed before Phase 3 implementation.*
9. **Review–booking association.** Optional; confirm whether a booking reference should be collected on the review form. *Open; optional for Phase 3.*
10. ~~**Hosting platform.**~~ **RESOLVED 10 October 2026.** Vercel during development and testing; production hosting on Cloudflare after validation. Confirm Next.js runtime feature compatibility with the chosen Cloudflare product before cutover.
11. **Worker runtime for the outbox.** Supabase scheduled functions versus a Next.js cron route versus a dedicated worker — decide in Phase 2 design.
12. **Inbox scope.** Confirm which addresses route into the dashboard inbox (catch-all versus specific mailboxes).
13. **Attachment policy for the composer and inbox.** Maximum sizes, allowed types and per-user quotas.
14. **Brevo plan.** Confirm the intended plan and verify quotas (**Requires current official documentation verification**) before designing newsletter volume.
15. **Demo-mode behaviour in production builds.** Confirm that `NEXT_PUBLIC_DEMO_MODE=false` in production, with the demo session flag completely inert, is the intended default.

### Work that can proceed without the deferred decisions

The following can be designed, built and tested now, because none of it depends on mailbox names, privacy wording, retention periods or provider quotas:

- **Phase 1 in full** — Supabase Auth, `admin_profiles` with the authorised role enum, middleware, server-side `requireAdmin` checks, RLS policies, role-filtered navigation, first-admin provisioning. No email or domain configuration is required.
- **Phase 2 engineering, except live sending** — booking persistence against Supabase with transactions and actor-attributed history; the `booking_alert_recipients`, `email_outbox` and `email_delivery_events` schema; the outbox worker with idempotency, retries and dead-lettering; the settings UI for recipients with validation, enable/disable and test-send wiring. Live delivery can be exercised against a staging sender identity once one exists; the outbox and UI are sender-agnostic.
- **Phase 3 in full** — `review_submissions` with the state model, list/detail/filters, approve/reject with audit, reply drafting and publishing, edited publication versions, concurrency control, emergency overrides with mandatory reason, public-form rate limiting. None of this sends email.
- **Phase 4 design and scaffolding** — the inbound-email route handler contract, HMAC worker authentication, sanitiser, attachment allow-list and private-bucket layout, composer UI with drafts/attachments/audit records, and webhook signature verification. DNS, Email Routing activation and live Brevo sending wait on the deferred decisions; the code paths do not.
- **Phase 5 design only** — schema, consent-version model, suppression handling and the Campaign API integration design. Collection of real subscribers and campaign sends must wait for approved privacy wording and verified quotas.


---

## 23. Final Recommendations

1. **Do not extend the mock store.** Treat `src/lib/mock-store.ts` as a reference implementation of business rules, port those rules to a server-side adapter behind the existing `Repository` contract, and delete the demo store from production builds rather than evolving it.
2. **Phase 1 is non-negotiable and blocking.** Roles, real authentication, server-side authorisation and RLS must exist before any email, inbox or campaign work touches real customer data. Deploying the current admin console with real data behind it would be a critical vulnerability.
3. **Adopt the transactional outbox pattern from the start of Phase 2.** It simultaneously solves duplicate prevention, rollback safety, retries and delivery audit for customer emails, staff alerts, composer sends and webhook-driven status updates. Building email sends as inline side-effects of status changes will create unfixable consistency bugs.
4. **Preserve, do not redesign, the booking lifecycle.** The status model, confirmation gate, cancellation reason, express cutoff, idempotency and version-conflict behaviour in `src/lib/rules.ts` and `src/lib/mock-store.ts` are correct, tested and aligned with the SRS. Customer emails map onto existing statuses; no new statuses are needed.
5. **Give reviews a dedicated entity.** The `Lead` record cannot carry reply drafts, edited publication versions, moderation actors or concurrency versions. A `review_submissions` table following §9 is the maintainable path, and the original customer text must be immutable.
6. **Use Brevo Campaigns for newsletters, not transactional sends.** This protects booking-confirmation capacity and sender reputation, and provides unsubscribe/suppression natively.
7. **Treat inbound email HTML and composer HTML as new XSS surfaces.** Sanitise server-side with allow-lists; never render stored HTML unsanitised. The current codebase's escaping discipline must be preserved everywhere user text is displayed.
8. **Do not activate collection of newsletter subscribers, inbound mail or moderated reviews until approved privacy wording and retention periods exist.** These are documented external dependencies, not engineering unknowns.
9. **Record every external platform limit as requiring current official documentation verification.** No Brevo, Cloudflare or Supabase quota is asserted anywhere in this report, and none should be assumed during planning.
10. **Update the PRD, SRS and this report together** when the open questions in §22 are answered, so the source hierarchy (`docs/source/CONTENT LIGHTMODE.md:10`) remains accurate.

---

## Appendix A — Current vs Required vs Gap Matrix

Legend: **CONFIRMED EXISTING** · **PARTIALLY IMPLEMENTED** · **MISSING** · **UNVERIFIED** · **SECURITY CONCERN**

| Feature | Current state | Required state | Gap | Classification |
| --- | --- | --- | --- | --- |
| Admin authentication | Mock screens; sessionStorage flag | Supabase Auth with real sessions | Entire layer | MISSING / SECURITY CONCERN |
| Admin route protection | Client-side visual gate only | Middleware + server + RLS | Entire layer | MISSING / SECURITY CONCERN |
| `full_admin` role | Does not exist | Role with full module access | New table + enforcement | MISSING |
| `operational_admin` role | Does not exist | Bookings + reviews only | New table + enforcement | MISSING |
| Staff provisioning UI | Does not exist | Invite/disable Full Admin workflow | New | MISSING |
| Navigation visibility | Static `adminNav`, all items for everyone | Role-filtered | Small change to `content.ts` + `shell.tsx` | PARTIALLY IMPLEMENTED (structure exists) |
| Booking lifecycle | 9 statuses, transitions, gates, history | Unchanged + actor attribution | Actor field; server persistence | CONFIRMED EXISTING (logic) / MISSING (durability, actor) |
| Booking operations UI | Filters, inline status/branch, detail, cancel, WhatsApp draft | Unchanged, plus delivery indicators | Minimal | CONFIRMED EXISTING |
| WhatsApp handoff | Manual draft, wa.me deep link, no send claim | Unchanged | None | CONFIRMED EXISTING |
| Booking reference | Opaque `DEMO-` + UUID fragment | Server-generated opaque reference | Move generation server-side | PARTIALLY IMPLEMENTED |
| Idempotent booking create | Key + hash, concurrent-safe | Same, server-side | Port | CONFIRMED EXISTING (logic) |
| Optimistic concurrency | `version` integer with friendly conflict | Same for bookings, reviews, drafts | Extend to reviews/drafts | PARTIALLY IMPLEMENTED |
| Customer transactional emails (6) | Nothing | Outbox-driven, idempotent, retried | Entire feature | MISSING |
| Staff booking alerts | Nothing | Multi-recipient, enable/disable, test send, failures | Entire feature | MISSING |
| Alert recipient settings section | Nothing | Full Admin panel in Settings | New panel + table | MISSING |
| Review submission | Form + consent capture | Unchanged + rate limiting + notice version | Abuse controls | PARTIALLY IMPLEMENTED |
| Review moderation | Approve/reject only | Approve/reject + filters + detail + history + actor | Large expansion | PARTIALLY IMPLEMENTED |
| Review replies | Nothing | Draft/edit/publish with public gating | Entire feature | MISSING |
| Edited publication version | Nothing | Editable published text; original immutable | Entire feature | MISSING |
| Emergency override | Nothing | Full Admin + mandatory reason + audit | Entire feature | MISSING |
| Review XSS safety | React text escaping | Same, plus sanitisation for any rich replies | Preserve pattern | CONFIRMED EXISTING |
| Public reviews display | Approved + consent only | Published-version + published replies only | New read path under RLS | PARTIALLY IMPLEMENTED |
| Brevo integration | Nothing | Transactional + composer + webhooks + templates | Entire feature | MISSING |
| Email composer | Nothing | Rich text, attachments, drafts, send, history | Entire feature | MISSING |
| Cloudflare Email Routing/Worker | Nothing | Inbound capture with authenticated callback | Entire feature + external setup | MISSING |
| Inbound inbox | Nothing | Threads, folders, read state, search, attachments | Entire feature | MISSING |
| Newsletter subscribers (durable) | In-memory `Lead` only; lost on refresh | Consent-versioned durable list | Entire feature | MISSING |
| Newsletter campaigns | Nothing | Brevo Campaigns API module | Entire feature | MISSING |
| Unsubscribe / suppression | Admin withdrawal only, in-memory | Working unsubscribe + bounce/complaint suppression | Entire feature | MISSING |
| Audit logging | Nothing (booking history strings without actor) | Append-only `audit_events` with actor + before/after | Entire feature | MISSING |
| Retention enforcement | Values displayed as read-only text | Daily protected cleanup job for all PII sets | Entire feature | MISSING |
| Rate limiting on public forms | Nothing | Server-side limits per endpoint | Entire feature | MISSING / SECURITY CONCERN |
| Observability | Nothing | Correlation IDs, redacted logs, failed-job alerts | Entire feature | MISSING |
| Secrets management | `.env.example` with one flag only | Server-only provider secrets + rotation | New, none committed | CONFIRMED EXISTING (clean) / MISSING (capability) |
| Security headers | Set in `next.config.ts` | Keep; extend as needed | Minimal | CONFIRMED EXISTING |
| Business email/domain | Domain **confirmed: `2ndwavelaundry.com`** (10 Oct 2026); mailbox names unset | Verified mailbox + sender identities | Mailbox naming decision | CONFIRMED (domain) / UNVERIFIED (mailboxes) |
| Hosting / production env | Vercel during dev/testing; **Cloudflare** for production (decided 10 Oct 2026) | Same, with Next.js runtime compatibility confirmed on Cloudflare before cutover | Cutover verification | CONFIRMED (decision) / UNVERIFIED (compatibility) |
| Brevo/Cloudflare/Supabase quotas | Not in repository | Verified against official docs | External dependency | UNVERIFIED |

---

*End of investigation report. No implementation was performed.*
