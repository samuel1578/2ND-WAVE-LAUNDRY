# 2nd Wave Laundry Services — Final Software Requirements Specification

Version 1.0 · 1 October 2026 · Testable implementation baseline

Companions: final AI Technical PRD v1.0, CONTENT.md v1.0, Design.md. Prior SRS v0.1 is superseded. This specifies intended software, not completed implementation or launch approval. P0 = required release behaviour; P1 = scoped supporting capability. Pending business facts are represented through safe configuration/omission, not invented values.

## 1. Actors and system boundary

Anonymous visitor submits pickup, contact, commercial quote, review or consented newsletter interest. Two invited administrator roles control private records/content: `full_admin` (entire console) and `operational_admin` (bookings and reviews only) — see PRD §2a, formally authorised 10 October 2026. Supabase authenticates admins (email/password, cookie-based sessions, invite-only accounts, recovery through Supabase Auth) and stores data. R2 stores approved public media and private photos. Next server validates submissions and mediates trusted operations. WhatsApp opens manual drafts; no outbound API/send receipt. Walk-ins occur at branches, outside online booking workflow. All operational scheduling uses Africa/Accra.

## 2. Public route coverage

| Route | Required responsibility |
| --- | --- |
| / | Conversion hero, services, pickup/drop-off, branches, conditional promotion/reviews/gallery, FAQs/newsletter |
| /services | Eleven catalogue entries, no prices |
| /services/[slug] | Ten canonical details, including Pickup & Delivery |
| /commercial-laundry | Eleventh service, business enquiry CTA |
| /commercial-laundry/quote | Eight-field quote form, loading/validation/error/success |
| /how-it-works | Both pickup and branch visits, corrected express rule |
| /locations | Three branches equally discoverable |
| /locations/[slug] | Accurate contacts/hours, main map only until secondary directions approved |
| /about | Editable approved direction |
| /gallery | Published assets, filters/lightbox/empty |
| /blog; /blog/[slug] | Published article index/detail or honest empty state |
| /contact | Central contact/branch calls and general enquiry |
| /faq | Approved answers including corrected cutoff |
| /book | Four logical stages; save result/handoff/error/paused states |
| /reviews | Approved reviews, moderated submission states |
| /privacy; /terms; /laundry-care-terms | Only approved policy bodies |
| 404/global error | Helpful recovery without private details |

Private routes: /admin/login and recovery, /admin, /admin/bookings, /admin/bookings/[id], /admin/enquiries, /admin/newsletter, /admin/content and module/editor routes, /admin/media, /admin/settings. No public login/profile/order tracking.

## 3. Functional requirements

