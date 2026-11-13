# Handover analysis 01 — Repository, build, tech stack, local development

Snapshot taken 2026-11-13 at commit `f5940bc`. This was a read-only investigation: nothing was installed, built, tested or migrated. Every claim cites the file it comes from. No values from any `.env*` file are reproduced here; only variable names and yes/no facts about them (for example "points at a hosted project") appear.

> **Most important finding (see §7):** the developer machine's `.env.local` points at a **hosted** Supabase project with an elevated secret key, has demo mode **off**, and has transactional email **on** with a real Brevo key. Running `npm run dev` with that file writes to the hosted database and sends **real emails** to real recipients. Local Supabase is also blocked by an `https://`-only URL check.

---

## 1. Git

| Item | Value | Source |
|---|---|---|
| Remote `origin` | `https://github.com/samuel1578/2ND-WAVE-LAUNDRY.git` (fetch and push) | `git remote -v` |
| Owner account | GitHub user `samuel1578`, a personal account taken from the URL; whether it is an organisation is not determinable | remote URL |
| Default branch | `main` (`origin/HEAD -> origin/main`) | `git symbolic-ref refs/remotes/origin/HEAD` |
| Other branches | Local only: `subagent/09b42c59` (at `1c078df`), checked out in the linked worktree `C:/Games/2ND WAVE.worktree/subagent-09b42c59`. A second worktree under the user profile (`…/kilo/worktree-pool/…`) is at `116e0df`, detached. No other remote branches. | `git branch -a`, `git worktree list` |
| Tags | None | `git describe --tags` → "No names found" |
| Last commit | `f5940bcf41387f1c617ab24162b13f4513adf8b9`, 2026-11-13 14:37:34 +0000, "LINK UNISION AND ADMIN VIEW ORDER BUTTON" | `git log -1` |
| Commit count | 47 | `git rev-list --count HEAD` |
| Working tree | Clean at time of analysis | `git status --short` |

**`.gitignore`** (`.gitignore`):

| Pattern | Excluded? |
|---|---|
| `.env*` (with `!.env.example` re-included) | Yes |
| `.vercel` | Yes |
| `.next/` | Yes |
| Also ignored | `node_modules/`, `*.tsbuildinfo`, `graphify-out/` |

**Repository hygiene notes**
- Two empty files named `{` and `exclusions').eq('module'` are **tracked** in the repo root, apparently from stray shell redirections (`git ls-files`).
- `blog-layout-qa.mjs` is tracked in the root. It is a Playwright-style helper with a hard-coded `C:/Games/2ND WAVE/…` screenshot path and `http://localhost:3000` (`blog-layout-qa.mjs`).
- Agent and tool folders are present: `.opencode/` (tracked, includes `.opencode/skills/graphify/…`), plus `.kilo/`, `.freebuff/` and `.vscode/` (`ls -la`).
- `graphify-out/` is ignored, so a fresh clone will not have the graph that `AGENTS.md` tells agents to use (`.gitignore`, `AGENTS.md`).
- `.vercel/` exists locally, containing `project.json` and `README.txt`, so this checkout is linked to a Vercel project. The folder is not committed.

## 2. Runtime

| Item | Value | Source |
|---|---|---|
| Node requirement | `"engines": { "node": ">=22.0.0" }` | `package.json` |
| Next.js's own floor | `node >=20.9.0` (superseded by the project's `>=22`) | `package-lock.json` → `node_modules/next` |
| `.nvmrc` / `.node-version` | Not present | repo root |
| `packageManager` field | Not present | `package.json` |
| Package manager | npm. The README instructs `npm ci`. | `README.md` ("Run locally") |
| Lockfile | `package-lock.json`, `lockfileVersion: 3` | `package-lock.json` |
| Module/TS runner for tests | `node --import tsx --test tests/*.test.ts` | `package.json` `scripts.test` |

## 3. Dependencies

Resolved versions are from `package-lock.json` (`packages["node_modules/<name>"].version`). "Imported in" was found by searching `src/`, `tests/`, `scripts/` and root config files.

### dependencies

