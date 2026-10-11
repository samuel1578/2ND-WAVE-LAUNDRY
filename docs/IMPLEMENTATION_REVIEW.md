# Implementation and review record

Date: 5 October 2026. Updated: 8 October 2026.

## Source hierarchy and assumptions

The supplied CONTENT v1.0 governs copy, SRS/PRD govern behaviour and the light/dark design documents govern visual language. The owner authorised building from the existing handoff despite subtle client-side Figma changes that were not supplied. Those unseen changes cannot be claimed as reproduced.

The provided HTML and PNG files are design references. This is a component-based responsive reconstruction, not a promise of pixel-identical HTML-to-Figma conversion. Desktop compositions and motion extend the mobile reference hierarchy.

The 116 HTML references include UI states, not 116 independent application pages. Public/admin route families and their states are listed in `/preview`; the component mapping below describes the consolidated implementation.

## Coverage

| Reference family                          | Implementation                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home, hero, public menu                   | `/`; shared Header, Logo, theme control, native dialog, three-chapter scrollytelling hero with static fallback                                                        |
| Services                                  | `/services`; ten `/services/[slug]` detail pages; service-specific booking preselection                                                                          |
| Commercial Laundry and quote states       | `/commercial-laundry`, `/commercial-laundry/quote`; one form with validation, loading, preserved-input failure and saved result                                  |
| How It Works                              | `/how-it-works`; pickup and walk-in flows                                                                                                                        |
| Branch index and three branch details     | `/locations`, `/locations/ashaiman-atadeka`, `/locations/katamanso-no-1`, `/locations/newland-katamanso`                                                         |
| Pickup flow / saved result / handoff      | `/book`; four stages, pending result, copy controls, manual editable WhatsApp draft                                                                              |
| Cutoff, closed hours, pause, photo errors | Shared scheduling and upload validators; pause at `/book?state=paused` or via admin settings                                                                     |
| Contact states                            | `/contact`; same form retained on failure                                                                                                                        |
| About, FAQs, Gallery and viewer           | `/about`, `/faq`, `/gallery`; keyboard-accessible lightbox                                                                                                       |
| Blog and article                          | `/blog`, `/blog/[slug]`; empty baseline, editable/publishable demo articles; real public article data remains a backend task                                     |
| Reviews and submission                    | `/reviews`, `/reviews/share`; empty baseline, moderation at `/admin/reviews`                                                                                      |
| Promotion and newsletter                  | Conditional Home components; `/preview` offer display; newsletter enabled in demo settings only                                                                  |
| Policies                                  | `/privacy`, `/terms`, `/laundry-care-terms`; explicitly unpublished, no invented legal body                                                                      |
| Admin authentication/recovery             | `/admin/login`, `/admin/reset-password`, `/admin/set-password`; demo-only states                                                                                 |
| Admin dashboard/menu                      | `/admin`; responsive sidebar/mobile menu, populated and empty states                                                                                             |
| Booking queue/detail/actions              | `/admin/bookings`, `/admin/bookings/[id]`; filters, assignment, arrangements, transition validation, notes/history, cancellation, manual WhatsApp update         |
| Enquiries/commercial quotes               | `/admin/enquiries`, `/admin/enquiries/[id]`; distinct queues, notes and status changes                                                                           |
| Newsletter interest                       | `/admin/newsletter`; consent detail and withdrawal, no campaigns                                                                                                 |
| Website Content                           | `/admin/content`; six modules (Services, Locations, Gallery, Blog, FAQs, Promotions) with module-specific workflows, `New Service`/`New Article`/`New Promotion` creates, no publication badges; `/admin/content/reviews` links to `/admin/reviews`; code-managed notices for Homepage/About/Policy Pages |
| Media                                     | `/admin/media`, `/admin/media/upload`, `/admin/media/[id]`; library, metadata, select/replace, local progress/cancel/error, archive/delete and in-use protection |
| Settings                                  | `/admin/settings`; contacts, pause, pickup rules, documented retention, newsletter toggle, validation, unsaved/saved/error states                                |
| Shared recovery and loading               | Next error/loading/not-found boundaries; admin query preview states for loading/error/access-denied/session-expired                                              |
| Confirmation dialogs and dark references  | Shared native dialogs, unsaved guards and semantic theme tokens across public/admin components                                                                   |

