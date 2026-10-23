# Brevo Six-Template Parameter Audit

**Repository:** `samuel1578/2ND-WAVE-LAUNDRY`  
**Production origin checked:** `https://2ndwave.vercel.app`  
**Audit date:** 2026-10-20  
**Scope:** Read-only source, migration, test and public-asset inspection. No email was sent, no production data was queried, and no existing file or database object was changed.

## Evidence boundaries

- **Confirmed in source** means directly established by repository code, migrations, tests or checked-in assets.
- **Observed externally** means checked through the public deployed asset URL or shown in the screenshots/template HTML supplied by the owner.
- **Unverified** means saved Brevo account configuration, live environment values, or behavior requiring a live controlled send that could not be inspected in this read-only audit.
- Production template IDs and customer data are deliberately not reported. Test IDs in tests are fixtures, not account IDs.

## A. Executive summary

The application’s saved-template contract is defined in `src/lib/email/templates.ts`. It sends lower camelCase names such as `customerName`, `bookingReference`, and `requestedPickup`. The owner-provided booking-received HTML instead refers to `CUSTOMER_FIRST_NAME`, `BOOKING_REFERENCE`, `SERVICE_SUMMARY`, `REQUESTED_PICKUP_DATE`, `REQUESTED_PICKUP_TIME`, `BRANCH_NAME`, and `SUPPORT_EMAIL`. Those names are not keys in the application payload. The differences are not cosmetic: template engines receive the actual JSON keys, so the provided template asks for values the app does not supply. This explains the blank greeting, reference, service and pickup fields shown in the supplied rendered-email screenshot. It also explains why a subject using an unsupported parameter can end in a dangling dash.

Additional confirmed findings:

1. The app does not set or send a subject, preview text, HTML body or plain-text body. It sends a saved Brevo `templateId` and a `params` object. The active subject and body therefore come from the saved Brevo template.
2. The application contract supplies **one combined `requestedPickup` string**, not separate date and time variables. It does not provide `SUPPORT_EMAIL`, a WhatsApp URL, cancellation reason, fulfilment arrangement, completion date, refund details or expected completion time.
3. The application supplies `customerName` as the persisted full customer name after whitespace collapsing; it does not extract a first name.
4. The header URL is built from server-side `SITE_URL` and a per-event asset mapping. All four proposed customer header paths exist in `public/headers/`; on the audit date, each deployed URL returned HTTP 200 with `image/png`.
5. The outbox trigger queues events in the same database transaction as an eligible booking insert/status update. A post-commit dispatch is attempted, but no scheduler configuration exists in this repository; the protected worker has to be invoked manually or by separately configured hosting.
6. Brevo’s saved template definitions and actual numeric production IDs were not accessible in source. The supplied HTML and provider screenshots are owner-provided evidence, not a repository copy or a direct inspection of the saved Brevo template.

**Root cause established for the blank content:** the provided saved-template variable names do not match the application’s emitted parameter keys and value shapes.  
**Root cause of the prior missing header in a specific email:** not conclusively established. The public asset URL now returns successfully; the URL used in that particular message and the mail client’s image-fetch result were not available to this audit.  
**Spam placement:** not determined by this audit. SPF/DKIM/DMARC passing in the supplied screenshot does not prove inbox placement or establish why an earlier message was classified as spam.

## B. Delivery architecture

### Actual call chain

1. **Public booking:** `src/app/api/bookings/route.ts` handles `POST`, validates the request through `handleBookingSubmission`, and calls `submitPublicBooking`. The database function `public.booking_submit` creates a pending booking and service rows. An idempotent replay returns without inserting a second booking.
2. **Booking-created event:** `supabase/migrations/20261019120000_email_outbox.sql` installs `bookings_email_created`, an `AFTER INSERT` trigger on `public.bookings`. Only an inserted `pending` booking maps to `booking_created`. The trigger reads the recipient and reference from the booking row and calls `private.enqueue_booking_email`. Missing or malformed customer email is skipped without a failed outbox row.
3. **Admin status change:** `src/lib/bookings/admin-actions.ts` calls `transitionBooking`, which reaches `public.booking_transition`. The database checks role, version, valid transition, cancellation reason and confirmation prerequisites, then updates status/history/audit in a transaction. The outbox status trigger maps the resulting status within the same transaction.
4. **Post-commit attempt:** the booking route and status action use Next.js `after()` to invoke `src/lib/email/dispatch.ts` after the response/transaction. This is best-effort and catches failures so email cannot roll back or fail the booking operation.
5. **Worker:** `dispatchPendingEmails` reads server environment configuration, creates the Supabase admin outbox repository and Brevo client, and runs `runEmailWorker`. Independently, `src/app/api/internal/email/worker/route.ts` exposes bounded authenticated GET/POST execution for a scheduler or manual operator. No scheduler file is present in the repository; the worker route alone does not schedule itself.
6. **Claim and current booking data:** `src/lib/email/worker.ts` calls repository `reap` and `claim`, then `loadBookingContext`. `src/lib/email/outbox-repository.ts` obtains booking name/reference/requested/agreed data, service titles and assigned branch using the server-only Supabase admin client.
7. **Template selection and params:** `src/lib/email/config.ts` maps each typed outbox event to one required environment variable and parses its numeric ID. The worker selects `templateIds[row.template]` and calls `buildBrevoTemplateParams(row.template, context, { siteUrl })`.
8. **Provider request:** `src/lib/email/brevo.ts` calls `POST https://api.brevo.com/v3/smtp/email`, authenticating with the server-only `api-key` header. Its JSON contains `sender`, `to`, `templateId`, `params`, custom headers and tags. It does **not** contain `subject`, `htmlContent` or `textContent`.

