# Sprint 2D — Customer Transactional Email: Implementation and Acceptance

This consolidated report combines the implementation record for Sprint 2D.1 (transactional outbox), Sprint 2D.2 (Brevo delivery), and Sprint 2D.3 (administrator monitoring and acceptance). Sections below retain each sprint's scope, verification results, operational prerequisites, and unresolved external acceptance steps.

**Overall status:** implementation and local verification are complete. Sprint 2D is **not accepted for live operation**: no hosted migration has been applied, no Brevo request or controlled live send has been made, and neither a scheduled retry worker nor a live webhook configuration is verified. See Sprint 2D.3 for current operator prerequisites and acceptance steps.


## Sprint 2D.1 — Customer Email Foundation and Transactional Outbox

**Status:** implemented and verified locally. **No email is sent. No hosted
migration has been applied.** The delivery layer built on this foundation is
documented in the Sprint 2D.2 section of this consolidated report.

This section is the completion report for the database foundation. The Brevo
delivery worker and administrator delivery view are documented in the following
sections. Destructive retention remains out of scope for Sprint 2D and is
documented as a Sprint 2F requirement.

---

### 1. What was inspected

The implementation was derived from the current repository, not from older
planning notes.

| Area | Source of truth inspected |
| --- | --- |
| Booking schema and lifecycle | `supabase/migrations/20261011130000_booking_schema.sql` |
| Booking RLS, grants, admin helper | `supabase/migrations/20261011130100_booking_rls.sql` |
| Public submission, replay, transitions, arrangements, audit | `supabase/migrations/20261011130200_booking_functions.sql` |
| Retention conventions and job log | `supabase/migrations/20261011130300_booking_retention.sql`, `20261011140000_booking_rate_limit.sql` |
| Photo retention and private bucket | `20261011130000_booking_schema.sql` §11, `20261013100000_booking_photos_storage.sql` |
| Server-only elevated client | `src/lib/supabase/admin.ts` |
| Public submission route and orchestration | `src/app/api/bookings/route.ts`, `src/lib/bookings/submission.ts`, `repository.ts` |
| Optional email rules | `src/lib/bookings/validation.ts`, `src/lib/rules.ts` |
| Privacy notice and policy content | `src/data/content.json` §18, `docs/source/2ND_WAVE_SRS.md`, `docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md` |
| Email architecture intent | `docs/investigations/ADMIN_OPERATIONS_EMAIL_ARCHITECTURE.md` |

Confirmed before editing:

- `booking_submit` is the only creation path and returns the committed booking
  before any `INSERT` on an idempotent replay.
- `booking_transition` writes the status update, `booking_status_history` row and
  `audit_events` row in one function call/transaction.
- `booking_update_arrangement` does **not** change status and therefore must not
  produce a customer notification.
- `customer_email` is nullable and validated only when present.
- The booking table already had `notice_version`, and `booking_submit` already
  persisted it — but the value came from the browser payload and the form never
  supplied one. It was therefore always blank and client-forgeable.
- No approved privacy-policy version identifier exists in the repository (see
  §6). This is an unresolved source-information blocker, not an invented value.

---

### 2. Files created or changed

#### Created

| File | Purpose |
| --- | --- |
| `supabase/migrations/20261019120000_email_outbox.sql` | Forward-only outbox schema, types, triggers, helpers, RLS and grants |
| `tests/email-outbox-db.test.ts` | 16 focused PGlite database tests for the outbox table/triggers/security |
| `tests/email-outbox-integration-db.test.ts` | 9 end-to-end PGlite tests applying every migration, driving the real booking functions and executing the operator SQL script |
| `tests/email-outbox.test.ts` | 3 unit tests for server-approved notice-version configuration |
| `supabase/tests/sprint_2d1_email_outbox.sql` | Operator SQL verification script for a disposable full Postgres/Supabase database (transaction + rollback) |
| `SPRINT_2D_EMAIL_IMPLEMENTATION.md` | Consolidated Sprint 2D implementation report |
| `src/lib/bookings/notice.ts` | Server-only privacy-notice version reader |

#### Changed

| File | Change |
| --- | --- |
| `src/lib/bookings/validation.ts` | Removed browser-supplied `noticeVersion`; `toBookingSubmitPayload(request, serverNoticeVersion)` now requires the server value |
| `src/lib/bookings/types.ts` | Removed `noticeVersion` from `NormalisedBookingRequest` |
| `src/lib/bookings/submission.ts` | Accepts `noticeVersion` as a trusted dependency and forwards it |
| `src/app/api/bookings/route.ts` | Supplies `privacyNoticeVersion` from server configuration |
| `tests/bookings.test.ts`, `tests/booking-api.test.ts` | Cover server-authoritative notice version and ignored forged value |
| `.env.example` | Documents `BOOKING_PRIVACY_NOTICE_VERSION` |
| `supabase/README.md` | Adds migration 13 and the automated database-test section |
| `package.json`, `package-lock.json` | Adds `@electric-sql/pglite` as a dev dependency for executable database tests |
| `tests/photo-upload.test.ts` | Repaired five **pre-existing** broken assertions/fixtures (see §9.4); no production photo code changed |

No booking lifecycle rule, confirmation gate, status enum, public booking
response shape or existing migration was altered.

---

### 3. Outbox schema

Migration: `supabase/migrations/20261019120000_email_outbox.sql` (wrapped in
`BEGIN … COMMIT`, forward-only, no hosted application).

#### Types

```sql
public.email_template:
  booking_created
  booking_confirmed
  booking_processing_started
  booking_ready
  booking_completed
  booking_cancelled

public.email_delivery_status:
  pending | sending | sent | retryable_failed | dead
```

#### `public.email_outbox`

| Column | Notes |
| --- | --- |
| `id uuid` | Primary key, `gen_random_uuid()` |
| `booking_id uuid` | Nullable for future non-booking notifications; `REFERENCES public.bookings(id) ON DELETE CASCADE` |
| `booking_version integer` | Committed `bookings.version` that caused the event; required with a booking |
| `idempotency_key text` | `booking:<uuid>:<template>:v<version>`, unique |
| `template public.email_template` | Typed event/template identifier |
| `recipient_email text` | Customer address from the booking row; format and length enforced |
| `payload jsonb` | **Only** `booking_reference` and `status`; extra keys are rejected |
| `status public.email_delivery_status` | Default `pending` |
| `attempt_count integer`, `max_attempts integer` | Defaults 0 / 5, bounded 0–20 |
| `next_attempt_at timestamptz` | Default `now()`; dispatch index |
| `locked_at`, `locked_by`, `lease_expires_at` | Worker claim/lease metadata |
| `provider_message_id text` | Nullable until a provider accepts the message |
| `last_error text` | Sanitised: max 500 chars, no newlines |
| `created_at`, `updated_at`, `sent_at` | Lifecycle timestamps; `updated_at` maintained by the existing `private.touch_updated_at()` trigger |

**Uniqueness**

- `UNIQUE (idempotency_key)` — the deterministic event key.
- `UNIQUE (booking_id, template, booking_version)` — a second, independent
  guarantee that the same committed booking version cannot enqueue the same
  event twice, even with a different textual key.

**Validation / invariants**

- Recipient email is trimmed, 3–254 chars, and matches a basic address shape.
- Payload is an object with exactly `booking_reference` and `status`; the
  reference matches `^2W-[0-9A-HJKMNP-TV-Z]{10}$`.
- Template and payload status must agree:
  `booking_created→pending`, `confirmed→confirmed`,
  `processing_started→processing`, `ready→ready`, `completed→completed`,
  `cancelled→cancelled`.
- `booking_id` and `booking_version` are present together.
- A `sending` row must hold a live lease (`lease_expires_at > locked_at`);
  every other state must hold no lease.
- `sent` requires `sent_at` and no other state may have it.
- `retryable_failed` and `dead` require a non-empty sanitised error.
- `dead` requires `attempt_count >= max_attempts`.

**Indexes**

- `(status, next_attempt_at)` — future worker polling.
- `(booking_id)` — booking lookup and cascade.
- `(lease_expires_at) WHERE status = 'sending'` — expired-lease reclamation.
- `(created_at)` — future retention review.

**Immutability**

`private.email_outbox_identity_immutable()` rejects any update to
`idempotency_key`, `booking_id`, `booking_version`, `template`,
`recipient_email`, `payload` or `created_at`. Delivery may change status,
attempts, lease, provider id, error and timestamps only.

#### No personal data beyond what is required

