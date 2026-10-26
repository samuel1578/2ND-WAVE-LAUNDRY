# Sprint 3A — Review persistence and public submission

**Status:** IN PROGRESS  
**Started:** 26 October 2026  
**Plan:** `docs/implementation/PHASE_3_TO_5_IMPLEMENTATION.md` §4.1

## Objective and scope

Replace the live review form's demo-only path with a durable, private review submission flow. Demo mode remains on the existing in-memory path. This sprint does not add the moderation UI, replies, or change the public reviews display; those remain in 3B/3C.

## Decisions

- Public clients receive a `security_invoker` view (`public.published_reviews`) and only column-level `SELECT` on the fields needed for that view. Base-table RLS additionally filters to approved, consented, published, non-deleted rows. Anonymous clients cannot select the original body, moderation note, source-IP hash, or idempotency metadata.
- `review_submit` is callable only by `service_role`, not directly by `anon` or `authenticated`; the Next.js API route performs origin, validation, rate-limit and activation checks, then uses the existing server-only elevated client. No browser role receives table-write privileges.
- The review consent/notice version is server-configured with `REVIEW_NOTICE_VERSION`. The feature remains unavailable unless both it and `REVIEW_SUBMISSIONS_ENABLED=true` are present and valid; no copy or version is invented.
- Rate limits reuse the existing shared database counter RPC: 5 submissions per hashed identity per hour and 100 submissions globally per hour. Production never falls back to in-process limiting.

## Implementation record

- `20261026100000_review_submissions.sql`: review table/enums, length/state constraints, immutable original fields, indexes, RLS, grants, and public-only view.
- `20261026100100_review_functions.sql`: validation, spam link threshold, idempotency/replay conflict handling, insert, and `review.submitted` audit in one transaction.
- `src/lib/reviews/*`: server configuration, pure validation/honeypot/link heuristics, stable error codes, repository, rate limiter and submission orchestration.
- `src/app/api/reviews/route.ts`: JSON-only, 8 KiB limit, origin verification, correlation ID, hashed address, feature/config gates, shared rate limiting, idempotency header, safe responses and no-store headers.
- `src/components/forms/public-form.tsx` and `src/components/public-pages.tsx`: demo review submits remain mock-backed; live review form submits to `/api/reviews`; production without configuration shows the inactive notice. Existing approved consent copy is unchanged.
- `supabase/tests/sprint_3a_review_security.sql`: operator-side grants/RLS verification; **NOT EXECUTED against hosted Supabase**.
- `tests/review-submission.test.ts` and `tests/review-submissions-db.test.ts`: pure/orchestration and PGlite migration/function coverage.

## Verification

| Check | Result |
| --- | --- |
| PGlite migration, trigger, RLS, grant, idempotency and audit tests | PASS — 7/7, including local operator SQL |
| Review validation/orchestration tests | PASS — included in full suite |
| `npm run check` | PASS — typecheck, lint (5 existing warnings), 339 tests, production build |
| Graphify refresh | PASS — code graph refreshed; SQL extractor unavailable, so SQL files are not graphed |
| `git diff --check` | PASS — only Git line-ending notices |
| Built-server HTTP smoke tests | PASS — GET 405, text/plain POST 415, cross-origin JSON POST 403; all no-store |
| Hosted Supabase migration / operator SQL | Not executed; hosted migrations are deployment-owned |
| Manual demo/production and 320px QA | Pending |

## Acceptance checklist

- [x] Anonymous review function persists a consented review as pending; public display is unchanged.
- [x] Invalid input, honeypot, excess links and rate limiting return stable safe errors in unit tests.
- [ ] Live request-size boundary smoke test; the route enforces the 8 KiB cap while streaming, but that branch remains unverified over HTTP.
- [x] Same idempotency key does not create duplicates; altered payload conflicts.
- [x] Only a hashed IP identity is stored, and application logs omit addresses and review text.
- [x] Disabled/unconfigured activation fails closed and production does not fall back to the mock repository.
- [x] Original customer name/body/created timestamp are immutable in PostgreSQL.
- [x] Anonymous access cannot write or select private review fields; public view excludes pending/unpublished rows and hides draft replies.
- [x] Submission audit event is atomic and contains no customer text or source hash.
- [x] `npm run check` passes and results are recorded above.
- [ ] Complete manual demo/production form and 320px QA; keep production feature flag off until the approved consent text/version and target configuration are confirmed.

## Open / deferred

- Hosted migrations remain unapplied, following the plan's deployment boundary.
- 3B/3C work will replace the existing admin demo review queue and public review display; this sprint intentionally leaves those surfaces unchanged.
