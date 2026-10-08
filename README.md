# 2nd Wave Laundry Services — Next.js frontend

A responsive frontend implementation of the supplied mobile design handoff, adapted for desktop. Includes the public website, four-step pickup journey, public submission forms, invited-admin interface, CMS, media library and settings.

**This is a frontend preview, not a live business system.** No Supabase, R2, real authentication, transactional email or durable storage is connected. The API boundary deliberately returns `503 BACKEND_NOT_CONFIGURED`. Use sample information only.

## Run locally

Use Node.js 22 or newer. Open this folder in VS Code, then run:

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**.

- `/preview` — organised route index and state-review instructions.
- `/admin/login` — select **Enter Demo Workspace**; do not enter real credentials.
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

Public demo submissions appear in the appropriate admin queues when navigating within the same running tab. Photo selection records local preview metadata; it is **not** a private upload service. Upload progress is simulated and labelled as a local preview. Authentication and password-reset success screens are demonstrations, not real credentials or emails.

Use **Preview controls → Simulate next save failure** to review error/retry handling. Trigger validation by submitting incomplete forms. Content/settings link navigation prompts before discarding unsaved edits; closing/reloading uses the browser's native warning. Browser-back interception is not implemented and should be included in manual review.

Blog publication and review approval update their public demo views. Newsletter visibility and booking pause update the corresponding demo interfaces. Website Content's Locations, Gallery, FAQ and Promotion records are admin-only demo data: public pages keep reading the approved baseline until a backend is connected. The remaining public editorial pages use the approved content baseline; connecting every CMS publication/settings update to server-rendered content is a backend-integration task, not an implied live publishing service.

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

`npm run check` runs all four checks in sequence.

See `docs/IMPLEMENTATION_REVIEW.md` for results, limitations, manual acceptance checks and backend integration boundaries.

## Before going live

Do not simply hide the preview banner and publish. Wire trusted server validation, real invited-admin authentication, authorisation/RLS, private media handling, durable repositories, idempotency/rate limits, retention cleanup and observability first. Supply the approved legal policies, actual domain, image approvals and any real articles/reviews. Confirm the offer's activation dates before enabling it.

The whole preview is `noindex` and `robots.txt` blocks crawling. Canonicals, production sitemap and structured data must use the verified business domain and approved public content. Setting `NEXT_PUBLIC_DEMO_MODE=false` disables demo submissions/workspace entry; it does not enable a backend.
