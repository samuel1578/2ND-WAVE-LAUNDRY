# Final report — SEO / AEO / GEO implementation

Date: 2 November 2026
Canonical origin used: `https://www.2ndwavelaundry.com` (from `NEXT_PUBLIC_SITE_URL`, with that
production URL as the fallback when the variable is unset).

## 1. What changed

### Before → after in one paragraph

Every public page was `noindex, nofollow` (root layout + catch-all) and `robots.txt` disallowed the
whole site. There was no sitemap, canonical, Open Graph, manifest, structured data or usable favicon.
Now public pages are indexable, canonical, self-describing and server-rendered with
Organization/WebSite/LocalBusiness/Service/FAQ/Breadcrumb/Article JSON-LD; admin, auth, API,
transactional and parameterised routes are excluded by both metadata and headers; and unknown URLs
return a real 404.

### Files created

| File | Purpose |
| --- | --- |
| `src/lib/site.ts` | Single source of truth for the origin, brand, phone, areas, socials, verification. |
| `src/lib/seo/metadata.ts` | One metadata builder: unique title/description, absolute canonical, OG, Twitter. |
| `src/lib/seo/schema.ts` | Organization, WebSite, DryCleaningOrLaundry, Service, FAQPage, BreadcrumbList, ItemList, BlogPosting. |
| `src/lib/locations.ts` | Unique branch copy, branch FAQ, area served, honest data gaps. |
| `src/components/seo/json-ld.tsx` | Escaped server-side JSON-LD renderer. |
| `src/app/sitemap.ts` | All public indexable URLs (26 today: 13 static + 10 services + 3 branches; blog posts added when published). |
| `src/app/manifest.ts` | Web app manifest with brand name, colours and icons. |
| `src/app/robots.ts` | Replaced blanket disallow with public policy + private paths + sitemap. |
| `src/app/icon.png`, `src/app/apple-icon.png`, `src/app/favicon.ico` | Stable favicon set served at `/icon.png`, `/apple-icon.png`, `/favicon.ico`. |
| `public/icon-192.png`, `public/icon-512.png` | Manifest and schema logo URLs. |
| `public/og-image.png` | 1200×630 social card. |
| `public/llms.txt` | Factual summary and key links for answer engines (Google does not use it). |
| `scripts/generate-seo-assets.mjs` | Reproducible icon/OG generation. |
| `docs/seo/00-AUDIT.md` | Pre-change audit. |
| `docs/seo/01-KEYWORD-MAP.md` | One primary keyword per page. |
| `docs/seo/02-CONTENT-PLAN.md` | 12 proposed posts (not published). |
| `docs/seo/03-OWNER-CHECKLIST.md` | GBP, Search Console, Bing, reviews, citations, maintenance. |
| `docs/seo/04-FINAL-REPORT.md` | This report. |

### Files changed

| File | Change |
| --- | --- |
| `src/app/layout.tsx` | `metadataBase`, brand-first title template, default description, OG/Twitter, robots index/follow, verification env vars, Organization + WebSite JSON-LD, `lang="en-GH"` retained. Removed the global `noindex` and the wordmark icon override. |
| `src/app/page.tsx` | Home metadata (absolute brand title, 158-char description), FAQPage JSON-LD matching the five visible FAQs. |
| `src/app/[...slug]/page.tsx` | Per-route metadata (unique title, description, canonical, OG), index/noindex per route, schema per page, breadcrumbs data, real 404s via `generateMetadata`. |
| `src/components/public-pages.tsx` | Branch page rebuilt: breadcrumb, unique intro/visiting copy, all-branch service links, branch FAQ, other-branch links, directions fallback. Added breadcrumbs to services, how-it-works, locations, about, contact, FAQ and blog. Added the visible "at a glance" facts block to About and Contact, plus the single "Second Wave Laundry" mention on About. |
| `src/components/shell.tsx` | Footer lists all three branches with links. |
| `src/app/globals.css` | Footer branch link styles. |
| `src/proxy.ts` | Canonical-host 301s (apex → www, `*.vercel.app` → canonical, http → https) in production. Admin session/redirect logic unchanged. Public routes intentionally return no response so Next keeps real status codes. |
| `next.config.ts` | Explicit `trailingSlash: false`; `X-Robots-Tag: noindex, nofollow` on `/admin/*`, `/auth/*`, `/api/*`; preview-deployment noindex; existing redirects retained. |
| `src/app/loading.tsx` → `src/app/admin/loading.tsx` | The root Suspense boundary forced every response to stream and made `notFound()` return 200. Scoping it to admin restores real 404 statuses; admin keeps its skeleton. |
| `.env.example` | Documented `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` and `NEXT_PUBLIC_BING_SITE_VERIFICATION`. |

### Redirects

- Retained: `/services/commercial-laundry` → `/commercial-laundry`;
  `/services/wash-and-fold` → `/services/wash-ironing-fold`; `/services/dry-cleaning` →
  `/services/ironing` (all permanent, verified 308).
