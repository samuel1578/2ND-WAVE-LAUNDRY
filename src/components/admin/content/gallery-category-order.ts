import type { GalleryCollection } from "@/lib/contracts";
import {
  moveGalleryCategory,
  moveGalleryCategoryRelative,
  mergeGalleryCategoryOrder,
  mergeGalleryCategoryOrderRpcRows,
  orderGalleryCategoriesForSave,
} from "@/lib/website/gallery-category-order";
import { saveGalleryCategoryOrder } from "@/lib/mock-store";
import { saveLiveGalleryCategoryOrder } from "@/lib/website/actions";
import { demoMode } from "@/lib/demo-mode";

export { moveGalleryCategory, moveGalleryCategoryRelative };

/**
 * Persists a category order immediately and returns the confirmed categories.
 *
 * The save response is merged into the categories already loaded by the Gallery
 * manager. It never replaces them, so thumbnails, image counts, descriptions and
 * any other manager metadata survive a reorder. Both the demo and live paths use
 * the same merge and the same version baseline.
 */
export async function persistGalleryCategoryOrder(input: {
  ordered: GalleryCollection[];
  confirmed: GalleryCollection[];
}): Promise<GalleryCollection[]> {
  const normalized = orderGalleryCategoriesForSave(input.ordered, input.confirmed);
  const items = normalized.map(({ id, version }) => ({ id, version }));
  if (demoMode) {
    const saved = await saveGalleryCategoryOrder(items);
    return mergeGalleryCategoryOrder(normalized, saved);
  }
  const rows = await saveLiveGalleryCategoryOrder(items);
  return mergeGalleryCategoryOrderRpcRows(normalized, rows);
}