The outbox stores the destination address (needed to deliver) and the booking
reference/status (needed to render the event). It does **not** copy the customer
name, phone, WhatsApp number, pickup address, notes, photos, API keys, signed
URLs or provider credentials. The renderer must read any additional booking
detail from `public.bookings` by `booking_id` at send time.

---

### 4. Atomic and idempotent enqueueing

#### Database functions and triggers

| Object | Role |
| --- | --- |
| `private.enqueue_booking_email(uuid, public.email_template, integer, text, text, text) → boolean` | `SECURITY DEFINER`, `search_path = ''`. Validates template/status/reference, skips absent or invalid email, inserts with `ON CONFLICT DO NOTHING`, returns whether a row was inserted |
| `private.queue_booking_email() → trigger` | `SECURITY DEFINER`, `search_path = ''`. Maps the booking insert/status change to a template and calls the helper |
| `private.email_outbox_identity_immutable() → trigger` | Rejects identity rewrites |
| `private.touch_updated_at()` | Existing Sprint 2A trigger function reused |

Triggers on `public.bookings`:

1. `bookings_email_created` — `AFTER INSERT`, fires only for a valid committed
   booking. `booking_submit`'s replay path returns before `INSERT`, so a replay
   cannot fire it.
2. `bookings_email_status_changed` — `AFTER UPDATE OF status`, guarded by
   `WHEN (OLD.status IS DISTINCT FROM NEW.status)`.

Because these are `AFTER` triggers, they execute in the **same transaction** as
the booking statement. There is no application-side follow-up call and no
compensation logic. If the booking insert, status update, history write, audit
write or any later statement in the transaction fails, the trigger insert rolls
back with it.

#### Event mapping

| Business event | Status transition | Template | Key suffix |
| --- | --- | --- | --- |
| Booking created | `INSERT` (`pending`) | `booking_created` | `v1` |
| Administrator confirms | `pending → confirmed` | `booking_confirmed` | `v<new version>` |
| Laundry processing begins | `picked_up → processing` | `booking_processing_started` | `v<new version>` |
| Booking ready | `processing → ready` | `booking_ready` | `v<new version>` |
| Booking completed | `ready/out_for_delivery → completed` | `booking_completed` | `v<new version>` |
| Booking cancelled | any allowed → `cancelled` | `booking_cancelled` | `v<new version>` |

`scheduled`, `picked_up` and `out_for_delivery` deliberately do **not** produce
customer email in this foundation. No new statuses were added.

#### Optional email

`private.enqueue_booking_email` lowercases and trims the address, then returns
`false` without inserting for a blank, over-length or malformed address. The
booking still commits normally. No delivery-failure row is written, because no
message was ever queued.

#### Why the guard survives concurrency

The database, not TypeScript, is authoritative:

- the unique `idempotency_key` rejects a duplicate event;
- `UNIQUE (booking_id, template, booking_version)` rejects the same event under a
  different textual key;
- `ON CONFLICT DO NOTHING` makes a concurrent/retried enqueue a no-op rather than
  an error;
- `booking_transition` already serialises with `SELECT … FOR UPDATE` and an
  optimistic version check, so two administrators cannot commit the same
  transition.

No claim function or worker is added in this sprint, so there is no concurrent
claim to test yet. The lease columns and shape constraints are ready for it.

---

### 5. Security and privilege verification

- `ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY`.
- **No policies** exist for `anon` or `authenticated` — deny by default for
  select, insert, update and delete.
- `REVOKE ALL … FROM PUBLIC, anon, authenticated`.
- `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role` for the future worker.
  The service-role key is server-only and is never sent to a browser.
- The three new functions are `SECURITY DEFINER` (where needed) with
  `SET search_path = ''` and fully schema-qualified references. `EXECUTE` is
  revoked from `PUBLIC`, `anon` and `authenticated`; the trigger fires under the
  table owner and the helper is not callable from a client.
- A browser cannot choose a recipient, template, payload or delivery state: it
  has no table grant, no policy and no function execution right. The trigger
  reads the recipient from `NEW.customer_email` on the booking row.
- The public booking API response is unchanged and does not include any outbox or
  customer-email data.
- Existing `bookings` RLS, grants and the `service_role`-only booking RPCs were
  not modified.

Verified by executable tests against PGlite:

- RLS enabled, zero policies, all eight client privileges false,
  `service_role` select/insert true.
- `SET ROLE anon` / `SET ROLE authenticated` cannot select, insert, update or
  delete, and cannot execute the outbox helpers.
- Existing booking RLS remains enabled; `anon` cannot select bookings;
  `authenticated` cannot insert/update/delete bookings; booking functions remain
  non-executable by client roles.

---

### 6. Privacy-notice version handling

#### What already existed

- `public.bookings.notice_version text` (Sprint 2A).
- `public.booking_submit` accepted `p_payload->>'notice_version'` and persisted
  it (left-trimmed to 60 chars).
- The type/validator forwarded a browser `noticeVersion`.

#### What was wrong

The value was client-controlled, and `src/components/forms/booking.tsx` never
sent one. Every production booking therefore stored an empty string, and a
crafted request could claim any notice version.

#### Smallest safe change made

- `src/lib/bookings/notice.ts` reads `BOOKING_PRIVACY_NOTICE_VERSION` from the
  server environment, validates it (1–60 chars; letters, digits, dot,
  underscore, hyphen) and returns `null` when unset or invalid.
- `toBookingSubmitPayload` now requires the server value; the normalised request
  no longer contains a notice-version field. Any `noticeVersion` in request JSON
  is ignored.
- The route passes the server value to the submission orchestrator.
- The existing database column and `booking_submit` contract are reused; no
  second column or fabricated wording was added.
- Transactional email is not treated as marketing consent and no newsletter
  subscription is created anywhere.

#### Exact blocker

**No approved privacy-notice version identifier exists in the repository.**

`src/data/content.json` §18 contains the client-approved policy body (Privacy
Policy preamble, Information Collected, Use of Data, Data Retention), but neither
that content nor the SRS/PRD supplies a version string, revision label or
effective date. The SRS requires a *server-approved* notice version
(`docs/source/2ND_WAVE_SRS.md:90`), and the architecture investigation already
records this as missing (`ADMIN_OPERATIONS_EMAIL_ARCHITECTURE.md:782`).

Consequences until the owner supplies one:

- `BOOKING_PRIVACY_NOTICE_VERSION` remains unset;
- bookings continue to record an empty `notice_version` (same as before this
  sprint, but no longer browser-controlled);
- this sprint does **not** claim that notice-version capture is complete;
- when an approved version is supplied, set the variable for the server
  deployment only, redeploy, and future submissions will persist it.

Do not set an arbitrary value merely to make the column non-empty.

---

### 7. Retention — what Sprint 2F must cover

No cleanup function, scheduled job, trigger deletion or retention policy claim is
added in this sprint.

Current compatibility:

- `email_outbox.booking_id` uses `ON DELETE CASCADE`, so the eventual booking
  retention deletion removes its outbox rows and their recipient addresses.
- `created_at` is indexed for age-based selection.
- `sent` and `dead` rows are retained indefinitely until 2F defines policy; no
  claim of enforcement is made.

Sprint 2F must decide and implement:

1. How long `sent` rows (including `recipient_email`) are kept after delivery —
   enough for operational support, not indefinite.
2. How long `dead`/`retryable_failed` rows and `last_error` are kept, and who may
   review them.
3. Whether outbox rows for deleted bookings are removed solely by cascade or also
   by an explicit deadline, and how that interacts with booking expiry
   (12 months).
4. Whether a provider webhook/delivery-event table (2D.2) shares the same period.
5. The `retention_jobs` log entries for the outbox cleanup and a tested,
   reviewable deletion mechanism.

---

### 8. Migration and deployment safety

#### What the migration changes

Only additive objects:

- two new enum types;
- one new table with indexes, checks and uniqueness;
- one immutability trigger and one `updated_at` trigger on the new table;
- one private helper and one private trigger function;
- two `AFTER` triggers on `public.bookings`;
- RLS enablement and grants on the new table.

It does **not** alter `public.bookings` columns, constraints, RLS, grants,
existing functions or existing status values. It does not modify
`booking_status_history` or `audit_events`, and it creates no duplicate audit
table.

#### Hosted steps still required (not performed)

1. Review `supabase/migrations/20261019120000_email_outbox.sql` and confirm the
   hosted project does not already have that migration version.
2. With explicit owner approval, apply it through the Supabase SQL editor or the
   approved CLI flow (for example `supabase db push` with the correct project).
   **Do not run `supabase db reset` against the hosted project.**
