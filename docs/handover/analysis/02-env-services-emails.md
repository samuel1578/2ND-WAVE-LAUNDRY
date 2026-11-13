# Handover analysis 02 — Environment variables, third-party services, Brevo templates

Snapshot taken 2026-11-13 at commit `f5940bc`. This was a read-only investigation. **No secret values appear in this document.** The developer machine's `.env.local` was inspected for variable **names** only; where a yes/no fact about a value matters (for example "is set"), it is stated without the value. A companion file, [`env.example.proposed`](./env.example.proposed), lists every variable with placeholder values.

Related: [01-repo-stack-localdev.md](./01-repo-stack-localdev.md) (§7 covers the local-dev risk of real email and production data).

---

## 1. Environment variable inventory

**How variables are read.** Most variables are read directly with `process.env.NAME`. Others go through a constant holding the name plus `env[CONSTANT]`, with `env` defaulting to `process.env`. These are in `src/lib/email/config.ts:26-86`, `src/lib/bookings/config.ts:15`, `src/lib/bookings/notice.ts:25`, `src/lib/newsletter/config.ts:12`, `src/lib/reviews/config.ts:7`, `src/lib/security/booking-rate-limit.ts:45`, `src/lib/supabase/config.ts:8-9` and `src/lib/supabase/admin.ts:26-27`. Both patterns were searched.

**Column key.** *Exposure*: `client` means the name starts with `NEXT_PUBLIC_` and is inlined into the browser bundle; `server` means server-only. *Vercel envs*: **recommended** environments based on what the code does. Actual Vercel settings are not visible from the repo (see Unknowns).

### Supabase

| Variable | Used in | Exposure | Required? / behaviour if missing | Format | Source dashboard | Vercel envs |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase/config.ts:44`, `next.config.ts:2`, `scripts/cleanup-stuck-staff-invites.mjs:12` | client | Required for any live data. Missing or non-`https://` → `supabaseConfig.ok=false`, admin auth "not configured", backend `unconfigured` (`src/lib/features.ts`). Also sets `images.remotePatterns` at build time | `https://<project-ref>.supabase.co` (must be https: `config.ts` regex) | Supabase → Project Settings → API | Prod, Preview, Dev |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `src/lib/supabase/config.ts:46` | client | Required with the URL. Missing → as above. ≥20 chars, no whitespace | `sb_publishable_…` | Supabase → API keys | Prod, Preview, Dev |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/lib/supabase/config.ts:47` | client | Optional legacy fallback, used only when the publishable key is unset | legacy anon JWT `eyJ…` | Supabase → API keys (legacy) | Only if not using the publishable key |
| `SUPABASE_SECRET_KEY` | `src/lib/supabase/admin.ts:56`, `src/app/api/bookings/route.ts:113`, `src/app/api/bookings/photo/route.ts:201`, `scripts/cleanup-stuck-staff-invites.mjs:13` | server | Required for bookings, enquiries, newsletter, reviews, CMS writes, staff invites and email outbox. Missing → `isElevatedConfigured=false`, so those paths report not configured. Must start with `sb_secret_` or `eyJ` (`admin.ts`) | `sb_secret_…` | Supabase → API keys (secret) | Prod, Preview (only with a non-prod project), Dev |
| `SUPABASE_SERVICE_ROLE_KEY` | same files as above (`admin.ts:55`) | server | Optional legacy fallback; `SUPABASE_SECRET_KEY` wins when both are set | legacy service-role JWT `eyJ…` | Supabase → API keys (legacy) | Only if not using the secret key |

### Site and runtime