## Updates since the review (6 October 2026)

Owner-directed changes applied on top of the approved baseline. The source DESIGN documents were not altered; copy-bearing source documents (CONTENT/PRD/SRS) were updated to stay consistent with the running site.

1. **Service taxonomy and wording.** Wash & Fold became **Wash, Ironing & Fold** (`wash-ironing-fold`), Ironing became **Wash and Fold Only** (`wash-and-fold-only`) and Dry Cleaning became **Ironing** (`ironing`). Shoe Care moved to fourth position on `/services` and in the booking selector; the remaining services keep their relative order. Titles, CTAs, detail-page copy, eligibility/FAQ/promotion wording, homepage featured cards, media alt text and the admin/demo seeds all follow the new names. Section IDs `04.01`–`04.10`, asset keys and photographs remain tied to service identity rather than list position. Permanent redirects map `/services/wash-and-fold` → `/services/wash-ironing-fold` and `/services/dry-cleaning` → `/services/ironing`. `/services/ironing` deliberately has no redirect: it now serves the renamed Ironing service (formerly Dry Cleaning), while the previous Ironing page content lives at `/services/wash-and-fold-only` — record this URL delta before any SEO cutover.
2. **Booking load field.** The free-text "Items or approximate load" input is now a required **Load Size** dropdown (`1 Standard Bag`, `2 Standard Bags`, `3 Standard Bags`, `4+ Bags/Large Order`) with a "Select load size" prompt, a "Select a load size." validation message and a renamed review row. The value is stored in the unchanged `items` contract field, so repositories, admin views and existing records are unaffected. The notes field gained the native placeholder `eg: Please hang all the shirts and long sleeves..`.
3. **Logo rendering.** The hardcoded white plate on `.logo` (`background`, `border-radius`, `overflow`) was removed. The transparent logo artwork now sits directly on the header, hero, footer, mobile menu and auth card in both themes. The owner explicitly accepted the reduced contrast of the navy wordmark against dark backgrounds in dark mode.

`npm run check` (typecheck, ESLint, rule/repository/brand-highlight tests, production build) passes after these updates. Visual acceptance remains with the owner, per the SRS.

## Updates since the review (7–8 October 2026)

Owner-directed changes applied on top of the 6 October record. The source DESIGN documents remain unaltered; visual deviations from them are recorded here.

1. **Scrollytelling home hero.** Home now opens with a three-chapter scrollytelling hero (Opening, Care in Motion, Collection & Drop-off) over the supplied hero photography, with a static fallback for reduced-motion preferences. The responsive scrollytelling layout also runs on small screens. The Three.js fabric accent is no longer rendered anywhere; `fabric-scene.tsx` and the pinned `three` dependency are retained, unmounted.
2. **Service detail redraft.** All ten detail pages gained a breadcrumb, photographic hero, brief-card grid, handover choice with opposing slide motion, a shared "You may also need…" related list and a service closing. New shared copy landed in CONTENT and CONTENT LIGHTMODE: 04.00 Details/Handover/Related/Closing fields, 04.02 detail cards, 04.04 additional-information heading.
3. **Photography.** The home gallery shows five supplied photographs (Washing, Pressing, Garment packaging, Linen folding, Collection handover) in a swipeable mosaic; two obsolete exports were deleted. Wash, Ironing & Fold, Wash and Fold Only and Shoe Care cards and detail heroes use their dedicated supplied photographs (`wash-ironing-and-fold.jpg`, `wash-and-fold-only.jpg`, `shoe-care.jpeg`). Media alts must not contain "2nd Wave", "logo" or "brand": `content.ts` filters such photos out.
4. **FAQ answers.** FAQ lists are single-open accordions (first answer open, one at a time, fine-pointer hover previews after 120/250ms, click pins). Fourteen answers carry a curated glow phrase — the three shared 04.00 answers and all eleven section 13 answers — rendered as the brand-glow highlight.
5. **Desktop header.** Nav labels render in Boogaloo 16px with a prefix-matched animated active underline; the six header labels are hidden inside the full menu above 901px to avoid duplication.
6. **Buttons.** Primary, secondary and WhatsApp buttons layer the supplied topographic SVGs (`svg-1.svg`, `svg-2.svg`) over theme-aware background colours, so overlays work in both themes.
7. **Brand-line eyebrows.** The "2nd Wave Laundry Services" eyebrow above the closing heading renders at `clamp(27px, 3vw, 35px)` and the hero brandline up to 37px — two Word font sizes below their paired headings (50px→35px desktop; 62px→37px hero, responsive equivalents at each breakpoint). The base `.eyebrow` token stays 11px for every other eyebrow; DESIGN documents unchanged (deviation recorded here).
8. **Closing and related icons.** The sparkle badge in service closings and in the Wash, Ironing & Fold related-services chip was replaced by the theme-aware logo: `logo.png`, swapped to `header-dark.png` under `[data-theme="dark"]`.
9. **Newland Katamanso phone** corrected to `024 614 4412` (`tel:+233246144412`) in branch data, CONTENT LIGHTMODE and the PRD branch table.