3. Run the verification queries at the end of the migration:
   - `rls_enabled = true`, `policies = 0`;
   - `anon`/`authenticated` privileges all false;
   - `service_role` select/insert true;
   - both booking triggers present and enabled;
   - function execute false for client roles.
4. Optionally run `supabase/tests/sprint_2d1_email_outbox.sql` against a
   **disposable local/branch** database only. It was executed here through a
   one-off PGlite runner with every migration applied and passed; it has not been
   executed against a full Supabase instance.
5. Do not set `BOOKING_PRIVACY_NOTICE_VERSION` until an approved version exists.
6. No sender identity, Brevo key, worker schedule or email sending is configured
   by this migration.

No emails are sent by any part of this change.

---

### 9. Automated test results

#### Commands run

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with 0 errors (5 pre-existing warnings in unrelated files) |
| `npm test` | **205 passed, 0 failed** |
| `npm run build` | Passed |
| `supabase/tests/sprint_2d1_email_outbox.sql` | Passed (executed by the integration suite with all migrations applied; transaction rolled back) |

#### New test coverage

**`tests/email-outbox-db.test.ts` — 16 tests (PGlite, focused harness)**

- one creation row with a valid email, with a minimal two-key payload;
- no row for absent, empty or invalid email;
- replay of the enqueue is a no-op;
- unique idempotency key and unique booking/event identity both reject duplicates;
- each supported lifecycle mapping; unsupported statuses enqueue nothing;
- idempotent creation replay cannot enqueue a second row;
- rolled-back status transaction and rolled-back booking insert leave no row;
- forged template/status pair rejected;
- arbitrary recipient, extra payload data and premature `dead` state rejected;
- lease/sent timestamp invariants enforced;
- recipient/template/payload rewrite rejected;
- RLS enabled, zero policies, client grants false;
- client roles cannot select/insert/update/delete or execute helpers.

**`tests/email-outbox-integration-db.test.ts` — 9 tests (every migration applied
in order, real booking functions, operator SQL script)**

- `booking_submit` commits exactly one creation notification;
- exact-key replay returns the same booking and queues nothing;
- booking without email queues nothing;
- `booking_transition` queues confirm/processing/ready/completed with the real
  lifecycle, including the required `picked_up` step;
- cancellation queues `booking_cancelled`;
- rejected transition leaves status, version and outbox unchanged;
- rolled-back arrangement + confirmation leaves no outbox row;
- `supabase/tests/sprint_2d1_email_outbox.sql` passes end to end;
- existing booking RLS and function privileges are preserved.

**`tests/email-outbox.test.ts` — 3 tests**

- no notice version invented when unset/blank;
- valid approved versions accepted after trimming;
- invalid/overlong values treated as unset.

#### 9.4 Pre-existing photo-upload test repair

`tests/photo-upload.test.ts` was failing in the committed baseline (5 failures)
and is unchanged by the outbox work. The defects were entirely in the test:
a one-byte fixture that could never satisfy JPEG magic-number sniffing, a
lowercase lookup in a plain header object (`Retry-After`), success responses
asserted to carry an error code, and "store failure" tests that never made the
store fail. The assertions now match the existing, unchanged
`src/lib/bookings/photo-upload.ts` contract. No production photo code was
changed.

#### Limits of the verification

- PGlite is a real PostgreSQL engine, but it is **not** the Supabase stack:
  `auth.users`, `auth.uid()` and `storage.buckets` are minimal stubs, and hosted
  `service_role` settings are not reproduced. The migration compiles and behaves
  correctly under PostgreSQL semantics; hosted migration history is still
  unverified.
- The operator script `supabase/tests/sprint_2d1_email_outbox.sql` executed
  successfully against PGlite with every migration applied. It has not been run
  against a full Supabase instance or the hosted project.
- No test sends email or contacts Brevo.
- No test proves the future worker's claim/retry logic, because that worker does
  not exist yet.

---

### 10. Deliberately not implemented

- Brevo API client, sender identity, environment secrets or webhooks.
- Outbox worker, claim function, backoff scheduler or dead-letter admin view.
- Any actual email delivery or delivery-failure UI.
- Destructive outbox/booking/photo retention cleanup.
- Newsletter subscription or marketing consent.
- New booking statuses or changes to the confirmation gate.
- Admin read policy for the outbox (the delivery-failure view must add its own
  narrowly scoped policy in the delivery sprint).

---

### 11. Remaining decisions / blockers

| # | Item | Status |
| --- | --- | --- |
| 1 | Approved privacy-notice version string/effective date | **BLOCKED** — not present in repository content or source docs |
| 2 | Whether `scheduled`, `picked_up`, `out_for_delivery` need customer email | Open product decision; not in the six required events |
| 3 | Which administrator role may view delivery failures | Deferred to the delivery sprint; likely Full Admin, following the `staff.manage` model |
| 4 | Outbox row retention periods (sent, dead, failures) | Deferred to Sprint 2F |
| 5 | Worker runtime (scheduled function vs. cron route) | Deferred to Sprint 2D.2 |
| 6 | Brevo sender/domain verification | External prerequisite for live sending |
| 7 | Whether transactional email requires refreshed privacy wording that explicitly mentions email updates | Owner/legal decision; current policy says data is used to “communicate updates regarding your laundry”, but the version is still unapproved |

---

### 12. Quick local verification

```bash
npm run typecheck
npm run lint
npm test        # includes both PGlite outbox suites
npm run build
```

To inspect the outbox manually in a disposable database after applying the
migration:

```sql
SELECT template, recipient_email, status, payload, attempt_count
FROM public.email_outbox
ORDER BY created_at DESC;
```

Never run the operator SQL script or create test bookings against the hosted
project.

---

## Sprint 2D.2 — Brevo Transactional Email Delivery

**Status:** implemented and verified locally. **No email has been sent. No Brevo
request has been made. No hosted migration has been applied.**

Transactional sending is **disabled by default** and remains disabled until an
operator configures and verifies each Brevo template sender, supplies server-only
credentials and all six actual saved-template IDs, applies the three email
migrations and explicitly sets
`TRANSACTIONAL_EMAILS_ENABLED=true`.
The endpoint and worker are implemented; a scheduler is **not** deployed by this
repository, so automatic retry after a restart or provider outage is not claimed.

---

### 1. What was inspected before implementation

| Area | Source of truth inspected |
| --- | --- |
| Sprint 2D.1 outbox | `supabase/migrations/20261019120000_email_outbox.sql`, the Sprint 2D.1 section of this consolidated report |
| Six event names and enqueue triggers | `email_outbox` template enum, `email_outbox_enqueue_*` triggers, `booking_transition` mapping |
| Idempotency keys | `idempotency_key = booking:<uuid>:<template>:v<version>`, unique `(booking_id, template, booking_version)` |
| Booking lifecycle and confirmation gate | `20261011130200_booking_functions.sql`, `src/lib/bookings/lifecycle.ts` |
| Public post-commit path | `src/app/api/bookings/route.ts`, `src/lib/bookings/submission.ts` |
| Admin post-commit path | `src/lib/bookings/admin-actions.ts` |
| Server-only elevated client | `src/lib/supabase/admin.ts` |
| Hosting configuration | `next.config.ts`, `package.json`, repository root. There is **no** `vercel.json`, cron definition or GitHub Actions workflow. |
| Product/hosting intent | `docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md` — Vercel for development/testing, Cloudflare for production after validation |

Confirmed before editing:

- Sprint 2D.1 already creates **one** outbox row atomically for creation and for
  each of the six approved events. No competing queue or second notification
  system was added.
- `booking_update_arrangement` does not change status and produces no email.
  Confirmation is a separate `booking_transition`, which is where
  `booking_confirmed` is enqueued.
- `scheduled`, `picked_up` and `out_for_delivery` deliberately have no customer
  email. This sprint did not add any.
- The outbox row exists only after the booking transaction commits. Provider
  calls therefore happen outside that transaction.
- The repository previously had no scheduler, so post-commit delivery had to be
  combined with a protected, idempotent drain endpoint rather than assuming cron.

---

### 2. Files created or changed

#### Created

