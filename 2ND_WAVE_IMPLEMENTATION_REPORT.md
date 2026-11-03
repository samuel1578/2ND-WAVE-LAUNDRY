# 2ND WAVE LAUNDRY — Implementation Report

**Scope implemented:** the three approved items from `2ND_WAVE_TECHNICAL_AUDIT.md`:
phone field overlap, commercial quote admin/notification projection, and dynamic
gallery collections.

**Verification actually performed**

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | Pass (exit 0) |
| Lint | `npx eslint .` | Pass, 0 errors (9 pre-existing warnings) |
| Automated tests | `npm test` | **496 passed, 0 failed** |
| Production build | `npm run build` | Pass (exit 0) |

**Not performed (do not treat as verified):** no browser/Playwright session was
run against the phone field or the gallery (no browser automation harness is
part of this repository), no production Supabase query was executed, and no
Brevo dashboard/template inspection was possible. The phone fix was diagnosed
from the live CSS cascade rather than a screenshot, and the migration was
exercised only against the repository's PGlite migration harness.

---

## 1. Phone field overlap

### Root cause (found, not guessed)

`src/app/ui-fixes.css` reserved the icon space with:

```css
.phone-field__control input { padding-left: 44px; }
```

That selector has specificity `(0,1,1)`. `globals.css` styles every text input
with `input:not([type="checkbox"]):not([type="radio"]):not([type="file"])`
(specificity `(0,3,1)`) and sets `padding: 13px 14px`. The higher-specificity
global rule therefore **silently reset the icon inset to 14px**, and the
absolutely positioned Lucide icon was drawn on top of the placeholder and typed
value. This explains the reported overlap without any green application element:
the source contains no green phone-specific indicator, so the green colour the
owner saw is browser/autofill or extension chrome, not a component.

### Fix

Only the shared phone control changed (`src/app/ui-fixes.css`; the component
markup, Ghana formatting, accepted characters, `maxLength`, labels, help text and
server validation are untouched):

- One source of truth for the icon slot: `--phone-icon-size` (18px),
  `--phone-icon-inset` (14px) and `--phone-icon-gap` (10px). The icon `left` and
  the input `padding-inline-start` are both derived from them, so they cannot
  drift apart again.
- The padding rule now mirrors the generic selector's specificity
  (`input:not([type="checkbox"]):not([type="radio"]):not([type="file"])`), so the
  inset cannot be reset by `globals.css` ordering.
- `box-sizing: border-box`, `width: 100%`, `min-width: 0` and `display: flex` on
  the wrapper give stable geometry in the two-column form grid, narrow viewports
  and 200% zoom.
- Focus and autofill rules are scoped to `.phone-field__control`, keep the icon
  `pointer-events: none`, and never add a second validation decoration.

### Still open

Browser visual verification (empty, focused, filled, invalid, corrected,
autofilled; desktop/mobile/200% zoom) is recommended before sign-off. The
geometry now reserves 42px (`14 + 18 + 10`), matching the previous intended
44px, so no additional horizontal pressure is introduced on narrow screens.

---

## 2. Commercial quote admin details and notifications

### Admin details

- New pure projection: `src/lib/enquiries/presentation.ts`.
  - **Commercial:** Business, Contact name, Phone, Email (only when supplied),
    Items and quantities, Collection frequency / Location / Requirements (only
    when supplied). `topic` and `message` are **never** projected, even when a
    legacy commercial row still holds values in those shared columns.
  - **General:** unchanged order and content — Name, Business, Phone, Email,
    Topic, Message.
- `src/components/admin/leads.tsx` now renders `item.detail` (the projection)
  instead of `Object.entries(item.fields)`, and the list preview uses requested
  items for commercial quotes (`kind === "commercial" ? items : message`) so a
  historical commercial `message` can never replace the item summary.
- No database column was dropped or rewritten, and the raw record mapper still
  exposes every column for search.

### Email notification

- `enquiry_received` contract in `src/lib/email/templates.ts`: `topic` moved from
  required to optional; `business`/`phone` etc. unchanged.
- `buildEnquiryReceivedParams` omits `topic` entirely for commercial quotes and
  keeps it for general enquiries. The public message body is still never copied
  into email.
- No outbox migration was needed: the persisted payload still carries
  `topic: null` for commercial rows (allowed by the existing constraint), and the
  omission happens at parameter construction, which is the presentation boundary.
- `validateEmailTemplateParams` continues to reject unexpected keys, so a
  commercial alert cannot leak a topic parameter by accident.

### External configuration still required (not verified)

The Brevo template bodies live outside this repository. The `enquiry_received`
template must render its topic block conditionally, e.g. wrap it in
`{% if params.topic %}…{% endif %}` (Brevo New Template Language). If the live
template unconditionally prints `params.topic`, a commercial alert will show an
empty topic line until that block is made conditional **or** a dedicated
commercial template/ID is added. This has **not** been checked against the Brevo
dashboard.

