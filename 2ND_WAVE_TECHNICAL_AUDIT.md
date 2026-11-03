# 2ND WAVE LAUNDRY — Technical Audit

**Scope:** analysis and documentation only. No application source, database schema, migration, production data, environment variable, dependency, or application configuration was changed for this audit.

**Evidence reviewed:** repository source and tests, Supabase migrations, reachable public pages, recent Git history, and the graphified repository index. The live pages returned HTTP 200 on 2026-11-02, but no authenticated admin session or production database query was available.

## 1. Executive Summary

| Issue | Verified status | Impact | Recommended direction |
|---|---|---|---|
| Phone input UI | The shared field uses an absolutely positioned Lucide icon over a normal input. The source contains no green phone-field indicator. The reported green element cannot be attributed to an application component from source alone and may be browser/autofill/focus rendering. | The icon, placeholder/value, and any browser-rendered decoration can compete for the same horizontal space, especially on narrow widths or browser autofill states. | Keep one shared `PhoneField`, but make its adornment and input geometry explicit, scope focus/invalid styling to the control, and test empty, focused, filled, invalid, autofilled, desktop, mobile, and zoom states. |
| Commercial quote fields | The commercial form does not render `topic` or `message`, and validation stores them as `null`. The admin detail mapper nevertheless adds both fields for every kind, then renders every key as a row. The internal enquiry email contract also always includes `topic`, producing “Not provided” for commercial alerts. | Admin users see workflow fields that were never collected; notifications are inconsistent with the quote workflow. | Preserve the shared database columns for backward compatibility. Build kind-specific admin presentation fields and make the enquiry notification contract/template omit `topic` for commercial quotes while retaining it for general enquiries. |
| Gallery categories | The gallery has a real production data path and an admin-managed placement/media model, but public categories are hardcoded labels whose membership is inferred from `alt` text. There is no stored category/collection identifier. | A category can appear functional while showing the wrong set or no images; adding or renaming content requires maintaining alt-text conventions rather than selecting a category. | Do not invent historical collections. Either document the current heuristic as intentional and test it, or add explicit category metadata through the existing content model only if the intended collection inventory is confirmed. |

The smallest safe implementation is presentation-layer work for the quote issue, a scoped shared control/CSS correction for the phone issue, and a decision-backed gallery change. No destructive migration is justified by the evidence.

## 2. Project Architecture and Relevant Files

### Public forms and phone control

- `src/components/forms/public-form.tsx:17-65` defines field lists. `general` includes `topic` and `message`; `commercial` includes business/contact fields, items, frequency, location, and requirements only.
- `src/components/forms/public-form.tsx:177-207` builds the common enquiry payload and currently sends empty `topic`/`message` values even for commercial submissions.
- `src/components/forms/public-form.tsx:294-343` renders all definitions and routes telephone fields through `PhoneField`.
- `src/components/forms/controls.tsx:69-121` contains Ghana formatting and the shared `PhoneField`.
- `src/app/globals.css:1923-1995` supplies the generic field/input geometry and invalid border.
- `src/app/ui-fixes.css:5-22` positions the phone icon and adds left padding to the telephone input.

### Enquiry submission and persistence

- `src/lib/enquiries/validation.ts:27-121` defines the shared `EnquirySubmission`, validates the two kinds, and places commercial-only values in `details`.
- `src/app/api/enquiries/route.ts:1-76` bounds and parses the request, checks origin/configuration/rate limiting, and delegates submission.
- `src/lib/enquiries/repository.ts:8-74` calls the `enquiry_submit` RPC and maps stored rows back to a shared record shape.
- `supabase/migrations/20261101080100_enquiries.sql:6-48` creates the shared `enquiries` table. `topic` and `message` are nullable columns and `details` is JSONB.
- `supabase/migrations/20261101080100_enquiries.sql:118-210` implements the database submission function and persists `topic`/`message` independently of `details`.

### Admin presentation