| ID | Priority | Requirement and acceptance |
| --- | --- | --- |
| UI-01 | P0 | Exact CONTENT copy; complete original logo readable in header/footer and large on Home. Mobile Book Now + menu; zero account icons. Service photographs never replaced by brand logo. |
| UI-02 | P0 | Walk-in/drop-off actions visible on Home/services/How It Works/Locations; /book provides branch-visit alternative without inventing online drop-off bookings. |
| UI-03 | P0 | Mobile 440px design reference expands responsively to desktop; no horizontal overflow at 320px. Zoom enabled, visible focus, keyboard interactions and reduced-motion fallback. |
| SRV-01 | P0 | Exactly eleven approved services; historical selections snapshotted. Service CTAs preselect valid laundry IDs; Pickup & Delivery opens normal selection; Commercial leads to quote form. |
| LOC-01 | P0 | Three correct branch numbers/hours, main map confirmed. Unknown secondary days/directions omitted. No hard-coded geographical assignment; branch phones distinct from central booking handoff. |
| BOOK-01 | P0 | Four-stage form captures fields in CONTENT §06, bounded server validation; multiselect services; optional photos; values preserved on back/error. No customer branch selector required. |
| BOOK-02 | P0 | Default today/earliest-possible collection; user may request later date. Optional preferred time is a request in 07:00–17:00, not slot inventory. Server date/time validation independent of branch opening hours. |
| BOOK-03 | P0 | Ordinary collection requested after 11am and before 5pm allowed. Express same-day collection requires submission by 11am, no completion guarantee. Late express users choose later date or contact team; no blanket ordinary cutoff. |
| BOOK-04 | P0 | Successful save atomically creates one pending booking, snapshots, initial history and attachment links; opaque reference returned. Idempotent retry returns same reference; mismatched payload conflict. No external WhatsApp action before commit. |
| BOOK-05 | P0 | Pending confirmation result, reference/copy, editable draft preview, main recipient 233595224280, open/copy/retry. Closing/unavailable WhatsApp cannot delete booking; no sent/delivered claims. |
| BOOK-06 | P0 | Pause checked server-side including stale open forms; refusal preserves input and contact alternative. Saved idempotent replay still returns prior result. |
| PHOTO-01 | P0 | Maximum three private JPEG/PNG/WebP photos, each at most 5,000,000 bytes (decimal 5MB). Validate actual bytes, ownership/session, size/count and processing outcome before linking. Unsupported files rejected; booking can continue without photos. |
| ADM-01 | P0 | Invited administrators only, in one of two roles: `full_admin` or `operational_admin` (PRD §2a). No public signup/self-promotion. Role is resolved server-side from the session; client-supplied role claims are never trusted. Every private read/write verifies session and role at entry; RLS and grants independently deny guests, ordinary authenticated users and out-of-scope roles. **Foundation implemented 10 October 2026 (Sprint 1A, code complete — awaiting hosted configuration):** Supabase Auth email/password with persistent cookie sessions; accounts created only by a trusted administrator (no `/admin/signup`); identity re-verified with `auth.getUser()` and the role read from `admin_profiles` on every protected render and privileged server call; a missing, disabled or unrecognised profile resolves to no access; missing configuration fails closed; user-visible authentication errors do not reveal whether an address belongs to an administrator. |
| ADM-02 | P0 | Search/filter/list/detail, private photo access, assign branch, notes, contact outcome and history. Version conflict prevents silent overwrite. Customer notes distinct from private internal notes. |
| ADM-03 | P0 | Confirm requires assigned branch, agreed pickup timestamp, fee/currency/contact outcome/confirmation note; nonnegative fee; zero needs explicit reason. Missing values rejected atomically. |
| ADM-04 | P0 | Allowed lifecycle transitions enforced/audited with actor/time; cancellation reason required. Terminal correction deliberate and audited. No customer-controlled status/assignment/fee fields. |
| MSG-01 | P0 | Admin draft generated only from recorded state to customer's number; status commit survives open failure. Activity can say draft opened, never message sent/delivered. |
| CON-01 | P0 | General enquiry privately saved with accessible validation/error/success, no response-time promise; admin new/contacted/closed. |
| BIZ-01 | P0 | Exactly eight quote fields from CONTENT §10, private save and states; no instant price, booking confirmation, direct WhatsApp shortcut or marketing enrolment. |
| REV-01 | P0 | Pending reviews private; explicit display permission, optional 1–5 rating; admin approval before public release; no fabricated/imported unsourced feedback. |
| PROM-01 | P1 | Approved 40% Wash, Ironing & Fold exclusions, start/end/priority/placement/enabled. Expiry server-enforced and cache-bounded; popup dismissible once/session, never interrupts active booking. |
| NEWS-01 | P1 | Explicit unchecked opt-in, private deduplicated interest record and consent version; success only after save; withdrawal supported; Brevo/campaigns/confirmation emails disabled. Policy approval and separate retention required for activation. |
| CMS-01 | P0 | Home/About/services/locations/FAQs/gallery/blog/reviews/promotions/policies/settings editable; draft vs published revisions distinct. Saving draft cannot modify visible published data. |
| CMS-02 | P1 | Media library public marketing only; source/permission/alt metadata, reuse, references checked before deletion. Private customer uploads excluded. |
| SEO-01 | P0 | Published accurate metadata/canonicals/sitemap; unpublished route 404; admin/results noindex; no PII or fabricated local facts/review markup. |
| RET-01 | P0 | Customer photos expire 90 days after upload, booking/enquiry PII 12 calendar months after creation; daily protected cleanup, derivatives/orphans included, restored records rechecked. |
| OPS-01 | P0 | PII-redacted logs, correlation IDs, failed-job alert/retry and tested recovery. No irreversible publication from mocks. |

