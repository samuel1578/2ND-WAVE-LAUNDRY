import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { GalleryCollection, GalleryPlacement } from "@/lib/contracts";
import { galleryWorkspaceError } from "./gallery-collections";

/**
 * Atomic gallery workspace persistence.
 *
 * Collections and placements are written by one validated database function so a
 * saved collection can never end up referencing placements that failed to save.
 * The RPC re-validates media state, collection references and optimistic
 * versions; nothing from the client is trusted here.
 */
export type GalleryWorkspaceSnapshot = {
  collections: GalleryCollection[];
  placements: GalleryPlacement[];
};

export type GalleryWorkspaceWrite = {
  collections: GalleryCollection[];
  placements: GalleryPlacement[];
  previousCollectionVersions?: Record<string, number>;
  previousPlacementVersions?: Record<string, number>;
};

class GalleryWriteFailure extends Error {}

type GallerySupabaseError = {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

type RpcWorkspaceRow = {
  key: string;
  payload: Record<string, unknown>;
  published: boolean;
  sort_order: number;
  version: number;
};

type RpcWorkspaceResult = {
  collections?: RpcWorkspaceRow[];
  placements?: RpcWorkspaceRow[];
};

function logGalleryError(stage: string, value: unknown): void {
  const error =
    value && typeof value === "object"
      ? (value as GallerySupabaseError)
      : { message: String(value) };
  console.error("Gallery save failed.", {
    stage,
    message: error.message ?? "Unknown error",
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  });
}

const isConflict = (error?: GallerySupabaseError | null) =>
  error?.code === "PT409" || error?.code === "40001";

const isBusy = (error?: GallerySupabaseError | null) => error?.code === "55P03";

const asVersionMap = (
  value: Record<string, number> | undefined,
  stage: string,
): Record<string, number> => {
  const map: Record<string, number> = {};
  for (const [id, version] of Object.entries(value ?? {})) {
    if (!id || !Number.isSafeInteger(version) || version < 0) {
      logGalleryError(stage, new Error("Invalid expected version map."));
      throw new GalleryWriteFailure(
        "Gallery version data is invalid. Reload and try again.",
      );
    }
    map[id] = version;
  }
  return map;
};

export async function writeGalleryWorkspace(
  actor: string,
  input: GalleryWorkspaceWrite,
): Promise<GalleryWorkspaceSnapshot> {
  try {
    const validation = galleryWorkspaceError(input.collections, input.placements);
    if (validation) throw new GalleryWriteFailure(validation);

    const collections = [...input.collections]
      .sort((a, b) => a.order - b.order)
      .map((collection, index) => ({
        ...collection,
        id: collection.id.trim(),
        name: collection.name.trim(),
        description: (collection.description ?? "").trim(),
        order: index + 1,
      }));
    const placements = [...input.placements]
      .sort((a, b) => a.order - b.order)
      .map((placement, index) => ({
        ...placement,
        alt: placement.alt.trim(),
        caption: placement.caption ?? "",
        collectionKey: (placement.collectionKey ?? "").trim(),
        order: index + 1,
      }));

    const client = createSupabaseAdminClient();

    // An archived asset may stay where it already is, but it cannot be attached
    // to a new placement or moved to another collection.
    const { data: currentRows, error: currentError } = await client
      .from("website_content")
      .select("record_key,payload")
      .eq("module", "gallery");
    if (currentError || !Array.isArray(currentRows)) {
      logGalleryError("existing placement validation", currentError);
      throw new GalleryWriteFailure(
        "Existing gallery placements could not be verified. Reload and try again.",
      );
    }
    const existingPlacement = new Map(
      currentRows.map((row) => [
        row.record_key,
        {
          mediaId: String(row.payload?.media_id ?? ""),
          collectionKey: String(row.payload?.collection_key ?? ""),
        },
      ]),
    );

    const mediaIds = [...new Set(placements.map((item) => item.mediaId))];
    const archivedById = new Map<string, boolean>();
    if (mediaIds.length) {
      const { data, error } = await client
        .from("website_gallery_media")
        .select("id,archived")
        .in("id", mediaIds);
      if (error || !Array.isArray(data)) {
        logGalleryError("mediaId validation", error);
        throw new GalleryWriteFailure(
          "Media Library assets could not be verified. Reload and try again.",
        );
      }
      for (const asset of data) archivedById.set(asset.id, asset.archived);
      if (mediaIds.some((id) => !archivedById.has(id))) {
        throw new GalleryWriteFailure(
          "A selected Media Library asset no longer exists. Refresh the gallery and try again.",
        );
      }
      const newlyAttachedArchived = placements.some((item) => {
        if (archivedById.get(item.mediaId) !== true) return false;
        const previous = existingPlacement.get(item.id);
        return (
          !previous ||
          previous.mediaId !== item.mediaId ||
          previous.collectionKey !== item.collectionKey
        );
      });
      if (newlyAttachedArchived) {
        throw new GalleryWriteFailure(
          "Archived media cannot be newly added to a collection. Choose an active Media Library asset.",
        );
      }
    }

    const expectedCollections = asVersionMap(
      input.previousCollectionVersions,
      "collection versions",
    );
    for (const collection of collections)
      expectedCollections[collection.id] = collection.version;

    const expectedPlacements = asVersionMap(
      input.previousPlacementVersions,
      "placement versions",
    );
    for (const placement of placements)
      expectedPlacements[placement.id] = placement.version;

    const { data, error } = await client.rpc("website_gallery_save", {
      p_actor: actor,
      p_collections: collections.map((collection, index) => ({
        key: collection.id,
        payload: {
          name: collection.name,
          description: collection.description,
        },
        published: collection.visible,
        sort_order: index + 1,
      })),
      p_collection_versions: expectedCollections,
      p_placements: placements.map((placement, index) => ({
        key: placement.id,
        payload: {
          media_id: placement.mediaId,
          alt: placement.alt,
          caption: placement.caption,
          collection_key: placement.collectionKey,
        },
        published: placement.visible,
        sort_order: index + 1,
      })),
      p_placement_versions: expectedPlacements,
    });

    if (error) {
      logGalleryError("website_gallery_save RPC", error);
      if (isConflict(error))
        throw new GalleryWriteFailure(
          "Gallery changed while editing. Reload the latest gallery and try again.",
        );
      if (isBusy(error))
        throw new GalleryWriteFailure(
          "Another gallery save is still finishing. Wait a few seconds and retry.",
        );
      throw new GalleryWriteFailure(
        "Gallery could not be saved. Please retry; if the issue continues, contact support.",
      );
    }

    const result = (data ?? {}) as RpcWorkspaceResult;
    if (!Array.isArray(result.collections) || !Array.isArray(result.placements))
      throw new Error("Gallery save RPC returned an invalid response.");

    return {
      collections: result.collections.map((row) => ({
        id: row.key,
        name: String(row.payload?.name ?? ""),
        description: String(row.payload?.description ?? ""),
        order: Number(row.sort_order),
        visible: row.published === true,
        version: Number(row.version),
      })),
      placements: result.placements.map((row) => ({
        id: row.key,
        mediaId: String(row.payload?.media_id ?? ""),
        alt: String(row.payload?.alt ?? ""),
        caption: String(row.payload?.caption ?? ""),
        collectionKey: String(row.payload?.collection_key ?? ""),
        order: Number(row.sort_order),
        visible: row.published === true,
        version: Number(row.version),
      })),
    };
  } catch (error) {
    if (error instanceof GalleryWriteFailure) throw error;
    logGalleryError("unexpected writeGalleryWorkspace failure", error);
    throw new Error(
      "Gallery could not be saved. Please retry; if the issue continues, contact support.",
    );
  }
}