- `src/app/api/admin/enquiries/route.ts:1-29` lists records by `kind`.
- `src/app/api/admin/enquiries/[id]/route.ts:1-18` returns one shared record.
- `src/components/admin/leads.tsx:14-48` maps both kinds into one `fields` object.
- `src/components/admin/leads.tsx:147-159` iterates all mapped fields and substitutes `"Not provided"` for empty values.
- `src/components/admin/leads.tsx:220-241` uses `message` for a general list preview and falls back to `items` for commercial quotes.

### Email notification

- `src/lib/email/outbox-repository.ts:192-215` validates the minimal trusted `enquiry_received` payload and includes `topic` for every kind.
- `src/lib/email/templates.ts:544-568` defines the notification context and always produces a `topic` parameter, using `"Not provided"` when null.
- `src/lib/email/templates.ts:92-108` declares `topic` as required for the single `enquiry_received` parameter contract.
- `src/lib/email/worker.ts:349-370` builds and validates those parameters before delivery.
- The database outbox payload constraint in `supabase/migrations/20261101080100_enquiries.sql:49-99` also requires the shared `topic` key. The provider template body is external to this repository.

### Gallery

- `src/app/[...slug]/page.tsx:339-348` loads `getPublicGallery()` for `/gallery` and passes the result to `GalleryPage`.
- `src/components/public-pages.tsx:835-850` renders the page shell and passes the photos to `Gallery`.
- `src/components/gallery.tsx:11-102` renders the four filter labels, infers membership from `alt`, handles empty state and lightbox navigation, and never fetches data itself.
- `src/lib/website/public.ts:164-194` reads published gallery placements, extracts referenced media IDs, selects non-archived media, and maps the join to public photos. `src/lib/website/public.ts:317-355` caches this read.
- `src/lib/website/public-queries.ts:227-258` implements ID extraction and placement-order joining. Missing or archived media is skipped.
- `src/components/admin/content/gallery-manager.tsx:18-109` loads and saves gallery placements and media through the admin content APIs.
- `supabase/migrations/20261028100000_phase6_website_content.sql:13-64` defines `website_content`, `website_gallery_media`, publication rules, and the gallery validation RPC.
- `supabase/migrations/20261029170000_phase6_preserve_existing_content.sql:30-60` seeds five gallery placements when none exist.
- `src/data/assets.json:282-306` contains the five design-handoff assets used by demo/seed paths.
- `tests/website-content-gallery-rpc.test.ts:78-157` covers reorder, hide, versions, archived placements, invalid new archived media, and removal. It does not test public category filtering.

### Tests and conventions

The repository uses Node’s test runner with `tsx` (`package.json:5-12`). Enquiry validation/email behavior is covered in `tests/enquiries.test.ts:1-130`; gallery persistence is covered in `tests/website-content-gallery-rpc.test.ts`. There is no browser-level test covering the phone control, admin field projection, email template rendering, or gallery category results.

## 3. Issue One — Phone Input UI/UX

### Observed/source-verifiable behavior

All general and commercial telephone fields use the same `PhoneField`; there is no separate desktop/mobile implementation. The control renders:

1. A relatively positioned wrapper.
2. A Lucide `<Phone>` SVG absolutely positioned at `left: 14px`, vertically centered, with `z-index: 1`.
3. A telephone input with `padding-left: 44px`, `min-height: 52px`, and `font-size: 16px`.

The input also has the generic `padding: 13px 14px`, `line-height: 1.5`, and border from `globals.css`. User characters are filtered to digits, `+`, spaces, parentheses, and hyphens. On blur, Ghana formats are normalized:

- `0XXXXXXXXX` becomes `0XX XXX XXXX`.
- `+233XXXXXXXXX` becomes `+233 XX XXX XXXX`.
- Other values are retained as entered and are later checked by `validPhone`.

Labels, `aria-invalid`, help text, and field-error descriptions are present. The icon is decorative (`aria-hidden`) and does not create an extra tab stop.

### Root cause and evidence

The application-side overlap risk is the adornment geometry: the icon is layered inside the same input rectangle and the input only reserves a fixed 44px left inset. There is no dedicated adornment slot, no explicit `box-sizing` rule in the phone-specific CSS, and no phone-specific `:focus`, `:invalid`, autofill, or validation-indicator rule in the reviewed files. The generic invalid style changes only the border.

