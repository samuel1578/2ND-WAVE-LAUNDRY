import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { GalleryCollection, GalleryPlacement } from "../src/lib/contracts";
import {
  GALLERY_COLLECTION_SLUG,
  UNASSIGNED_CATEGORY_LABEL,
  assignImagesToCategory,
  galleryCollectionDeletionError,
  galleryCollectionError,
  galleryWorkspaceDataReady,
  galleryWorkspaceError,
  groupGalleryImages,
  moveGalleryImage,
  moveGalleryImageRelative,
  nextCategorySlug,
  normalizeGallerySlug,
  removeImagesFromCategory,
  unassignCategory,
  unassignedGalleryImages,
} from "../src/lib/website/gallery-collections";

/* -------------------------------------------------------------------------- */
/* Pure validation                                                            */
/* -------------------------------------------------------------------------- */

const collection = (
  patch: Partial<GalleryCollection> = {},
): GalleryCollection => ({
  id: "laundry",
  name: "Laundry",
  description: "",
  order: 1,
  visible: true,
  version: 0,
  ...patch,
});

const placement = (
  patch: Partial<GalleryPlacement> = {},
): GalleryPlacement => ({
  id: "placement-1",
  mediaId: "media-1",
  alt: "Folded laundry",
  caption: "",
  order: 1,
  visible: true,
  version: 0,
  collectionKey: "laundry",
  ...patch,
});

test("collection slugs are stable, lowercase identifiers", () => {
  assert.equal(normalizeGallerySlug("Shoe Care"), "shoe-care");
  assert.equal(normalizeGallerySlug("  BTS / Behind the Scenes  "), "bts-behind-the-scenes");
  assert.equal(normalizeGallerySlug("---"), "");
  assert.equal(GALLERY_COLLECTION_SLUG.test("shoe-care"), true);
  assert.equal(GALLERY_COLLECTION_SLUG.test("Shoe Care"), false);
  assert.equal(GALLERY_COLLECTION_SLUG.test("shoe--care"), false);
});

test("collection validation rejects missing, duplicate and malformed records", () => {
  assert.equal(galleryCollectionError(collection(), [collection()]), "");
  assert.match(galleryCollectionError(collection({ name: " " }), []), /name/);
  assert.match(galleryCollectionError(collection({ id: "" }), []), /slug/);
  assert.match(galleryCollectionError(collection({ id: "Shoe Care" }), []), /slug/);
  assert.match(
    galleryCollectionError(collection(), [collection(), collection()]),
    /unique/,
  );
  assert.match(
    galleryCollectionError(collection({ description: "x".repeat(301) }), []),
    /description/,
  );
});

test("gallery cannot save until both collection and placement versions are loaded", () => {
  const categoriesReady = {
    categoriesLoading: false,
    placementsLoading: true,
    categoriesError: "",
    placementsError: "",
  };
  assert.equal(galleryWorkspaceDataReady(categoriesReady), false);
  assert.equal(
    galleryWorkspaceDataReady({ ...categoriesReady, placementsLoading: false }),
    true,
  );
  assert.equal(
    galleryWorkspaceDataReady({ ...categoriesReady, placementsError: "unavailable" }),
    false,
  );
});

test("workspace validation rejects unknown collections and duplicate assignments", () => {
  assert.equal(
    galleryWorkspaceError([collection()], [placement()]),
    "",
  );
  assert.match(
    galleryWorkspaceError([collection()], [placement({ collectionKey: "missing" })]),
    /existing collection/,
  );
  assert.match(
    galleryWorkspaceError(
      [collection()],
      [placement(), placement({ id: "placement-2" })],
    ),
    /once in the same collection/,
  );
  // The same asset may appear in two different collections.
  assert.equal(
    galleryWorkspaceError(
      [collection(), collection({ id: "shoe-care", name: "Shoe Care", order: 2 })],
      [placement(), placement({ id: "placement-2", collectionKey: "shoe-care" })],
    ),
    "",
  );
  // Unassigned placements are allowed and keep appearing in the All view.
  assert.equal(
    galleryWorkspaceError([collection()], [placement({ collectionKey: "" })]),
    "",
  );
});

test("a collection holding images cannot be deleted", () => {
  assert.match(
    galleryCollectionDeletionError("laundry", [placement()]),
    /Move or remove/,
  );
  assert.equal(
    galleryCollectionDeletionError("others", [placement()]),
    "",
  );
});

/* -------------------------------------------------------------------------- */
/* Image-first admin workspace                                                */
/* -------------------------------------------------------------------------- */

