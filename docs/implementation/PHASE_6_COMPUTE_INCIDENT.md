# Phase 6 Website Content Compute Incident

## Purpose

This document records the Phase 6 website-content incident, the evidence collected,
the changes already made, and the remaining work. It is intended as a handoff for
another engineer or AI agent. It deliberately separates confirmed observations from
unproven explanations.

## Executive summary

Phase 6 introduced durable website-content tables, admin editors, optimistic
concurrency checks, and RPC-based writes for FAQs, gallery placements, blog content,
and promotions. After Phase 6 was deployed, Supabase showed a sustained stream of
`CONTENT_CONFLICT` errors from:

- `public.website_content_replace`
- `public.website_content_upsert`

The database rejected these writes before committing them. The repeated conflict
traffic is real and abnormal, but the available evidence does not prove that it is
the only cause of the reported 100% compute dashboard metric.

The strongest application-level defect found was an identity mismatch: some admin
read paths exposed the database UUID (`id`) while the write RPCs expect the durable
`record_key`. This caused clients to submit keys and expected versions that did not
match the existing rows. The FAQ path was fixed first; the broader Phase 6 mapping
was then hardened for blog and promotions as well.

The latest application changes have passed local type-checking and all 414 tests,
but a post-deployment verification window has not yet been established using the
exact Vercel Production Ready timestamp. Supabase continued to report conflicts in
windows that may have included the old deployment or old browser/server sessions.
Do not conclude that the latest code failed until the deployment boundary is known.

## Timeline and evidence

All times are UTC on 2026-10-29.

### Initial Phase 6 issue

- Phase 6 made FAQs and gallery content durable and editable.
- Existing content was not initially preserved by the migration; a repair migration
  was added to seed/preserve the approved FAQ and gallery content when modules were
  empty.
- The Phase 6 collection replacement RPC deletes omitted rows. This makes an
  incorrect or empty first save dangerous, so optimistic version checks are
  important.

### Database and API observations

Supabase AI reported:

- Repeated `CONTENT_CONFLICT` errors from actual PostgREST calls to
  `public.website_content_replace`.
- Earlier 504 responses existed, but their exact upstream cause was not proven.
- A live snapshot showed no blocking PID, no advisory-lock wait, no connection
  exhaustion, and no long-running transaction.
- The database had approximately 22 processes against `max_connections = 60` in
  one snapshot.
- Read-only FAQ/content query plans were small and fast. A combined sample reported
  approximately 3.755 ms execution time and 15.056 ms planning time.
- Audit insertion, triggers, foreign keys, and RLS were not implicated in the
  observed conflicts.
- The conflicts occur during version validation, before delete/upsert/audit writes.

### Conflict windows reported after the deployment attempts

These are logged conflict observations, not proof that the latest fix was serving
the requests:

| Window | Evidence |
|---|---|
| 17:38–17:40 | 15 conflicts in one sampled historical period |
| 18:50–18:52 | 11 conflicts in one sampled historical period |
| 19:19:00–19:24:34 | 23 `website_content_replace` conflicts; latest at 19:24:21 |
| 19:40:17–19:43:48 | 26 `website_content_replace` conflicts |
| Through 19:44:57 | Three additional conflicts; latest at 19:44:57 |
| 19:45:38–20:05:49 | 85 `website_content_replace` conflicts |
| 20:05:54–20:12:22 | 23 replacement conflicts and 364 `website_content_upsert` conflicts |
| 20:12:22–20:31:38 | 89 replacement calls and 1,067 upsert conflicts; one replacement was active at the final snapshot |

The later counts were explicitly described as fresh deltas by Supabase AI, but
they used database/log timestamps rather than the exact Vercel Production Ready
timestamp. Therefore they cannot independently establish whether they occurred
before or after the latest application fix became live.

Across the reported windows:

- `CONTENT_BUSY`: 0
- lock timeouts: 0
- statement timeouts: 0
- gateway 504s in the latest checked windows: 0
- blocking PIDs: none found
- transactions older than five minutes: none found
- active replacement RPCs: absent in some snapshots, present briefly in another