The source does **not** contain a green element in `PhoneField`, `.phone-field__control`, or the generic field styles. Therefore it is not evidence-based to call the green element a custom validation indicator. It should be reproduced in a browser with autofill, focus, invalid, zoom, and mobile viewport states before implementation; browser autofill, an extension, or a browser focus/rendering artifact remains an open possibility.

### Recommended minimal fix

Modify only the shared phone control styling/component:

1. Make the wrapper the single positioning context and reserve an explicit, stable icon slot (for example, a fixed inline-start inset equal to the icon size plus gap).
2. Keep the icon `pointer-events: none`; align it against the input’s actual height rather than a separate line box.
3. Apply `box-sizing: border-box` to the phone input if the project’s global rule does not already guarantee it.
4. Scope focus, invalid, and any autofill treatment to `.phone-field__control input`, so browser/application indicators cannot be positioned over the icon slot.
5. Do not change `formatGhanaPhone`, accepted characters, `maxLength`, labels, or server validation.
6. If reproduction proves the green element is browser autofill, use a narrowly scoped autofill style rather than adding a second validation decoration.

This preserves the shared behavior for general and commercial forms and avoids introducing a country-selector or new phone-input dependency.

### Potential regressions

- A larger left inset can reduce usable space on narrow screens; test long valid numbers and 200% zoom.
- A generic selector could affect non-phone inputs; keep selectors under `.phone-field__control`.
- Changing blur formatting can invalidate idempotency expectations or surprise users; do not change it unless a separate requirement is approved.
- Any autofill override must preserve readable contrast and must not hide an error border or message.

### Verification and acceptance criteria

- Empty, focused, filled, invalid, and browser-autofilled telephone fields have no overlap between icon, placeholder/value, border/focus treatment, and error state.
- `0XX XXX XXXX` and `+233 XX XXX XXXX` remain accepted and blur-format as currently implemented.
- Keyboard tab order reaches one telephone input, and labels/help/errors remain announced through the existing IDs.
- The same result is visible in both general and commercial forms at desktop, mobile, narrow width, and 200% zoom.
- No green artifact is introduced by the application; if it is browser-generated, its cause and scoped treatment are documented by the implementation test.

## 4. Issue Two — Commercial Quote Admin Fields

### Current commercial submission flow

The commercial UI collects business name, contact name, phone, optional email, items/approximate quantities, optional frequency, location, and requirements. It does not render `topic` or `message` (`public-form.tsx:43-63`). The client nevertheless uses one shared payload object and sends `topic: values.topic || ""` and `message: values.message || ""` for both kinds (`public-form.tsx:177-207`).

`validateEnquirySubmission` trims those values. For `general`, topic and message are required. For `commercial`, business and items are required; topic/message are not validated and are returned as `null` when empty. Commercial values are stored under `details` as `items`, and optionally `frequency`, `location`, and `requirements` (`validation.ts:82-118`).

The API then passes the shared submission to the `enquiry_submit` RPC. The table intentionally has nullable common columns plus JSONB `details`; no evidence requires a destructive schema change.

### Admin notification and detail rendering

The live admin record is mapped into:

```text
name, business, phone, email, topic, message, ...details
```

The detail view iterates `Object.entries(item.fields)` without filtering by kind. Empty values are rendered as `"Not provided"`. Consequently a commercial row has `topic` and `message` even though both are null and neither was collected.

The internal email path has the same shared-model leak. `EnquiryReceivedContext` always contains `topic`; `buildEnquiryReceivedParams` always emits it and substitutes `"Not provided"`. The outbox payload constraint also requires the key. The email builder deliberately excludes the public message body, so the problem is not that commercial `message` content is being leaked to email; it is the unnecessary topic parameter/row and the shared contract shape.

### Root cause

The root cause is not a database default. It is the shared presentation/notification projection:

1. The admin mapper unconditionally adds `topic` and `message`.
2. The generic detail renderer unconditionally renders every mapped key.
3. The notification context and template contract are also generic across kinds.

The client’s empty fields explain why null values reach persistence, but changing only the client payload would not remove the admin rows because the admin mapper and renderer would still add them.

### Field-mapping table

| Field | Collected by commercial form? | Stored? | Used in admin output? | Recommended action |
|---|---:|---:|---:|---|
| `name` | Yes | Yes, column | Yes | Preserve. |
| `business` | Yes, required | Yes, column | Yes | Preserve. |
| `phone` | Yes, required | Yes, column | Yes | Preserve. |
| `email` | Yes, optional | Yes, nullable column | Yes when present; currently row exists when absent | Preserve and intentionally omit empty optional display. |
| `topic` | No | Nullable common column; normally null | Yes, as “Not provided” | Omit from commercial admin projection and commercial notification presentation; retain for general enquiries. |
| `message` | No | Nullable common column; normally null | Yes, as “Not provided” | Omit from commercial admin projection. Preserve the column for general enquiries and historical rows. |
| `items` | Yes, required | Yes, `details.items` | Yes via spread | Preserve. |
| `frequency` | Yes, optional | Yes when supplied, `details.frequency` | Yes when supplied; empty values can still become rows in legacy/demo paths | Preserve and omit absent optional values intentionally. |
| `location` | Yes, optional | Yes when supplied, `details.location` | Yes when supplied | Preserve. |
| `requirements` | Yes, optional | Yes when supplied, `details.requirements` | Yes when supplied | Preserve; do not collapse into message. |

### Recommended minimal fix

1. Add a kind-aware presentation mapper in `src/components/admin/leads.tsx` (or a small shared helper adjacent to it). For `commercial`, construct fields in an explicit order from contact columns and `details`; do not add `topic` or `message`. Include optional `email`, `frequency`, `location`, and `requirements` only when non-empty. For `general`, retain topic and message and preserve its current behavior.
2. Keep `liveEnquiryView`’s raw record typing broad enough to read historical rows, but make the displayed `fields` intentionally kind-specific. Apply the same projection to demo records if demo behavior is intended to mirror live behavior.
3. Split or make conditional the `enquiry_received` notification parameter contract. General alerts must retain topic; commercial alerts must not present a topic. Because the provider template body is managed outside the repository, confirm whether the existing Brevo template can conditionally hide the parameter or whether a separate commercial template/contract is needed before changing the outbox constraint.
4. Do not drop `topic` or `message` columns, rewrite historical rows, or remove accepted RPC arguments. Historical general enquiries and any legacy commercial records remain readable.
5. Optionally stop sending empty client keys for commercial payloads for clarity, but treat this as secondary; server-side validation and presentation must remain authoritative.

### Before and after

**Current commercial detail (verified from the renderer):**

```text
Contact details & requirements
Name
Business
Phone
Email                 Not provided
Topic                 Not provided
Message               Not provided
Items
Frequency
Location
Requirements
```

**Desired commercial detail:**

```text
Contact details & requirements
Name
Business
Phone
Email                 (only when supplied)
Items and quantities
Frequency              (only when supplied)
Location               (only when supplied)
Requirements           (only when supplied)
```

The exact optional rows should be driven by the actual non-empty record, not by a generic `"Not provided"` fallback for fields outside the workflow.

### Backward compatibility, regressions, and acceptance

- General enquiry topic/message collection, validation, storage, detail view, and notification must remain unchanged.
- Commercial historical records with a non-null legacy topic/message must not be deleted; the display policy can omit those workflow-inapplicable fields for commercial records while preserving raw data.
- The admin list preview must continue to use commercial items when message is absent.
- Tests must cover both kinds, null optional values, populated requirements, historical commercial columns, and notification parameter keys.
- Acceptance: a newly submitted commercial quote displays no topic/message rows in admin detail or notification presentation; all collected commercial fields remain; a general enquiry still displays/sends topic and message; no migration is required.

## 5. Issue Three — Gallery Categories and Collections

### Current architecture and data flow

The production path is not a purely static demo page:

1. `/gallery` calls `getPublicGallery()`.
2. `readGallery()` selects published `website_content` rows where `module = 'gallery'`, ordered by `sort_order`.
3. It extracts `payload.media_id` values.
4. It selects only those IDs from `website_gallery_media` where `archived = false`.
5. `buildGalleryPhotos()` joins by ID and returns `{src, alt}` in placement order.
6. `Gallery` receives those photos and renders them without another fetch.

The admin gallery manager uses the same placement/media model and the `website_content_replace` RPC. The RPC validates UUID media IDs, non-empty alt text, non-archived assets for new placements, optimistic versions, and ordering. The existing persistence tests cover these operations.

### Category inventory and relationship assessment

The public UI currently exposes exactly four labels: `All`, `Laundry`, `Garments`, and `Branches`. The source has no category field, collection ID, slug, or category-to-media join. Filtering is:

- `All`: every supplied photo.
- `Garments`: alt text matching `shirt|suit|garment|shoe`.
- `Laundry`: alt text not matching `branch|exterior|store`.
- `Branches`: alt text matching `branch|exterior|store`.

The five repository seed/demo alts are `Washing`, `Pressing`, `Garment packaging`, `Linen folding`, and `Collection handover`. Under the current regex, none match the garment regex and none match the branch regex; all are treated as Laundry. This means the tabs are UI labels, not verified historical collections. The older initial gallery implementation used the same heuristic, so Git history does not establish a richer prior category model.

The live gallery page was reachable and exposed the same four labels. A public HTML scrape is not sufficient to validate the authenticated database’s complete placement/media inventory, image success, or category correctness. No production database or admin dashboard session was available.

### What works

- Production and demo paths are explicitly separated by `demoMode`.
- Published placement order is preserved.
- Missing/archived referenced media is skipped rather than rendered with a fabricated URL.
- The admin can add, reorder, hide, and remove placements without deleting media assets.
- The public page has an empty state and lightbox navigation; selecting a filter resets the lightbox index.
- The repository test covers the persistence/RPC lifecycle.

### Gaps and risks

- Categories are inferred from alt copy, so selection can change when alt text is edited and cannot reliably represent business collections.
- `Garment packaging` is semantically garment-related but does not match the `Garments` regex.
- There is no direct URL/deep-link state for a selected category.
- There is no category-specific automated test, no image URL/HTTP verification, and no test proving that every category returns its intended image set.
- The public loader returns an empty array on query failure, while the component presents the same empty state as an empty category; this can conceal an operational read failure from public users.
- The current migration seeds five assets only when no gallery rows exist. It does not prove that any historical collection inventory beyond those five should exist.

### Recommended minimal fix

Do not add categories or alter database data until the intended collection inventory is confirmed by the owner or an accessible historical source.

If the current four filters are intended to remain:

1. Add pure tests for the exact current classifier, including the five seed alts and empty sets.
2. Document the alt-text classification convention in the implementation and admin content guidance, or replace it with a named helper so it is not hidden inside JSX.
3. Add a deliberate empty/error distinction if operational failures must not look like “no images.”
4. Verify every published placement’s media URL and alt text in a production/admin environment.

If real collections are required:

1. Add an explicit category/collection field to the existing gallery placement payload or a narrowly scoped related table.
2. Update the admin editor to select that value, the public loader to map it, and `Gallery` to filter by the stored identifier rather than alt text.
3. Obtain and document the authoritative category list and mapping before migrating existing placements.

This is the only issue where the correct implementation depends on an unresolved product/data decision; inventing categories would not be a valid audit conclusion.

### Verification and acceptance criteria

- Every published placement maps to an active media asset and its public URL resolves successfully.
- `All` returns every published, non-archived placement in sort order.
- Each category returns exactly its intended set, including a deliberate empty-category state.
- Category selection changes the image set, not just button appearance.
- Admin reorder/hide/add/remove behavior remains intact and does not delete media assets.
- Mobile filter controls, keyboard focus, lightbox controls, alt text, and direct page loading remain usable.
- The test fixture covers missing media, archived media, empty categories, all categories, and image failure behavior.