| File | Purpose |
| --- | --- |
| `supabase/migrations/20261019130000_email_delivery.sql` | Forward-only claim/reap/completion functions, delivery-event table, dead-letter constraint relaxation, RLS and grants |
| `src/lib/email/config.ts` | Server-only configuration validation; disabled-by-default; site URL and secret checks |
| `src/lib/email/templates.ts` | Typed Brevo saved-template parameter contract and persisted-data formatting |
| `src/lib/email/brevo.ts` | Brevo `POST /v3/smtp/email` saved-template client (`templateId` + `params`), timeout, error classification and idempotency field |
| `src/lib/email/outbox-repository.ts` | Scoped Supabase RPC calls and minimal booking-context read |
| `src/lib/email/worker.ts` | Testable claim → build template params → send → mark orchestration, backoff and dead-letter policy |
| `src/lib/email/dispatch.ts` | Best-effort post-commit drain that never throws into booking paths |
| `src/lib/email/webhook.ts` | Bearer verification, payload validation, event normalisation, dedupe and minimisation |
| `src/lib/email/webhook-repository.ts` | Minimal delivery-event persistence and outbox lookup |
| `src/app/api/internal/email/worker/route.ts` | Protected manual/scheduled worker endpoint |
| `src/app/api/webhooks/brevo/route.ts` | Authenticated Brevo transactional webhook endpoint |
| `tests/email-delivery.test.ts` | 30 unit tests for config, templates, Brevo client and worker |
| `tests/email-delivery-db.test.ts` | 12 PGlite tests for claim, retry, reap, dead-letter, events and privileges |
| `tests/email-webhook.test.ts` | 16 webhook authentication, minimisation and replay tests |
| `SPRINT_2D_EMAIL_IMPLEMENTATION.md` | Consolidated Sprint 2D implementation report |

#### Changed

| File | Change |
| --- | --- |
| `src/app/api/bookings/route.ts` | On a successful submission, schedule `dispatchPendingEmails` through Next.js `after()` after the response |
| `src/lib/bookings/admin-actions.ts` | After a committed status transition, schedule the same post-commit drain |
| `.env.example` | Documents the server-only variables and safe placeholders; no real credentials |
| `supabase/README.md` | Adds migration 14, the delivery tests and the updated security notes |

No booking lifecycle rule, confirmation gate, public API response shape,
existing migration or staff-alert recipient list was changed.

---

### 3. Architecture

```
booking_submit / booking_transition
        │  (single transaction: booking + history + audit + outbox)
        ▼
public.email_outbox  (Sprint 2D.1, one row per approved event)
        │
        │  post-commit after()  ──────────────┐
        ▼                                    │
POST /api/internal/email/worker              │  manual or scheduled drain
  bearer EMAIL_WORKER_SECRET                 │
  reaper → claim batch (SKIP LOCKED)         │
        │                                    │
        ▼                                    ▼
runEmailWorker
  load minimal booking context
  map outbox event to configured saved template ID
  build typed `params` from persisted booking values
  POST api.brevo.com/v3/smtp/email with `templateId` + `params`
  mark sent / retry / dead
        │
        ▼
public.email_delivery_events  ← authenticated Brevo webhook
```

The worker is the only component that talks to Brevo. The booking path never
imports the Brevo client directly; it calls `dispatchPendingEmails`, which catches
every failure and returns. The post-response drain uses a small batch (3) so it
fits a serverless function's lifetime; the protected endpoint defaults to 10 and
caps at 25. Rows that are cut off remain leased and are recovered by the reaper.

---

### 4. Event and template mapping

| Event / template | Enqueued by | Subject intent | Persisted values rendered |
| --- | --- | --- | --- |
| `booking_created` | `booking_submit` insert trigger | Request received, pending confirmation | Reference, requested date/time |
| `booking_confirmed` | `booking_transition → confirmed` after the confirmation gate | Booking confirmed | Reference, assigned branch, agreed pickup, agreed fee |
| `booking_processing_started` | `booking_transition picked_up → processing` | Processing started | Reference, branch |
| `booking_ready` | `booking_transition processing → ready` | Laundry ready | Reference, branch |
| `booking_completed` | `booking_transition → completed` where the existing lifecycle permits it | Booking complete | Reference |
| `booking_cancelled` | `booking_transition → cancelled` | Booking cancelled | Reference only; no reason or internal note |

The worker sends Brevo's saved-template `templateId` plus the per-event `params`
object. It does not send `subject`, `htmlContent`, or `textContent`; Brevo's API
documentation says saved templates supply their own subject/body and ignores
inline content fields when `templateId` is set. Therefore the saved account
templates must provide their own accessible responsive HTML, a plain-text
alternative where supported/configured in the Brevo editor, a clear booking
reference, and essential text that remains understandable when images are
blocked. The exact rendered body and saved-template subject cannot be inspected
or verified from this repository; they require account-owner review in Brevo.

The application parameter contract is centralised in
`src/lib/email/templates.ts` and follows Brevo New Template Language naming:

| Parameter | Value / availability |
| --- | --- |
| `customerName` | Persisted customer name |
| `bookingReference` | Persisted public booking reference; always provided |
| `bookingStatus` | Event-derived status (`Pending confirmation`, `Confirmed`, `Processing`, `Ready`, `Completed`, or `Cancelled`) |
| `serviceSummary` | Immutable persisted service-title snapshot, omitted when absent |
| `requestedPickup` | Requested date/time, explicitly not represented as agreed; omitted when absent |
| `agreedPickup` | Confirmed, persisted pickup appointment; confirmation event only and omitted if absent |
| `branchName` | Persisted assigned branch title; confirmation, processing and ready events only |
| `confirmedFee` | Persisted agreed fee/currency; confirmation event only and omitted when absent |
| `websiteUrl`, `contactUrl`, `privacyUrl` | Validated `SITE_URL` origin and public paths |
| `headerImageUrl`, `headerImageAlt` | Absolute HTTPS asset URL (HTTPS in deployed configuration) and descriptive alt text |

Event-to-ID mapping is fixed and typed:

| Existing outbox event | Required environment variable |
| --- | --- |
| `booking_created` (Booking received) | `BREVO_TEMPLATE_BOOKING_RECEIVED_ID` |
| `booking_confirmed` | `BREVO_TEMPLATE_BOOKING_CONFIRMED_ID` |
| `booking_processing_started` | `BREVO_TEMPLATE_PROCESSING_STARTED_ID` |
| `booking_ready` (Laundry ready) | `BREVO_TEMPLATE_LAUNDRY_READY_ID` |
| `booking_completed` | `BREVO_TEMPLATE_BOOKING_COMPLETED_ID` |
| `booking_cancelled` | `BREVO_TEMPLATE_BOOKING_CANCELLED_ID` |

All six IDs are required, numeric positive safe integers, and distinct. The
values are not guessed or hardcoded. Each must come from the actual Brevo
account. A missing, invalid, or duplicated ID fails configuration before rows
are claimed; the queue remains recoverable, and a sanitised error identifies
the required variable without exposing its value.

Header-image mapping uses the four customer-facing assets requested for Sprint
2D: `booking_created` → `/headers/general-booking.png`,
`booking_confirmed` → `/headers/booking-confirmed.png`,
`booking_processing_started` → `/headers/processing-started.png`, and
`booking_ready` → `/headers/laundry-ready.png`. Completed and cancelled use the
general booking header. `SITE_URL` supplies the absolute origin. The deployed
HTTPS reachability and actual Brevo previews remain owner verification steps.

No template invents a branch, pickup appointment, fee, service or delivery
promise. Cancellation reason and internal notes are deliberately not sent. The
saved booking-received body must explicitly say the request was received and is
pending confirmation; it must not describe it as confirmed. The confirmation
template is only submitted for the existing committed `booking_confirmed` event.

#### Why the ready message says “collection or delivery”

The persisted booking does not contain an authoritative return method (the
`transport_preference` field describes the outbound transport: cab, motorbike or
courier, not the return arrangement). The ready template therefore says the
laundry is ready and asks the customer to contact the team about collection or
delivery. It does **not** claim that delivery has been booked. Using
`return_details` would expose free-text operational notes, so it is deliberately
not loaded.

#### Minimum booking context read by the worker

`reference`, `customer_name`, immutable `booking_services.service_title`
snapshots, `requested_date`, `requested_time`,
`agreed_pickup_at`, `agreed_fee`, `agreed_fee_currency`, `assigned_branch_id` and
the assigned branch's `title`. Customer phone, pickup address, notes,
cancellation reason and private commentary are never read by the delivery layer.

---

### 5. Delivery semantics and idempotency

#### 5.1 Exactly-once **enqueue** is guaranteed by PostgreSQL