test("images are grouped once even when they sit in several categories", () => {
  const groups = groupGalleryImages([
    placement({ id: "p1", order: 2, collectionKey: "laundry", alt: "Folded towels" }),
    placement({
      id: "p2",
      order: 1,
      mediaId: "media-2",
      collectionKey: "",
      visible: false,
      alt: "Basket",
    }),
    placement({ id: "p3", order: 3, collectionKey: "shoe-care", visible: false }),
  ]);

  assert.deepEqual(groups.map((group) => group.mediaId), ["media-2", "media-1"]);
  assert.deepEqual(groups[1].collectionKeys, ["laundry", "shoe-care"]);
  assert.equal(groups[1].placements.length, 2);
  // One hidden placement must not hide an image that is shown elsewhere.
  assert.equal(groups[1].visible, true);
  assert.equal(groups[0].visible, false);
  assert.deepEqual(
    unassignedGalleryImages(groups).map((group) => group.mediaId),
    ["media-2"],
  );
  assert.equal(UNASSIGNED_CATEGORY_LABEL, "Needs a Category");
});

test("new categories get a permanent unique slug without asking the admin", () => {
  assert.equal(nextCategorySlug("Shoe Care", []), "shoe-care");
  assert.equal(
    nextCategorySlug("BTS / Behind the Scenes", []),
    "bts-behind-the-scenes",
  );
  assert.equal(nextCategorySlug("Laundry", [collection({ id: "laundry" })]), "laundry-2");
  assert.equal(
    nextCategorySlug("Others", [
      collection({ id: "others" }),
      collection({ id: "others-2" }),
    ]),
    "others-3",
  );
  assert.equal(nextCategorySlug("   ", []), "category");
});

test("assigning images reuses free placements and supports several categories", () => {
  const rows = assignImagesToCategory({
    placements: [
      placement({
        id: "p1",
        mediaId: "media-1",
        collectionKey: "",
        order: 1,
        caption: "Keep me",
      }),
      placement({ id: "p2", mediaId: "media-2", collectionKey: "laundry", order: 2 }),
    ],
    images: [
      { mediaId: "media-1", alt: "Folded towels", caption: "" },
      { mediaId: "media-2", alt: "Folded laundry", caption: "" },
    ],
    categoryKey: "shoe-care",
    newId: () => "new-1",
  });

  // media-1 had no category, so its existing placement is adopted, not duplicated.
  assert.deepEqual(
    rows.map((row) => [row.id, row.collectionKey]),
    [
      ["p1", "shoe-care"],
      ["p2", "laundry"],
      ["new-1", "shoe-care"],
    ],
  );
  assert.equal(rows[0].caption, "Keep me");
  assert.deepEqual(rows.map((row) => row.order), [1, 2, 3]);
  assert.equal(
    galleryWorkspaceError(
      [
        collection({ id: "laundry" }),
        collection({ id: "shoe-care", name: "Shoe Care", order: 2 }),
      ],
      rows,
    ),
    "",
  );

  // Re-assigning the same images changes nothing further.
  const again = assignImagesToCategory({
    placements: rows,
    images: [
      { mediaId: "media-1", alt: "Folded towels", caption: "" },
      { mediaId: "media-2", alt: "Folded laundry", caption: "" },
    ],
    categoryKey: "shoe-care",
    newId: () => "unused",
  });
  assert.deepEqual(again.map((row) => row.id), ["p1", "p2", "new-1"]);
});

test("removing an image from one category keeps its other categories", () => {
  const rows = [
    placement({ id: "p1", mediaId: "media-1", collectionKey: "laundry", order: 1 }),
    placement({ id: "p2", mediaId: "media-1", collectionKey: "shoe-care", order: 2 }),
    placement({ id: "p3", mediaId: "media-2", collectionKey: "laundry", order: 3 }),
  ];
  const remaining = removeImagesFromCategory({
    placements: rows,
    mediaIds: ["media-1"],
    categoryKey: "laundry",
  });
  assert.deepEqual(remaining.map((row) => row.id), ["p2", "p3"]);
  assert.deepEqual(remaining.map((row) => row.order), [1, 2]);
});

test("deleting a category moves its images to Needs a Category", () => {
  const rows = [
    placement({ id: "p1", mediaId: "media-1", collectionKey: "shoe-care", order: 1 }),
    placement({ id: "p2", mediaId: "media-2", collectionKey: "laundry", order: 2 }),
  ];
  const moved = unassignCategory(rows, "shoe-care");
  assert.deepEqual(moved.map((row) => row.collectionKey), ["", "laundry"]);
  assert.equal(moved.length, 2);
  assert.equal(
    unassignedGalleryImages(groupGalleryImages(moved)).length,
    1,
  );
});

