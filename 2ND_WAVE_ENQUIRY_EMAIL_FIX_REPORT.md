# 2ND WAVE LAUNDRY — Enquiry Email Notification Fixes

**Work items:** the six confirmed enquiry-notification fixes.
**Date:** 2026-11-03.

**Verification actually run**

| Check | Command | Result |
|---|---|---|
| Tests | `npm test` | **506 passed, 0 failed** (49s) |
| Typecheck | `npm run typecheck` (`next typegen && tsc --noEmit`) | **Pass** (exit 0) |
| Lint | `npx eslint .` | **Pass**, 0 errors (9 pre-existing warnings) |
| Production build | `npm run build` | **Pass** (compiled successfully) |

**Not verified:** no Brevo API request and no inbox/receipt check was performed,
so **emails are not proven to be delivered end-to-end**. The production Supabase
project was not queried and the new migration was exercised only against the
repository's PGlite migration harness. Deployment environment values could not be
read (see §3).

---

## Findings that drove the fixes

1. **Recipient list was bypassed.** `public.enquiry_submit` required a
   `p_recipient_email` argument and `src/lib/enquiries/repository.ts` hardcoded
   `manager@2ndwavelaundry.com`. Adding, disabling or removing an address in
   `public.booking_alert_recipients` therefore had no effect on enquiry alerts.
2. **Monitoring rejected enquiry rows.** `src/lib/email/monitoring-repository.ts`
   did not list `enquiry_received` in its accepted template set, and its mapper
   required `payload.booking_reference`. An enquiry row in the outbox would throw
   `EmailMonitoringRepositoryError`, which fails the whole `/admin/email-delivery`
   page rather than just that row.
3. **Template variable undocumented.** `BREVO_TEMPLATE_ENQUIRY_RECEIVED_ID` was
   already implemented in `src/lib/email/config.ts`
   (`BREVO_ENQUIRY_TEMPLATE_ID_VARS`, `readEnquiryTemplateIds`,
   `readDeliveryTemplateIds`, `readEmailTemplateConfiguration`) but was absent
   from `.env.example`. There is no value in the repository to inspect; no ID was
   invented.
4. **Dispatch was already prompt.** `/api/enquiries` already calls
   `after(() => dispatchPendingEmails("enquiry_submit"))`, and both the
   post-commit dispatch and the protected worker consume
   `readDeliveryTemplateIds()`, which includes the enquiry template once
   configured. The Vercel cron (`0 0 * * *`, daily) is the fallback drain. No
   schedule change was necessary.
5. **Newsletter alert still uses a separate hardcoded manager constant**
   (`src/lib/newsletter/config.ts`). It is a different notification with its own
   tests and was deliberately left unchanged; this is flagged in §5 rather than
   silently changed.

---

## Fix 1 — Enquiry alerts fan out to the enabled recipient list (atomic, database-side)

**New migration:** `supabase/migrations/20261103130000_enquiry_alert_recipients.sql`

- Drops the old 12-argument `public.enquiry_submit(...)` (the hardcoded-recipient
  signature) and recreates it with **11 arguments — no recipient parameter**.
- After inserting the enquiry, it inserts one `email_outbox` row per **enabled**
  `public.booking_alert_recipients` row in the **same transaction**, so the queue
  cannot drift from the committed submission and there is no read-then-write race
  against the recipient list.
- Per-recipient deterministic idempotency key:
  `enquiry:<enquiry_id>:received:<md5(recipient_email)>`, so replays cannot
  duplicate an alert.
- Payload is unchanged and still minimal: `enquiry_id`, `kind`, `name`,
  `business`, `phone`, `topic` — never the message body, submitter email, or
  notes.
- Audit event now records `alert_queued` plus the number of queued alerts
  (`alert_recipients`), never an address.
- `GET DIAGNOSTICS ROW_COUNT` captures the exact number inserted.
- Empty or fully disabled list is valid: the enquiry is still stored, no alert is
  queued, and the audit says so.
- Executable by `service_role` only (`anon`/`authenticated` revoked).

**`src/lib/enquiries/repository.ts`:** removed `p_recipient_email:
"manager@2ndwavelaundry.com"` from the RPC call. No address is sent from the
application at all.

## Fix 2 — Email monitoring accepts and displays enquiry records

- `src/lib/email/monitoring-repository.ts`: added `"enquiry_received"` to
  `validTemplates`, widened the payload type, and replaced the
  booking-reference requirement with the shared pure helper.
- `src/lib/email/monitoring.ts`: new `emailMonitoringReference(template,
  payload)`:
  - newsletter → subscriber address (unchanged behaviour);
  - enquiry → `Enquiry — general enquiry <id8>` /
    `Enquiry — commercial quote <id8>`, never a fabricated booking reference;
  - booking templates → `booking_reference` (unchanged).
  A malformed payload still produces the stable repository error.
- Enquiry rows are now listable, filterable by `eventType=enquiry_received`
  (already present in `EMAIL_TEMPLATES`), and show a readable title.

## Fix 3 — Template configuration verified as far as the repository allows

- `BREVO_TEMPLATE_ENQUIRY_RECEIVED_ID` is the exact variable. It is read by
  `readEnquiryTemplateIds()` and included in `readDeliveryTemplateIds()`.
- `.env.example` now documents it, the recipient source, the retry behaviour when
  unset, and the requirement that the Brevo body render `params.topic`
  conditionally (commercial alerts omit `topic`).
