# Gallery Ordering Investigation
**Status:** Investigation only. No source code or database changes were made as part of this report.

## 1. Executive summary
The live Gallery already has persisted ordering, but the image-level Move Up/Move Down behavior described in the investigation request is **not present in the current Gallery admin component**. There are category Move up/Move down buttons, but they only change local React state and mark the form dirty; they do not write to the database until the page-level **Save Changes** action is submitted. The image-level reorder helper exists in shared Gallery rules/tests but is not wired into the admin UI at all.

Consequently, if the reported broken controls are image-level controls, the exact cause is that the production admin UI has no such controls: the move helper is dead/unreferenced code. If the reported buttons are category-level buttons, they do work locally, but are not persisted until **Save Changes**; they are disabled in the built-in category view unless the administrator opens Edit Category. The visible flow can therefore appear not to work if the user expects an immediate write, or if no final save is made. This is confirmed by the component click handlers and save path; it is not evidence of a database failure.

Gallery position is currently **global per placement list**, not category-specific. The existing atomic `website_gallery_save` RPC writes one global sequence of placements, with a `collection_key` on each placement. A media asset can have one placement in multiple categories. Such placements are grouped as one image in the admin; the unused move helper moves all of that asset's placements together in the global sequence. Public category filters preserve the underlying global position order and filter that sequence, then deduplicate by media ID.

The current design is persistence-capable and already has useful safety measures (server-side full-admin authorization, one atomic save for collections and placements, optimistic versions, advisory lock/busy handling, validation, cache invalidation). The UI issue is chiefly a mismatch between intended interaction and implemented controls, plus hidden save semantics—not missing schema. A future implementation should first explicitly choose whether placement order is global or scoped to each category. Drag-and-drop and position indicators can then be built on top of the existing draft state and atomic save, without adding a second sorting field/mechanism.

## 2. Current Gallery architecture
### Confirmed data model
- **`public.website_gallery_media`** stores the media asset itself: UUID `id`, storage path, public URL, metadata, `archived`, `version`, and `created_at`. It does not have a display-order field. See `supabase/migrations/20261028100000_phase6_website_content.sql`.
- **`public.website_content`** stores both gallery placements (`module = 'gallery'`) and gallery categories (`module = 'gallery_collection'`, module enabled by `20261103120000_gallery_collections.sql`). It provides the stable record key, JSON payload, `published` flag, `sort_order`, `version`, editor and update timestamp.
- A placement payload contains `media_id`, placement-level `alt`, `caption`, and `collection_key`. The placement row's `sort_order` is its display position. Empty `collection_key` means unassigned/legacy placement.
- A collection row's own `sort_order` orders category/filter records. Its payload contains name and description; `published` is category visibility.
- `website_content` has `UNIQUE (module, record_key)`, nonnegative `sort_order`, positive `version`, JSON-object payload and module constraints. The schema has a public-order partial index for published content. The collection migration adds a collection order index on `(sort_order, record_key)` restricted to the collection module.
- No Gallery-specific SQL trigger is defined in the inspected migrations. Ordering is explicitly written in the application and `website_gallery_save` function.

### Confirmed ordering scope
Placement order is one global order over all Gallery placement records. It is not stored separately for each `collection_key`. Collection order is a separate global order over categories. This follows from the one `sort_order` column on each placement, the single placement array accepted by the save RPC, and the public query's single global sort followed by client-side category filtering.

## 3. Admin interface and exact failure
The admin component is `src/components/admin/content/gallery-manager.tsx`.

- It loads `gallery-collections` and `gallery` through `useAdminWebsiteData` and maintains local arrays in React state.
- `moveCategory(id, delta)` sorts the local categories, swaps adjacent entries, compacts their order, updates state and clears notices. It does not make an action/API/database call.
- The only category Move up/Move down controls are rendered inside the category's **Edit Category** details. The category card list itself shows Open Category/Edit Category/Delete Category, not always-visible ordering controls.
- Image cards in a category have Edit Image and Remove from Category controls. There is no image Move Up or Move Down control and no call to the existing `moveGalleryImage` helper in the UI. Grep found the helper only at its definition in `gallery-collections.ts`; it is not called by the component.
- The page-level Save Changes button submits the form. `save()` normalizes category and placement orders, validates, then invokes `saveGalleryWorkspace` in demo mode or `saveLiveGalleryWorkspace` in live mode. It only replaces the local baseline with the server response after the write succeeds. There is no optimistic database write; editing is staged locally and persisted after server confirmation.
- Until a save occurs, moving a category changes only local state. On a successful save, the UI shows “Changes saved. The website gallery now matches this view.” and adopts the server-returned canonical order/version values.
- Cancel restores the original baseline. An `UnsavedGuard` warns about unsaved changes.

