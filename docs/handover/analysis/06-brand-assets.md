# Handover analysis 06 — Brand and design assets inventory

Snapshot taken 2026-11-13 at commit `f5940bc`. This was a read-only investigation: no files were converted or opened in an editor.

- **Pixel sizes** were read from each file's header with a small script.
- **Sizes** are bytes on disk.
- **"Used in"** comes from searching `src/`, `docs/emails/`, `supabase/migrations/`, `scripts/` and `next.config.ts` for each filename. Hashed photo names are mostly referenced through `src/data/assets.json`, which `src/lib/content.ts` loads.

Related: email header images and their production URLs are covered in [doc 03 §1](./03-infra-domains.md#1-hard-coded-url-audit); the Storage buckets in [doc 04 §7](./04-database.md#7-storage).

---

## 1. Asset inventory

### 1.1 Logos and brand marks

| Path | Format | Pixels | Size | Used in | Notes |
|---|---|---|---|---|---|
| `public/images/logo.png` | PNG | 512×512 | 28 KB | Site header and footer (`src/components/shell.tsx:120`), large logo on Home and About (`src/components/public-pages.tsx:310,338`), footer of all 12 email drafts with a footer (`docs/emails/**/*.html`) | **Primary logo, raster only.** It was copied from the external handoff file `00_REFERENCE/2nd Wave logo.png` (`scripts/prepare-handoff.mjs:16-19`). At 512 px it is fine for web but too small for print or signage |
| `public/images/header-dark.png` | PNG | 2048×2048 | 166 KB | Dark-theme replacement for the logo (`src/app/globals.css:543-544`) and dark-theme icon chips (`:5554-5556`) | Dark-mode logo variant, raster only |
| `public/logos-animated.mp4` | MP4 | — | 307 KB | Animated logo hero, light theme (`src/components/logo-video-hero.tsx:7`) | Video, not a logo file |
| `public/logo-animated.mp4` | MP4 | — | 452 KB | Animated logo hero, dark theme (`logo-video-hero.tsx:6`) | Video |
| `public/images/svg-1.svg` | SVG (171 vector paths) | 600×220 | 270 KB | Button background texture and service-hero panel (`globals.css:345,393,5306`) | A **decorative pattern, not a logo**. It is true vector (no embedded raster) |
| `public/images/svg-2.svg` | SVG (171 paths) | 600×220 | 272 KB | Button hover texture (`globals.css:372`) | Decorative pattern |

**There is no vector (SVG/PDF/AI/EPS) logo anywhere in the repo.** A search for `*.svg`, `*.ai`, `*.eps`, `*.psd` and `*.fig` outside `public/` found none. The only SVGs are the two decorative patterns above. ⚠️ **Raster-only logo.**

### 1.2 Favicons, app icons and social image

These were produced by `scripts/generate-seo-assets.mjs`. That script draws a **generated wave mark** (a blue rounded square, `#00609a`, with white and `#8ecbf3` wave strokes; `:25-30`) and a generated 1200×630 card (`:35-53`). **It does not use the original logo.**

| Path | Format | Pixels | Size | Used in | Notes |
|---|---|---|---|---|---|
| `src/app/favicon.ico` | ICO | 16, 32, 48 | 8 KB | Browser tab (Next convention) | The generator header says "48 + 96" (`generate-seo-assets.mjs:13`), but the file holds 16/32/48, so it was not produced by the current script |
| `src/app/icon.png` | PNG | 512×512 | 19 KB | Next metadata icon | Generated mark |
| `src/app/apple-icon.png` | PNG | 180×180 | 10 KB | iOS home screen | Generated mark |
| `public/icon-192.png` | PNG | 192×192 | 35 KB | Web manifest (`src/app/manifest.ts:17`) | Generated mark |
| `public/icon-512.png` | PNG | 512×512 | 116 KB | Web manifest (`manifest.ts:23`), and the **logo in structured data** (`src/lib/site.ts:65`, `LOGO_PATH`, used by `src/lib/seo/schema.ts:97,164`) | Search engines are therefore shown the generated mark, not the real logo |
| `public/og-image.png` | PNG | **1730×909** | 1.9 MB | Default social share image (`src/lib/site.ts`, `OG_IMAGE_PATH`) | ⚠️ The metadata declares 1200×630 (`src/app/layout.tsx:62-63`, `src/lib/seo/metadata.ts:62`), but the file is 1730×909 (same 1.9:1 ratio) and 1.9 MB. It was not produced by the current generator. Large for a social card |

`sharp` is used by the generator but not declared in `package.json`. It is only present as an optional transitive dependency, `sharp@0.35.5` (`package-lock.json`).

### 1.3 Email header images (hosted at `https://www.2ndwavelaundry.com/headers/…`)

| Path | Format | Pixels | Size | Used by template | Notes |
|---|---|---|---|---|---|
| `public/headers/general-booking.png` | PNG | 1584×672 | 1.1 MB | Booking received, completed, cancelled (`docs/emails/01-,05-,06-*.html`; `src/lib/email/templates.ts`) | Large file for email |
| `public/headers/booking-confirmed.png` | PNG | 1584×672 | 1.2 MB | Booking confirmed (`docs/emails/02-booking-confirmed.html`) | Large |
| `public/headers/processing-started.png` | PNG | 2172×724 | 1.9 MB | Processing started | Large |
| `public/headers/laundry-ready.png` | PNG | 2172×724 | 1.8 MB | Laundry ready | Large |
| `public/headers/newsletter.png` | PNG | 2172×724 | 1.9 MB | Newsletter interest (`docs/emails/newsletter/01-interest-received.html`) | Large |
| `public/headers/admin-order-pending.jpeg` | JPEG | 1024×338 | 86 KB | Staff alert, pending | — |
| `public/headers/admin-order-processing.jpeg` | JPEG | 1024×339 | 79 KB | Staff alert, processing | — |
| `public/headers/admin-order-ready.jpeg` | JPEG | 1024×338 | 74 KB | Staff alert, ready | — |
| `public/headers/admin-order-completed.jpeg` | JPEG | 1024×338 | 79 KB | Staff alert, completed | — |
| `public/headers/admin-order-cancelled.jpeg` | JPEG | 1024×339 | 71 KB | Staff alert, cancelled | — |
| `public/headers/general-booking.jpeg` | JPEG | 1024×339 | 57 KB | **Unreferenced** | Lighter alternative to the PNG |
| `public/headers/booking-confirmed.jpeg` | JPEG | 1024×339 | 69 KB | **Unreferenced** | Lighter alternative |
| `public/headers/staff-operations.png` | PNG | 2172×724 | 1.7 MB | **Unreferenced** | Older staff header |

The email templates render headers at 600 px wide, so every header above is at least 1.7× and fine for retina. The customer PNGs at 1.1–1.9 MB are heavy for email.

### 1.4 Photography and illustrations (`public/images/`)

| Path | Format | Pixels | Size | Used in |
|---|---|---|---|---|
| `hero1.jpg` / `hero2.png` / `hero3.png` | JPEG / PNG / PNG | 1536×1024 | 331 KB / 1.9 MB / 2.2 MB | Home hero (`src/components/home-hero/content.ts`) |
| `wash-ironing-and-fold.jpg`, `wash-and-fold-only.jpg`, `ironing.jpg`, `stain-treatment.jpg`, `shoe-care.jpeg` | JPEG | 1536×1024 | 271–328 KB | Services (`src/data/assets.json`; seeded in `supabase/migrations/20261109120000_services_admin_lifecycle.sql`) |
| `suit.jpg` | JPEG | **5472×3648** | **2.5 MB** | Services (same sources) | 
| `same-day-delivery.jpg` | JPEG | 1672×940 | 225 KB | Services (same sources) |
| `pickup.jpg`, `curtain.png`, `commercial-linen-stacks.jpg` | JPEG / PNG / JPEG | 1536×1024 / 1536×1024 / 1678×937 | 368 KB / **2.7 MB** / 204 KB | `src/lib/content.ts`; services migration |
| `GALLERY-1.jpg` … `GALLERY-5.jpg` | JPEG | 1536×1024 | 272–357 KB | Gallery (`assets.json`; `supabase/migrations/20261029170000_phase6_preserve_existing_content.sql`) |
| `6305c3ceaf884e73.jpg` | JPEG | 1678×937 | 206 KB | `assets.json` |
| 14 hashed `*.jpg` (for example `05f48f80a1f2b234.jpg`, `b182139fb8e5bdf3.jpg`) | JPEG | 512×382 / 512×279 / 512×286 / 382×512 | 24–46 KB | `assets.json`. ⚠️ **Low resolution** (512 px) |
| `13788b784498b279.jpg`, `6305c3ceaf884e74.jpg` | JPEG | 512×382 / 512×286 | 32 / 35 KB | **Unreferenced** |
| `pickup.png`, `same-day-delivery.png` | PNG | 1536×1024 / 1672×940 | 2.1 / 1.9 MB | **Unreferenced** (the JPEG versions are used) |
| `public/check.gif` | GIF | 640×640 | 1.1 MB | Booking success animation (`src/components/forms/booking.tsx`) |

**Rights status** (`docs/asset-provenance.json`): 18 of the files now in `public/images/` (all hashed JPEGs except `6305c3ceaf884e74.jpg`) are recorded with the status "Design-reference photography; verify rights and approval before launch". Their source is Google-hosted design-tool URLs. The other 25 files in `public/images/` have **no provenance entry**, including `logo.png`, the hero, service and gallery photos, and the SVG patterns.

### 1.5 Other files in `public/`

| Path | Notes |
|---|---|
| `public/UI-UX/code.html`, `public/UI-UX/screen.png` (585×5056), `public/UI-UX/POLICY CONTENT  FOR 2ND WAVE LAUNDRY WEBSITE.pdf` | Design-export reference material. Publicly downloadable; not used by the site (doc 03 §1) |
| `public/llms.txt` | Text summary for AI crawlers |
| `public/plus-jakarta-sans.woff2` | Font, see §3 |

## 2. Externally hosted images

| What | Where hosted | Source |
|---|---|---|
| Email header images and email footer logo | `https://www.2ndwavelaundry.com/headers/*` and `/images/logo.png`, served from `public/` by the production site. The old alias `2ndwave.vercel.app` also still serves them (doc 03 §1) | `docs/emails/**/*.html` |
| CMS media (Media Library, gallery, blog, promotion and service images uploaded through the admin) | Supabase Storage bucket **`marketing-assets`** (public), at `https://<project-ref>.supabase.co/storage/v1/object/public/marketing-assets/…` | `next.config.ts` `remotePatterns`; `src/app/api/admin/website-media/route.ts:18`; doc 04 §7 |
| Brand images in Supabase Storage | **None referenced by code.** The logo, icons and email headers all come from `public/`. What has been uploaded to `marketing-assets` (and the unused `website-media` bucket) is not visible from the repo | Unknowns |

## 3. Fonts

| Family | How loaded | Weights / styles | Where used | Licence |
|---|---|---|---|---|
| Plus Jakarta Sans | `next/font/local` from `public/plus-jakarta-sans.woff2` (27 KB), variable `--font-jakarta`, `display: swap` (`src/app/layout.tsx:23-27`) | Variable range 200–800 declared. CSS uses 400, 500, 600, 650, 700, 750 and 800 | Whole site body and UI (`font-family: var(--font-jakarta), Arial, sans-serif`, `src/app/globals.css`) | **Unknown.** The local file's origin is not recorded. The handoff script copied it in (`scripts/prepare-handoff.mjs`). Plus Jakarta Sans is published on Google Fonts under OFL, but this file's provenance is unverified |
| Boogaloo | `next/font/google`, weight 400, subset latin, variable `--font-boogaloo` (`layout.tsx:3,30-35`). Self-hosted by Next at build time | 400 | Public desktop navigation only (`.desktop-nav`, `globals.css:559`) | Google Fonts → **SIL Open Font License (OFL)** |
| Lato | External stylesheet `https://fonts.googleapis.com/css2?family=Lato:wght@400;700` in every email draft | 400, 700 | Email body text (`docs/emails/**/*.html`) | Google Fonts → **OFL** |
| Georgia, Arial / Helvetica | System fonts (no file) | — | Email headings use Georgia; Arial/Helvetica are fallbacks | System fonts, no licence needed |

There are no `@font-face` or `@import` rules in the site CSS (`src/app/*.css`).

## 4. Design tokens (from CSS)

**Colour tokens** (`src/app/globals.css:1-46`). Light is `:root`; dark is `[data-theme="dark"]`.

| Variable | Light | Dark | Role |
|---|---|---|---|
| `--canvas` | `#fafbfc` | `#0b1326` | Page background |
| `--surface` | `#fff` | `#131b2e` | Cards and panels |
| `--tint` | `#edf4ff` | `#171f33` | Soft blue fill (also the email footer colour) |
| `--tint-strong` | `#d9eaff` | `#24344d` | Stronger fill |
| `--ink` | `#102b51` | `#dae2fd` | Headings / brand navy |
| `--text` | `#091d2d` | `#f8fafc` | Body text |
| `--muted` | `#526477` | `#bac7da` | Secondary text |
| `--line` | `#d9e7ef` | `#334155` | Borders |
| `--primary` | `#00609a` | `#99cbff` | **Brand blue**: buttons, links |
| `--primary-hover` | `#004b78` | `#b6dbff` | Hover |
| `--on-primary` | `#fff` | `#003355` | Text on primary |
| `--danger` / `--danger-bg` | `#ba1a1a` / `#ffdad6` | `#ffb4ab` / `#441f28` | Errors |
| `--success` / `--success-bg` | `#146c40` / `#e5f5ea` | `#83e8a6` / `#16372d` | Success |
| `--brand-halo` | `0 0 8px rgba(0,96,154,.3), 0 0 18px rgba(0,96,154,.12)` | same, using `rgba(153,203,255,…)` | "Branded glow" text effect |

Hard-coded colours that recur outside the variables (frequency in CSS): `#405574` (9), `#c8d7e5` (8), `#eff5ff` / `#e8effb` (4 each), `#fff1ca` with `#855500` (3 each, warning style), `#12213a` and `#11224a` (3 each). The generated icon also uses `#8ecbf3` (`scripts/generate-seo-assets.mjs:30`). The email templates use `#0B80CA` for the staff VIEW ORDER button and `#102B51` / `#526477` / `#EDF4FF` text and fills (`docs/emails/staff/*.html`).

**Typography scale.** There are no type tokens; sizes are hard-coded. Counts across all 5 CSS files:

| Use | Values (count) |
|---|---|
| UI / small text | 9px (4), 10px (10), 11px (28), 12px (47), 13px (39), 14px (31), 15px (11), 16px (8), 17px (5) |
| Body | 16px base; 15px at ≤ 700 px (`globals.css:4126-4128`); fluid `clamp(15px, 1.3vw, 17.5px)` (4) |
| Headings | 18, 20, 21, 22, 24, 25, 28, 30, 32, 34, 38, 42 px |
| Weights | 650 (22), 600 (15), 700 (9), 500 (7), 800 (3), 750 (2), 400 (1) |

**Spacing.** There are no tokens. The most common gap, padding and margin values: 12px (47), 10px (46), 8px / 16px (37 each), 14px (24), 20px (20), 7px (18), 6px (17), 4px (16), plus 18, 22, 24 and 30px. This is effectively a loose 2/4 px rhythm.

**Radii.** `--radius: 16px` (18 uses). Hard-coded: 12px (20), 10px (18), 8px (15), 6px (10), 50% / 99px / 999px for pills and circles, plus 9px, 16px and 20px. Emails use 16px (card) and 8px (button).

**Shadows.**
- `--brand-halo` (above).
- Card shadow `0 10px 35px #102b5108`.
- Focus ring `0 0 0 2px var(--primary)`, and an inset variant.
- Dialog shadow `0 8px 24px rgba(3,12,35,.28)`.
- Subtle inset shadows `rgba(16,43,81,.04)` (light) and `rgba(1,8,20,.2)` (dark).

**Layout.** Header height `--header: 80px`, 72px at ≤ 700 px (`globals.css:4122-4124`). Common content max-widths: 700, 900, 850, 620, 420 and 320px.

**Breakpoints** (all media queries):

| Query | Count |
|---|---|
| `max-width: 700px` | 6 (the main mobile breakpoint) |
| `max-width: 900px` / `min-width: 900px` / `min-width: 901px` | 3 / 2 / 2 |
| `min-width: 701px` | 2 |
| `max-width: 760px`, `420px`, `1120px` | 2 each |
| `max-width: 980px`, `860px`; `min-width: 1500px`; `max-width: 700px and min-height: 700px` | 1 each |
| `prefers-reduced-motion: reduce` | 5 |
| `hover: hover and pointer: fine` | 2 |

**Z-index scale** (hard-coded): −1 (4), 0 (1), 1 (5), 2 (2), 3 (1), 10 (1), 40 (1), 200 (2), 10000 (1).

## 5. Design source

- **No design source files are in the repo**, and there are no Figma, Canva, Adobe or Framer links. A search for those hosts across tracked files found none.
- The design came from **Google Stitch exports**:
  - `README.md:126`: "CSS variables encode the supplied design systems. This implementation uses authored responsive CSS rather than carrying over Stitch's CDN Tailwind runtime."
  - `docs/source/2ND_WAVE_AI_PRODUCT_REFERENCE_PRD.md:5` refers to "Design.md and accepted Stitch exports".
  - The original export folder lived outside the repo, at `../review/reimport/source/2ND_WAVE_FRONTEND_HANDOFF/` (`scripts/prepare-handoff.mjs:4-6`).
- **Written design specs in the repo:** `docs/source/DESIGN.md` (light) and `docs/source/DESIGN-DARKMODE.md` (dark), plus `BRAND_GLOW_RECREATION.md` (root) for the branded-glow effect.
- **Logo rule** from the content spec: "Use the COMPLETE attached original logo, never a substitute or cropped symbol." (`docs/source/CONTENT LIGHTMODE.md:11`). Note that the favicon, app icons and structured-data logo currently use a **generated mark, not the original logo** (§1.2).

## 6. Zip manifest: Brand Assets folder

Flat list of repo files to package. Unreferenced or duplicate files are excluded, except where marked.

**Logos and marks**
```
public/images/logo.png
public/images/header-dark.png
public/logo-animated.mp4
public/logos-animated.mp4
public/images/svg-1.svg
public/images/svg-2.svg
```
**Icons and social**
```
src/app/favicon.ico
src/app/icon.png
src/app/apple-icon.png
public/icon-192.png
public/icon-512.png
public/og-image.png
scripts/generate-seo-assets.mjs
```
**Email headers**
```
public/headers/general-booking.png
public/headers/booking-confirmed.png
public/headers/processing-started.png
public/headers/laundry-ready.png
public/headers/newsletter.png
public/headers/admin-order-pending.jpeg
public/headers/admin-order-processing.jpeg
public/headers/admin-order-ready.jpeg
public/headers/admin-order-completed.jpeg
public/headers/admin-order-cancelled.jpeg
```
**Fonts**
```
public/plus-jakarta-sans.woff2
```
**Photography** (in use)
```
public/images/hero1.jpg
public/images/hero2.png
public/images/hero3.png
public/images/wash-ironing-and-fold.jpg
public/images/wash-and-fold-only.jpg
public/images/ironing.jpg
public/images/stain-treatment.jpg
public/images/shoe-care.jpeg
public/images/suit.jpg
public/images/same-day-delivery.jpg
public/images/pickup.jpg
public/images/curtain.png
public/images/commercial-linen-stacks.jpg
public/images/GALLERY-1.jpg
public/images/GALLERY-2.jpg
public/images/GALLERY-3.jpg
public/images/GALLERY-4.jpg
public/images/GALLERY-5.jpg
public/check.gif
```
**Design-reference photography** (rights unverified; include only if approved)
```
public/images/05f48f80a1f2b234.jpg
public/images/1944e33e4d55e1f8.jpg
public/images/3c4f7db9d2bab148.jpg
public/images/4f69a9b698948e18.jpg
public/images/5ce1f782e78c0422.jpg
public/images/6129cfe071390597.jpg
public/images/6305c3ceaf884e73.jpg
public/images/682123923183ecac.jpg
public/images/69163830e9dd3ee5.jpg
public/images/8e4078d1fb6320ef.jpg
public/images/a30b617e2ae65a96.jpg
public/images/b182139fb8e5bdf3.jpg
public/images/b63709fe216c2961.jpg
public/images/bf9d6059da5fd9a5.jpg
public/images/c423c0d4d4f31f87.jpg
public/images/c81dc6091d993e95.jpg
public/images/d75fb404bbe46011.jpg
```
**Design documentation**
```
docs/source/DESIGN.md
docs/source/DESIGN-DARKMODE.md
BRAND_GLOW_RECREATION.md
docs/asset-provenance.json
src/app/globals.css
```
**Optional / archive** (currently unused)
```
public/headers/general-booking.jpeg
public/headers/booking-confirmed.jpeg
public/headers/staff-operations.png
public/images/pickup.png
public/images/same-day-delivery.png
public/images/13788b784498b279.jpg
public/images/6305c3ceaf884e74.jpg
```
**Not in the repo, to obtain separately:** the original logo artwork (ideally vector), the Stitch export folder, and the font licence file (see Unknowns).

---

## Unknowns — needs Samuel

1. **Does a vector logo (SVG, AI, EPS or PDF) exist?** Who holds the original artwork? The repo has only a 512 px PNG (`public/images/logo.png`), copied from `00_REFERENCE/2nd Wave logo.png` in an external handoff folder.
2. **Should the favicon, app icons and structured-data logo be the real logo?** Today they use the generated wave mark (§1.2), which conflicts with the "complete original logo" rule in `docs/source/CONTENT LIGHTMODE.md:11`.
3. **Where did the Plus Jakarta Sans `.woff2` come from,** and under what licence? Is a licence file available?
4. **Who made `public/og-image.png` (1730×909, 1.9 MB) and the current `favicon.ico`?** Neither matches the generator script. Should the OG image be regenerated at the declared 1200×630?
5. **Image rights:**
   - The 18 hashed images (17 in use, plus the unreferenced `13788b784498b279.jpg`) are listed as "Design-reference photography; verify rights and approval before launch". Have they been approved or licensed?
   - Who owns the hero, service, gallery, curtain and suit photos? None have provenance entries.
6. **Google Stitch project:** does the original project or export still exist, and who owns it? It is the only design source.
7. **What brand images are in Supabase Storage?** That covers `marketing-assets` and the unused `website-media` bucket. Their contents are not visible from the repo.
8. **Brand guidelines:** is there an official palette or brand-book beyond `DESIGN.md`? Is the email button blue `#0B80CA` intentional, given the site primary is `#00609A`?
9. **Can the unreferenced and duplicate files be deleted?** These are the three headers in "Optional / archive", the two PNG duplicates and the two unused hashed JPEGs. The `public/UI-UX/` folder is a separate question.
10. **Should large assets be re-exported** at web sizes? Examples: `suit.jpg` (5472 px, 2.5 MB), `curtain.png` and `hero2/3.png` (~2 MB PNGs), the 1.1–1.9 MB customer email headers, and `check.gif` (1.1 MB).
