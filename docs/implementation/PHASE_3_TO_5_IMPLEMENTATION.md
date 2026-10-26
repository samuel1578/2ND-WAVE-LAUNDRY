# 2ND WAVE LAUNDRY SERVICES — Phases 3-5 Implementation Plan

**Document status:** authoritative delivery plan for Phase 3 (Reviews), Phase 4 (Email Communications) and Phase 5 (Newsletter/Campaigns), derived from `PHASE 3 TO 5.pdf` and the completed Phase 1/Phase 2 sprint records.
**Date:** 26 October 2026.
**Baseline:** Phases 1 and 2 are code-complete (Sprints 1A-1C, 2A-2E; 318 tests passing). Phase 2F (security, retention, production acceptance) and Final Production Acceptance remain open and are gated at the end of this plan.
**Overall status:** IN PROGRESS — Sprints 3A-3C are code-complete and the Phase 3 acceptance matrix is written; hosted execution, owner QA/sign-off and Phase 4 remain open.

**Phase 4 revision (26 October 2026):** Phase 4 redrafted per owner decisions — (1) in-app composer scrapped; one-off admin sends via Gmail Send As; (2) domain DNS (SPF/DKIM/DMARC) already configured and deliverability-tested by owner; (3) scheduler deployment + template visibility/resend retained as the phase's substance; (4) DNS/secrets/inbound runbook sprints compressed into acceptance attestation. See section 5.

**Sources of truth (read before executing any sprint):**

