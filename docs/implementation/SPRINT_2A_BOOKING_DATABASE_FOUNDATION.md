# Sprint 2A — Production Booking Database Foundation, Security & Scheduling Rules

**Status:** implementation complete, verification performed, **migrations not applied
to the hosted Supabase project.**

**Scope:** the secure, production-ready database foundation and server-side data
contracts for real customer bookings. The public booking form was **not activated**,
the administrator console was **not switched** to live data, and no email was sent.

---

## A. Implementation summary

Sprint 2A establishes the production booking foundation behind the existing
Next.js App Router application without changing the current demonstration
experience:

- a normalised PostgreSQL schema for bookings and their child records;
- reference data (branches, services) and two distinct opening-hour concepts;
- scheduling configuration that models the approved pickup window and the separate
  express cutoff;
- Row Level Security on every exposed booking table, with no client write path;
- trusted, service-role-only database functions that own every write, idempotency,
  reference generation, lifecycle transitions and concurrency;
- a retention foundation that records the policy and identifies due records without
  deleting anything;
- reusable, strongly typed server-side TypeScript contracts, validators and
  repository scaffolding for Sprints 2B and 2C.

Why this shape: the SRS requires that anonymous visitors never read or modify the
bookings table directly, that only authorised staff mutate bookings, that every
write is auditable and atomic, and that scheduling eligibility uses trusted server
time. Putting the rules in the database (as constraints and trusted functions)
means a public endpoint cannot become a privileged gateway, even if it is misused.

---

## B. Files changed

### New SQL migrations

| File | Purpose |
| --- | --- |
| `supabase/migrations/20261011130000_booking_schema.sql` | Booking types, reference data, scheduling configuration and core tables |
| `supabase/migrations/20261011130100_booking_rls.sql` | RLS, grants and the `private.is_active_admin()` helper |
| `supabase/migrations/20261011130200_booking_functions.sql` | Trusted `booking_*` functions and private scheduling/lifecycle helpers |
| `supabase/migrations/20261011130300_booking_retention.sql` | Retention job log and read-only due-record helpers |

### New SQL test script

| File | Purpose |
| --- | --- |
| `supabase/tests/sprint_2a_booking_security.sql` | Disposable security/scheduling/lifecycle/invariant checks (transaction + rollback) |

### New TypeScript

| File | Purpose |
| --- | --- |
| `src/lib/bookings/types.ts` | Booking statuses, categories, field limits, retention constants and contracts |
| `src/lib/bookings/errors.ts` | Error taxonomy, safe messages, HTTP statuses and database-marker mapping |
| `src/lib/bookings/scheduling.ts` | Pure Africa/Accra pickup-window and express-cutoff validation |
| `src/lib/bookings/validation.ts` | Pure public request validator and `booking_submit` payload builder |
| `src/lib/bookings/lifecycle.ts` | Transition rules, confirmation prerequisites and arrangement validation |
| `src/lib/bookings/reference.ts` | Reference format validation and idempotency-key helpers |
| `src/lib/bookings/repository.ts` | Server-only privileged repository scaffolding (calls the trusted functions) |
| `tests/bookings.test.ts` | 22 focused tests for scheduling, validation, lifecycle and errors |

### Modified

| File | Change |
| --- | --- |
| `supabase/README.md` | Full migration execution order and updated security notes |
| `docs/implementation/SPRINT_2A_BOOKING_DATABASE_FOUNDATION.md` | This document |

No existing application component, route, data file or demo record was changed.

---

## C. SQL migrations

Apply manually, in this exact order, **after** the Phase 1 migrations.

| # | File | Depends on |
| --- | --- | --- |
| 1 | `20261011130000_booking_schema.sql` | Phase 1 `private` schema, `admin_role`, `admin_profiles`, `audit_events` |
| 2 | `20261011130100_booking_rls.sql` | Migration 1; Phase 1 `private.is_full_admin()` |
| 3 | `20261011130200_booking_functions.sql` | Migrations 1–2; Phase 1 `private.insert_audit_event` |
| 4 | `20261011130300_booking_retention.sql` | Migrations 1–3; Phase 1 `private.is_full_admin()` |

Each file is a self-contained, executable PostgreSQL script wrapped in
`BEGIN; … COMMIT;` and ends with read-only verification `SELECT`s. All four are
**new objects only**: no Phase 1 table, function, type or policy is recreated or
modified, and no production table is reset, dropped or truncated.

> Phase 1 migrations were applied manually to the hosted project and may not be
> recorded as applied in the migration history. Nothing here runs `supabase db
> push`, and nothing assumes the history is consistent.

---

## D. Environment variables

**No new environment variables are required for Sprint 2A.**

The trusted functions are invoked through the existing server-only elevated client
(`src/lib/supabase/admin.ts`), which already reads `SUPABASE_SECRET_KEY` or
`SUPABASE_SERVICE_ROLE_KEY`. Those are existing Phase 1 variables and are never
placed in a `NEXT_PUBLIC_*` name. This sprint adds no route that calls them yet.

---

## E. Verification

