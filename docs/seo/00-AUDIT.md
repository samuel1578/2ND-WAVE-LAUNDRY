# SEO / AEO / GEO Audit — 2nd Wave Laundry Services

Date: 2 November 2026
Scope: the Next.js App Router site at https://www.2ndwavelaundry.com
Status: read-only findings recorded before changes, with the post-change state noted where a route was re-checked.

## Executive summary

The site was invisible to search engines by configuration, not by ranking. The root layout and the
public catch-all route both set `robots: { index: false, follow: false }`, and `app/robots.ts`
disallowed the entire site with `Disallow: /`. No sitemap existed. No canonical, `metadataBase`,
Open Graph or Twitter metadata was emitted. The only icon was `icons: { icon: "/images/logo.png" }`,
a 512×512 wordmark whose small text is unreadable at favicon size.

The public content itself is substantial and well structured (three branches, ten services, fourteen
FAQs, policies, a database-driven blog). The problem was that none of it was crawlable, addressable
with one canonical URL, or described with structured data.

## a) Public routes and their pre-change metadata

All routes below are served by `src/app/page.tsx` (home) and `src/app/[...slug]/page.tsx` (everything
else), except admin, auth and API routes. Before the change, every one of them inherited
`noindex, nofollow` from the root layout and again from the catch-all `generateMetadata`.

| Route | Title before | Description | H1 | Canonical | OG/Twitter | Structured data | Indexable | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | `2nd Wave Laundry Services` (layout default) | layout default | "A Redefined Laundry Experience" | none | none | none | No | 200 |
| `/services` | "Our Services" | layout default | "Our Services" | none | none | none | No | 200 |
| `/services/[slug]` (10 routes) | service title | layout default | service title | none | none | none | No | 200 |
| `/commercial-laundry` | "Commercial Laundry" | layout default | "Commercial Laundry" | none | none | none | No | 200 |
| `/commercial-laundry/quote` | "Request a Commercial Quote" | layout default | quote H1 | none | none | none | No | 200 |
| `/how-it-works` | "Laundry arrangements made clear" | layout default | copy H1 | none | none | none | No | 200 |
| `/locations` | "Our Branches" | layout default | "Our Branches" | none | none | none | No | 200 |
| `/locations/[slug]` (3 routes) | branch title | layout default | branch title | none | none | none | No | 200 |
| `/about` | "About 2nd Wave Laundry Services" | layout default | about H1 | none | none | none | No | 200 |
| `/contact` | "Contact Us" | layout default | "Contact Us" | none | none | none | No | 200 |
| `/faq` | "Frequently Asked Questions" | layout default | FAQ H1 | none | none | none | No | 200 |
| `/gallery` | "Gallery" | layout default | "Gallery" | none | none | none | No | 200 |
| `/blog` | "Laundry Notes" | layout default | "Laundry Notes" | none | none | none | No | 200 |
| `/blog/[slug]` | "Page" (fallback) | layout default | article title | none | none | none | No | 200 |
| `/reviews` | "Customer Reviews" | layout default | reviews H1 | none | none | none | No | 200 |
| `/reviews/share` | "Share Your Experience" | layout default | form H1 | none | none | none | No | 200 |
| `/book` | "Book a Pickup" | layout default | booking H1 | none | none | none | No | 200 |
| `/privacy`, `/terms`, `/laundry-care-terms` | policy title | layout default | policy H1 | none | none | none | No | 200 |
| `/preview` (demo only) | "Frontend review" | layout default | preview | none | none | none | No | 200 / 404 |
| `/admin/*` | "Administration" | none | login/dashboard | none | none | none | No | 200/307 |
| `/auth/confirm` | n/a (route handler) | n/a | n/a | n/a | n/a | n/a | n/a | 307 |
| `/api/*` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | various |

H1 audit: exactly one `<h1>` per public page. The home H1 is the tagline, and the brand name appears
immediately above it in the hero (`2nd Wave Laundry Services`). Inner pages use breadcrumbs only on
service detail pages; branch, locations, about, contact, FAQ and blog pages had none.

## b) Layout, icons, robots and sitemap

- `src/app/layout.tsx`: title template `%s | 2nd Wave Laundry Services`; no `metadataBase`; the only
  icon was `/images/logo.png`; global `robots: { index: false, follow: false }`.
- `src/app/robots.ts`: `{ userAgent: "*", disallow: "/" }` — a full-site block, no sitemap reference.
- No `app/sitemap.ts`, `app/manifest.ts`, `app/icon.*`, `app/apple-icon.*` or `public/favicon.ico`.
- `public/images/logo.png` is 512×512 RGBA with a wordmark inside the wave; the words are illegible
  at 48×48. `app/favicon.ico` was absent.
- No Open Graph image file existed.
- `html lang="en-GH"` was already correct.

## c) Admin, auth, API and query-string states

- `/admin` already carried per-page `noindex, nofollow` metadata, and the proxy set private cache
  headers, but there was **no `X-Robots-Tag` header**. With the global meta noindex removed, admin
  would have relied on page metadata alone.
- `/auth/confirm` is a route handler that redirects to `/admin/set-password`; it emitted no robots
  header.
- `/api/*` emitted no robots header.
- Query-string states (`?state=`, `?kind=`, `?next=`) were reachable and were covered only by the
  global noindex. No parameter-level disallow existed.