### Sources of truth

| Concern | Source |
| --- | --- |
| Event names and parameter construction | `src/lib/email/templates.ts`, `emailTemplates` and `buildBrevoTemplateParams` |
| Event-to-template environment mapping | `src/lib/email/config.ts`, `BREVO_TEMPLATE_ID_VARS` |
| Runtime numeric IDs | The six server environment variables; actual production values are **not verified in this report** |
| Recipient | `public.bookings.customer_email` copied by the SQL trigger to `public.email_outbox.recipient_email` |
| Sender email/name | Server environment `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME`, copied into the Brevo request |
| Subject, preview text, HTML and any saved plain-text version | Saved Brevo template for the selected ID; not present in the request or repository |
| Booking lifecycle and event enqueue | Booking database functions/triggers plus `src/lib/bookings/lifecycle.ts` |
| Header URL and alt text | `HEADER_ASSETS` and `HEADER_ALT` in `src/lib/email/templates.ts`, joined to validated `SITE_URL` |

### Implemented delivery safeguards and limits

- The outbox uses a unique idempotency key and a unique booking/template/version identity; replaying a booking request does not create a second event.
- Database claim functions use a bounded batch and `FOR UPDATE SKIP LOCKED`; leases can be reaped after expiry.
- Provider 429, timeout/network and 5xx failures are retryable; other provider responses are classified permanent by `src/lib/email/brevo.ts`. The worker applies capped exponential delay with jitter and a terminal dead state.
- The request uses the outbox UUID as `headers.idempotencyKey`. The implementation comments claim a 30-minute Brevo idempotency window and treats `duplicate_parameter` / `duplicate_request` as already accepted. The official endpoint page inspected for this report confirms the template/params API but did **not** establish that idempotency contract. Treat the provider idempotency guarantee/window as **requiring separate authoritative verification**; the worker itself documents at-least-once delivery, not mathematical exactly-once delivery.
- Provider acceptance is stored as `sent`/“Accepted by provider,” not as inbox delivery. Authenticated webhooks can store normalized delivery events, but live Brevo webhook configuration was not verified.
- Configuration and booking delivery failures are isolated from booking transactions. The immediate post-commit dispatch is best-effort. Automatic recovery depends on a configured scheduler, which is not included here.

## C. Six-event parameter matrix

### Shared contract

Every event’s final `params` object contains these eight keys. Values are strings because the builder returns `Record<string, string>`.

| Exact key | Source / transformation | Shape and presence |
| --- | --- | --- |
| `customerName` | `bookings.customer_name`; whitespace collapsed by `collapse()` | String key always included; full name, not first-name extraction. It could be empty if bad legacy data exists, though the booking schema requires a nonblank name. |
| `bookingReference` | `bookings.reference`; whitespace collapsed | String always included. The database validates the public reference format. |
| `bookingStatus` | Constant selected by event in `TEMPLATE_STATUS` | String always included: `Pending confirmation`, `Confirmed`, `Processing`, `Ready`, `Completed`, or `Cancelled`. It is not read from an arbitrary request parameter. |
| `websiteUrl` | Validated `SITE_URL` origin | String always included. |
| `contactUrl` | `${SITE_URL}/contact` | String always included. |
| `privacyUrl` | `${SITE_URL}/privacy` | String always included. |
| `headerImageUrl` | `${SITE_URL}/headers/${HEADER_ASSETS[event]}` | Absolute URL string always included. |
| `headerImageAlt` | Event constant in `HEADER_ALT` | String always included. |

These values are optional and **omitted as keys** when absent/invalid; they are not sent as `null` or empty placeholders:

| Exact key | Source / transformation | Availability |
| --- | --- | --- |
| `serviceSummary` | Ordered `booking_services.service_title` values, whitespace-collapsed and joined with `, ` | Included only when at least one nonblank persisted service title exists. |
| `requestedPickup` | `bookings.requested_date` plus optional `requested_time`, formatted by `formatRequestedPickup` | One combined string, e.g. a formatted date with ` at HH:mm`; not separate date/time fields. Omitted if the date is absent/invalid. If time is absent/invalid, date alone is emitted. No timezone suffix is added by this formatter. |

No event payload contains `requestedPickupDate`, `requestedPickupTime`, `CUSTOMER_FIRST_NAME`, `SUPPORT_EMAIL`, a WhatsApp URL, cancellation reason, refund/payment details, fulfilment arrangement, expected completion time or completion timestamp.

### Per-event final parameter contract

The common keys above are sent for **each** event. Optional common fields remain conditional for every event. Event-specific additions are:

