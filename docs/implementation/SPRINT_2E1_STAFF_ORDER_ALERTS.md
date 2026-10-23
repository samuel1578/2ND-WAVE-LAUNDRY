# Phase 2E.1 — Staff/Admin Order Notification Engine (Server Foundation)

**Status:** implemented in this repository. No Brevo template has been saved or
tested in the live Brevo account, and no live email was sent.

## 1. Scope delivered

The five required order events now enqueue a staff/admin alert, fanned out to the
single central recipient list:

| Event | Authoritative source | Staff template |
| --- | --- | --- |
| Order placed (pending) | `bookings` INSERT with `status = 'pending'` | `staff_order_pending` |
| Moved to processing | committed transition to `processing` | `staff_order_processing` |
| Marked ready | committed transition to `ready` | `staff_order_ready` |
| Marked completed | committed transition to `completed` | `staff_order_completed` |
| Cancelled | committed transition to `cancelled` | `staff_order_cancelled` |

`confirmed`, `scheduled`, `picked_up` and `out_for_delivery` deliberately produce
no staff alert. No new status values were introduced.

## 2. What was reused from Phase 2D

- `public.email_outbox`, its claim/reap/mark-sent/mark-retry/mark-dead functions,
  lease handling, retry backoff, dead-letter state and provider idempotency key.
- `src/lib/email/worker.ts`, `src/lib/email/brevo.ts`,
  `src/lib/email/dispatch.ts`, `src/lib/email/config.ts`.
- The existing worker endpoint `/api/internal/email/worker` and the administrator
  email monitor (`src/lib/email/monitoring.ts`).
- Lower-camelCase Brevo parameter conventions and the branded header asset
  pattern in `public/headers/`. Each staff alert uses the checked-in, event-
  specific admin asset: `admin-order-pending.jpeg`,
  `admin-order-processing.jpeg`, `admin-order-ready.jpeg`,
  `admin-order-completed.jpeg` and `admin-order-cancelled.jpeg`.
- The customer triggers, customer templates, customer parameters and customer
  wording were not modified.

The six customer templates, their payload keys and their trigger behaviour are
unchanged. `tests/staff-order-alerts.test.ts` asserts the customer parameter
contract still contains no staff fields.

## 3. Database changes

### `20261022120000_booking_alert_recipients.sql`

- Adds the five `staff_order_*` values to `public.email_template`.
- Creates `public.booking_alert_recipients` — the single central list. Columns:
  `id`, `email` (lower-case, unique, shape-checked), `label`, `enabled`,
  `version`, `created_by`, timestamps.
- Enforces a hard cap of 10 enabled recipients in a trigger.
- RLS enabled with no client policy; only the elevated server role has grants.

### `20261022120100_staff_order_email_alerts.sql`

- Widens the outbox uniqueness to
  `(booking_id, template, booking_version, recipient_email)`, so fan-out to
  several staff addresses is distinct while a replay is still a no-op.
- Widens the payload shape check: customer rows keep exactly
  `booking_reference` + `status`; staff rows additionally store
  `previous_status`, `actor_kind`, `actor_name`, `actor_role`, `occurred_at`
  and `cancellation_reason`.
- Adds `private.enqueue_staff_order_alert(...)` and two **deferred** booking
  triggers.

### Why deferred triggers

A genuine transition writes its `booking_status_history` row — trusted actor id,
actor kind and recorded reason — in the same transaction as the status update.
Deferring the staff trigger to commit lets it read that committed history rather
than trusting a caller. The status and version are re-read from `public.bookings`;
the caller can never supply them.

The trigger function catches every exception and emits a warning, so a
notification problem cannot roll back a successfully committed order operation.
An empty or fully disabled recipient list queues nothing and also does not fail.

## 4. Recipient list integration point

- **Persistence:** `public.booking_alert_recipients`. The engine reads it directly
  inside the enqueue helper, so every alert uses one list and there is no
  per-order recipient concept.
- **Server persistence:** `src/lib/email/recipients.ts` and the shared rules in
  `src/lib/email/recipient-rules.ts`.
