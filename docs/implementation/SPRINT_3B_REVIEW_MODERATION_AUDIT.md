# Sprint 3B — Moderation console, publication and audit

**Status:** CODE COMPLETE — verification recorded below
**Started:** 26 October 2026
**Plan:** `docs/implementation/PHASE_3_TO_5_IMPLEMENTATION.md` §4.2

## Objective and scope

Give administrators the review queue, detail view, decisions, publication control and
immutable audited history described in the Phase 3-5 plan. Replies, public display and
Phase 3 acceptance remain Sprint 3C, as the plan's §4.3 assigns them. The PDF acceptance
line "Operational Admin can moderate and reply" is therefore only partially exercised
here: moderation is delivered and proven; the reply workflow is deliberately not part of
this sprint's deliverables and stays in 3C. The audit history panel already renders any
`review.*` event, so reply events will appear there once 3C adds them.

## Decisions

- **Moderation state machine is database-enforced.** `review_moderate` accepts only
  `pending -> approved | rejected`. A rejection requires a recorded note. Correcting a
  decision is a separate Full Admin re-open (`rejected -> pending`) or override; ordinary
  moderators cannot silently reverse a decision.
- **Publication is a separate, audited step.** `review_publish` publishes only an approved,
  consented review, edits the public text as a new `published_version`, and can unpublish.
  `body_original` is never accepted by any moderation function and the existing
  immutability trigger still blocks changes to it.
- **Overrides are a distinct capability and a distinct audit trail.** Re-open and override
  require `reviews.override` (Full Admin only), a mandatory reason, and write
  `review.reopened` / `review.override_*` actions. The interface presents the override as
  a separated, danger-styled control behind a confirmation dialog, never the default
  button.
- **Every entry point re-validates the actor in the database** against active
  `public.admin_profiles`, pins `search_path = ''`, is `SECURITY DEFINER`, and is
  executable only by `service_role`. The Next.js server resolves the actor from the
  verified session and never accepts an actor id from the request.
- **Review audit history is readable by both administrator roles.** `audit_events` was
  Full-Admin-only. Sprint 3B adds one narrow policy for `entity_type = 'review'` only, so
  Operationally Admin can see the decisions they made; payloads carry state identifiers
  and reasons, never customer text, notes or IP hashes.
- **Open decision #1 is not resolved unilaterally.** The plan's §4.2 deliverable explicitly
  lists publish/unpublish, so unpublish is implemented with an audit record and a
  confirmation. The owner still needs to confirm the final emergency/publication policy
  (section 9, decision 1); no additional safeguards were invented.
- **Demo honesty is unchanged.** The demo workspace keeps its in-memory review queue and
  approve/reject for design review, and states that publication controls, history and
  overrides exist only on the live path. Production never falls back to sample data.

## Implementation record

- `supabase/migrations/20261026100200_review_moderation_functions.sql`: private actor
  verification, `review_moderate`, `review_publish`, `review_open`, `review_override`,
  atomic audit writes, service-role-only grants, and the narrow review-history audit
  policy.
- `src/lib/reviews/moderation.ts`: pure state-machine predicates, note/reason/body
  validation, operation → capability mapping and the database-marker error mapping.
- `src/lib/reviews/admin.ts`: queue query normalisation, search sanitisation, pagination,
  admin projections and audit-row mapping.
- `src/lib/reviews/admin-service.ts`: session-client reads (queue, detail + history,
  dashboard counters) and the trusted RPC wrappers.
- `src/lib/reviews/actions.ts`: guarded server actions — session → capability → origin →
  rate limit → validation → trusted RPC — for moderate, publish, re-open and override.
- `src/app/api/admin/reviews/route.ts`: `reviews.read`-gated, `no-store` read endpoint for
  the queue, detail, history and dashboard counters.
- `src/components/admin/reviews.tsx`: rebuilt console — filterable queue with decided
  reviews, detail view at `/admin/reviews/<id>` (inherited prefix authorisation),
  approve/reject, publish/edit/unpublish, Full Admin re-open and override, optimistic
  conflict reload, and the audit history panel. Native dialogs, labelled controls,
  `aria-busy`, keyboard-operable actions and a scrollable table wrapper.
- `src/components/admin/admin-app.tsx`: passes the detail id and override capability, and
  replaces the dashboard review shortcut with real pending counts.
- `src/lib/features.ts`: the partial-data notice now states that reviews are live too.
- `src/lib/security/rate-limit.ts`: `review_mutation` administrative limit.
- `supabase/tests/sprint_3b_review_moderation.sql`: operator-side function/grant/policy
  checks; **NOT EXECUTED against hosted Supabase**.
- `tests/review-moderation.test.ts`, `tests/review-moderation-db.test.ts` and the extended
  `tests/permissions.test.ts`.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 errors; pre-existing warnings only |
| Pure moderation/query/mapper tests | PASS |
| PGlite migration, function, audit, version-conflict and immutability tests | PASS — includes the local operator SQL script |
| Permission matrix (review detail route; override denied to Operational Admin) | PASS |
| Full `npm test` | PASS — 359 tests |
| `npm run build` | PASS — production build |
| Built-server HTTP smoke (`npm start`) | PASS — `/api/admin/reviews` 401 with `private, no-store`; `/admin/reviews` 307 to sign-in; public `/api/reviews` GET 405 |
| Hosted Supabase migration / operator SQL | Not executed; hosted migrations are deployment-owned |
| Manual demo/production QA and 320px viewport check | Pending (owner/visual review) |

## Acceptance checklist

- [x] Operational Admin can moderate (approve/reject with reason) and cannot override or
      re-open a rejected review — registry, server action and database checks.
- [x] Every decision, publication change, re-open and override writes `audit_events` with
      actor, before/after state, reason and correlation id in the same transaction.
- [x] Concurrent edits: first wins, second receives a conflict; no silent overwrite.
- [x] Original submission text/name/created timestamp are unchanged after any publication
      edit (PGlite assertion).
- [x] Queue includes decided reviews and filters by status, branch, rating, date range and
      search; detail shows original read-only beside the editable public version.
- [x] Audit history is presented on the detail view; history payloads contain no customer
      text.
- [x] Dashboard review shortcut uses real pending counts; the partial-data notice is
      updated.
- [x] `npm run check` passes (see verification table).
- [ ] Reply drafting/publication (Sprint 3C) and the PDF's full "moderate and reply"
      acceptance line.
- [ ] Manual demo/production QA and narrow-viewport check.

## Deferred / not executed

- Hosted migrations remain unapplied, following the plan's deployment boundary.
- `supabase/tests/sprint_3b_review_moderation.sql` has only been executed against PGlite.
- No browser automation or screenshots were produced; the owner performs visual review.
- The built-server smoke covered the unauthenticated surface only; authorised queue,
  detail and mutation requests need a configured administrator session, so they are
  covered by the PGlite and pure tests instead of an HTTP session.
- Replies, public review display, leak proofing and the Phase 3 acceptance matrix remain in
  Sprint 3C.
- Owner confirmation of open decision #1 (published-review unpublish/override policy) is
  still required before production activation.