The Postgres records identified `application_name=PostgREST 14.18`, role
`authenticator`, and an internal loopback connection such as `::1:6987`. These
fields identify the database-side PostgREST process, not the upstream browser,
Vercel deployment, user agent, request ID, or client IP. No Edge Function or cron
caller was proven.

## Phase 6 implementation

The original Phase 6 migration is:

- `supabase/migrations/20261028100000_phase6_website_content.sql`

It introduced:

- `website_content`
- `website_gallery_media`
- public read policies
- admin-only `SECURITY DEFINER` RPCs
- `website_content_replace` for FAQ/gallery
- `website_content_upsert` for blog/promotions
- optimistic version validation
- audit events

The collection replacement function:

1. Validates the actor and module.
2. Locks the module advisory key.
3. Checks every submitted row's expected version.
4. Checks expected versions for omitted existing rows.
5. Deletes omitted rows.
6. Upserts retained rows and increments their versions.
7. Writes an audit event.

The single-record upsert function validates the expected version and increments the
row version on success.

## Changes already made

### Content preservation

`supabase/migrations/20261029170000_phase6_preserve_existing_content.sql`

- Preserves/seeds the approved 17 FAQ rows when the FAQ module is empty.
- Preserves/seeds the approved gallery content when the gallery module is empty.
- Normalizes legacy FAQ visibility behavior.
- Adds compatibility handling for legacy gallery URLs.

### Booking rate-limit maintenance

`supabase/migrations/20261029172000_booking_compute_maintenance.sql`

- Adds service-role-only cleanup for expired booking rate-limit rows.
- This was applied and verified.
- Verification showed zero remaining rate-limit rows and zero expired rows.
- This did not explain the continuing website-content conflict stream.

### Fail-fast website-content locking

`supabase/migrations/20261029174000_website_content_lock_timeout.sql`

- Sets a five-second local lock timeout.
- Replaces the blocking advisory lock with `pg_try_advisory_xact_lock`.
- Raises `CONTENT_BUSY` instead of waiting indefinitely for the gateway timeout.
- Does not remove optimistic version checks.
- Does not itself continuously consume CPU; it runs when the RPC is called.
- This migration was applied and verified in Supabase.

### Application fixes

`src/app/api/admin/website/route.ts`

- FAQ reads expose `record_key` as the editor identity.
- The broader content mapping now also uses `record_key` as the identity for
  blog, promotion, and related website-content records.

`src/lib/website/types.ts`

- `toFaq`, `toContent`, and `toPromotion` preserve stable keys instead of preferring
  database UUIDs.
- Legacy FAQ rows without `enabled` are treated as visible unless explicitly false.

`src/components/admin/content/faq-manager.tsx`

- Adds editable branded highlight text.
- Loads current FAQ versions from the live API.
- Prevents overlapping saves with a local `busy` guard.
- Sends FAQ versions with the save payload.
- Does not automatically retry a conflict.

`src/lib/website/repository.ts`

- Sends stable keys and expected versions.
- Includes Supabase error text in failures.
- Handles `CONTENT_BUSY` with an explicit retry message.
- For FAQ conflicts, performs a read-only reconciliation. If the database already
  contains exactly the requested content, it treats the save as successful. If the
  database differs, it preserves the conflict and refuses to overwrite it.
- Adds equivalent idempotent reconciliation for blog and promotion writes.
- Uses structural JSON comparison rather than relying on property order.

`src/lib/supabase/admin.ts`

- Adds a 15-second timeout to elevated Supabase requests.
- This changes the client-side failure time, but it does not identify or fix the
  original historical 504 cause.

## Confirmed root cause versus unresolved questions

### Confirmed

1. Phase 6 introduced the website-content write RPCs and the conflict mechanism.
2. PostgREST has repeatedly called both write RPCs.
3. The calls frequently fail with `CONTENT_CONFLICT` / SQLSTATE `40001`.
4. The database is rejecting those calls before their writes commit.
5. Stable-key/version identity handling was incorrect or incomplete in the
   application read/write path.