test("moving an image keeps all of its category placements together", () => {
  const rows = [
    placement({ id: "p1", mediaId: "media-1", collectionKey: "laundry", order: 1 }),
    placement({ id: "p2", mediaId: "media-2", collectionKey: "laundry", order: 2 }),
    placement({ id: "p3", mediaId: "media-1", collectionKey: "shoe-care", order: 3 }),
    placement({ id: "p4", mediaId: "media-3", collectionKey: "others", order: 4 }),
  ];
  const moved = moveGalleryImage({ placements: rows, mediaId: "media-1", offset: 1 });
  assert.deepEqual(
    moved.map((row) => row.mediaId),
    ["media-2", "media-1", "media-1", "media-3"],
  );
  assert.deepEqual(moved.map((row) => row.order), [1, 2, 3, 4]);
  // Moving past either end is a no-op.
  assert.equal(moveGalleryImage({ placements: rows, mediaId: "media-1", offset: -1 }), rows);
  assert.equal(moveGalleryImage({ placements: rows, mediaId: "media-3", offset: 1 }), rows);
});

test("drag reorder places a grouped multi-category image globally before or after the target", () => {
  const rows = [
    placement({ id: "p1", mediaId: "media-1", collectionKey: "laundry", order: 1 }),
    placement({ id: "p2", mediaId: "media-2", collectionKey: "laundry", order: 2 }),
    placement({ id: "p3", mediaId: "media-1", collectionKey: "shoe-care", order: 3 }),
    placement({ id: "p4", mediaId: "media-3", collectionKey: "others", order: 4 }),
  ];
  const moved = moveGalleryImageRelative({ placements: rows, mediaId: "media-1", targetMediaId: "media-3" });
  assert.deepEqual(moved.map((row) => [row.id, row.order]), [["p2", 1], ["p1", 2], ["p3", 3], ["p4", 4]]);
  const afterTarget = moveGalleryImageRelative({ placements: rows, mediaId: "media-1", targetMediaId: "media-2", after: true });
  assert.deepEqual(afterTarget.map((row) => row.mediaId), ["media-2", "media-1", "media-1", "media-3"]);
  assert.deepEqual(groupGalleryImages(afterTarget).map((group) => group.mediaId), ["media-2", "media-1", "media-3"]);
});