## 4. Scheduling decision table

All times below are server-local Africa/Accra. Requested date defaults to today only when eligible; no client clock controls eligibility. Express is selected explicitly alongside any laundry services. Same-day completion intent is inferred only when Express is selected for today; other urgency goes in notes and is discussed offline.

| Condition | Behaviour |
| --- | --- |
| Ordinary pickup, today, before 07:00 | Save pending for today's pickup operation, earliest collection 07:00; no out-of-hours promise |
| Ordinary pickup, today, 07:00 ≤ now < 17:00 | Accept valid pending request, including after 11am |
| Ordinary pickup, today, now ≥ 17:00 | Suggest later date/contact; do not accept default today as service availability |
| Express pickup for today, now ≤ 11:00:00 | Accept pending, still staff-confirmed |
| Express pickup for today, now > 11:00:00 | Reject same-day express eligibility; preserve values, choose later date/contact |
| Requested later date | Accept valid future preference; evaluate pickup hours and any explicit configured suspension |
| Preferred time in past today or outside 07:00–17:00 | Field error; choose time or leave optional field blank |
| Successful request replay after cutoff/closure | Return original committed result; no duplicate/new eligibility decision |
| Client changes clock/timezone | Server decision unchanged |
| Sunday/holiday | Pickup operates per supplied seven-day rule; no branch-hours-derived closure |

Boundary equality is an explicit engineering convention because client did not specify seconds. Preferred time at 17:00 may be requested for a future date, but not represented as guaranteed; today submission closes at 17:00. Admin may operationally resolve exceptions offline, not by falsifying public availability.

## 5. Input limits and validation

Technical limits (not new business policies): name/business name 1–120 characters, pickup/location text 1–500, landmark 0–200, item description 1–2000, notes/message/review 0–4000 (required fields require nonblank), email ≤254, map URL ≤2048. Commercial item description required, notes optional. Trim whitespace; reject null bytes/invalid encoding/unknown enum values. Phone library validation permits valid international contacts and normalises E.164; Ghana local format supported without assuming every customer uses a Ghana number. HTTPS external URLs only from validated schemes/hosts; no javascript/data URL in CMS links. Format-specific validators do not leak internal errors.

No client-controlled ID, role, branch assignment, status, fee, timestamp or consent version accepted as authoritative. Public submit includes acknowledgement/opt-in value plus server-approved notice version. Reject invalid/unpublished service IDs. Free-form user text rendered escaped, not HTML. CMS rich content sanitised or safely structured. Request size/count limits apply before expensive image processing.

## 6. Logical schema and integrity

Migrations are versioned, reversible where practical and reviewed before production. The following logical entities define responsibilities; implementation may consolidate typed content modules while preserving access rules and revision behaviour.