- **Interface and authorisation (Phase 2E.2):** the Order alert recipients panel
  in `/admin/settings`, the `settings.manage` (Full Admin only) enforcement in
  `src/lib/email/recipient-actions.ts` and the read route
  `/api/admin/booking-alert-recipients`. See
  `SPRINT_2E2_BOOKING_ALERT_RECIPIENTS.md`.
- The list starts empty; nothing is seeded. Until addresses are added, staff
  alerts queue zero rows. Customer email is unaffected.

## 5. Actor metadata

| Event source | Actor kind | Name / role source |
| --- | --- | --- |
| Public order placement | `customer` | persisted `bookings.customer_name` |
| Administrator transition | `admin` | `admin_profiles.display_name` (fallback `email`) and `role`, looked up from the history actor id |
| Unattributed / system transition | `system` | none; rendered honestly as “System” |

An unknown or disabled administrator id makes the helper raise
`STAFF_ALERT_ACTOR`; because the trigger isolates failures, the booking still
commits and no identity is invented. No actor value is read from a request body.
The profile role is the `public.admin_role` enum, so the helper casts it to text
before coalescing; without that cast every administrator-attributed alert raised
an enum error at execution and was silently isolated. The end-to-end test through
the real migrations covers it (`tests/staff-order-alerts-integration-db.test.ts`).

## 6. Idempotency and delivery

- Deterministic key:
  `staff:<booking_id>:<template>:v<version>:<md5(recipient_email)>`, unique.
- The second guarantee is the unique booking/template/version/recipient index;
  `ON CONFLICT DO NOTHING` makes a replay a no-op.
- An unchanged status never fires the status trigger; a status that no longer
  matches the template makes the helper raise `STAFF_ALERT_STATUS`, so a stale
  duplicate cannot be queued.
- Delivery retries, backoff, dead-lettering and provider idempotency are the
  Phase 2D machinery. A transient provider failure never touches the booking.
- Provider acceptance is still not proof of inbox delivery; authenticated Brevo
  webhooks remain the source of later delivery events.

## 7. Brevo parameter contract

Every staff template receives:

`customerName`, `bookingReference`, `bookingStatus` (operational label),
`actorType`, `websiteUrl`, `contactUrl`, `privacyUrl`, `headerImageUrl`
(one of the five `admin-order-*.jpeg` assets), `headerImageAlt`.

Conditional keys, omitted when the persisted value is unavailable:

`serviceSummary`, `requestedPickup`, `branchName`, `previousStatus` (never for a
new order), `eventAt` (Africa/Accra), `actorName`, `actorRole`,
`cancellationReason` (cancellation only; empty if none was recorded).

Draft bodies using only these keys are in `docs/emails/staff/`. They are drafts
for the Brevo account, not saved or tested templates.

## 8. Configuration

Add the five optional, server-only IDs after saving the templates in Brevo:

```
BREVO_TEMPLATE_STAFF_ORDER_PENDING_ID
BREVO_TEMPLATE_STAFF_ORDER_PROCESSING_ID
BREVO_TEMPLATE_STAFF_ORDER_READY_ID
BREVO_TEMPLATE_STAFF_ORDER_COMPLETED_ID
BREVO_TEMPLATE_STAFF_ORDER_CANCELLED_ID
```

They are read separately from the six customer IDs. A missing staff ID does not
disable customer sending: the staff row is retried with
`email_template_not_configured` every fifteen minutes. That retry consumes the
row's five-attempt budget, so configure the templates before real alerts arrive;
otherwise the row reaches the dead-letter state and a Full Admin must requeue it
from the email monitor after the template is saved. The API key remains
server-only.

## 9. Verified checks

- `tests/staff-order-alerts.test.ts` — mapping, parameter contract, actor and
  omission rules, customer contract unchanged, staff config isolation, worker
  delivery, and retry when a staff template is unconfigured.
- `tests/staff-order-alerts-db.test.ts` — real PostgreSQL (PGlite): fan-out,
  empty/disabled list safety, per-event mapping, unchanged status, duplicate
  replay, status/version rejection, trusted admin actor, unverifiable actor,
  system actor, recipient cap, client-role denial and recipient immutability.

No live Brevo send, scheduler activation or template publication was performed.