**Exact reason:** no image-level reorder handler or button is wired in `GalleryManager`; the existing image move rule is unused. For category ordering, the buttons are intentionally local-only until the separate Save Changes submit, and are tucked inside Edit Category. Thus no immediate write occurs on click. The inspected code does not support a claim that the database is dropping an image reorder request: the image reorder request is never sent. No live production database was queried for this report; the schema findings are from migrations and repository code.

## 4. Admin-to-database-to-public flow
1. `GalleryManager` loads admin placements and categories from `/api/admin/website?module=gallery` and `...module=gallery-collections`. The API checks the verified admin identity and `content.manage` permission; its responses are `private, no-store`.
2. Admin actions stage data in React state. `orderedPlacements` and `orderCategories` sort/compact based on current local `order` before submit.
3. On Save Changes, `saveLiveGalleryWorkspace` in `src/lib/website/actions.ts` checks business-write availability, resolves the current administrator, requires `content.manage`, verifies request origin, bounds/normalizes input and calls the server repository. Writes trigger immediate public path/tag invalidation for `/`, `/gallery`, and `site-gallery` after success.
4. `writeGalleryWorkspace` in `src/lib/website/gallery-write.ts` validates the combined workspace, normalizes orders, checks media existence/archive constraints and checks expected versions. It calls the atomic `website_gallery_save` RPC.
5. `website_gallery_save` (`supabase/migrations/20261103120000_gallery_collections.sql`) enforces `full_admin` at the database boundary, validates all inputs/references, takes a Gallery advisory transaction lock (returns a busy error if unavailable), checks optimistic versions, and writes collections and placements atomically. Existing rows increment version; omitted rows are deleted from the relevant module. The RPC response is ordered by `sort_order, record_key`.
6. The public server loader `readGallery()` in `src/lib/website/public.ts` queries published collections and published placements ordered by `sort_order`. It ignores placements belonging to hidden/deleted collections in category views, retains unassigned placements for All, fetches only non-archived referenced media, and passes ordered placement rows to `buildGalleryPhotos()`.
7. `buildGalleryPhotos()` maps placements in received order to public tiles. In `src/components/gallery.tsx`, the public All/category view filters that ordered tile array and applies `dedupeGalleryPhotos()` (first matching media ID wins). Gallery data is cached and the successful action invalidates the public Gallery tag/path.

The admin read endpoint orders rows by `sort_order`; the database returned save result has an explicit secondary `record_key` order. Several reads order only by `sort_order`, so ties are not guaranteed by SQL. Normal UI saves compact positions to unique one-based positions, but existing/legacy ties could still yield unstable order until a workspace save compacts them.

## 5. Current ordering behavior
- **Admin category order:** local array order is swapped, compacted and saved together with the gallery workspace.
- **Admin placement order:** represented by one `order` on each placement in state/database; no image reorder interaction is wired in the manager.
- **Public order:** visible placement rows are read in ascending global `sort_order`; category filter is applied afterwards. Ties have no uniform explicit secondary sort in the public loader.
- **Category order:** published collection rows are independently read in ascending collection `sort_order`; ties also lack explicit tie-breaking in the public query.
- The code has a `moveGalleryImage` helper, and tests cover its behavior. It groups all placements for a media asset and moves that group in a global media order; this does not make it category-specific.

## 6. Multiple category membership impact
**Confirmed:** one media asset may have multiple placement records, one per category; duplicate placement of the same media within one category is rejected. `assignImagesToCategory()` creates or reuses a placement. `groupGalleryImages()` groups all placements by media ID for admin display. The unused `moveGalleryImage()` helper moves all of one image's placements together in the global ordering.

**Public consequence:** `buildGalleryPhotos()` emits one tile per placement, with that placement's category membership and position. The All view deduplicates repeated media IDs, retaining the first occurrence in the globally ordered list. For an individual category, filtering first then deduplicating gives one tile in the relative order of that category's matching placements. A multi-category asset can therefore have one global relative position but no independent position in each category. Reordering its grouped placements globally affects its position in All and may affect its relative placement in each filtered category.