| Entity | Core fields / constraints |
| --- | --- |
| admin_profiles | auth user PK/FK, role constrained to full_admin or operational_admin (no default granting elevated access); disabled_at; provisioned only by trusted workflow. RLS: enabled and non-permissive — anonymous denied by grant and policy, an authenticated administrator reads only their own row, a Full Admin may read all rows, and no client role may insert, update or delete; role helpers are `SECURITY DEFINER` with a pinned `search_path` and execution granted only to `authenticated` |
| site_settings | validated public contacts/rules/feature flags, version, timestamps; secrets excluded |
| locations | UUID, unique slug, title, primary flag, E.164 phone, optional verified map/directions, opening-hour data with nullable unknown days, publish revision |
| services | UUID, unique approved slug, title, booking kind laundry/modifier/information/commercial, order/feature fields, revision links |
| content_revisions | module/entity, revision, structured copy/media refs, draft/published/archive, author/timestamps; published pointer controlled transactionally |
| bookings | UUID, opaque unique reference, submission scope/key/hash, customer/contact, item category/details, address/landmark/map, transport preference, requested date/time, express flag, nullable assigned_branch_id, status, agreement fields, notice version, created_at/updated_at/version/expires_at |
| booking_services | booking FK, service FK nullable after archive, immutable title/slug snapshot; unique selection per booking |
| booking_status_history | booking FK, from/to, actor, reason, server timestamp; append-only |
| booking_notes | booking FK, private note, actor/time; access private |
| upload_sessions | random scoped session/token hash, ownership binding, allowed count/bytes, expiry, claimed state; credentials never logged |
| booking_photos | booking FK, unique private key, MIME/size/dimensions, upload time/deletion due time, processing state; no public URL |
| media_assets | unique marketing key, approved visibility, MIME/size/dimensions/alt/source/permission; reference-safe deletion |
| gallery_items / blog_posts / faqs | typed published revision, sort/category and media references; unique slugs where applicable |
| review_submissions | private name/text/rating/branch/permission/version, moderation state; publication extracts permitted display fields only |
| promotions | revision, placements, exclusions, start/end-exclusive timestamps, priority, enabled; end > start |
| contact_submissions | contact/category/message, new/contacted/closed, notice version, expiry |
| commercial_enquiries | eight specified form values, state/notes/version, notice version, expiry |
| newsletter_interest | normalised email unique, opt-in/version/time/source, withdrawn_at; access private |
| audit_events | private actor/action/entity/time/correlation without unnecessary PII |
| cleanup_jobs | job/run cursor/outcome/counts, retries; no deleted content retained as logs |

Indexes: unique reference/submission scope+key; bookings(status, requested_date), (assigned_branch_id, requested_date), created_at, expiry; private phone search only if needed and authorised; published slug/pointers; enquiry state/expiry; photo expiry/booking; newsletter email unique. Database checks enforce nonnegative fees, rating 1–5, valid states/enums and references. Atomic transactions handle booking relations/history/attachment claims and status changes. Reference collision retried server-side. Archived services remain available as snapshots, not broken historical records.

## 7. Access-control matrix

| Resource | Anonymous | Ordinary authenticated user | Admin (role-scoped) | Trusted server/job |
| --- | --- | --- | --- | --- |
| Published safe content | Read | Read | Read/manage | Controlled publish |
| Draft content/policies | Denied | Denied | Read/manage | Controlled |
| Bookings/photos/notes/history | Denied | Denied | Authorised read/update | Validated creation/cleanup |
| General/commercial leads | Denied | Denied | Read/update | Validated creation/cleanup |
| Pending review/source PII | Denied | Denied | Moderate | Validated creation |
| Approved review display fields | Read | Read | Manage | Controlled publication |
| Newsletter interest | Denied | Denied | Read/withdraw | Consented creation/deduplication |
| Admin role/site secrets | Denied | Denied | No arbitrary role grant/secrets exposure | Trusted provisioning/config |
| Public marketing R2 | Approved read | Approved read | Scoped management | Validated upload |
| Private R2 | Denied | Denied | Short-lived authorised read | Scoped upload/cleanup |