`npm run check` passes (33 tests) after these updates.

## Updates since the review (8 October 2026) — Website Content rebuild

Owner-approved restructure of the admin CMS. The ten-module generic editor was replaced by module-specific workflows, then extended to six with Services at owner request; public-site files, `src/data/content.json` and `docs/source/CONTENT LIGHTMODE.md` were deliberately left untouched.

1. **Six modules.** `/admin/content` lists Services, Locations, Gallery, Blog, FAQs and Promotions with per-module counts and the contextual actions `Manage Services`, `Manage Locations`, `Manage Gallery`, `Manage Articles`, `Manage FAQs` and `Manage Promotions`. The global `Create New` button and dashboard publication badges are removed; Services, Blog and Promotions expose create actions (`New Service`, `New Article`, `New Promotion`).
2. **Services** (`/admin/content/services`) mirrors the approved ten-service catalogue into demo `state.content` records (ids = slugs, seeded `Published` with a published snapshot; `sort` follows catalogue order). The manager follows the Blog lifecycle: `New Service`, `Save Draft`, `Publish`, `Unpublish`, `Archive` and `Delete Draft` with confirmations, a preview dialog and one enabled primary action at a time; there is no publish-status select. Seeded bodies use each section's approved `Information` copy, with `04.10 Pickup & Delivery` falling back to its approved `Intro` (no invented text). Public `/services/*` pages keep the frozen baseline — these records are demo-only.
3. **Locations** (`/admin/content/locations`) lists the three fixed branch records with phone, opening hours and map status; `Edit Branch` opens a structured editor (name, label, phone, Google/Apple map link, labelled opening-hour rows with add/remove, sort order) with `Save Changes`, `Cancel` and `View Public Page`. Branches cannot be created or deleted from admin.
4. **Gallery** (`/admin/content/gallery`) edits a local draft of placements — multi-select from the Media Library, per-image alt text, caption, display order, `Show on Website`/`Hide from Website` toggles, `Remove from Gallery` with confirmation and `Save Gallery`. Removing a placement never deletes the library asset; archiving/deleting an asset that is still placed is blocked in the media library.
5. **Blog** (`/admin/content/blog`) keeps the existing `state.content` module `"Blog"` wiring and the public `/blog` read path. One enabled primary action at a time (`Publish` for unpublished or dirty published records, otherwise `Save Draft`), plus `Preview`, `Unpublish`, `Archive` and `Delete Draft` with confirmation; a draft edit preserves the published snapshot. There is no publish-status select.
6. **FAQs** (`/admin/content/faqs`) edits a local draft — per-row `Edit`, `Move Up`/`Move Down`, `Enable FAQ`/`Disable FAQ`, `Delete` with confirmation — and commits with `Save Changes`. Questions must be unique (case/punctuation-insensitive) and every FAQ needs an answer.
7. **Promotions** (`/admin/content/promotions`) are isolated admin records (`state.websiteContent.promotions`) that are never mirrored into `state.content` or any public page. States are Draft, Scheduled, Active, Paused and Ended; `Activate` requires the recorded date confirmation, lifecycle buttons are disabled while the record has unsaved changes, and `Delete Draft` is confirmed.
8. **Reviews moved.** Moderation moved to the dedicated `/admin/reviews` route (sidebar row with its own icon; the dashboard metric links there). It keeps the existing `state.leads` flow and consent rule. `/admin/content/reviews` shows a notice linking to it.
9. **Code-managed pages.** `/admin/content/{homepage,about,policy-pages}` show a "managed in code" notice with a back link instead of an empty editor.
10. **Styling.** New admin styles live only in `src/components/admin/content/content.module.css` (CSS Modules); no new global rules were added.