| Event identifier | Exact trigger condition | Template ID source | Additional exact keys reaching Brevo |
| --- | --- | --- | --- |
| `booking_created` | `AFTER INSERT` on `public.bookings`, only if new status is `pending`; invalid/missing email skips enqueue | `BREVO_TEMPLATE_BOOKING_RECEIVED_ID` | None. `branchName`, agreed pickup and fee are not sent. |
| `booking_confirmed` | Successful committed transition to `confirmed`; database confirmation gate must pass | `BREVO_TEMPLATE_BOOKING_CONFIRMED_ID` | `agreedPickup` conditionally formatted from `agreed_pickup_at` in `Africa/Accra`; `branchName` if assigned branch lookup returns a title; `confirmedFee` if fee is non-null, finite and nonnegative, formatted as currency and amount. |
| `booking_processing_started` | Successful committed status transition whose new status is `processing` (valid lifecycle path is `picked_up → processing`) | `BREVO_TEMPLATE_PROCESSING_STARTED_ID` | `branchName` if assigned branch lookup returns a title. No agreed appointment or fee is added. |
| `booking_ready` | Successful committed status transition whose new status is `ready` (valid lifecycle path is `processing → ready`) | `BREVO_TEMPLATE_LAUNDRY_READY_ID` | `branchName` if assigned branch lookup returns a title. No collection/delivery arrangement is included. |
| `booking_completed` | Successful committed transition to `completed`; permitted from `ready` or `out_for_delivery` | `BREVO_TEMPLATE_BOOKING_COMPLETED_ID` | None. No completion date, payment or refund field is sent. |
| `booking_cancelled` | Successful committed transition to `cancelled` from a permitted nonterminal state; database requires a reason but does not pass it to the email builder | `BREVO_TEMPLATE_BOOKING_CANCELLED_ID` | None. Cancellation reason/private administrator notes are deliberately excluded. |

In all six rows, the code passes only strings in `params`; it does not supply booleans, numbers, structured date objects or separate date/time objects. The `recipient_email` is passed separately as Brevo `to`, and sender values are passed separately as `sender`.

### Per-event detailed evidence

#### 1. Booking request received — `booking_created`

| Field | Exact contract |
| --- | --- |
| Event / trigger | `booking_created`; after a pending booking insert. Idempotent public booking replay returns before a second insert. |
| ID | Runtime `BREVO_TEMPLATE_BOOKING_RECEIVED_ID`; actual numeric value unknown here. |
| Always-sent keys | All eight shared keys: `customerName`, `bookingReference`, `bookingStatus`, `websiteUrl`, `contactUrl`, `privacyUrl`, `headerImageUrl`, `headerImageAlt`. `bookingStatus` is `Pending confirmation`. |
| Conditional keys | `serviceSummary`; combined `requestedPickup`. |
| Not sent | `branchName`, `agreedPickup`, `confirmedFee`, first-name-only value, support email, separate requested date/time, WhatsApp CTA URL. |
| Truthful message supported | Request received and pending confirmation. The code does not provide confirmation details at this point. |
| Evidence | `supabase/migrations/20261019120000_email_outbox.sql:454-518`; `src/lib/email/templates.ts:43-72,130-160`; `src/lib/email/config.ts:23-30`. |

#### 2. Booking confirmed — `booking_confirmed`

| Field | Exact contract |
| --- | --- |
| Event / trigger | `booking_confirmed`; committed transition to `confirmed`, only after confirmation readiness checks. |
| ID | Runtime `BREVO_TEMPLATE_BOOKING_CONFIRMED_ID`; actual numeric value unknown here. |
| Always-sent keys | All eight shared keys; `bookingStatus` is `Confirmed`. |
| Conditional keys | `serviceSummary`, `requestedPickup`, `agreedPickup`, `branchName`, `confirmedFee`. Agreed values appear only if persisted data passes builder formatting/validation. |
| Not sent | Contact outcome, confirmation note, support email, payment/refund status, separate requested date/time. |
| Truthful message supported | Confirmation and only the persisted agreed appointment, assigned branch and agreed fee that are available. Requested time and agreed time are different fields and must be labelled distinctly. |
| Evidence | `supabase/migrations/20261011130200_booking_functions.sql:851-988`; `src/lib/bookings/lifecycle.ts:52-88`; `src/lib/email/templates.ts:130-171`. |

#### 3. Processing started — `booking_processing_started`

| Field | Exact contract |
| --- | --- |
| Event / trigger | `booking_processing_started`; committed transition to `processing`, permitted after pickup. |
| ID | Runtime `BREVO_TEMPLATE_PROCESSING_STARTED_ID`; actual numeric value unknown here. |
| Always-sent keys | All eight shared keys; `bookingStatus` is `Processing`. |
| Conditional keys | `serviceSummary`, `requestedPickup`, `branchName`. |
| Not sent | Agreed pickup/fee, expected completion date, support email, delivery arrangement. |
| Truthful message supported | Processing has started. The persisted status is the evidence; no completion promise is supplied. |
| Evidence | `supabase/migrations/20261019120000_email_outbox.sql:476-481`; `src/lib/email/templates.ts:43-72,150-177`. |

#### 4. Laundry ready — `booking_ready`

| Field | Exact contract |
| --- | --- |
| Event / trigger | `booking_ready`; committed transition to `ready`, permitted after `processing`. |
| ID | Runtime `BREVO_TEMPLATE_LAUNDRY_READY_ID`; actual numeric value unknown here. |
| Always-sent keys | All eight shared keys; `bookingStatus` is `Ready`. |
| Conditional keys | `serviceSummary`, `requestedPickup`, `branchName`. |
| Not sent | Whether this booking is collection or delivery; delivery address; delivery time; agreed pickup appointment; support email. |
| Truthful message supported | Laundry is ready for the next step. Do not claim it is out for delivery or state a collection arrangement absent another authoritative field. |
| Evidence | `supabase/migrations/20261019120000_email_outbox.sql:476-481`; `src/lib/email/templates.ts:43-72,150-177`; `src/lib/bookings/lifecycle.ts:26-30`. |

#### 5. Booking completed — `booking_completed`