| Package | Declared | Resolved | Purpose (from actual imports) |
|---|---|---|---|
| `@supabase/ssr` | ^0.12.7 | 0.12.7 | Cookie-based Supabase clients for the browser, server and proxy: `src/lib/supabase/client.ts`, `server.ts`, `proxy.ts` |
| `@supabase/supabase-js` | ^2.117.3 | 2.117.3 | Supabase client, including the elevated server-only client in `src/lib/supabase/admin.ts`; also `scripts/cleanup-stuck-staff-invites.mjs` |
| `libphonenumber-js` | 1.13.14 | 1.13.14 | Phone-number validation in `src/lib/rules.ts` |
| `lucide-react` | 1.52.0 | 1.52.0 | Icons, mostly in the admin UI (23 files, for example `src/components/admin/admin-app.tsx`) |
| `motion` | 14.0.0 | 14.0.0 | Animations: `src/components/motion.tsx`, `brand-glow.tsx`, `home-hero/scrollytelling-hero.tsx`, `home-hero/stages.tsx` |
| `next` | 16.3.8 | 16.3.8 | Framework (App Router; `src/proxy.ts` uses the Next 16 "Proxy" convention) |
| `next-themes` | 0.4.6 | 0.4.6 | Light/dark theme: `src/components/providers.tsx`, `shell.tsx`, `logo-video-hero.tsx` |
| `react` | 19.3.0 | 19.3.0 | UI runtime |
| `react-dom` | 19.3.0 | 19.3.0 | UI runtime |
| `sanitize-html` | ^2.18.1 | 2.18.1 | Sanitising HTML for manual emails in `src/lib/email/manual.ts` |
| `swiper` | ^14.3.0 | 14.3.0 | Carousel in `src/components/cascade-slider.tsx` |
| `three` | 0.186.1 | 0.186.1 | WebGL backgrounds: `src/components/dotted-glow-background.tsx`, `fabric-scene.tsx` |

### devDependencies

| Package | Declared | Resolved | Purpose |
|---|---|---|---|
| `@electric-sql/pglite` | ^0.5.10 | 0.5.10 | In-process WASM Postgres for database tests (15 files under `tests/`, for example `tests/email-outbox-db.test.ts`; described in `supabase/README.md` "Automated database tests") |
| `@types/node` | 26.6.4 | 26.6.4 | Types |
| `@types/react` | 19.3.0 | 19.3.0 | Types |
| `@types/react-dom` | 19.3.0 | 19.3.0 | Types |
| `@types/sanitize-html` | ^2.16.2 | 2.16.2 | Types for `sanitize-html` |
| `@types/three` | 0.186.0 | 0.186.0 | Types for `three` (note: 0.186.0 vs runtime 0.186.1) |
| `eslint` | 9.39.5 | 9.39.5 | `npm run lint` (`eslint.config.mjs`) |
| `eslint-config-next` | 16.3.8 | 16.3.8 | Imported in `eslint.config.mjs` (`core-web-vitals`, `typescript`) |
| `prettier` | 3.9.9 | 3.9.9 | **Flag: installed but unused.** No import, no npm script, no `.prettierrc*` or `prettier.config.*` |
| `tsx` | 4.23.15 | 4.23.15 | TypeScript loader for `npm test` (`package.json`) |
| `typescript` | 6.0.3 | 6.0.3 | `npm run typecheck` (`next typegen && tsc --noEmit`) |

**Other flags**
- `server-only` is imported by server modules (for example `src/lib/email/dispatch.ts`, `src/lib/supabase/admin.ts`). It is **not** declared in `package.json`, is not in `package-lock.json`, and has no `node_modules/server-only` folder. Next resolves it internally during builds. How it resolves under the `tsx` test runner was not verified, because tests were not run.
- `@types/*` packages are type-only, so having no runtime imports is expected for them.

## 4. Framework config

### `next.config.ts`