6. No evidence currently proves lock contention, connection exhaustion, audit
   trigger contention, or a slow read query.
7. No evidence proves that the Supabase AI monitoring session itself generated the
   RPC calls.

### Not yet proven

1. Whether the latest Vercel Production deployment was serving during each conflict
   window.
2. Whether the repeated caller was an old browser tab, another device, an old
   deployment instance, or another application client.
3. Whether the conflict stream alone caused the 100% compute dashboard metric.
4. Whether successful website-content calls were omitted from the available logs.
5. Whether another Phase 6 writer has a separate stale-state bug not exercised by
   the local tests.
6. The current host CPU trend. Supabase log snapshots do not substitute for a
   time-series CPU metric.

## What must not be done

- Do not remove optimistic version checks.
- Do not change conflict errors into successful writes.
- Do not delete/recreate FAQ or gallery data to make a save pass.
- Do not apply more migrations without new database-side evidence.
- Do not infer the upstream caller from `application_name=PostgREST`.
- Do not use the historical 100% dashboard graph as proof of current CPU.
- Do not repeatedly click Save during a delayed request.
- Do not run a controlled save test while unexplained conflict calls are still
  arriving.

## Required next investigation

### 1. Establish the exact deployment boundary

Record the exact UTC timestamp when Vercel marked the latest commit Ready and
assigned it to Production. The local repository commit at the time of the latest
application patch was:

```text
3ff321a26b7106e47da6aac4d44825ea0c9cb316
```

The repository was synced to `origin/main`, but Git synchronization alone does not
prove that Vercel Production served that commit.

### 2. Run a read-only post-deployment query

Use the exact Vercel Production Ready timestamp as the start boundary. Count
separately:

- `website_content_replace`
- `website_content_upsert`
- `CONTENT_CONFLICT`
- `CONTENT_BUSY`
- lock timeouts
- statement timeouts
- gateway 504s

Exclude the monitoring SQL itself from activity counts. Report the first and last
event, rate per minute, active sessions, blockers, transaction age, and available
caller metadata. Do not count missing error records as successful calls.

### 3. Quiet-period test

Before testing a save:

1. Close every admin tab on every device.
2. Sign out of all admin sessions.
3. Close the browsers.
4. Wait at least 10–15 minutes.
5. Verify whether new content RPC calls still arrive.

If calls continue with all admin sessions closed, correlate timestamps with Vercel
Production logs, other devices, service workers, integrations, and schedulers.

### 4. Controlled functional test

Only after the quiet period has zero unexplained calls:

1. Open a private/incognito window.
2. Sign in once.
3. Load `/admin/content/faqs`.
4. Make one small edit.
5. Click Save once.
6. Check that the browser reports success.
7. Verify exactly one expected RPC invocation and no repeated retry stream.
8. Verify the FAQ count is unchanged and the edited row version increments once.

### 5. Separate compute verification

Compare only newly accumulating activity after deployment. A healthy result is:

- no repeated Phase 6 conflict stream;
- no unexplained website-content calls while idle;
- no active blockers or long-running transactions;
- no new timeout/504 burst;
- compute no longer increasing abnormally.

If conflicts stop but compute remains high, Phase 6 was not the sole compute source.
Use Supabase's top-query/request breakdown to identify the remaining source rather
than changing the content RPC again.

## Current conclusion

The Phase 6 implementation introduced a real application-level stale identity/version
problem and a high-volume conflict stream. The database safeguards are working:
they reject stale writes without allowing silent data loss. The application patch
corrects the known stable-key mapping and adds safe reconciliation, and local
validation passed.

The final production conclusion remains pending an exact Vercel deployment boundary
and a quiet-period read-only observation after that boundary. The broader CPU issue
must be considered **not yet proven fixed** until newly accumulating compute and
conflict activity are measured after the latest deployment.
