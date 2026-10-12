# Sprint 2B — Production Public Booking Integration, Validation & Secure Submission

**Status:** implemented and technically verified. The submission endpoint is
**gated off by default**; one new migration (`20261011140000_booking_rate_limit.sql`)
must be applied before production activation. No booking was created during
verification.

---

## 1. Architecture

```
Booking form (client)
  │  demo mode → in-memory mock repository (unchanged, never touches Supabase)
  │  production → POST /api/bookings  (JSON, same-origin)
  ▼
src/app/api/bookings/route.ts        adapter: method, content-type, size, origin,
  │                                  hashed client identity, correlation id
  ▼
src/lib/bookings/submission.ts       orchestrator (pure, dependency-injected):
  │                                  gate → config → rate limit → idempotency →
  │                                  validation → trusted submit
  ├─ src/lib/bookings/validation.ts  normalise + validate + scheduling + express
  ├─ src/lib/security/booking-rate-limit.ts  shared (database) limiter
  └─ src/lib/bookings/repository.ts  server-only elevated client
        ▼
     public.booking_submit(...)      trusted database function (service_role only)
        → bookings + booking_services + booking_status_history + audit_events (one transaction)
```

The route is a thin adapter; every decision lives in the orchestrator, which is
tested with mocks. The privileged key never leaves the server and no client
component imports the repository.

## 2. Route and component changes

| File | Change |
| --- | --- |
| `src/app/api/bookings/route.ts` | **New.** `POST` submission adapter; `GET` returns 405. `runtime = "nodejs"`. |
| `src/lib/bookings/submission.ts` | **New.** Orchestrator with injected dependencies. |
| `src/lib/bookings/catalogue.ts` | **New.** Loads the active/bookable catalogue from `public.services`. |
| `src/lib/bookings/config.ts` | **New.** `BOOKING_SUBMISSIONS_ENABLED` gate. |
| `src/lib/security/booking-rate-limit.ts` | **New.** Shared database limiter + dev fallback. |
| `src/components/forms/booking.tsx` | Production submit path, demo isolation, past-time fix, inline pickup-hours message. |
| `src/lib/bookings/{errors,scheduling,validation}.ts` | `pickup_time_past`, past same-day time rule, duplicate-service and acknowledgement enforcement. |
| `.env.example` | Documents the new server-only variables. |
| `supabase/migrations/20261011140000_booking_rate_limit.sql` | **New.** Shared rate-limit table and function. |

No design, layout, animation or navigation change was made.

## 3. Input / output API contract

### Request — `POST /api/bookings`

- `Content-Type: application/json` (anything else → `415`).
- Body ≤ 32 KiB (→ `413`).
- Same-origin `Origin` (missing/cross-origin → `403`).
- Body fields mirror the existing form: `services[]`, `category`, `items`, `notes`,
  `address`, `landmark`, `map`, `date`, `time`, `transport`, `name`, `phone`,
  `email`, `sameWhatsapp`, `whatsapp`, `contactMethod`, `acknowledged`,
  `idempotencyKey`. Extra fields (for example `photoNames`) are ignored.
- The idempotency key may also be sent as an `Idempotency-Key` header.

### Response

| Outcome | Status | Body |
| --- | --- | --- |
| Created | `201` | `{ ok, reference, status:"pending", replayed:false, message, correlationId }` |
| Idempotent replay | `200` | as above with `replayed:true` |
| Validation failure | `422` | `{ ok:false, code, message, fieldErrors, correlationId }` |
| Conflict / changed payload | `409` | `{ ok:false, code:"conflict" \| "idempotency_mismatch", message, correlationId }` |
| Rate limited | `429` | `{ ok:false, code:"rate_limited", retryAfterSeconds, correlationId }` + `Retry-After` |
| Disabled / unconfigured / limiter unavailable | `503` | `{ ok:false, code, message, correlationId }` |
| Cross-origin | `403` | `{ ok:false, code:"origin_rejected", … }` |
| Bad content type / body | `415` / `400` / `413` | `{ ok:false, code, message, correlationId }` |
| Wrong method | `405` | `Allow: POST` |

No customer personal data is ever returned: the success body contains only the
reference, status and a correlation id. There is **no** list or read-by-reference
endpoint.

## 4. Database RPC integration (verified non-destructively)

`submitPublicBooking` calls `public.booking_submit(p_payload, p_services,
p_idempotency_key, p_submission_scope, p_correlation)` through the server-only
elevated client. The signature matches the applied migration exactly.

Verified against hosted Supabase on 11 October 2026 without creating any row:

| Probe | Result |
| --- | --- |
| Read `public.services` with the elevated key | 10 active, 9 bookable — matches the seed |
| `booking_submit` with an invalid phone | Rejected with `BOOKING_INVALID_PHONE` before insert (no row) |
| `booking_submit` with duplicate service slugs | Rejected with `BOOKING_INVALID_SERVICE: each service may be selected only once.` |
| `booking_rate_limit_consume` | **Not installed** — `20261011140000_booking_rate_limit.sql` has not been applied |

The TypeScript layer was aligned with the corrections made to the reviewed Sprint
2A SQL: the `BOOKING_PICKUP_TIME_PAST` guard, the idempotency pre-check that runs
before the pause flag and scheduling (so a retry after the cutoff still returns the
original result) and the duplicate-service rejection.

## 5. Scheduling and Express rules

- Pickup window 07:00–17:00, seven days including public holidays; branch/walk-in
  hours (07:00–20:00) are never used for pickup.
- 06:30 rejected, 07:00 accepted, 17:00 accepted as the inclusive closing
  boundary, 17:30 and 19:00 rejected.
- A same-day request after the window closes is rejected; a future date is always
  accepted regardless of today's time.
- A specific **same-day time that has already passed** is rejected
  (`pickup_time_past`), mirroring the database.
- Express/same-day: the 11:00 cutoff applies only to an express request for today.
  Exactly 11:00:00 is accepted; 11:00:01 is rejected. Selecting the
  `express-same-day-laundry` service implies express eligibility, so omitting the
  boolean flag cannot bypass the cutoff. Ordinary requests after 11:00 are
  unaffected.
- All comparisons use `Africa/Accra` and trusted server time; the browser clock is
  never authoritative, and the database re-validates every rule.

The client's 06:30 defect is eliminated at three layers: the form's inline
validation, the server orchestrator and the database function.

## 6. Demo mode and production mode

| | Demo mode (`NEXT_PUBLIC_DEMO_MODE=true`) | Production (`NEXT_PUBLIC_DEMO_MODE=false`) |
| --- | --- | --- |
| Submission | In-memory mock repository (unchanged) | `POST /api/bookings` |
| Persistence | None; resets on refresh | Real database, one booking per logical submission |
| Success screen | "Demo request only…" notice | Real reference + "pending" + team will confirm |
| Pickup rules | Same approved rules (06:30 rejected) | Same approved rules, re-validated server-side |

The demo path never contacts Supabase, and no demo data is ever written to
production. A failed production submit preserves every entered value, keeps the
same idempotency key and moves the customer to the earliest step that needs
attention.

## 7. Idempotency strategy

The form generates one key per logical attempt (`createIdempotencyKey`) and reuses
it across retries and network failures; the key is renewed only when the payload
materially changes. The database enforces uniqueness on
`(submission_scope, idempotency_key)`:

- same key + same payload → returns the original reference (`200`), without
  re-evaluating the cutoff or the pause flag;
- same key + different payload → `BOOKING_IDEMPOTENCY_MISMATCH` → `409`;
- a successful replay is never rejected because the cutoff has since passed;
- a failed validation never creates a booking.

No second idempotency system was introduced.

## 8. Security controls

- Origin/CSRF check on every submission (request's own host, `X-Forwarded-Host`
  and optional `SITE_URL`).
- Strict JSON content-type, a 32 KiB body cap and malformed-body rejection.
- The privileged Supabase key is server-only, created per operation, never logged.
- The client address is hashed (SHA-256, truncated) before use as a rate-limit
  bucket; no raw address is stored or logged.
- Logs carry only status, stable code and correlation id — never a name, phone
  number, email address or pickup address.
- Validation resolves services against the database's active, bookable catalogue;
  the public form cannot validate against a client-supplied list.
- Error responses use the existing `src/lib/bookings/errors.ts` taxonomy and never
  expose SQL, stack traces or whether a private record exists.

## 9. Rate-limiting design

`src/lib/security/booking-rate-limit.ts` provides:

- **`databaseBookingRateLimiter`** (production) — calls
  `public.booking_rate_limit_consume`, a fixed-window counter shared by every
  server instance. This is a distributed limiter, not an in-process one.
- **`memoryBookingRateLimiter`** — per-process fallback for local development and
  tests only; never selected outside demo mode unless explicitly forced.

Default allowance: 5 submissions per hashed address per 15 minutes. Selection is
controlled by `BOOKING_RATE_LIMIT_MODE` (`database`/`memory`); without it, the
database limiter is used outside demo mode.