| Option | Value | Notes |
|---|---|---|
| `poweredByHeader` | `false` | |
| `reactStrictMode` | `true` | |
| `trailingSlash` | `false` | |
| `images.remotePatterns` | Only `https://<NEXT_PUBLIC_SUPABASE_URL host>/storage/v1/object/public/marketing-assets/**` | The host is computed from the env var at build time; the list is empty if the var is unset |
| `images.formats` | `image/avif`, `image/webp` | |
| `images.minimumCacheTTL` | `31536000` (1 year) | |
| `images.qualities` | `[80, 82, 85]` | |
| `headers()` | Previews (`VERCEL_ENV === "preview"`): `X-Robots-Tag: noindex, nofollow` on all paths. `/admin/:path*`: `Cache-Control: private, no-store, max-age=0` plus noindex. `/auth/:path*` and `/api/:path*`: noindex. All paths: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` | |
| `redirects()` (permanent) | `/services/commercial-laundry → /commercial-laundry`, `/services/wash-and-fold → /services/wash-ironing-fold`, `/services/dry-cleaning → /services/ironing` | |

### Proxy (middleware) — `src/proxy.ts`
- In production only (`VERCEL_ENV === "production"`), it issues 301 redirects from the apex domain and any `*.vercel.app` host to the canonical `SITE_URL`, and from http to https.
- For `/admin*` it refreshes the Supabase session. When demo mode is off it redirects unauthenticated users to `/admin/login`. It also sets private headers.
- The matcher covers every path except `_next/` and paths containing a dot.
- Comments in the file state it is **not** the authorisation boundary. Pages and actions re-check the session and role, and RLS enforces access in Postgres.

### `vercel.json`
- One cron: `/api/internal/email/worker` at `0 0 * * *` (daily, 00:00 UTC).

### `tsconfig.json`

| Flag | Value |
|---|---|
| `strict` | `true` (no extra flags such as `noUncheckedIndexedAccess`) |
| `target` | `ES2022` |
| `module` / `moduleResolution` | `esnext` / `bundler` |
| `allowJs`, `skipLibCheck`, `isolatedModules`, `resolveJsonModule`, `esModuleInterop`, `noEmit`, `incremental` | all `true` |
| `jsx` | `react-jsx` |
| Path aliases | `@/*` → `./src/*` |

### `eslint.config.mjs`
- Extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`.
- Ignores `.next/**` and `scripts/**`.
- Disables the rule `react-hooks/set-state-in-effect`.

## 5. Structure

### Top two levels of `src/`

| Path | Purpose | Source |
|---|---|---|
| `src/app/` | Next App Router root: `layout.tsx`, `page.tsx` (home), `error.tsx`, `not-found.tsx`, `robots.ts`, `sitemap.ts`, `manifest.ts`, icons, `globals.css`, `ui-fixes.css` | directory listing |
| `src/app/[...slug]/` | One catch-all page that renders **every** public page except home | `src/app/[...slug]/page.tsx` |
| `src/app/admin/` | Admin console: `[[...segments]]/page.tsx` (single catch-all), `auth/callback/route.ts`, `loading.tsx` | directory listing |
| `src/app/api/` | Route handlers (public, `admin/`, `internal/`, `webhooks/`, plus an inert `[...path]` catch-all) | see the route table |
| `src/app/auth/` | `confirm/route.ts`, the Supabase email-link confirmation | directory listing |
| `src/components/` | UI. Top-level files cover public pages (`public-pages.tsx`, `home-page.tsx`, `shell.tsx`, `gallery.tsx`, `blog-body.tsx`, …) and visual effects (`fabric-scene.tsx`, `dotted-glow-background.tsx`, `brand-glow.tsx`) | directory listing |
| `src/components/admin/` | Admin console UI, 15 entries (for example `admin-app.tsx`, `content/blog-editor.tsx`) | directory listing |
| `src/components/forms/` | Public forms: `booking.tsx`, `public-form.tsx`, `controls.tsx` | directory listing |
| `src/components/home-hero/` | Homepage hero (scrollytelling and static variants) | directory listing |
| `src/components/seo/` | `json-ld.tsx` structured-data renderer | directory listing |
| `src/data/` | `content.json`, `assets.json`: static site copy and asset manifest, imported by `src/lib/content.ts` | `src/lib/content.ts` |
| `src/lib/` | Domain logic. Top-level files: `content.ts` (static content loader), `mock-store.ts` (client-side in-memory demo store, `"use client"`), `demo-mode.ts`, `features.ts` (demo/live/unconfigured backend state), `site.ts` (canonical URL and constants), `rules.ts`, `locations.ts`, `pickup-time.ts`, … | file headers |
| `src/lib/admin/` | Staff administration server actions (`staff-actions.ts`) | file |
| `src/lib/auth/` | Admin auth, role permissions and route map (`permissions.ts`), redirect safety (`redirect.ts`), sign-in actions (`actions.ts`) | files |
| `src/lib/bookings/` | Booking submission, config gate, admin lifecycle actions | `config.ts`, `submission.ts`, `admin-actions.ts` |
| `src/lib/email/` | Brevo client, config gating, outbox, worker, dispatch, templates, webhook, monitoring | directory listing |
| `src/lib/enquiries/` | Enquiry admin actions | `admin-actions.ts` |
| `src/lib/images/` | `optimize.ts` | file |
| `src/lib/newsletter/` | Newsletter-interest config and rate limit | `config.ts`, `rate-limit.ts` |
| `src/lib/reviews/` | Review actions and rate limit | `actions.ts`, `rate-limit.ts` |
| `src/lib/security/` | Rate limiting and request-origin checks | `booking-rate-limit.ts`, `rate-limit.ts`, `request-origin.ts` |
| `src/lib/seo/` | Metadata and JSON-LD schema builders | `metadata.ts`, `schema.ts` |
| `src/lib/supabase/` | Supabase config and clients (`config.ts`, `client.ts`, `server.ts`, `proxy.ts`, `admin.ts`) | files |
| `src/lib/website/` | CMS data: public reads (`public.ts`), admin write actions (`actions.ts`), write guard, site settings | files |
| `src/proxy.ts` | Next 16 Proxy (see §4) | file |

### Routes

**Public pages.** All are served by `src/app/page.tsx` (home) or `src/app/[...slug]/page.tsx` (`switch` at roughly lines 252–413; dynamic segments at lines 171–198):

| Path | Notes |
|---|---|
| `/` | `src/app/page.tsx` |
| `/services`, `/services/[slug]` | |
| `/how-it-works` | |
| `/locations`, `/locations/[slug]` | |
| `/about`, `/contact` | |
| `/commercial-laundry`, `/commercial-laundry/quote` | |
| `/gallery`, `/faq` | |
| `/blog`, `/blog/[slug]` | |
| `/reviews`, `/reviews/share` | |
| `/book` | |
| `/privacy`, `/terms`, `/laundry-care-terms` | |
| `/preview` (+ preview sub-routes) | `notFound()` unless demo mode is on (lines 413–414) |
| Metadata routes | `src/app/sitemap.ts`, `robots.ts`, `manifest.ts` |

**`/admin` pages.** Everything renders through `src/app/admin/[[...segments]]/page.tsx` → `AdminApp`. Route list from `src/lib/auth/permissions.ts` (lines 109–166) and `src/lib/auth/redirect.ts` (lines 8–11):

| Kind | Paths |
|---|---|
| Public (no session) | `/admin/login`, `/admin/reset-password`, `/admin/set-password`, `/admin/auth/callback` (route handler) |
| Protected | `/admin` (dashboard), `/admin/bookings`, `/admin/enquiries`, `/admin/reviews`, `/admin/newsletter`, `/admin/content`, `/admin/media`, `/admin/settings`, `/admin/staff`, `/admin/email-delivery` (and sub-paths) |

Default landing: `full_admin` goes to `/admin`; other roles go to `/admin/bookings` (`src/lib/auth/permissions.ts:244`).

**Route handlers.** The methods are the exported function names. Some handlers export several methods only to return 405; that was not checked for each file.

| File | Methods |
|---|---|
| `src/app/admin/auth/callback/route.ts` | GET |
| `src/app/auth/confirm/route.ts` | GET |
| `src/app/api/[...path]/route.ts` | POST (always returns 405; deliberately inert) |
| `src/app/api/bookings/route.ts` | POST, GET |
| `src/app/api/bookings/photo/route.ts` | POST |
| `src/app/api/enquiries/route.ts` | POST, GET |
| `src/app/api/newsletter-interest/route.ts` | POST, GET |
| `src/app/api/reviews/route.ts` | POST, GET |
| `src/app/api/reviews/public/route.ts` | GET, POST |
| `src/app/api/website/route.ts` | GET |
| `src/app/api/webhooks/brevo/route.ts` | POST, GET, PUT, PATCH, DELETE |
| `src/app/api/internal/email/worker/route.ts` | POST, GET, PUT, PATCH, DELETE. Requires a Bearer token matching `CRON_SECRET` or `EMAIL_WORKER_SECRET` (lines 37–46) |
| `src/app/api/admin/booking-alert-recipients/route.ts` | GET, POST, PUT, PATCH, DELETE |
| `src/app/api/admin/bookings/route.ts` | GET |
| `src/app/api/admin/bookings/[id]/photos/[photoId]/route.ts` | GET |
| `src/app/api/admin/email-delivery/route.ts` | GET |
| `src/app/api/admin/email-delivery/[id]/resend/route.ts` | POST |
| `src/app/api/admin/email-delivery/[id]/retry/route.ts` | POST |
| `src/app/api/admin/email-delivery/test/route.ts` | POST |
| `src/app/api/admin/enquiries/route.ts` | GET, POST |
| `src/app/api/admin/enquiries/[id]/route.ts` | GET |
| `src/app/api/admin/enquiries/[id]/update/route.ts` | PATCH |
| `src/app/api/admin/newsletter/route.ts` | GET, POST, PUT, PATCH, DELETE |
| `src/app/api/admin/promotion-image/route.ts` | POST |
| `src/app/api/admin/reviews/route.ts` | GET |
| `src/app/api/admin/session/route.ts` | GET |
| `src/app/api/admin/staff/route.ts` | GET |
| `src/app/api/admin/website/route.ts` | GET |
| `src/app/api/admin/website-media/route.ts` | POST |

**Server actions** (files starting with `"use server"`):

| File | Exported actions |
|---|---|
| `src/lib/admin/staff-actions.ts` | `inviteAdministrator`, `cancelAdministratorInvitation`, `resendAdministratorInvitation`, `changeAdministratorRole`, `setAdministratorStatus` |
| `src/lib/auth/actions.ts` | `signInAdmin`, `signOutAdmin`, `requestAdminPasswordReset`, `updateAdminPassword` |
| `src/lib/bookings/admin-actions.ts` | `saveBookingArrangement`, `changeBookingStatus`, `addBookingNoteAction` |
| `src/lib/email/recipient-actions.ts` | `addBookingAlertRecipientAction`, `updateBookingAlertRecipientAction`, `removeBookingAlertRecipientAction` |
| `src/lib/enquiries/admin-actions.ts` | `updateLiveEnquiry`, `fetchLiveEnquiry` |
| `src/lib/reviews/actions.ts` | `moderateReviewAction`, `publishReviewAction`, `reopenReviewAction`, `draftReplyAction`, `publishReplyAction`, `overrideReviewAction` |
| `src/lib/website/actions.ts` | `saveLiveFaqs`, `saveLiveGalleryWorkspace`, `saveLiveGalleryCategoryOrder`, `saveLiveBlogOrder`, `saveLiveContent`, `deleteLiveBlog`, `saveLivePromotion`, `saveLiveSettings`, `saveLiveLocation`, `saveLiveMedia`, `deleteLiveMedia`, `saveLiveService`, `deleteLiveService` |

## 6. Build

### Scripts (`package.json`)

| Script | Command |
|---|---|
| `dev` | `next dev` |
| `build` | `next build --webpack` (forces webpack instead of the default bundler) |
| `start` | `next start` |
| `typecheck` | `next typegen && tsc --noEmit` |
| `lint` | `eslint .` |
| `test` | `node --import tsx --test tests/*.test.ts` |
| `check` | `typecheck → lint → test → build` |

Standalone scripts in `scripts/`, not wired into npm:
- `scripts/generate-seo-assets.mjs`: generates the SEO icon set.
- `scripts/cleanup-stuck-staff-invites.mjs`: runs against Supabase with the elevated key. It is a dry run unless `--apply` is passed, and needs `STAFF_CLEANUP_ACTOR_ID`. It contains a hard-coded list of three staff email addresses.
- `scripts/prepare-handoff.mjs`: one-off importer from `../review/reimport/source/2ND_WAVE_FRONTEND_HANDOFF`.
- `scripts/refine.mjs`: one-off string-replacement codemod.

### Per-route segment config

| Export | Files |
|---|---|
| `revalidate = 60` | `src/app/page.tsx:9` (home only) |
| `dynamic = "force-dynamic"` | `src/app/admin/[[...segments]]/page.tsx:18`, `src/app/admin/auth/callback/route.ts`, `src/app/auth/confirm/route.ts` and every `src/app/api/**/route.ts` except `api/[...path]` |
| `runtime = "nodejs"` | `api/bookings`, `api/bookings/photo`, `api/enquiries`, `api/newsletter-interest`, `api/reviews`, `api/reviews/public`, `api/webhooks/brevo`, `api/internal/email/worker`, `api/admin/bookings`, `api/admin/bookings/[id]/photos/[photoId]`, `api/admin/email-delivery` (+ `[id]/resend`, `[id]/retry`, `test`), `api/admin/promotion-image`, `api/admin/reviews`, `api/admin/website-media` |
| `generateStaticParams` | None anywhere in `src/` |

`src/app/[...slug]/page.tsx` has no segment config export. Whether Next renders it statically or dynamically depends on its data access and was not determined, because no build was run.

### Image optimisation
- `next/image` is imported in 8 files under `src/`.
- `unoptimized` is used at `src/components/forms/booking.tsx:354` (booking photo previews) and conditionally for `blob:` URLs at `src/components/ui.tsx:72`.
- Remote images are allowed only from the Supabase `marketing-assets` public bucket (see §4).

## 7. Local development

### `supabase/` folder

| Item | Present? | Source |
|---|---|---|
| `supabase/config.toml` | **No** | `ls supabase/config.toml` |
| `supabase/seed.sql` | **No** | `ls supabase/seed.sql` |
| `supabase/migrations/` | Yes, **45** files from `20261010120000_admin_profiles.sql` to `20261111110000_gallery_category_order.sql` | directory listing |
| `supabase/bootstrap/` | 4 operator SQL scripts (provision full or operational admin, disable/restore, change role) that need a real auth user id | `supabase/README.md` |
| `supabase/tests/` | 8 SQL policy/security test scripts | directory listing |
| `supabase/README.md` | States that migrations are applied **manually**, that "Phase 1 migrations were applied manually to the hosted project", and that `supabase db reset` must never run against hosted | `supabase/README.md` |

### Can the app run against local Supabase?

**Not as written.** `readSupabaseConfig` requires the URL to match `/^https:\/\/[^\s/]+/` and otherwise returns `invalid-url` (`src/lib/supabase/config.ts`). The Supabase CLI's default local API URL is `http://127.0.0.1:54321`, so a standard local stack would be rejected. That would make admin auth "unavailable" and the business backend `unconfigured` (`src/lib/features.ts`). Combined with the missing `config.toml` and seed file, the repo is set up for **hosted Supabase or demo mode only**.

