# 2nd Wave Laundry Services — Final AI Technical PRD

Version 1.0 · 1 October 2026 · Implementation baseline

Companions: CONTENT.md (exact words), 2ND_WAVE_SRS.md (testable requirements), Design.md and accepted Stitch exports (visual intent). This replaces PRD v0.1. Product scope and architecture are finalised for implementation; named business configuration and policy dependencies remain explicit. This document is not production sign-off.

## 1. Product goal

Build a conversion-focused laundry WEBSITE for household and business customers. Visitors discover services, visit branches, request collection and communicate with staff. Two invited administrator roles manage content, private requests and enquiries: a Full Admin with access to the entire administration console, and an Operational Admin limited to bookings and reviews. Walk-ins/drop-offs must be as discoverable as pickup. Measure qualified saved requests, enquiries and branch-contact actions without collecting unnecessary personal analytics data.

Locale: British English; Africa/Accra scheduling; GHS for privately recorded fees. No customer account is necessary.

## 2. Fixed scope and source hierarchy

Latest explicit client/user decisions take precedence. SRS governs behaviour; this PRD governs scope and architecture; CONTENT.md governs exact words; Design.md governs visual system. If they disagree, reconcile before implementing the affected rule. Historical PDFs and earlier exports cannot override v1.0. The old client PDF's generic 11am collection-cutoff wording is obsolete.

### Public release

Home, Services, ten service detail routes plus Commercial Laundry, How It Works, Locations plus three branch pages, Gallery/lightbox, Blog/article, About, Contact/enquiry, FAQ, Book/form states/WhatsApp handoff, reviews/moderated submission, promotional placements/popup, newsletter interest section, approved policy pages, 404/error states.

### Private release

Invited admin auth/recovery, dashboard, booking queue/detail/history/notes/branch assignment/manual WhatsApp drafts, general/commercial enquiry queues, newsletter-interest records, media library, CMS for Home/About/services/locations/gallery/blog/FAQs/reviews/promotions/policies, public contact settings, pickup rules and booking pause.

### 2a. Administrator roles — formally authorised 10 October 2026

Two administrator roles are in scope. Both are invited accounts only; there is no public signup and no self-promotion path.

| Role | Key | Access |
| --- | --- | --- |
| Full Admin | `full_admin` | The entire administration dashboard: bookings, reviews (including emergency overrides), enquiries, newsletter, Website Content CMS, Media Library, settings, booking-alert recipient management, and any later email/composer/inbox/newsletter-campaign modules. |
| Operational Admin | `operational_admin` | Bookings and their permitted operational actions only; review moderation and review-reply drafting. No access to any other administration module. |

Full Admins additionally hold emergency override permissions over review moderation (approve, reject or edit), each requiring a recorded reason and producing an audit entry. Role data lives in an `admin_profiles` table keyed to the auth user; the role is always resolved server-side from the session and never trusted from the client. Enforcement occurs independently at the middleware, application-server and database (RLS) layers — navigation hiding alone is insufficient. Roles are provisioned only by a trusted workflow; no endpoint permits an admin to change any role value.

This supersedes the earlier single-invited-admin assumption. The SRS access-control matrix is updated accordingly.

**Sprint 1B status — 10 October 2026: role-based dashboard implemented (code complete — awaiting hosted configuration).** Full Admins retain every existing module; Operational Admins reach Bookings and Reviews only, enforced server-side per route, with role-filtered desktop and mobile navigation, role-specific landing pages (`/admin` versus `/admin/bookings`) and access-denied states. Business-data persistence is still not connected, so writes keep failing closed outside the isolated demo preview. Details: `docs/implementation/SPRINT_1B_ROLE_BASED_ADMIN.md`.

**Implementation status — Sprint 1A, 10 October 2026: code complete, awaiting hosted configuration.** Supabase Auth (email/password, cookie sessions, Supabase Auth recovery, invite-only provisioning by a trusted administrator) with server-side role resolution and RLS on `admin_profiles` is implemented; details, manual steps and remaining work are in `docs/implementation/SPRINT_1A_SUPABASE_AUTH.md`. Business data (bookings, enquiries, reviews, newsletter, media, settings) is still the in-memory demo store, and the Operational Admin console remains conservatively withheld until Sprint 1B delivers role-filtered routes. Role changes are performed only through a reviewed provisioning statement, never by an application endpoint.

### Excluded

Customer accounts, public tracking, online prices/payments, instant commercial quotes, automatic WhatsApp sends or delivery receipts, driver dispatch/live maps, rigid branch pickup zones, Google review scraping/API, native app navigation, unapproved service offerings. (Note: "extra staff roles" was removed from this excluded list on 10 October 2026 when the two-role admin model was formally authorised — see §2a.) Automated marketing campaigns/Brevo integration remain out of the original release scope and are authorised only as the later phases defined in `docs/investigations/ADMIN_OPERATIONS_EMAIL_ARCHITECTURE.md`.