test("Gallery admin exposes accessible draft reordering without adding a write route", () => {
  const manager = readFileSync("src/components/admin/content/gallery-manager.tsx", "utf8");
  assert.match(manager, /moveGalleryImageRelative\(\{ placements, mediaId, targetMediaId, after \}\)/);
  assert.match(manager, /reorderImageRelative\(group\.mediaId, activeGroups\[categoryIndex - 1\]/);
  assert.match(manager, /reorderImageRelative\(group\.mediaId, activeGroups\[categoryIndex \+ 1\]/);
  assert.match(manager, /onDrop=\{\(event\) => dropImage/);
  assert.match(manager, /Move Up/);
  assert.match(manager, /Move Down/);
  assert.match(manager, /Undo last move/);
  assert.match(manager, /Undo category move/);
  assert.match(manager, /moveCategory\(category\.id, -1\)/);
  assert.match(manager, /moveCategory\(category\.id, 1\)/);
  assert.match(manager, /dropCategory\(category\.id, event\)/);
  // The redesigned table must still open a category's image management.
  assert.match(manager, /openCategory\(category\.id\)/);
  assert.match(manager, /manage its images/);
  assert.match(manager, /Category position \$\{index \+ 1\}/);
  assert.match(manager, /Category Order \(\{categories\.length\}\)/);
  assert.match(manager, /aria-label=\{\`Move \$\{category\.name\} up\`\}/);
  assert.match(manager, /aria-label=\{\`Move \$\{category\.name\} down\`\}/);
  assert.match(manager, /setCategoryUndoAvailable\(false\)/);
  // The redesigned category table must live in the CSS module the manager
  // actually imports; the sibling admin/content.module.css is not used by it.
  const contentStyles = readFileSync("src/components/admin/content/content.module.css", "utf8");
  assert.match(contentStyles, /\.galleryCategoryRow \{/);
  assert.match(contentStyles, /\.galleryCategoryVisibility \{/);
  assert.match(contentStyles, /\.galleryCategoryTool \{/);
  const workspaceWriter = readFileSync("src/lib/website/gallery-write.ts", "utf8");
  assert.match(workspaceWriter, /p_collections:[\s\S]*?sort_order: index \+ 1/);
  assert.match(workspaceWriter, /website_gallery_save/);
  assert.match(manager, /saveLiveGalleryWorkspace/);
  assert.match(manager, /Save Changes/);
  assert.match(manager, /Unsaved/);
  assert.doesNotMatch(manager, /saveLiveGalleryOrder/);
  const publicLoader = readFileSync("src/lib/website/public.ts", "utf8");
  const adminRoute = readFileSync("src/app/api/admin/website/route.ts", "utf8");
  const publicRoute = readFileSync("src/app/api/website/route.ts", "utf8");
  assert.match(publicLoader, /\.eq\("module", "gallery"\)[\s\S]*?\.order\("sort_order", \{ ascending: true \}\)\s*\.order\("record_key", \{ ascending: true \}\)/);
  assert.match(publicLoader, /\.eq\("module", "gallery_collection"\)[\s\S]*?\.order\("sort_order", \{ ascending: true \}\)\s*\.order\("record_key", \{ ascending: true \}\)/);
  assert.match(adminRoute, /\.eq\("module", "gallery"\)\.order\("sort_order", \{ ascending: true \}\)\.order\("record_key", \{ ascending: true \}\)/);
  assert.match(adminRoute, /\.eq\("module", "gallery_collection"\)\.order\("sort_order", \{ ascending: true \}\)\.order\("record_key", \{ ascending: true \}\)/);
  assert.match(publicRoute, /\.eq\("module", "gallery"\)[\s\S]*?\.order\("sort_order", \{ ascending: true \}\)\.order\("record_key", \{ ascending: true \}\)/);
  const publicGallery = readFileSync("src/components/gallery.tsx", "utf8");
  assert.match(publicGallery, /\{ id: "all", name: "All" \},[\s\S]*?source\.collections\.map/);
  assert.match(publicGallery, /source\.collections\.map\(\(collection\) => \(/);
  assert.match(publicLoader, /\.eq\("module", "gallery_collection"\)[\s\S]*?\.eq\("published", true\)[\s\S]*?\.order\("sort_order", \{ ascending: true \}\)/);
  assert.match(manager, /moveGalleryImageRelative\(\{ placements, mediaId, targetMediaId, after \}\)/);
});

test("hiding a category or an image is a saveable change that keeps the image", () => {
  assert.equal(
    galleryWorkspaceError(
      [collection({ visible: false })],
      [placement({ visible: false, collectionKey: "" })],
    ),
    "",
  );
});

/* -------------------------------------------------------------------------- */
/* Database migration and RPC                                                 */
/* -------------------------------------------------------------------------- */

const MIGRATIONS_DIR = "supabase/migrations";
const PRELUDE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
`;

type SavedRow = {
  key: string;
  payload: Record<string, string>;
  published: boolean;
  sort_order: number;
  version: number;
};

let db: PGlite;
let actor: string;

before(async () => {
  db = new PGlite();
  await db.exec(PRELUDE);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`migration failed: ${file}: ${(error as Error).message}`);
    }
  }
  actor = randomUUID();
  await db.query(
    "INSERT INTO auth.users(id,email) VALUES($1,'gallery-collections-admin@example.test')",
    [actor],
  );
  await db.query(
    "INSERT INTO public.admin_profiles(user_id,role,display_name) VALUES($1,'full_admin','Gallery Collections Test Admin')",
    [actor],
  );
});

after(async () => {
  await db.close();
});

async function reset() {
  await db.query(
    "DELETE FROM public.website_content WHERE module IN ('gallery','gallery_collection')",
  );
}

async function createMedia(archived = false): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.website_gallery_media
      (id,storage_path,public_url,name,alt,source,permission,archived)
     VALUES ($1,$2,$3,$4,'Collection test image','Test fixture','Test permission',$5)`,
    [id, `media/${id}.webp`, `https://example.test/${id}.webp`, `${id}.webp`, archived],
  );
  return id;
}

type CollectionItem = {
  key: string;
  payload: { name: string; description: string };
  published: boolean;
  sort_order: number;
};

type PlacementItem = {
  key: string;
  payload: { media_id: string; alt: string; caption: string; collection_key: string };
  published: boolean;
  sort_order: number;
};

const collectionItem = (
  key: string,
  name: string,
  published = true,
  sortOrder = 1,
  description = "",
): CollectionItem => ({
  key,
  payload: { name, description },
  published,
  sort_order: sortOrder,
});

const placementItem = (
  key: string,
  mediaId: string,
  collectionKey = "",
  published = true,
  sortOrder = 1,
): PlacementItem => ({
  key,
  payload: {
    media_id: mediaId,
    alt: `Alt ${key}`,
    caption: "",
    collection_key: collectionKey,
  },
  published,
  sort_order: sortOrder,
});

const asCollectionItems = (rows: SavedRow[]): CollectionItem[] =>
  rows.map((row) => ({
    key: row.key,
    payload: {
      name: String(row.payload.name ?? ""),
      description: String(row.payload.description ?? ""),
    },
    published: row.published,
    sort_order: row.sort_order,
  }));

const asPlacementItems = (rows: SavedRow[]): PlacementItem[] =>
  rows.map((row) => ({
    key: row.key,
    payload: {
      media_id: String(row.payload.media_id ?? ""),
      alt: String(row.payload.alt ?? ""),
      caption: String(row.payload.caption ?? ""),
      collection_key: String(row.payload.collection_key ?? ""),
    },
    published: row.published,
    sort_order: row.sort_order,
  }));

async function saveWorkspace(input: {
  collections: CollectionItem[];
  collectionVersions?: Record<string, number>;
  placements: PlacementItem[];
  placementVersions?: Record<string, number>;
}): Promise<{ collections: SavedRow[]; placements: SavedRow[] }> {
  const { rows } = await db.query<{
    result: { collections: SavedRow[]; placements: SavedRow[] };
  }>(
    "SELECT public.website_gallery_save($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) AS result",
    [
      actor,
      JSON.stringify(input.collections),
      JSON.stringify(input.collectionVersions ?? {}),
      JSON.stringify(input.placements),
      JSON.stringify(input.placementVersions ?? {}),
    ],
  );
  return rows[0].result;
}

async function rejectsWith(
  promise: Promise<unknown>,
  code: string,
  pattern: RegExp,
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.match((error as Error).message, pattern);
    assert.equal((error as { code?: string }).code, code);
    return true;
  });
}

