# Sprint 3C — Replies, public display hardening and Phase 3 acceptance

**Status:** CODE COMPLETE — Phase 3 acceptance evidence written; hosted execution and manual QA pending
**Started:** 26 October 2026
**Plan:** `docs/implementation/PHASE_3_TO_5_IMPLEMENTATION.md` §4.3

## Objective and scope

Complete the Phase 3 review workflow: draft and publish administrative replies, render only
published review content on the public site, prove that unapproved records and draft replies
cannot leak, and produce the PDF acceptance matrix (`docs/implementation/PHASE_3_ACCEPTANCE.md`).
Phase 4 is untouched.

## Decisions

- **Reply state machine is database-enforced.** `review_draft_reply` creates or edits a draft;
  `review_reply_publish` publishes it. Publishing requires the review itself to be approved,
  consented and published, so a reply can never make an unpublished review visible. Drafts are
  internal and never rendered publicly.
- **Prior published reply text is retained outside the audit log.** A new draft over a published
  reply copies the prior text into the append-only `public.review_reply_revisions` table. The
  project's hard rule forbids bodies in `audit_events` payloads, so audit records the
  `published -> draft -> published` transitions only. Revisions are administrator-readable,
  append-only, and never exposed to `anon`.
- **Public surface refinement (forward-only).** Sprint 3A hid the whole review while a reply was a
  draft. Because 3C allows a replacement reply to be drafted over a published one, the public
  predicate now keeps the approved publication visible and withholds only the draft reply. The
  view's `CASE` exposes `reply_body` exclusively for `reply_status = 'published'`.
- **The public read is a whitelist, not a filter.** `/api/reviews/public` reads the
  `security_invoker` view with the public publishable-key client, then projects rows through
  `PublicReview` in `src/lib/reviews/public.ts`. Pending/rejected rows, the original submission,
  moderation notes, IP hashes, idempotency metadata and draft replies are not selected and cannot
  be projected even if a view or query regresses.
- **Customer and admin reply text is plain text.** Rendering uses React text nodes only; there is
  no `dangerouslySetInnerHTML` path for review content. The public endpoint is `no-store` so an
  unpublish is immediate.
- **Demo/production honesty.** Demo mode keeps the in-memory approved/consented reviews through
  the same renderer. A live read failure shows the honest empty state — never sample reviews or a
  database message. The admin reply editor is live-only (the demo store has no audit history).
- **Open decision #2 (booking reference on the review form) is not resolved here.** No booking
  reference was added to the public form or schema.
- **No SEO indexing was introduced.** The site remains `noindex` (root layout, `/admin` and the
  public catch-all), and `robots.ts` disallows everything while the site awaits launch approval.
  Review content is client-fetched, so it is absent from server-rendered HTML; there is no
  review structured-data markup.

## Implementation record

- `supabase/migrations/20261026100300_review_replies.sql`: public predicate/view refinement,
  append-only `review_reply_revisions`, `review_draft_reply`, `review_reply_publish`, immutable
  triggers, RLS and service-role-only grants.
- `src/lib/reviews/public.ts`: public whitelist projection, published/draft reply rules, demo
  predicate and the bounded list.
- `src/lib/reviews/public-service.ts`: server-only reader with an injectable row source (used by
  the leak tests) and fail-closed results.
- `src/app/api/reviews/public/route.ts`: public GET (empty list on failure, `no-store`), POST 405.
- `src/components/published-content.tsx`: `PublishedReviews` now uses the live endpoint outside
  demo mode, renders `body_published` and published replies as text, and keeps the demo store in
  demo mode.
- Reply workflow: `src/lib/reviews/moderation.ts` (reply validation), `src/lib/reviews/errors.ts`
  (`invalid_reply`), `src/lib/reviews/admin.ts` (reply fields), `src/lib/reviews/admin-service.ts`
  (reply RPCs, detail columns), `src/lib/reviews/actions.ts` (`draftReplyAction`,
  `publishReplyAction` under `reviews.reply`), `src/components/admin/reviews.tsx` (reply panel,
  published-reply display, audit labels, table captions, dialog field error wiring).
- `supabase/tests/sprint_3c_review_public_rls.sql`: operator checks for the view, column exposure,
  reply revisions, grants and immutability.
- Tests: `tests/review-public-display.test.ts`, `tests/review-api-leak.test.ts`, extended
  `tests/review-moderation-db.test.ts` (end-to-end submit → approve → publish → reply → replace)
  and `tests/review-moderation.test.ts`.
- `docs/implementation/PHASE_3_ACCEPTANCE.md`: the PDF gate matrix, evidence names, manual QA
  script and readiness gaps.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 errors; 5 pre-existing warnings |
| Full `npm test` | PASS — 371 tests |
| `npm run check` (typecheck, lint, tests, build) | PASS — production build compiled |
| PGlite: migrations 3A–3C, reply flow, retention, draft-reply withholding, audit, immutability | PASS |
| Operator SQL (`sprint_3a/b/c`) against local PGlite schema | PASS — **NOT EXECUTED against hosted Supabase** |
| Public display/leak tests (hostile rows, key whitelist, source scan) | PASS |
| Built-server smoke (`npm start`): `/api/reviews/public` | 200 `{"reviews":[]}`, `cache-control: no-store`; POST 405 |
| Built-server smoke: `/reviews` | 200, no `body_original`/`source_ip_hash`/`moderation_note` markers in HTML |
| Hosted Supabase migration/operator SQL | Not executed — deployment-owned |
| Manual accessibility/keyboard/screen-reader/320px QA | Pending (owner/QA) |

## Acceptance checklist

- [x] Draft → edit → publish replies; a new draft over a published reply retains the prior text.
- [x] Published replies appear publicly under the review; draft replies never do.
- [x] Public display shows `body_published` only, plain text, and the demo path is unchanged.
- [x] Public endpoint projects a whitelist and fails closed; no pending/rejected rows, originals,
      notes, IP hashes or draft replies in any automated payload assertion.
- [x] RLS/operator SQL asserts the published-only predicate, column grants and service-role-only
      reply functions (locally).
- [x] No rich-text path exists for customer input or replies.
- [x] Static accessibility review completed for the new controls (labels, native dialogs,
      `aria-busy`, alert/status notices, table captions, scrollable table, keyboard-operable
      buttons); manual assistive-technology/320px QA is recorded as pending.
- [x] `npm run check` green; Phase 3 acceptance matrix written.
- [ ] Hosted migrations applied; operator SQL executed against a disposable PostgreSQL instance.
- [ ] Owner manual QA and Phase 3 sign-off.
- [ ] Open decisions #1 (published-review unpublish/override policy), #2 (booking reference) and
      #5 (review retention period) confirmed before production activation.

## Deferred / not executed

- Hosted migrations remain unapplied, following the plan's deployment boundary.
- The built-server smoke ran in the repository's current preview configuration, so the public
  endpoint correctly returned the empty list without querying a hosted project; a live row-level
  payload was exercised through PGlite and the injectable reader instead.
- No browser automation, screenshots or screen-reader runs were performed.
- Phase 4 work remains untouched.