## 6. Prioritised Implementation Plan

### P0 — Blocking/correctness

No P0 production data or schema blocker was proven. The current system can accept and persist submissions, and the gallery has a production path. Do not perform a migration or data rewrite as a prerequisite.

### P1 — Core fixes

| Priority | Files/symbols | Current behavior | Desired behavior | Implementation | Dependencies/risks | Tests |
|---|---|---|---|---|---|---|
| P1 | `src/components/admin/leads.tsx`, `liveEnquiryView`, detail `<dl>` | All shared columns are projected and rendered for both kinds. | Commercial detail contains only commercial workflow fields; general detail retains topic/message. | Add explicit kind-specific field projection and omit absent optional rows. | Must preserve historical raw columns and demo/live parity. | Extend enquiry/admin component coverage or add pure projection tests for both kinds and null optionals. |
| P1 | `src/lib/email/templates.ts`, `src/lib/email/outbox-repository.ts`, external `enquiry_received` template contract | One notification contract always emits topic and “Not provided”. | General notification retains topic; commercial notification omits irrelevant topic. | Confirm provider template capability, then use a kind-aware parameter contract or separate commercial template. Keep message body excluded. | External Brevo template/config is not present in the repository; coordinate before changing constraint/template IDs. | Unit-test parameter keys and both kinds; run email contract tests and provider-template staging verification. |
| P1 | `src/components/forms/controls.tsx`, `src/app/ui-fixes.css` | Icon is absolutely overlaid with fixed 44px padding and no scoped autofill/focus treatment. | Stable non-overlapping adornment/input geometry in all states. | Increase/reserve the explicit icon slot, enforce sizing locally, and scope state styles; do not change Ghana formatting or validation. | Narrow layouts, autofill, and browser differences require visual regression checks. | Browser/manual matrix for both forms, mobile/desktop, 200% zoom, autofill, invalid/focus. |

### P2 — Justified additional improvements

| Priority | Files/symbols | Current behavior | Desired behavior | Implementation | Rationale/risks | Tests |
|---|---|---|---|---|---|---|
| P2 | `src/components/gallery.tsx`, helper near `src/lib/website/public-queries.ts` | Category membership is an inline alt-text regex. | Classification is named, tested, and intentional, or is driven by explicit stored metadata. | First confirm product intent. Then either extract/test the classifier or add explicit category metadata through the existing admin/content flow. | A schema/data change without authoritative categories could misclassify or lose content. | Category fixture tests, empty/missing/archived media tests, responsive/manual checks. |
| P2 | `src/lib/website/public.ts`, public gallery error handling | Query failures become an empty photo array and look like an empty gallery. | Operational failure is distinguishable from a valid empty collection where UX requires it. | Introduce an explicit error result only if the site’s existing public error pattern supports it; avoid broad fallback behavior. | Public error UX and caching need review; not required to fix category correctness. | Loader failure test and public error-state test. |
| P2 | `src/components/forms/public-form.tsx` | Commercial payload includes empty `topic`/`message` keys due to shared payload construction. | Payload shape reflects the selected workflow. | Omit those keys for commercial requests while keeping server compatibility. | Secondary clarity improvement; server must continue rejecting malformed/missing required fields correctly. | Request payload tests for both kinds. |

## 7. Regression and Test Plan

### Phone

- General form: empty, focused, typed, formatted-on-blur, invalid, corrected, and autofilled values.
- Commercial quote form: repeat the same states.
- Values: `024 123 4567`, `+233 59 522 4280`, incomplete numbers, punctuation, and rejected letters.
- Desktop, narrow mobile, landscape mobile, 100% and 200% zoom.
- Keyboard-only navigation and screen-reader label/help/error association.
- Verify no overlap from icon, placeholder, value, border/focus state, autofill, or error icon/message.

### Commercial/general enquiries