| Variable | Used in | Exposure | Required? / behaviour if missing | Format | Source | Vercel envs |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `src/lib/site.ts:15`, plus origin checks in `src/lib/admin/staff-actions.ts:94,127,195`, `src/lib/auth/actions.ts:71`, `src/lib/bookings/admin-actions.ts:97`, `src/lib/email/recipient-actions.ts:77`, `src/lib/enquiries/admin-actions.ts:16`, `src/lib/reviews/actions.ts:109`, `src/app/api/enquiries/route.ts:56`, `src/app/api/admin/email-delivery/{test,[id]/resend,[id]/retry}/route.ts` | client | Optional. `site.ts` **ignores any value other than `https://www.2ndwavelaundry.com`** and falls back to that origin. In origin checks it is one extra allowed host (`src/lib/security/request-origin.ts`) | `https://www.2ndwavelaundry.com` | — | Prod (Preview/Dev optional) |
| `SITE_URL` | `src/lib/email/config.ts:32,192` (**the origin for every link in every email**), plus origin checks in `src/app/api/{bookings,bookings/photo,newsletter-interest,reviews}/route.ts`, `src/app/api/admin/{promotion-image,website-media}/route.ts`, `src/lib/website/actions.ts:46` and the files listed for `NEXT_PUBLIC_SITE_URL` | server | **Required for email.** Missing → `missing-site-url` and no email is sent. Must be an `https` origin with no path (`http` is allowed only for localhost) (`readSiteUrl`, `config.ts`) | `https://www.2ndwavelaundry.com` | — | Prod, Preview, Dev |
| `NEXT_PUBLIC_DEMO_MODE` | `src/lib/demo-mode.ts:14` | client | Optional. **Demo mode is ON unless the value is exactly `false`** | `true` / `false` | — | Prod: `false`; Preview/Dev as needed |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | `src/lib/site.ts:81` | client | Optional; omitted from metadata when unset | token string | Google Search Console | Prod |
| `NEXT_PUBLIC_BING_SITE_VERIFICATION` | `src/lib/site.ts:82` | client | Optional; omitted when unset | token string | Bing Webmaster Tools | Prod |
| `WEBSITE_CONTENT_WRITES_DISABLED` | `src/lib/website/write-guard.ts:23` | server | Optional kill switch: `true` → CMS writes return 503 | `true` / unset | — | any (emergency only) |
| `VERCEL_ENV` | `next.config.ts:14`, `src/proxy.ts:32` | server (build + runtime) | Set by the platform. `preview` → noindex header; `production` → canonical-host redirects | set by Vercel | Vercel (automatic) | automatic |
| `VERCEL_GIT_COMMIT_SHA` | `src/lib/website/write-guard.ts:20` | server | Logging only; shows "unknown" when unset | set by Vercel | Vercel (automatic) | automatic |
| `NODE_ENV` | `src/lib/newsletter/rate-limit.ts:96`, `src/lib/reviews/rate-limit.ts:95` | server | Set by Next. Blocks the `memory` rate-limit mode in production for newsletter and reviews | set by Next | — | automatic |

### Feature gates and rate limits

| Variable | Used in | Exposure | Required? / behaviour if missing | Format | Vercel envs |
|---|---|---|---|---|---|
| `BOOKING_SUBMISSIONS_ENABLED` | `src/lib/bookings/config.ts:15-20` | server | Fail-closed: anything except `true` → public bookings and photo uploads are disabled | `true` / `false` | Prod (`true` when live) |
| `BOOKING_RATE_LIMIT_MODE` | `src/lib/security/booking-rate-limit.ts:45,192,200` | server | Optional. `memory` / `database` force a mode; unset → `database` outside demo mode. **`memory` is accepted even in production** | `database` / `memory` / unset | Prod: `database` or unset |
| `BOOKING_PRIVACY_NOTICE_VERSION` | `src/lib/bookings/notice.ts:25-44` | server | Optional. Unset or invalid → stored as `null` (no fabricated version) | `2026-10-01` style, 1–60 chars `[A-Za-z0-9._-]` | Prod |
| `NEWSLETTER_INTEREST_ENABLED` | `src/lib/newsletter/config.ts:27` | server | Fail-closed: only `true`/`1`/`yes` enable it | `true` / `false` | Prod when live |
| `NEWSLETTER_RATE_LIMIT_MODE` | `src/lib/newsletter/config.ts:12`, `src/lib/newsletter/rate-limit.ts:95` | server | Optional; `memory` is ignored in production | `database` / `memory` / unset | Dev only |
| `REVIEW_RATE_LIMIT_MODE` | `src/lib/reviews/config.ts:7`, `src/lib/reviews/rate-limit.ts:94` | server | Optional; `memory` is ignored in production | `database` / `memory` / unset | Dev only |

