import type { GalleryCollection, GalleryPlacement } from "@/lib/contracts";

/**
 * Shared gallery collection rules.
 *
 * Used by the admin workspace, the server action/repository boundary and the
 * demo store so a collection is validated the same way in every environment.
 * The database RPC enforces the same shape again; nothing here is trusted alone.
 */
export const GALLERY_COLLECTION_LIMITS = {
  name: 80,
  description: 300,
  slug: 80,
  collections: 100,
  placements: 500,
} as const;

export const GALLERY_COLLECTION_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Stable, URL-safe identifier derived from a display name. */
export function normalizeGallerySlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, GALLERY_COLLECTION_LIMITS.slug)
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

export function galleryCollectionError(
  collection: GalleryCollection,
  all: GalleryCollection[],
): string {
  const name = collection.name.trim();
  if (!name) return "Every collection needs a name.";
  if (name.length > GALLERY_COLLECTION_LIMITS.name)
    return `Collection names must be ${GALLERY_COLLECTION_LIMITS.name} characters or fewer.`;
  if (collection.description.trim().length > GALLERY_COLLECTION_LIMITS.description)
    return `Collection descriptions must be ${GALLERY_COLLECTION_LIMITS.description} characters or fewer.`;
  const slug = collection.id.trim();
  if (!slug) return "Every collection needs a slug.";
  if (slug.length > GALLERY_COLLECTION_LIMITS.slug || !GALLERY_COLLECTION_SLUG.test(slug))
    return "Use a slug of lowercase letters, numbers and single hyphens, for example shoe-care.";
  if (all.filter((entry) => entry.id.trim() === slug).length > 1)
    return "Collection slugs must be unique.";
  if (!Number.isInteger(collection.order) || collection.order < 1)
    return "Use whole-number collection positions starting at 1.";
  return "";
}

export function galleryWorkspaceError(
  collections: GalleryCollection[],
  placements: GalleryPlacement[],
): string {
  if (collections.length > GALLERY_COLLECTION_LIMITS.collections)
    return `Use no more than ${GALLERY_COLLECTION_LIMITS.collections} collections.`;
  if (placements.length > GALLERY_COLLECTION_LIMITS.placements)
    return "The gallery is too large.";
  const keys = new Set<string>();
  for (const collection of collections) {
    const error = galleryCollectionError(collection, collections);
    if (error) return error;
    const slug = collection.id.trim();
    if (keys.has(slug)) return "Collection slugs must be unique.";
    keys.add(slug);
  }
  const signatures = new Set<string>();
  for (const placement of placements) {
    if (!placement.mediaId) return "Choose a media asset.";
    if (!placement.alt.trim()) return "Describe each image with alt text.";
    if (!Number.isInteger(placement.order) || placement.order < 1)
      return "Use whole-number display orders starting at 1.";
    const key = (placement.collectionKey ?? "").trim();
    if (key && !keys.has(key))
      return "Assign every image to an existing collection.";
    if (!key) continue;
    const signature = `${key}\u0000${placement.mediaId}`;
    if (signatures.has(signature))
      return "An image can only appear once in the same collection.";
    signatures.add(signature);
  }
  return "";
}

/** A collection still holding images cannot be deleted; nothing is re-assigned silently. */
export function galleryCollectionDeletionError(
  id: string,
  placements: GalleryPlacement[],
): string {
  const assigned = placements.filter(
    (placement) => (placement.collectionKey ?? "") === id,
  ).length;
  if (!assigned) return "";
  return `Move or remove the ${assigned} image${assigned === 1 ? "" : "s"} in this collection before deleting it.`;
}

/* -------------------------------------------------------------------------- */
/* Image-first admin workspace helpers                                        */
/* -------------------------------------------------------------------------- */

export const UNASSIGNED_CATEGORY_LABEL = "Needs a Category";

/** One gallery image, with every category placement it currently has. */
export type GalleryImageGroup = {
  mediaId: string;
  alt: string;
  caption: string;
  collectionKeys: string[];
  placements: GalleryPlacement[];
  visible: boolean;
  order: number;
};

