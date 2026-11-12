import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  GALLERY_CATEGORY_ORDER_CONFLICT,
  GALLERY_CATEGORY_ORDER_INVALID,
  type GalleryCategoryOrderRow,
} from "./gallery-category-order";

type SupabaseError = { code?: string; message?: string };

const UNABLE_TO_SAVE = "Unable to save. Please try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isRpcCategory(row: unknown): row is GalleryCategoryOrderRow {
  if (!isRecord(row) || !isRecord(row.payload)) return false;
  return (
    typeof row.key === "string" &&
    row.key.length > 0 &&
    typeof row.published === "boolean" &&
    Number.isSafeInteger(row.sort_order) &&
    Number.isSafeInteger(row.version) &&
    Number(row.version) > 0
  );
}

/**
 * Calls the dedicated category-order RPC through the elevated server client
 * (`createSupabaseAdminClient`, i.e. the service role) and returns the confirmed
 * stored rows. The client merges these into the categories it already holds so
 * local metadata such as image counts is never replaced by this response.
 */
export async function saveLiveGalleryCategoryOrder(
  actor: string,
  items: Array<{ id: string; version: number }>,
): Promise<GalleryCategoryOrderRow[]> {
  try {
    const client = createSupabaseAdminClient();
    const { data, error } = await client.rpc("website_gallery_collection_reorder", {
      p_actor: actor,
      p_items: items.map((item, index) => ({
        key: item.id,
        version: item.version,
        sort_order: index + 1,
      })),
    });
    if (error) {
      const rpcError = error as SupabaseError;
      if (rpcError.code === "PT409" || rpcError.code === "40001")
        throw new Error(GALLERY_CATEGORY_ORDER_CONFLICT);
      if (rpcError.code === "55P03")
        throw new Error("Another Gallery save is finishing. Please try again.");
      console.error("Gallery category reorder failed.", {
        code: rpcError.code ?? null,
        message: rpcError.message ?? "Unknown error",
      });
      throw new Error(UNABLE_TO_SAVE);
    }
    if (
      !Array.isArray(data) ||
      data.length !== items.length ||
      !data.every(isRpcCategory)
    ) {
      throw new Error(UNABLE_TO_SAVE);
    }
    const rows = data as GalleryCategoryOrderRow[];
    const expected = new Set(items.map((item) => item.id));
    if (
      rows.some((row) => !expected.has(row.key)) ||
      new Set(rows.map((row) => row.key)).size !== rows.length
    ) {
      throw new Error(GALLERY_CATEGORY_ORDER_CONFLICT);
    }
    return rows;
  } catch (cause) {
    const message = (cause as Error)?.message;
    if (
      message === GALLERY_CATEGORY_ORDER_CONFLICT ||
      message === GALLERY_CATEGORY_ORDER_INVALID ||
      message === "Another Gallery save is finishing. Please try again." ||
      message === UNABLE_TO_SAVE
    ) {
      throw cause;
    }
    console.error("Gallery category reorder failed.", cause);
    throw new Error(UNABLE_TO_SAVE);
  }
}