### Email (Brevo and worker)

| Variable | Used in | Exposure | Required? / behaviour if missing | Format | Source dashboard | Vercel envs |
|---|---|---|---|---|---|---|
| `TRANSACTIONAL_EMAILS_ENABLED` | `src/lib/email/config.ts:26,116,307` | server | Fail-closed: anything except `true` → no email is sent and dispatch logs "skipped" (`src/lib/email/dispatch.ts`) | `true` / `false` | — | Prod `true`; Preview/Dev `false` unless deliberately testing |
| `BREVO_API_KEY` | `src/lib/email/config.ts:27,119-122` | server | Required when emails are enabled. 20–512 chars, no whitespace | `xkeysib-…` | Brevo → SMTP & API → API keys | Prod (others only if testing) |
| `EMAIL_WORKER_SECRET` | `src/lib/email/config.ts:28,202-206,547` | server | **Required when emails are enabled**: missing or <32 chars → email disabled (`missing-worker-secret`). Also a Bearer token for `/api/internal/email/worker` | random string, ≥32 chars | self-generated | Prod |
| `CRON_SECRET` | `src/lib/email/config.ts:29,295-297`, `src/app/api/internal/email/worker/route.ts:39` | server | Optional, but Vercel Cron sends it as `Authorization: Bearer`. Without it or `EMAIL_WORKER_SECRET` the worker returns 503; a weak value (<32 chars) is rejected | random string, ≥32 chars | self-generated; Vercel Cron uses it automatically | Prod |
| `BREVO_WEBHOOK_SECRET` | `src/lib/email/config.ts:30,531-534`, `src/app/api/webhooks/brevo/route.ts:35` | server | Optional; missing or <32 chars → webhook returns 503 and delivery events are not recorded | random string, ≥32 chars | self-generated; also entered in Brevo → Webhooks | Prod |
| `EMAIL_TEST_RECIPIENT` | `src/lib/email/config.ts:31-43`, `src/app/api/admin/email-delivery/test/route.ts:99` | server | Optional; missing → the admin "send test" button returns 503 | email address | — | Prod / Preview |
| `BREVO_TEMPLATE_BOOKING_RECEIVED_ID` | `src/lib/email/config.ts:47` | server | **Required when emails are enabled.** Any of the 6 customer IDs missing, invalid or duplicated → *all* email disabled (`readTransactionalEmailConfig`) | positive integer, unique | Brevo → Templates | Prod |
| `BREVO_TEMPLATE_BOOKING_CONFIRMED_ID` | `config.ts:48` | server | as above | positive integer | Brevo | Prod |
| `BREVO_TEMPLATE_PROCESSING_STARTED_ID` | `config.ts:49` | server | as above | positive integer | Brevo | Prod |
| `BREVO_TEMPLATE_LAUNDRY_READY_ID` | `config.ts:50` | server | as above | positive integer | Brevo | Prod |
| `BREVO_TEMPLATE_BOOKING_COMPLETED_ID` | `config.ts:51` | server | as above | positive integer | Brevo | Prod |
| `BREVO_TEMPLATE_BOOKING_CANCELLED_ID` | `config.ts:52` | server | as above | positive integer | Brevo | Prod |
| `BREVO_TEMPLATE_STAFF_ORDER_PENDING_ID` | `config.ts:61` | server | Optional group. One missing or invalid → **all 5** staff alerts stay queued or retryable; customer email continues (`readDeliveryTemplateIds`, `config.ts:470-506`) | positive integer | Brevo | Prod |
| `BREVO_TEMPLATE_STAFF_ORDER_PROCESSING_ID` | `config.ts:62` | server | as above | positive integer | Brevo | Prod |
| `BREVO_TEMPLATE_STAFF_ORDER_READY_ID` | `config.ts:63` | server | as above | positive integer | Brevo | Prod |
| `BREVO_TEMPLATE_STAFF_ORDER_COMPLETED_ID` | `config.ts:64` | server | as above | positive integer | Brevo | Prod |
| `BREVO_TEMPLATE_STAFF_ORDER_CANCELLED_ID` | `config.ts:65` | server | as above | positive integer | Brevo | Prod |
| `BREVO_TEMPLATE_NEWSLETTER_INTEREST_ID` | `config.ts:77` | server | Optional; missing → newsletter alerts are not delivered | positive integer | Brevo | Prod |
| `BREVO_TEMPLATE_ENQUIRY_RECEIVED_ID` | `config.ts:80` | server | Optional; missing → enquiry alerts are not delivered | positive integer | Brevo | Prod |