| Field | Exact contract |
| --- | --- |
| Event / trigger | `booking_completed`; committed transition to `completed`, permitted from `ready` or `out_for_delivery`. |
| ID | Runtime `BREVO_TEMPLATE_BOOKING_COMPLETED_ID`; actual numeric value unknown here. |
| Always-sent keys | All eight shared keys; `bookingStatus` is `Completed`. |
| Conditional keys | `serviceSummary`, `requestedPickup`. |
| Not sent | Completion date/time, payment/refund status, branch, support email. |
| Truthful message supported | Existing lifecycle status is completed; do not assert payment or refund. |
| Evidence | `src/lib/bookings/lifecycle.ts:28-30`; `supabase/migrations/20261019120000_email_outbox.sql:476-481`; `src/lib/email/templates.ts:43-72,150-160`. |

#### 6. Booking cancelled — `booking_cancelled`

| Field | Exact contract |
| --- | --- |
| Event / trigger | `booking_cancelled`; committed transition to `cancelled`; a cancellation reason is required by the database transition function. |
| ID | Runtime `BREVO_TEMPLATE_BOOKING_CANCELLED_ID`; actual numeric value unknown here. |
| Always-sent keys | All eight shared keys; `bookingStatus` is `Cancelled`. |
| Conditional keys | `serviceSummary`, `requestedPickup`. |
| Not sent | Cancellation reason, private administrator commentary, refund/payment status, support email. |
| Truthful message supported | Neutral notice that the booking was cancelled. No reason or refund promise is available to the template. |
| Evidence | `supabase/migrations/20261011130200_booking_functions.sql:851-985`; `src/lib/email/templates.ts:43-72,150-160`. |

## D. Template audit

### What source does and does not contain

The repository contains no actual saved Brevo HTML, subject, or preview-text definitions. It stores only six environment-variable names and a typed mapping in `src/lib/email/config.ts:23-30`. The test suite uses fixture IDs `101`–`106` in `tests/email-delivery.test.ts:50-55`; these are test-only values and **must not be copied into Brevo configuration**. The runtime values are selected from the six `BREVO_TEMPLATE_*_ID` environment variables; the actual production numbers and their account-side names were not inspected.

`src/lib/email/brevo.ts:145-170` passes `templateId` and `params`; it does not override a subject or body. Therefore:

- Subject source: saved Brevo template, not application source.
- Preview/preheader source: saved Brevo template, not application source.
- HTML/plain-text source: saved Brevo template, not application source.
- Saved template names, IDs, subjects and active content: **unverified** without read-only access to the Brevo account.

The supplied booking-received HTML is treated here as a user-provided draft, not verified as the currently saved Brevo template.

### Supplied HTML compared with actual application keys

| Supplied HTML reference | Application key actually emitted | Finding |
| --- | --- | --- |
| `params.CUSTOMER_FIRST_NAME` | `customerName` | Mismatch in name and shape. App sends the full persisted customer name, not a first-name-only field. |
| `params.BOOKING_REFERENCE` | `bookingReference` | Mismatch; app sends lower camelCase. |
| `params.SERVICE_SUMMARY` | `serviceSummary` | Mismatch; app key is lower camelCase and is omitted if there are no persisted service titles. |
| `params.REQUESTED_PICKUP_DATE` + `params.REQUESTED_PICKUP_TIME` | `requestedPickup` | Mismatch in both names and shape. App sends one combined formatted string; date/time may be absent. |
| `params.BRANCH_NAME` in the received template | No branch key for `booking_created` | Missing for this event. `branchName` is conditionally provided for confirmed, processing-started and ready events only. |
| `params.SUPPORT_EMAIL` | No such parameter | Never sent by the app. |
| Subject variable ending after `—` | `bookingReference` exists in the body parameter object | Subject can use the verified `bookingReference` key, but the app does not supply subject text. The supplied provider-log screenshot shows a booking-received subject ending in an em dash with no reference. Its saved source cannot be inspected here. |
| Fixed WhatsApp URL in the supplied HTML | `contactUrl` is supplied; no `whatsappUrl` parameter | App’s `src/lib/content.ts:23-29` defines the website’s WhatsApp URL, but the email builder does not pass it. A static Brevo URL is account-side content, not an application-provided value. |

Brevo’s official transactional-send documentation describes choosing a saved template with `templateId` and passing dynamic values in the request’s `params` object. The supplied `{{ params.* }}` expression form is consistent with the parameter namespace used by Brevo New Template Language, but the active saved template’s rendering and escaping settings were not inspected. The object keys the app actually sends remain the authoritative contract above.

## E. Header asset audit

### Mapping implemented by the application

`headerImageUrl` is constructed as `${SITE_URL}/headers/${HEADER_ASSETS[event]}`. `SITE_URL` is validated as an origin in `src/lib/email/config.ts:85-110`; the parameter builder appends the path in `src/lib/email/templates.ts:52-72,137-148`.

| Event | Asset path | `headerImageAlt` | Repository asset | Production URL check |
| --- | --- | --- | --- | --- |
| `booking_created` | `/headers/general-booking.png` | `2nd Wave Laundry booking request received` | `public/headers/general-booking.png` | HTTP 200, `image/png` |
| `booking_confirmed` | `/headers/booking-confirmed.png` | `2nd Wave Laundry booking confirmed` | `public/headers/booking-confirmed.png` | HTTP 200, `image/png` |
| `booking_processing_started` | `/headers/processing-started.png` | `2nd Wave Laundry processing started` | `public/headers/processing-started.png` | HTTP 200, `image/png` |
| `booking_ready` | `/headers/laundry-ready.png` | `2nd Wave Laundry ready for collection or delivery` | `public/headers/laundry-ready.png` | HTTP 200, `image/png` |
| `booking_completed` | `/headers/general-booking.png` | `2nd Wave Laundry booking completed` | `public/headers/general-booking.png` | HTTP 200, `image/png` |
| `booking_cancelled` | `/headers/general-booking.png` | `2nd Wave Laundry booking cancelled` | `public/headers/general-booking.png` | HTTP 200, `image/png` |