`idempotency_key` is unique, and `(booking_id, template, booking_version)` is a
second unique constraint. The enqueue triggers use the committed booking version
and `ON CONFLICT DO NOTHING`. A replayed submission returns before the insert; a
replayed transition cannot produce a second row. This is the part that can be
stated absolutely: **one committed booking event produces at most one outbox
row.**

#### 5.2 Delivery is at-least-once, not mathematically exactly-once

The worker claims a row, increments `attempt_count`, calls Brevo, and then marks
the result. If the HTTP response is lost after Brevo accepted the request, the
provider state is ambiguous. The worker cannot know whether the message was
accepted, so it retries.

Brevo supports idempotency for this endpoint. Current official documentation
states:

- the field is `idempotencyKey` (camelCase) inside the JSON body's `headers`
  object;
- it must be a UUID;
- the TTL is **30 minutes**;
- a duplicate within the TTL returns HTTP 400 with `duplicate_parameter` and is
  not processed.

This implementation sends the outbox row UUID as `headers.idempotencyKey`.
Brevo's own API reference example still shows `IdempotencyKey` (Title Case) in
the same object. That spelling is treated as an outgoing MIME header by Brevo and
does **not** enable idempotency; the client and tests use the documented
camelCase field. A duplicate `duplicate_parameter` / `duplicate_request` response
is treated as “already accepted” and the row is marked sent with no provider id.

Consequences:

- A retry within 30 minutes of the original attempt cannot create a duplicate.
- A retry after the TTL can create a duplicate. The default five-attempt schedule
  finishes within roughly 17 minutes, so normal retries stay inside the window.
  A provider `Retry-After` longer than the window, or manual replay of an old
  dead-letter row, is outside it.
- Brevo's logs remain the authority for what was accepted. The outbox records
  only our best knowledge.

#### 5.3 Claim, lease and recovery

`public.email_outbox_claim(worker_id, limit, lease_seconds)`:

- selects only `pending` / `retryable_failed` rows whose `next_attempt_at` is due
  and whose attempt budget is not exhausted;
- uses `FOR UPDATE SKIP LOCKED`, so concurrent workers receive disjoint batches;
- sets `sending`, increments `attempt_count`, and records a worker id plus a
  bounded lease (30–900 seconds; the worker default is 300 seconds, comfortably
  longer than a 10-row batch of 10-second provider timeouts).

`public.email_outbox_reap(limit)` returns expired `sending` rows to
`retryable_failed` (or `dead` at the attempt limit) and clears the lease. A stale
worker cannot mark a row it no longer owns: every completion function requires
`status = 'sending' AND locked_by = worker_id`.

If a repository read fails while processing, the row is left leased and the
reaper recovers it. This avoids dead-lettering on a transient database error.

#### 5.4 Retry schedule

Retryable failures are scheduled with bounded exponential backoff plus jitter:

| After attempt | Base delay | With 0–29 s jitter |
| --- | --- | --- |
| 1 | 60 s | 60–89 s |
| 2 | 120 s | 120–149 s |
| 3 | 240 s | 240–269 s |
| 4 | 480 s | 480–509 s |
| 5 | capped at 900 s; row is dead instead | — |

`next_attempt_at` is authoritative; the database also dead-letters a row when
`attempt_count >= max_attempts`. A provider `Retry-After` is honoured up to the
database delay ceiling, so the schedule can be longer than the table above.

#### 5.5 Permanent versus retryable failures

| Provider outcome | Classification | Action |
| --- | --- | --- |
| 201 with `messageId` / `messageIds` | success | `mark_sent` with provider id |
| 400 `duplicate_parameter` / `duplicate_request` | accepted previously | `mark_sent`, duplicate flag, no provider id |
| 429, 408, 425, 5xx, network error, timeout | retryable | `mark_retry` with backoff |
| other 4xx (401, 403, 422, invalid template sender/key, …) | permanent | `mark_dead` immediately |
| invalid outbox UUID | permanent | `mark_dead` before any network call |
| render failure | permanent | `mark_dead` before any network call |
| booking missing | permanent | `mark_dead` |
| repository failure | unknown | leave leased; reaper recovers |

A dead row is visible as `status = 'dead'` with a sanitised `last_error`. It is
never retried automatically and never marks the booking as failed.

#### 5.6 No provider call inside a booking transaction

The enqueue triggers write only the outbox row. `after()` runs after the response
has been produced. The worker is a separate request path. An outage, timeout,
invalid key or invalid template sender can therefore delay or dead-letter an email, but
cannot roll back or block booking creation, confirmation or a status change.

---

### 6. Security

- All provider and worker modules are server-only; no key or secret is read from
  a `NEXT_PUBLIC_*` variable.
- The worker endpoint requires `Authorization: Bearer <EMAIL_WORKER_SECRET>`.
  Comparison is constant-time. The secret must be at least 32 characters with no
  whitespace.
- Only `POST` and `GET` are routed; other methods return 405. The endpoint accepts
  no recipient, template, booking id or message content from the caller. It
  performs a fixed, bounded batch (default 10, hard maximum 25).
- The webhook endpoint requires the bearer token configured on the Brevo webhook,
  accepts only JSON, caps the body at 16 KiB (byte length), and rejects malformed
  or non-object payloads before touching the database.
- The webhook stores no recipient address, subject, HTML/text body, sending IP,
  user agent, tags, links or raw payload. Only outbox id, normalised event, a
  SHA-256 replay digest, a bounded single-line reason (not for `delivered`) and
  the event time are stored.
- `public.email_delivery_events` has RLS enabled with **no policies**. `anon` and
  `authenticated` have no table privilege and no execute privilege on the worker
  functions. Only `service_role` has the narrow grants.
- The worker functions are `SECURITY DEFINER`, pin `search_path = ''`, fully
  qualify identifiers, and are revoked from `PUBLIC`, `anon` and `authenticated`.
- Logs contain counts, stable codes, outbox ids and template names only. They do
  not contain a recipient address, booking reference, message body, API key or
  provider response body.

---

### 7. Brevo webhook

Brevo authenticated webhooks are configured with a bearer token (or custom
headers). Brevo does **not** provide an HMAC signature for this transactional
webhook, so the bearer token is the authentication mechanism. IP allowlisting can
be added as an extra control but is not required by the handler.

#### Endpoint

`POST https://<SITE_URL>/api/webhooks/brevo`

#### Brevo configuration

1. Brevo → Transactional → Settings → Webhooks → Create a webhook.
2. URL: the endpoint above.
3. Type: **Transactional**.
4. Events: `delivered`, `deferred`, `soft_bounce`, `hard_bounce`, `blocked`,
   `invalid_email`, `error`, `spam`.
5. Authentication: bearer token. Set the token to the same random value as
   `BREVO_WEBHOOK_SECRET` (at least 32 characters).

`opened`, `clicked` and other non-delivery events are acknowledged with HTTP 200
but are not persisted.

#### Handling and replay

- Missing/invalid bearer → 401.
- Wrong method → 405.
- Non-JSON or malformed JSON → 415 / 400.
- Body over 16 KiB → 413.
- Unknown message id or correlation header → 200 `{ ignored: true }`; this avoids
  leaking whether a message exists and stops Brevo retrying forever.
- Valid event → 200 `{ ok: true, duplicate: false }`.
- Exact replay → 200 `{ ok: true, duplicate: true }`; the unique `dedupe_key`
  makes the insert a no-op.
- Database outage → 503 so Brevo retries.

The custom header `X-Mailin-custom: 2ndwave-outbox:<uuid>` is sent at send time.
Brevo includes it in the webhook payload. It lets a delivery event resolve even
when it arrives before `mark_sent` stored the provider message id.

---

### 8. Environment variables

All are server-only. Never use a `NEXT_PUBLIC_*` name.

