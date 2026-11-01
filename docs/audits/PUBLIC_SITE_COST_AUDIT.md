# Public Website Cost Audit — 2nd Wave Laundry

Read-only audit of what the public site costs in server CPU and Supabase/Vercel bandwidth.
No files, database rows, or configuration were changed by the analysis itself.

- **Date:** 2026-10-31
- **Mode:** read-only. No edits, no writes, no stash/revert/format. Read-only SELECTs only. No `.env*` file was opened, printed, or searched; secrets were loaded by the runtime and never displayed.
- **Live path:** `NEXT_PUBLIC_DEMO_MODE=false` locally, so `getPublicWebsiteSnapshot()` took the database branch during measurement.
- **Build:** `npm run build` **failed** before routing (`next/font` → `fonts.googleapis.com` unreachable in this sandbox), so route modes are derived from source code, not build output.

---

## 1. ROUTE TABLE

`npm run build` failed with:

```
getaddrinfo ENOTFOUND fonts.googleapis.com
NextFontError: Failed to fetch `Boogaloo` from Google Fonts.
    at src/app/layout.tsx
Failed to compile.
```

No `.next/server/app`, no `.next/prerender-manifest.json`. Modes below are read from code.

| route | mode | revalidate | DB queries per render |
|---|---|---|---|
| `/` | **ISR** — `export const revalidate = 60` (`src/app/page.tsx:4`), no dynamic API | 60 s | 9 (`getPublicWebsiteSnapshot`, `page.tsx:9`) on regeneration only |
| `/services` | **dynamic** | none | 9 |
| `/services/[slug]` (10 slugs) | **dynamic** | none | 9 |
| `/how-it-works` | **dynamic** | none | 9 — **renders none of it** |
| `/locations` | **dynamic** | none | 9 |
| `/locations/[slug]` (3 slugs) | **dynamic** | none | 9 |
| `/about` | **dynamic** | none | 9 |
| `/contact` | **dynamic** | none | 9 |
| `/commercial-laundry` | **dynamic** | none | 9 — **renders none of it** |
| `/commercial-laundry/quote` | **dynamic** | none | 9 — **renders none of it** |
| `/gallery` | **dynamic** | none | 9 — **renders none of it** |
| `/faq` | **dynamic** | none | 9 |
| `/blog` | **dynamic** | none | 9 + client `GET /api/website?module=blog` |
| `/blog/[slug]` | **dynamic** | none | 9 (discarded) + client `GET /api/website?module=blog` |
| `/reviews`, `/reviews/share` | **dynamic** | none | 9 — **renders none of it**; `/reviews` also `GET /api/reviews/public` |
| `/book` | **dynamic** | none | 9 — **renders none of it** |
| `/privacy`, `/terms`, `/laundry-care-terms` | **dynamic** | none | 9 — **renders none of it** |
| `/preview` (demo only) | dynamic | none | 9 |
| `/robots.txt` | static | — | 0 |
| `/api/website` (public, unauthenticated) | `force-dynamic` (`route.ts:6`) | `Cache-Control: public, no-store` | 1–2 per call, per module |

**Why every `[...slug]` route is dynamic.** `const query = await searchParams;` in
`src/app/[...slug]/page.tsx` (line 82) opts the whole catch-all into request-time rendering,
and there is no `revalidate` export. `getPublicWebsiteSnapshot()` is called unconditionally
at `src/app/[...slug]/page.tsx:84`, *before* the `switch (key)`, so all 19 page variants pay for it.
The DB client is `createSupabaseAdminClient` (`src/lib/website/public.ts:63`) created per call
with a custom `fetch` wrapper (`src/lib/supabase/admin.ts`); in Next 16 this is an uncached read
on every request.

---

## 2. WASTE FOUND

### a) Whole-snapshot read for pages that render nothing (structural)
`[...slug]/page.tsx:84` runs before the switch. These cases take no `website` prop:
`how-it-works`, `commercial-laundry`, `commercial-laundry/quote`, `gallery`, `reviews`,
`reviews/share`, `book`, `privacy`, `terms`, `laundry-care-terms`.