---

## 3. Gallery collections

### Architecture (smallest safe extension of the existing model)

Collections are stored in the existing `website_content` table as a new module
`gallery_collection`, reusing its publication flag, `sort_order`, `version`
optimistic locking, audit trail and RLS. A gallery placement payload gains an
optional `collection_key` that references a collection's `record_key` (slug) —
a stable identifier that is **never** derived from `alt`, `caption` or the file
name.

- **One image in several collections:** supported cleanly. A placement is one
  image instance, so the same media asset gets one placement per collection. The
  database rejects the same asset twice inside one collection
  (`CONTENT_DUPLICATE_PLACEMENT`).
- **Deleting a collection:** only allowed when it holds no images; the admin UI
  explains this instead of silently re-assigning or orphaning placements.
- **Legacy placements:** the five existing placements keep their row, order and
  publication state and remain unassigned. They still appear under `All`. No
  historical assignment was fabricated.
- **Atomicity:** collections and placements save in one transaction through the
  new `public.website_gallery_save` RPC. A collection can never be saved while
  pointing at placements that failed to write. The previous
  `website_content_replace` RPC is untouched, so FAQ and historical gallery
  callers keep working.

### Database migration

`supabase/migrations/20261103120000_gallery_collections.sql`

1. Extends `website_content_module` to include `gallery_collection` and adds a
   partial index for collection ordering.
2. Seeds the five requested collections (explicit, repeatable `ON CONFLICT DO
   NOTHING`): `laundry` — Laundry, `garment-care` — Garment Care, `shoe-care` —
   Shoe Care, `behind-the-scenes` — BTS / Behind the Scenes, `others` — Others.
   They are created **visible** so the public filters exist; each is empty.
3. Adds `public.website_gallery_save(p_actor, p_collections,
   p_collection_versions, p_placements, p_placement_versions)` with: Full Admin
   check, JSON shape and size bounds, advisory lock + `lock_timeout`,
   slug/name/description validation, per-row optimistic version checks, deletion
   version checks, media existence/non-archived checks (an already-placed
   archived asset may stay), collection reference validation, duplicate
   placement prevention, audit event, and both arrays returned in configured
   order. Executable by `service_role` only.

**Deployment:** apply after `20261102090000_staff_invitation_controls.sql` and in
the same release as the application code (the admin UI writes the new payload
shape and calls the new RPC). The migration is additive and non-destructive; it
has **not** been executed against production.

### Admin management (`src/components/admin/content/gallery-manager.tsx`)

Rebuilt as a collection workspace on top of the existing Media Library picker,
module shell, dialogs and contract types:

- View, create, rename, re-slug (before first save), describe, reorder, show/hide
  and delete collections with a confirmation.
- See each collection's images, add existing Media Library assets to a specific
  collection, assign legacy/unassigned placements through a collection select,
  remove a placement without deleting the media asset, reorder images within a
  collection.
- Edit alt text and caption per placement, publish/unpublish each placement, and
  preview each image thumbnail before publishing.
- Loading, fetch-error/retry, validation, success and error states. All writes go
  through one "Save Gallery" action with optimistic version maps.

### Public gallery

- `readGallery()` now loads published collections and placements, filters out
  placements belonging to hidden/deleted collections, keeps unassigned legacy
  placements in `All`, skips archived/missing media, and returns
  `{ collections, photos }`.
- `src/components/gallery.tsx` builds its filter bar from stored collections
  (`All` + visible collections in configured order), filters by collection id,
  deduplicates by media id so an image in several collections appears once in
  `All`, and keeps the existing layout, image ordering, lightbox and navigation.
  The alt-text regex classifier is gone.
- A collection read failure degrades to the `All` view instead of hiding every
  image; a placement read failure keeps the previous empty state.
- Summary feeds (home page) still receive a flat `Photo[]`, so unrelated pages
  are unchanged.

### Existing content mapping (left for administrator review)

- The five existing placements were **not** assigned to collections: their alt
  text (`Washing`, `Pressing`, `Garment packaging`, `Linen folding`,
  `Collection handover`) does not authoritatively identify a new collection.
  They remain visible under `All` and are listed in the "Unassigned images"
  section for one-click assignment.
- Publication state and display order were preserved; nothing was unpublished.
- The two unassigned Media Library assets remain in the library, unpublished and
  unassigned.
- The five new collections are empty until the owner assigns images. They are
  visible so the filter inventory the owner asked for exists; each can be hidden
  with one click if an empty filter should not be public yet.

---

## 4. Files changed

