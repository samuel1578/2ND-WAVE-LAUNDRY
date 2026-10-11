# 2nd Wave Laundry Services — Next.js frontend

A responsive frontend implementation of the supplied mobile design handoff, adapted for desktop. Includes the public website, four-step pickup journey, public submission forms, invited-admin interface, CMS, media library and settings.

**This is a frontend preview, not a live business system.** Administrator authentication is now real (Sprint 1A: Supabase Auth, sessions, roles, RLS-prepared `admin_profiles`), but business data is still the in-memory demo store — no booking, lead, review, media or settings record is written to the database, and no R2, transactional email or durable repository is connected. The public API boundary deliberately returns `503 BACKEND_NOT_CONFIGURED`. Use sample information only.

See `docs/implementation/SPRINT_1A_SUPABASE_AUTH.md` for the authentication foundation, the manual Supabase steps and the current sprint status.

## Run locally

Use Node.js 22 or newer. Open this folder in VS Code, then run:

```sh
npm ci
cp .env.example .env.local   # demo-only quickstart: no Supabase values needed
npm run dev
```

Open **http://localhost:3000**.

Without `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in
`.env.local`, the public preview and the demo workspace work exactly as before,
but real administrator sign-in fails closed with a configuration notice. Add
those two public values (never a service-role key) and apply the migrations in
`supabase/migrations/` to sign in for real — see
`docs/implementation/SPRINT_1A_SUPABASE_AUTH.md`.

- `/preview` — organised route index and state-review instructions.
- `/admin/login` — sign in with an invited administrator account, or select **Enter Demo Workspace** for the simulated preview workspace (do not enter real credentials into the demo path).
- `/admin/bookings/demo-1` — pending booking with confirmation, history, notes and cancellation.
- `/admin/content` — Website Content with Services, Locations, Gallery, Blog, FAQs and Promotions modules.
- `/admin/content/services/wash-ironing-fold` — seeded published service with draft, publish and archive states.
- `/admin/content/blog/new` — article draft editor with preview, publish and archive states.
- `/admin/reviews` — review moderation (approve/reject) moved out of Website Content.

Production compilation can be checked with `npm run build`; `npm start` runs that build locally. This does **not** make backend placeholders production-ready.

## What is implemented

- Home, all eleven services (ten detail routes plus Commercial Laundry), How It Works, three branches, About, Contact, Gallery and lightbox, FAQs, Blog/article templates, Reviews/submission, quote form, pickup flow and policy structures.
- Public hamburger and admin navigation based on the supplied menu references. No customer avatar, account system, online prices or payments.
- System/light/dark theme selection. Defaults to the operating system, follows its changes while System is selected, and remembers explicit overrides.
- Motion for React (Framer Motion) scroll entrances and restrained image movement. Content and conversion actions remain available without waiting for an animation.
- The Three.js fabric accent is retained but not currently mounted anywhere. `src/components/fabric-scene.tsx` and the pinned `three` dependency stay in the repository (dynamic import, pixel-ratio cap, disposal safeguards intact) without rendering.
- Real supplied photographic assets stored locally, not linked to fragile export URLs. The original export's logo-as-bedding defect is corrected using the available bedding photo. The clean, complete existing logo is reused without redrawing, and sits directly on the page surface with no background plate behind the transparent artwork.
- Typed in-memory mock repositories with pending requests, idempotent retry, allowed status transitions, stale-version conflicts, media in-use checks and cancellation-safe local upload previews.
- Accessible native dialogs, focus restoration, Escape support, field labels/errors, skip link, keyboard controls and reduced-motion fallbacks. Accessibility still needs owner/browser validation; no certification is claimed.

## Demo behaviour

Data is held **in memory** and resets on full refresh. Theme choice and the demo-workspace flag are the only persisted browser preferences. No customer data is written to localStorage.

Public demo submissions appear in the appropriate admin queues when navigating within the same running tab. Photo selection records local preview metadata; it is **not** a private upload service. Upload progress is simulated and labelled as a local preview. Sign-in, sign-out and password recovery for real administrator accounts go through Supabase Auth; demo entries and demo submission screens remain simulated and are labelled as such.

Use **Preview controls → Simulate next save failure** to review error/retry handling. Trigger validation by submitting incomplete forms. Content/settings link navigation prompts before discarding unsaved edits; closing/reloading uses the browser's native warning. Browser-back interception is not implemented and should be included in manual review.

Blog publication and review approval update their public demo views. Newsletter visibility and booking pause update the corresponding demo interfaces. Website Content's Locations, Gallery, FAQ and Promotion records are admin-only demo data: public pages keep reading the approved baseline until a backend is connected. The remaining public editorial pages use the approved content baseline; connecting every CMS publication/settings update to server-rendered content is a backend-integration task, not an implied live publishing service.

## Administrator authentication

Sprint 1A introduces real, server-verified authentication for the administration
console. It is deliberately layered so that navigation is never the only thing
protecting a route.

- **Supabase Auth** with cookie-based sessions (`@supabase/ssr`). One
  request-scoped server client per request; no shared global authenticated client.
- **`src/proxy.ts`** (Next.js 16 renamed Middleware) refreshes the session and
  propagates refreshed cookies to both the downstream request and the browser. It
  redirects unauthenticated visitors away from protected `/admin` routes, but it
  is **not** the authorisation boundary.
- **Server-side role resolution** (`src/lib/auth/admin.ts`) re-verifies the user
  with `auth.getUser()` and reads the role from `public.admin_profiles`. A
  client-supplied role is never trusted, and there is no parameter that accepts
  a user id, so an administrator cannot be impersonated.
- **Database RLS** is enabled on `admin_profiles`: anonymous callers cannot read
  it, an administrator can read only their own row, and no client can insert,
  update or delete profiles — role assignment happens only through a reviewed
  provisioning statement in `supabase/bootstrap/`.
- **Two roles**: `full_admin` and `operational_admin`. Full Admins reach every
  console module; Operational Admins reach **Bookings and Reviews only**, with
  the restriction enforced server-side on every request. A central permission
  registry (`src/lib/auth/permissions.ts`) owns the role→capability mapping, the
  canonical route table, the landing page per role and the navigation filter, so
  no component compares roles directly. See
  `docs/implementation/SPRINT_1B_ROLE_BASED_ADMIN.md`.
- **No public signup.** There is no `/admin/signup`, no client-side invitation
  and no self-service role assignment. Staff accounts are created by a trusted
  administrator in the Supabase dashboard, and roles are set only by a reviewed
  provisioning statement.
- **Role-aware navigation and landing pages.** Sign-in lands Full Admins on
  `/admin` and Operational Admins on `/admin/bookings`; an Operational Admin
  requesting `/admin` is redirected there, and a restricted module returns the
  access-denied state instead of rendering. Desktop and mobile navigation use the
  same permission source.
- **Honest data state.** Authentication is real; business data is not connected
  yet. Writes fail closed outside the isolated demo workspace, and the console
  says so rather than implying that a simulated save was persisted.
- **Demo isolation.** The `sessionStorage` demo flag is preview-only: it is
  inert when `NEXT_PUBLIC_DEMO_MODE=false`, and it can never reach a real
  database-backed administrator operation.

## Architecture

```text
src/app/                 Next.js App Router, metadata, error/loading boundaries
src/components/         Shared design components, navigation, motion, dialogs
src/components/forms/   Booking, enquiry, quote, review and newsletter flows
src/components/admin/   Administrative workflows and editors
src/components/admin/content/  Website Content modules (locations, gallery, blog, faqs, promotions)
src/lib/content.ts      Approved copy, service taxonomy, branch facts, assets
src/lib/contracts.ts    Typed data contracts / repository boundary
src/lib/mock-store.ts   Frontend-only data adapter (replace in backend phase)
src/lib/rules.ts        Testable scheduling, validation and transition rules
src/lib/supabase/       Supabase client factories (browser, request-scoped server, proxy refresh)
src/lib/auth/           Role model, permission registry and route authorisation, server identity resolution, safe redirects, auth server actions
src/lib/features.ts     Single feature-availability mechanism (demo versus unconfigured business data)
src/proxy.ts            Next.js 16 Proxy: session refresh and admin route protection
supabase/migrations/    Versioned SQL: admin_profiles and its RLS policies
supabase/bootstrap/     Reviewed provisioning statements for the first administrators
src/data/               Extracted approved content and asset references
public/                 Local imagery and self-hosted font
tests/                  Rules, mock-repository, brand-highlight and website-content tests
docs/                   Source documents and implementation/review record
```

CSS variables encode the supplied design systems. This implementation uses authored responsive CSS rather than carrying over Stitch's CDN Tailwind runtime. Components are native React, not HTML screenshots or iframes. Dependencies are pinned in `package.json` and `package-lock.json`.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run check` runs all four checks in sequence. `tests/auth.test.ts` covers role resolution, configuration failure, protected routes, safe return destinations and the auth redirect allow-list. `tests/permissions.test.ts` covers the role permission matrix, role-specific route decisions (allowed / redirected / forbidden / unknown), segment-boundary matching, navigation filtering for both roles and role-aware sign-in destinations. The database policy checks in `supabase/tests/admin_profiles_rls.sql` require a disposable Postgres/Supabase database and have not been executed.

See `docs/IMPLEMENTATION_REVIEW.md` for results, limitations, manual acceptance checks and backend integration boundaries.

## Before going live

Do not simply hide the preview banner and publish. Wire trusted server validation, real invited-admin authentication, authorisation/RLS, private media handling, durable repositories, idempotency/rate limits, retention cleanup and observability first. Supply the approved legal policies, actual domain, image approvals and any real articles/reviews. Confirm the offer's activation dates before enabling it.

The whole preview is `noindex` and `robots.txt` blocks crawling. Canonicals, production sitemap and structured data must use the verified business domain and approved public content. Setting `NEXT_PUBLIC_DEMO_MODE=false` disables demo submissions/workspace entry and requires real administrator authentication for `/admin`; it does not enable a business-data backend.