- Added in `src/proxy.ts` for production only: apex `2ndwavelaundry.com` → `https://www.2ndwavelaundry.com`,
  any `*.vercel.app` host → the canonical domain, and http → https. 301, path and query preserved.
- No public URL was renamed.

## 2. Structured data per page (verified in rendered HTML)

| Page | JSON-LD types |
| --- | --- |
| Every page (root layout) | `Organization`, `WebSite` |
| `/` | FAQPage (5 visible questions) |
| `/services` | BreadcrumbList, ItemList |
| `/services/[slug]` | BreadcrumbList, Service, FAQPage |
| `/locations` | BreadcrumbList, ItemList |
| `/locations/[branch]` | BreadcrumbList, `DryCleaningOrLaundry`, FAQPage |
| `/commercial-laundry` | BreadcrumbList, Service, FAQPage |
| `/faq` | BreadcrumbList, FAQPage |
| `/blog` | BreadcrumbList, ItemList |
| `/blog/[slug]` | BreadcrumbList, BlogPosting |
| About / contact / how-it-works / gallery / policies | BreadcrumbList |

No `AggregateRating` or `Review` markup was added. No `HowTo` (deprecated by Google). No `SearchAction`
(the site has no search page). `Service` has no invented `offers`/price. Branch `LocalBusiness` omits
`geo`, `priceRange` and `streetAddress` because those values are not published.

## 3. Verification evidence

Run against a local production build (`next build` + `next start`) on 2 November 2026.

- **Status codes**: `/`, `/services`, all service pages, `/locations`, all branch pages, `/about`,
  `/contact`, `/faq`, `/blog`, `/gallery`, policies, `/book`, `/commercial-laundry`, `/commercial-laundry/quote`,
  `/reviews`, `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/icon.png`, `/apple-icon.png`,
  `/favicon.ico`, `/og-image.png` → **200**.
- **Real 404s**: `/this-page-does-not-exist`, `/services/not-a-service`, `/locations/not-a-branch`,
  `/blog/not-a-post` → **404** (body renders the branded not-found page).
- **Redirects**: `/services/wash-and-fold` → **308** `/services/wash-ironing-fold`;
  `/auth/confirm?type=invite` → **307** `/admin/set-password?state=unavailable&kind=invite`.
- **Admin**: `/admin/login` → 200 with `Cache-Control: private, no-store` and
  `X-Robots-Tag: noindex, nofollow`.
- **Auth/API headers**: `/auth/confirm` and `/api/website` both carry `X-Robots-Tag: noindex, nofollow`.
- **Metadata**: home canonical `https://www.2ndwavelaundry.com`; branch canonical
  `.../locations/ashaiman-atadeka`; service canonical `.../services/wash-ironing-fold`; all emit
  `index, follow`, `og:image` and a unique title. Example titles:
  - `2nd Wave Laundry | Laundry Services in Ashaiman & Katamanso`
  - `Laundry in Ashaiman & Atadeka | 2nd Wave Laundry`
  - `Wash, Ironing & Fold | 2nd Wave Laundry`
- **H1**: exactly one `<h1>` on every checked page (home, services hub, service detail, locations hub,
  all three branches, about, contact, FAQ, commercial, blog).
- **JSON-LD parse**: all script blocks on 11 representative pages parsed as valid JSON (0 errors).
  Types and required fields were checked against the current schema.org type names; `DryCleaningOrLaundry`
  is the correct LocalBusiness subtype. Validation was structural (parse + field review), not the Google
  Rich Results Test, which requires a public URL — use it after deploy.
- **Sitemap**: 26 `<loc>` entries, all canonical, no admin/auth/api/book/quote/reviews URLs. Blog posts
  appear automatically when published.
- **Robots**: public allow; disallowed `/admin`, `/auth/`, `/api/`, `/book`,
  `/commercial-laundry/quote`, `/reviews/share`, `/preview`, and `?state=`/`?kind=`/`?next=`;
  explicit allow for Googlebot, Googlebot-Image, Bingbot, GPTBot, OAI-SearchBot, ChatGPT-User,
  ClaudeBot, Claude-SearchBot, PerplexityBot; sitemap and host declared.
- **Icons**: `/icon.png`, `/apple-icon.png`, `/favicon.ico` all return 200, are stable public paths,
  and are not blocked by robots. The icon is a simplified wave tile because the wordmark is illegible
  at 48×48 (see §6).

### Lighthouse (mobile, simulated throttling, local production build)

| Page | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Home | 52 | 94 | 100 | 100 | 6.3 s | 0 | 1,320 ms |
| Branch (`/locations/ashaiman-atadeka`) | 68 | 100 | 100 | 100 | 5.1 s | 0.001 | 490 ms |
| Service (`/services/wash-ironing-fold`) | 64 | 100 | 100 | 100 | 5.3 s | 0 | 620 ms |