→ **10 route variants × 9 queries × 9,098 bytes for zero rendered rows.**

### b) `/gallery` double-work
The server snapshot loads gallery placements (874 B) + all media (1,126 B); `GalleryPage()`
(`src/components/public-pages.tsx`) takes no props, so the data is discarded, and the client
re-fetches the same data with `fetch("/api/website?module=gallery")` (`src/components/gallery.tsx:19`).

### c) Blog bodies in every list payload
`src/lib/website/public.ts:71` selects the whole `payload`, which includes `body`
(`toContent` in `src/lib/website/types.ts`), on every page.
Published blog rows today: **0**, so measured cost is 0. The write path caps a body at
50,000 chars (`saveLiveContent` in `src/lib/website/actions.ts`), so this is the only unbounded
term: 10 articles × 20 KB body ≈ **200 KB pulled on every public render**.

### d) `/blog` refetches the blog module it already has
`PublishedBlog` runs `fetch("/api/website?module=blog", {cache:"no-store"})`
(`src/components/published-content.tsx:28`) even when `snapshotPosts` was passed, then ignores
the result (`snapshotPosts ?? livePosts`). `/blog/[slug]` fetches **all** posts including bodies
to show one (`src/components/published-content.tsx:75`).

### e) `services.public_body` selected but never rendered
`src/lib/website/public.ts:66` selects `public_body`; the mapper only uses `summary`, `image`,
`bookable`. Measured total today: **20 bytes** — negligible now, waste by construction.

### f) A query that always fails
`src/lib/website/public.ts:66` selects `section`, which does not exist in the live table:

```
ERROR 42703 column services.section does not exist
```

Consequences: one guaranteed failed round trip per render; `serviceRows = servicesResult.data ?? []`
→ empty → `services.length ? services : defaultServices`, so **admin-edited services never appear
on the public site**. Live columns:
`id, slug, title, summary, kind, bookable, sort_order, active, version, created_at, updated_at,
public_body, public_image, public_alt`.

### g) Unfiltered reads
`website_gallery_media` (`src/lib/website/public.ts:70`) selects every media row with no filter
or limit, including archived rows, then filters in JS. FAQ fetches all 17 rows while home renders
`faqs.slice(0, 5)`.

---

## 3. REAL SIZES

Measured read-only against the live project. Bytes are exact JSON payload sizes returned by the
same `select`/filters the snapshot uses, measured over the REST API with the server key; no row
contents or secrets are reproduced here.

| part | rows | JSON bytes | notes |
|---|---|---|---|
| services (`select` minus `section`) | 10 | 2,025 | `public_body` total = 20 B (all empty) |
| services (`public.ts:66` as written) | — | **error 42703** | always fails |
| branches | 3 | 481 | |
| FAQ (`website_content` module=faq) | 17 | 5,320 | `payload` = 3,195 B |
| gallery placements | 4 | 874 | `payload` = 349 B |
| `website_gallery_media` (snapshot columns) | 7 | 1,126 | full `select *` = 2,616 B |
| blog (published) | **0** | 2 (`[]`) | |
| promotions | 1 | 914 | `payload` = 759 B |
| `public_site_settings` | 1 | 272 | |
| `booking_settings` | 1 | 109 | |
| **combined per render** | — | **9,098 B ≈ 8.9 KiB** | 8 successful + 1 failing request |

All `website_content` rows including unpublished (admin read reference): 24 rows, 5,641 B —
`faq` 3,195 B, `gallery` 429 B, `promotion` 1,312 B.

---

## 4. IMAGE FINDINGS

### a) Where the public site renders images

