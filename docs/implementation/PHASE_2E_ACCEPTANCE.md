# Phase 2E — Acceptance Report (Sprint 2E.3)

**Verdict:** the Phase 2E code path is verified end to end against the real
database functions. **Live Brevo configuration, rendering and delivery are still
unverified**, and no scheduler is deployed in this repository. Phase 2E is
therefore code-complete and locally verified, not production-accepted. One
critical defect in the administrator-alert path was found and fixed in this
sprint.

## 1. What was traced

For each order event the chain is:

1. `public.booking_submit` inserts a `pending` booking and its
   `booking_status_history` row (`actor_kind = 'customer'`).
2. `public.booking_transition` updates the status and inserts the history row
   (`actor_id`/`actor_kind = 'admin'`, reason) plus an `audit_events` row, in one
   transaction.
3. A **deferred** trigger on `public.bookings`
   (`bookings_staff_alert_created`, `bookings_staff_alert_status_changed`) fires
   at commit.
4. `private.queue_staff_order_alert` reads the committed history for the trusted
   actor and calls `private.enqueue_staff_order_alert`.
5. That helper re-reads the committed booking, rejects a template/status or
   version mismatch, verifies an admin actor against `public.admin_profiles`,
   reads `public.booking_alert_recipients` and inserts one outbox row per enabled
   address.
6. The Phase 2D worker claims, renders, sends one message per recipient to Brevo,
   and records acceptance; authenticated Brevo webhooks record delivery events.

### Defect found and fixed

`private.enqueue_staff_order_alert` selected the actor role with
`coalesce(ap.role, '')`. `admin_profiles.role` is the `public.admin_role` **enum**,
so PostgreSQL resolved the empty literal as an enum value and raised
`invalid input value for enum public.admin_role: ""` on **every administrator
alert**. The trigger's failure-isolation handler caught it and only emitted a
warning, so the order committed normally and the alert vanished silently. The
pending alert worked because its actor is the customer.

The focused database test did not catch it because its minimal
`admin_profiles` harness typed `role` as `text`. Fixed by
`coalesce(ap.role::text, '')` in
`supabase/migrations/20261022120100_staff_order_email_alerts.sql`, and the
harness now uses the real enum. Covered by the new full-schema integration test.

## 2. Event-to-template mapping

| Event | Authoritative source | Staff template | Verified |
| --- | --- | --- | --- |
| Order placed / pending | `bookings` INSERT with `status = 'pending'` | `staff_order_pending` | integration + DB |
| Processing | committed transition to `processing` | `staff_order_processing` | integration + DB |
| Ready | committed transition to `ready` | `staff_order_ready` | integration + DB |
| Completed | committed transition to `completed` | `staff_order_completed` | integration + DB |
| Cancelled | committed transition to `cancelled` | `staff_order_cancelled` | integration + DB |

`confirmed`, `scheduled`, `picked_up`, `out_for_delivery` and unchanged statuses
produce no staff alert. No new status values exist. The customer templates
(`booking_created`, `booking_confirmed`, `booking_processing_started`,
`booking_ready`, `booking_completed`, `booking_cancelled`) remain on their own
trigger with their unchanged two-key payload.

## 3. Central recipient setting

- **Interface:** `Order alert recipients` panel on the existing
  `/admin/settings` page (`src/components/admin/booking-alert-recipients.tsx`).
  View, add, rename in place, remove, success/error feedback, reload-to-persist.
- **Read endpoint:** `GET /api/admin/booking-alert-recipients`. The route has no
  write methods; `POST/PUT/PATCH/DELETE` return 405.
- **Writes:** Server Actions in `src/lib/email/recipient-actions.ts`.
- **Persistence:** `public.booking_alert_recipients` — unique normalised email,
  shape check, optimistic `version`, hard cap of 10 enabled rows, RLS enabled
  with **no** client policy and no `anon`/`authenticated` grants.