/** Groups placements by media asset so the admin can start from images. */
export function groupGalleryImages(
  placements: GalleryPlacement[],
): GalleryImageGroup[] {
  const ordered = [...placements].sort((a, b) => a.order - b.order);
  const groups = new Map<string, GalleryImageGroup>();
  for (const placement of ordered) {
    const key = placement.collectionKey ?? "";
    const existing = groups.get(placement.mediaId);
    if (existing) {
      existing.placements.push(placement);
      if (key && !existing.collectionKeys.includes(key))
        existing.collectionKeys.push(key);
      existing.visible = existing.visible || placement.visible;
      if (!existing.alt) existing.alt = placement.alt;
      if (!existing.caption) existing.caption = placement.caption;
      continue;
    }
    groups.set(placement.mediaId, {
      mediaId: placement.mediaId,
      alt: placement.alt,
      caption: placement.caption,
      collectionKeys: key ? [key] : [],
      placements: [placement],
      visible: placement.visible,
      order: placement.order,
    });
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

/** Images that appear under "Needs a Category". */
export function unassignedGalleryImages(
  groups: GalleryImageGroup[],
): GalleryImageGroup[] {
  return groups.filter((group) => group.collectionKeys.length === 0);
}

/**
 * Generates a permanent, unique slug for a new category. Existing categories
 * keep the slug they were created with, so renaming never breaks a public link.
 */
export function nextCategorySlug(
  name: string,
  existing: GalleryCollection[],
): string {
  const taken = new Set(existing.map((category) => category.id));
  const base = normalizeGallerySlug(name) || "category";
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (true) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(
      0,
      GALLERY_COLLECTION_LIMITS.slug - suffixText.length,
    )}${suffixText}`;
    if (!taken.has(candidate)) return candidate;
    suffix += 1;
  }
}

/**
 * Assigns images to a category.
 *
 * A free (unassigned) placement is reused before a new one is created, and an
 * image already in the category is left alone. An image can therefore sit in
 * several categories, but never twice in the same one. Publication state, alt
 * text and caption are preserved.
 */
export function assignImagesToCategory(input: {
  placements: GalleryPlacement[];
  images: Array<{ mediaId: string; alt: string; caption: string }>;
  categoryKey: string;
  newId: () => string;
}): GalleryPlacement[] {
  const rows = [...input.placements]
    .sort((a, b) => a.order - b.order)
    .map((row) => ({ ...row }));
  for (const image of input.images) {
    if (
      rows.some(
        (row) =>
          row.mediaId === image.mediaId &&
          row.collectionKey === input.categoryKey,
      )
    ) {
      continue;
    }
    const unassigned = rows.find(
      (row) => row.mediaId === image.mediaId && !row.collectionKey,
    );
    if (unassigned) {
      unassigned.collectionKey = input.categoryKey;
      continue;
    }
    rows.push({
      id: input.newId(),
      mediaId: image.mediaId,
      alt: image.alt,
      caption: image.caption,
      order: rows.length + 1,
      visible: true,
      version: 0,
      collectionKey: input.categoryKey,
    });
  }
  return rows.map((row, index) => ({ ...row, order: index + 1 }));
}

/** Removes images from one category, keeping their other category placements. */
export function removeImagesFromCategory(input: {
  placements: GalleryPlacement[];
  mediaIds: string[];
  categoryKey: string;
}): GalleryPlacement[] {
  const remove = new Set(input.mediaIds);
  return [...input.placements]
    .sort((a, b) => a.order - b.order)
    .filter(
      (row) =>
        !(remove.has(row.mediaId) && row.collectionKey === input.categoryKey),
    )
    .map((row, index) => ({ ...row, order: index + 1 }));
}

/** Moves a deleted category's images to "Needs a Category"; nothing is removed. */
export function unassignCategory(
  placements: GalleryPlacement[],
  categoryKey: string,
): GalleryPlacement[] {
  return placements.map((row) =>
    row.collectionKey === categoryKey ? { ...row, collectionKey: "" } : row,
  );
}

/** Moves a whole image (all of its placements) up or down the gallery order. */
export function moveGalleryImage(input: {
  placements: GalleryPlacement[];
  mediaId: string;
  offset: number;
}): GalleryPlacement[] {
  const ordered = [...input.placements].sort((a, b) => a.order - b.order);
  const mediaOrder: string[] = [];
  const byMedia = new Map<string, GalleryPlacement[]>();
  for (const row of ordered) {
    if (!byMedia.has(row.mediaId)) {
      byMedia.set(row.mediaId, []);
      mediaOrder.push(row.mediaId);
    }
    byMedia.get(row.mediaId)!.push(row);
  }
  const index = mediaOrder.indexOf(input.mediaId);
  const target = index + input.offset;
  if (index < 0 || target < 0 || target >= mediaOrder.length)
    return input.placements;
  [mediaOrder[index], mediaOrder[target]] = [
    mediaOrder[target],
    mediaOrder[index],
  ];
  const reordered = mediaOrder.flatMap((mediaId) => byMedia.get(mediaId)!);
  return reordered.map((row, position) => ({ ...row, order: position + 1 }));
}