### Script-only

| Variable | Used in | Behaviour |
|---|---|---|
| `STAFF_CLEANUP_ACTOR_ID` | `scripts/cleanup-stuck-staff-invites.mjs:14` | Required only with `--apply`. It is the auth user id recorded as the actor. Also needs `NEXT_PUBLIC_SUPABASE_URL` and the secret key |

`vercel.json` defines **no** `env` or `build.env` keys. It contains only the cron entry (`vercel.json`).

## 2. Comparison with `.env.example`

`.env.example` exists; there is no `.env.local.example`. It has 4 active lines and documents everything else as commented-out entries. `.env.local` (names only) was also compared.

- **Missing from `.env.example`:**
  - `BREVO_TEMPLATE_NEWSLETTER_INTEREST_ID`: read by `src/lib/email/config.ts:77`, set in `.env.local`, not documented.
  - `NEWSLETTER_RATE_LIMIT_MODE`: read by `src/lib/newsletter/config.ts:12`, not documented.
  - `STAFF_CLEANUP_ACTOR_ID`: script-only, not documented.
- **Stale in `.env.example`** (documented but read by no code in `src/`, `scripts/`, `next.config.ts` or `vercel.json`):
  - `REVIEW_SUBMISSIONS_ENABLED`: reviews are hard-coded on (`enabled: true` in `src/lib/reviews/config.ts:12-19`).
  - `REVIEW_NOTICE_VERSION`: the version is the constant `reviewConsentVersion = "2026-10-26"` (`src/lib/reviews/config.ts:9`).
- **Unused names in `.env.local`:** `BREVO_SENDER_EMAIL` and `BREVO_SENDER_NAME` are not read anywhere. The sender comes from each Brevo template (`src/lib/email/brevo.ts:118`).
- **`.env.local` `SITE_URL` is not the production origin.** Because email links are built from `SITE_URL` (`src/lib/email/config.ts:192`), emails sent from this machine link to that origin. That includes `viewOrderUrl` and `enquiryUrl` in staff alerts.
- **Misleading message:** `config.ts:458` says "set all six server-only BREVO_TEMPLATE_*_ID variables". That is accurate for the customer group only; 13 IDs exist in total.
- `NEXT_PUBLIC_DEMO_MODE` defaults to `true` in `.env.example`, which is the safe default for a fresh clone.

## 3. Security findings