## 3. Business facts and scheduling

| Branch | Telephone | Supplied opening information |
| --- | --- | --- |
| Ashaiman–Atadeka, Main | 059 522 4280 | Mon–Sat 7am–8pm; Sun 9am–7:30pm |
| Katamanso No. 1 | 059 814 8620 | 7am–8pm; days unspecified |
| Newland Katamanso | 024 614 4412 | 7am–8pm; days unspecified |

Main map: https://maps.app.goo.gl/MfrvXSLGNtUu22HL8?g_st=ic — user confirms main branch. Do not infer a street address/Tema label. Secondary maps/directions omitted until supplied. **Business domain confirmed 10 October 2026: `2ndwavelaundry.com`.** Individual mailbox names under that domain (for example `info@`) are not yet decided and must not be invented; enquiry@example.com in the client PDF remains illustrative only. Instagram https://www.instagram.com/2ndwave_laundry/; TikTok https://www.tiktok.com/@2ndwave.com. Facebook remains hidden pending validation.

### Collection rule — replaces previous interpretation

Pickup 7am–5pm every day including holidays. Default intent is earliest possible collection, usually same day, unless another date is requested. Requested date/time is preference, not reservation. Exact time-window inventory was not supplied: implement optional preferred clock time rather than invented fixed slots. Branch hours do not restrict the independently supplied pickup schedule.

11am cutoff applies ONLY when Express/Same-Day Laundry needs pickup for completion on the requested day. Ordinary collection requests after 11am remain eligible before pickup closes. Express after cutoff: retain inputs; suggest later date or contacting team, not a guaranteed same-day service. Public walk-ins may enquire about express availability after 11am; do not apply a pickup rule to drop-off.

Engineering boundary decision: accept express same-day submission at exactly 11:00:00 local time; after that reject same-day express eligibility. Today collection is allowed before 17:00; at/after 17:00 choose a later date or contact team. Eligibility uses server receipt time, with idempotent replay of a previously committed request exempt from a later cutoff recheck. Before 7am, requests may be saved for today's operation beginning at 7am. These boundary conventions are implementation choices, not additional service guarantees.

## 4. Service taxonomy and routes

| Title | Slug | Booking behaviour |
| --- | --- | --- |
| Wash, Ironing & Fold | wash-ironing-fold | Preselect service |
| Wash and Fold Only | wash-and-fold-only | Preselect service |
| Ironing | ironing | Preselect service |
| Shoe Care | shoe-care | Preselect service |
| Stain Treatment | stain-treatment | Preselect service |
| Duvet & Bedding Cleaning | duvet-and-bedding-cleaning | Preselect service |
| Curtain Cleaning | curtain-cleaning | Preselect service |
| Suit Cleaning | suit-cleaning | Preselect service |
| Express/Same-Day Laundry | express-same-day-laundry | Preselect service and apply express rules |
| Pickup & Delivery | pickup-and-delivery | Open booking; choose laundry services |
| Commercial Laundry | commercial-laundry | Commercial quote journey |

Commercial route /commercial-laundry; quote /commercial-laundry/quote. Other detail routes /services/[slug]. No duplicate public Commercial page under /services; redirect if needed. Public /faq, /privacy, /terms, /laundry-care-terms are canonical. Pickup & Delivery is fulfilment information, not a selectable laundry item category. Express can accompany other chosen services. No rigid exclusions based only on category if other services are chosen; show Wash, Ironing & Fold eligibility guidance and staff assess individual items.

## 5. Stack and architecture

Next.js App Router, React, TypeScript, Tailwind using the approved design tokens; Motion/Framer Motion for restrained transitions. Supabase Postgres/Auth for records and one admin. Cloudflare R2 for media: separate public marketing and private booking buckets. Next server is the trusted submission/administration boundary. Compatible Next hosting. **Hosting decision (10 October 2026): Vercel during development and testing; production hosting moves to Cloudflare once implementation and validation are complete.** Confirm Next.js runtime feature compatibility (route handlers, middleware, scheduled/queue workers, Node APIs) with the chosen Cloudflare product before cutover, and re-run the full check suite against the production build target. No static-only export for production server features.

At implementation start, inspect existing package versions and pin current compatible stable dependencies in the lockfile. Do not blindly upgrade a working repository or copy Stitch's CDN Tailwind scripts. This PRD does not freeze unverified SDK syntax or plan pricing.