| Source | Path |
| --- | --- |
| Phase 3-5 roadmap (this plan's mandate) | `PHASE 3 TO 5.pdf` |
| Phase 1 consolidated record | `docs/implementation/PHASE_1_COMPLETE_IMPLEMENTATION.md` |
| Phase 2 sprint records | `docs/implementation/SPRINT_2A..2E2`, `PHASE_2E_ACCEPTANCE.md` |
| Architecture investigation (reviews/email/newsletter gap analysis) | `docs/investigations/ADMIN_OPERATIONS_EMAIL_ARCHITECTURE.md` |
| Brevo template parameter contract | `docs/investigations/BREVO_SIX_TEMPLATE_PARAMETER_AUDIT.md` |
| Requirements (REV-01, NEWS-01, RET-01, sections 5-10, 12) | `docs/source/2ND_WAVE_SRS.md` |
| Cumulative review log | `docs/IMPLEMENTATION_REVIEW.md` |

**Numbering note (from the PDF):** the original implementation document used "Sprint 3" for enquiries/reviews/promotions and "Sprint 4" for SEO/release QA. That numbering is NOT interchangeable with this plan. Sprints here are named `3A-3C`, `4A-4C` (redacted from 4A-4D on 26 Oct), `5A-5C`.

---

## 1. How to use this document (for the executing AI/engineer)

1. Execute sprints **in order** within a phase; phases run in the PDF's recommended order: **Phase 3 -> Phase 4 -> Phase 5 -> Final Production Acceptance**.
2. Each sprint lists: objective, deliverables (files/schema/UI/tests), acceptance criteria, dependencies, and explicit **non-goals**. Do not silently expand scope.
3. Every sprint ends with the global Definition of Done (section 8). A sprint is not complete until `npm run check` passes and its evidence is recorded.
4. After any code change run `graphify update .` (AGENTS.md rule) and record results in the sprint record you create at `docs/implementation/SPRINT_<id>_<NAME>.md`.
5. Follow section 2 (patterns to copy) and section 7 (hard rules) without exception - they encode the security model built in Phases 1-2.

---

## 2. Current baseline - what exists after Phase 2

### 2.1 Delivered and reusable

| Capability | Where | Relevance to Phases 3-5 |
| --- | --- | --- |
| Supabase Auth, cookie sessions, two-role model | `src/lib/auth/*`, `src/lib/supabase/*` | All admin work |
| Central permission registry (`reviews.*`, `newsletter.manage`, `email.manage` already declared) | `src/lib/auth/permissions.ts` | Phase 3/4/5 route + capability gating; **no new permissions required** |
| Server route authorisation (`resolveAdminRouteAccess`) | `src/app/admin/[[...segments]]/page.tsx` | New detail routes inherit `reviews.read` automatically via prefix match |
| Append-only `audit_events` + single write path `private.insert_audit_event(...)` | `supabase/migrations/20261011120100_audit_events.sql` | Phase 3 moderation/override/reply audit; Phase 4 send audit; Phase 5 campaign audit |
| Booking public-submission pattern (origin check, shared DB rate limiter, idempotency key, hashed IP, fail-closed config, error taxonomy) | `src/app/api/bookings/route.ts`, `src/lib/bookings/*`, `src/lib/security/booking-rate-limit.ts` | **Template for `POST /api/reviews` and `POST /api/newsletter-interest`** |
| Transactional outbox + worker + retries + dead-letter + lease reaping | `supabase/migrations/20261019120000_email_outbox.sql`, `src/lib/email/worker.ts`, `/api/internal/email/worker` | Sprint 4A scheduler; 4B resend/visibility |
| Brevo delivery client, webhook (bearer-authenticated), delivery events | `src/lib/email/brevo.ts`, `webhook.ts`, `/api/webhooks/brevo` | Phase 4 verification and Phase 5 suppression signals |
| Email monitoring UI + controlled retry | `src/components/admin/email-delivery.tsx`, `/api/admin/email-delivery/[id]/retry` | Sprint 4B extends to deliberate resend of sent rows |
| Manual composer (sender picker, rich text, single recipient) | `src/components/admin/email-compose.tsx`, `/api/admin/email-compose`, `email-sender-picker.tsx`, `email-rich-text-editor.tsx`, `sanitizeManualEmailHtml` | **Scrapped (owner):** decommissioned in Sprint 4B; one-off sends via Gmail Send As; sanitizer + rich-text editor retained for reuse |
| Config readers for all Brevo template IDs / secrets | `src/lib/email/config.ts`, `.env.example` | Sprint 4B registry panel + variable harness |
| Optimistic `version` concurrency pattern | bookings, staff, `booking_alert_recipients` | Review moderation and campaign edits |
| PGlite-based migration tests + full-schema integration tests | `tests/*-db.test.ts`, `supabase/tests/*.sql` | Every new migration ships both |
| Design system (`.panel`, `.table-wrap`, `.record-row`, `.badge`, `.dialog`, `.field`, `.notice`, `Empty`, `Heading`) | `src/app/globals.css`, `src/components/ui.tsx`, `forms/controls.tsx` | All new admin screens; **no new CSS frameworks** |

### 2.2 Still demo-only (the work Phases 3-5 replace)

| Module | Current state | Evidence |
| --- | --- | --- |
| Reviews | In-memory `Lead` store; list of `status === "new"` only; approve/reject buttons; consent gate; no detail view, no replies, no audit, no spam control, no persistence | `src/components/admin/reviews.tsx`, `src/lib/mock-store.ts:662` |
| Public review display | Filters demo leads on `approved` + consent | `src/components/published-content.tsx:87` |
| Public review/newsletter forms | Client-side `repository.createLead`; disabled entirely when `NEXT_PUBLIC_DEMO_MODE=false` | `src/components/forms/public-form.tsx:179` |
| Newsletter interest | Demo `Lead` records; list + withdrawal only; "Email campaigns and provider integration are not enabled" | `src/components/admin/leads.tsx:154` |
| Composer sends | Direct Brevo call; **not written to outbox**, no audit row, no sent history, no attachments, no drafts | `src/app/api/admin/email-compose/route.ts` — **scrapped by owner (26 Oct); page removed in Sprint 4B, one-off sends via Gmail Send As** |
| Backend honesty notices | `PARTIAL_DATA_NOTICE` still says reviews/content are sample data | `src/lib/features.ts` |

### 2.3 Known blockers inherited from Phase 2E (must be tracked, not re-discovered)

1. **Migrations are not applied to the hosted Supabase project** (all 17 files pending). Every Phase 3-5 migration adds to this queue; hosted application is a deployment step, not a sprint action.
2. **Live Brevo template IDs / webhook unverified** — *revised 26 Oct:* owner has configured domain DNS (SPF/DKIM/DMARC) and tested deliverability; remaining: confirm Brevo template IDs are saved and the webhook secret is configured (Sprint 4B registry panel makes this visible).
3. **No scheduler is deployed** — `dispatchPendingEmails` drains only 3 rows after a response; `/api/internal/email/worker` exists but nothing calls it on a schedule. This is the main production blocker and belongs to Sprint 4A (redrafted).
4. Staff template IDs (`BREVO_TEMPLATE_STAFF_ORDER_*`) unset — they consume retry budget until configured.
5. `booking_alert_recipients` starts empty — no staff alerts queue until a Full Admin adds addresses.
6. `supabase/tests/*.sql` files have never been executed against a real PostgreSQL/Supabase instance (PGlite covers schema logic only).

---

## 3. Phase boundaries (verbatim intent from the PDF)

- **Phase 2 is separate:** customer booking templates/outbox = 2D, staff booking notifications = 2E, security/retention/production acceptance = 2F. Do not fold 2F work into Phase 3-5 sprints except where this plan explicitly gates on it.
- **Inbound mail uses domain forwarding.** Do NOT build inbox storage, message archives, inbound processing, threading or an in-site inbox unless scope formally changes. The investigation's Cloudflare Worker inbox design (section 11 of `ADMIN_OPERATIONS_EMAIL_ARCHITECTURE.md`) is **superseded** by this decision.
- **Infrastructure:** identify the real hosting/scheduler and review cost/security before adding paid workers or cron services.
- **Testing:** controlled test bookings and addresses only, until production activation is approved.
- **Completion requires evidence:** implementation + automated tests + security review + owner acceptance — not screens or templates alone.

---

## 4. Phase 3 — Reviews and Moderation

**Objective (PDF):** deliver a complete review workflow that protects customers and gives administrators controlled publishing tools.

**Acceptance gate (PDF):** verify anonymous submission, spam/invalid input, role permissions, moderation, immutable history, audit records, accessibility and proof that unapproved reviews never appear publicly.

**Requirements:** SRS REV-01 (P0), SRS section 7 role interpretation (Operational Admin moderates + replies; Full Admin overrides), SRS section 6 entity `review_submissions`, SRS section 8 contract `POST /api/reviews`, SRS AT-17 and AT-28.

**Design reference:** investigation sections 8-9 (state model, recommended columns). Adopt its state machine:

```text
submission:  pending -> approved | rejected
             rejected -> pending        (Full Admin re-open, audited, reason required)
publication: none -> published          (from approved)
             published -> unpublished   (audit + reason)
             published -> published v2  (edited publication version; original retained)
reply:       none -> draft -> published
             draft <-> draft (edit) ; published -> new draft -> published v2
```

### 4.1 Sprint 3A — Review persistence and public submission

**Status:** IN PROGRESS. Execution record: `docs/implementation/SPRINT_3A_REVIEW_PERSISTENCE.md`.

**Objective:** replace the demo `Lead` path with a durable, RLS-protected `review_submissions` table and a real public submission endpoint.

**Deliverables:**

1. **Migration** `supabase/migrations/<ts>_review_submissions.sql`:
   - Table `public.review_submissions` with: `id uuid PK`, `customer_name text NOT NULL` (1-120), `body_original text NOT NULL` (1-4000, immutable after insert), `rating smallint NULL CHECK (1..5)`, `branch text NULL`, `consent boolean NOT NULL`, `consent_version text NOT NULL`, `notice_version text NULL`, `source_ip_hash text NULL`, `moderation_status` enum `('pending','approved','rejected')` default `'pending'`, `moderated_by/at`, `moderation_note`, `body_published text NULL`, `published_at/by`, `published_version int`, `reply_body text NULL`, `reply_status` enum `('none','draft','published')` default `'none'`, `reply_published_at/by`, `version int NOT NULL DEFAULT 1`, `created_at/updated_at`, `deleted_at` (soft-delete hook for retention later).
   - Append-only trigger on `body_original`/`customer_name`/`created_at` (original submission is immutable; publication columns stay editable).
   - Indexes: `(moderation_status, created_at desc)`, `(published_at desc) where moderation_status='approved'`, `updated_at`.
   - RLS enabled; **no `anon`/`authenticated` write policies**; read policy for administrators only (`private.current_admin_role() IS NOT NULL`), plus a narrowly-scoped public read of **approved + published rows only** used by the site (or a `security_invoker` view — decide in sprint and document the choice; never expose drafts).
   - Grants: `anon` gets only the `SECURITY DEFINER` submit function (mirroring `booking_submit`), never table `INSERT`.
2. **Migration** `<ts>_review_functions.sql`: `public.review_submit(...)` (SECURITY DEFINER, `search_path=''`, execute revoked from PUBLIC/anon/authenticated, granted to `service_role`) performing validation, spam checks, idempotency-key dedup and insert in one transaction. Reuse `private.insert_audit_event` for `review.submitted`.
3. **Endpoint** `src/app/api/reviews/route.ts` — copy the `POST /api/bookings` adapter shape: `checkRequestOrigin`, shared DB rate limiter (new rule: e.g. 5 submissions / hour / hashed IP + global), idempotency-key header, `MAX_BODY_BYTES`, hashed IP (never raw), error taxonomy with `correlationId`, `Cache-Control: no-store`, fail closed when `REVIEW_SUBMISSIONS_ENABLED` is not `true` or Supabase is unconfigured.
4. **Server module** `src/lib/reviews/` — `submission.ts` (pure validation rules: name 1-120, body 1-4000, rating 1-5 optional, consent required, honeypot field, link-count/spam heuristics), `config.ts` (feature flag + notice version reader, mirroring `src/lib/bookings/config.ts` + `notice.ts`), `repository.ts`.
5. **Public form wiring** `src/components/forms/public-form.tsx` — `kind="review"` submits to the new endpoint when live; demo mode keeps the in-memory path; production without the flag keeps the honest "Online submissions are not active yet" notice. Consent wording stays `copy("15", "Permission")` (already-approved copy; no invented legal text).
6. **Env additions** (`.env.example` documented, values commented): `REVIEW_SUBMISSIONS_ENABLED`, `REVIEW_NOTICE_VERSION`, optional `REVIEW_RATE_LIMIT_MODE`.
7. **Demo store retention:** `mock-store.ts` review functions remain for demo preview only; mark with the existing demo-only conventions.

**Tests:** `tests/review-submission.test.ts` (pure rules, spam heuristics, idempotency decisions), `tests/review-submissions-db.test.ts` (PGlite: migration applies, immutability trigger, RLS privilege matrix, submit function grants), `supabase/tests/sprint_3a_review_security.sql` (full-schema operator script: anon cannot insert/update, public read excludes drafts, submit fn service_role-only), endpoint smoke via built server (401/403/429/415 paths, disabled-flag 503).

**Acceptance criteria:**

- [ ] Anonymous submission persists and is `pending`; nothing public changes.
- [ ] Invalid input, honeypot, oversize body and rate-limit flood are rejected with stable codes; no raw IP stored or logged.
- [ ] Same idempotency key never creates a second row; altered payload with same key = conflict.
- [ ] Unconfigured/disabled deployment fails closed (no demo fallback in production).
- [ ] `npm run check` green; new tests recorded in the sprint MD.

**Non-goals:** moderation UI, replies, public display changes, booking association.

---

### 4.2 Sprint 3B — Moderation console, publication and audit

**Status:** CODE COMPLETE — execution record: `docs/implementation/SPRINT_3B_REVIEW_MODERATION_AUDIT.md`.

**Objective:** give administrators the queue, detail view, decisions, publication control and immutable, audited history described in the PDF.

**Deliverables:**

1. **Migration** `<ts>_review_moderation_functions.sql`: transactional `SECURITY DEFINER` functions, each writing `audit_events` in the same transaction (pattern: `staff_change_role`):
   - `review_moderate(id, decision, note, expected_version)` — pending -> approved/rejected, actor verified against active `admin_profiles`.
   - `review_publish(id, action, expected_version)` / `review_set_publication` — publish, unpublish, publish edited version (`body_published` only; `body_original` untouched).
   - `review_open(id, reason, expected_version)` — rejected -> pending, Full Admin only, reason mandatory.
   - `review_override(id, operation, reason, expected_version)` — Full Admin only (`reviews.override`), mandatory reason, distinct audit action `review.override_*`, visually distinct UI affordance (never the default button).
   - All reject stale `version` with a conflict code (no silent overwrite).
2. **Admin UI overhaul** `src/components/admin/reviews.tsx` (keep design system, no new CSS):
   - Queue with filters: status, branch, rating, date range, search; includes decided reviews (not only `new`).
   - Detail view (route `/admin/reviews/<id>` — inherits `reviews.read` via prefix match; use the existing `segments[1]` pattern from `Enquiries`).
   - Actions: approve, reject (note required for reject), publish/unpublish, edit publication version (original shown read-only beside the editor), re-open (Full Admin), override (Full Admin, reason dialog).
   - Optimistic concurrency: stale write -> conflict notice + reload, mirroring booking save conflicts.
   - Accessibility: native `<dialog>`, labelled controls, `aria-busy`, keyboard operable, scrollable table wrapper (copy `/admin/staff`).
3. **Audit presentation:** decisions/replies/overrides visible in a history panel on the detail view (read via existing audit query pattern used by `/api/admin/staff?events=1`).
4. **Server actions** `src/lib/reviews/actions.ts` — session -> capability (`reviews.moderate` / `reviews.override`) -> `checkRequestOrigin` -> rate limit -> validation -> trusted RPC; `ReviewErrorCode` taxonomy (no raw SQL/provider text).
5. **Dashboard honesty:** update `PARTIAL_DATA_NOTICE` in `src/lib/features.ts` once reviews are live; update dashboard "Reviews awaiting approval" shortcut to real counts (`src/components/admin/admin-app.tsx`).

**Tests:** `tests/review-moderation.test.ts` (state machine legal/illegal transitions, version conflicts, permission matrix incl. override denied to Operational Admin), `tests/review-moderation-db.test.ts` (PGlite: functions + audit rows + immutability), `supabase/tests/sprint_3b_review_moderation.sql`, extend `tests/permissions.test.ts` for the new detail route.

**Acceptance criteria:**

- [ ] Operational Admin can moderate and reply; cannot override, cannot re-open a rejected review (registry-enforced at server + DB).
- [ ] Every decision/override writes `audit_events` with actor, before/after, reason and correlation id in the same transaction as the change.
- [ ] Concurrent edits: first wins, second gets a conflict — never a silent overwrite.
- [ ] Original submission bytes are unchanged after any publication edit (DB assertion).
- [ ] `npm run check` green.

**Non-goals:** public replies display, spam scoring beyond 3A heuristics, review-booking linking (open decision, section 9).

---

### 4.3 Sprint 3C — Replies, public display hardening and Phase 3 acceptance

**Status:** CODE COMPLETE — execution record: `docs/implementation/SPRINT_3C_REVIEW_REPLIES_PUBLIC_DISPLAY.md`; acceptance matrix: `docs/implementation/PHASE_3_ACCEPTANCE.md` (hosted execution, manual QA and owner sign-off pending).

**Objective:** deliver draft replies, the hardened public read path, and close the PDF acceptance gate.

**Deliverables:**

1. **Reply workflow:** draft -> edit -> publish (capability `reviews.reply`, held by both roles); published replies visible publicly under the review; new draft over published reply keeps prior text audited. Server functions + audit actions `review.reply_drafted`, `review.reply_published`.
2. **Public read path:** `PublishedReviews` reads only approved + published + consent rows (live DB when configured, demo store otherwise); renders `body_published` (not `body_original`) and published replies; **React text escaping only — never `dangerouslySetInnerHTML`** for customer text.
3. **Leak proofing:**
   - Public endpoint/JSON payloads contain no pending/rejected rows, no `source_ip_hash`, no moderation notes, no reply drafts (automated test against the built server).
   - `noindex` on `/admin/*` and on any preview URL; sitemap/robots contains only public routes; no review markup with PII (SEO-01).
   - Verify RLS denies `anon` reads of unpublished rows even if a query is crafted (SQL test).
4. **Media/safe content handling:** confirm no rich-text path exists for customer input; if publication editing introduces HTML, server-side allow-list sanitisation only (reuse `sanitize-html` pattern from `sanitizeManualEmailHtml`) — default is plain text.
5. **Accessibility pass** on the full reviews flow (queue, detail, dialogs, public cards) against SRS section 11: keyboard, focus, labels, error summaries, reduced motion, 320px no-overflow.
6. **Phase 3 acceptance evidence:** a written matrix mapping every PDF gate item (anonymous submission, spam/invalid, role permissions, moderation, immutable history, audit records, accessibility, no public leaks) to test names + manual QA steps; create `docs/implementation/PHASE_3_ACCEPTANCE.md`.

**Tests:** `tests/review-public-display.test.ts` (filter logic, escaping), `tests/review-api-leak.test.ts` (HTTP: public surface never returns unapproved data), `supabase/tests/sprint_3c_review_public_rls.sql`, extend PGlite integration test to drive submit -> moderate -> publish -> reply end-to-end.

**Acceptance criteria (PDF gate):**

- [ ] Anonymous submission verified end-to-end against a disposable database.
- [ ] Spam/invalid input rejected (honeypot, limits, rate limit, content heuristics).
- [ ] Role permissions proven at server and DB for every review action.
- [ ] Moderation + immutable history + audit records proven by tests.
- [ ] Unapproved reviews and draft replies provably unreachable publicly (automated).
- [ ] Accessibility checklist executed and recorded.
- [ ] `npm run check` green; Phase 3 acceptance doc written.

**Non-goals:** richer spam scoring, review-booking links, photo attachments on reviews.

---

## 5. Phase 4 — Email Reliability and Administration (redrafted)

**Objective (revised):** make the already-delivered outbound email pipeline production-reliable and operationally visible. No new send surfaces: one-off admin emails move to owner-operated Gmail Send As; the in-app composer is decommissioned.

**Acceptance gate (PDF, restated against redraft):** controlled tests verify template IDs, headers, variables, permissions, retries, duplicate suppression and failure isolation; scheduling deployed; DNS authentication attested by owner verification; production secrets proven absent from the client bundle. Attachment-limit items are N/A (composer removed).

**Owner decisions applied (26 October 2026):**
1. Scheduler gap confirmed and in scope (Sprint 4A) — this is the phase's critical path.
2. Domain DNS (SPF/DKIM/DMARC) configured and deliverability tested by owner — no DNS runbook sprint; attestation + evidence recorded at acceptance (4C).
3. In-app composer scrapped; Gmail Send As is the one-off admin send mechanism — no drafts, attachments, composer-outbox integration, or composer sent-history (was old Sprint 4A).
4. Template registry, variable-contract harness and controlled resend retained (Sprint 4B).
5. Domain verification treated as satisfying the PDF's DNS authentication gate item.

**Baseline:** 2D/2E already delivered outbox, worker, retries, dead-letter, webhook delivery events, monitoring UI, retry endpoint, sender picker and rich-text composer. The redrafted phase closes: no scheduler (blocker #3), no template-configuration visibility, no deliberate resend of sent rows, composer decommission, acceptance evidence. Removed versus the original plan: composer workflow/attachments/drafts/audit, DNS/authentication runbook, production-secrets document (folded into a bundle-grep + env inventory inside the acceptance doc), standalone inbound-forwarding runbook (superseded by owner-operated Gmail).

**Superseded design note (unchanged):** investigation section 11 (Cloudflare inbox) and any `inbound_emails` table remain OUT OF SCOPE per the PDF (domain forwarding instead).

### 5.1 Sprint 4A — Scheduler deployment

**Status:** NOT STARTED.

**Objective:** the outbox must drain without depending on HTTP-response post-commit kicks (blocker #3). Today `dispatchPendingEmails` only runs after a booking/admin response and drains a few rows; `/api/internal/email/worker` exists but nothing invokes it on a schedule.

**Deliverables:**

1. **Scheduler decision** (owner cost/security review required first — PDF: "identify the real hosting/scheduler and review cost/security before adding paid workers"):
   - Options: (a) hosted cron (`vercel.json` or current host equivalent) invoking `GET/POST /api/internal/email/worker` with `EMAIL_WORKER_SECRET`, (b) Supabase scheduled function, (c) external uptime/ping cron. Current host is Vercel in dev, Cloudflare in production post-validation (open question #10) — confirm runtime compatibility with the chosen mechanism.
   - Record the decision with cost and security notes in the sprint doc before implementing.
2. **Implement** the chosen mechanism; the worker endpoint stays secret-authenticated, `Cache-Control: no-store`, and concurrency-safe (leases already exist).
3. **Config-shape test** `tests/email-scheduler-config.test.ts` validating the cron/secret wiring (env present, endpoint path, secret required).
4. **Controlled drain proof:** an outbox row enqueued while the site receives no other traffic is delivered within one scheduler interval with no admin/browser action; a lost post-commit kick recovers on the next tick.

**Tests:** `tests/email-scheduler-config.test.ts`; re-run existing worker/outbox tests; record the controlled drain proof in the sprint MD.

**Acceptance criteria:**

- [ ] Scheduler decision recorded with cost/security review; implemented (or an explicitly owner-owned deployment step documented with exact commands).
- [ ] Worker endpoint rejects invocations without `EMAIL_WORKER_SECRET`.
- [ ] Idle-queue drain proof recorded (row enqueued with no traffic → delivered within one interval).
- [ ] Concurrent invocations remain safe (lease behaviour unchanged).
- [ ] `npm run check` green.

**Non-goals:** composer work, DNS changes, inbound persistence, paid infrastructure without owner approval.

---

### 5.2 Sprint 4B — Template visibility, variable contracts, controlled resend, composer decommission

**Status:** NOT STARTED.

**Objective:** close the PDF's "saved templates, dynamic variables, queue/outbox, retries, failure visibility and controlled resend" list against what 2D/2E already built; remove the in-app composer per owner decision.

**Deliverables:**

1. **Template registry panel** (Settings or Email Delivery, Full Admin): shows every configured customer + staff template ID variable from `src/lib/email/config.ts` with configured/missing state — turning blocker "unconfigured IDs silently consume retries" into visible configuration status. Missing IDs show a clear warning and block "Send test" for that template.
2. **Dynamic variables verification harness:** per-template sample payload generator behind an admin-only, rate-limited "Send test" action that enqueues a real test outbox row with realistic `params.*` — implements `BREVO_SIX_TEMPLATE_PARAMETER_AUDIT.md` as executable checks (assert every required param key exists before send; missing optional values omitted, never invented).
3. **Controlled resend:** extend the existing retry surface so an already-`sent` row can be deliberately resent as a **new** outbox row with a new idempotency key and audit action `email.resent` — duplicates become deliberate and traceable, never accidental.
4. **Duplicate suppression proof:** tests asserting the existing unique key `(booking_id, template, booking_version, recipient_email)` + deterministic keys + provider idempotency-key reuse mean replays never double-send.
5. **Failure isolation proof:** tests that a provider failure/timeout leaves the booking or admin action untouched, one bad recipient doesn't block fan-out (existing `staff-order-alerts` pattern), and dead-lettered rows remain visible + requeueable.
6. **Headers:** verify `Reply-To`/`From` behaviour — sends use the verified domain sender; recipients can never set `From` (lock with a test).
7. **Composer decommission** (owner decision: Gmail Send As for one-off admin emails):
   - **Remove:** `/admin/email-compose` UI (`src/components/admin/email-compose.tsx`), API route `src/app/api/admin/email-compose/route.ts`, `EmailSenderPicker` component (`src/components/admin/email-sender-picker.tsx`), nav/permissions href in `src/lib/auth/permissions.ts`, the `email-compose` case in `src/components/admin/admin-app.tsx`, and `sendManualBrevoEmail` / sender-list helpers in `src/lib/email/manual.ts` once nothing else imports them.
   - **Retain:** `sanitizeManualEmailHtml` (move to a shared module — Sprint 3C and Phase 5 reuse the sanitisation pattern) and `email-rich-text-editor.tsx` (Phase 5C reuse) unless 5C elects its own editor.
   - **Update tests:** `tests/email-compose.test.ts` (keep sanitizer coverage, drop manual-send tests), `tests/permissions.test.ts` (remove `/admin/email-compose` expectations).
   - **Clean CSS:** remove `.email-sender-picker*` and `.email-compose-message` rules if present.
   - **Honest notice:** Email Delivery page notes that one-off admin emails are sent by the owner via Gmail Send As, not from the app.

**Tests:** `tests/email-templates-contract.test.ts`, extend `tests/email-delivery.test.ts` / `email-webhook.test.ts`, `tests/email-resend.test.ts`, composer-removal assertions (route 404, no nav entry, no dead imports).

**Acceptance criteria:**

- [ ] Template configuration status visible; unconfigured state cannot silently burn retries without a warning.
- [ ] Test send exercises real variable contracts; missing required params caught before send.
- [ ] Resending a sent row is deliberate, audited (`email.resent`), and uses a new idempotency key.
- [ ] Replay/duplicate/failure-isolation tests green.
- [ ] `/admin/email-compose` returns 404; no nav entry; no dead imports; no manual-send code path left in the bundle.
- [ ] `npm run check` green; all pre-existing outbox/webhook tests still pass.

**Non-goals:** creating/editing templates inside Brevo (owner does that in the Brevo account using `docs/emails/*.html` drafts); any replacement compose UI; attachments/drafts/sent-history (removed with the composer).

---

### 5.3 Sprint 4C — Phase 4 acceptance (compressed)

**Status:** NOT STARTED.

**Objective:** produce the PDF's acceptance evidence against the redrafted gate.

**Deliverables:**

1. `docs/implementation/PHASE_4_ACCEPTANCE.md` mapping every gate item to evidence:

| Gate item | Evidence |
| --- | --- |
| Template IDs | registry panel test + config status log |
| Headers | sender/Reply-To tests |
| Variables | contract harness tests |
| Permissions | Operational Admin 403 tests (route, API, actions; composer route no longer exists) |
| Attachment limits | N/A — composer removed by owner decision (record) |
| Retries | backoff/dead-letter/reap tests (existing + new) |
| Duplicate suppression | replay/idempotency tests |
| Failure isolation | fan-out + booking-untouched tests |
| DNS authentication | **owner attestation:** domain configured (SPF/DKIM/DMARC) and deliverability tested — record date, method, and test evidence (live test addresses); no further sprint work |
| Production secrets | bundle grep: `BREVO_API_KEY` / `EMAIL_WORKER_SECRET` / `BREVO_WEBHOOK_SECRET` absent from client code; env inventory (server-only vars + where each lives) listed in the acceptance doc |
| Scheduling | Sprint 4A decision + deployment/drain evidence |

2. **Inbound mail note** (one paragraph in the acceptance doc): one-off admin replies are sent via Gmail Send As; record where mail addressed to the domain lands (owner Gmail mailbox, open question #7) and include grep proof that no inbox code exists (no `inbound_emails` table, no inbox routes). The standalone `INBOUND_FORWARDING.md` runbook is dropped — superseded by owner-operated Gmail.
3. Full regression run: `npm run check` (typecheck, lint, all tests, build) + HTTP smoke of public site and admin routes in both demo and production modes.
4. Security review pass over Phase 4 code (checklist in section 7) with findings fixed or recorded.
5. Owner sign-off section (blank until owner completes).

**Acceptance criteria:** all rows evidenced or explicitly marked BLOCKED-ON-OWNER; no silent gaps.

---

## 6. Phase 5 — Newsletter and Campaigns

**Objective (PDF):** build a consent-aware subscriber system connected to Brevo marketing campaigns.

**Acceptance gate (PDF):** test consent capture, duplicate signup, unsubscribe, suppression, permissions, access boundaries and campaign audience selection.

**Requirements:** SRS NEWS-01 (P1), SRS section 6 entity `newsletter_interest`, SRS section 8 contract `POST /api/newsletter-interest` with generic duplicate response, SRS AT-19, PRD "do not count bookings as subscribers".

**Critical baseline fact:** there are NO real subscribers — demo `Lead` records are lost on refresh and are not migratable. The system starts genuinely empty. Collection cannot activate until the owner approves marketing-consent wording (open question #4) and retention (open question #5).

### 6.1 Sprint 5A — Consent foundation and subscriber persistence

**Objective:** durable, consent-versioned subscription state, separate from bookings, with the public signup endpoint and admin subscriber views.

**Deliverables:**

1. **Migration** `<ts>_newsletter_interest.sql`:
   - `public.newsletter_interest`: `id uuid PK`, `email text NOT NULL` (normalised lower-case, unique index), `status` enum `('active','withdrawn','unsubscribed','suppressed')`, `consent_version text NOT NULL`, `consent_text text NOT NULL` (exact wording shown), `source text NOT NULL` (form/route), `created_at`, `updated_at`, `withdrawn_at`, `unsubscribe_token_hash` (nullable, unique), `suppression_reason` (nullable), `brevo_contact_id` (nullable).
   - RLS enabled; **no anon/authenticated policies at all** (SRS: access private; consented creation only via trusted function).
   - Retention columns/trigger hooks consistent with "subscriber retention separate and must be approved" — no automatic purge until owner approves a period.
2. **Migration** `<ts>_newsletter_functions.sql`: `newsletter_subscribe(...)` (idempotent dedup: existing `active` -> generic success, no enumeration; existing `withdrawn/unsubscribed` -> requires renewed consent to reactivate; `suppressed` -> refuses re-entry), `newsletter_withdraw(...)`, all with `service_role`-only execute; audit action `newsletter.subscribed`/`newsletter.withdrawn` (payload: email hash or email per audit PII rules — follow existing payload discipline, document choice).
3. **Endpoint** `POST /api/newsletter-interest` — clone the reviews/booking adapter: origin check, rate limit, idempotency key, **identical response for new vs existing subscriber** (anti-enumeration), feature flag `NEWSLETTER_INTEREST_ENABLED`, fail closed in production without it, `notice_version`/`consent_version` server-read (never browser-supplied).
4. **Public form wiring** `public-form.tsx` `kind="newsletter"`: consent checkbox remains unchecked-by-default with approved wording (`copy("16", "Opt-in checkbox")`) + version stamp recorded server-side; demo mode unchanged; production gated on flag.
5. **Admin subscriber UI** — replace `NewsletterAdmin` data source: table of email/status/consent version/date with filters (active, withdrawn, unsubscribed, suppressed), detail dialog, Full Admin only (`newsletter.manage` already in registry), server-side read endpoint `/api/admin/newsletter` (GET only, 403 for Operational Admin, `no-store`). Keep demo rendering when in demo mode.
6. **Privacy separation proof:** automated test asserting no code path subscribes from booking submission or staff alert flows (grep-level + integration assertion that a booking with an email creates no `newsletter_interest` row).
7. **Env:** `NEWSLETTER_INTEREST_ENABLED`, `NEWSLETTER_CONSENT_VERSION` (server-only, approved wording id).

**Tests:** `tests/newsletter-consent.test.ts` (dedup, reactivation rules, enumeration-safe responses, flag gating), `tests/newsletter-db.test.ts` (PGlite: unique index, RLS zero client access, function grants), `supabase/tests/sprint_5a_newsletter_security.sql`, `tests/newsletter-privacy-separation.test.ts`.

**Acceptance criteria:**

- [ ] Subscriber created only through consented form with versioned wording; duplicate signup returns the generic response.
- [ ] Booking flow can never create a subscriber (test).
- [ ] Demo mode writes nothing durable; production without flag shows the honest inactive notice.
- [ ] Operational Admin denied the module, endpoint and actions.
- [ ] `npm run check` green.

**Non-goals:** campaigns, unsubscribe emails, suppression webhooks.

---

### 6.2 Sprint 5B — Unsubscribe and suppression

**Objective:** "provide a reliable unsubscribe flow and prevent opted-out/suppressed addresses from re-entering campaigns without valid renewed consent."

**Deliverables:**

1. **Migration** `<ts>_newsletter_unsubscribe.sql`: token generation columns/hashing (already in 5A if staged there — otherwise add), status transition constraints (`active -> unsubscribed` via token; `unsubscribed -> active` only via a fresh consented submission with a newer `consent_version`; `suppressed` cannot be reactivated by the form at all).
2. **Public unsubscribe route** `GET/POST /api/newsletter/unsubscribe` — signed, expiring, single-address tokens (HMAC or random token + hash, never the raw email in URLs); works without login; idempotent; shows a clear confirmation page; rate-limited; no open redirect; token replay safe.
3. **Suppression list:** `newsletter_interest.status='suppressed'` driven by (a) Brevo bounce/complaint webhooks (extend `/api/webhooks/brevo` to mark the matching subscriber suppressed with reason — only when an email match exists, never inventing a subscription), (b) admin manual suppression action with reason + audit.
4. **Campaign audience enforcement (shared helper):** single pure function `campaignAudience(subscribers) => only status='active' AND consent_version >= required` used by 5C — write its tests here so 5C only wires it up.
5. **One-click unsubscribe header support** if the chosen send path supports it (verify against current Brevo docs — mark "Requires current official documentation verification"); otherwise the in-body link is the mechanism.
6. **Audit:** `newsletter.unsubscribed`, `newsletter.suppressed`, `newsletter.reactivated` with actor (token = system/customer, admin = verified id) and reason.

**Tests:** `tests/newsletter-unsubscribe.test.ts` (token validity/expiry/replay, idempotency, enumeration), `tests/newsletter-suppression.test.ts` (webhook match, manual suppression, re-entry refusal), extend PGlite test with status transition CHECKs.

**Acceptance criteria:**

- [ ] Unsubscribe works end-to-end without an account; replay-safe; no PII leaked in token URLs beyond the signed capability.
- [ ] Opted-out/suppressed addresses cannot re-enter campaigns without renewed consent; suppressed cannot be reactivated by the public form at all.
- [ ] Webhook-driven suppression only affects existing subscribers; never auto-subscribes.
- [ ] `npm run check` green.

**Non-goals:** campaign sending (5C).

---

### 6.3 Sprint 5C — Brevo campaigns and Phase 5 acceptance

**Objective:** connect the approved newsletter template and campaign workflow; close the PDF gate.

**Deliverables:**

1. **Campaign data model** `<ts>_newsletter_campaigns.sql`: `public.newsletter_campaigns` (id, name, subject, preview_text, body_html (sanitised, server-side allow-list), header_asset key (use existing `public/headers/newsletter.png`), status enum `('draft','scheduled','sent','failed')`, `audience_count`, `brevo_campaign_id`, `sent_at`, `version`, timestamps, `created_by`). RLS: Full Admin read/write only; no anon.
2. **Server module** `src/lib/newsletter/campaigns.ts` + Brevo Campaigns API client (server-only, same key handling as `brevo.ts`):
   - **Prerequisite gate:** verify current Brevo Campaigns API availability/quotas on the owner's plan from official docs (open question #14) — if the plan/API cannot send programmatically, STOP and report to the owner with options (upgrade vs transactional-audience send vs deferred) rather than inventing a workaround. Record the verification with doc links and date.
   - Create draft -> test send (to a controlled address) -> send to audience (only `active` per 5B helper) -> record `brevo_campaign_id` + status; failures land in `failed` with safe error codes, never partial "sent" claims.
   - Prefer Campaigns API over N transactional sends (investigation section 13 reasoning: separate quota, native unsubscribe/suppression).
3. **Admin campaign UI** `/admin/campaigns` (new route key `campaigns` + permission `newsletter.manage` — add to `adminRoutes`/navigation/`admin-app.tsx` switch; Full Admin only): list, create/edit (rich text via existing editor component), audience preview count (active subscribers), test send, send with confirmation dialog showing exact audience size, status history, audit trail.
4. **Consent gating:** sending is refused when `NEWSLETTER_CONSENT_VERSION` is unset/unapproved or the flag is off — honest inactive state in UI (same pattern as composer's `not_configured`).
5. **Reporting basics:** sent count, audience count, suppressed/skipped counts at send time; open/click metrics only if the API exposes them without extra cost (nice-to-have, not gate-blocking).
6. **Phase 5 acceptance** `docs/implementation/PHASE_5_ACCEPTANCE.md`: gate matrix (consent capture, duplicate signup, unsubscribe, suppression, permissions, access boundaries, campaign audience selection) with test names + manual QA; full `npm run check`; security review; owner sign-off block.

**Tests:** `tests/newsletter-campaigns.test.ts` (state machine, audience filtering, consent/flag gating, permission matrix), `tests/newsletter-campaign-db.test.ts` (PGlite), `supabase/tests/sprint_5c_campaign_security.sql`, extend `tests/permissions.test.ts` for the new route.

**Acceptance criteria (PDF gate):**

- [ ] Consent capture, duplicate signup, unsubscribe, suppression tested end-to-end.
- [ ] Permissions + access boundaries proven at server and DB (Operational Admin denied campaigns).
- [ ] Campaign audience selection proven to include only `active` consented subscribers and to exclude withdrawn/unsubscribed/suppressed.
- [ ] A booking's email address is provably absent from any audience.
- [ ] `npm run check` green; acceptance doc written; owner sign-off captured or BLOCKED-ON-OWNER recorded honestly.

**Non-goals:** A/B testing, detailed analytics, scheduling beyond "send now" (defer scheduling if Brevo plan lacks it — record as follow-up), paid contact imports.

---

## 7. Hard rules (every sprint, no exceptions)

1. **Authorisation is server-side, three layers:** session re-verified (`getCurrentAdmin`) -> capability from registry -> database re-validation/RLS. Never trust client role/permission state; navigation hiding is display-only.
2. **No client-held secrets.** Elevated keys server-only; no `NEXT_PUBLIC_*` secret ever; verify with a client-bundle grep each phase.
3. **Public endpoints fail closed:** feature flag + Supabase configured + origin check + shared rate limit + idempotency + size caps + hashed IP + stable error codes with correlation ids; never raw SQL/provider text or stack traces in responses.
4. **Audit via `private.insert_audit_event` only**, in the same transaction as the change; payloads carry identifiers/roles/reasons — never bodies, attachments, tokens or credentials.
5. **RLS on every new table**, narrow policies, no client write policies for privileged data, `SECURITY DEFINER` functions with `search_path=''`, fully qualified identifiers, execute revoked from `PUBLIC`/`anon`/`authenticated` unless deliberately public (submit/subscribe), callable entry points in `public` schema guarded by grants (documented reason: Data API schema exposure).
6. **Optimistic concurrency** (`version`) on every admin-editable record; stale write = conflict, never silent overwrite.
7. **Escaped rendering only** for user/customer text (`dangerouslySetInnerHTML` prohibited for customer input); server-side allow-list sanitisation for any HTML the admin composer/newsletter produces.
8. **Demo/production honesty:** demo mode keeps working for design review; production never falls back to mock data; update `src/lib/features.ts` notices when a module goes live.
9. **Migrations are forward-only, reviewed, applied manually in filename order**; each ships a PGlite test AND a `supabase/tests/*.sql` operator script; none is applied to the hosted project by the sprint.
10. **No invented content:** legal/consent wording comes from approved copy (`docs/source/CONTENT LIGHTMODE.md`) or owner approval; no fabricated contacts, dates, prices or reviews (SRS REV-01/SEO-01).
11. **Scope discipline:** the PDF is the scope. Inbox storage, booking changes, CMS work, new roles and paid infrastructure are out unless a new phase is authorised.
12. **External API facts** (Brevo limits, Campaign API plan availability, attachment max sizes) are marked "Requires current official documentation verification" and verified against official docs at implementation time with the date recorded.

---

## 8. Global Definition of Done (per sprint)

- [ ] `npm run check` = typecheck + lint + tests + build, all green; test count recorded (baseline 318).
- [ ] New/changed migrations have PGlite tests + `supabase/tests/*.sql` scripts (marked NOT EXECUTED against hosted DB until deployment).
- [ ] Permission matrix tests extended for any new route/action (anonymous / Operational Admin / Full Admin at server entry points).
- [ ] No secrets in client bundle (grep evidence).
- [ ] Manual QA items for the sprint executed in demo mode AND production mode where applicable; narrow-viewport (320-440px) check on new UI.
- [ ] Sprint record written: `docs/implementation/SPRINT_<id>_<NAME>.md` (objective, files, schema, decisions, verification results, not-executed items — mirror the Phase 1/2 sprint format).
- [ ] `docs/IMPLEMENTATION_REVIEW.md` updated with a dated entry.
- [ ] `graphify update .` run; graph clean.
- [ ] Open decisions discovered are appended to section 9 with owner flags — never resolved unilaterally.

---

## 9. Open decisions requiring owner input (flag early, don't block unrelated work)

| # | Decision | Blocks | Source |
| --- | --- | --- | --- |
| 1 | Emergency override semantics on already-published reviews; can published reviews be unpublished? | Sprint 3B | Investigation Q8 |
| 2 | Optional booking reference on the review form (recommend: omit for now) | 3C scope | Investigation Q9 |
| 3 | Gmail Send As alias name(s) on `2ndwavelaundry.com` + mailbox owner | 4C attestation | Investigation Q3, owner Gmail decision |
| 4 | Approved marketing-consent wording + versioning scheme | **5A activation** | Investigation Q4, NEWS-01 |
| 5 | Retention periods: reviews, subscribers, outbound email history (do not inherit 12-month booking rule) | 5 activation, 4D retention notes | Investigation Q5, SRS section 10 |
| 6 | Worker runtime choice (Vercel cron vs Supabase scheduled fn vs external) + cost/security approval | **4A** | Investigation Q11, PDF infra rule |
| 7 | Where mail addressed to the domain lands (Gmail mailbox routing) | 4C note | Investigation Q12, owner Gmail decision |
| 9 | Brevo plan + Campaign API availability/quotas on free/paid tier | **5C** | Investigation Q14, PDF |
| 10 | ~~DMARC policy level~~ RESOLVED — owner configured and tested domain DNS (26 Oct 2026) | - | PDF Phase 4 |
| 11 | Demo-mode behaviour in production builds (recommend: `NEXT_PUBLIC_DEMO_MODE=false` confirmed) | final acceptance | Investigation Q15 |

*Removed:* old #8 (composer attachment policy) — composer scrapped 26 Oct 2026.

---

## 10. Planned migration inventory (forward-only, applied manually in order)

| # | Phase | File (name subject to timestamp at execution) | Purpose |
| --- | --- | --- | --- |
| 18 | 3A | `<ts>_review_submissions.sql` | Table, enums, immutability trigger, indexes, RLS |
| 19 | 3A | `<ts>_review_functions.sql` | `review_submit` + audit, grants |
| 20 | 3B | `<ts>_review_moderation_functions.sql` | moderate/publish/open/override + audit + version checks |
| 21 | 3C | `<ts>_review_replies.sql` (only if not folded into 20) | reply state functions + audit |
| 22 | 5A | `<ts>_newsletter_interest.sql` | Subscriber table + RLS |
| 23 | 5A | `<ts>_newsletter_functions.sql` | subscribe/withdraw + audit |
| 24 | 5B | `<ts>_newsletter_unsubscribe.sql` | tokens + transition constraints + suppression |
| 25 | 5C | `<ts>_newsletter_campaigns.sql` | Campaign table + RLS + functions |

*Note:* planned migration #22 (`email_composer.sql`) removed with the composer decommission — redrafted Phase 4 requires no new migrations (scheduler + panel + decommission are config/code only).

Existing migrations 1-17 (Phase 1 + 2) are unchanged; no sprint rewrites applied migrations — forward-only additions only.

---

## 11. Evidence register (fill as phases close)

| Phase | Acceptance doc | Test count | Owner sign-off | Date |
| --- | --- | --- | --- | --- |
| Phase 3 | `docs/implementation/PHASE_3_ACCEPTANCE.md` | 371 | pending | Evidence written 26 Oct 2026 |
| Phase 4 | `docs/implementation/PHASE_4_ACCEPTANCE.md` | | pending | - |
| Phase 5 | `docs/implementation/PHASE_5_ACCEPTANCE.md` | | pending | - |
| Final Production Acceptance | (owner-led; includes Phase 2F security/retention/backups/monitoring + production smoke tests per PDF order 4) | | pending | - |

---

*End of plan. Sprint 3A has started; no owner decision blocks its current scope. Continue execution and record evidence in `docs/implementation/SPRINT_3A_REVIEW_PERSISTENCE.md`.*