What does work locally without a database:
- **Demo mode.** It is on unless `NEXT_PUBLIC_DEMO_MODE=false` (`src/lib/demo-mode.ts`). The admin console uses an in-memory client store (`src/lib/mock-store.ts`). The README describes this as the "demo-only quickstart" (`README.md`, "Run locally").
- **Database tests.** They use PGlite (in-process Postgres) and never touch the hosted project (`supabase/README.md`, "Automated database tests").

### Risk: local dev against production data and real email

These facts were checked in this machine's `.env.local` without printing any values:

| Variable | State in `.env.local` | Effect | Source |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | https URL on a hosted `*.supabase.co` project | Local dev reads and writes the hosted database | `src/lib/supabase/config.ts` |
| `SUPABASE_SECRET_KEY` | Set | Elevated server client is enabled locally (staff invites, privileged RPCs) | `src/lib/supabase/admin.ts` |
| `NEXT_PUBLIC_DEMO_MODE` | `false` | Real admin auth; backend state is `live` | `src/lib/demo-mode.ts`, `src/lib/features.ts` |
| `BOOKING_SUBMISSIONS_ENABLED` | `true` | Public booking form persists real bookings | `src/lib/bookings/config.ts` |
| `NEWSLETTER_INTEREST_ENABLED` | `true` | Newsletter form persists | `src/lib/newsletter/config.ts` |
| `TRANSACTIONAL_EMAILS_ENABLED` | `true`, with `BREVO_API_KEY` set | **Real emails are sent** | `src/lib/email/config.ts` |