Admin edits to Locations/Gallery/FAQs/Services are demo records only: the public pages continue to read the approved frozen baseline. Blog remains the single CMS flow that reaches a public demo page. Backend persistence for all six modules is an integration boundary, not an implied live service.

`npm run check` passes after these updates (repository tests plus the new website-content suite).

## Updates since the review (8 October 2026) — Header brand label

The brand label beside the header emblem now reads **2nd Wave Laundry** (previously the short "2nd Wave") across public and admin, mobile and desktop, via the shared `Logo` component. The label was added to the hamburger menu dialogs for both sides — the admin menu's large logo previously showed the emblem alone. Supporting CSS in `globals.css` (the first edits to that file since the Website Content rebuild; header/logo rules only): an 8px gap between emblem and label, the navigation-dialog large logo now centres with `flex-wrap` so the label sits beside the emblem and drops below only when the viewport is too narrow, the label drops to `0.9rem` at the 700px breakpoint, and it is hidden at 360px and below so the 320px review width keeps the header actions on one line. The footer and public menu inherit the same label through the shared `Logo`; auth-card and home-hero large logos remain emblem-only.

## Updates since the review (8 October 2026) — Policy pages published

The three legal routes (`/privacy`, `/terms`, `/laundry-care-terms`) now render the client-approved bodies from `public/UI-UX/POLICY CONTENT FOR 2ND WAVE LAUNDRY WEBSITE.pdf` instead of the "Not yet published" notice.

1. **Content.** Bodies are stored verbatim in `src/data/content.json` section 18 (`heading` updated from the structure-only marker to `Policies`): privacy preamble/intro and three sections, terms three sections with bullet lists, care one section; wording and figures are unchanged from the PDF. `docs/source/CONTENT LIGHTMODE.md` §18 was rewritten to record the supplied bodies with the original suggested headings kept as superseded editorial reference.
2. **Component.** `src/components/policy-page.tsx` renders each page with the same glowing `page-hero` (dotted-glow + `Legal & Compliance` eyebrow) as the other hero pages, a `Sections Overview` anchor list (privacy only — terms/care use per-section intros), `.panel` section cards with bolded bullet labels, and a Related Policies card (privacy → terms, terms → laundry care, care → privacy). `public-pages.tsx` re-exports it. If any section body were ever removed the component still falls back to the unpublished notice, so empty legal pages cannot render as complete.
3. **Desktop responsiveness.** The policy routes were added to the `fullBleed` set in `[...slug]/page.tsx` (previously rendered inside the centred 1200px `container`, which trapped the full-width hero); the hero uses the standard `page-hero__inner` and content uses `container policy-doc` (1200px) instead of the 790px `narrow`. Section headings, body copy, bullets, preamble, TOC rows and the related card scale up with `clamp()` (e.g. section headings to 33px, body to 19px) and the TOC becomes a two-column grid above 901px.
4. **Glow keywords.** Policy copy runs through a local `PolicyText` highlighter built on the shared `splitHighlighted` helper — it glows the brand keywords plus the approved policy figures (`3 hours`, `48 hours`, `30 days`, `10x`, `7:00 AM`, `8:00 PM`, `30 minutes`, `059 522 4280`) wherever they appear; no text was altered.
5. **Tests.** New `tests/policy-content.test.ts` (2 tests) asserts all section bodies exist with no fourth sections and that every approved figure survives in the published text.

`npm run typecheck`, `npm run lint`, the 70-test suite and a production build pass after these updates.

## Updates since the review (8 October 2026) — Blog index hero