## 7. Blog ordering comparison
The recently added Blog implementation uses the same `website_content.sort_order` field and a shared deterministic helper (`src/lib/website/blog-order.ts`). Blog has a dedicated, version-checked atomic reorder function (`website_blog_reorder`) because its admin order list needs a focused complete-order operation. Blog ordering is one list; ties use record key, new rows are appended, the action revalidates `/blog`, and public pagination is applied after loading in saved order.

Gallery differs in confirmed ways:

- Gallery has distinct placement and category records in separate `website_content.module` namespaces, a combined editor for both, and an existing atomic workspace save function.
- The workspace save already writes placements and collection order, with version maps and a Gallery advisory lock. Adding a separate Gallery reorder RPC without a specific scope/atomicity need would duplicate an existing persistence path.
- Gallery's current UI drafts edits and saves the whole workspace, whereas Blog's move controls save immediately through the dedicated action. The Blog's `blog-order.ts` is not directly suitable for Gallery until order scope, repeated media grouping, and save boundaries are decided.
- Blog's public loader has a deterministic tie-break; Gallery queries usually order only by `sort_order`. This is a consistency gap worth addressing in an implementation, but not the reported primary root cause.

## 8. Confirmed findings vs assumptions
### Confirmed from source/migrations/tests
- Existing Gallery order field is `website_content.sort_order`; no new schema field is needed to persist the current global placement/category ordering.
- Categories live in `website_content` under `gallery_collection`; raw media metadata lives in `website_gallery_media`; placements live in `website_content` under `gallery`.
- Image reorder UI is absent; helper exists but has no call site in the admin.
- Category move is local until the explicit Save Changes submit.
- Combined save is atomic at the database function and uses expected versions, a lock, validation and `full_admin` authorization.
- Public loader respects persisted global order and filters by collection; public UI uses that order and deduplicates multi-category media.
- Tests cover the gallery RPC/workspace order and helper behavior, but do not demonstrate an admin image reorder interaction because that interaction is not wired.

### Assumptions / not verified against a live deployed database
- The deployed database has all migrations from this repository applied, including `20261103120000_gallery_collections.sql` and the subsequent Blog migration. This report reads the repository schema, not a live database catalog.
- “Move Up/Move Down” in the report request refers to intended **image** ordering because category controls are present, while image controls are not. If the user meant category ordering, the controls are staged and require Save Changes; the architecture supports saving those changes.
- No existing category-specific order is stored. Implementing a category-specific order would require a deliberate data/payload model decision rather than assuming current data already has that scope.

## 9. Recommended technical solution (not implemented)

First confirm the product behavior with stakeholders: **global order** or **independent order per category**. The current data model and public behavior support a global order only. For the smallest-risk solution, retain that global order:

1. Wire the reorder operation into GalleryManager using a single shared pure ordering helper (or the already present `moveGalleryImage`) and an explicit image-level order field/position label.
2. Because the current Gallery workspace is intentionally staged, preserve that transaction model: a move updates local draft order immediately, announces feedback, marks the form dirty, and persists on Save Changes with collections and placements in one `website_gallery_save` call. Clearly label the save semantics; avoid a second Gallery-specific immediate-write channel.
3. Ensure image groups move as a unit across their category placements, matching the existing helper and avoiding divergent ordering for one shared asset. Compact placement positions before save (already done) and let the RPC's expected-version checks fail closed on stale data.
4. Add explicit deterministic secondary ordering (`record_key`) at every Gallery placement/category read that orders by `sort_order`, and retain the public loader's order through filter/dedupe. If category-specific ordering is selected instead, the current single `sort_order` cannot represent independent per-category positions; assess a normalized placement identity/order design or a carefully specified category-order mapping before implementing any schema change.
5. Do not add a new Gallery RPC solely for reordering unless a future requirement calls for immediate isolated saves. The existing atomic `website_gallery_save` is the appropriate database boundary for staged workspace edits.

## 10. Recommended improved admin UI (not implemented)

- Add drag-and-drop to the image list within the selected category **only after defining order scope**. With global order and cross-category assets, show clear behavior when dragging a multi-category image (recommended: the grouped media item moves together in the global sequence, consistent with current helper).
- Display a visible position number/badge and concise “Position N” text; offer keyboard-accessible Move earlier/later buttons as a fallback to drag.
- Reorder optimistically in local workspace state for instant visual feedback, show unsaved status, support Undo/Cancel, and only show “Saved” after RPC confirmation. On conflict, retain a safe draft or reload/report the stale state instead of implying persistence.
- Explain that reorder affects All and category views, or make positions category-specific if that is the chosen product behavior.
- Add accessible drag handles/keyboard operations and a live-region announcement of the new position.

