import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { GalleryCollection } from "../src/lib/contracts";
import {
  GALLERY_CATEGORY_ORDER_CONFLICT,
  GALLERY_CATEGORY_ORDER_INVALID,
  galleryCategoryFromOrderRow,
  galleryCategoryOrderRpcItems,
  mergeGalleryCategoryOrder,
  mergeGalleryCategoryOrderRpcRows,
  moveGalleryCategory,
  moveGalleryCategoryRelative,
  orderGalleryCategoriesForSave,
  sortGalleryCategories,
} from "../src/lib/website/gallery-category-order";
import { mapGalleryCollectionRows } from "../src/lib/website/public-queries";

const category = (
  id: string,
  order: number,
  patch: Partial<GalleryCollection> = {},
): GalleryCollection => ({
  id,
  name: id.replace(/-/g, " "),
  description: "",
  order,
  visible: true,
  version: 1,
  ...patch,
});

/* -------------------------------------------------------------------------- */
/* Ordering calculations                                                      */
/* -------------------------------------------------------------------------- */

test("category ordering is deterministic and never mutates the input", () => {
  const rows = [category("b", 2), category("a", 2), category("c", 1)];
  assert.deepEqual(
    sortGalleryCategories(rows).map((row) => row.id),
    ["c", "a", "b"],
  );

  const down = moveGalleryCategory(rows, "c", 1);
  assert.deepEqual(
    down?.map((row) => [row.id, row.order]),
    [["a", 1], ["c", 2], ["b", 3]],
  );
  const up = moveGalleryCategory(rows, "b", -1);
  assert.deepEqual(
    up?.map((row) => [row.id, row.order]),
    [["c", 1], ["b", 2], ["a", 3]],
  );
  // Moving past either end is a no-op.
  assert.equal(moveGalleryCategory(rows, "c", -1), null);
  assert.equal(moveGalleryCategory(rows, "b", 1), null);

  // The source array keeps its original order and positions.
  assert.deepEqual(
    rows.map((row) => [row.id, row.order]),
    [["b", 2], ["a", 2], ["c", 1]],
  );
});