- ✅ **No secret is exposed to the client.** No `NEXT_PUBLIC_*` variable holds a secret. No file starting with `"use client"` reads `process.env` or imports `@/lib/supabase/admin`, `@/lib/email/config` or `@/lib/email/brevo` (search across `src/`).
- ✅ **Elevated Supabase client is guarded.** `src/lib/supabase/admin.ts` has `import "server-only"`, so a build fails if a client bundle imports it. Its 30 importers are route handlers, server actions, server libs and the server component `src/components/public-pages.tsx`.
- ✅ **No hard-coded secrets in tracked files.** The search covered Brevo (`xkeysib-`/`xsmtpsib-`), Supabase (`sb_secret_`, `sb_publishable_`, JWT `eyJ…`), Stripe, AWS, GitHub tokens and PEM private keys. The only hits are obvious fake fixtures in `tests/auth.test.ts:119` (`sb_secret_…`, redacted) and `tests/auth.test.ts:141,146` (`sb_publishable_…`, redacted). No Supabase project hostname is committed.
- ✅ `vercel.json` has no `env` / `build.env` entries.
- ⚠️ **Hardening gap:** `src/lib/email/config.ts` (reads `BREVO_API_KEY` and secrets) and `src/lib/email/brevo.ts` lack `import "server-only"`. They are server-only only by convention; `config.ts` says "Import it only from server code". They are safe today because no client file imports them.
- ⚠️ **Key reuse:** the Supabase secret key also signs the short-lived booking-photo upload token (`photoTokenSecret`, `src/app/api/bookings/route.ts:112-116`, `src/app/api/bookings/photo/route.ts:201`). Rotating the Supabase key therefore also invalidates in-flight photo tokens. A dedicated signing secret would decouple them.
- ⚠️ **`BOOKING_RATE_LIMIT_MODE=memory` is honoured in production** (`src/lib/security/booking-rate-limit.ts:192-196`). Newsletter and reviews block `memory` when `NODE_ENV=production`; bookings do not. On serverless hosts, in-memory limits are per instance and weak.
- ⚠️ **Personal data in a committed script:** `scripts/cleanup-stuck-staff-invites.mjs:5-9` hard-codes three staff email addresses. These are PII, not secrets.
- ℹ️ **Hard-coded recipient:** newsletter alerts go to `manager@2ndwavelaundry.com` (`src/lib/newsletter/config.ts:19`). This is deliberate; it is not an env var.
- ℹ️ **Correction to doc 01 §3:** `sanitize-html` is imported only by `src/lib/email/manual.ts`, and **nothing imports `manual.ts`** (search across `src/` and `tests/`; its header says "The in-app composer has been retired"). `sanitize-html` and `@types/sanitize-html` are therefore effectively unused at runtime.

## 4. Proposed `.env.example`

See [`env.example.proposed`](./env.example.proposed). It lists every variable from §1, grouped by service, with a one-line comment and placeholder values only. It drops the two stale review variables and adds the missing ones.

## 5. Third-party services