- Server Components/data-access layer for public published content and private authenticated reads. Small Client Components for forms, menu, lightbox and motion.
- Route handlers for public submission APIs/upload contracts; Server Actions or route handlers for admin writes using the same validation/authorization layer. Treat every action as an independently reachable endpoint.
- Shared typed repositories/service modules prevent mocked frontend state from being confused with production writes.
- Public reads expose only published fields; private data never enters public caching, metadata, sitemap or analytics.
- Explicit cache policy per data type. Private responses non-shared/no-store. Publication changes invalidate affected public views. Time-sensitive promotion rendering evaluates current server time and cannot remain stale past expiry.
- Keep secrets in server environment. Supabase elevated credentials bypass RLS, so privileged code must perform its own trusted validation/authorization. Use user-scoped database access for normal admin work with RLS; elevated operations only where necessary.

## 6. Booking vertical slice

Four logical stages: services/items/photos; collection/address/date/time/transport; contact; review/save. Exact labels in CONTENT §06.

Fields: published service IDs (one or more laundry services); clothing/bedding/both/other; item/load description; optional notes; up to three photos; pickup address; optional landmark/map link; date default today when eligible; optional preferred time within operating hours; transport no preference/cab/motorbike/courier; full name; phone; same/different WhatsApp number; optional email; phone/WhatsApp contact preference; pending-request acknowledgement and approved privacy version.

No public required branch selector or geography-derived assignment. assigned_branch_id starts null and admin assigns. Record request timezone, server timestamps, service-title snapshots and policy version.

Submission: server validates request, rate-limits, validates attachment ownership, checks schedule and published services, then transactionally writes booking + selected-service snapshots + initial history. Generate opaque public reference server-side. An idempotency key scoped to submission returns the original result on safe replay; payload mismatch returns conflict. Never use a reference as authorisation.

After commit show pending/reference and offer WhatsApp preview/copy/retry. Recipient always https://wa.me/233595224280 with URL-encoded text. Photos remain private and excluded from message links. No WhatsApp API or send callback. Record draft-open attempt only as best-effort; saved request persists even if external app never opens. Admin must monitor pending requests without relying on customer sending a draft.

Walk-ins/drop-offs are a branch-visit path, not an online drop-off booking system in this release. Do not invent branch receipt status or customer portal.

## 7. Admin workflow and state model

Both administrator roles (§2a) may perform the operational booking workflow below. States: pending → confirmed → scheduled → picked_up → processing → ready → out_for_delivery → completed. Allow confirmed → picked_up when separate scheduling stage is unnecessary; ready → completed when return is collected directly. Cancellation from any nonterminal state with reason. Terminal corrections require a deliberate authorised audited action; no silent backward changes.

Confirmation requires assigned branch, agreed pickup datetime, agreed nonnegative pickup fee in GHS, contact outcome and confirmation note. A zero fee is allowed only when deliberately recorded with a reason; no public free-pickup promise. Admin records service charge/return detail if agreed, independently of any payment gateway. No fabricated paid/unpaid lifecycle gate.

Every update verifies admin session/role, checks version/allowed transition, updates atomically and appends actor/time history. Internal notes never leave private administration. WhatsApp updates are optional drafts to customer's recorded number AFTER the status commits; cancellation/open failure does not roll back state. Do not label sent/delivered/customer notified.

## 8. Contact, quote, reviews, promotions, newsletter

Contact and commercial enquiries save privately with new/contacted/closed states. Quote form exactly eight fields in CONTENT §10, no automatic quote or direct WhatsApp shortcut. Success only after database commit. Preserve values on error, use idempotent submit contracts.

Reviews: pending moderation, optional 1–5 rating, display-name/publication permission, branch optional. Admin approval required; publish only consented safe fields. Requested Google reviews must be accurately sourced and rights checked; otherwise link to main map listing without inventing reviews.

Promotion: 40% off qualifying Wash, Ironing & Fold, exclusions in CONTENT §14. Intended end 30 October 2026 inclusive (end-exclusive 31 October 00:00 local); year inferred and must be verified before activation. No minimum/code/pricing engine. Admin manages dates/placements/priority. Popup at most once per session, accessible/dismissible, not during active booking. Expired offers removed from every cached/public surface.

Newsletter: phase-one interest records only, explicit unchecked opt-in, notice version and timestamps; private admin list/withdrawal. Do not send emails, automatically move lists to Brevo, count bookings as subscribers or promise double opt-in. Activate collection after policy approval; subscriber retention separately decided. Later provider connection is a new authorised phase. Auth password-reset email is separate operational functionality.

## 9. Media and retention

Marketing assets public only when approved, with source/permission, alt, dimensions and safe references. Customer photos always private and never reusable in marketing library. Server-issued short-lived uploads target unique quarantine keys; verify actual bytes/content and size before attachment. Supported formats initially JPEG/PNG/WebP; disclose them. Do not claim HEIC acceptance until decoder support is verified; return graceful unsupported-format fallback.