const versionsOf = (rows: SavedRow[]) =>
  Object.fromEntries(rows.map((row) => [row.key, row.version]));

test("initial collections are seeded and existing placements stay unassigned", async () => {
  const { rows } = await db.query<{ record_key: string; published: boolean }>(
    "SELECT record_key,published FROM public.website_content WHERE module='gallery_collection' ORDER BY sort_order, record_key",
  );
  assert.deepEqual(
    rows.map((row) => row.record_key),
    ["laundry", "garment-care", "shoe-care", "behind-the-scenes", "others"],
  );
  assert.ok(rows.every((row) => row.published));

  // The five pre-existing placements keep their rows, order and publication
  // state; none of them was assigned to a fabricated collection.
  const { rows: placements } = await db.query<{
    record_key: string;
    payload: Record<string, unknown>;
  }>(
    "SELECT record_key,payload FROM public.website_content WHERE module='gallery' ORDER BY sort_order",
  );
  assert.ok(placements.length >= 5);
  assert.ok(
    placements.every((row) => (row.payload.collection_key ?? "") === ""),
  );
});

test("workspace save creates, assigns, reorders and unassigns without deleting media", async () => {
  await reset();
  const mediaA = await createMedia();
  const mediaB = await createMedia();

  let saved = await saveWorkspace({
    collections: [
      collectionItem("laundry", "Laundry", true, 1),
      collectionItem("shoe-care", "Shoe Care", true, 2),
    ],
    placements: [
      placementItem("placement-a", mediaA, "laundry", true, 1),
      placementItem("placement-b", mediaB, "shoe-care", true, 2),
    ],
  });
  assert.deepEqual(saved.collections.map((row) => row.key), ["laundry", "shoe-care"]);
  assert.deepEqual(saved.collections.map((row) => row.version), [1, 1]);
  assert.deepEqual(saved.placements.map((row) => row.version), [1, 1]);
  assert.equal(saved.placements[0].payload.collection_key, "laundry");
  assert.equal(saved.placements[1].payload.collection_key, "shoe-care");

  // One image may belong to several collections: a second placement of mediaA.
  saved = await saveWorkspace({
    collections: asCollectionItems(saved.collections),
    collectionVersions: versionsOf(saved.collections),
    placements: [
      ...asPlacementItems(saved.placements),
      placementItem("placement-c", mediaA, "shoe-care", true, 3),
    ],
    placementVersions: versionsOf(saved.placements),
  });
  assert.equal(
    saved.placements.filter((row) => row.payload.media_id === mediaA).length,
    2,
  );

  // Duplicate prevention inside one collection.
  await rejectsWith(
    saveWorkspace({
      collections: asCollectionItems(saved.collections),
      collectionVersions: versionsOf(saved.collections),
      placements: [
        ...asPlacementItems(saved.placements),
        placementItem("placement-d", mediaA, "laundry", true, 4),
      ],
      placementVersions: { ...versionsOf(saved.placements), "placement-d": 0 },
    }),
    "22023",
    /CONTENT_DUPLICATE_PLACEMENT/,
  );

  // Reorder collections and images; versions advance together.
  saved = await saveWorkspace({
    collections: [
      collectionItem("shoe-care", "Shoe Care", true, 2),
      collectionItem("laundry", "Laundry", true, 1),
    ],
    collectionVersions: versionsOf(saved.collections),
    placements: [
      placementItem("placement-c", mediaA, "shoe-care", true, 3),
      placementItem("placement-b", mediaB, "shoe-care", true, 2),
      placementItem("placement-a", mediaA, "laundry", false, 1),
    ],
    placementVersions: versionsOf(saved.placements),
  });
  assert.deepEqual(saved.collections.map((row) => row.key), ["laundry", "shoe-care"]);
  // Every workspace save rewrites each retained row, so versions advanced once
  // for the first save and once for the multi-assignment save.
  assert.deepEqual(saved.collections.map((row) => row.version), [3, 3]);
  assert.equal(
    saved.placements.find((row) => row.key === "placement-a")?.published,
    false,
  );

  // Unpublish a collection: the row and its images survive.
  saved = await saveWorkspace({
    collections: [
      collectionItem("laundry", "Laundry", false, 1),
      collectionItem("shoe-care", "Shoe Care", true, 2),
    ],
    collectionVersions: versionsOf(saved.collections),
    placements: asPlacementItems(saved.placements),
    placementVersions: versionsOf(saved.placements),
  });
  assert.equal(
    saved.collections.find((row) => row.key === "laundry")?.published,
    false,
  );
  assert.equal(saved.placements.length, 3);

  // Unassigning never removes the underlying media asset.
  saved = await saveWorkspace({
    collections: asCollectionItems(saved.collections),
    collectionVersions: versionsOf(saved.collections),
    placements: [
      placementItem("placement-c", mediaA, "shoe-care", true, 3),
      placementItem("placement-b", mediaB, "shoe-care", true, 2),
    ],
    placementVersions: versionsOf(saved.placements),
  });
  assert.deepEqual(saved.placements.map((row) => row.key), ["placement-b", "placement-c"]);
  const { rows: mediaRows } = await db.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM public.website_gallery_media WHERE id = ANY($1::uuid[])",
    [[mediaA, mediaB]],
  );
  assert.equal(mediaRows[0].count, 2);
});

