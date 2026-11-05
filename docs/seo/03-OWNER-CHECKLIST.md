# Owner checklist — tasks the code cannot do

Everything below needs the business owner, a Google/Bing account, or verified business data.
Complete the items in order; the first three determine whether the rest can take effect.

## 1. Confirm the missing business facts (blocking some work)

Provide, and then update `src/lib/locations.ts` / `src/lib/content.ts` / the admin Locations editor:

- [ ] Full street address for each of the three branches (currently only the area/town is published).
- [ ] Google Business Profile URL for each branch (the main branch has a Maps share link only).
- [ ] Latitude/longitude for each branch (needed for `geo` in LocalBusiness schema).
- [ ] Any area served **only** by pickup and delivery (drives future `/areas/*` pages — none exist
      today, deliberately).
- [ ] Confirmation of opening hours per branch, especially the two Katamanso branches where the site
      publishes a single "7am–8pm" line.
- [ ] Facebook / X / LinkedIn URLs, if they exist (only Instagram and TikTok are published).
- [ ] Whether "commercial laundry" serves hotels, restaurants, offices or other segments by name.
- [ ] Optional: a dedicated square brand icon. The generated icon is the permitted simplified wave
      tile; a purpose-drawn icon would be sharper.

Do not create Google Business Profiles for areas without a staffed branch.

## 2. Google Business Profile (per real branch)

- [ ] Verify each branch (only the main branch is known to have a profile today).
- [ ] Set the website link to that branch's own page:
      `https://www.2ndwavelaundry.com/locations/ashaiman-atadeka`,
      `/locations/katamanso-no-1`, `/locations/newland-katamanso`.
- [ ] Primary category: laundry service / dry cleaner (choose the closest Google category).
- [ ] Hours exactly matching the site.
- [ ] Name, address and phone identical to the site (see §7).
- [ ] Services list matching the published service pages.
- [ ] 10+ real photos per branch; logo; short description using the same facts as the site.
- [ ] Add the GBP URLs back to `sameAs` in `src/lib/seo/schema.ts` once known.
- [ ] Post updates occasionally (offers, hours changes) and answer reviews.

## 3. Search Console

- [ ] Add the domain property (or the `https://www.` prefix property).
- [ ] Set `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` in the hosting environment and redeploy.
- [ ] Submit `https://www.2ndwavelaundry.com/sitemap.xml`.
- [ ] Do not submit the apex redirect URL (`https://2ndwavelaundry.com/sitemap.xml`);
      use the WWW URL above as the single canonical sitemap.
- [ ] Request indexing for `/`, each of the three branch pages, `/services`, and `/commercial-laundry`.
      Requesting the home page also refreshes the favicon in results.
- [ ] Confirm `robots.txt` fetches successfully and shows the sitemap line.
- [ ] Check "Page indexing" after 1–2 weeks for the noindex pages (/admin, /auth, /book, /reviews)
      and for any unexpected 404s.
- [ ] Decide on `Google-Extended`: it controls Gemini training/grounding use only, not Search. The
      current robots policy allows it implicitly. Blocking it does not affect Google Search rankings.

## 4. Bing Webmaster Tools

- [ ] Import the site from Search Console.
- [ ] Set `NEXT_PUBLIC_BING_SITE_VERIFICATION` if using the meta-tag method.
- [ ] Submit the sitemap (Bing also discovers it from `robots.txt`).
- [ ] Confirm the main branch listing in Bing Places and align its NAP with the site.

## 5. Review requests (per branch)

Use the branch's Google review link once the profile exists. Replace `[REVIEW LINK]` and
`[BRANCH]` before sending.

**Text message / WhatsApp wording**

> Hi [Name], thank you for choosing 2nd Wave Laundry Services at [BRANCH]. If you have a moment,
> would you share your experience here? [REVIEW LINK] It helps other people in the area find us.
> — The 2nd Wave team

**In-person / printed wording**

> Thank you for visiting our [BRANCH] branch. If you were happy with the service, a short Google
> review would mean a lot to our team. Scan the code or search "2nd Wave Laundry [BRANCH]".

Rules: never offer an incentive, never filter for positive reviews, never post a review on a
customer's behalf. Keep the request to one follow-up.

## 6. Ghana directories and citations (identical NAP everywhere)

Submit the same business name, address, phone and website to:

- [ ] Google Business Profile (each branch)
- [ ] Bing Places
- [ ] Apple Business Connect
- [ ] Facebook Page (if created)
- [ ] Instagram business profile (link the site)
- [ ] TikTok business profile (link the site)
- [ ] GhanaYello
- [ ] VConnect Ghana
- [ ] Jumia Deals / local business listings, if applicable
- [ ] Your bank's merchant directory and any supplier directories
- [ ] The Ghana Chamber of Commerce directory, if a member

Record each listing URL and the exact NAP used. Any variation (e.g. "2nd Wave Laundry" vs
"2nd Wave Laundry Services") must be intentional and consistent with the site's `alternateName`.

## 7. NAP consistency check (do this before and after any listing change)

Canonical values used by the site today:

| Field | Value |
| --- | --- |
| Business name | 2nd Wave Laundry Services |
| Short name | 2nd Wave Laundry |
| Main phone | 059 522 4280 / +233 59 522 4280 |
| Katamanso No. 1 phone | 059 814 8620 / +233 59 814 8620 |
| Newland Katamanso phone | 024 614 4412 / +233 24 614 4412 |
| Main branch hours | Mon–Sat 7am–8pm; Sun 9am–7:30pm |
| Katamanso branches hours | 7am–8pm |
| Email | info@2ndwavelaundry.com / support@2ndwavelaundry.com |
| Website | https://www.2ndwavelaundry.com |

Note: the main branch is titled **Ashaiman–Atadeka**. Use that exact spelling, with the en dash, in
Google Business Profile so the site and the listing match.

## 8. Email templates

- [ ] Replace every `https://2ndwave.vercel.app/...` URL in the Brevo saved templates with
      `https://www.2ndwavelaundry.com/...` (see `docs/emails/*.html` for the source drafts).
- [ ] Verify the logo and header images load from the canonical domain.

## 9. Quarterly maintenance

- [ ] Search Console: review queries and pages; fix pages with impressions but poor CTR (usually a
      title/description issue).
- [ ] Refresh one or two service or blog pages with genuinely new information.
- [ ] Re-check NAP on the site, schema, footer and every Google Business Profile.
- [ ] Re-submit the sitemap after adding pages.
- [ ] Review the "Page indexing" report for accidental noindex or soft 404s.
- [ ] Re-run the local SEO checks (titles, canonicals, schema) after any template change.

## 10. Decisions still open

- [ ] Analytics: none is installed. If you want it, choose a privacy-friendly option (e.g. a
      cookieless analytics service) and decide whether a consent banner is required for your
      jurisdiction. Do not add a script before that decision.
- [ ] `Google-Extended`: allow (current) or block Gemini training/grounding only.
- [ ] IndexNow: Bing can be pinged automatically when URLs change. This needs an owner-generated key
      and a deploy hook; it is not enabled.