- **Authorisation:** `settings.manage`, granted to `full_admin` only. The route
  and every action re-resolve the verified session, the database profile role,
  the capability, the request origin and a per-actor rate limit. No action
  accepts an actor id or an address list; the browser never holds an elevated
  key. An Operational Admin is denied the page, the endpoint and the actions.
- **Engine link:** the database enqueue helper reads the table itself, so all
  five events resolve the same list, with no per-order configuration. Addresses
  are copied into the outbox at enqueue time: changes affect subsequent events,
  never queued or sent history.
- **Empty list:** zero rows are queued, the order still commits, and the panel
  shows an explicit configuration warning.

## 4. Actor attribution and auditability

| Event | Actor kind | Name / role source |
| --- | --- | --- |
| Order placed | `customer` | persisted `bookings.customer_name` |
| Admin transition | `admin` | `admin_profiles.display_name` (fallback email) and `role`, from the history actor id |
| Unattributed transition | `system` | none; rendered as “System” rather than a fabricated person |

The helper verifies the admin id against an active profile and rejects anything
otherwise. Actor values never come from a request body or a template parameter.
Every transition is durably recorded in `booking_status_history`
(from/to status, actor id, actor kind, reason, timestamp — immutable by trigger)
and in `audit_events`, which also carries the order id, action and correlation
id. The administrator booking detail renders both. The integration test asserts
the history and audit rows for a real cancellation.

Payload delivered to the templates: order reference, new status, previous
status (never for a new order), event time in Africa/Accra, actor type, name and
role, services, requested pickup, branch, and the cancellation reason only on a
cancellation (truncated to 500 characters). Missing optional values are omitted,
not invented.

## 5. Delivery, retry and failure isolation

- One outbox row per booking event **and recipient**
  (`UNIQUE (booking_id, template, booking_version, recipient_email)` plus a
  deterministic key and `ON CONFLICT DO NOTHING`). A replay of the same event is
  a no-op; a fan-out is not a duplicate.
- Each recipient receives an individual message, so recipients never see one
  another's addresses.
- Brevo is called with the outbox UUID as the idempotency key (30-minute window);
  a duplicate provider response is treated as accepted.
- Retryable failures use bounded exponential backoff; permanent rejections and
  exhausted budgets are dead-lettered; abandoned leases are reaped. A delivery
  failure never touches the booking, and the deferred trigger's exception
  handler keeps a notification problem from rolling back an order.
- Delivery states are distinguished: `pending`/`retryable_failed` = queued,
  `sent` = **accepted by Brevo**, and `delivered`/`bounced`/`complained` come only
  from authenticated Brevo webhooks. “Accepted” is never reported as delivered.
- The email monitor recognises the five `staff_order_*` templates, shows the
  recipient row by row, and lets a Full Admin requeue a failed row.

## 6. Checks run

| Command | Result |
| --- | --- |
| `npm test` | **318 tests, 318 pass, 0 fail** (~43 s) |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | pass |
| `npm run lint` (`eslint .`) | pass, 0 errors, 5 pre-existing warnings outside Phase 2E (`photos.test.ts` unused imports, two `<img>`, one anonymous default export) |
| `npm run build` (`next build --webpack`) | pass |
| `tests/staff-order-alerts-integration-db.test.ts` | 9 pass against every real migration |

New coverage added this sprint:

- `tests/staff-order-alerts-integration-db.test.ts` — applies all migrations and
  drives the real `booking_submit`, `booking_update_arrangement` and
  `booking_transition`: fan-out to multiple recipients, replay no-op, all five
  events exactly once, no alerts for intermediate states, real previous-status
  values, trusted admin actor, cancellation reason, rejected transition, history
  and audit rows, add/remove/rename recipient semantics, empty list, client-role
  denial and trigger-only helper.
- `tests/staff-order-alerts.test.ts` — partial fan-out failure: one rejected
  recipient is dead-lettered while the other is still delivered.