The `/blog` index now opens with the shared glowing `page-hero` (dotted-glow, standard 1200px inner, existing `Index H1`/`Intro` copy) like the other hero pages, with the article grid moved into a `.container` beneath it. `blog` was added to the `fullBleed` route set in `[...slug]/page.tsx` so the hero spans the full viewport width. Cards and article routes are unchanged.

## Updates since the review (8 October 2026) — Bookings inline status and branch updates

The bookings list (`/admin/bookings`) can now change status and branch directly from the table, on desktop and mobile.

1. **Status cell** is a badge-coloured native select whose options are the allowed transitions phrased as actions ("Confirm Booking" for `confirmed`, "Mark Scheduled"/"Mark Picked Up"/"Mark Processing"/"Mark Ready"/"Mark Out For Delivery"/"Mark Completed" otherwise), taken from `transitions` in `src/lib/rules.ts`. `Cancelled` is deliberately excluded — cancellation keeps its dedicated reason dialog on the detail page (the detail's own status select also excludes it). Terminal statuses (completed/cancelled) keep the static badge.
2. **Assigned branch cell** is a ghost select (Unassigned + the three branches from `src/lib/content.ts`) that gains a border on row hover.
3. Both call the single `repository.updateBooking` write path with the row's current `version`, disable that row's selects during the 550ms operation, and surface the outcome through a new list-level `Notice` — success confirmations plus store errors (confirmation gate such as "Assign a branch before confirming", version conflicts, demo failures). The controlled selects snap back to the stored value when a save fails; the list re-renders reactively from `useDemoStore`, so updated rows refresh in place.
4. **Styling.** New `.cell-select` rules in `globals.css` (next to the badge palette) mirror the badge colour per status with an inline-SVG chevron, a ghost `.branch` variant, a focus ring and a busy/disabled state. Native selects were chosen over a custom popover so the `.table-wrap { overflow: auto }` clipping constraint and first-of-kind popover code do not apply.

## Updates since the review (8 October 2026) — Admin header Sign Out (desktop)

The desktop admin header shows a `Sign Out` button (`.button.small.danger`) in `header-actions` before the hamburger; it clears the demo session and routes to `/admin/login`, matching the menu dialog and the sidebar. It is hidden by the existing 900px media block (`.admin-signout`), so mobile keeps using the dialog's Sign Out, and the public header is unchanged.

`npm run typecheck`, `npm run lint`, the 70-test suite and a production build pass after these updates.

## Updates since the review (10 October 2026) — Admin operations decisions (documentation only)

Investigation report produced at `docs/investigations/ADMIN_OPERATIONS_EMAIL_ARCHITECTURE.md` (read-only; no application code, schema, configuration or infrastructure was changed). The owner authorised the following decisions, and the source documents were updated to match. No implementation has started.

1. **Two administrator roles formally authorised.** `full_admin` (entire console, including emergency review overrides with mandatory reason and audit) and `operational_admin` (bookings and review moderation/replies only). This supersedes the earlier single-invited-admin assumption and removes "extra staff roles" from the PRD excluded list. Recorded in PRD §2a, PRD product goal, PRD excluded-scope note, PRD §7, SRS §1, SRS ADM-01, SRS §6 (`admin_profiles.role`) and the SRS access-control matrix (column renamed to "Admin (role-scoped)" with a role-interpretation note covering emergency overrides).
2. **Business domain confirmed: `2ndwavelaundry.com`.** Individual mailbox names (e.g. `info@`) are still undecided and must not be invented; `enquiry@example.com` remains illustrative only. Recorded in PRD §3, PRD §13, CONTENT LIGHTMODE "Unset facts" and INTERNAL targets, and the SRS verification gates.
3. **Hosting decision.** Vercel during development and testing; production hosting moves to Cloudflare once implementation and validation are complete. Next.js runtime feature compatibility (route handlers, middleware, scheduled/queue workers, Node APIs) must be confirmed against the chosen Cloudflare product before cutover. Recorded in PRD §5.
4. **Deferred to a later decision (not blocking design or Phase 1).** Individual mailbox/sender identities, approved marketing-consent privacy wording, retention periods for business email/reviews/newsletter subscribers, and verification of Brevo/Cloudflare/Supabase plan quotas against current official documentation. These gate activation of sending and collection features, not the engineering of roles, persistence or moderation.

No `npm run check` was required for these updates: only Markdown documentation changed. Visual and behavioural acceptance remains unchanged from the prior record.

## Updates since the review (10 October 2026) — Sprint 1A: Supabase foundation & administrator authentication

**Status: code complete — awaiting hosted configuration.** Supabase Auth is now wired into the administration console: `@supabase/supabase-js` + `@supabase/ssr` client infrastructure (`src/lib/supabase/`), a Next.js 16 Proxy (`src/proxy.ts`) that refreshes cookie sessions and redirects unauthenticated visitors away from protected `/admin` routes when demo mode is disabled, server-side identity and role resolution (`src/lib/auth/`), real sign-in/sign-out and password recovery, and two reviewed migrations creating `admin_profiles` with a constrained role enum and non-permissive RLS. Operational Admins can authenticate but are conservatively denied the console until Sprint 1B delivers role-filtered routes. Business data is unchanged: bookings, enquiries, reviews, newsletter, media and settings remain the in-memory demo store.

Full detail, manual Supabase steps, verification results and remaining work: `docs/implementation/SPRINT_1A_SUPABASE_AUTH.md`.

Boundaries that remain in force: the RLS policies are written but **have not been executed** against any database; no hosted migration has been applied; no real administrator account has been created; the demo `sessionStorage` flag is preview-only and inert when `NEXT_PUBLIC_DEMO_MODE=false`.

## Updates since the review (10 October 2026) — Sprint 1B: role-based administration

**Status: code complete — awaiting hosted configuration.** The administration console now has two properly separated role experiences. A central permission registry (`src/lib/auth/permissions.ts`) owns the permission list, the role→capability mapping, the canonical administrative route table, the per-role landing page and the navigation filter. The catch-all admin page resolves the authenticated administrator server-side and returns allowed, redirect (dashboard → landing page), forbidden (access-denied state, no module data resolved) or unknown (not-found) for every request. Operational Admins reach `/admin/bookings` and `/admin/reviews` only and never hold `reviews.override`; Full Admins retain every existing module. Desktop and mobile navigation render the same filtered list, with inaccessible modules omitted rather than disabled. Authentication is real but business data is not connected, so `src/lib/features.ts` drives one honest availability notice and the existing in-memory writes continue to fail closed outside the isolated demo preview. No CSS, booking rule, contract or migration changed.

Full detail, verification results and remaining work: `docs/implementation/SPRINT_1B_ROLE_BASED_ADMIN.md`.

## Updates since the review (10 October 2026) — Sprint 1C: security hardening, staff management & audit logging

**Status: PHASE 1 CODE COMPLETE — AWAITING DATABASE ACTIVATION / LIVE VERIFICATION.** Four new migrations and the staff-management module are written: an append-only `public.audit_events` log (Full-Admin readable, immutable even for the table owner, written only inside the transaction that performs the change), a staged `public.admin_invitations` lifecycle, and five `SECURITY DEFINER` `public.staff_*` functions that are executable only by `service_role`. A Full Admin-only `/admin/staff` module (server actions, `401`/`403` API, origin verification, per-actor rate limiting, reason-and-confirmation dialogs, activity log) now invites administrators through the server-only Supabase Auth Admin client, changes roles, and suspends or restores accounts — each with database-enforced invariants (no self-changes, last active Full Admin protected under an advisory lock, optimistic concurrency on stale edits) and a transactional audit event. Invitations grant nothing until accepted: the invitee's profile is created from the invited role by reconciliation at sign-in/`auth/callback`, and a failed invitation is recorded as failed rather than reported as success. The reviewed bootstrap scripts now write audit events too. No CSS, booking rule, contract, review behaviour or demo-mode behaviour changed; no dependency was added.

Boundaries that remain in force: **no Sprint 1C migration has been applied to the hosted project**, no real invitation has been sent, no live signed-in staff flow was exercised, and the database security tests (`supabase/tests/sprint_1c_staff_security.sql`) are **NOT EXECUTED**. Denied pages still return `200` with the access-denied state; rate limiting is per process, not distributed; suspension denies authorisation on the next request but is not provider-level session revocation.

Consolidated Phase 1 reference: `docs/implementation/PHASE_1_COMPLETE_IMPLEMENTATION.md`. Sprint detail: `docs/implementation/SPRINT_1C_SECURITY_STAFF_AUDIT.md`.

## Verification performed

- Sprint 1C: `npm run typecheck`, `npm run lint` (0 errors; one pre-existing warning in the tooling file `.opencode/plugins/graphify.js`), `npm test` (**106 tests**, including 15 new staff-domain tests and a staff-capability permissions test) and `npm run build` all pass. HTTP smoke against the built server: `GET /api/admin/staff` → `401`, `GET /admin/staff` → `307` to `/admin/login?next=%2Fadmin%2Fstaff`, `/admin/login` and `/` → `200`, and `Cache-Control: private, no-store, max-age=0` on `/admin/staff`. A client-bundle review confirmed no `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY` string in `.next/static/**` and no privileged key under a `NEXT_PUBLIC_*` name. No live signed-in staff flow, no hosted migration and no database test was executed.
- Sprint 1B: `npm run typecheck`, `npm run lint`, `npm test` (90 tests, including 11 new permission/role-matrix tests) and `npm run build` all pass; HTTP smoke checks confirm demo routes still serve and that a `NEXT_PUBLIC_DEMO_MODE=false` build redirects every protected `/admin` path — including unknown paths — to `/admin/login` with a validated `next` parameter. Authenticated role routing is covered by unit tests of the decision function; no live signed-in session was tested.
- Sprint 1A: `npm run typecheck`, `npm run lint`, `npm test` (80 tests, including 10 new auth tests) and `npm run build` all pass; a production-mode build (`NEXT_PUBLIC_DEMO_MODE=false`, no Supabase configuration) redirects every protected `/admin` route to `/admin/login` with a validated `next` parameter and offers no demo fallback. See `docs/implementation/SPRINT_1A_SUPABASE_AUTH.md` §14.
- TypeScript strict typecheck passed.
- ESLint passed.
- Production Next.js build passed.
- Rule/repository/website-content tests cover ordinary post-11am collection, exact express cutoff equality, 5pm closure, before-opening requests, future preferences, date/time validation, decimal 5MB limits, MIME allowlist, agreement requirements, terminal transitions, map URL validation, international phone validation, promotion expiry, brand keyword highlighting (longest-first ordering, case-insensitivity, possessives, typographic apostrophes, plain text untouched), concurrent duplicate submissions, error retries, stale admin edits, draft/published separation, in-use media, upload cancellation, booking pause, the six-module route configuration and service catalogue seeding, branch validation/optimistic saves, gallery ordering/visibility/asset guards, FAQ uniqueness/reorder, promotion lifecycle/confirmation/isolation, review consent and the no-propagation guarantee, and policy body completeness with the approved PDF figures.
- Supplied assets and the original logo-as-bedding defect were inspected directly; no generated replacement logo was used.
- No browser automation, screenshots, cross-device visual matrix or field performance measurement was performed. The owner performs visual review, per the SRS.

No claim is made that real backend persistence, authentication, permissions, uploads, emails, retention deletion, Core Web Vitals or full WCAG compliance have been tested.

## Important implementation boundaries

1. The mock adapter is not a security boundary. Never connect it directly to real customer records or use its sessionStorage flag as production authentication.
2. No public GET-by-booking-reference route exists. All placeholder API POSTs fail closed with a safe 503 response. No secrets are included.
3. Mock upload validation checks browser-reported size/MIME only. The real backend must verify bytes, decode/re-encode images safely, strip metadata, enforce ownership/expiry and use private storage for customer photos.
4. Guest submissions need server-controlled time and published-service validation. Demo cutoff checks use the browser clock only because no server persistence is connected.
5. Most public editorial pages consume the approved static baseline. The CMS demonstrates drafts/publication, but full server-rendered publication/invalidation and dynamically propagating all public settings remain backend work.
6. Demo blog routes are client-resolved and may return an HTTP 200 empty-state view for an unavailable slug. Production unpublished articles must return server-side 404 and remain absent from the sitemap.
7. Policy publication is only an interface/approval flag demonstration. Production collection remains disabled until approved bodies/versions and retention policies are configured.
8. The offer is off by default pending date approval. The popup is opened deliberately from offer details rather than auto-interrupting visitors; no background popup timer is installed.
9. The existing home hero image URLs were unavailable. Recovered service photography supplies the hero. Images are design-reference assets; do not claim these depict actual premises, staff or customer outcomes. Several are approximately 512px originals; no fabricated high-resolution enhancement is claimed.
10. Website Content now has module-specific editors for services, branches, gallery placements, articles, FAQs and promotions. Their demo records live in `state.websiteContent` (except Blog and Services, which keep `state.content`) and are not read by public pages; the backend schema should preserve that separation with real tables, permissions and audit fields rather than inferred generic CMS columns.
11. Native browser-back navigation does not display the custom unsaved dialog. Link navigation and page unload do. Include back-navigation protection in the next integration pass.

## Owner manual review

1. Run `npm ci` and `npm run dev`; open `/preview`.
2. Inspect Home, a service detail, branch pages, and the quote/contact forms at 440px, 320px and desktop width. Check image crops, text wrapping, buttons and headers against the approved Figma file.
3. Test System/Light/Dark and OS preference changes. Open/close both menus with keyboard and Escape. Ensure focus returns to the trigger.
4. Complete a sample booking, including multiple services and a different WhatsApp number. Check retained values across Back/Continue and a simulated save failure.
5. Inspect request cutoff behaviour, optional photo limits and the pending result. Opening WhatsApp is a real external link; review before sending any draft.
6. Enter the demo workspace. Find the sample request; confirm only after recording branch, pickup datetime, fee, contact outcome and notes. Verify cancellation and history.
7. In Website Content, edit a branch's opening hours, add and reorder gallery images, publish a blog article and check `/blog`, edit a seeded service's title and re-publish it, reorder or disable an FAQ, and walk a promotion through activate/pause/end. Save a promotion draft and inspect the confirmations. Submit a sample review and approve/reject it at `/admin/reviews`. Check newsletter opt-in/withdrawal if enabled.
8. Upload a local sample marketing image, cancel during progress, retry a failure and inspect its metadata. Try deleting the in-use seed asset.
9. Edit settings/content and follow another link to inspect unsaved-change warnings. Review reduced-motion behaviour using OS settings.
10. Compare the subtle client-approved Figma changes that were not in the original handoff and list the exact deltas before the backend phase.

## Backend integration sequence

1. ~~Real invited-admin auth, session/role checks, database schema and migrations.~~ Delivered in Sprint 1A (code complete); administrator invitations, role changes, suspension/restoration and audit logging were delivered in Sprint 1C. Remaining: apply the six migrations to the hosted project, execute both RLS/security test files against a disposable database, provision or invite the first Full Admin, and complete the Phase 1 manual QA checklist.
2. Published CMS reads and isolated draft revisions; contact settings; media storage and in-use references.
3. Booking creation transaction, idempotency, attachment claims, trusted scheduling, pause checks and rate limiting.
4. Admin lifecycle/version transactions, audit trail, private notes/photos, manual draft activity. (Route-level role authorisation was delivered ahead of this step in Sprint 1B, and the audit trail plus administrator lifecycle transactions were delivered in Sprint 1C; persistence-level authorisation for *business* records still arrives with these transactions.)
5. Enquiries/quotes, review moderation, consented interest and withdrawal.
6. Retention jobs, deletion/restore handling, redacted logs, alerts and backup verification.
7. Approved domain/policies/assets, production SEO, accessibility/device review, measured performance and authorised release.

## Current technical references consulted

- Next.js App Router installation: https://nextjs.org/docs/app/getting-started/installation
- Motion accessibility: https://motion.dev/docs/react-accessibility
- Motion LazyMotion: https://motion.dev/docs/react-lazy-motion
- Three.js responsive rendering: https://threejs.org/manual/pages/responsive.html
- Three.js disposal: https://threejs.org/manual/pages/how-to-dispose-of-objects.html

Exact installed versions are pinned in the lockfile. The styling/interaction choices follow the implementation skill's typed reusable components, explicit errors, accessible controls, least-authority boundaries and verification requirements.