| location | element | source | settings |
|---|---|---|---|
| Home hero (3 stages) | `next/image` (`src/components/home-hero/stages.tsx`, `static-hero.tsx`) | `/public/images/hero1.jpg`, `hero2.png`, `hero3.png` | `width=1536 height=1024`, `sizes="(max-width:900px) calc(100vw - 40px), 44vw"`, `quality=82`; **opening: `priority`**, other two lazy |
| Home service cards (5) | `next/image` via `Picture` (`src/components/ui.tsx:62-73`) | `/public/images/*` | `fill`, default `sizes="(max-width:700px) 100vw, (max-width:1100px) 50vw, 600px"`, `quality=82`, `loading="lazy"` unless priority |
| Home gallery tiles | `Picture` | **Supabase public URL** (marketing-assets) | `fill`, `sizes="(max-width:700px) 82vw, (max-width:1100px) 40vw, 360px"`, lazy, q82 |
| Home editorial / commercial | `Picture` | `/public/images/*` | default sizes, lazy |
| Services index + service detail hero | `Picture` / `ServiceHero` | `/public/images/*` | hero `sizes="(max-width:900px) 100vw, 1200px"`, `priority` |
| Gallery page | `Picture` + lightbox `next/image` (`src/components/gallery.tsx`) | Supabase public URL | tile `sizes` 360px; lightbox `fill sizes="90vw" quality={85}` |
| About | `Picture priority` (`src/components/public-pages.tsx:457`) | `/public/images/*` | default sizes |
| Blog list / article | `Picture` | Supabase URL or `/images` | default sizes, lazy |
| **Promotions** | **plain `<img>`** (`src/components/published-content.tsx:245-252`) | **Supabase public URL** | `width=800 height=600`, `loading="lazy"`, **no `next/image`, no srcset — full original bytes** |
| Header/footer logo | `next/image` 68×68, `priority` | `/images/logo.png` | |
| CSS decorations | `background-image: url("/images/svg-1.svg")`, `svg-2.svg`, `header-dark.png` (`src/app/globals.css:292,317,335,467,3977,4188`) | `/public/images` | CSS, not optimizer-managed |

`public/images`: **43 files, 19 MB**.

### b) `next.config.ts` images block (`:15-27`)

```ts
images: {
  remotePatterns: supabaseHost
    ? [
      {
        protocol: "https",
        hostname: supabaseHost,
        pathname: "/storage/v1/object/public/marketing-assets/**",
      },
    ]
    : [],
  formats: ["image/avif", "image/webp"],
  minimumCacheTTL: 31536000,
  qualities: [80, 82, 85],
},
```

`qualities` covers the 82/85 used on the site.

### c) `src/lib/images/optimize.ts`

Exists (max edge 2000 px, WebP q0.85, skip when ≤1.5 MB and ≤2000 px).

- **Media Library upload: used.** `src/components/admin/media-admin.tsx:21`
  (`import { optimizeImage } from "@/lib/images/optimize"`) and `:176`
  (`const optimized = await optimizeImage(file);`) before `POST /api/admin/website-media`.
- **Promotion image upload: not used.** `src/app/api/admin/promotion-image/route.ts` only checks
  `value.size > MAX_PROMOTION_IMAGE_BYTES` (`src/lib/website/promotion-image.ts:5` = 2 MB) plus a
  magic-byte MIME check, then uploads the bytes as-is. `optimizeImage` has no call site outside
  `media-admin.tsx`.

### d) Storage: `marketing-assets` (read-only Storage API walk)

**7 objects, 2 folders, 7,445,346 B total.**

| object | bytes |
|---|---|
| `gallery/07d46b02-3dd5-45fc-9924-62d424961ab9.jpg` | 1,660,592 |
| `gallery/ecf79ec3-23fd-4e9c-baf5-c9082fc9be63.jpg` | 1,660,592 |
| `promotions/950e491d-079f-4423-89e3-ae9001248758.jpg` | 1,660,592 |
| `promotions/a9faace5-f82e-45a7-90ea-e6c95e802401.jpg` | 1,660,592 |
| `promotions/2a67e371-db07-439c-bdd7-1657f4bfa3e7.png` | 395,412 |
| `promotions/ae04c7b3-953c-4062-99b9-765d9712cdf3.jpg` | 358,388 |
| `promotions/43ccf899-b1c6-48c6-8c83-a57e3cc81f98.webp` | 49,178 |

---

## 5. TOP 5 COST RISKS (ranked)

