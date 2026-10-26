# Phase 3 acceptance — Reviews and moderation

**Status:** CODE COMPLETE — hosted execution, manual QA and owner sign-off pending
**Date:** 26 October 2026
**Plan:** `docs/implementation/PHASE_3_TO_5_IMPLEMENTATION.md` §4
**Sprint records:** `SPRINT_3A_REVIEW_PERSISTENCE.md`, `SPRINT_3B_REVIEW_MODERATION_AUDIT.md`,
`SPRINT_3C_REVIEW_REPLIES_PUBLIC_DISPLAY.md`

This document is the Phase 3 gate evidence required by the roadmap: implementation, automated
tests, a recorded security review and owner acceptance. Rows are marked **PROVEN** (automated
locally), **PENDING** (manual/owner step) or **BLOCKED** (hosted deployment not performed).
Nothing below claims hosted or visual verification that was not executed.

## 1. Gate matrix (PDF Phase 3 acceptance)

| # | PDF gate item | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Anonymous submission persists as pending; nothing public changes | `tests/review-submission.test.ts` (validation/adapter), `tests/review-submissions-db.test.ts` (insert + pending state + audit), `supabase/tests/sprint_3a_review_security.sql`, built-server POST smoke recorded in Sprint 3A | PROVEN locally; hosted PENDING |
| 2 | Spam and invalid input rejected with stable codes, no raw IP stored/logged | `tests/review-submission.test.ts` (honeypot, limits, link threshold, rate limit), DB function assertions in `tests/review-submissions-db.test.ts`, `src/lib/reviews/submission.ts` (hashed identity only) | PROVEN |
| 3 | Role permissions at server and database for every review action | `tests/permissions.test.ts` (routes, `reviews.override` denied to Operational Admin, review detail inherited), `tests/review-moderation.test.ts` (capability map), `tests/review-moderation-db.test.ts` (re-open/override denied, disabled actor denied), `supabase/tests/sprint_3b_review_moderation.sql` | PROVEN locally; hosted PENDING |
| 4 | Moderation approve/reject, publication and replies | `tests/review-moderation-db.test.ts` (submit → approve → publish → reply → replace end-to-end), `tests/review-moderation.test.ts` (state machine/validators), `supabase/tests/sprint_3b_review_moderation.sql` | PROVEN locally |
| 5 | Immutable history: original submission and retained replies | `tests/review-submissions-db.test.ts` (name/body/created_at trigger), `tests/review-moderation-db.test.ts` (publication edits leave `body_original` intact; reply revision immutability), `supabase/tests/sprint_3c_review_public_rls.sql` | PROVEN locally |
| 6 | Audit records for submissions, decisions, publication, replies, re-open and overrides | Audit assertions in `tests/review-submissions-db.test.ts` and `tests/review-moderation-db.test.ts` (actor, before/after, reason, correlation; no customer/reply text); review-history policy in `supabase/tests/sprint_3b_review_moderation.sql` | PROVEN locally |
| 7 | Accessibility of the review flow | Static/code review recorded in §4 below: labelled controls, native dialogs, alert/status notices, `aria-busy`, table captions, scrollable table, keyboard-operable actions, plain-text rendering, no new animation | PARTIAL — manual keyboard, screen-reader, 200% zoom and 320px QA PENDING |
| 8 | Unapproved reviews and draft replies never appear publicly | `tests/review-public-display.test.ts` (projection/filter/plain text), `tests/review-api-leak.test.ts` (hostile rows and endpoint source scan), `tests/review-moderation-db.test.ts` (anonymous view excludes unapproved rows and withholds draft replies), `supabase/tests/sprint_3c_review_public_rls.sql`, built-server smoke (empty payload, `no-store`, no private markers) | PROVEN locally; live hosted RLS execution BLOCKED |

### SRS traceability

| Requirement | Evidence |
| --- | --- |
| REV-01 — pending private, explicit display permission, optional rating, approval before release, no fabricated feedback | Pending default + consent column (`20261026100000_review_submissions.sql`); public predicate; `tests/review-public-display.test.ts`; demo/production separation in `PublishedReviews` |
| AT-17 — pending review stays private; only approved permitted fields public | Gate rows 1 and 8 |
| AT-28 — abuse/flood/invalid links bounded and retryable | Gate row 2; honeypot, size caps, shared DB rate limits, stable error codes with correlation ids |
| SRS §7 — Operational Admin moderates and drafts replies; Full Admin overrides | `tests/permissions.test.ts`, `tests/review-moderation.test.ts`, `tests/review-moderation-db.test.ts` |
| SRS §8 — `POST /api/reviews` contract | `src/app/api/reviews/route.ts`, `tests/review-submission.test.ts` |
| SRS §11 — accessibility target | §4 checklist (manual QA pending) |

## 2. Automated test inventory

| File | Covers |
| --- | --- |
| `tests/review-submission.test.ts` | Public validation, honeypot, links, idempotency decisions, error taxonomy, endpoint orchestration |
| `tests/review-submissions-db.test.ts` | Table/enum/constraints, original-field immutability, RLS/grants, submit function, audit, operator SQL 3A |
| `tests/review-moderation.test.ts` | State machine, note/reason/body rules, capability map, DB marker mapping, queue filters, mappers |
| `tests/review-moderation-db.test.ts` | Migration 3B/3C, moderation, publication versioning, re-open, override, reply draft/publish/retention, audit, version conflicts, disabled actor, operator SQL 3B/3C |
| `tests/review-public-display.test.ts` | Public whitelist, pending/rejected/consent exclusion, draft-reply withholding, demo predicate, plain-text/HTML-path scan, reply validation |
| `tests/review-api-leak.test.ts` | Hostile public rows, fail-closed reads, endpoint projection scan |
| `tests/permissions.test.ts` | Review route/detail authorisation, override boundary, sign-in destination |