| File | Reason |
|---|---|
| `src/app/ui-fixes.css` | Phone icon slot + input geometry; specificity root cause |
| `src/lib/enquiries/presentation.ts` (new) | Kind-aware admin detail projection |
| `src/components/admin/leads.tsx` | Render projected details; kind-aware list preview |
| `src/lib/email/templates.ts` | `topic` optional; commercial alerts omit it |
| `supabase/migrations/20261103120000_gallery_collections.sql` (new) | Collections module, seed, atomic save RPC |
| `src/lib/contracts.ts` | `GalleryCollection`; `GalleryPlacement.collectionKey` |
| `src/lib/website/gallery-collections.ts` (new) | Shared collection/workspace validation |
| `src/lib/website/gallery-write.ts` (new) | Atomic server persistence for the workspace |
| `src/lib/website/repository.ts` | Removed the superseded placements-only `writeGallery` |
| `src/lib/website/actions.ts` | `saveLiveGalleryWorkspace` server action |
| `src/lib/website/types.ts` | `toGalleryCollection`, collection seed, `collectionKey` mapping |
| `src/lib/website/public-queries.ts` | Collection columns/mapper, collection-aware photos, dedupe |
| `src/lib/website/public.ts` | Collection-aware `readGallery`, snapshot stays flat |
| `src/app/[...slug]/page.tsx`, `src/components/public-pages.tsx` | Pass the collection-aware gallery |
| `src/components/gallery.tsx` | Dynamic filters from stored collections |
| `src/components/admin/content/gallery-manager.tsx` | Collection workspace |
| `src/app/api/admin/website/route.ts` | `gallery-collections` module + placement `collectionKey` |
| `src/lib/mock-store.ts` | Demo parity: collections + workspace save |
| `tests/enquiry-presentation.test.ts` (new) | Projection and notification contract tests |
| `tests/gallery-collections.test.ts` (new) | Validation + migration/RPC tests |
| `tests/enquiries.test.ts`, `tests/public-loaders.test.ts`, `tests/website-content.test.ts` | Updated expectations for the intended contract changes |

---

## 5. Tests added and executed

New coverage:

- **Collection administration:** create, rename, slug validation, ordering,
  show/hide, delete (blocked while non-empty), duplicate slug rejection.
- **Assignments:** multiple collections per image, duplicate asset in one
  collection rejected, unassign without deleting media, reorder images.
- **Public filtering:** collection membership from stored keys, `All` dedupe,
  empty collections, unnamed collection rows ignored.
- **Visibility & safety:** unpublished collection persists, unknown collection
  reference rejected, archived media cannot be newly attached but an existing
  archived placement can be kept/hidden, missing media skipped.
- **Concurrency & authorisation:** stale version → `CONTENT_CONFLICT` (PT409),
  non-Full-Admin actor → `CONTENT_FORBIDDEN`, historical placements remain
  unassigned after migration.
- **Commercial/general enquiries:** commercial detail excludes topic/message,
  general detail retains them, optional commercial fields omitted when empty,
  commercial email params omit `topic`, general params keep it.

All 496 tests pass (`npm test`, exit 0). The pre-existing gallery persistence
suite (`tests/website-content-gallery-rpc.test.ts`) still passes unchanged.

---

## 6. Unresolved product decisions

1. **"Shoe Care" spelling.** Implemented as display name `Shoe Care` with slug
   `shoe-care`, matching the requested inventory. The owner's "Shore care" was
   treated as the intended shoe-care collection. Confirm before the collection
   is populated; the display name is editable, the slug is fixed after first
   save to keep public filter links stable.
2. **Empty public collections.** The five seeded collections are visible but
   empty until images are assigned. Alternative: seed them hidden and publish
   each once populated.
3. **Legacy placement assignment.** Which of the five existing images belongs to
   Laundry / Garment Care / Shoe Care / BTS / Others is still an owner decision.
4. **Collection descriptions.** Supported in the data model, the admin editor and
   the public filter bar (shown under the filter when a collection is selected).
   No copy was invented; all are blank.

---

## 7. Remaining risks and deployment steps

1. Apply `20261103120000_gallery_collections.sql` with the normal approval flow
   **before** deploying the matching application build.
2. Make the Brevo `enquiry_received` topic block conditional on `params.topic`
   (or add a commercial-specific template and template id) before relying on
   commercial alerts in production. Until then a commercial alert may render an
   empty topic line, but no irrelevant data is sent.
3. Perform the phone-field visual matrix (empty/focused/filled/invalid/autofill ×
   desktop/mobile/200% zoom) in a real browser; the CSS root cause is fixed, but
   no browser run was recorded here.
4. The migration was validated with PGlite only. Verify the collection seed and
   the RPC on a staging project before production, per the project's migration
   process.
5. `public.website_gallery_save` is the only path that validates collection
   references; direct `website_content` writes remain service-role only.