**Targets were not met for LCP/TBT** (target: LCP < 2.5 s, CLS < 0.1, INP < 200 ms). Lighthouse does
not measure INP directly; TBT is the proxy. The LCP element is the hero image
(`hero1.jpg`, 331 KB source, served through `next/image`); the largest opportunity is JavaScript
execution (TBT up to 1.3 s on home), from the client scrollytelling hero, `motion`, the cascade slider
and the promotion popup. The home accessibility score is 94; branch and service are 100.

Recommended performance follow-up (not done here, because it changes the hero experience and needs a
design decision): render a static first hero and hydrate the scrollytelling after interaction, reduce
the `motion` surface on first load, and convert `hero2.png`/`hero3.png` (~2 MB each) to AVIF/WebP.

## 4. Checks run

- `npm run typecheck` — pass.
- `npm run lint` — pass (0 errors; 9 pre-existing warnings unrelated to this work).
- `npm test` — 476 tests pass.
- `npm run build` — pass.
- Local production server checks as listed in §3.
- Staff invitation flow: `/auth/confirm` still redirects to `/admin/set-password` with the same
  private headers; the invitation unit tests pass. Admin sign-in renders with noindex headers.
- Booking page renders 200 and remains reachable.

## 5. TODOs — data only you can provide

1. **Street addresses** for the three branches. Currently only the town/area is published, and the
   schema deliberately omits `streetAddress`.
2. **Google Business Profile URL per branch.** Only the main branch has a Maps share link, used as
   `hasMap`; `sameAs` contains Instagram, TikTok and that Maps link.
3. **Latitude/longitude per branch** for `geo`.
4. **Areas served only by pickup and delivery.** The service-area list was blank, so no `/areas/*`
   pages were created. Creating them without a confirmed list would invent coverage.
5. **Confirm opening hours** for Katamanso No. 1 and Newland Katamanso (the site publishes one
   "7am–8pm" line for each).
6. **Facebook / X / LinkedIn URLs**, if they exist.
7. **Commercial segments** (hotels, restaurants, offices) before naming them in copy or schema.
8. **Dedicated square brand icon**, optional; the generated simplified wave tile is legible and
   compliant, but a purpose-drawn icon would be sharper.
9. **Blog publish/modified dates** are not exposed by the public projection, so `datePublished` and
   `dateModified` are omitted from BlogPosting rather than invented.
10. **Google-Extended preference.** It is currently allowed implicitly (wildcard). It controls Gemini
    training/grounding, not Google Search. Tell me if you want it blocked.
11. **IndexNow key + deploy hook** for Bing. Not enabled; needs an owner-generated key.
12. **Analytics decision.** None added. If you want analytics, choose a privacy-friendly option and
    decide on consent before adding a script.
13. **Update the Brevo email templates**: 13 files under `docs/emails/` still reference
    `https://2ndwave.vercel.app/...` for headers and the logo.

## 6. Decisions and conflicts found

- **Brand spelling.** The site and all published branch data use **Ashaiman** and
  **Ashaiman–Atadeka**; the brief's examples used "Ashiaman". I kept the site's spelling rather than
  putting a misspelling into copy. Google normalises the variant, and the branch page targets
  "laundry in Ashaiman". Flagging this in case the brief's spelling is the intended one.
- **Branch names.** The published main branch is "Ashaiman–Atadeka" (en dash). It is used identically
  in the page title, H1, breadcrumb, footer and schema, and should be matched in Google Business
  Profile.
- **Logo legibility.** The full wordmark is not legible at 48×48. Per the brief's allowance, the icon
  is a simplified wave mark on the brand blue tile, with no text. It was visually checked at 192px
  and 48px. A purpose-drawn icon is the better long-term asset.
- **Phone format.** Display `059 522 4280`; schema and `tel:` links use `+233595224280`. The other
  branches use their published numbers: `+233598148620` and `+233246144412`.
- **No `/areas/*` pages.** The pickup-only area list was blank. The typed data structure exists
  (`src/lib/locations.ts` → `serviceAreas`) and is intentionally empty.
- **Reviews page is `noindex`.** Its first HTML paint is an empty client-fetched state, so indexing it
  would be thin. The page remains linked and usable. No review schema was added.
- **`/book` and the quote form are `noindex`.** They are transactional form states, not landing pages
  and not in the sitemap.
- **Preview noindex** is applied by `next.config.ts` when `VERCEL_ENV=preview`, evaluated at build
  time on Vercel.
- **Proxy returns no response for public routes.** This was required to stop `notFound()` from
  becoming a soft 404. Admin behaviour is unchanged.
- **Root loading boundary moved to `/admin`.** Same reason: the root Suspense boundary committed a
  200 status before the page could signal 404.

## 7. Not done, and why

- Lighthouse performance target: measured, not met; see §3 for the cause and the recommended fix.
- Service-area pages: blocked on the missing list of pickup-only areas.
- Per-branch Open Graph images: the single branded card is used everywhere; spawn variants after the
  branch photography/address data is confirmed.
- IndexNow, analytics, Google-Extended blocking: owner decisions.
- Google Rich Results Test / Search Console validation: requires the deployed canonical URL, so it is
  in the owner checklist rather than run locally.