The four distinct production URLs were checked with HTTPS HEAD on 2026-10-20 and returned status 200 and `Content-Type: image/png`. This verifies current public reachability, not image-fetch behavior in every mail app or the URL in an already-sent email.

Visual inspection of the checked-in images:

- `general-booking.png` includes the logo and static words “Your Laundry, Our Priority” plus a general service tagline; it does not itself say that a booking request was received.
- `booking-confirmed.png` includes “Your Booking Is Confirmed” and says the service is scheduled and confirmed. The application event is `confirmed`; the separate status `scheduled` exists in the lifecycle. The saved template/body should ensure this image wording is appropriate for the agreed appointment and not mistaken for the separate lifecycle status.
- `processing-started.png` says items are being professionally processed.
- `laundry-ready.png` says laundry is ready for the next step.

Because these images bake in headings/taglines, keep essential event information and reference as live HTML text too; images can be blocked. Avoid duplicating identical headings unnecessarily. The supplied booking-received HTML uses the correct production path, but the last actual send’s rendered image URL was not available for audit. The prior `SITE_URL` invalid configuration could produce no valid worker request; no inference is made about the specific image fetch from that fact alone.

Other files in `public/headers/` include the later-sprint staff/newsletter assets and JPEG variants. They are not selected by the six-event mapping.

## F. Business-rule audit

### States and transitions

The database enum `public.booking_status` in `supabase/migrations/20261011130000_booking_schema.sql:32-42` has: `pending`, `confirmed`, `scheduled`, `picked_up`, `processing`, `ready`, `out_for_delivery`, `completed`, `cancelled`.

`src/lib/bookings/lifecycle.ts:22-31` permits:

- `pending → confirmed | cancelled`
- `confirmed → scheduled | picked_up | cancelled`
- `scheduled → picked_up | cancelled`
- `picked_up → processing | cancelled`
- `processing → ready | cancelled`
- `ready → out_for_delivery | completed | cancelled`
- `out_for_delivery → completed | cancelled`
- `completed` and `cancelled` are terminal.

Only the six notification events are mapped. There is no customer email for `confirmed → scheduled`, `scheduled → picked_up`, or `ready → out_for_delivery`.

### Confirmation, cancellation and fulfilment details

- The transition function validates the permitted transition and performs the confirmation gate before changing to `confirmed`. The gate requires an assigned branch, explicitly recorded agreed pickup instant, nonnegative agreed fee (and a reason for a zero fee), contact outcome and confirmation note. The agreed appointment is not inferred from the requested appointment.
- Booking creation requires a name and allows optional customer email. The enqueue helper skips absent or malformed email without creating an email failure.
- Cancellation requires a reason for the transition, but the email parameter builder intentionally does not include that reason.
- The email context reads branch title and agreement fields, but it does not read a booking-specific collection/delivery arrangement. It has no refund/payment field.
- The footer phone `059 522 4280` and WhatsApp URL `https://wa.me/233595224280` exist in `src/lib/content.ts:23-29`. Neither is included in the Brevo `params` object. The code contains no customer-support email parameter or public support email in this contact object. The configured sender address is not automatically a support address.
- Consequently, the ready message should state “ready”/“ready for the next step” without claiming collection or delivery instructions for a particular booking. A template can use the app-provided `contactUrl` CTA. A WhatsApp CTA would require a verified static Brevo link or a deliberate app-contract change; it is not currently passed dynamically.

## G. Defect register