How email gets sent during local dev: `POST /api/bookings`, `POST /api/enquiries`, `POST /api/newsletter-interest`, the admin `changeBookingStatus` action, and the admin resend/retry routes all call `after(() => dispatchPendingEmails(...))`. This calls the Brevo API (`https://api.brevo.com/v3/smtp/email`) whenever `readTransactionalEmailConfig()` succeeds (`src/lib/email/dispatch.ts`, `src/app/api/bookings/route.ts:134`, `src/app/api/enquiries/route.ts:74`, `src/app/api/newsletter-interest/route.ts:139`, `src/lib/bookings/admin-actions.ts:217`, `src/lib/email/brevo.ts:21`). Staff alerts go to the alert recipient list stored in the database, so local testing can email real staff as well as the customer.

There is **no sandbox, dry-run or redirect-all-mail switch**. The only safeguard is setting `TRANSACTIONAL_EMAILS_ENABLED` to anything other than `true`; dispatch then logs "dispatch skipped" and returns (`src/lib/email/dispatch.ts`). `EMAIL_TEST_RECIPIENT` is used only by the admin "send test" route (`src/app/api/admin/email-delivery/test/route.ts:99`).

Whether the hosted Supabase project in `.env.local` is the **production** project or a separate development project cannot be determined from the repo (see Unknowns).

