# Sprint 2C — Live Administrator Booking Operations

**Status:** Sprint 2C implementation is complete; focused owner end-to-end
verification confirmed booking-photo upload, the private Storage bucket and the
administrator image viewer. The booking-request confirmation and page-entry
scroll behavior are implemented and build-verified. The app build and typecheck pass.
The full automated test suite still has five failing photo-upload tests (details
in §12); do not treat those as passed.

---

## 1. Architecture

```
Admin shell (client)  ── demo workspace (no session) → in-memory mock repository
  │                                                   (unchanged, never touches Supabase)
  │  live workspace (verified session)
  ├── GET /api/admin/bookings            src/app/api/admin/bookings/route.ts
  │      │  authorise: getCurrentAdmin() + bookings.read
  │      ▼
  │   src/lib/bookings/admin-service.ts  reads under the caller's own RLS session client
  │      ▲
  │   src/lib/bookings/admin.ts          pure contracts, row mapping, query/pagination,
  │                                      Africa/Accra conversion, agreed-window rule
  │
  └── server actions                     src/lib/bookings/admin-actions.ts  ("use server")
         │  guard: requireAdmin → bookings.manage → origin → rate limit → shape/rule check
         ▼
      src/lib/bookings/repository.ts     server-only elevated client (unchanged)
         ▼
      public.booking_transition / booking_update_arrangement / booking_add_note
         → bookings + booking_status_history + audit_events (one transaction)

Public booking form (client) → POST /api/bookings/photo
  → byte validation + upload token → elevated server client
  → private `booking-photos` bucket + `public.booking_photos` metadata
Admin booking detail → `BookingImagePanel`
  → authenticated photo-access endpoint → session/RLS check → short-lived URL
  → zoomable viewer (no bucket or object key in client code)
```

Reads are RLS-scoped with the caller's own session; writes go through the
`service_role`-only trusted functions. The elevated key never leaves the server,
and the live modules never import the mock store.

## 2. Files added

| File | Purpose |
| --- | --- |
| `src/lib/bookings/admin.ts` | **New.** Shared admin contracts, persisted-row mapping (fails closed), query normalisation/pagination, `Africa/Accra` conversions and the agreed-pickup window rule. Framework-free and unit-tested. |
| `src/lib/bookings/admin-service.ts` | **New.** Server-only bounded reads: list page + exact count, one booking with its services/history/notes/photos, branch options, dashboard counters. |
| `src/lib/bookings/admin-actions.ts` | **New.** Guarded server actions: `saveBookingArrangement`, `changeBookingStatus`, `addBookingNoteAction`. |
| `src/app/api/admin/bookings/route.ts` | **New.** Guarded read endpoint (list / detail / `?view=summary`). |
| `tests/booking-admin.test.ts` | **New.** 13 pure tests for the Sprint 2C contracts. |
| `src/components/admin/booking-image-panel.tsx` | **New.** Lazy customer-photo previews, retry states and keyboard-accessible zoom/pan viewer. |
| `src/app/api/admin/bookings/[id]/photos/[photoId]/route.ts` | **New.** Permission-checked short-lived signed-URL endpoint. |
| `src/app/api/bookings/photo/route.ts` | **New.** Token-bound public upload endpoint; validates bytes and persists objects/metadata server-side. |
| `src/lib/bookings/photos.ts`, `photo-upload.ts`, `photo-access.ts` | **New.** Photo validation/token rules, upload orchestration and administrator access checks. |
| `tests/photos.test.ts`, `tests/photo-upload.test.ts` | **New.** Photo validation and upload contract tests. |
| `supabase/migrations/20261013100000_booking_photos_storage.sql` | **New.** Creates the private `booking-photos` bucket with matching file/MIME limits and no client policies. |

## 3. Files changed

| File | Change |
| --- | --- |
| `src/components/admin/bookings.tsx` | Split into `DemoBookings` (previous behaviour preserved) and `LiveBookings` (list, detail, photo panel, server actions, states, pagination, refresh). |
| `src/components/admin/admin-app.tsx` | Passes `demo={!session}` to Bookings and Dashboard; live booking counters + recent rows; truthful workspace badge. |
| `src/lib/features.ts` | `demo` / `live` / `unconfigured` backend state and honest notices. |
| `src/lib/bookings/errors.ts` | Added `rate_limited` (HTTP 429) and its DB marker. |
| `src/lib/security/rate-limit.ts` | Added a separate `booking_mutation` limit + `adminRateLimits`; existing staff limits unchanged. |
| `src/lib/supabase/admin.ts` | Adds Next.js `server-only` protection for the elevated client. |
| `src/components/scroll-to-top.tsx`, `src/app/layout.tsx` | Starts normal internal page navigation at the top while preserving fragment targets. |
| `src/components/forms/booking.tsx` | Scrolls to and focuses the confirmation heading after a successful booking on desktop and mobile. |

`src/data/content.json` was not touched.

## 4. Read endpoint — `GET /api/admin/bookings`

Authorised by `getCurrentAdmin()` + the `bookings.read` capability (both roles).
Queries run under RLS with the caller's client and are always bounded; responses
are `Cache-Control: private, no-store`.