| Severity | Evidence | Affected events | Impact | Recommended correction |
| --- | --- | --- | --- | --- |
| **High** | Supplied HTML uses uppercase/other keys; app builder emits camelCase keys in `src/lib/email/templates.ts:137-177`. | All six, with exact mismatches varying by event | Variables render blank; booking reference, greeting, service and date details disappear. | Align each saved Brevo template to the exact per-event parameter contract in section C. |
| **High** | Supplied HTML asks `CUSTOMER_FIRST_NAME`; app sends full `customerName`. | All six | Wrong parameter is blank; even after key correction, it is a full name rather than first name. | Use `customerName` or make a deliberate, tested first-name transformation in the application. Smallest correction: use full-name key. |
| **High** | Supplied received template asks `BRANCH_NAME`; builder excludes `branchName` for `booking_created`. | Booking received | Empty branch block/label; branch may not yet be assigned by design. | Omit branch block for received template; do not invent/derive branch before assignment. |
| **High** | Supplied template asks `SUPPORT_EMAIL`; no email parameter is emitted. | Any template using it | Blank `mailto:` target and blank visible address. | Remove the dynamic email reference or add a formally approved support-email contract. Do not use sender identity implicitly. |
| **High** | App sends one optional `requestedPickup` combined string, but supplied HTML references separate date/time variables. | All six using requested-time copy | Empty pickup line, including the observed “Requested pickup: ·” shape. | Use the single `requestedPickup` key and hide its entire block when absent. |
| **High** | App supplies `bookingReference` but no subject; user-provided sent-log screenshot shows subject ending with `—`. | Booking received (observed), potentially all six | Incomplete subject and no reference for recognition. | In each saved Brevo subject, use the verified `bookingReference` parameter and remove a dangling separator. |
| **Medium** | `serviceSummary`, `requestedPickup`, and several event-specific values are conditionally omitted. | All six | If template always renders labels, customers see empty labels/rows. | Use Brevo conditional blocks or remove the whole row when key is absent; test missing-value rendering. |
| **Medium** | `headerImageUrl` is dynamically built; old sent message URL was unavailable. Current four production paths return HTTP 200. | All six | Image rendering may differ by old/current deployment URL or email-client image proxy. | Verify the actual saved template’s `src` binding and inspect a controlled recipient’s original HTML; keep essential live copy. |
| **Medium** | `customerName` is customer-entered and service titles are dynamically passed; `collapse()` normalizes whitespace but does not HTML-escape. Brevo auto-escaping/filter behavior was not verified. | All six | Potential HTML-context rendering risk if the template engine does not escape values for HTML. | Confirm Brevo NTL auto-escaping rules; use the documented escaping method for HTML/text/URL contexts and test hostile-looking values with a mock/render preview. |
| **Medium** | Code passes a UUID `headers.idempotencyKey`, and code comments claim a provider 30-minute window; official send-doc page inspected does not establish that behavior. | All six on ambiguous retries | Duplicate acceptance semantics may be overstated if Brevo’s current API does not support the claim as implemented. | Verify against authoritative Brevo API docs/support; retain the explicit at-least-once caveat until verified. |
| **Medium** | Post-commit dispatch is best-effort; no scheduler configuration exists in this repository. | All six | A missed `after()` invocation can leave a row queued without automatic recovery. | Configure and verify a protected production scheduler; don’t describe retries as automatic until it is active. |
| **Low** | `booking-confirmed.png` contains text indicating scheduled and confirmed, while `scheduled` is a distinct state. | Confirmed | Image can imply the scheduled lifecycle state earlier than the status itself, despite agreed appointment data. | Owner review of the static image wording; rely on live status text and agreed appointment as authoritative. |
| **Low** | Customer templates use static image text and the general header is not event-specific. | Received/completed/cancelled | Header can be generic or repeat/mismatch live heading. | Ensure live text carries event and reference; use the correct alt string and avoid relying on image words. |

## H. Authoritative template specification

This is a **draft specification**, not a report of saved Brevo account content. All `{{ params.* }}` expressions below use keys established in source. Verify actual New Template Language syntax/rendering in Brevo’s editor before publication. Actual numeric IDs remain unknown and must be obtained from the account.

### Shared rules for all six

- Include a visible booking reference using `{{ params.bookingReference }}`.
- Use `{{ params.customerName }}` for greeting, guarded with a friendly no-name fallback if blank.
- Use `{{ params.bookingStatus }}` or clear event-specific live copy. Do not infer status from a user-supplied value.
- Display `{{ params.serviceSummary }}` and `{{ params.requestedPickup }}` only when present; do not render empty labels.
- Use `{{ params.headerImageUrl }}` as the image source and `{{ params.headerImageAlt }}` as alt text. The image must not be the only expression of event meaning.
- Use `{{ params.contactUrl }}` for the CTA destination. It is the only contact link in the app’s template parameter contract. Do not reference `SUPPORT_EMAIL` or `whatsappUrl`.
- Verified phone in existing application public contact config: `059 522 4280`. No support-email value is supplied by the email code. Only use an email footer address if the owner separately confirms it as public support contact.
- The proposed subjects/previews below are authored specifications, not current subjects/previews. Brevo currently owns these fields; the app does not override them.

### 1. Booking request received

| Item | Specification |
| --- | --- |
| Template name / ID | Booking received / runtime `BREVO_TEMPLATE_BOOKING_RECEIVED_ID`; actual numeric ID unknown |
| Subject | `Booking request received — {{ params.bookingReference }} \| 2nd Wave Laundry` |
| Preview | `We’ve received request {{ params.bookingReference }}. It is pending confirmation.` |
| Header | `{{ params.headerImageUrl }}` resolves to `https://2ndwave.vercel.app/headers/general-booking.png` for current production origin; alt is the app constant `2nd Wave Laundry booking request received`. |
| Required / optional body values | Always keys: `customerName`, `bookingReference`, `bookingStatus`, `websiteUrl`, `contactUrl`, `privacyUrl`, `headerImageUrl`, `headerImageAlt`; guard empty customer name. Optional: `serviceSummary`, `requestedPickup`. |
| Omit when absent | Entire services or requested pickup rows. Never show branch/agreement/fee row for this event. |
| CTA / footer | Contact page at `{{ params.contactUrl }}`; public phone `059 522 4280` if desired. No dynamic support email. |
| Status copy | “We’ve received your request. It is pending confirmation. Your booking is not confirmed until our team agrees the arrangements.” |
| Event | `booking_created`; pending insert trigger; email skipped when no valid customer email. |

### 2. Booking confirmed

| Item | Specification |
| --- | --- |
| Template name / ID | Booking confirmed / runtime `BREVO_TEMPLATE_BOOKING_CONFIRMED_ID`; actual numeric ID unknown |
| Subject | `Booking confirmed — {{ params.bookingReference }} \| 2nd Wave Laundry` |
| Preview | `Booking {{ params.bookingReference }} is confirmed. Review your agreed arrangements.` |
| Header | `https://2ndwave.vercel.app/headers/booking-confirmed.png` for current production; app alt `2nd Wave Laundry booking confirmed`. |
| Required / optional body values | Common keys; optional `serviceSummary`, `requestedPickup`; conditional confirmed-only `agreedPickup`, `branchName`, `confirmedFee`. Clearly distinguish requested pickup from agreed pickup. |
| Omit when absent | Hide each absent agreed detail, not just the value. No refund/payment line. |
| CTA / footer | `{{ params.contactUrl }}`; public phone optional. |
| Status copy | Confirmed only after the database confirmation gate and transaction commit. State only persisted agreed branch, pickup and fee. |
| Event | `booking_confirmed`; committed transition to confirmed. |