| Variable | Required when | Validation / meaning |
| --- | --- | --- |
| `TRANSACTIONAL_EMAILS_ENABLED` | always | `true` enables; unset/anything else disables |
| `BREVO_API_KEY` | enabled | 20–512 characters, no whitespace; Brevo `xkeysib-…` key |
| `BREVO_TEMPLATE_BOOKING_RECEIVED_ID` | enabled | Positive numeric ID of the Booking received template in this Brevo account |
| `BREVO_TEMPLATE_BOOKING_CONFIRMED_ID` | enabled | Positive numeric ID of the Booking confirmed template in this Brevo account |
| `BREVO_TEMPLATE_PROCESSING_STARTED_ID` | enabled | Positive numeric ID of the Processing started template in this Brevo account |
| `BREVO_TEMPLATE_LAUNDRY_READY_ID` | enabled | Positive numeric ID of the Laundry ready template in this Brevo account |
| `BREVO_TEMPLATE_BOOKING_COMPLETED_ID` | enabled | Positive numeric ID of the Booking completed template in this Brevo account |
| `BREVO_TEMPLATE_BOOKING_CANCELLED_ID` | enabled | Positive numeric ID of the Booking cancelled template in this Brevo account |
| `SITE_URL` | enabled | public `https://` origin, no path/query/credentials; loopback `http://` allowed only for local tests |
| `EMAIL_WORKER_SECRET` | enabled | ≥32 characters, no whitespace; bearer secret for the worker |
| `BREVO_WEBHOOK_SECRET` | webhooks | ≥32 characters, no whitespace; bearer token on the Brevo webhook |
| `BOOKING_PRIVACY_NOTICE_VERSION` | optional | server-authoritative notice version; still unset because no approved value exists |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | enabled | existing elevated server client; never browser-exposed |

`.env.example` contains blank placeholders only. Template IDs are never guessed
or hardcoded. The REST endpoint uses a Brevo API key (`BREVO_API_KEY`), not an
SMTP key. No credential is committed.

Each template's sender and Reply-To must be configured in Brevo. The application
does not override either header in the API request. If the key or other required
configuration is invalid, the worker fails closed and returns
`not_configured`; it does not send a test email to a real customer.

Receiving replies still depends on creating the mailbox or forwarding rule at
the mail provider and routing the custom domain's MX records there. Brevo's
outgoing message headers do not create an inbox or receive mail.

The Full Admin console also has a **Compose Email** page at
`/admin/email-compose`. It requests the account's active senders from Brevo's
`GET /v3/senders` endpoint and lets the administrator choose one for a single
recipient message. Sender identities are not hardcoded in the app; add and
verify them in Brevo to make them available in the dropdown. Manual sends use
the selected Brevo sender ID and require `TRANSACTIONAL_EMAILS_ENABLED=true`
plus `BREVO_API_KEY`, but do not require the six booking template IDs.
The composer includes rich-text formatting and links; message HTML is
server-sanitized to allow safe text formatting and `http`, `https` or `mailto`
links only. Sender choices display the sender name and address separately.

---

### 9. Hosting and scheduler prerequisites

#### What is deployed by this repository

- The post-commit `after()` drain runs in the same deployment as the booking and
  admin actions. It provides timely attempts in normal operation.
- The protected worker endpoint exists for a scheduler or an operator.
- **No scheduler is configured.** There is no `vercel.json`, no cron entry and no
  GitHub Actions workflow. Automatic retry after a restart or provider outage is
  therefore **not** claimed.

#### Vercel

Vercel Hobby cron jobs are limited to **once per day**; a five-minute schedule
requires the Pro plan (a paid dependency). Without approval for that plan, do not
add a cron entry.

If Pro is approved, add:

```json
{
  "crons": [
    {
      "path": "/api/internal/email/worker",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Set both `EMAIL_WORKER_SECRET` and `CRON_SECRET` to the same random value. Vercel
sends `Authorization: Bearer <CRON_SECRET>`, and the endpoint compares it with
`EMAIL_WORKER_SECRET`. Confirm the cron invocation in Vercel logs and check the
returned JSON counts.

A daily Hobby cron can be used only as a coarse sweep; it is not timely recovery
for a customer email.

#### Cloudflare (planned production target)

Use a Cron Trigger / scheduled Worker that POSTs to the same endpoint with
`Authorization: Bearer <EMAIL_WORKER_SECRET>`. Confirm Next.js route-handler
compatibility with the chosen Cloudflare product before cutover. This is not
configured here.

#### Other schedulers

Any scheduler that can send an authenticated `POST` (for example an external cron
service or Supabase `pg_cron` + `pg_net`) works, but each adds an external
dependency or secret-storage requirement. None was added without approval.

#### Manual drain

```bash
curl -fsS -X POST "https://<your-origin>/api/internal/email/worker" \
  -H "Authorization: Bearer $EMAIL_WORKER_SECRET"
```

The response contains counts only: `reaped`, `claimed`, `sent`, `retried`, `dead`,
`skipped`, `failed`, `durationMs`.

---

### 10. Database migration

`supabase/migrations/20261019130000_email_delivery.sql` is forward-only and
requires `20261019120000_email_outbox.sql`.

It adds:

- `public.email_delivery_event` enum: `delivered`, `deferred`, `bounced`,
  `complained`;
- `public.email_delivery_events` with a unique SHA-256 `dedupe_key`, bounded
  single-line reason, event time, append-only trigger and cascade delete from the
  outbox;
- `email_outbox_claim`, `email_outbox_reap`, `email_outbox_mark_sent`,
  `email_outbox_mark_retry`, `email_outbox_mark_dead`;
- RLS and grants for the event table; no client policies;
- a relaxation of the dead-letter CHECK so a permanent rejection can terminate
  after one real attempt (`attempt_count >= 1`).

#### Bug found and fixed during verification

The first version of the claim/reap functions assigned a `CASE` expression
returning `text` to `email_delivery_status`. PostgreSQL rejected it with
`42804: column "status" is of type public.email_delivery_status but expression is
of type text`. The assignment is now explicitly cast to
`public.email_delivery_status`. The PGlite tests exercise both the retry and reap
paths and pass.

No destructive retention job, no booking change and no hosted migration is part
of this file.

---

### 11. Verification

All commands were run on the repository after the final edits.

| Check | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run lint` | 0 errors; 5 pre-existing warnings (2 `<img>` in the booking form, 2 unused imports in `tests/photos.test.ts`, 1 graphify plugin warning) |
| `npm test` | **261 passed, 0 failed** |
| `npm run build` | passed; `/api/internal/email/worker` and `/api/webhooks/brevo` are dynamic routes |
| `tests/email-delivery.test.ts` | 28 passed |
| `tests/email-webhook.test.ts` | 16 passed |
| `tests/email-delivery-db.test.ts` | 12 passed against PGlite with every migration applied |

Coverage includes:

- successful provider acceptance with `messageId` / `messageIds`;
- disabled-by-default behaviour and missing/invalid key, site URL and
  secrets;
- provider rejection, timeout, 429 with `Retry-After`, 5xx and permanent 4xx;
- backoff bounds, jitter and dead-letter at the attempt limit;
- concurrent/duplicate claims (second claim returns no rows), abandoned lease
  recovery and exhausted-lease dead-lettering;
- duplicate enqueue/replay protection inherited from Sprint 2D.1;
- webhook bearer verification, method/content-type/size/malformed payload
  rejection, unknown-message acknowledgement, replay dedupe and minimal
  persistence;
- email failure isolation: worker/repository failures are returned as counts or
  safe errors and never throw into the booking path;
- The outbox and delivery tables/functions remain inaccessible to `anon` and
  `authenticated`.

PGlite is a real PostgreSQL engine (types, constraints, triggers, transactions,
RLS privilege checks), but it is not the full Supabase stack. Hosted migration
history, PostgREST RPC exposure and hosted `service_role` configuration remain
unverified until the migrations are applied with approval.

#### Actual Brevo requests

**None.** All tests use an injected fake `fetch`; no request reached
`api.brevo.com`. No API key, sender identity or webhook secret was configured or
used.

---

### 12. Controlled end-to-end activation (manual)

Do not send to a real customer address. Use a dedicated controlled test mailbox
that the owner authorises.

1. **Apply the migrations** to a disposable/local database first, then to the
   target hosted project **only with explicit approval**, in order:
   `20261019120000_email_outbox.sql`, then
   `20261019130000_email_delivery.sql`, then
   `20261019140000_email_monitoring.sql`. Run their verification queries and
   confirm the migration history.
2. **Configure/verify template senders.** In Brevo, authenticate the sending
   domain and ensure each saved template has its intended verified sender.
   Template sends use that configured sender; the application does not override it.
3. **Review the six existing saved Brevo templates** in the Brevo account. Confirm
   each uses the exact `params.*` names in the Sprint 2D.2 addendum below, has
   correct booking-state wording, accessible HTML and descriptive image alt text,
   and remains understandable with images blocked. Confirm the template editor's
   plain-text alternative is suitable where available. This repository cannot
   inspect or verify account-side template bodies.
4. **Copy the six actual numeric template IDs** from this Brevo account into the
   matching `BREVO_TEMPLATE_*_ID` variables. Confirm each ID points to the
   intended, distinct saved template. Never use IDs from another account.