Run in this environment on 11 October 2026:

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` (`next typegen && tsc --noEmit`) | **Passed** |
| Lint | `npm run lint` (`eslint .`) | **Passed** (0 errors; 1 pre-existing warning in `.opencode/plugins/graphify.js`, unrelated) |
| Automated tests | `npm test` | **Passed** — 128 tests, 0 failures (22 new booking tests) |
| Production build | `npm run build` (`next build --webpack`) | **Passed** |
| Static migration review | manual read of all four migrations | Completed |

### Database tests — NOT executed

`supabase/tests/sprint_2a_booking_security.sql` was **not executed**: no local
PostgreSQL or Supabase CLI was available, and the migrations were not applied to
the hosted project. Its behaviour is **asserted but unproven** and must not be
reported as passing until the owner runs it against a disposable database.

The following Sprint 2A checks therefore remain to be executed in a database:
public read/status denial, operational-admin authorisation, invalid transitions,
reference uniqueness, concurrent duplicate submission, version conflicts, pickup
boundary handling, express cutoff, missing phone, optional email and
no-partial-write on validation failure. The pure equivalents are covered by
`tests/bookings.test.ts`.

---

## F. Owner action required

1. **Review** the four migration files and this document.
2. **Back up** or snapshot the hosted database before applying anything.
3. In the Supabase **SQL editor**, run each file in the order in Section C:
   - run `20261011130000_booking_schema.sql`, then inspect its verification output
     (branch/service/window counts; `rls_enabled` is `false` here by design);
   - run `20261011130100_booking_rls.sql` and confirm `rls_enabled = true` for all
     booking tables and the privilege query returns `anon` = false/false and
     `authenticated` = true for SELECT only;
   - run `20261011130200_booking_functions.sql` and confirm the four `booking_*`
     functions exist and only `service_role` can execute `booking_submit`;
   - run `20261011130300_booking_retention.sql` and confirm `retention_jobs` has RLS
     enabled with one policy.
4. **Verify data:** `select count(*) from public.branches;` should be 3,
   `public.services` should be 10, `public.branch_pickup_windows` 21 and
   `public.branch_operating_hours` 21.
5. **Optional:** apply the same migrations to a disposable database and run
   `supabase/tests/sprint_2a_booking_security.sql` to prove the security and
   scheduling invariants. Never run that script against the hosted project.
6. Approve proceeding to Sprint 2B.

---

## G. What to expect

After Sprint 2A, with the migrations applied:

- Production booking tables, constraints, RLS and trusted functions are ready.
- Existing administrator authentication and permissions remain functional and
  unchanged (no Phase 1 object was touched).
- The existing demo booking screens remain fully functional — no component, route
  or demo record was modified.
- Public bookings are **not yet saved** to production: no submission route exists.
- Admin bookings are **not yet switched** to the live database.
- Brevo/email is **not active**, and no WhatsApp automation was added.
- No destructive retention cleanup runs.

---

## H. Sprint 2B handoff

Prepared integration points:

- **Validation:** `validatePublicBookingRequest(raw, { services, now })` returns a
  normalised request or structured field errors; `toBookingSubmitPayload` produces
  the exact JSON the trusted function expects.
- **Submission:** `submitPublicBooking({ payload, services, idempotencyKey, correlationId, submissionScope })`
  in `src/lib/bookings/repository.ts` calls `public.booking_submit` through the
  server-only elevated client. Generate the key with `createIdempotencyKey()`.
- **Scheduling:** `schedulingFailure`, `pickupWindowError` and
  `expressEligibilityError` for server-side eligibility that mirrors the database.
- **Errors:** `mapBookingDatabaseError` and `bookingErrorStatus` for stable codes,
  safe messages and HTTP statuses (201/200 replay, 409 mismatch/conflict, 422
  validation/time, 429 throttle, 503 paused).
- **Statuses/limits:** `bookingStatuses` and `BOOKING_LIMITS` are the shared
  contracts; a test asserts they match the front-end rules.
- **Database:** requires all four Sprint 2A migrations. `public.booking_submit` is
  the only creation path.

Sprint 2B should add the rate-limited `POST /api/bookings` route (with origin/CSRF
checks), wire the existing form to it behind a feature gate, and keep the demo path
intact until cutover. No public read-by-reference endpoint should be added.

---

## I. Architecture detail

### Schema

- `public.branches` — the three approved branches, production source of truth for
  assignment.
- `public.services` — the approved catalogue with `kind`
  (`laundry`/`modifier`/`information`/`commercial`) and `bookable`.
- `public.branch_operating_hours` — walk-in hours, default **07:00–20:00**.
- `public.branch_pickup_windows` — pickup window, default **07:00–17:00**, seven
  days.
- `public.branch_pickup_exceptions` — date-specific overrides (holidays, closures).
- `public.booking_settings` — single-row settings: pickup window, express cutoff
  (11:00), timezone and a public-booking pause flag.
- `public.bookings` — the booking record, including request data, agreed
  arrangements, lifecycle status, version and retention deadline.
- `public.booking_services` — immutable snapshot of the selected services.
- `public.booking_status_history` — append-only lifecycle history.
- `public.booking_notes` — append-only private notes.
- `public.booking_photos` — retention metadata scaffolding only (no upload path).
- `public.retention_jobs` — future job log (counts only, no personal data).

Relational tables are used throughout; JSONB is reserved for audit before/after
snapshots and genuinely variable submission payloads, never for the operational
model.

### Historical integrity

`booking_services` stores `service_slug` and `service_title` at submission, with a
nullable `service_id`. Editing or removing a catalogue service therefore never
rewrites what the customer originally requested, and an archived service leaves a
readable historical record.

### Lifecycle

Agreed states: `pending → confirmed → scheduled → picked_up → processing → ready →
out_for_delivery → completed`, with `cancelled` reachable from every non-terminal
state and `completed`/`cancelled` terminal. Every new booking starts `pending` and
a submission can never confirm itself, assign an unagreed appointment, mark payment
or invent a charge. The allowed transitions are enforced in
`private.booking_transition_allowed`, and the same map exists in
`src/lib/bookings/lifecycle.ts` for the interface (a test asserts parity).

Confirmation requires an assigned branch, an agreed pickup datetime, an agreed
non-negative fee (with a recorded reason when zero), a contact outcome and a
confirmation note, and the agreed appointment must fall inside the branch pickup
window. Cancellation requires a reason and records the acting administrator.

### Concurrency

`bookings.version` is the optimistic-concurrency counter. Every administrative
function takes `p_expected_version`, locks the row with `SELECT … FOR UPDATE`,
rejects a mismatch as `BOOKING_CONFLICT`, and increments the version in the same
transaction as the history and audit writes.

### Security (RLS and grants)

- RLS is enabled on every exposed booking table.
- `anon` receives **no grant** and no policy on booking data.
- `authenticated` receives `SELECT` only, gated by `private.is_active_admin()` (both
  administrator roles may read bookings). There is no insert, update or delete
  policy, so client writes are denied by default.
- `booking_photos` is additionally unreadable once `delete_due_at` is due.
- The four `booking_*` functions are `SECURITY DEFINER`, pin `search_path = ''`,
  are revoked from `PUBLIC`/`anon`/`authenticated`, and granted to `service_role`
  only. Each administrative function re-validates the acting account against
  `admin_profiles` and never trusts a role from the request.
- `private` helpers are not exposed by the Data API; `USAGE` and `EXECUTE` are
  granted only where a policy needs them.

### Time validation

Timezone is `Africa/Accra`. `private.assert_pickup_request` validates the requested
date (not in the past) and time (inside the window, inclusive at 07:00 and 17:00)
and rejects a same-day request once the window has closed. `private.assert_express_request`
is a **separate** check for an express request for today, accepting exactly 11:00:00
and rejecting 11:00:01. Absent per-branch configuration falls back to the approved
07:00–17:00 default, never to an unrestricted window, and no weekday or holiday is
treated as closed. The same rules are mirrored as pure functions in
`src/lib/bookings/scheduling.ts`.

### Idempotency and references

References are generated server-side (`2W-` plus ten random characters) with a
unique constraint and bounded retry. Submissions are idempotent on
`(submission_scope, idempotency_key)`: a replay with the same payload returns the
original committed result (and is **not** re-evaluated against a later cutoff),
while a reused key with a different payload raises `BOOKING_IDEMPOTENCY_MISMATCH`.
The unique index resolves two concurrent identical submissions deterministically.
References are opaque and never authorise access.

### Retention model

`bookings.expires_at` defaults to creation + **12 months**; `booking_photos.delete_due_at`
is upload + **90 days**. `public.retention_jobs` records future runs by count only.
`private.due_bookings`/`private.due_photos` and `public.retention_due_summary()`
identify due records read-only. **No deletion function or job is created**; that
belongs to Sprint 2F, and photo retention design covers the child records.

### Known limitations and documentation conflicts

1. **Service count.** The SRS states "exactly eleven approved services", but the
   current booking form and catalogue define ten (nine bookable plus the
   non-bookable `pickup-and-delivery`). The eleventh service is not identifiable
   from the sources, so the seed mirrors the **actual existing catalogue** rather
   than inventing an entry. **Client confirmation is required.**
2. **Branch source of truth.** `public.branches` is the production source of truth;
   the public site still reads `src/lib/content.ts`. These are intentionally not
   wired together in 2A; reconciling them happens in Sprint 2C. Contact details and
   map links remain in the content layer until then.
3. **Existing front-end validator.** `schedulingError` in `src/lib/rules.ts`
   (used by the demo form) was deliberately left unchanged so the demonstration
   keeps working. It already matches the approved boundaries, but it is front-end
   code and must not be the production authority; Sprint 2B should call the
   server-side rules in `src/lib/bookings/scheduling.ts`. Any defects found there
   are documented for 2B rather than silently changed here.
4. **Photo upload.** Only retention metadata is modelled. There is no upload route,
   bucket, signed URL or processing pipeline.
5. **Booking creation while paused.** The `accept_public_bookings` flag already
   rejects submissions, but no UI to toggle it exists — that is a later sprint.
6. **Database tests unexecuted** (Section E): the SQL invariants are asserted but
   not yet proven in a live database.