### 3. Processing started

| Item | Specification |
| --- | --- |
| Template name / ID | Processing started / runtime `BREVO_TEMPLATE_PROCESSING_STARTED_ID`; actual numeric ID unknown |
| Subject | `Processing started — {{ params.bookingReference }} \| 2nd Wave Laundry` |
| Preview | `We’ve started processing booking {{ params.bookingReference }}.` |
| Header | `https://2ndwave.vercel.app/headers/processing-started.png`; app alt `2nd Wave Laundry processing started`. |
| Required / optional body values | Common keys; optional `serviceSummary`, `requestedPickup`, `branchName`. |
| Omit when absent | Hide absent service/pickup/branch rows. No promised finish time. |
| CTA / footer | `{{ params.contactUrl }}`; public phone optional. |
| Status copy | “Processing has started.” Do not promise a completion time. |
| Event | `booking_processing_started`; committed transition to processing. |

### 4. Laundry ready

| Item | Specification |
| --- | --- |
| Template name / ID | Laundry ready / runtime `BREVO_TEMPLATE_LAUNDRY_READY_ID`; actual numeric ID unknown |
| Subject | `Your laundry is ready — {{ params.bookingReference }} \| 2nd Wave Laundry` |
| Preview | `Booking {{ params.bookingReference }} is ready for the next step.` |
| Header | `https://2ndwave.vercel.app/headers/laundry-ready.png`; app alt `2nd Wave Laundry ready for collection or delivery`. |
| Required / optional body values | Common keys; optional `serviceSummary`, `requestedPickup`, `branchName`. |
| Omit when absent | No collection/delivery instructions or pickup appointment unless a booking-specific arrangement is added to the app contract. |
| CTA / footer | `{{ params.contactUrl }}`; public phone optional. |
| Status copy | “Your laundry is ready for the next step.” Do not say “out for delivery” or invent collection instructions. |
| Event | `booking_ready`; committed transition to ready. |

### 5. Booking completed

| Item | Specification |
| --- | --- |
| Template name / ID | Booking completed / runtime `BREVO_TEMPLATE_BOOKING_COMPLETED_ID`; actual numeric ID unknown |
| Subject | `Booking completed — {{ params.bookingReference }} \| 2nd Wave Laundry` |
| Preview | `Booking {{ params.bookingReference }} has been completed.` |
| Header | `https://2ndwave.vercel.app/headers/general-booking.png`; app alt `2nd Wave Laundry booking completed`. |
| Required / optional body values | Common keys; optional `serviceSummary`, `requestedPickup`. |
| Omit when absent | No branch, payment, refund or completion-date claim. |
| CTA / footer | `{{ params.contactUrl }}`; public phone optional. |
| Status copy | “Booking completed.” No payment/refund promise. |
| Event | `booking_completed`; committed transition from ready or out for delivery. |

### 6. Booking cancelled

| Item | Specification |
| --- | --- |
| Template name / ID | Booking cancelled / runtime `BREVO_TEMPLATE_BOOKING_CANCELLED_ID`; actual numeric ID unknown |
| Subject | `Booking cancelled — {{ params.bookingReference }} \| 2nd Wave Laundry` |
| Preview | `Booking {{ params.bookingReference }} has been cancelled.` |
| Header | `https://2ndwave.vercel.app/headers/general-booking.png`; app alt `2nd Wave Laundry booking cancelled`. |
| Required / optional body values | Common keys; optional `serviceSummary`, `requestedPickup`. |
| Omit when absent | Never reference cancellation reason, staff notes, refund or payment outcomes. |
| CTA / footer | `{{ params.contactUrl }}`; public phone optional. |
| Status copy | Neutral cancellation notice. Do not expose internal reason/commentary or promise a refund. |
| Event | `booking_cancelled`; committed permitted transition to cancelled. |

## I. App-contract versus Brevo-contract discrepancies

The **smallest maintainable correction belongs primarily in the six saved Brevo templates**, not in a second application payload:

1. Change the received template’s names to `customerName`, `bookingReference`, `serviceSummary`, and the single combined `requestedPickup`.
2. Remove `BRANCH_NAME` from booking received; only add `branchName` to templates for events where the app conditionally sends it.
3. Remove `SUPPORT_EMAIL` unless the owner approves and the application explicitly adds a support-email value. For now use the existing `contactUrl` and/or verified public phone.
4. Correct every subject to use the actual `bookingReference` key; remove dangling separators. Do not try to fix the subject in the app—the API request intentionally uses saved-template subject configuration.
5. Add conditional template blocks for optional parameters so entire labels and rows disappear when no value is sent.
6. Align each of the other five saved templates to its per-event parameter list in section C; do not assume the received template’s data is present on all later events.
7. Do not change the app merely to match the malformed uppercase variables. Change the application contract only if the business requires additional authoritative data such as first-name-only, separate requested date/time, support email, WhatsApp CTA, or booking-specific fulfilment arrangement. Such a change requires tests and a reviewed data source.

The received HTML’s copy correctly distinguishes a request from a confirmed booking, but its dynamic variable contract is mismatched. Its fixed WhatsApp/contact content is not currently supplied by the email payload. The general booking image has a generic priority/tagline rather than a request-received heading, so the live HTML must retain the accurate request-received heading and status copy.

