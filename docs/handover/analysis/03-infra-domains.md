# Handover analysis 03 — Domains, security headers, auth URL config, DNS template

Snapshot taken 2026-11-13 at commit `f5940bc`. This was a read-only investigation of the repository. Four read-only `HEAD` requests were also made against the public production site to check live response headers and redirects; they are marked **(observed live)**. No secret values appear here, and no DNS values have been invented.

This doc does not repeat earlier material. The `next.config.ts` headers and redirects, `src/proxy.ts` and the `vercel.json` cron are in [doc 01 §4](./01-repo-stack-localdev.md#4-framework-config). The env vars (`SITE_URL`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `BREVO_WEBHOOK_SECRET`) and third-party services are in [doc 02](./02-env-services-emails.md).

---

## 1. Hard-coded URL audit

Scope: `src/`, `docs/emails/`, `public/`, `supabase/migrations/`, `scripts/`, `next.config.ts`, `vercel.json` and root `*.mjs`. Schema.org, W3C and Google Fonts URLs are omitted as standard. Verdicts: ✅ correct · ⚠️ should derive from config, or worth changing · ❌ wrong.

| file:line | Value | Context | Verdict |
|---|---|---|---|
| `src/lib/site.ts:11-12` | `https://www.2ndwavelaundry.com` / `www.2ndwavelaundry.com` | `FALLBACK_SITE_URL` and `CANONICAL_HOST`. The single source for site URLs; `NEXT_PUBLIC_SITE_URL` can only confirm this value | ✅ |
| `src/lib/site.ts:5` | `https://host` | Comment text | ✅ (not a URL in use) |
| `src/proxy.ts:41` | `2ndwavelaundry.com`, `.vercel.app` | Hosts that the production proxy redirects to canonical | ✅ |
| `src/lib/auth/redirect.ts:49,53,75,76` | `https://admin.invalid` | Dummy base used only to parse relative paths safely | ✅ |
| `src/lib/email/brevo.ts:5,21` | `https://api.brevo.com/v3/smtp/email` | Brevo API endpoint | ✅ |
| `src/lib/content.ts:28`, `src/lib/contact-links.ts:62`, `src/components/admin/bookings.tsx:643,1553` | `https://wa.me/…` | WhatsApp links | ✅ |
| `src/lib/content.ts:194`, `src/lib/seo/schema.ts:121`, `src/lib/site.ts:55` | `https://maps.app.goo.gl/MfrvXSLGNtUu22HL8?g_st=ic` | Main-branch map link, duplicated 3× | ⚠️ `schema.ts` and `content.ts` should import `MAIN_BRANCH_MAP_URL` from `site.ts` |
| `src/lib/content.ts:29-30`, `src/lib/site.ts:49-50`, `src/lib/mock-store.ts:208-209`, `supabase/migrations/20261028100000_phase6_website_content.sql:69-70` | `https://www.instagram.com/2ndwave_laundry/`, `https://www.tiktok.com/@2ndwave.com` | Social links in code, demo store and the CMS seed row | ✅ (the CMS copy can drift from code; owner-editable) |
| `src/components/admin/settings.tsx:234-236`, `src/components/admin/content/promotions-manager.tsx:387` | `…/yourname`, `https://example.com/your-offer` | Input placeholders | ✅ |
| `src/lib/content.ts:32-36`, `src/lib/site.ts:38`, `src/lib/newsletter/config.ts:19`, `public/llms.txt:13` | `orders@`, `support@`, `info@`, `billing@`, `manager@2ndwavelaundry.com` | Mailbox addresses on the **apex** domain; addresses, not URLs | ✅ (these depend on MX records, see §7) |
| `scripts/generate-seo-assets.mjs:51` | `www.2ndwavelaundry.com` | Text drawn into the OG image | ✅ |
| `blog-layout-qa.mjs:7` | `http://localhost:3000/admin/content/blog/new` | Local QA helper | ✅ (local-only tool) |
| `docs/emails/**/*.html` (12 files): header `<img>` (for example `staff/01-order-pending.html:43`) | `https://www.2ndwavelaundry.com/headers/<file>` | Hard-coded per-notification header image | ✅ host · ⚠️ cannot derive from `SITE_URL` (Brevo HTML is static); `headerImageUrl` is sent but unused (doc 02 §6) |
| `docs/emails/**/*.html` (12 files): footer (for example `01-booking-received.html:70-71`) | `https://www.2ndwavelaundry.com/` + `/images/logo.png` | Footer link and logo | ✅ host · ⚠️ same as above; `{{ params.websiteUrl }}` already exists for the link |
| `docs/emails/enquiry-received.html:5`, `docs/emails/newsletter/01-interest-received.html:6` | `manager@2ndwavelaundry.com` | HTML comments | ✅ |
| `vercel.json:2` | `https://openapi.vercel.sh/vercel.json` | `$schema` | ✅ |
| `src/lib/email/config.ts:166-167`, `src/lib/auth/redirect.ts:104,120`, `src/lib/admin/staff-actions.ts:345` | `localhost`, `127.0.0.1` | Loopback **allow-rules**, not destinations | ✅ |

**Old Vercel domain: explicit confirmation**
- ✅ **None in the email drafts.** No `vercel.app` string appears in `docs/emails/`.
- ✅ **None in SQL.** No `vercel.app` and no site URL is baked into any migration or database function. The only absolute URLs in `supabase/migrations/` are the Instagram and TikTok seed values above. Email URLs are computed in TypeScript at send time from `SITE_URL` (`src/lib/email/templates.ts:331-333,476-481,564-566,593`), not stored in the database.
- ✅ **None in runtime code**, except the proxy's redirect test (`src/proxy.ts:41`) and a comment (`src/lib/auth/redirect.ts:89`).
- ℹ️ **Historical docs still mention `https://2ndwave.vercel.app`:** `docs/investigations/BREVO_SIX_TEMPLATE_PARAMETER_AUDIT.md:4,308-378`, `docs/seo/00-AUDIT.md:106-156`, `docs/seo/03-OWNER-CHECKLIST.md:119`, `docs/seo/04-FINAL-REPORT.md:174`. These are records, not configuration.
- ⚠️ **(observed live)** `https://2ndwave.vercel.app/` returns `301 → https://www.2ndwavelaundry.com/`, but `https://2ndwave.vercel.app/headers/general-booking.png` returns **200**. The proxy matcher skips paths containing a dot (doc 01 §4), so static files are still served on the old alias. Any saved Brevo template that still points at the old alias keeps showing images, so the problem stays hidden until that alias is removed.

**Incidental:** everything in `public/` is publicly served. `public/UI-UX/` (3 tracked files: `code.html`, `screen.png` and a policy-content PDF) is therefore reachable at `/UI-UX/…`. Confirm it is meant to be public (Unknowns).

## 2. Canonical domain consistency

| Generator | Origin source | Output | Verdict |
|---|---|---|---|
| `metadataBase`, root Open Graph (`src/app/layout.tsx:43,54,61,72`) | `SITE_URL` constant, `absoluteUrl()` (`src/lib/site.ts`) | `https://www.2ndwavelaundry.com` | ✅ |
| Per-page canonical + OG/Twitter (`src/lib/seo/metadata.ts:48-53`) | `absoluteUrl(path)` | www, https | ✅ |
| Sitemap (`src/app/sitemap.ts`) | `SITE_URL` constant | www, https | ✅ |
| Robots `sitemap:` line (`src/app/robots.ts`) | `${SITE_URL}/sitemap.xml` | www, https | ✅ |
| Manifest (`src/app/manifest.ts:9-10,17,23`) | relative `start_url: "/"`, `scope: "/"`, icon paths | relative, so it inherits the serving host | ✅ |
| JSON-LD (`src/lib/seo/schema.ts:91-97,130-135,150-172,196,213,228,268-270`) | `SITE_URL`, `ORGANIZATION_ID`, `WEBSITE_ID`, `absoluteUrl()` | www, https. CMS images that are already absolute (Supabase Storage) pass through unchanged (`site.ts` `absoluteUrl`) | ✅ |
| **Email params** `websiteUrl`, `contactUrl`, `privacyUrl`, `viewOrderUrl`, `enquiryUrl` (`src/lib/email/templates.ts`) | **`SITE_URL` env var** via `readSiteUrl` (`src/lib/email/config.ts:150-171,192`) | Whatever the env holds. It must be https (or `http://localhost`) with no path, but it is **not pinned to www** | ⚠️ apex, `*.vercel.app` or a preview origin would be accepted silently. `.env.local` already holds a non-canonical value (doc 02 §2) |
| Staff invite `redirectTo` (`src/lib/admin/staff-actions.ts:125-140,207`) | `NEXT_PUBLIC_SITE_URL ?? SITE_URL` (**raw env**, not the pinned constant) | env value + `/admin/set-password` | ⚠️ not pinned, and the priority order is the reverse of reset |
| Password reset `redirectTo` (`src/lib/auth/actions.ts:66-72,160-161`) | `SITE_URL ?? NEXT_PUBLIC_SITE_URL`, else a loopback host (`resolveAuthOrigin`, `src/lib/auth/redirect.ts:92-115`) | env value + `/admin/auth/callback` | ⚠️ not pinned |
| **(observed live)** HTTP and apex | Vercel platform | `http://www…` → `308 https://www…`; `https://2ndwavelaundry.com/` → `308 https://www…` | ✅ handled by Vercel before the proxy runs; the proxy's apex branch is a backup |

No generator emits an apex or non-https URL **from code**. The only exposure is the three env-driven paths above, which depend on what is set in Vercel (Unknowns).

## 3. Security header gaps (recommendations only)

**(observed live)** Production currently sends `Strict-Transport-Security: max-age=63072000` (added by Vercel), plus the headers from `next.config.ts` (doc 01 §4). It sends **no** CSP, COOP, CORP or COEP.

1. **HSTS: strengthen the existing header.** Recommended: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, set in `next.config.ts` `headers()`.
   - Risk: `includeSubDomains` forces https on **every** subdomain of `2ndwavelaundry.com`. Confirm first that no subdomain (mail, webmail, Brevo tracking) is served over http only.
   - Submit to the browser preload list only after that is confirmed; removal from it is slow.
2. **Cross-Origin-Opener-Policy.** Recommended: `same-origin` for all paths.
   - Low risk: no popups or OAuth windows exist. Sign-in is email and password (`src/lib/auth/actions.ts:94`).
3. **Cross-Origin-Resource-Policy: do not set it globally.**
   - Email header images and the logo (`/headers/*`, `/images/logo.png`) are loaded by webmail clients from other origins.
   - `same-origin` or `same-site` would block those loads in clients that don't proxy images.
   - Recommended: `same-origin` only on `/admin/:path*` and `/api/:path*`, or omit it.
4. **COEP: do not add.** `require-corp` would break the Supabase Storage images (CMS images and signed booking-photo URLs) unless every cross-origin response opts in.
5. **Content-Security-Policy.** Ship it as **`Content-Security-Policy-Report-Only` first.** Starting point:
   ```
   default-src 'self';
   script-src 'self' 'nonce-<per-request>' 'strict-dynamic';
   style-src 'self' 'unsafe-inline';
   img-src 'self' data: blob: https://<project-ref>.supabase.co;
   font-src 'self';
   media-src 'self';
   connect-src 'self' https://<project-ref>.supabase.co;
   frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
   ```
   Risks specific to this codebase:
   - **Inline scripts that run.** Next.js's bootstrap scripts and `next-themes` (`src/components/providers.tsx:2,7`, which injects an inline theme script) both need a **nonce**.
     - Next reads the nonce from a CSP header set in the proxy, so the CSP would be built in `src/proxy.ts`.
     - Today the proxy returns early for public pages (`src/proxy.ts`, "public routes return no response"). That logic would need rework without losing real 404 statuses.
     - Nonces force **dynamic rendering**, which removes the home page's `revalidate = 60` caching (`src/app/page.tsx:9`) and any static rendering of `[...slug]`.
     - A hash-based CSP is the static alternative, but it is brittle.
   - **JSON-LD** (`src/components/seo/json-ld.tsx:10-13`) uses `<script type="application/ld+json">`. It is a data block that CSP does not block, so no change is needed.
   - **Inline styles:** there are 44 `style={{…}}` props in `src/`, and `motion` animates via inline styles. Removing `'unsafe-inline'` from `style-src` is not realistic, so keep it.
   - **`blob:` images** are used for local photo previews (`src/components/forms/booking.tsx:182`, `src/components/admin/media-admin.tsx:136`, `src/components/admin/content/shared/media-library-picker.tsx:140`).
   - **Supabase:**
     - CMS images go through `/_next/image`, which is same-origin.
     - Signed booking-photo URLs are fetched by the admin browser directly from Storage (`src/lib/bookings/photo-access.ts:110-124`, returned as JSON by `src/app/api/admin/bookings/[id]/photos/[photoId]/route.ts`).
     - The admin UI uses the browser Supabase client (`src/components/admin/admin-app.tsx`), which needs `connect-src` for the project host.
     - No Realtime usage was found, so no `wss:` entry is needed.
   - **three.js / WebGL** (`src/components/fabric-scene.tsx`, `dotted-glow-background.tsx`): no `eval`, `new Function` or Workers were found in `src/`, so no `unsafe-eval` or `worker-src` should be needed. Verify in Report-Only.
   - **Brevo** is server-to-server only (`src/lib/email/brevo.ts`) and needs no browser origin.
   - **Fonts:** `next/font` self-hosts (`src/app/layout.tsx:2-3`), so `font-src 'self'` should suffice; `data:` may be needed. Verify in Report-Only.
   - **`blog-editor.tsx:950`** renders admin-authored HTML via `dangerouslySetInnerHTML`. A CSP is useful protection there.
6. **`X-Frame-Options: DENY`** is already sent. Add `frame-ancestors 'none'` with the CSP and keep both.

## 4. Supabase Auth URL dependencies

| Flow | Code | Supabase call | `redirectTo` passed | Link type the code expects | Depends on Supabase Auth email? |
|---|---|---|---|---|---|
| Sign-in | `src/lib/auth/actions.ts:94` | `signInWithPassword` | — | — | No |
| Sign-out | `src/lib/auth/actions.ts` (`signOutAdmin`) | session sign-out | — | — | No |
| Password reset request | `src/lib/auth/actions.ts:145-170` | `resetPasswordForEmail(email, { redirectTo })` | `${SITE_URL ?? NEXT_PUBLIC_SITE_URL}/admin/auth/callback`. A loopback origin is used only when neither is set (`src/lib/auth/redirect.ts:92-115`); with no origin the request fails with `ORIGIN_UNAVAILABLE` | `?code=` (PKCE) **or** `?token_hash=…&type=recovery` at `/admin/auth/callback` (`src/app/admin/auth/callback/route.ts:51-78`) | **Yes** (recovery email) |
| Invite administrator | `src/lib/admin/staff-actions.ts:125-140` → `src/lib/admin/staff-service.ts:247-249` | `auth.admin.inviteUserByEmail(email, { redirectTo })` | `${NEXT_PUBLIC_SITE_URL ?? SITE_URL}/admin/set-password`, https or `http://localhost` only. Missing → `not_configured` | **Preferred:** the dashboard invite template links to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/admin/set-password` (`docs/implementation/STAFF_INVITATION_OPERATIONS.md:17-41`), handled by `src/app/auth/confirm/route.ts`. **Legacy:** an implicit-flow `#access_token…&type=invite` fragment, caught by `src/components/auth-hash-forwarder.tsx` (mounted on `/`, `src/app/page.tsx:30`) and forwarded to `/admin/set-password` | **Yes** (invite email) |
| Resend invite | `src/lib/admin/staff-actions.ts:207` → `staff-service.ts:425-447` | revoke + `inviteUserByEmail` | same as invite | same as invite | **Yes** |
| `/auth/confirm` | `src/app/auth/confirm/route.ts` | `verifyOtp({ token_hash, type })` for `invite` or `recovery`; `next` must be an `/admin/*` path (`safeAuthNext`) | — | Reached from the email template, not via `redirectTo` | — |
| `/admin/auth/callback` | `src/app/admin/auth/callback/route.ts` | `exchangeCodeForSession(code)` or `verifyOtp` | — | Fixed destination `/admin/set-password` | — |
| Set password | `/admin/set-password` (`src/app/admin/[[...segments]]/page.tsx:36-40`; public path list `src/lib/auth/redirect.ts:7-12`) | `updateAdminPassword` → `updateUser` on the session | — | Needs a session from one of the flows above | No |

**Required Supabase Auth → URL Configuration for production** (derived from the code above):

| Setting | Value | Why |
|---|---|---|
| Site URL | `https://www.2ndwavelaundry.com` | The invite template uses `{{ .SiteURL }}/auth/confirm…`. It is also Supabase's fallback when a `redirectTo` is rejected |
| Redirect URL | `https://www.2ndwavelaundry.com/admin/auth/callback` | Password reset `redirectTo` |
| Redirect URL | `https://www.2ndwavelaundry.com/admin/set-password` | Invite and resend `redirectTo` |
| (alternative) | `https://www.2ndwavelaundry.com/**` | Covers both paths; this is the form the existing ops doc uses (`STAFF_INVITATION_OPERATIONS.md:32-34`) |
| Apex entry `https://2ndwavelaundry.com/**` | **Not needed by code.** No code path emits an apex origin, and Vercel redirects the apex (§2). The ops doc lists it as a safety net; keep it only if `SITE_URL` or `NEXT_PUBLIC_SITE_URL` might hold the apex | — |
| Local dev | `http://localhost:3000/admin/auth/callback`, `http://localhost:3000/admin/set-password` (or `http://localhost:3000/**`) | Only if local dev uses the same Supabase project, which is discouraged (doc 01 §7) |

**Preview deployments.**
- Auth links are built from `SITE_URL` / `NEXT_PUBLIC_SITE_URL`, never from a `*.vercel.app` request host (`src/lib/auth/redirect.ts:86-95`).
- If a preview shares the production env values, its reset and invite links point at **production**.
- Testing auth on a preview needs two things: (a) `SITE_URL` and `NEXT_PUBLIC_SITE_URL` set to that exact preview origin in Vercel's Preview environment, and (b) that exact origin added as a Redirect URL. A wildcard is discouraged (`STAFF_INVITATION_OPERATIONS.md:36`).
- The invite template's `{{ .SiteURL }}` is project-wide, so invite links always land on the production Site URL, whatever the preview settings.

**Not in the repo:** the Supabase email templates (Invite, Reset password), Email OTP expiry and SMTP settings live only in the dashboard. The repo documents the intended invite template and a 3600 s expiry (`STAFF_INVITATION_OPERATIONS.md:38-44`). No intended Reset password template is documented beyond "default `{{ .ConfirmationURL }}` or `{{ .TokenHash }}` with `type=recovery`" (`docs/implementation/PHASE_1_COMPLETE_IMPLEMENTATION.md:326`).

## 5. Brevo dashboard dependencies (checklist)

- [ ] **Webhook URL:** `https://www.2ndwavelaundry.com/api/webhooks/brevo`. Only POST is accepted; other methods return 405 (`src/app/api/webhooks/brevo/route.ts:28-60`).
- [ ] **Auth:** header `Authorization: Bearer <BREVO_WEBHOOK_SECRET>`.
  - The `Bearer` prefix is case-insensitive and stripped, and the value is trimmed (`src/lib/email/webhook.ts:84-91`).
  - Comparison is constant-time (`crypto.timingSafeEqual`), with a length mismatch handled without an early return (`webhook.ts:72-81`).
  - The secret must be at least 32 characters, or the endpoint returns 503 `not_configured` (`src/lib/email/config.ts:91,531-534`).
  - Missing or wrong token → 401 (`webhook.ts:184`).
- [ ] **Content type:** `application/json` or `*+json`; anything else returns 415 (`webhook.ts:192-193`).
- [ ] **Payload:** **one JSON object per request.** A JSON array (Brevo's "batched" webhook option) fails `asRecord` and returns 400 `invalid_payload` (`webhook.ts:93-96,208-209`), so the webhook must be the **non-batched** type.
  - Size cap: 16 KB declared at the route (`route.ts:22,29-31`), plus the handler's own byte cap (`webhook.ts:196-198`).
  - Each event must carry `message-id` or `X-Mailin-custom`, or it gets 400 (`webhook.ts:211-217`).
- [ ] **Events processed** (`normaliseEvent`, `webhook.ts:110-127`):

  | Brevo event | Stored as |
  |---|---|
  | `delivered` | `delivered` |
  | `deferred` | `deferred` |
  | `soft_bounce`, `hard_bounce`, `blocked`, `invalid_email`, `error` | `bounced` |
  | `spam` | `complained` |

- [ ] **Events ignored with 200** (`webhook.ts:219-224`): everything else, for example `request`/sent, `opened`, `click`, `unsubscribed`, `proxy_open`. Only the events above need to be enabled in Brevo.
- [ ] **Unknown message** (no matching outbox row) → 200 `ignored`, so existence is not revealed (`webhook.ts:236-239`).
- [ ] **Saved templates:** all 13 must exist, each with its sender, subject and preview text (doc 02 §6). IDs go into the Vercel env vars.
- [ ] **Sender domain** authenticated in Brevo (DKIM, plus a Brevo code TXT); see the DNS template.
- [ ] Brevo is never called from the browser, so no CORS or origin setting is needed.

## 6. Vercel dashboard dependencies (checklist)

- [ ] **Domains attached to the project:** `www.2ndwavelaundry.com` as primary, and `2ndwavelaundry.com` **redirecting to www**.
  - **(observed live)** The apex returns `308 → https://www.2ndwavelaundry.com/`, which is a Vercel domain-level redirect.
  - The proxy's apex branch (`src/proxy.ts:39-42`) is only a backup and runs only if the apex is served by this project.
- [ ] **`*.vercel.app` hosts:**
  - When `VERCEL_ENV === "production"`, the proxy 301s any `*.vercel.app` host to the canonical domain, including the production deployment URLs (`src/proxy.ts:30-50`).
  - Preview deployments (`VERCEL_ENV=preview`) are **not** redirected; they get `X-Robots-Tag: noindex` instead (doc 01 §4).
  - Static files (paths with a dot) are never redirected (§1 observation).
- [ ] **Cron:** `vercel.json` → `GET /api/internal/email/worker` at `0 0 * * *` (00:00 UTC daily).
  - The route accepts GET and POST (`src/app/api/internal/email/worker/route.ts:98-104`).
  - It requires `Authorization: Bearer` matching `CRON_SECRET` or `EMAIL_WORKER_SECRET`, at least 32 characters, compared in constant time (`route.ts:37-46`, `bearerMatches` from `src/lib/email/webhook.ts`).
  - **`CRON_SECRET` must be set in Production** for Vercel's cron call to authorise.
  - Without it the route returns 401, or 503 if neither secret is set.
- [ ] **Env vars per environment:** see doc 02 §1. Keep Preview off production Supabase and Brevo, or keep `TRANSACTIONAL_EMAILS_ENABLED=false` there.
- [ ] **Production branch:** no code assumes a branch name. Behaviour keys off `VERCEL_ENV` only (`next.config.ts:14`, `src/proxy.ts:32`). The repo's default branch is `main` (doc 01 §1).
- [ ] **Region / function settings:** none in code. No `preferredRegion`, `maxDuration` or `regions` exists in `src/`, `next.config.ts` or `vercel.json`. Defaults apply; the Vercel function region relative to the Supabase region is an Unknown.
- [ ] **Build command:** `npm run build` = `next build --webpack` (doc 01 §6). Confirm Vercel's build command is not overridden.
- [ ] **Old alias `2ndwave.vercel.app`:** still live, redirects HTML, still serves static files (§1). Decide whether to keep it.

## 7. Fill-in template for Samuel

> Fill in from the registrar, DNS, Vercel, Supabase and Brevo dashboards. Leave a cell as `?` if unknown. Do **not** paste secrets (API keys, passwords) into this document.

### Domain registration
| Field | Value |
|---|---|
| Domain | `2ndwavelaundry.com` |
| Registrar | |
| Registrar account owner (person / email) | |
| Registration / renewal date | |
| Auto-renew on/off | |
| Registrar lock / transfer lock on/off | |
| Nameservers (exact hostnames) | |
| DNS hosted at (registrar / Vercel / Cloudflare / other) | |
| Who else has registrar access | |

### DNS records
| Type | Host | Value | TTL | Purpose |
|---|---|---|---|---|
| A / ALIAS | `@` (apex) | | | Website apex → Vercel (redirects to www) |
| CNAME | `www` | | | Website → Vercel |
| TXT | | | | Brevo domain verification (brevo-code) |
| CNAME / TXT | | | | Brevo DKIM 1 |
| CNAME / TXT | | | | Brevo DKIM 2 (if any) |
| TXT | `_dmarc` | | | DMARC policy |
| TXT | `@` | | | SPF (must include every sender: Brevo, mailbox provider, Supabase SMTP if custom) |
| MX | `@` | | | Business email (`info@`, `orders@`, `support@`, `billing@`, `manager@`) |
| MX | `@` | | | Business email (secondary) |
| TXT | `@` | | | Google Search Console verification (if DNS-based) |
| TXT | `@` | | | Bing Webmaster verification (if DNS-based) |
| | | | | Other (e.g. Brevo tracking/link domain, mailbox provider autodiscover) |

### SSL / TLS
| Field | Value |
|---|---|
| Certificate issuer (e.g. Vercel-managed / Let's Encrypt) | |
| Auto-renew on/off | |
| Covers apex + www (Y/N) | |

### Vercel
| Field | Value |
|---|---|
| Team name | |
| Plan | |
| Owner (person / email) | |
| Other members + roles | |
| Project name | |
| Git repository connected | |
| Production branch | |
| Domains attached (and which redirects) | |
| `CRON_SECRET` set in Production (Y/N) | |
| Preview env uses production Supabase (Y/N) | |

### Supabase
| Field | Value |
|---|---|
| Organisation | |
| Project ref | |
| Region | |
| Plan | |
| Backups / PITR enabled (and retention) | |
| Custom SMTP on/off (and provider) | |
| Auth Site URL | |
| Auth Redirect URLs (full list) | |
| Invite email template uses `/auth/confirm?token_hash=…` (Y/N) | |
| Reset password email template link format | |
| Email OTP expiry (seconds) | |
| Other org members + roles | |

### Brevo
| Field | Value |
|---|---|
| Account owner (person / email) | |
| Plan / daily send quota | |
| Sender domain authenticated (Y/N) | |
| Sender address(es) used on templates | |
| Webhook configured (Y/N) | |
| Webhook URL | |
| Webhook type batched / non-batched | |
| Webhook events enabled | |
| Other users + roles | |

---

## Unknowns — needs Samuel

1. All values in the §7 template: registrar, nameservers, DNS records, SSL, Vercel team and plan, Supabase project and region, Brevo account.
2. What do `SITE_URL` and `NEXT_PUBLIC_SITE_URL` hold in Vercel Production and Preview? Email links and auth redirects use these raw values, not the pinned canonical constant (§2).
3. What are the current Supabase Auth **Site URL** and **Redirect URLs**? Have the Invite and Reset password email templates been changed from the defaults? Does the invite template match `STAFF_INVITATION_OPERATIONS.md`?
4. Does Supabase Auth send email through the built-in mailer or custom SMTP? If custom, which provider, and is it included in the SPF record?
5. Is the Brevo webhook configured? Is it **non-batched**, at `https://www.2ndwavelaundry.com/api/webhooks/brevo`, with the Bearer token? Which events are enabled?
6. Is `CRON_SECRET` set in Vercel Production, and does the cron show successful runs in Vercel's cron logs?
7. Should the old `2ndwave.vercel.app` alias be kept? Do any saved Brevo templates still reference it? Its static files are still served, which would hide that problem (§1).
8. Are any subdomains of `2ndwavelaundry.com` in use (mail, webmail, tracking) that would block HSTS `includeSubDomains` / preload?
9. Which provider hosts the business mailboxes (`info@`, `orders@`, `support@`, `billing@`, `manager@`)?
10. Is `public/UI-UX/` (design mock-up and policy-content PDF) meant to be publicly downloadable at `/UI-UX/…`?
11. Which Vercel function region is used, and is it close to the Supabase project region?