- The admin proxy matcher covered `/admin` only, so no host-level canonicalisation existed anywhere.

## d) Existing content inventory

- **Branches (3)** in `src/lib/content.ts`: Ashaiman–Atadeka (main, 059 522 4280, Mon–Sat 7am–8pm,
  Sun 9am–7:30pm, Google Maps link), Katamanso No. 1 (059 814 8620, 7am–8pm), Newland Katamanso
  (024 614 4412, 7am–8pm). No street addresses, no individual Google Business Profile URLs, no
  coordinates.
- **Services (10 + commercial)**: wash, ironing and fold; wash and fold only; ironing; shoe care;
  stain treatment; duvet and bedding cleaning; curtain cleaning; suit cleaning; express/same-day;
  pickup and delivery; commercial laundry.
- **Locations hub**: branch cards with phone, hours, directions and a View Branch link.
- **Branch pages**: title, one-line intro, phone, hours, optional map. No unique long-form copy, no
  branch FAQ, no directions text for the two branches without a map.
- **About**: one paragraph of body copy, tagline, pickup/drop-off choice. No facts block.
- **Contact**: phone, WhatsApp, five email addresses, branch phone list, enquiry form. No branch
  hours, no facts block.
- **FAQ**: 14 published questions (11 site-wide + 3 commercial), used on `/faq`, home (first five)
  and service pages.
- **Blog**: database-driven; index and article pages exist. No article JSON-LD, no breadcrumbs, and
  the article `generateMetadata` fallback title was "Page". Publish dates are not exposed in the
  public post projection.
- **Reviews**: client-fetched, so the initial HTML is an empty state — thin for indexing.
- **Policies**: privacy, terms, laundry care terms.

What a branch page needed: unique local copy, address/directions honesty, nearby-area links,
branch-specific FAQ, LocalBusiness + Breadcrumb + FAQ schema, canonical and social metadata.

## e) Duplicate-content risks found

1. No canonical tags at all, so any host/protocol variant could be indexed independently.
2. `2ndwave.vercel.app` production alias and preview deployments could be crawled; no
   `X-Robots-Tag` on previews.
3. Non-www vs www and http vs https had no application-level redirect. Vercel may handle https, but
   the canonical host was not enforced in code.
4. Trailing-slash behaviour was Next's default and undocumented.
5. Query-string states (`?state=`, `?kind=`, `?next=`, `?service=`) had no canonical or crawl rule.
6. `/services/commercial-laundry`, `/services/wash-and-fold` and `/services/dry-cleaning` already
   redirect permanently, but the redirect destinations were not in any sitemap.

## f) Performance observations (not measured)

- The home hero is a client scrollytelling component with `motion`, plus a Three.js fabric scene and
  a cascade slider. Home also pulls the full public snapshot (services, branches, FAQs, gallery,
  promotions, settings).
- Hero images are 1536×1024 JPEG/PNG with `priority` on the first image — correct LCP handling, but
  large. Gallery tiles below the fold use `next/image` with `sizes`.
- Fonts: local Plus Jakarta Sans with `display: swap`, plus Boogaloo from Google Fonts with
  `display: swap`.
- Lighthouse was not run during the pre-change audit; the post-change results are recorded in
  `04-FINAL-REPORT.md`.

## g) Hard-coded domains and localhost references

- `docs/emails/**/*.html`: every email header image and logo URL is hard-coded to
  `https://2ndwave.vercel.app/...` (13 files, agenda-wide). These are Brevo template drafts, not
  runtime code, but the deployed templates must be updated.
- `docs/investigations/BREVO_SIX_TEMPLATE_PARAMETER_AUDIT.md`: production origin recorded as
  `https://2ndwave.vercel.app`.
- `tests/auth.test.ts` and `src/lib/auth/redirect.ts`: `*.vercel.app` appears deliberately in
  allow-list tests and documentation; not a public URL.
- Runtime auth URLs already resolve from `NEXT_PUBLIC_SITE_URL` / `SITE_URL`; no hard-coded
  production origin was found in application code.
- `localhost` appears only in documentation and tests.

## h) Gap list, ordered by impact

1. **Site-wide noindex + `Disallow: /`** — nothing could rank. (Critical)
2. **No sitemap and no canonical URLs** — no reliable discovery or consolidation. (Critical)
3. **No Organization/WebSite/LocalBusiness schema** — weak brand entity, no local eligibility.
   (High)
4. **Favicon was the full wordmark** — indistinguishable at 16–48px; Google would likely show a
   generic icon. (High)
5. **Thin, duplicated branch copy** — three near-identical branch pages, no local proof. (High)
6. **No FAQ structured data** on the pages that already show FAQs. (Medium-high)
7. **No Open Graph/Twitter metadata or image** — weak sharing and entity signals. (Medium)
8. **No breadcrumbs on most inner pages.** (Medium)
9. **No service schema**, no per-service unique descriptions. (Medium)
10. **No article schema or breadcrumbs on blog posts.** (Medium)
11. **No facts block** on About/Contact; no explicit "Second Wave Laundry" spelling variant. (Medium)
12. **No robots rules for answer-engine crawlers**, no `llms.txt`. (Low-medium)
13. **Preview deployments and the vercel.app alias indexable.** (Medium)
14. **No verification-token support** for Search Console/Bing. (Low)
15. **No IndexNow ping.** (Low)
16. **No service-area pages** because no pickup-only areas are published. (Blocked on data)