**Role-scoped routing implemented 10 October 2026 (Sprint 1B, code complete — awaiting hosted configuration).** A central permission registry (`src/lib/auth/permissions.ts`) maps `full_admin` and `operational_admin` to capabilities and to the canonical administrative routes; the admin route resolves the authenticated administrator server-side on every request and returns allowed, redirect (dashboard → the role's landing page), forbidden (access-denied state, no module data resolved) or unknown (not-found). Operational Admins reach `/admin/bookings` and `/admin/reviews` only and never receive `reviews.override`. Desktop and mobile navigation are filtered from the same registry, and module links are omitted rather than disabled. Details: `docs/implementation/SPRINT_1B_ROLE_BASED_ADMIN.md`.

Role interpretation of the "Admin (role-scoped)" column: `operational_admin` is limited to booking rows and review rows (moderation and reply drafting); every other row in this matrix requires `full_admin`. Emergency review overrides — approve, reject or edit where an operational decision has already been made or the record state would otherwise block the action — are `full_admin` only and must write an audit entry containing actor, review, action, before/after values, reason and timestamp in the same transaction as the change.

RLS enabled on exposed tables; revoke direct public mutation privileges where validated server submits are required. Guest API is not direct anonymous table insertion. Private signed URLs are short-lived bearer credentials issued only after authorisation, and photo retention is rechecked. Service/elevated credential bypasses RLS: validate in trusted code; never describe RLS as protecting a compromised service key. Test ordinary authenticated access as well as anonymous access. Middleware/navigation hiding alone is insufficient.

## 8. Server contracts

Implementation may use Route Handlers or equivalent typed server entry points. Recommended public contract names below are project APIs, not external SDK APIs.

- POST /api/bookings: validated request + idempotency key, attachment-session token; returns 201 committed reference and handoff data, 200 replay, 409 mismatch/conflict, 422 validation/time, 429 throttle, 503 paused/dependency failure. No public GET-by-reference endpoint.
- POST /api/uploads/booking/prepare: bounded anonymous upload session, rate limits; short-lived keys scoped to random session, never arbitrary requested bucket/key.
- POST /api/uploads/booking/finalise: verifies actual stored object bytes/size/content/session quota; approved attachment tokens returned. PUT success alone is not file approval. Uploaded files unclaimed within 24h become cleanup candidates.
- POST /api/enquiries; /api/commercial-quotes; /api/reviews; /api/newsletter-interest: validated schemas, idempotent behaviour, configured notice/feature gates; generic newsletter duplicate response avoids membership enumeration.
- Admin reads/mutations verify session/admin at entry and DB policies. Booking status mutation includes expected version; stale version returns 409. Confirmation transaction checks required agreement fields.
- Protected cleanup endpoint or scheduled worker uses secret/job identity, fixed trusted task scope and safe retries. Public caller cannot run arbitrary deletes.

Error structure: stable code, safe message, fieldErrors where applicable, correlation ID; never stack traces, SQL details or secrets. Disallow credentialed cross-origin mutations except explicitly configured trusted origin. Apply origin/CSRF checks for cookie-authenticated writes and persistent shared rate limits for public writes/signing/auth attempts. Idempotency is not anti-spam. Replay cannot expose full saved PII using a guessed key; return minimal save result and session-bound handoff only.

## 9. Lifecycle / concurrency

Allowed normal transitions:

pending → confirmed or cancelled
confirmed → scheduled, picked_up or cancelled
scheduled → picked_up or cancelled
picked_up → processing or cancelled
processing → ready or cancelled
ready → out_for_delivery, completed or cancelled
out_for_delivery → completed or cancelled
completed/cancelled → no ordinary transition

Operational terminal corrections require a separate audited admin correction flow with reason and revalidation; never an arbitrary status dropdown bypass. Updates lock/check expected version and append history in one transaction. Transition replay cannot duplicate history. WhatsApp opening is a separate best-effort activity event. Internal assignment at pending does not auto-confirm. Return collection can complete from ready without a fabricated delivery event.

## 10. Privacy / media / retention

Uploads JPEG/PNG/WebP initially; no SVG/HTML/executable or unverified HEIC support. Validate magic bytes and decoder, constrain pixels, re-encode/remove metadata with safe resource limits. Quarantine objects remain private. Signed URLs do not themselves enforce 5MB quota; verify actual object and remove rejected oversized data. Total attached allowance 15,000,000 bytes across up to three valid objects. If processor unavailable, photo attachment fails gracefully; unpictured booking still possible. Non-atomic external storage operations use compensating cleanup and retry states.

Live booking/enquiry records expire at creation +12 calendar months. Photos expire at upload +90 days; admin read withheld once due even if daily deletion job has not run. Job removes originals/derivatives/relations and customer PII in history/notes/search/materialised views; only nonidentifying operational counts may remain. No soft-deletion-only retention compliance. Job scans daily, tracks failures and retries, no PII in cleanup logs. Restore process reapplies expiry/withdrawal before service. Backup lifespan/access and deletion handling documented; no instant-backup-erasure claim. Subscriber/review retention separate and must be approved before activation of affected collection.

Client privacy bodies pending: forms disabled in production until notices/policy versions are available, not replaced with invented legal text. Other public informational pages may launch with missing optional email/directions omitted. No analytics cookies/third-party tracking introduced without appropriate configured notice/consent.

## 11. Nonfunctional requirements

- Security: validated endpoint boundaries, least privilege, server-only credentials, RLS, safe rich content, scoped private storage, rate limiting and secret rotation. No PII in shared cache/metadata/logs. Auth reset redirects to trusted production allowlist.
- Accessibility: WCAG 2.2 AA target, complete keyboard tasks, visible focus, 200% text zoom/reflow, labelled inputs/error summaries, announced save feedback, accessible menu/popup/lightbox and reduced motion. Public buttons generally 48px height; do not infer compliance solely from dimensions.
- Performance: target LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 at p75 when sufficient field data; not release claims based on absent traffic. Optimised images, lightweight hero fallback, lazy maps, bounded client JS.
- Reliability: save result only after commit, atomic relations/history, idempotency, outage feedback/value preservation, no dependency on successful WhatsApp opening. Persistent job monitoring and backup restore rehearsal.
- Compatibility: current supported Chrome/Safari/Firefox/Edge, responsive 320px to desktop, iPhone reference and touch/keyboard. Owner performs visual checks; automated browser/screenshots only if requested.
- SEO: truthful published titles/canonicals/sitemap/structured data, no draft/private route indexing or duplicate service doorway pages. Unknown branch days omitted from structured hours.
- Maintainability: typed modules/shared form controls/repository interface; package lock pinned, migration history, no CDN export runtime, one cumulative implementation/review log.

## 12. Acceptance test matrix

| Test | Setup/action | Expected result | Priority |
| --- | --- | --- | --- |
| AT-01 | Ordinary today collection submitted 14:00 | One pending save; no 11am rejection | P0 |
| AT-02 | Express today pickup submitted 10:59:59 / 11:00:00 / 11:00:01 | First two pending; last gets later-date/contact feedback | P0 |
| AT-03 | Today ordinary at 16:59:59 / 17:00 | First pending; last later-date/contact | P0 |
| AT-04 | Sunday/holiday before branch opens | Pickup rule follows 7am operation, no branch-hours closure | P0 |
| AT-05 | Tomorrow date + optional valid time | Saves preference, never reserves slot | P0 |
| AT-06 | Two services, different WhatsApp number, no customer branch | One unassigned pending booking, snapshots; main draft recipient | P0 |
| AT-07 | Timeout after commit then same-key replay after cutoff | Original reference returned, no duplicate/time rejection | P0 |
| AT-08 | Same key, altered payload | 409; no overwritten booking | P0 |
| AT-09 | WhatsApp unavailable/closed/copied/reopened | Saved record stays; no second save or sent badge | P0 |
| AT-10 | Confirm missing branch/fee/time/contact; then valid data | Invalid atomic rejection; valid one status/history write | P0 |
| AT-11 | Two admin edits on same version | First commits; stale second conflict, no overwrite | P0 |
| AT-12 | Anonymous/nonadmin booking/draft/photo access, tampered role | Denied at server and DB; no reference lookup leak | P0 |
| AT-13 | 3 ×5MB then 4th/oversized/fake MIME/stolen upload token | Limit boundary accepted if valid; invalid rejected/cleaned, no ownership bypass | P0 |
| AT-14 | Photo upload fails, choose continue without photo | Valid booking still saves without attachment | P0 |
| AT-15 | Status change then WhatsApp fails | Status/history remain; correct customer draft and honest activity | P0 |
| AT-16 | Enquiry/quote save outage and retry | Inputs retained; success only after commit, no duplicates | P0 |
| AT-17 | Pending review; admin approval/rejection | Pending private; only approved permitted fields public | P0 |
| AT-18 | Promo at end boundary and cached Home | Expired offer absent from every placement; no stale popup | P1 |
| AT-19 | Newsletter unchecked/checked/duplicate/withdrawn | No unchecked opt-in; private deduped consent; withdrawal recorded, no email sent | P1 |
| AT-20 | Draft edit of published page then publish | Draft save does not change public page; publish invalidates safely | P0 |
| AT-21 | Private photo reaches 90 days, cleanup retry | Read denied when due; original/derivatives removed safely | P0 |
| AT-22 | Records reach 12 calendar months, restore old backup | Live PII purged; restored expiry reapplied before exposure | P0 |
| AT-23 | Booking paused while form open | Server refuses new save, retains values/contact alternatives | P0 |
| AT-24 | Missing email/secondary days/article/policy | No example mailbox/fake days/blog/legal body; relevant features gated | P0 |
| AT-25 | Service/header/footer actions on each route | Correct destinations and preselection; no profile or fake modal | P0 |
| AT-26 | Keyboard/zoom/reduced motion, owner mobile inspection | Booking/menu/dialogs usable; no motion-blocked conversion | P0 |
| AT-27 | Unpublished article/private result sitemap/metadata | 404/noindex as appropriate, no private data indexed | P0 |
| AT-28 | Public abuse/signing flood/invalid external links | Bounded throttling/validation; legitimate retry recoverable | P0 |

## 13. Verification and release gates

Typecheck, lint and production build; focused tests for scheduling boundaries, payload schemas, transitions, transactions/idempotency, permission matrix, private photo handling, publication/expiry, retention cleanup and restore. Owner validates actual visual designs and navigation; agent does not run screenshot/browser matrices unless requested. Do not declare backend tests passed when only mock states exist.

Before live form activation: approved policy bodies/versions; verified real contacts and mailbox configuration under the confirmed domain 2ndwavelaundry.com (mailbox names pending); production env/redirects/RLS/private bucket settings; durable rate limiting and cleanup job; backup recovery; client-approved promo year if activated; subscriber/review retention if those collections enabled. Missing secondary directions and articles do not justify invention or stopping unrelated implementation. Final release approval is separate from document drafting.

## 14. Change control / handoff defects

Update CONTENT, PRD and SRS together when business rules change. Existing export defects are mandatory implementation corrections, not approved scope: generic 11am ordinary cutoff, Accra Wide, invented modal/services, undersized logos, bedding logo-as-photo, compressed buttons, blocked zoom, wrong routes, excess footer gaps, inconsistent quote error/default forms and fake placeholders. Any frontend-only success state remains demonstrative until persistence is wired.

References: Next.js https://nextjs.org/docs/app/guides/data-security ; Supabase https://supabase.com/docs/guides/database/postgres/row-level-security ; R2 https://developers.cloudflare.com/r2/api/s3/presigned-urls/ — checked 1 October 2026. Exact SDK syntax verified against pinned versions at implementation.