| Request | Response |
| --- | --- |
| `?search=&status=&branch=&date=&page=&pageSize=` | `{ rows, total, page, pageSize, branches }` — one page, exact total, branch options |
| `?id=<uuid>` | `{ booking, branches }` — full detail incl. `history`, `notes`, `audit` and customer-photo metadata |
| `?view=summary` | `{ pendingCount, activeCount, recent }` — dashboard counters + 5 recent rows |

- `search` matches reference, customer name and phone; `branch` accepts `unassigned`
  or a branch id; `date` is `YYYY-MM-DD`; `pageSize` is capped at 50.
- Invalid filters are dropped, the search term is neutralised for PostgREST, and a
  malformed (unmappable) row is skipped rather than rendered.
- Failures: `401 actor_required`, `403 permission_denied`, `404 not_found`,
  `503 not_configured`, otherwise `400`. No raw database message is returned.

## 5. Mutation contracts (server actions)

Every action repeats: verified session + `admin_profiles` role → `bookings.manage`
→ origin verification → per-actor rate limit → shape/invariant validation → the
trusted database function (which re-validates the actor, transition, confirmation
prerequisites, pickup window and version atomically).

| Action | Input | Notes |
| --- | --- | --- |
| `saveBookingArrangement` | `bookingId`, `expectedVersion`, `branchId`, `agreedPickupAt`, `agreedFee`, `zeroFeeReason`, `serviceCharge?`, `contactOutcome`, `confirmationNote`, `returnDetails` | Money in GHS; a zero fee requires a reason; the agreed instant is validated against 07:00–17:00 `Africa/Accra`. |
| `changeBookingStatus` | `bookingId`, `expectedVersion`, `next`, `reason?` | Permitted transitions enforced in the database; a cancellation requires a reason. |
| `addBookingNoteAction` | `bookingId`, `expectedVersion`, `body` | Private note (1–4000 chars); the body is never audited. |

Returns `{ ok: true, message, version }` or `{ ok: false, code, message, fieldErrors? }`.
The acting administrator is always resolved from the session; no action accepts an
actor id. Every success revalidates `/admin/bookings` and the booking detail path.

## 6. Lifecycle, confirmation, cancellation, concurrency

- Lifecycle `pending → confirmed → scheduled → picked_up → processing → ready →
  out_for_delivery → completed`, with `cancelled` reachable from any non-terminal
  state. Terminal states (`completed`, `cancelled`) have no ordinary transition.
- Confirmation is refused until branch, agreed pickup date/time, agreed fee
  (with zero-fee reason), contact outcome and confirmation note are recorded —
  enforced by `private.assert_confirmation_ready` inside the transaction; the UI
  mirrors the same pure rules for fast feedback only.
- Cancellation requires a reason in the action *and* in `booking_transition`.
- Optimistic concurrency uses the existing `version`: a stale `expectedVersion`
  raises `BOOKING_CONFLICT` → `409` → the detail view offers “Reload latest details”.
- Status change + history entry + audit event remain one transaction. History and
  audit are never rewritten or deleted.

## 7. Scheduling rules

- The authoritative pickup window is **07:00–17:00, seven days (incl. holidays),
  `Africa/Accra`**, and is the only rule applied to an agreed appointment
  (mirrors `private.assert_pickup_window`). There is no administrator bypass.
- Branch/walk-in hours (07:00–20:00) are never used for pickup.
- The **11:00 cutoff** applies only to Express/Same-Day collection; it is validated
  separately and is not the pickup-window closing time. Ordinary post-11:00
  appointments remain valid before 17:00.
- Admin-entered wall times are converted to the stored instant and the conversion
  is verified by round-tripping through the timezone formatter; an unverifiable
  input fails closed instead of recording the wrong instant.

## 8. Demo mode and production mode

| | Demo (`NEXT_PUBLIC_DEMO_MODE=true`, no session) | Live (verified session) |
| --- | --- | --- |
| Bookings list/detail | In-memory sample repository (unchanged) | `GET /api/admin/bookings` |
| Branch options | Content layer | `public.branches` |
| Mutations | Mock repository | Guarded server actions → trusted functions |
| Failure | Simulated (preview control) | Error state; **never** falls back to sample data |

The live modules never import the mock store. The workspace badge reads “Live
bookings” when the booking backend is connected, and the notice states honestly
that only bookings are persisted while enquiries/reviews/CMS/media/settings remain
sample data. The demo dashboard keeps its sample store.

## 9. Security and authorization

- Session and role are resolved from `auth.getUser()` + `admin_profiles` on every
  read and mutation; the browser never supplies a role, user id, status, fee or
  branch that is trusted. The database re-validates the actor inside each function.
- Both administrator roles may manage bookings; Operational Admin gains nothing
  outside bookings/reviews (Staff Management, Settings, etc. remain denied).
- The elevated key is server-only, created per operation and never logged; no
  `NEXT_PUBLIC_*` variable carries a secret.
- Attempts to call an endpoint or RPC directly still pass the guard chain (session,
  capability, origin, rate limit) and the trusted functions reject invalid input.

## 10. Audit trail scope (intentional)