- `tests/staff-order-alerts-db.test.ts` — harness now uses the real
  `public.admin_role` enum, so the fixed enum defect fails the focused test too.

## 7. Remaining blockers and unverified items

1. **Live Brevo is not configured or verified.** The live Brevo account is not
   accessible from this environment, so no template was saved, rendered in
   Brevo, sent or webhook-confirmed. The five bodies in `docs/emails/staff/` are
   drafts for the account, not published templates.
2. **No scheduler is deployed.** `dispatchPendingEmails` drains only 3 rows after
   a response, while one event can fan out to 11 (10 recipients + the customer
   message). With four or more recipients, the rest stay queued until the next
   order event or the protected worker endpoint runs. A scheduler (or an external
   cron hitting `/api/internal/email/worker` with `EMAIL_WORKER_SECRET`) is
   required for complete, timely delivery. This is the main production blocker.
3. **Migrations are not applied to the hosted Supabase project.** They are
   verified against the full schema locally; applying them remains a deployment
   step.
4. **Unconfigured staff template IDs consume the retry budget** (five attempts
   at fifteen-minute intervals), after which the row is dead-lettered and must be
   requeued from the monitor. Configure the five `BREVO_TEMPLATE_STAFF_ORDER_*_ID`
   values before adding recipients.
5. **Recipient list starts empty.** Until a Full Admin adds addresses, staff
   alerts queue nothing; the customer emails are unaffected.

## 8. Files created or modified in Phase 2E

Migrations:

- `supabase/migrations/20261022120000_booking_alert_recipients.sql`
- `supabase/migrations/20261022120100_staff_order_email_alerts.sql`

Server and UI:

- `src/lib/email/templates.ts`, `config.ts`, `worker.ts`, `outbox-repository.ts`,
  `monitoring.ts`, `monitoring-repository.ts`, `dispatch.ts`
- `src/lib/email/recipients.ts`, `recipient-rules.ts`, `recipient-actions.ts`
- `src/app/api/admin/booking-alert-recipients/route.ts`
- `src/components/admin/booking-alert-recipients.tsx`, `settings.tsx`,
  `admin-app.tsx`
- `src/lib/security/rate-limit.ts`, `.env.example`

Assets and drafts:

- `public/headers/admin-order-{pending,processing,ready,completed,cancelled}.jpeg`
- `docs/emails/staff/01-order-pending.html` … `05-order-cancelled.html`

Tests and documentation:

- `tests/staff-order-alerts.test.ts`, `staff-order-alerts-db.test.ts`,
  `staff-order-alerts-integration-db.test.ts`, `booking-alert-recipients.test.ts`
- `supabase/tests/sprint_2d1_email_outbox.sql` (staff templates recognised by the
  operator verification script)
- `docs/implementation/SPRINT_2E1_STAFF_ORDER_ALERTS.md`,
  `SPRINT_2E2_BOOKING_ALERT_RECIPIENTS.md`, this report,
  `docs/investigations/BREVO_SIX_TEMPLATE_PARAMETER_AUDIT.md`

## 9. Acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Five event types wired to the correct templates | Met (real functions, integration test) |
| 2 | All configured recipients selected for every event | Met for selection/enqueue; delivery completeness needs a scheduler |
| 3 | Trustworthy actor metadata where available | Met (trusted history + profile; enum defect fixed) |
| 4 | Durable audit of relevant actions | Met (history + audit_events, asserted) |
| 5 | Retries and duplicate processing safe | Met (idempotent enqueue, bounded retries, dead-letter, lease) |
| 6 | Recipient management secured and persistent | Met (Full Admin only, RLS deny-by-default, unique/validated) |
| 7 | Customer Phase 2D emails still work | Met (unchanged payloads, asserted in integration test) |
| 8 | Tests and project checks pass | Met (318 tests, typecheck, lint, build) |
| 9 | Live Brevo configuration and rendering verified | **Pending** — no account access in this environment |
