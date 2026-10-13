# Sprint 2C — Live Administrator Booking Operations

**Status:** implemented and technically verified in this working copy. **No new SQL
is required**; every operation reuses the deployed Sprint 2A/2B schema, policies
and trusted functions. No hosted data was read, written or migrated during
verification.

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
```

Reads are RLS-scoped with the caller's own session; writes go through the
`service_role`-only trusted functions. The elevated key never leaves the server,
and the live modules never import the mock store.

## 2. Files added

| File | Purpose |
| --- | --- |
| `src/lib/bookings/admin.ts` | **New.** Shared admin contracts, persisted-row mapping (fails closed), query normalisation/pagination, `Africa/Accra` conversions and the agreed-pickup window rule. Framework-free and unit-tested. |
| `src/lib/bookings/admin-service.ts` | **New.** Server-only bounded reads: list page + exact count, one booking with its services/history/notes, branch options, dashboard counters. |
| `src/lib/bookings/admin-actions.ts` | **New.** Guarded server actions: `saveBookingArrangement`, `changeBookingStatus`, `addBookingNoteAction`. |
| `src/app/api/admin/bookings/route.ts` | **New.** Guarded read endpoint (list / detail / `?view=summary`). |
| `tests/booking-admin.test.ts` | **New.** 13 pure tests for the Sprint 2C contracts. |

## 3. Files changed

| File | Change |
| --- | --- |
| `src/components/admin/bookings.tsx` | Split into `DemoBookings` (previous behaviour preserved) and `LiveBookings` (list, detail, server actions, states, pagination, refresh). |
| `src/components/admin/admin-app.tsx` | Passes `demo={!session}` to Bookings and Dashboard; live booking counters + recent rows; truthful workspace badge. |
| `src/lib/features.ts` | `demo` / `live` / `unconfigured` backend state and honest notices. |
| `src/lib/bookings/errors.ts` | Added `rate_limited` (HTTP 429) and its DB marker. |
| `src/lib/security/rate-limit.ts` | Added a separate `booking_mutation` limit + `adminRateLimits`; existing staff limits unchanged. |

No design, layout, branding, navigation or unrelated-copy change was made.
`src/data/content.json` was not touched.

## 4. Read endpoint — `GET /api/admin/bookings`

Authorised by `getCurrentAdmin()` + the `bookings.read` capability (both roles).
Queries run under RLS with the caller's client and are always bounded; responses
are `Cache-Control: private, no-store`.

| Request | Response |
| --- | --- |
| `?search=&status=&branch=&date=&page=&pageSize=` | `{ rows, total, page, pageSize, branches }` — one page, exact total, branch options |
| `?id=<uuid>` | `{ booking, branches }` — full detail incl. `history`, `notes`, `audit` |
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

**No new migration is required.** Every requirement is met by deployed objects:

- reads — `bookings`, `booking_services`, `booking_status_history`, `booking_notes`,
  `branches` with `private.is_active_admin()` SELECT policies and `authenticated`
  SELECT grants;
- writes — `booking_transition`, `booking_update_arrangement`, `booking_add_note`
  (service_role only, version-checked, atomic history + audit);
- audit — `audit_events` + `private.insert_audit_event` (`entity_type = 'booking'`,
  `entity_id = booking uuid`).

No applied migration was edited, and nothing was applied to hosted Supabase.

## 12. Tests performed and outcomes

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed (0 errors; 3 pre-existing warnings: `.opencode/plugins/graphify.js` anonymous default export; two `<img>` warnings in `src/components/forms/booking.tsx`) |
| `npm test` | **164/164 passed** (was 151; +13 in `tests/booking-admin.test.ts`) |
| `npm run build` | Passed; `/api/admin/bookings` present as a dynamic route |

New coverage: query normalisation/filtering & pagination clamping, PostgREST
search neutralisation, list/detail row mapping and fail-closed behaviour, the
agreed 07:00–17:00 window vs the express 11:00 cutoff, `Africa/Accra` conversion
round-trips, role capabilities, transitions/confirmation prerequisites,
conflict/rate-limit taxonomy, and demo-vs-live notice isolation.

Not executed / not available (not claimed as passing):

- **Database integration tests** (`supabase/tests/sprint_2a_booking_security.sql`) —
  no disposable Postgres/CLI here.
- **A live authenticated write against hosted Supabase** — deliberately not
  performed (no admin session and no disposable test data; avoids touching real
  customer records). Recommend an owner smoke test in the live console.

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
5. Sprint 2C deliberately implements no email/Brevo, customer accounts, online
   payments or automated WhatsApp messaging (Sprints 2D/2E).

## 14. Owner steps

1. No SQL to apply.
2. Deploy the changes. A verified administrator on a Supabase-configured
   deployment sees live bookings automatically; the demo workspace is unchanged.
3. Smoke test in the live console: open `/admin/bookings`, filter/paginate, open a
   booking, assign a branch + agreed pickup/fee/contact outcome, confirm it, advance
   a status, add a note, and cancel with a reason. Confirm a stale second save
   surfaces the conflict message.