R2 presigned URLs are bearer capabilities, not an authorisation system or inherently enforceable upload-size limit. Verify quota/size after upload, constrain keys and MIME, rate limit signing/finalisation, reject unexpected content, strip metadata/re-encode safely, and purge rejected/orphan objects. Admin read signing rechecks access and deletion age. No secrets in URLs beyond the short-lived capability; no private object path in analytics.

Records expire after 12 calendar months from creation; photos after 90 days from upload. A daily protected, retryable job deletes eligible live data and all associated derivatives, cleans dependent PII, invalidates photo access and logs counts without PII. Repeated cleanup is safe. Backup recovery must reapply expiry/deletion before exposing restored data. Job/backup retention details documented in approved privacy policy; no promise that active-store deletion instantly deletes provider backups. Newsletter/review retention needs its own policy, not silent reuse of booking periods.

## 10. CMS and presentation requirements

Home/About content editable; content modules include full catalogue, branch contacts/hours, FAQs, gallery, blog, reviews, promotions, policies and site contacts. Draft/publish/archive and safe media reuse. Approved policy versions stored. Public draft reads denied. Media still referenced cannot be silently deleted. Historical service snapshots survive catalogue changes.

Mobile light first; entire site responsive to desktop. Dark theme later implemented in Bolt from Design.md/accepted structure, with readable original logo and audited contrast. Distinct page compositions with shared accessible controls. Conversion actions immediately available. Home scrollytelling uses static reduced-motion fallback, no 500vh compulsory scroll or heavy background preventing use. WebGL optional only if justified by measured performance/accessibility; not a required deliverable. Placeholder imagery annotation outside Figma website frames.

## 11. SEO, security and quality

Meaningful published pages have unique titles/descriptions, canonical from real domain, social previews, sitemap and valid visible-fact structured data. Do not invent addresses/review aggregates or Google listing status. Private admin and submission states noindex and absent from sitemap. No PII/reference in metadata or query URLs. Unpublished articles return 404. Unknown secondary days not marked as seven-day opening.

WCAG 2.2 AA target: keyboard/focus, labels/error summaries, dialogs, contrast, reduced motion, zoom, responsive text. Performance budget selected after actual assets; keep LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 as production targets, not measured claims. Responsive image delivery, lazy maps, limited client JS. Error logs redact PII/secrets, contain correlation ID. Persistent rate limiting shared across instances, origin checks, bounded input and safe rich-text rendering. Auth/RLS tests and integration failure cases required.

## 12. AI implementation stages and boundaries

1. Bolt FRONTEND ONLY: build typed reusable routes/components from accepted exports, CONTENT and Design. Use a clearly separated mock repository and explicit demo states; do not invent production saves, secrets or third-party integration. Include all states, responsive layouts and accessibility. Strip Stitch scripts/CDN export scaffolding. Owner reviews visuals.
2. VS Code: inspect repository, architecture and dependencies; implement migrations/RLS/admin auth, then CMS/media, submission vertical slices, scheduling/WhatsApp/admin lifecycle, retention and observability. Use small reviewable increments, not wholesale rebuild.
3. Verification: targeted unit/integration tests for actual rules and failure modes, typecheck/lint/build, owner UI inspection; no screenshot/browser automation unless explicitly requested. Document implemented routes and remaining dependencies in one cumulative implementation/review record.
4. Launch: actual domain/contact/policy configuration, backups, secrets and data-access tests complete; user authorises publishing separately.

## 13. Remaining configuration dependencies — INTERNAL

Verified business mailbox names under the confirmed domain 2ndwavelaundry.com (domain itself is confirmed; individual mailboxes and sender identities are still to be decided); secondary days/directions (omit rather than block unrelated work); client policies; actual blog/reviews/photos; validation of Facebook link; promo year activation check; subscriber retention; backup/cleanup deployment schedule. Preferred clock-time model and cutoff equality are documented engineering choices because exact slot inventory was not provided. No new customer-facing “final details to confirm” section. Do not claim all client questions were explicitly answered.

## 14. Done definition

Every scoped public/admin route and its states exist; content matches CONTENT.md; single pending save and central manual handoff work; ordinary post-11am requests are accepted during pickup hours while express rule is enforced; admin securely assigns/confirms/updates with audit; private photos/records are protected and deleted on policy schedule; CMS publishes only approved content; no account/payment/tracking/automated marketing scope creep. SRS tests pass and documented production dependencies are resolved or their features disabled.

## 15. Official technical references checked 1 October 2026

- Next.js data security: https://nextjs.org/docs/app/guides/data-security
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Cloudflare R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/

Verify exact API syntax against the pinned implementation versions. No subscription cost or quota assumption is frozen by this PRD.
