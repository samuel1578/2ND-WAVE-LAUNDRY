# Phase 2E.2 — Central Order Alert Recipient Management

## 1. What was built

A single, persisted administrator notification list, managed inside the existing
`/admin/settings` page and already consumed by the Phase 2E.1 staff alert engine.

- **Table:** `public.booking_alert_recipients` (created in Phase 2E.1). One row per
  authorised address. No per-order recipient configuration exists anywhere.
- **Interface:** the `Order alert recipients` panel at the bottom of
  `/admin/settings` (`src/components/admin/booking-alert-recipients.tsx`).
- **Read endpoint:** `GET /api/admin/booking-alert-recipients`.
- **Writes:** Server Actions in `src/lib/email/recipient-actions.ts`.

Administrators can view the list, add an address, edit an address in place,
remove an address, see success/error feedback, and reload the page: all state is
read back from the database on each load.

## 2. Authorisation

The capability is `settings.manage`, which the central registry grants to
`full_admin` only; `operational_admin` never receives it. Enforcement is layered:

1. `/admin/settings` is already gated server-side by
   `resolveAdminRouteAccess(admin.role, "/admin/settings")`.
2. The read endpoint re-resolves the verified session with `getCurrentAdmin()` and
   returns 401/403; it never accepts a role from the request.
3. Every action repeats the full chain: verified session → `settings.manage` →
   origin verification → per-actor rate limit (`alert_recipients`) → validation →
   server-only repository.
4. The table has RLS enabled with **no** policy and no grants to `anon` or
   `authenticated`. Reads/writes use the elevated server client only, so a direct
   PostgREST call from a browser cannot read or modify the list even if a future
   route check were bypassed.

No action accepts an actor id. The acting Full Admin is always resolved from the
verified session. The browser never receives a service-role key.

## 3. Persistence and validation

- Addresses are normalised to `lower(btrim(email))`, matching the database check.
- Validation is shared by client and server (`src/lib/email/recipient-rules.ts`)
  and mirrored by the database shape constraint.
- `UNIQUE (email)` prevents duplicates, including duplicates created by a
  concurrent request.
- The existing trigger caps enabled recipients at 10. The interface shows the cap
  and disables adding beyond it.
- Edits use the row's `version` as an optimistic-concurrency token. A stale save
  matches no row and returns `conflict`; nothing is silently overwritten.
- Removing a row deletes that address. Because the outbox copies the recipient at
  enqueue time, queued and sent notifications are unchanged.

## 4. Connection to the notification engine

No new fan-out path was created. Every staff alert is still enqueued by
`private.enqueue_staff_order_alert`, which reads
`public.booking_alert_recipients` inside the same transaction as the order event.
Therefore:

- the five events (pending, processing, ready, completed, cancelled) all resolve
  the same list;
- multiple addresses each receive an independent outbox row and a separate Brevo
  send, so recipients are not disclosed to one another;
- an empty or disabled-only list queues zero rows and never fails the order;
- a lookup failure is caught by the deferred trigger's exception handler, logged
  as a warning, and never rolls back the booking;
- adding or removing an address affects subsequent events only. Nothing is
  retroactively resent.

## 5. Demo mode

The panel requires a verified session. In the isolated demo workspace it renders
an explicit “sign in as a Full Admin” state and never calls the API, so demo mode
cannot claim to have persisted recipients.

## 6. Tests and evidence

- `tests/booking-alert-recipients.test.ts` — normalisation, invalid input,
  identifier/version checks, error messages, and permissions (`settings.manage`
  and the `/admin/settings` route deny Operational Admins).
- `tests/staff-order-alerts-db.test.ts` (real PostgreSQL via PGlite) — all five
  events use one list; multiple recipients; add-later and remove-then-event
  behaviour; duplicate/malformed rejection; version conflicts; client-role
  read/write denial; recipient-lookup failure isolated from the order operation.

No live Brevo template was configured or tested; the recipient list starts empty
on a fresh deployment.