test("workspace save rejects stale versions, unknown collections and archived media", async () => {
  await reset();
  const mediaA = await createMedia();
  const mediaB = await createMedia();
  const saved = await saveWorkspace({
    collections: [
      collectionItem("laundry", "Laundry", true, 1),
      collectionItem("others", "Others", true, 2),
    ],
    placements: [
      placementItem("placement-a", mediaA, "laundry", true, 1),
      placementItem("placement-b", mediaB, "", true, 2),
    ],
  });

  await rejectsWith(
    saveWorkspace({
      collections: asCollectionItems(saved.collections),
      collectionVersions: { laundry: 99, others: 99 },
      placements: asPlacementItems(saved.placements),
      placementVersions: versionsOf(saved.placements),
    }),
    "PT409",
    /CONTENT_CONFLICT/,
  );

  await rejectsWith(
    saveWorkspace({
      collections: asCollectionItems(saved.collections),
      collectionVersions: versionsOf(saved.collections),
      placements: [
        placementItem("placement-a", mediaA, "missing", true, 1),
        placementItem("placement-b", mediaB, "", true, 2),
      ],
      placementVersions: versionsOf(saved.placements),
    }),
    "22023",
    /CONTENT_INVALID/,
  );

  // Deleting a collection that still holds an image is rejected.
  await rejectsWith(
    saveWorkspace({
      collections: [collectionItem("others", "Others", true, 2)],
      collectionVersions: versionsOf(saved.collections),
      placements: asPlacementItems(saved.placements),
      placementVersions: versionsOf(saved.placements),
    }),
    "22023",
    /CONTENT_INVALID/,
  );

  // An empty collection may be deleted.
  const removed = await saveWorkspace({
    collections: [collectionItem("laundry", "Laundry", true, 1)],
    collectionVersions: versionsOf(saved.collections),
    placements: asPlacementItems(saved.placements),
    placementVersions: versionsOf(saved.placements),
  });
  assert.deepEqual(removed.collections.map((row) => row.key), ["laundry"]);

  // New placements cannot attach archived media...
  const archived = await createMedia(true);
  await rejectsWith(
    saveWorkspace({
      collections: asCollectionItems(removed.collections),
      collectionVersions: versionsOf(removed.collections),
      placements: [
        ...asPlacementItems(removed.placements),
        placementItem("placement-archived", archived, "laundry", true, 3),
      ],
      placementVersions: { ...versionsOf(removed.placements), "placement-archived": 0 },
    }),
    "22023",
    /CONTENT_INVALID/,
  );

  // ...but an archived asset already placed may be kept, reordered or hidden.
  await db.query("UPDATE public.website_gallery_media SET archived = true WHERE id = $1", [
    mediaA,
  ]);
  const kept = await saveWorkspace({
    collections: asCollectionItems(removed.collections),
    collectionVersions: versionsOf(removed.collections),
    placements: asPlacementItems(removed.placements).map((row) => ({
      ...row,
      published: row.key !== "placement-a",
    })),
    placementVersions: versionsOf(removed.placements),
  });
  assert.equal(
    kept.placements.find((row) => row.key === "placement-a")?.published,
    false,
  );
});