### Environment variables

`.env.example` has only four active lines (`NEXT_PUBLIC_DEMO_MODE`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`). Every other variable appears as a commented-out entry with documentation. Names referenced in `.env.example` and/or code (`src/lib/**`, `src/app/**`):

- **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (legacy fallback `NEXT_PUBLIC_SUPABASE_ANON_KEY`), `SUPABASE_SECRET_KEY` (legacy fallback `SUPABASE_SERVICE_ROLE_KEY`)
- **Site:** `NEXT_PUBLIC_SITE_URL`, `SITE_URL`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION`, `NEXT_PUBLIC_DEMO_MODE`, `WEBSITE_CONTENT_WRITES_DISABLED`
- **Feature gates:** `BOOKING_SUBMISSIONS_ENABLED`, `BOOKING_RATE_LIMIT_MODE`, `BOOKING_PRIVACY_NOTICE_VERSION`, `REVIEW_SUBMISSIONS_ENABLED`, `REVIEW_RATE_LIMIT_MODE`, `REVIEW_NOTICE_VERSION`, `NEWSLETTER_INTEREST_ENABLED`, `NEWSLETTER_RATE_LIMIT_MODE`
- **Email:** `TRANSACTIONAL_EMAILS_ENABLED`, `BREVO_API_KEY`, `BREVO_WEBHOOK_SECRET`, `EMAIL_WORKER_SECRET`, `CRON_SECRET`, `EMAIL_TEST_RECIPIENT`, and the template IDs `BREVO_TEMPLATE_{BOOKING_RECEIVED, BOOKING_CONFIRMED, PROCESSING_STARTED, LAUNDRY_READY, BOOKING_COMPLETED, BOOKING_CANCELLED, STAFF_ORDER_PENDING, STAFF_ORDER_PROCESSING, STAFF_ORDER_READY, STAFF_ORDER_COMPLETED, STAFF_ORDER_CANCELLED, ENQUIRY_RECEIVED, NEWSLETTER_INTEREST}_ID`
- **Script-only:** `STAFF_CLEANUP_ACTOR_ID` (`scripts/cleanup-stuck-staff-invites.mjs`)
- **Platform-provided:** `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `NODE_ENV`

Discrepancies:
- `BREVO_TEMPLATE_NEWSLETTER_INTEREST_ID` is read by code and set in `.env.local` but **missing from `.env.example`**.
- `.env.local` contains `BREVO_SENDER_EMAIL` and `BREVO_SENDER_NAME`. Code does not read these names; the header comment in `src/lib/email/config.ts` says Brevo uses the sender saved on each template.
- `.env.local` sets `SITE_URL` to a value other than the canonical production origin. `src/lib/site.ts` forces `NEXT_PUBLIC_SITE_URL` to `https://www.2ndwavelaundry.com` regardless of its value, so public canonical URLs always point at production.

## 8. Draft Local Development Guide

### Prerequisites
- Node.js **22 or newer** (`package.json` `engines`; no `.nvmrc`, so install 22 LTS manually).
- npm (the lockfile is `package-lock.json` v3).
- Git access to `github.com/samuel1578/2ND-WAVE-LAUNDRY`.
- Optional, only for real admin/database work: access to a **non-production** Supabase project with an https URL (see §7).

### 1. Clone
```sh
git clone https://github.com/samuel1578/2ND-WAVE-LAUNDRY.git
cd 2ND-WAVE-LAUNDRY
```

### 2. Install
```sh
npm ci
```

### 3. Environment
Copy `.env.example` to `.env.local`. For the safe default, leave it as copied. Demo mode is then on, there is no database, and no email is sent (`README.md`, "Run locally"; `src/lib/demo-mode.ts`).

If you need real admin sign-in or persisted data:
- Set `NEXT_PUBLIC_DEMO_MODE=false`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for a **development** Supabase project, and apply `supabase/migrations/` in filename order (`supabase/README.md`).
- Keep `TRANSACTIONAL_EMAILS_ENABLED` unset or `false` unless you are deliberately testing email.
- Never copy a production `.env.local` from another machine.

### 4. Run
```sh
npm run dev          # http://localhost:3000
```
Useful demo URLs (`README.md`): `/preview`, `/admin/login` (choose **Enter Demo Workspace**), `/admin/bookings/demo-1`, `/admin/content`.

Checks (`package.json`): `npm run typecheck`, `npm run lint`, `npm test` (PGlite, no server needed), `npm run build`, or `npm run check` for all four.

### Common pitfalls visible in the code
1. **Production `.env.local` sends real email and writes real data.** See §7. `TRANSACTIONAL_EMAILS_ENABLED=true` with a Brevo key causes every local booking, enquiry, newsletter sign-up and status change to email real customers and staff (`src/lib/email/dispatch.ts`).
2. **Local Supabase CLI is rejected.** The `http://` URL fails the `https://` check in `src/lib/supabase/config.ts`. There is also no `supabase/config.toml` or seed file.
3. **Demo mode is the default.** If `NEXT_PUBLIC_DEMO_MODE` is anything except the exact string `false`, the console runs on the in-memory mock store and nothing persists (`src/lib/demo-mode.ts`, `src/lib/features.ts`). `/preview` only exists in demo mode (`src/app/[...slug]/page.tsx:413`).
4. **Elevated key shape check.** `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY` must start with `sb_secret_` or `eyJ`; a publishable key is rejected as `invalid` (`src/lib/supabase/admin.ts`).
5. **Site URL is pinned to production.** `src/lib/site.ts` always resolves `SITE_URL` to `https://www.2ndwavelaundry.com`, so canonical URLs, sitemap entries and email links generated locally point at production.
6. **Canonical-host redirects only run on Vercel production** (`VERCEL_ENV === "production"` in `src/proxy.ts`), so they never fire locally.
7. **Remote images depend on the Supabase URL at build time.** If `NEXT_PUBLIC_SUPABASE_URL` is unset, `images.remotePatterns` is empty and CMS images from the `marketing-assets` bucket fail in `next/image` (`next.config.ts`).
8. **The build uses webpack** (`next build --webpack`). Expect build behaviour to differ from `next dev`.
9. **The email worker needs a secret.** Without `CRON_SECRET` or `EMAIL_WORKER_SECRET`, `/api/internal/email/worker` returns 503 `not_configured` (`src/app/api/internal/email/worker/route.ts`). The Vercel cron runs it once a day (`vercel.json`).
10. **graphify output is not committed.** `AGENTS.md` assumes `graphify-out/`, but it is gitignored, so regenerate it after cloning if you use agents.

---

## Unknowns — needs Samuel

1. Is the hosted Supabase project in the current `.env.local` the **production** project? Is there a separate development or staging project for local work?
2. Which migrations have actually been applied to production? `supabase/README.md` says this is "not inferred from this repository".
3. Is the GitHub repo `samuel1578/2ND-WAVE-LAUNDRY` private? Who else has access, and should ownership move to an organisation account?
4. Which Vercel team/project owns the deployment? Which env vars are set per environment (Production / Preview / Development)? Is `CRON_SECRET` set so the daily worker cron is authorised?
5. Is the Brevo account shared between development and production? Is there a sandbox/test sender? Are all 13 template IDs, including `BREVO_TEMPLATE_NEWSLETTER_INTEREST_ID`, set in production?
6. Purpose and status of the local branch `subagent/09b42c59` and the two extra worktrees. Can they be deleted?
7. Should the stray tracked files (`{`, `exclusions').eq('module'`) and the one-off scripts (`scripts/prepare-handoff.mjs`, `scripts/refine.mjs`, `blog-layout-qa.mjs`) be removed?
8. Is `prettier` meant to be used (no config or script exists)? Is a formatting standard expected?
9. Are `BREVO_SENDER_EMAIL`/`BREVO_SENDER_NAME` in `.env.local` leftovers? Code does not read them.
10. `docs/IMPLEMENTATION_REVIEW.md` (line 127) records the hosting decision "Vercel during development and testing; production hosting moves to Cloudflare once implementation and validation are complete." Is production on Vercel today, as `vercel.json`, `.vercel/` and `VERCEL_ENV` checks suggest, or is a Cloudflare move still planned?