5. **Set server-only environment variables** in the deployment: the API key
   `BREVO_API_KEY` (not an SMTP key), all six saved-template IDs, `SITE_URL`,
   `EMAIL_WORKER_SECRET`, and `BREVO_WEBHOOK_SECRET`. Keep
   `TRANSACTIONAL_EMAILS_ENABLED=false` until steps 6–8 are ready.
6. **Verify header URLs** from the deployed public HTTPS site. Open the four
   customer assets (`general-booking.png`, `booking-confirmed.png`,
   `processing-started.png`, and `laundry-ready.png`) and confirm Brevo preview
   displays the matching one on the corresponding template.
7. **Configure the Brevo webhook** as described in §7. Confirm Brevo can reach
   the endpoint and that a test event returns 200 without a visible error.
8. **Enable sending only after owner approval** by setting
   `TRANSACTIONAL_EMAILS_ENABLED=true` and
   redeploying/restarting.
9. **Submit one test booking** with the controlled address. Confirm:
   - the booking is committed and the public response is unchanged;
   - exactly one `booking_created` outbox row exists;
   - the worker marks it `sent` with a provider message id;
   - the test mailbox receives the pending-confirmation wording, not a
     confirmation.
10. **Confirm the test booking through the admin UI** (arrangement then
   `confirmed`). Confirm exactly one `booking_confirmed` row is created only
   after the transaction commits, and its email contains the persisted branch,
   pickup and fee.
11. **Advance the test booking** through `picked_up → processing → ready →
   completed` and, separately, cancel another test booking. Confirm only the
   approved templates are queued and that no email is queued for `scheduled`,
   `picked_up` or `out_for_delivery`.
12. **Drain manually** with the curl command in §9 to verify the protected worker
   and the retry path. Check `email_outbox.status`, `attempt_count`,
   `last_error`, `provider_message_id` and `email_delivery_events`.
13. **Confirm the webhook events** arrive in `email_delivery_events` for
    `delivered`, and that a replay does not add a second row. Check that no
    recipient address, subject or body is stored there.
14. **Record the result.** Only after a controlled live delivery succeeds may the
    feature be described as operational.

If any step fails, set `TRANSACTIONAL_EMAILS_ENABLED=false`; queued rows remain
pending and no booking is affected.

---

### 13. Limitations and open items

1. **Hosted migration not applied.** No hosted database change was made. The
   exact approval and order are in §12.
2. **No scheduler configured.** Post-commit attempts are timely in normal
   operation; automatic recovery after a restart or outage needs an approved
   scheduler. Vercel Pro cron is a paid dependency; Hobby cron is daily only.
3. **No live Brevo verification.** No API key, webhook or email exists in this
   environment. Template sender/domain verification is a Brevo-dashboard prerequisite.
4. **No approved privacy-notice version.** `BOOKING_PRIVACY_NOTICE_VERSION`
   remains unset; no value was invented. This is inherited from Sprint 2D.1.
5. **At-least-once delivery.** Brevo idempotency covers a 30-minute window. A
   timeout after acceptance is ambiguous, and a retry outside the window can
   duplicate. The outbox cannot provide mathematically guaranteed exactly-once
   delivery.
6. **No staff booking alerts.** Recipient management and staff notifications
   remain Sprint 2E.
7. **No marketing, newsletter, inbound email, composer or WhatsApp.** No customer
   is enrolled in a marketing list.
8. **PGlite is not Supabase.** Hosted PostgREST RPC signatures, `service_role`
   behaviour and migration history must be checked on the target project.
9. **Webhook authentication is a shared bearer token**, not an HMAC signature.
   Brevo does not provide a signature for this webhook type. Protect the token,
   rotate it if exposed, and optionally allowlist Brevo IP ranges.
10. **Saved Brevo template contents and tracking settings are account-managed.**
    They were not accessible for inspection from this repository. Review the
    template body, subject, plain-text alternative, image behavior, escaping and
    account tracking settings in Brevo before activation.

---

### 14. Official references checked

- Send a transactional email (endpoint, payload, response, error codes):  
  https://developers.brevo.com/reference/send-transac-email
- Saved templates use `templateId`; `params` only substitutes New Template
  Language variables, while inline `htmlContent`/`textContent` are ignored when
  a template is selected (same API reference above).
- Sending guide and transactional webhook payload fields:  
  https://developers.brevo.com/docs/send-a-transactional-email
- Idempotency (`idempotencyKey`, 30-minute TTL, `duplicate_parameter`):  
  https://developers.brevo.com/docs/heterogenous-versions-batch-emails
- Transactional webhook events and payload:  
  https://developers.brevo.com/docs/transactional-webhooks
- Webhook authentication (bearer token, username/password, custom headers, IP
  allowlisting):  
  https://developers.brevo.com/docs/secured-webhooks
- Vercel Cron plan limits and `CRON_SECRET` behaviour:  
  https://vercel.com/docs/cron-jobs/usage-and-pricing ,  
  https://vercel.com/docs/cron-jobs/manage-cron-jobs

---

### 15. Explicit non-goals preserved

- No change to booking lifecycle rules or the confirmation gate.
- No email for `confirmed → scheduled`, `scheduled → picked_up` or
  `ready → out_for_delivery`.
- No staff alert recipients or recipient-management UI.
- No marketing campaigns, newsletter sends, inbound email or general composer.
- No automated WhatsApp.
- No automatic marketing enrolment.
- No real customer address used in tests.
- No hosted database change without approval.
- No claim that email is operational before a controlled live delivery.

---

## Sprint 2D.3 — Email Delivery Monitoring and Acceptance

**Status:** implementation complete and verified locally.
**Not accepted for live operation.** No hosted migration, Brevo request, email
send, scheduled worker, or controlled live acceptance test has been performed.
The feature flag remains disabled by default.

### 1. Existing implementation reused

Sprint 2D.3 builds on the existing single outbox from
`20261019120000_email_outbox.sql` and the delivery functions/events from
`20261019130000_email_delivery.sql`.

- The six existing template identifiers are unchanged.
- Booking triggers, booking lifecycle, confirmation gate, idempotency keys and
  booking transactions are unchanged.
- Delivery status remains the existing `pending`, `sending`, `sent`,
  `retryable_failed`, and `dead` state machine.
- Brevo delivery events remain append-only in `email_delivery_events`.
- The monitoring view calls neither Brevo nor booking mutation functions.

### 2. Administrator monitoring

The Full Admin-only **Email Delivery** page at `/admin/email-delivery` displays
a bounded page of 20 notifications (maximum 50) with status and notification
type filters. Each row displays the booking reference, event type, recipient,
queue state, current attempt budget, last attempt time, provider
acceptance time, scheduled retry time, latest provider delivery event, and a
sanitised error explanation when present. No provider message ID or raw webhook
payload is displayed.

The booking detail page also shows that booking's notification timeline to
administrators with the `email.manage` permission. The timeline is omitted for
Operational Admins and for the isolated demo workspace. A missing customer
email is represented by no outbox notification, not a synthetic delivery error.

The server endpoint validates status/event filters, accepts only a UUID booking
filter, pages results, and returns `Cache-Control: private, no-store`. Reads use
the existing server-only elevated Supabase client only after the active
administrator and `email.manage` checks pass. The browser receives no database
credentials.

### 3. Truthful status and retry handling

- `pending` is shown as **Queued**.
- `sending` is shown as **Sending**.
- `sent` without a delivery event is shown as **Accepted by provider**, not
  delivered.
- An authenticated Brevo `delivered` event is shown as **Delivered**.
- `deferred`, `bounced`, and `complained` events are identified distinctly.
- `retryable_failed` is shown as **Retry scheduled**.
- `dead` is shown as **Terminal failure**.

A stale deferral event cannot overwrite a terminal provider outcome in the
display projection. Provider event rows remain immutable and replay-deduplicated
by the existing database constraints. No event rewrites the outbox to `sent` or
claims inbox delivery without provider evidence.

Full Admins may queue **one** manual retry for one dead row. This operation:

1. accepts only the outbox row ID; it cannot supply a recipient or message;
2. passes the normal verified-admin, `email.manage`, same-origin, and
   per-administrator rate-limit checks;
3. calls `email_outbox_manual_retry`, which rechecks that the actor is an active
   Full Admin, changes the existing row back to `pending`, increases its attempt
   budget by exactly one, and writes `email.manual_retry` to the existing audit
   log in the same database transaction;
4. triggers the existing bounded post-response worker path.