test("workspace save requires an active full administrator", async () => {
  await reset();
  const outsider = randomUUID();
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
    outsider,
    "not-an-admin@example.test",
  ]);
  await assert.rejects(
    db.query(
      "SELECT public.website_gallery_save($1::uuid,'[]'::jsonb,'{}'::jsonb,'[]'::jsonb,'{}'::jsonb) AS result",
      [outsider],
    ),
    (error: unknown) => {
      assert.match((error as Error).message, /CONTENT_FORBIDDEN/);
      return true;
    },
  );
  await assert.rejects(
    db.query(
      "SELECT public.website_gallery_collection_reorder($1::uuid,'[]'::jsonb) AS result",
      [outsider],
    ),
    (error: unknown) => {
      assert.match((error as Error).message, /CONTENT_FORBIDDEN/);
      return true;
    },
  );
});

/* -------------------------------------------------------------------------- */
/* Category-only reorder RPC                                                 */
/* -------------------------------------------------------------------------- */

async function reorderCategories(
  items: Array<{ key: string; version: number }>,
): Promise<SavedRow[]> {
  const { rows } = await db.query<{ result: SavedRow[] }>(
    "SELECT public.website_gallery_collection_reorder($1::uuid,$2::jsonb) AS result",
    [
      actor,
      JSON.stringify(
        items.map((item, index) => ({ ...item, sort_order: index + 1 })),
      ),
    ],
  );
  return rows[0].result;
}

test("category reorder persists order atomically without touching content or images", async () => {
  await reset();
  const media = await createMedia();
  const seeded = await saveWorkspace({
    collections: [
      collectionItem("laundry", "Laundry", true, 1),
      collectionItem("garment-care", "Garment Care", true, 2, "Specialist care"),
      collectionItem("shoe-care", "Shoe Care", false, 3, "Footwear care"),
      collectionItem("others", "Others", true, 4),
    ],
    placements: [
      placementItem("placement-laundry", media, "laundry", true, 1),
      placementItem("placement-garment", media, "garment-care", true, 2),
      placementItem("placement-shoe", media, "shoe-care", false, 3),
    ],
  });
  const before = new Map(seeded.collections.map((row) => [row.key, row]));

  // Move Garment Care from position 2 to position 1.
  const moved = await reorderCategories([
    { key: "garment-care", version: before.get("garment-care")!.version },
    { key: "laundry", version: before.get("laundry")!.version },
    { key: "shoe-care", version: before.get("shoe-care")!.version },
    { key: "others", version: before.get("others")!.version },
  ]);

  assert.deepEqual(
    moved.map((row) => row.key),
    ["garment-care", "laundry", "shoe-care", "others"],
  );
  assert.deepEqual(moved.map((row) => row.sort_order), [1, 2, 3, 4]);
  // Versions advance by exactly one and everything except the position is kept.
  for (const row of moved) {
    const previous = before.get(row.key)!;
    assert.equal(row.version, previous.version + 1);
    assert.deepEqual(row.payload, previous.payload);
    assert.equal(row.published, previous.published);
  }
  assert.equal(moved[2].published, false);
  assert.equal(moved[0].payload.description, "Specialist care");
  assert.equal(moved[2].payload.description, "Footwear care");

  // A direct read returns the same deterministic order.
  const { rows: stored } = await db.query<{ record_key: string }>(
    "SELECT record_key FROM public.website_content WHERE module='gallery_collection' ORDER BY sort_order, record_key",
  );
  assert.deepEqual(
    stored.map((row) => row.record_key),
    ["garment-care", "laundry", "shoe-care", "others"],
  );

  // The public query (published only, same ORDER BY) sees the new order too.
  const { rows: publicOrder } = await db.query<{ record_key: string }>(
    "SELECT record_key FROM public.website_content WHERE module='gallery_collection' AND published=true ORDER BY sort_order, record_key",
  );
  assert.deepEqual(
    publicOrder.map((row) => row.record_key),
    ["garment-care", "laundry", "others"],
  );

  // Image assignments survive the category-only reorder.
  const { rows: placements } = await db.query<{
    record_key: string;
    payload: Record<string, unknown>;
    published: boolean;
  }>(
    "SELECT record_key,payload,published FROM public.website_content WHERE module='gallery' ORDER BY sort_order",
  );
  assert.deepEqual(
    placements.map((row) => row.payload.collection_key),
    ["laundry", "garment-care", "shoe-care"],
  );
  assert.equal(placements[2].published, false);

  // The returned version is now the current baseline, so a stale one is rejected.
  await rejectsWith(
    reorderCategories([
      { key: "laundry", version: before.get("laundry")!.version },
      { key: "garment-care", version: before.get("garment-care")!.version },
      { key: "shoe-care", version: before.get("shoe-care")!.version },
      { key: "others", version: before.get("others")!.version },
    ]),
    "PT409",
    /CONTENT_CONFLICT/,
  );
});