## 11. Files and database objects likely involved in a future implementation
### Likely source files
- `src/components/admin/content/gallery-manager.tsx` — UI event handling, local order state, position feedback, save semantics.
- `src/lib/website/gallery-collections.ts` — shared reorder/group rules; currently contains unused `moveGalleryImage`.
- `src/lib/website/gallery-write.ts` — keep normalization/atomic persistence boundary; likely no DB write change for global ordering.
- `src/lib/website/actions.ts` — existing `saveLiveGalleryWorkspace` authorization, origin and invalidation path; likely reuse rather than add a new action.
- `src/app/api/admin/website/route.ts` — add stable tie-breakers to admin ordering reads if chosen.
- `src/lib/website/public.ts` — add stable tie-breakers to public placement/category reads if chosen.
- `src/lib/website/public-queries.ts` / `src/components/gallery.tsx` — only if the public contract/filter or dedupe behavior changes.
- `tests/gallery-collections.test.ts`, `tests/public-loaders.test.ts`, `tests/website-content.test.ts` — interaction-independent rules, RPC persistence/version tests and public order/filter regression tests.

### Existing database objects to reuse / inspect further at implementation time
- `public.website_content` (`module`, `record_key`, `payload`, `published`, `sort_order`, `version`, audit metadata).
- `public.website_gallery_media` (`id`, `archived`, media fields; no order field).
- `public.website_gallery_save(uuid,jsonb,jsonb,jsonb,jsonb)` defined in `20261103120000_gallery_collections.sql`.
- `website_content_public_published` RLS policy and the existing service-role-only RPC grant.
- The `website_content_public_order` and `website_content_gallery_collection_order` indexes.

A new migration is **not currently indicated** for global ordering. Category-specific order would need a separate design review; this investigation does not recommend a migration without that product decision.

## 12. Risks and regression areas
- Incorrectly changing from global to category-specific ordering can reorder All, break shared-media consistency, or require changing stored records.
- Moving one media item without moving all its placements can create different order/meaning for the same asset across category filters.
- Multi-category dedupe means All displays only the first ordered placement for a media ID; filtered category lists are independently filtered before dedupe. Tests should lock down this intended behavior.
- Whole-workspace save can conflict with another editor or stale category/placement versions. The UI must not falsely indicate save success or silently overwrite newer versions.
- Drag-and-drop may not be accessible without keyboard and button alternatives; it may also behave inconsistently on touch/mobile.
- Reordering by changing category assignment, hidden/visible state, image metadata, or media asset records would be a regression; ordering should update only intended placement/category `sort_order` values.
- Tie ordering can vary when multiple rows share one `sort_order` unless `record_key` is included as a deterministic secondary order.
- The public Gallery is cached; missing `site-gallery` invalidation would make a successful save appear stale. The existing action already invalidates it and should be retained.
- Live auth behavior depends on current Full Admin permissions and database RPC authorization; tests should cover denied roles and stale versions.

## 13. Proposed implementation and testing plan
1. Confirm the user-facing requirement and choose global versus per-category image ordering. Document whether multi-category images move together.
2. Add pure tests for move direction, endpoints, stable tie-breaking, compact positions, grouped multi-category placements, filtering and dedupe. Do not change the Blog helper.
3. Implement accessible admin controls/drag interaction on the local draft order only; verify that click/drag does not issue a request before Save Changes if retaining current staged save semantics.
4. Test the live action path: Full Admin allowed; Operational Admin denied; origin/write guard enforced; combined workspace save uses expected versions; stale version and lock/busy errors are reported; saved values are returned in stable order.
5. Test UI flow: initial order and visible position labels; reorder; immediate visual preview; Save Changes; refresh admin and confirm persistence; Cancel restores baseline; conflict surfaces an error without false success.
6. Test public flow after save: All order, category-relative order, hidden category/image behavior, archived media exclusion, duplicate media in two categories, cache/tag invalidation, and reload persistence.
7. Run targeted gallery tests, then `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` (or `npm run check`). If a schema change is proposed only for category-specific ordering, add migration/RPC tests against a disposable database before rollout; do not run destructive SQL against production.

---

**Investigation boundary:** No files outside this report were modified. No migration was created or changed, and no database query/write was run against a live database.