1. **Every non-home page is uncached SSR that makes 9 Supabase calls for 8.9 KiB.**
   `[...slug]/page.tsx:84` with no `revalidate` export; the home page is the only ISR route.
   Evidence: 9 queries at `src/lib/website/public.ts:65-75`; 9,098 B measured; 10 route variants
   render none of it.

2. **A permanently failing query on every render.**
   `src/lib/website/public.ts:66` → `42703 column services.section does not exist`. One wasted
   round trip per page view, and admin service edits are silently replaced by `defaultServices`
   (`public.ts` fallback). Highest correctness risk in this audit.

3. **Unbounded blog payload growth × double fetch.**
   `public.ts:71` sends the full `body` on every page; `published-content.tsx:28` and `:75` pull the
   whole blog module again client-side. Cap is 50,000 chars/article (`actions.ts`), so cost scales
   linearly with content and is currently masked by 0 posts.

4. **Promotion images bypass the optimizer: ~1.66 MB per impression.**
   `published-content.tsx:245` renders a plain `<img … loading="lazy">`, and the upload route never
   calls `optimize.ts` (`MAX_PROMOTION_IMAGE_BYTES` 2 MB). Four of seven stored objects are exactly
   1,660,592 B — about 6.6 MB of the 7.4 MB bucket.

5. **`revalidatePath("/", "layout")` on every settings save.**
   `src/lib/website/actions.ts:125` invalidates the whole site on one toggle; meanwhile
   `saveLiveService` and `saveLiveLocation` revalidate nothing, so those edits stay stale until the
   60 s home ISR or a deploy.

---

## 6. SMALLEST FIXES, NOT APPLIED

Ordered by expected saving. None applied — this was a read-only audit.

1. **Move `getPublicWebsiteSnapshot()` into the switch arms that use it**
   (`src/app/[...slug]/page.tsx`) → removes 9 queries + ~9 KB per request on 10 route variants.
2. **Fix the `services` select**: drop `section` (`public.ts:66`); the baseline map already supplies
   it. Removes a guaranteed failure and restores admin service edits on the site.
3. **Narrow the blog select / stop the refetch**: select list fields without `body` for `/blog`,
   fetch one body for `/blog/[slug]`, and skip the client fetch when `snapshotPosts` exists.
4. **Render promotions with `Picture`/`next/image`** and call `optimizeImage` in
   `api/admin/promotion-image/route.ts`.
5. **Targeted revalidation instead of `["/", "layout"]`**, and add public paths to
   service/location saves.
6. **Give `[...slug]` a `revalidate` (or cache the snapshot with `unstable_cache`)** so identical
   public pages stop re-querying Supabase per visitor.
7. **Trim the snapshot**: gallery/media only where used; stop selecting `public_body` and unfiltered
   `website_gallery_media`.

---

## 7. WHAT COULD NOT BE VERIFIED

- **No build output.** `npm run build` failed on `next/font`/Google Fonts
  (`ENOTFOUND fonts.googleapis.com`); no `.next/server/app`, no `prerender-manifest.json`.
  Static vs. ISR vs. dynamic above is inferred from `revalidate` exports and `searchParams` usage.
- **No Vercel/CPU/bandwidth telemetry.** No function-invocation, duration, cache-hit or
  image-optimization metrics were available; figures are per-render byte/query counts, not bills.
- **No SQL aggregates.** Only the REST API was reachable, so byte figures are `JSON.stringify`
  lengths of real response bodies, not `octet_length(payload::text)`; they exclude Postgres wire/row
  overhead and gateway compression.
- **`storage.objects` is not queryable via REST**; bucket totals and per-object sizes come from the
  Storage list API metadata (7 objects, depth-limited walk).
- **Whether the promotion `<img>` actually downloads while its dialog is closed** (lazy-load in a
  hidden container) was not measured in a browser.
- **Schema drift is unresolved.** `services.section` exists in application code but not in the live
  table. Migrations were not applied or diffed in this read-only audit, so which side is stale is
  unknown — only that the query fails today.
- **Admin-authenticated flows** (saving, post-save revalidation, image upload behaviour) were not
  exercised.
- **Home ISR regeneration rate** under real traffic is unknown (60 s floor per route).