- Submit a valid general enquiry and confirm topic/message are validated, stored, shown in admin, and retained in its email parameters.
- Submit a valid commercial quote and confirm business/contact/items/frequency/location/requirements are stored and shown.
- Confirm commercial admin detail has no topic/message rows and no misleading empty optional rows.
- Confirm commercial list preview uses items.
- Confirm a commercial record with legacy non-null topic/message remains readable without database deletion.
- Confirm optional email/frequency/location/requirements are omitted or displayed intentionally when absent.
- Exercise idempotency, rate-limit, origin, malformed payload, and validation paths already covered by `tests/enquiries.test.ts`.

### Gallery

- Load the public page with live published placements and with no placements.
- Verify `All`, each category, and empty category behavior against a known fixture.
- Verify missing/archived media is skipped and does not produce a broken tile.
- Verify every returned image URL, alt text, lightbox previous/next controls, and filter reset behavior.
- Verify mobile filter controls, keyboard focus, responsive images, and direct `/gallery` loading.
- Verify admin add/reorder/hide/remove and optimistic version conflict behavior using the existing gallery RPC suite.
- Add tests for category mapping; the current suite does not cover it.

## 8. Acceptance Criteria

1. The phone control has one stable icon slot and no overlap in all required states and viewports; Ghana validation/formatting and accessibility remain unchanged.
2. A commercial quote admin detail contains only fields collected by that workflow plus relevant populated optional values; it never renders topic/message merely because the shared record has nullable columns.
3. Commercial notification presentation omits irrelevant topic/message content, while general enquiry notifications retain topic/message functionality. The provider template contract is verified before deployment.
4. No `enquiries` columns, historical rows, or submission RPC arguments are destructively removed.
5. The gallery’s category behavior is either explicitly documented/tested as alt-text classification or is backed by authoritative stored category metadata. It must not be presented as verified historical collections without evidence.
6. All relevant automated tests pass, and the manual desktop/mobile/accessibility checks above are recorded by the implementation agent.

## 9. Open Questions and Unknowns

- **Green phone element:** What exact browser, device, zoom, focus/autofill state, and screenshot reproduction produces it? Source has no green phone-specific element. A browser/devtools reproduction is needed before deciding whether CSS or browser autofill handling is required.
- **Production enquiry records:** Are there historical commercial rows with non-null topic/message? An authorised, redacted production query or admin export is needed to assess display compatibility; no data was exposed in this report.
- **Brevo template body:** Can the existing `enquiry_received` template conditionally omit topic for commercial kind, or is a separate template required? The provider body and dashboard are outside the repository.
- **Authoritative gallery collections:** What categories/collections were intended, and which image belongs to each? Owner-provided content, an accessible historical export, or an earlier authoritative implementation is required. Git history only confirms the same heuristic filter, not a lost category model.
- **Production gallery inventory:** Which placements and media are currently published, and do all public URLs resolve? An authorised database/admin check and image request matrix are required.
- **Live visual verification:** Public pages were reachable, but this audit did not use an authenticated admin session or a browser screenshot/interaction harness; live HTML alone cannot confirm responsive overlap or admin output.

## 10. Implementation Handoff

1. Reproduce the phone screenshot in a real browser and identify whether the green element is application CSS, autofill, extension UI, or browser rendering.
2. Apply a scoped `PhoneField`/CSS geometry fix without changing Ghana parsing, validation, labels, or server contracts.
3. Add a kind-aware enquiry display projection; commercial fields must be explicit and must exclude topic/message.
4. Update notification parameter/template handling after confirming the external Brevo template contract; preserve general topic/message behavior.
5. Add focused tests for the projection and notification key sets, then run the existing enquiry/email suites.
6. Decide whether gallery categories are heuristic labels or required persisted collections. Do not invent historical categories.
7. If persisted categories are approved, update the existing gallery placement/admin/public mapping path and migrate only with an authoritative mapping; otherwise extract/test/document the current classifier.
8. Add gallery category, empty-state, missing-media, image-resolution, and responsive tests.
9. Run the smallest relevant test groups, then the project typecheck/lint/build checks if implementation changes span shared components.
10. Review the final diff to ensure only the approved implementation files changed and no secrets or customer data were added.