- Cannot be verified here: Vercel/deployment environment values are not in the
  repository, and `.env.local` is excluded from inspection by policy. If the
  variable is missing in the hosting environment, enquiry alert rows stay
  retryable (they are **not** dead-lettered) while customer and staff email keep
  working.

## Fix 4 — Delivery scheduling

No change was required. The immediate path is the post-response dispatch already
wired to successful enquiry submissions; the daily Vercel cron remains the
restart/failure fallback, consistent with the rest of the deployment. Changing it
was not justified and would affect all notification families.

## Fix 5 — Preserved behaviour

- General enquiry and commercial quote validation, idempotency hash, storage and
  admin list/detail behaviour are unchanged.
- Booking alerts, staff alerts, newsletter interest and all existing templates
  are untouched.
- Recipient management (`/admin/settings`, `recipient-actions.ts`) is untouched
  and now also governs enquiry alerts.
- Commercial alert payloads can still carry `topic: null`; the parameter builder
  omits it from presentation (prior fix).
- No production data was modified.

## Fix 6 — Regression tests added

**New:** `tests/enquiry-alert-recipients-db.test.ts` (real migrations in PGlite)

- two enabled recipients → exactly two alerts, one per recipient, distinct keys,
  `pending`, `booking_id NULL`, payload keys exactly the six allowed ones;
- disabled recipient receives nothing;
- no enabled recipients → enquiry stored, zero outbox rows, audit
  `alert_queued=false`, `alert_recipients=0`;
- audit never contains an address;
- idempotent replay → same enquiry id, `is_new=false`, no second alert;
- the removed 12-argument signature no longer exists (only one
  `enquiry_submit` in `pg_proc`);
- `anon`/`authenticated` hold no execute right; `service_role` does.

**Updated/added elsewhere**

- `tests/email-monitoring.test.ts`: enquiry template accepted and labelled;
  enquiry reference mapping (general, commercial, malformed); repository accepts
  `enquiry_received` and no longer requires `booking_reference`; missing/invalid
  `BREVO_TEMPLATE_ENQUIRY_RECEIVED_ID` reports the variable name without inventing
  an ID.
- `tests/email-delivery.test.ts`: configured enquiry alert sends from its payload
  without reading a booking; transient provider failure reschedules; permanent
  failure is dead-lettered; successful send recorded once; missing template ID
  stays retryable (existing).
- `tests/newsletter-interest-db.test.ts`: updated to the 11-argument function and
  to insert the enabled recipient before asserting one alert, plus a recipient
  address assertion.

---

## Files and migrations changed

| File | Change |
|---|---|
| `supabase/migrations/20261103130000_enquiry_alert_recipients.sql` (new) | Replace `enquiry_submit`; atomic per-recipient fan-out; audit counts |
| `src/lib/enquiries/repository.ts` | Remove hardcoded recipient argument |
| `src/lib/email/monitoring-repository.ts` | Accept `enquiry_received`; shared reference mapping |
| `src/lib/email/monitoring.ts` | Pure `emailMonitoringReference` |
| `.env.example` | Document `BREVO_TEMPLATE_ENQUIRY_RECEIVED_ID` and behaviour |
| `tests/enquiry-alert-recipients-db.test.ts` (new) | Fan-out, disabled/none, replay, removed arg, privileges |
| `tests/email-monitoring.test.ts` | Monitoring + config regressions |
| `tests/email-delivery.test.ts` | Enquiry send/retry/dead-letter regressions |
| `tests/newsletter-interest-db.test.ts` | New signature + recipient insert |

**Deployment order:** apply
`20261103130000_enquiry_alert_recipients.sql` after
`20261103120000_gallery_collections.sql`, with the application build that no
longer sends `p_recipient_email`. The migration is forward-only and additive
except for replacing the function signature; nothing is deleted from data tables.
Apply it through the normal approval flow — it was not executed against
production.

---

## Remaining deployment configuration and live verification

1. **Set `BREVO_TEMPLATE_ENQUIRY_RECEIVED_ID`** in the hosting environment to the
   numeric ID of a saved template in *this* Brevo account. Not verifiable from the
   repository; do not invent a value.
2. **Make the Brevo template conditional.** `docs/emails/enquiry-received.html`
   still documents `topic` as unconditionally required and names a single manager
   recipient. The saved Brevo body must wrap the topic row in a conditional
   (`params.topic`) so commercial alerts do not render an empty topic line; update
   that draft's comments/audience text when the template is edited.
3. **Verify enabled recipients** in `/admin/settings`. The list is currently the
   only recipient source; an empty list queues no alerts. There is no seeded
   address.
4. **End-to-end delivery test still required.** Submit one general and one
   commercial enquiry in a staging deployment, confirm two outbox rows per
   enabled recipient, then confirm provider acceptance in
   `/admin/email-delivery` and actual receipt in each inbox. Until then, do not
   claim enquiry emails are working.
5. **Newsletter alert recipient** remains the separate hardcoded manager constant
   in `src/lib/newsletter/config.ts`. Decide whether it should also follow
   `booking_alert_recipients`; that is a product decision outside this fix.
6. **Cron frequency** is daily by design. If the post-response dispatch fails
   (for example a cold provider outage), alerts wait for that drain or a manual
   worker call; raise the frequency only if the hosting plan and operational
   policy allow it.