| Service | Purpose | Where in code | If it is down |
|---|---|---|---|
| **Supabase: Postgres + Data API** | Bookings, enquiries, reviews, newsletter interest, CMS content, admin profiles, email outbox, rate-limit buckets | `src/lib/supabase/*.ts` and repositories under `src/lib/{bookings,enquiries,reviews,newsletter,website,email}/` | Forms fail closed (bookings `unavailable`). Admin console has no data. Public CMS reads fail; `src/app/sitemap.ts` falls back to built-in services, but fallback for other pages was not verified. Rate limiters in `database` mode fail closed |
| **Supabase: Auth** | Admin sign-in, password reset, invites, email-link confirmation | `src/lib/auth/actions.ts:94,160`, `src/lib/admin/staff-service.ts:247`, `src/app/auth/confirm/route.ts`, `src/app/admin/auth/callback/route.ts`, `src/proxy.ts` | No admin access. Invite and reset emails are sent by Supabase's mailer, not Brevo |
| **Supabase: Storage** | `booking-photos` (private customer photos), `marketing-assets` (public CMS images) | `src/lib/bookings/photos.ts:19`, `src/lib/website/repository.ts:61`, `src/lib/website/promotion-image.ts:3`, `src/app/api/admin/website-media/route.ts:18`, `next.config.ts` `remotePatterns` | Photo upload/view fails; CMS images break |
| **Brevo: transactional API** | All 13 notification emails (`POST https://api.brevo.com/v3/smtp/email`, `templateId` + `params`) | `src/lib/email/brevo.ts:21`, `dispatch.ts`, `worker.ts` | Bookings still succeed (dispatch swallows errors). Outbox rows retry, then dead-letter (`supabase/README.md`) |
| **Brevo: webhooks** | Delivery events (delivered, bounced, …) into `email_delivery_events` | `src/app/api/webhooks/brevo/route.ts`, `src/lib/email/webhook.ts` | The admin Email Delivery page lacks delivery status; sending is unaffected |
| **Vercel** | Hosting, the daily cron calling `/api/internal/email/worker` at `0 0 * * *`, `VERCEL_ENV` | `vercel.json`, `next.config.ts:14`, `src/proxy.ts:32` | Site down. Without the cron, failed or queued emails drain only when a new event triggers dispatch |
| **Google Fonts (site)** | `Boogaloo` via `next/font/google` (also a local font via `next/font/local`) | `src/app/layout.tsx:2-3` | Fetched during build. The runtime dependency was not verified (no build was run) |
| **Google Fonts (emails)** | Lato stylesheet `fonts.googleapis.com` in every draft | `docs/emails/**/*.html` `<link>` tags | Email clients fall back to Arial/Helvetica (`font-family` stacks in the drafts) |
| **Production site as an email image host** | Header images `https://www.2ndwavelaundry.com/headers/*` and logo `/images/logo.png` | `docs/emails/**/*.html`, `public/headers/`, `public/images/logo.png` | Images missing from every email |
| **WhatsApp (`wa.me`)** | Click-to-chat links for the public site and admin booking detail | `src/lib/content.ts:28`, `src/lib/contact-links.ts:62`, `src/components/admin/bookings.tsx:643,1553` | Links fail; no runtime dependency |
| **Google Maps share links** | Branch map link (no embed or iframe exists in `src/`) | `src/lib/site.ts:55`, `src/lib/content.ts:194`, `src/lib/seo/schema.ts:121`; allow-list `maps.app.goo.gl`/`maps.google.com` in `src/lib/rules.ts:99-100` | Link fails only |
| **Instagram / TikTok / Facebook** | Social profile links; Facebook appears only in admin settings | `src/lib/site.ts:47-50`, `src/lib/content.ts`, `src/components/admin/settings.tsx` | Link fails only |
| **`tel:` / `mailto:`** | Phone and email links | `src/lib/content.ts`, `src/lib/rules.ts:161-169`, `src/components/shell.tsx:443`, `src/components/public-pages.tsx:742,797` | n/a |
| **Search engines** | Optional site verification tokens | `src/lib/site.ts:81-82` | n/a |
| **Analytics** | None found: no `gtag`, Google Tag Manager, `@vercel/analytics` or `<Script>` in `src/` | — | — |
| **GitHub** | Source hosting `samuel1578/2ND-WAVE-LAUNDRY` | git remote | Deploys stop if Vercel builds from Git (not verified) |

## 6. Brevo template map

**Mechanics shared by all templates**
- **Enqueue.** Database functions insert rows into `public.email_outbox` in the same transaction as the business change (`supabase/README.md`; the latest definitions are in `supabase/migrations/20261110120000_preferred_pickup_notifications.sql`).
- **Send.** `after(() => dispatchPendingEmails(...))` sends a small batch (3) straight after the request. The worker endpoint (`/api/internal/email/worker`, daily cron) drains the rest (`src/lib/email/dispatch.ts`).
- **Payload to Brevo.** Only `to`, `templateId` and `params` are sent (`src/lib/email/brevo.ts:155-157`).
- **Sender name/email, subject and preview text are configured in each saved Brevo template**, not in code or env (`brevo.ts:118`; the header comments in `docs/emails/*.html`).
- **Param validation.** Params are checked against `EMAIL_TEMPLATE_PARAM_CONTRACTS` before sending (`src/lib/email/templates.ts:79-136`). Missing required or unexpected keys are rejected.
- **URL params.** `websiteUrl`, `contactUrl` and `privacyUrl` are built from `SITE_URL` (`templates.ts:331-333, 476-478, 564-566`). `viewOrderUrl = ${SITE_URL}/admin/bookings/<bookingId>` (`templates.ts:481`). `enquiryUrl = ${SITE_URL}/admin/enquiries/<enquiryId>` (`templates.ts:593`).
- **Test sends.** The admin "send test" route queues the chosen customer or staff template to `EMAIL_TEST_RECIPIENT`. Newsletter and enquiry templates cannot be tested this way (`src/app/api/admin/email-delivery/test/route.ts:95-99`).