It never creates a new outbox event and cannot retry a sent row. The attempt
budget remains capped at 20; at that limit the UI disables retry and requires
operator investigation. There is no “resend all” action and no browser-accessible
outbox mutation.

### 4. Security and booking isolation

- `email.manage` remains Full Admin-only in the central permission registry.
- Both the admin page and API check that permission server-side. Operational
  Admins retain their existing booking permissions but receive neither the
  global email monitor nor notification recipient data.
- Manual retry validates the active Full Admin again in the database function
  and is audited without storing message content or recipient data.
- Outbox/event reads and retry writes remain server-side. Client credentials,
  API keys, signed URLs, email bodies and provider payloads are not returned by
  the monitoring API.
- The retry request is same-origin checked and rate limited.
- Demo mode still uses its isolated in-memory booking store and is not connected
  to the email monitor's authenticated APIs, outbox or retry action.
- No booking state, history, photo access, or lifecycle operation is changed by
  monitoring or email failure.

### 5. Files changed

#### Added

- `src/lib/email/monitoring.ts` — bounded query contracts, role check, and
  provider-event status projection.
- `src/lib/email/monitoring-repository.ts` — server-only, paginated service-role
  reads of existing outbox and delivery-event data.
- `src/app/api/admin/email-delivery/route.ts` — protected monitoring read API.
- `src/app/api/admin/email-delivery/[id]/retry/route.ts` — protected single-row
  manual retry endpoint.
- `src/components/admin/email-delivery.tsx` — global delivery view and compact
  booking-detail status panel.
- `supabase/migrations/20261019140000_email_monitoring.sql` — audited manual
  retry function and persisted attempt timestamp; no duplicate queue or booking
  event trigger.
- `tests/email-monitoring.test.ts` — permission, status truthfulness,
  out-of-order event, and query-bound tests.
- this consolidated report — this report.

#### Updated

- `src/lib/auth/permissions.ts` — Full Admin-only Email Delivery route.
- `src/components/shell.tsx`, `src/components/admin/admin-app.tsx` — navigation
  and page integration.
- `src/components/admin/bookings.tsx` — Full Admin-only detail status panel.
- `src/lib/security/rate-limit.ts` — bounded manual-retry rate limit.
- `supabase/README.md` — migration 15.
- `tests/email-delivery-db.test.ts`, `tests/permissions.test.ts` — manual retry
  audit/database guard and route role boundary coverage.

No earlier migration was edited and no hosted schema was changed.

### 6. Verification

The full `npm run check` quality gate completed successfully:

| Check | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run lint` | 0 errors, 5 warnings |
| `npm test` | 268 passed, 0 failed |
| `npm run build` | passed |

The five lint warnings are in unchanged files: one anonymous default export in
`.opencode/plugins/graphify.js`, two existing `<img>` usages in the booking
form, and two unused imports in `tests/photos.test.ts`. The Sprint 2D email
changes add no lint warnings. Local checks do not prove hosted Supabase/
PostgREST behavior.

Automated coverage also reuses the Sprint 2D.1/2D.2 tests for atomic creation
and transition enqueueing, email-less bookings, idempotent replay, failed and
rolled-back transitions, lease ownership/recovery, concurrency, retries,
backoff, webhook authentication/dedupe/minimisation, provider failures, and
booking failure isolation.

No automated test makes a Brevo request or sends a message to a customer.

### 7. External setup and current blockers

#### Database

The owner must review and approve migrations in order:

1. `20261019120000_email_outbox.sql`
2. `20261019130000_email_delivery.sql`
3. `20261019140000_email_monitoring.sql`

No hosted migration has been applied. Validate the new retry function, service
role grants, privileges, audit insertion and Supabase RPC exposure in a
disposable project before the target project. The admin monitor and retry
feature will return unavailable until all required migrations are applied.

#### Brevo and environment

Required server-only configuration remains:

- `BREVO_API_KEY`
- `BREVO_TEMPLATE_BOOKING_RECEIVED_ID`
- `BREVO_TEMPLATE_BOOKING_CONFIRMED_ID`
- `BREVO_TEMPLATE_PROCESSING_STARTED_ID`
- `BREVO_TEMPLATE_LAUNDRY_READY_ID`
- `BREVO_TEMPLATE_BOOKING_COMPLETED_ID`
- `BREVO_TEMPLATE_BOOKING_CANCELLED_ID`
- `TRANSACTIONAL_EMAILS_ENABLED`
- `SITE_URL`
- `EMAIL_WORKER_SECRET`
- `BREVO_WEBHOOK_SECRET`

Verify each template's sender/domain in Brevo first. Keep sending disabled until an owner
approves a controlled test. Never put credentials in `NEXT_PUBLIC_*` values.
The handler uses Brevo's configured bearer-token webhook protection; create the
webhook and configure the matching secret before expecting delivered/bounced
events. A provider acceptance is the only known delivery state until a
validated event arrives.

#### Scheduler and webhooks

The repository still does not configure or deploy a scheduled worker. Post-commit
dispatch is best-effort, and the protected worker endpoint can be invoked by an
operator or compatible external scheduler. Automatic recovery after a restart
is not operational until a scheduler is configured.

The Brevo webhook handler is implemented but not configured against a live
Brevo account. No live webhook authentication or delivery event has been
verified. Neither scheduled retries nor webhooks are claimed as configured.

### 8. Controlled manual acceptance checklist

Perform only in a disposable/staging environment after owner review. Create
clearly labelled new test bookings using a dedicated mailbox controlled by the
tester. Do not edit, cancel, or otherwise mutate an existing customer's booking.
Do not activate production sending as part of this checklist.

1. Apply and verify the three migrations in the disposable database.
2. Verify each template's Brevo sender identity. In the actual Brevo account,
   confirm that the six saved templates use the documented exact `params.*` contract,
   appropriate event-specific body/subject copy, mobile-friendly accessible
   HTML, image alt text, and readable essential copy with images blocked. Verify
   the plain-text alternative in the Brevo editor where available.
3. Copy the six distinct numeric template IDs from that account to the matching
   server-only variables. Verify the public HTTPS header assets are reachable
   and the correct image renders in each Brevo template preview.
4. Set the server-only configuration in disposable staging. Keep
   `TRANSACTIONAL_EMAILS_ENABLED=false` until the controlled mailbox and
   webhook are ready; then enable only in the disposable environment.
5. Create a new booking named **2D3 CONTROLLED EMAIL TEST** with the controlled
   mailbox. Verify one `booking_created` outbox row and receive the
   pending-confirmation message.
6. Confirm that booking using the normal administrator flow and valid persisted
   branch, pickup, and fee details. Verify one `booking_confirmed` row is
   created after commit and receive the confirmation message.
7. Advance this test booking through valid `picked_up → processing → ready →
   completed` transitions. Verify only the corresponding processing, ready and
   completed events are added. Verify no email for `scheduled`,
   `picked_up`, or `out_for_delivery`.
8. Create a second clearly labelled test booking and cancel it through the
   normal cancellation flow. Verify a neutral cancellation message with no
   internal reason.
9. Inspect the Full Admin Email Delivery page and booking detail panels. Verify
   provider acceptance is not called delivered until a valid webhook confirms
   it, and inspect event/error details without raw payload leakage.
10. In disposable staging only, cause a controlled provider rejection for a
   test row (for example, use a deliberately invalid test API key in staging
   after confirming the provider will reject it). Verify the booking remains
   unchanged, the delivery failure appears, and retry/backoff is safe. Restore
   the valid staging configuration before retrying the row.
11. Queue one manual retry from the Full Admin monitor. Verify the same outbox
   row/idempotency identity is reused, the audit event is recorded, and no
   second booking event is created. Verify Operational Admin and anonymous
   sessions cannot view or retry delivery.
12. Create a third labelled test booking without an email. Verify it commits
    successfully and creates no customer email row or failure.
13. Confirm search, detail, images, status transitions, status history and audit
    behaviour still work for the test booking. Do not use a real customer
    record as the test target.
14. Disable `TRANSACTIONAL_EMAILS_ENABLED` after acceptance until the owner
    separately approves ongoing use.
15. Record the references of all test bookings, their final statuses, and the
    cleanup/retention plan. Do not delete or cancel them without owner approval.

### 9. Acceptance conclusion

Sprint 2D.3 is implemented locally but **Sprint 2D is not fully accepted**.
Outstanding owner/external work is hosted migration approval/application,
verified Brevo sender and webhook setup, scheduler configuration, and the
controlled end-to-end test including provider-failure/retry behavior. No actual
Brevo request or live email has been made.