test("category reorder rejects incomplete, duplicated, unknown and mispositioned lists", async () => {
  await reset();
  const saved = await saveWorkspace({
    collections: [
      collectionItem("laundry", "Laundry", true, 1),
      collectionItem("garment-care", "Garment Care", true, 2),
    ],
    placements: [],
  });
  const versions = versionsOf(saved.collections);

  // A partial list cannot drop categories that still exist.
  await rejectsWith(
    reorderCategories([{ key: "laundry", version: versions.laundry }]),
    "PT409",
    /CONTENT_CONFLICT/,
  );

  // Duplicate keys are rejected even when every version is current.
  await rejectsWith(
    reorderCategories([
      { key: "laundry", version: versions.laundry },
      { key: "laundry", version: versions.laundry },
    ]),
    "PT409",
    /CONTENT_CONFLICT/,
  );

  // Unknown keys are rejected.
  await rejectsWith(
    reorderCategories([
      { key: "laundry", version: versions.laundry },
      { key: "missing", version: 1 },
    ]),
    "PT409",
    /CONTENT_CONFLICT/,
  );

  // sort_order must match the submitted position.
  await rejectsWith(
    db.query(
      "SELECT public.website_gallery_collection_reorder($1::uuid,$2::jsonb) AS result",
      [
        actor,
        JSON.stringify([
          { key: "laundry", version: versions.laundry, sort_order: 2 },
          { key: "garment-care", version: versions["garment-care"], sort_order: 1 },
        ]),
      ],
    ),
    "PT409",
    /CONTENT_CONFLICT/,
  );

  // The untouched collection keeps its original order and version.
  const { rows: stored } = await db.query<{ record_key: string; version: number }>(
    "SELECT record_key,version FROM public.website_content WHERE module='gallery_collection' ORDER BY sort_order, record_key",
  );
  assert.deepEqual(stored.map((row) => row.record_key), ["laundry", "garment-care"]);
  assert.deepEqual(stored.map((row) => row.version), [1, 1]);
});

test("reorder rejects unsafe version and position values without casting errors", async () => {
  await reset();
  const saved = await saveWorkspace({
    collections: [
      collectionItem("laundry", "Laundry", true, 1),
      collectionItem("garment-care", "Garment Care", true, 2),
    ],
    placements: [],
  });
  const versions = versionsOf(saved.collections);
  const raw = (items: unknown) =>
    db.query(
      "SELECT public.website_gallery_collection_reorder($1::uuid,$2::jsonb) AS result",
      [actor, JSON.stringify(items)],
    );

  // Every one of these would raise 22P02/22003 if the function cast before
  // validating; they must be reported as an ordinary conflict instead.
  for (const items of [
    [
      { key: "laundry", version: "1e3", sort_order: 1 },
      { key: "garment-care", version: versions["garment-care"], sort_order: 2 },
    ],
    [
      { key: "laundry", version: versions.laundry, sort_order: "abc" },
      { key: "garment-care", version: versions["garment-care"], sort_order: 2 },
    ],
    [
      { key: "laundry", version: "999999999999", sort_order: 1 },
      { key: "garment-care", version: versions["garment-care"], sort_order: 2 },
    ],
    [
      { key: "laundry", version: "999999999", sort_order: 1 },
      { key: "garment-care", version: versions["garment-care"], sort_order: 2 },
    ],
    [
      { key: "laundry", version: versions.laundry, sort_order: 999999999999 },
      { key: "garment-care", version: versions["garment-care"], sort_order: 2 },
    ],
  ]) {
    await rejectsWith(raw(items), "PT409", /CONTENT_CONFLICT/);
  }
});

test("category reorder is security definer and executable only by the trusted role", async () => {
  const { rows: grants } = await db.query<{
    anon: boolean;
    authenticated: boolean;
    service: boolean;
  }>(
    `SELECT
       has_function_privilege('anon', 'public.website_gallery_collection_reorder(uuid,jsonb)', 'EXECUTE') AS anon,
       has_function_privilege('authenticated', 'public.website_gallery_collection_reorder(uuid,jsonb)', 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', 'public.website_gallery_collection_reorder(uuid,jsonb)', 'EXECUTE') AS service`,
  );
  assert.deepEqual(grants[0], {
    anon: false,
    authenticated: false,
    service: true,
  });

  const { rows: definition } = await db.query<{
    prosecdef: boolean;
    proconfig: string[] | null;
  }>(
    "SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'website_gallery_collection_reorder'",
  );
  assert.equal(definition[0].prosecdef, true);
  assert.ok(
    definition[0].proconfig?.some((setting) =>
      setting.replace(/\s/g, "").startsWith("search_path="),
    ),
  );
});