| Code template → env var | Trigger | Recipient | Required params | Optional params | HTML draft |
|---|---|---|---|---|---|
| `booking_created` → `BREVO_TEMPLATE_BOOKING_RECEIVED_ID` | `POST /api/bookings` → `booking_submit` RPC (`src/lib/bookings/repository.ts:103`); status `pending` | Customer (booking email) | customerName, bookingReference, bookingStatus, websiteUrl, contactUrl, privacyUrl, headerImageUrl, headerImageAlt | serviceSummary, requestedPickup | `docs/emails/01-booking-received.html` |
| `booking_confirmed` → `BREVO_TEMPLATE_BOOKING_CONFIRMED_ID` | Admin `changeBookingStatus` → `booking_transition` (`repository.ts:141`) to `confirmed` | Customer | as above | serviceSummary, requestedPickup, agreedPickup, branchName, confirmedFee | `docs/emails/02-booking-confirmed.html` |
| `booking_processing_started` → `BREVO_TEMPLATE_PROCESSING_STARTED_ID` | Transition to `processing` | Customer | as above | serviceSummary, requestedPickup, branchName | `docs/emails/03-processing-started.html` |
| `booking_ready` → `BREVO_TEMPLATE_LAUNDRY_READY_ID` | Transition to `ready` | Customer | as above | serviceSummary, requestedPickup, branchName | `docs/emails/04-laundry-ready.html` |
| `booking_completed` → `BREVO_TEMPLATE_BOOKING_COMPLETED_ID` | Transition to `completed` | Customer | as above | serviceSummary, requestedPickup | `docs/emails/05-booking-completed.html` |
| `booking_cancelled` → `BREVO_TEMPLATE_BOOKING_CANCELLED_ID` | Transition to `cancelled` | Customer | as above | serviceSummary, requestedPickup | `docs/emails/06-booking-cancelled.html` |
| `staff_order_pending` → `BREVO_TEMPLATE_STAFF_ORDER_PENDING_ID` | New booking (`booking_submit`) | Staff: every enabled row in `public.booking_alert_recipients` (migration line 468) | customerName, bookingReference, bookingStatus, actorType, websiteUrl, contactUrl, privacyUrl, headerImageUrl, headerImageAlt, **viewOrderUrl** | serviceSummary, requestedPickup, branchName, eventAt, actorName, actorRole | `docs/emails/staff/01-order-pending.html` |
| `staff_order_processing` → `BREVO_TEMPLATE_STAFF_ORDER_PROCESSING_ID` | Transition to `processing` | Staff (same list) | as staff above | + previousStatus | `docs/emails/staff/02-order-processing.html` |
| `staff_order_ready` → `BREVO_TEMPLATE_STAFF_ORDER_READY_ID` | Transition to `ready` | Staff | as staff above | + previousStatus | `docs/emails/staff/03-order-ready.html` |
| `staff_order_completed` → `BREVO_TEMPLATE_STAFF_ORDER_COMPLETED_ID` | Transition to `completed` | Staff | as staff above | + previousStatus | `docs/emails/staff/04-order-completed.html` |
| `staff_order_cancelled` → `BREVO_TEMPLATE_STAFF_ORDER_CANCELLED_ID` | Transition to `cancelled` | Staff | as staff above | + previousStatus, cancellationReason | `docs/emails/staff/05-order-cancelled.html` |
| `newsletter_interest_received` → `BREVO_TEMPLATE_NEWSLETTER_INTEREST_ID` | `POST /api/newsletter-interest` → `newsletter_interest_submit` RPC (`src/lib/newsletter/repository.ts:47`) | Internal: hard-coded `manager@2ndwavelaundry.com` (`src/lib/newsletter/config.ts:19`, passed as `p_recipient_email`) | subscriberEmail, submittedAt, source, websiteUrl, contactUrl, privacyUrl, headerImageUrl, headerImageAlt | — | `docs/emails/newsletter/01-interest-received.html` |
| `enquiry_received` → `BREVO_TEMPLATE_ENQUIRY_RECEIVED_ID` | `POST /api/enquiries` → `enquiry_submit` RPC (`src/lib/enquiries/repository.ts:55`) | Staff: every enabled row in `public.booking_alert_recipients` (`supabase/migrations/20261103130000_enquiry_alert_recipients.sql:1-12,113`) | kind, name, business, phone, enquiryUrl, websiteUrl | topic (general enquiries only) | `docs/emails/enquiry-received.html` |

