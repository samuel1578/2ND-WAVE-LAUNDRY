import type { GalleryCollection } from "@/lib/contracts";
import { GALLERY_COLLECTION_SLUG } from "./gallery-collections";

export const GALLERY_CATEGORY_ORDER_CONFLICT =
  "Gallery categories changed in another session. Reload and try again.";
export const GALLERY_CATEGORY_ORDER_INVALID =
  "Gallery category order is invalid. Reload and try again.";

/** A `website_gallery_collection_reorder` row, before local metadata is merged. */
export type GalleryCategoryOrderRow = {
  key: string;
  payload: Record<string, unknown>;
  published: boolean;
  sort_order: number;
  version: number;
};

/** Stable ordering; `id` is the deterministic tie-breaker for equal positions. */
export function sortGalleryCategories(
  rows: GalleryCollection[],
): GalleryCollection[] {
  return [...rows].sort(
    (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function moveGalleryCategory(
  rows: GalleryCollection[],
  id: string,
  delta: number,
): GalleryCollection[] | null {
  const ordered = sortGalleryCategories(rows);
  const index = ordered.findIndex((category) => category.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ordered.length) return null;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered.map((category, position) => ({ ...category, order: position + 1 }));
}

export function moveGalleryCategoryRelative(
  rows: GalleryCollection[],
  id: string,
  targetId: string,
  after: boolean,
): GalleryCollection[] | null {
  const ordered = sortGalleryCategories(rows);
  const from = ordered.findIndex((category) => category.id === id);
  if (from < 0 || id === targetId) return null;
  const [moved] = ordered.splice(from, 1);
  const target = ordered.findIndex((category) => category.id === targetId);
  if (target < 0) return null;
  ordered.splice(target + (after ? 1 : 0), 0, moved);
  return ordered.map((category, position) => ({ ...category, order: position + 1 }));
}

export function galleryCategoryReorderError(
  ordered: GalleryCollection[],
  confirmed: GalleryCollection[],
): string {
  if (
    !ordered.length ||
    ordered.length !== confirmed.length ||
    new Set(ordered.map((category) => category.id)).size !== ordered.length ||
    new Set(confirmed.map((category) => category.id)).size !== confirmed.length
  ) return GALLERY_CATEGORY_ORDER_CONFLICT;
  // Syntax/version problems are reported as invalid before set membership, so
  // a malformed identifier cannot masquerade as an ordinary session conflict.
  for (const category of ordered) {
    if (
      !GALLERY_COLLECTION_SLUG.test(category.id) ||
      !Number.isSafeInteger(category.version) ||
      category.version < 1
    ) {
      return GALLERY_CATEGORY_ORDER_INVALID;
    }
  }
  const confirmedById = new Set(confirmed.map((category) => category.id));
  if (ordered.some((category) => !confirmedById.has(category.id)))
    return GALLERY_CATEGORY_ORDER_CONFLICT;
  return "";
}

/**
 * Normalises the submitted order to positions 1..N and takes versions from the
 * last confirmed snapshot, not from possibly stale optimistic objects.
 */
export function orderGalleryCategoriesForSave(
  ordered: GalleryCollection[],
  confirmed: GalleryCollection[],
): GalleryCollection[] {
  const error = galleryCategoryReorderError(ordered, confirmed);
  if (error) throw new Error(error);
  const versions = new Map(confirmed.map((category) => [category.id, category.version]));
  return sortGalleryCategories(ordered).map((category, index) => ({
    ...category,
    order: index + 1,
    version: versions.get(category.id) ?? category.version,
  }));
}

export function galleryCategoryOrderRpcItems(
  ordered: GalleryCollection[],
  confirmed: GalleryCollection[],
): Array<{ key: string; version: number; sort_order: number }> {
  return orderGalleryCategoriesForSave(ordered, confirmed).map((category, index) => ({
    key: category.id,
    version: category.version,
    sort_order: index + 1,
  }));
}

/** Maps one RPC row to the shape the Gallery manager understands. */
export function galleryCategoryFromOrderRow(
  row: GalleryCategoryOrderRow,
): GalleryCollection {
  return {
    id: row.key,
    name: String(row.payload?.name ?? ""),
    description: String(row.payload?.description ?? ""),
    order: Number(row.sort_order),
    visible: row.published === true,
    version: Number(row.version),
  };
}

/**
 * Applies the confirmed database order to the categories already loaded by the
 * Gallery manager.
 *
 * The RPC response only contains stored category fields. Replacing the local
 * objects with it would erase `imageCount` (and any other manager metadata), so
 * every saved record is merged onto its existing category. The whole current
 * collection must be present exactly once: a missing, duplicate or unknown key
 * is a conflict, never a silent removal.
 */
export function mergeGalleryCategoryOrder(
  current: GalleryCollection[],
  saved: GalleryCollection[],
): GalleryCollection[] {
  const currentById = new Map(current.map((category) => [category.id, category]));
  if (currentById.size !== current.length)
    throw new Error(GALLERY_CATEGORY_ORDER_CONFLICT);
  if (saved.length !== current.length)
    throw new Error(GALLERY_CATEGORY_ORDER_CONFLICT);

  const seen = new Set<string>();
  return saved.map((category, index) => {
    if (
      !category ||
      typeof category.id !== "string" ||
      seen.has(category.id)
    ) {
      throw new Error(GALLERY_CATEGORY_ORDER_CONFLICT);
    }
    const base = currentById.get(category.id);
    if (!base) throw new Error(GALLERY_CATEGORY_ORDER_CONFLICT);
    seen.add(category.id);
    if (!Number.isSafeInteger(category.version) || category.version < 1)
      throw new Error(GALLERY_CATEGORY_ORDER_INVALID);
    return {
      ...base,
      name: category.name || base.name,
      description: category.description || base.description,
      order: index + 1,
      visible: category.visible === true,
      version: category.version,
    };
  });
}

/** Merges raw RPC rows into the currently loaded category list. */
export function mergeGalleryCategoryOrderRpcRows(
  current: GalleryCollection[],
  rows: GalleryCategoryOrderRow[],
): GalleryCollection[] {
  if (!Array.isArray(rows)) throw new Error(GALLERY_CATEGORY_ORDER_INVALID);
  return mergeGalleryCategoryOrder(
    current,
    rows.map(galleryCategoryFromOrderRow),
  );
}