**Fail-closed behaviour:** if the shared limiter is unavailable (for example the
function is not yet installed), the endpoint returns `503 rate_limit_unavailable`
and does not accept a booking. In-process limiting is never presented as
distributed protection.

## 10. Required environment variables

| Variable | Scope | Development | Production |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_DEMO_MODE` | Public | `true` (default) | `false` |
| `BOOKING_SUBMISSIONS_ENABLED` | Server-only | unset (off) | `true` to activate |
| `BOOKING_RATE_LIMIT_MODE` | Server-only | `memory` (optional) | unset (uses database limiter) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | required | required |
| `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | Server-only | required for a real submit | required |
| `SITE_URL` | Server-only | optional | recommended |

Enabling submission requires **all** of: `BOOKING_SUBMISSIONS_ENABLED=true`,
Supabase URL + elevated key, a readable active catalogue and the shared limiter
function. Any missing prerequisite fails closed.

## 11. Tests performed and outcomes

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed (0 errors; 1 pre-existing warning in `.opencode/plugins/graphify.js`) |
| `npm test` | **150/150 passed** (22+ booking domain tests, 20 handler tests) |
| `npm run build` | Passed; `/api/bookings` present as a dynamic route |
| Live HTTP smoke test (`npm run dev`) | `GET`→405, cross-origin→403, wrong content-type→415, malformed→400, enabled-off→503 `submissions_disabled` |
| Hosted RPC probe (non-destructive) | `booking_submit` signature + grants confirmed; invalid and duplicate payloads rejected with the expected markers; no row created |

Tests not executed / not available:

- **SQL integration tests** (`supabase/tests/sprint_2a_booking_security.sql`) —
  not run here (no disposable Postgres/CLI). Not claimed as passing.
- **A live end-to-end booking insert** — deliberately not performed, to avoid
  writing a test booking to production. It becomes verifiable once the owner
  applies the rate-limit migration and enables the gate.
- Visual/browser automation — excluded by the sprint brief.

## 12. Known limitations

1. Preferred-time selection is a free clock input constrained to 07:00–17:00;
   there are no fixed slots (the SRS documented that exact slot inventory was
   never supplied). Invalid values are rejected inline and on the server.
2. Photo filenames are collected by the form but not persisted: there is no upload
   pipeline (out of scope). `booking_photos` remains retention scaffolding only.
3. The privacy-notice version is accepted from the form but is not yet a mandatory,
   policy-approved value (client policy bodies are still pending).
4. The catalogue is read from `public.services`; the public site's presentation
   layer still reads `src/lib/content.ts` (reconciled in Sprint 2C).
5. Rate limiting is a fixed-window counter; it is shared and safe, but it is not a
   sliding-window or edge limiter.

## 13. Database corrections required

One new migration is needed and has **not** been applied:

- `supabase/migrations/20261011140000_booking_rate_limit.sql` — creates
  `public.booking_rate_limits` (RLS enabled, no client access) and
  `public.booking_rate_limit_consume(...)` (service_role only).

Everything else in the reviewed Sprint 2A SQL matched the implementation. No
change was made to any applied migration, and no migration was re-run.

## 14. Owner activation steps

1. Review and apply `supabase/migrations/20261011140000_booking_rate_limit.sql` in
   the Supabase SQL editor; confirm `rate_limit_installed=true` and that only
   `service_role` can execute the function.
2. Set the production environment: `NEXT_PUBLIC_DEMO_MODE=false`,
   `BOOKING_SUBMISSIONS_ENABLED=true`, `SUPABASE_SECRET_KEY` (server-only),
   `SITE_URL=https://<production-origin>`.
3. Deploy; confirm the production origin is in the Supabase allow-list if cookie
   auth is also used there.
4. Manually test the booking form: submit a valid request and confirm a reference
   is shown with a "pending" status; submit 06:30 and confirm rejection; retry a
   submission and confirm no duplicate booking.
5. To pause, unset `BOOKING_SUBMISSIONS_ENABLED` (or set it to false) and redeploy,
   or set `accept_public_bookings=false` in `public.booking_settings`.

## 15. Sprint 2C integration dependencies

- `src/lib/bookings/repository.ts` — `transitionBooking`,
  `updateBookingArrangement`, `addBookingNote` (already implemented, service-role
  only, version-checked) ready for the live admin console.
- `src/lib/bookings/lifecycle.ts` — transition map, confirmation prerequisites and
  arrangement validation, already asserted against the database rules.
- `public.branches` / `public.services` — the production source of truth to
  reconcile with `src/lib/content.ts`.
- RLS read policies already let either administrator role read bookings; the admin
  console can move to live reads without new database work.