## J. Verification plan (non-destructive)

1. Add/retain unit tests that call `buildBrevoTemplateParams` for every event and assert the exact key set, constants, casing and value formatting; test blank names and absent service/date/branch/agreement data.
2. Assert `requestedPickup` is a single string and that no `requestedPickupDate`, `requestedPickupTime`, `CUSTOMER_FIRST_NAME` or `SUPPORT_EMAIL` key is sent.
3. Test all six runtime environment mappings with fake test IDs only; assert production IDs are never hardcoded and duplicate/missing/invalid IDs fail before claim.
4. Use local fake-provider tests to inspect exact outgoing `templateId`/`params`, and verify the API request does not send inline `subject`, HTML or text when using `templateId`.
5. In a Brevo test/preview environment, bind each saved template to the contract and preview both a complete context and contexts with every optional value missing. Confirm there are no empty labels or dangling punctuation.
6. Preview subject and preheader independently for each event; ensure the reference appears with no empty suffix and no nonexistent variable.
7. Render all six templates in the Brevo test tool using safe fake booking values, including HTML-sensitive strings in customer name, and inspect HTML/text/plain-text alternatives, mobile layout, image-blocked view, links and escaping.
8. Confirm all four public header URLs return expected content type and dimensions from a fresh external request, then verify image rendering in an authorized test inbox. A public HTTP 200 alone does not prove a mail app displayed it.
9. Keep existing mocked database tests for creation, valid committed transitions, failed/rolled-back changes, missing email, public replay, lease ownership, concurrent claims, retries and booking failure isolation. Do not send to a real customer.
10. For one separately approved controlled live test, use a newly created test booking and an owner-controlled inbox. Check app outbox state, Brevo transactional log/message ID, inbox folders and authenticated webhook state separately. Avoid retrying an accepted send until provider logs are checked.

No test or live send was run during this audit. Existing `tests/email-delivery.test.ts` includes mocked coverage for configuration, mapping, parameter construction, API request shape, provider responses and worker behavior; it does not verify active Brevo saved-template HTML/subject rendering.

## K. Unverified items and required owner information

1. **Saved Brevo configuration:** actual six template names, numeric IDs, active subjects, preview/preheaders, saved HTML and text alternatives. The owner must inspect each saved template and confirm the ID mapping.
2. **Runtime parameter behavior:** actual Brevo New Template Language conditionals and auto-escaping for these saved templates. Verify in Brevo’s current editor/preview before relying on customer-entered values.
3. **Specific old missing image:** exact `headerImageUrl` in that message and the receiving client’s image-fetch result. Current production public paths all return HTTP 200; this does not prove an old email used that origin.
4. **Delivery outcome per message:** accepted by the API is not the same as mailbox delivery. A matching Brevo event/log or authenticated delivery webhook is needed to establish later state. The repository’s webhook code exists, but live webhook setup was not independently inspected.
5. **Automatic retry trigger:** no scheduler is configured in the repository. Hosting scheduler configuration and successful recurring invocation must be verified before calling recovery automatic.
6. **Provider idempotency claim:** the source sends `headers.idempotencyKey` and assumes Brevo duplicate codes/window; the official API page used here documents `templateId`, `params`, sender/to and `messageId`, but does not verify that idempotency behavior. Confirm that claim with current authoritative Brevo documentation/support before treating it as guaranteed.
7. **Public footer support email:** the application email contract does not contain one. The configured sender address visible in owner-provided evidence is not proof that it is the approved support contact.
8. **Per-booking fulfilment arrangement:** no collection/delivery mode is read into the email context, so event-specific delivery instructions cannot be verified or safely stated.
9. **Spam placement:** the supplied screenshot shows SPF/DKIM/DMARC pass for one message; the cause of another message’s spam placement is not established by source or this audit.

## Source and external references

### Repository evidence

- `src/app/api/bookings/route.ts:64-143`
- `src/lib/bookings/admin-actions.ts:165-233`
- `src/lib/bookings/lifecycle.ts:22-88`
- `src/lib/email/config.ts:13-30,85-201`
- `src/lib/email/dispatch.ts:1-70`
- `src/lib/email/templates.ts:1-180`
- `src/lib/email/outbox-repository.ts:1-240`
- `src/lib/email/worker.ts:1-330`
- `src/lib/email/brevo.ts:1-220`
- `src/app/api/internal/email/worker/route.ts:1-100`
- `supabase/migrations/20261011130000_booking_schema.sql:32-42,285-319`
- `supabase/migrations/20261011130200_booking_functions.sql:300-415,851-988`
- `supabase/migrations/20261019120000_email_outbox.sql:1-180,339-518`
- `supabase/migrations/20261019130000_email_delivery.sql:1-80,139-468`
- `supabase/migrations/20261019140000_email_monitoring.sql:1-138`
- `tests/email-delivery.test.ts:1-830`
- `src/lib/content.ts:23-29`
- `public/headers/general-booking.png`
- `public/headers/booking-confirmed.png`
- `public/headers/processing-started.png`
- `public/headers/laundry-ready.png`

### Brevo documentation checked

- [Send a transactional email](https://developers.brevo.com/docs/send-a-transactional-email) — confirms the transactional send endpoint contract supports saved `templateId` and dynamic `params`, and describes a `messageId` response. This audit did not use it to claim unverified saved-template HTML, subject, conditional syntax, auto-escaping or idempotency behavior.