Operator scripts (run against a **disposable** database only):

- `supabase/tests/sprint_3a_review_security.sql`
- `supabase/tests/sprint_3b_review_moderation.sql`
- `supabase/tests/sprint_3c_review_public_rls.sql`

All three execute locally against the PGlite schema. They have **not** been executed against the
hosted Supabase project (migrations 18–21 are unapplied).

## 3. Deployment prerequisites before acceptance can close

1. Apply migrations in filename order on a disposable project first, then the hosted project:
   `20261026100000_review_submissions.sql`, `20261026100100_review_functions.sql`,
   `20261026100200_review_moderation_functions.sql`, `20261026100300_review_replies.sql`.
2. Execute the three operator SQL scripts above and retain the output.
3. Configure the approved review copy/version and activation flag:
   `REVIEW_NOTICE_VERSION` (approved wording id) and `REVIEW_SUBMISSIONS_ENABLED=true`. Until
   both are present the public form stays in its honest inactive state.
4. Confirm the owner decision #5 retention period for reviews (not inherited from the 12-month
   booking rule) before production data accumulates.
5. Confirm open decision #1 (whether/when a published review may be unpublished, and the emergency
   override policy) and open decision #2 (booking reference on the form — currently omitted).

## 4. Accessibility review (code-level, executed)

| Item | Result |
| --- | --- |
| Queue filters and actions labelled | PASS — `Field`/`TextField` labels on search, status, branch, rating, dates, dialogs and reply editor |
| Dialogs | PASS — native `<dialog>` via `src/components/dialog.tsx`, labelled title, Escape/backdrop close, focus return |
| Status feedback | PASS — `Notice` uses `role="status"`/`role="alert"`, error notices focus; `aria-busy` on busy action panels |
| Table semantics | PASS — `<caption class="sr-only">`, header row, `.table-wrap` horizontal scrolling |
| Keyboard | PASS by construction (native buttons/inputs/selects); manual tab-order run PENDING |
| Plain text, no HTML | PASS — review body/reply rendered as React text; source scan forbids the HTML attribute |
| Text zoom / 320px reflow | PENDING — owner/QA visual check on the queue, detail, dialogs and public cards |
| Screen reader announcements | PENDING — manual run (NVDA/VoiceOver) |
| Reduced motion | PASS — no new animation in the review flow |

## 5. Manual QA script (owner/QA, demo and production/staging)

1. **Anonymous submission** — open `/reviews/share`, submit a consented review. Confirm the success
   notice, then confirm the review is absent from `/reviews` and sits at the top of `/admin/reviews`
   as Pending.
2. **Invalid/spam** — submit with no consent, over-long text, more than two links and an oversized
   payload; confirm field-level errors and stable codes, no stack traces, and no repeated click
   double-submission.
3. **Decision** — as Operational Admin, reject without a reason (blocked), reject with a reason,
   approve another review. Confirm decisions appear in the history panel with actor, reason and
   timestamp.
4. **Publication** — publish the approved review with edited public text; confirm the original text
   is unchanged beside the editor and `/reviews` shows the public version (not the original).
5. **Reply** — save a reply draft; confirm it is not public. Publish it; confirm it appears under
   the review. Draft a replacement; confirm the review stays visible without the reply, the prior
   reply text is retained, and publishing the new draft shows the new reply.
6. **Permissions** — as Operational Admin, confirm re-open and override controls are absent and the
   direct action endpoints deny them. As Full Admin, re-open a rejection and apply an override with
   a reason; confirm `review.override_*` appears in history.
7. **Leak checks** — request `/api/reviews/public` directly and confirm only published fields
   (`id, name, rating, branch, body, publishedAt, publishedVersion, reply, replyPublishedAt`), no
   pending/rejected rows, originals, notes, hashes or draft replies. Confirm `no-store`.
8. **Accessibility/viewport** — complete steps 1–6 with keyboard only at 320px and 200% zoom;
   check focus visibility, dialog focus return, error announcement and no horizontal page overflow.
9. **Mode honesty** — in demo mode confirm sample reviews still render; with production demo mode
   disabled and no flag/notice configured, confirm the honest inactive notice and no sample data.

## 6. Security review pass (Sprint 3C)

- Review functions are `SECURITY DEFINER`, `search_path = ''`, fully schema-qualified, executable
  only by `service_role`, and independently re-validate the acting administrator.
- Anonymous access remains column-narrowed on the base table; the only public read path is the
  `security_invoker` view plus the whitelist projection. Draft replies are hidden in the view and
  again in the projection.
- Reply revisions are RLS-protected, append-only and never exposed to `anon`.
- No raw database/provider text reaches a public or administrative response; audit payloads contain
  no customer/admin bodies or IP hashes.
- No new client secrets; the public endpoint uses only the publishable key and server-side reads.

## 7. Owner sign-off

| Item | Owner | Date | Notes |
| --- | --- | --- | --- |
| PDF gate items verified | | | Pending hosted execution and manual QA |
| Consent wording/version approved | | | `REVIEW_NOTICE_VERSION` must reference approved copy |
| Retention period approved | | | Open decision #5 |
| Production activation approved | | | Keep `REVIEW_SUBMISSIONS_ENABLED` off until the above are complete |

Phase 3 is **not** accepted until the PENDING/BLOCKED rows above are executed and this table is
completed.
