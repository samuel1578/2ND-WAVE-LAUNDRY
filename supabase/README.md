# Supabase migrations

Versioned SQL migrations. Apply them manually with the Supabase CLI or the
dashboard SQL editor — nothing in this repository runs migrations automatically
against a hosted project, and `supabase db reset` must never be run against a
hosted project.

## Execution order

Phase 1 migrations were applied manually to the hosted project. Apply the
remaining migrations after them, in filename order, only when they have not
already been applied to the target project.

| # | File | Purpose |
| --- | --- | --- |
| 1 | `migrations/20261010120000_admin_profiles.sql` | `private` helper schema, `admin_role` enum, `public.admin_profiles` table, `updated_at` trigger |
| 2 | `migrations/20261010120100_admin_profiles_rls.sql` | RLS enablement, table grants, `private.current_admin_role()` / `private.is_full_admin()`, SELECT policies |
| 3 | `migrations/20261011120000_admin_profiles_email.sql` | Administrator email column and backfill |
| 4 | `migrations/20261011120100_audit_events.sql` | `public.audit_events` append-only audit log |
| 5 | `migrations/20261011120200_admin_invitations.sql` | `public.admin_invitations` staff invitation lifecycle |
| 6 | `migrations/20261011120300_admin_staff_functions.sql` | Trusted `staff_*` functions (service-role only) |
| 7 | `migrations/20261011130000_booking_schema.sql` | **Sprint 2A** — booking status/service kinds, branches, services, opening hours, pickup windows/exceptions, booking settings, `bookings`, `booking_services`, `booking_status_history`, `booking_notes`, `booking_photos` |
| 8 | `migrations/20261011130100_booking_rls.sql` | **Sprint 2A** — RLS enablement, grants and `private.is_active_admin()` |
| 9 | `migrations/20261011130200_booking_functions.sql` | **Sprint 2A** — trusted `booking_*` functions (service-role only) |
| 10 | `migrations/20261011130300_booking_retention.sql` | **Sprint 2A** — retention job log and due-record helpers (no destructive cleanup) |
| 11 | `migrations/20261011140000_booking_rate_limit.sql` | **Sprint 2B** — shared fixed-window rate limiter for public booking submissions (`public.booking_rate_limits` + `public.booking_rate_limit_consume`, service_role only) |
| 12 | `migrations/20261013100000_booking_photos_storage.sql` | **Sprint 2C** — private `booking-photos` bucket (5 MB, JPEG/PNG/WebP); adds no `storage.objects` policies |
| 13 | `migrations/20261019120000_email_outbox.sql` | **Sprint 2D.1** — `public.email_outbox`, six typed booking notification templates, transactional enqueue triggers on `public.bookings`, RLS with no client access. No email is sent. |
| 14 | `migrations/20261019130000_email_delivery.sql` | **Sprint 2D.2** — outbox claim/reap/retry/dead-letter functions, per-provider-message delivery events, RLS with no client access. Requires migration 13. No email is sent by the migration. |
| 15 | `migrations/20261019140000_email_monitoring.sql` | **Sprint 2D.3** — audited, active-Full-Admin-only retry of one dead outbox row. Requires migrations 13–14. No email is sent by the migration. |
| 16 | `migrations/20261029172000_booking_compute_maintenance.sql` | Booking rate-limit maintenance: removes expired counters and installs a service-role-only cleanup function. Apply after `20261011140000_booking_rate_limit.sql`. |
| 17 | `migrations/20261029174000_website_content_lock_timeout.sql` | Phase 6 write safety: bounds FAQ/gallery lock waits and returns a retryable error instead of waiting for the gateway timeout. Apply after `20261028100000_phase6_website_content.sql`. |

Each new migration ends with read-only verification queries. Run the file and
check the returned rows before moving to the next one. For migration 12,
confirm the bucket is private with the expected limits and inspect the listed
`storage.objects` policies to ensure none grants client access to this bucket.
Migration 7 shows `rls_enabled = false` by design; re-run its verification
query after migration 8. Migration 14 must be applied only after migration 13;
its verification queries should show `email_delivery_events` with RLS enabled,
zero policies, no `anon`/`authenticated` privilege and `service_role` access
only through the narrow grants.

## Other directories