The append-only `booking_status_history` (from → to, actor, reason, timestamp) is
shown to **both** roles — it is the per-booking audit trail. The global
`audit_events` log remains **Full-Admin only** per the established Sprint 1C RLS
policy, so the detail view renders audit rows only when the policy returns them.
Broadening that policy to Operational Admins would weaken an existing security
control and was deliberately not done; scoping it per booking is a candidate for a
future additive migration.

## 11. SQL

The admin booking operations reuse the Sprint 2A schema and trusted functions.
The photo pipeline adds one migration:

- `supabase/migrations/20261013100000_booking_photos_storage.sql` registers or
  updates a **private** `booking-photos` bucket (5,000,000 bytes per object;
  JPEG, PNG and WebP only). It creates no `storage.objects` policies. Its
  verification query lists existing policies for operator review.
- Booking metadata remains in `public.booking_photos`; object uploads and
  signed-URL creation use the server-only elevated client. The admin endpoint
  first checks the signed-in administrator and re-reads the photo row under the
  caller's RLS session; expired or inaccessible photos are not signed.
- The owner reports that the bucket and photo flow passed end-to-end testing.
  This implementation session did not apply the migration; retain its recorded
  status and read-only verification output for the target Supabase project.

No existing migration was edited.

## 12. Tests performed and outcomes

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed after admin/photo changes and again after page-scroll changes. |
| Targeted ESLint | Passed for `booking-image-panel.tsx` and `supabase/admin.ts`; scroll-related lint completed with two `<img>` warnings in `src/components/forms/booking.tsx`. |
| `npm test` | **170/175 passed; 5 failed** in `tests/photo-upload.test.ts`. Failures concern expected rate-limit header casing and upload fixtures/expected validation outcomes. These failures remain unresolved and are not represented as passing coverage. |
| `npm run build` | Passed after the admin/photo changes and again after page-scroll changes; `/api/admin/bookings` and photo API routes are present as dynamic routes. |
| Owner end-to-end test | Owner confirmed successful admin image picker and private bucket flow. |

New coverage: query normalisation/filtering & pagination clamping, PostgREST
search neutralisation, list/detail row mapping and fail-closed behaviour, the
agreed 07:00–17:00 window vs the express 11:00 cutoff, `Africa/Accra` conversion
round-trips, role capabilities, transitions/confirmation prerequisites,
conflict/rate-limit taxonomy, and demo-vs-live notice isolation.

Not executed / not available (not claimed as passing):

- **Database integration tests** (`supabase/tests/sprint_2a_booking_security.sql`) —
  no disposable Postgres/CLI here.
- **A hosted migration audit from this session** — no database connection was
  used. The owner reports end-to-end success, but retain the migration ledger
  and SQL verification output for deployment records.

## 13. Known limitations

1. The live list is read-only for status/branch — operations happen in the detail
   view, because a partial arrangement write from a summary row could clear agreed
   fields. Status badges are shown instead of inline selects.
2. The live list/detail fetches rely on the session cookie; the proxy refreshes
   sessions on `/admin` page requests only (unchanged from the staff API pattern),
   so an idle tab beyond the access-token lifetime may need a page navigation
   before a mutation.
3. Audit rows are visible only where the Full-Admin `audit_events` policy allows
   (see §10).
4. Service charge is carried through the arrangement path but is not yet exposed as
   a separate control in the form (the agreed fee is). This keeps the existing form
   shape.
5. The photo-upload automated tests have five outstanding failures (see §12),
   despite the owner's successful end-to-end test.
6. Sprint 2C deliberately implements no email/Brevo, customer accounts, online
   payments or automated WhatsApp messaging (Sprints 2D/2E).

## 14. Owner verification and deployment

1. The owner reports that the private photo bucket and admin image viewer passed
   an end-to-end test. Retain the Supabase SQL verification output and ensure the
   target environment has the private bucket with the configured limits.
2. Deploy with `SUPABASE_SECRET_KEY` (or legacy service-role key) configured only
   as a server environment variable. It must never use a `NEXT_PUBLIC_` name.
   `src/lib/supabase/admin.ts` imports `server-only`, so importing the elevated
   client into a Client Component fails the Next.js build.
3. Verify that photo upload remains token-bound, accepts only actual
   JPEG/PNG/WebP bytes, and rejects unauthenticated admin photo access. Do not
   add client `storage.objects` policies for this bucket.
4. Smoke-test live admin booking list/detail, branch and arrangement editing,
   status transitions, notes, cancellation and stale-write conflict handling.
5. Internal page navigation and successful booking confirmation now scroll to
   the top on desktop and mobile; fragment links such as `#services` retain
   their section destination.

## 15. Sprint 2C scope and exclusions

- Sprint 2C includes live administrator booking operations, secure customer-photo
  upload/viewing, deployment safeguards for the elevated key, and page-entry /
  booking-confirmation scroll behavior.
- It deliberately does not implement email/Brevo, customer accounts, online
  payments or automated WhatsApp messaging (Sprints 2D/2E).
- The photo panel displays attachments; upload happens after the booking is
  committed so a photo failure cannot undo a saved request.