The status → template mappings are in `supabase/migrations/20261110120000_preferred_pickup_notifications.sql:227-232` (customer) and `:357-361` (staff). Statuses `scheduled`, `picked_up` and `out_for_delivery` send **no** email (`src/lib/email/templates.ts:27-31` comment; not present in the mappings).

**Code ↔ draft cross-check** (params extracted from `{{ params.* }}` in each draft):
- ✅ All 13 code templates have exactly one HTML draft, and there are no drafts without a code template.
- ✅ No draft uses a param that its contract does not produce, apart from the case below.
- ℹ️ `staff/01-order-pending.html` references `previousStatus`, which is not in the `staff_order_pending` contract. It sits inside `{% if params.previousStatus %}`, so it never renders. Harmless.
- ℹ️ Params sent but unused by the drafts, also harmless:
  - `headerImageUrl` and `headerImageAlt` in all 12 customer, staff and newsletter drafts; the header images are hard-coded per draft.
  - `privacyUrl` in the staff and newsletter drafts.
  - `requestedPickup` in customer drafts 03–06.
- ℹ️ The drafts are the only repo copy. Whether each saved Brevo template matches its draft cannot be verified from the repo.

---

## Unknowns — needs Samuel

1. Which variables are set in each Vercel environment (Production / Preview / Development)? Does Preview point at the production Supabase project and have `TRANSACTIONAL_EMAILS_ENABLED=true`?
2. Is `CRON_SECRET` set in Vercel Production, so the daily worker cron is authorised? Is `BREVO_WEBHOOK_SECRET` set, and is the webhook configured in Brevo to call `/api/webhooks/brevo` with that Bearer token?
3. The numeric IDs of the 13 saved Brevo templates, and whether each saved template's HTML matches its draft in `docs/emails/`.
4. Which sender name and email is set on each Brevo template, and is that sender domain-authenticated (SPF/DKIM/DMARC) in Brevo?
5. Who owns the Brevo account and which plan or daily-send quota applies? Is there a separate test account or sender?
6. Is Supabase Auth's email (invites, password reset) using Supabase's built-in mailer or custom SMTP, possibly Brevo SMTP? That is configured only in the Supabase dashboard.
7. Who are the current enabled rows in `public.booking_alert_recipients`? They receive both staff order alerts and enquiry alerts.
8. Should `manager@2ndwavelaundry.com` remain the hard-coded newsletter alert recipient (`src/lib/newsletter/config.ts:19`)?
9. What value should `BOOKING_PRIVACY_NOTICE_VERSION` have in production? Is it currently set (it is not set in `.env.local`)?
10. Were the legacy keys (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) ever set in Vercel? If so, and the project has moved to the new key system, should they be removed or rotated?
11. Are `REVIEW_SUBMISSIONS_ENABLED` and `REVIEW_NOTICE_VERSION` still set in Vercel? Code ignores them.
12. Has any Supabase or Brevo key ever been shared outside Vercel and this machine, for example in chat, email or a previous contractor's machine, so that it should be rotated during handover?