- `bootstrap/` — reviewed provisioning statements. Not migrations; they need a
  real auth user id and are run deliberately by a trusted operator.
  - `001_provision_full_admin.sql` — create the first Full Admin (refuses an
    already-provisioned account).
  - `002_provision_operational_admin.sql` — create an Operational Admin.
  - `003_disable_restore_admin.sql` — revoke or restore access for one account.
  - `004_change_admin_role.sql` — the only supported role change, with an
    explicit confirmation flag.
- `tests/` — database-level privilege and policy checks to run against a local or
  branch database. Check the target project's migration history before applying
  any migration; hosted migration state is not inferred from this repository.
  - `admin_profiles_rls.sql`, `sprint_1c_staff_security.sql` — Phase 1 checks.
  - `sprint_2a_booking_security.sql` — Sprint 2A booking security, scheduling,
    idempotency and lifecycle checks. It runs in a transaction and rolls back.
    **Never run it against the hosted project.**
  - `sprint_2d1_email_outbox.sql` — Sprint 2D.1 outbox creation, lifecycle
    mapping, duplicate/forged rejection, atomic rollback, RLS and grant checks.
    It runs in a transaction and rolls back. **Never run it against the hosted
    project.** It was executed through a one-off PGlite runner with every
    migration applied and passed; it has not been run against a full Supabase
    instance. The same migration is also executed automatically by the Node tests
    below against PGlite.

## Automated database tests

`npm test` includes three PGlite/WASM PostgreSQL test files that need no server
and never touch the hosted project:

- `tests/email-outbox-db.test.ts` — applies the Sprint 2D.1 migration to a focused
  booking harness and exercises creation, optional email, replay, uniqueness,
  lifecycle mapping, rollback, forged data, lease invariants, RLS and grants.
- `tests/email-outbox-integration-db.test.ts` — applies **every** migration in
  filename order, then drives the real `booking_submit`,
  `booking_update_arrangement` and `booking_transition` functions to verify that
  enqueueing is atomic and idempotent.
- `tests/email-delivery-db.test.ts` — applies every migration, then exercises the
  Sprint 2D.2 claim/reap/retry/dead-letter functions, delivery-event constraints,
  cascade deletion and the RLS/grant boundary.

PGlite is a real PostgreSQL engine but not the full Supabase stack: `auth.users`,
`auth.uid()` and `storage.buckets` are minimal stubs. The SQL scripts in
`supabase/tests/` remain the full-role equivalent for an operator with a
disposable local Supabase instance.

The owner reports that the Sprint 2C private booking-photo bucket and admin
image-viewing flow passed an end-to-end test. The migration's verification query
reports bucket limits and lists all `storage.objects` policies for review; confirm
the output and migration history separately for each deployment environment.

## Security notes

- `private` is not exposed by the Supabase Data API, so the security-definer
  helpers cannot be called by a client. `USAGE` on `private` and `EXECUTE` on the
  helpers are granted to `authenticated` only where a policy needs them, because
  RLS policies are evaluated as the querying role.
- Both helpers and trusted functions pin `search_path = ''` and fully
  schema-qualify every identifier.
- No client role can insert, update or delete `admin_profiles` or any booking
  table: there is no write policy, and the table grants are read-only for
  `authenticated` with nothing for `anon`.
- Every booking mutation goes through the trusted `booking_*` functions, which are
  callable by `service_role` only. The application must establish the caller's real
  permissions on the server before invoking them, and each administrative function
  re-validates the acting administrator in the database.
- `public.email_outbox` has RLS enabled and **no policies**. `anon` and
  `authenticated` have no table privilege at all. Rows are inserted by private
  triggers in the same transaction as the booking change; only the elevated
  server role may read or update them. No email is sent by the migrations.
- `public.email_delivery_events` also has RLS enabled with **no policies**, and
  `anon`/`authenticated` have no privilege. It stores only the outbox id,
  normalised delivery event, replay digest, a bounded reason and event time — no
  recipient address, subject or body. The worker functions are `SECURITY DEFINER`,
  search-path-pinned and executable by `service_role` only. See
  `docs/implementation/SPRINT_2D_EMAIL_IMPLEMENTATION.md` for activation and the
  scheduler prerequisite.

See `docs/implementation/SPRINT_1A_SUPABASE_AUTH.md`,
`docs/implementation/SPRINT_1C_SECURITY_STAFF_AUDIT.md` and
`docs/implementation/SPRINT_2A_BOOKING_DATABASE_FOUNDATION.md` for the full
activation procedures.