test("drag-and-drop placement lands before or after the target", () => {
  const rows = [category("a", 1), category("b", 2), category("c", 3)];
  assert.deepEqual(
    moveGalleryCategoryRelative(rows, "c", "a", false)?.map((row) => row.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    moveGalleryCategoryRelative(rows, "a", "c", true)?.map((row) => row.id),
    ["b", "c", "a"],
  );
  assert.equal(moveGalleryCategoryRelative(rows, "a", "a", false), null);
  assert.equal(moveGalleryCategoryRelative(rows, "a", "missing", false), null);
});

/* -------------------------------------------------------------------------- */
/* Complete-list validation                                                   */
/* -------------------------------------------------------------------------- */

test("reorder validation rejects duplicates, omissions, unknown keys and bad versions", () => {
  const confirmed = [category("a", 1), category("b", 2), category("c", 3)];

  const cases: Array<[GalleryCollection[], string]> = [
    [[category("a", 1), category("a", 2), category("b", 3)], GALLERY_CATEGORY_ORDER_CONFLICT],
    [[category("a", 1), category("b", 2)], GALLERY_CATEGORY_ORDER_CONFLICT],
    [[category("a", 1), category("b", 2), category("missing", 3)], GALLERY_CATEGORY_ORDER_CONFLICT],
    [[category("a", 1), category("b", 2), category("Shoe Care", 3)], GALLERY_CATEGORY_ORDER_INVALID],
    [[category("a", 1, { version: 0 }), category("b", 2), category("c", 3)], GALLERY_CATEGORY_ORDER_INVALID],
    [[category("a", 1, { version: 1.5 }), category("b", 2), category("c", 3)], GALLERY_CATEGORY_ORDER_INVALID],
  ];
  for (const [ordered, message] of cases) {
    assert.throws(() => orderGalleryCategoriesForSave(ordered, confirmed), {
      message,
    });
  }

  // A valid list is normalised to positions 1..N.
  const reversed = [category("c", 1), category("b", 2), category("a", 3)];
  assert.deepEqual(
    orderGalleryCategoriesForSave(reversed, confirmed).map((row) => [row.id, row.order]),
    [["c", 1], ["b", 2], ["a", 3]],
  );
});

test("RPC items use confirmed versions rather than stale optimistic ones", () => {
  const confirmed = [
    category("a", 1, { version: 7 }),
    category("b", 2, { version: 9 }),
  ];
  const ordered = [
    category("b", 1, { version: 1 }),
    category("a", 2, { version: 1 }),
  ];
  assert.deepEqual(galleryCategoryOrderRpcItems(ordered, confirmed), [
    { key: "b", version: 9, sort_order: 1 },
    { key: "a", version: 7, sort_order: 2 },
  ]);
});

/* -------------------------------------------------------------------------- */
/* RPC response mapping and metadata preservation                             */
/* -------------------------------------------------------------------------- */

test("RPC rows map to the exact category shape the manager expects", () => {
  assert.deepEqual(
    galleryCategoryFromOrderRow({
      key: "garment-care",
      payload: { name: "Garment Care", description: "Specialist care" },
      published: false,
      sort_order: 3,
      version: 4,
    }),
    {
      id: "garment-care",
      name: "Garment Care",
      description: "Specialist care",
      order: 3,
      visible: false,
      version: 4,
    },
  );
  assert.deepEqual(
    galleryCategoryFromOrderRow({
      key: "others",
      payload: {},
      published: true,
      sort_order: 1,
      version: 1,
    }),
    {
      id: "others",
      name: "",
      description: "",
      order: 1,
      visible: true,
      version: 1,
    },
  );
});

test("merging the confirmed order preserves counts, descriptions and visibility", () => {
  const current = [
    category("laundry", 1, { imageCount: 5, description: "Wash and fold", version: 2 }),
    category("garment-care", 2, {
      imageCount: 1,
      description: "Specialist care",
      visible: false,
      version: 3,
    }),
  ];
  const saved = [
    // The reorder response has no imageCount and no thumbnail metadata.
    {
      id: "garment-care",
      name: "Garment Care",
      description: "Specialist care",
      order: 1,
      visible: false,
      version: 4,
    },
    {
      id: "laundry",
      name: "Laundry",
      description: "Wash and fold",
      order: 2,
      visible: true,
      version: 3,
    },
  ];

  const merged = mergeGalleryCategoryOrder(current, saved);
  assert.deepEqual(merged.map((row) => row.id), ["garment-care", "laundry"]);
  assert.deepEqual(merged.map((row) => row.order), [1, 2]);
  assert.deepEqual(merged.map((row) => row.imageCount), [1, 5]);
  assert.deepEqual(merged.map((row) => row.description), [
    "Specialist care",
    "Wash and fold",
  ]);
  assert.equal(merged[0].visible, false);
  assert.equal(merged[0].version, 4);
  assert.equal(merged[1].version, 3);
  // The loaded objects are not mutated.
  assert.equal(current[0].order, 1);
  assert.equal(current[0].version, 2);
});

test("merging raw RPC rows keeps metadata and applies the saved order", () => {
  const current = [
    category("laundry", 1, { imageCount: 4 }),
    category("shoe-care", 2, { imageCount: 2 }),
  ];
  const merged = mergeGalleryCategoryOrderRpcRows(current, [
    {
      key: "shoe-care",
      payload: { name: "Shoe Care", description: "Footwear" },
      published: true,
      sort_order: 1,
      version: 6,
    },
    {
      key: "laundry",
      payload: { name: "Laundry", description: "Wash" },
      published: true,
      sort_order: 2,
      version: 5,
    },
  ]);
  assert.deepEqual(merged.map((row) => row.id), ["shoe-care", "laundry"]);
  assert.deepEqual(merged.map((row) => row.imageCount), [2, 4]);
  assert.deepEqual(merged.map((row) => row.version), [6, 5]);
});

test("a response that omits, duplicates or invents categories is rejected", () => {
  const current = [
    category("a", 1, { imageCount: 3 }),
    category("b", 2),
    category("c", 3),
  ];
  const one = category("a", 1);

  assert.throws(() => mergeGalleryCategoryOrder(current, [one]), {
    message: GALLERY_CATEGORY_ORDER_CONFLICT,
  });
  assert.throws(
    () =>
      mergeGalleryCategoryOrder(current, [
        category("a", 1),
        category("a", 2),
        category("b", 3),
      ]),
    { message: GALLERY_CATEGORY_ORDER_CONFLICT },
  );
  assert.throws(
    () =>
      mergeGalleryCategoryOrder(current, [
        category("a", 1),
        category("b", 2),
        category("new", 3),
      ]),
    { message: GALLERY_CATEGORY_ORDER_CONFLICT },
  );
  assert.throws(
    () => mergeGalleryCategoryOrderRpcRows(current, []),
    { message: GALLERY_CATEGORY_ORDER_CONFLICT },
  );
});

/* -------------------------------------------------------------------------- */
/* Admin and public wiring                                                    */
/* -------------------------------------------------------------------------- */

test("the admin persistence path merges confirmed records instead of replacing them", () => {
  const client = readFileSync(
    "src/components/admin/content/gallery-category-order.ts",
    "utf8",
  );
  assert.match(client, /mergeGalleryCategoryOrder\(normalized, saved\)/);
  assert.match(client, /mergeGalleryCategoryOrderRpcRows\(normalized, rows\)/);
  assert.doesNotMatch(client, /placements/);

  const manager = readFileSync(
    "src/components/admin/content/gallery-manager.tsx",
    "utf8",
  );
  // A successful save applies the confirmed categories and resets the baseline.
  assert.match(manager, /setCategories\(nextCategories\)/);
  assert.match(manager, /categoryOrderConfirmed\.current = structuredClone\(nextCategories\)/);
  // A failed save restores the previous confirmed ordering and reports it.
  assert.match(manager, /setCategories\(confirmed\)/);
  assert.match(manager, /Category order could not be saved/);
  // Undo persists through the same helper with the previous order.
  assert.match(manager, /ordered: previous,\s*confirmed: categoryOrderConfirmed\.current/);
  // Stale server data cannot clobber the confirmed order after a save.
  assert.match(manager, /appliedCategoryData\.current === liveCategories\.items/);
  // An empty baseline (for example before the confirmation effect runs) falls
  // back to the loaded categories instead of restoring an empty list on error.
  assert.match(
    manager,
    /categoryOrderConfirmed\.current\.length\s*\?[\s\S]*?:\s*structuredClone\(orderCategories\(categories\)\)/,
  );
  // Thumbnails are still derived from loaded placements, never from RPC rows.
  assert.match(
    manager,
    /categoryThumbnail\(category, placements, allMedia, liveGallery\.items\)/,
  );
});

test("the public Gallery renders collections in the persisted row order", () => {
  const rows = [
    {
      record_key: "garment-care",
      payload: { name: "Garment Care", description: "Specialist care" },
    },
    { record_key: "laundry", payload: { name: "Laundry", description: "" } },
  ];
  assert.deepEqual(mapGalleryCollectionRows(rows as never), [
    { id: "garment-care", name: "Garment Care", description: "Specialist care" },
    { id: "laundry", name: "Laundry", description: "" },
  ]);

  const publicLoader = readFileSync("src/lib/website/public.ts", "utf8");
  assert.match(
    publicLoader,
    /\.eq\("module", "gallery_collection"\)[\s\S]*?\.eq\("published", true\)[\s\S]*?\.order\("sort_order", \{ ascending: true \}\)\s*\.order\("record_key", \{ ascending: true \}\)/,
  );
});
