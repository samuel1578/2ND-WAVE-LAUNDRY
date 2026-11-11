"use client";

import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { Empty, Picture } from "@/components/ui";
import { Submit, TextField } from "@/components/forms/controls";
import { GripVertical } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { UnsavedGuard } from "../unsaved";
import {
  getGallery,
  getGalleryCollections,
  saveGalleryWorkspace,
  useDemoStore,
} from "@/lib/mock-store";
import type { GalleryCollection, GalleryPlacement, MediaAsset } from "@/lib/contracts";
import { ModuleShell } from "./shared/module-shell";
import { MediaPicker } from "./shared/media-picker";
import styles from "./content.module.css";
import { demoMode } from "@/lib/demo-mode";
import { useAdminWebsiteData } from "@/lib/website/use-admin-data";
import { saveLiveGalleryWorkspace } from "@/lib/website/actions";
import { seededGallery, seededGalleryCollections, seededMedia } from "@/lib/website/types";
import {
  assignImagesToCategory,
  galleryWorkspaceDataReady,
  galleryWorkspaceError,
  groupGalleryImages,
  moveGalleryImageRelative,
  nextCategorySlug,
  unassignCategory,
} from "@/lib/website/gallery-collections";

const snapshot = (categories: GalleryCollection[], placements: GalleryPlacement[]) =>
  JSON.stringify({ categories, placements });

const orderCategories = (rows: GalleryCollection[]) =>
  [...rows].sort((a, b) => a.order - b.order).map((row, index) => ({ ...row, order: index + 1 }));

const orderedPlacements = (rows: GalleryPlacement[]) =>
  [...rows].sort((a, b) => a.order - b.order).map((row, index) => ({ ...row, order: index + 1 }));

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `gallery-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function GalleryManager({ state }: { state?: string }) {
  const store = useDemoStore();
  const demoEmpty = demoMode && state === "empty";
  const liveCategories = useAdminWebsiteData<GalleryCollection>(
    "gallery-collections",
    demoMode ? seededGalleryCollections : [],
  );
  const liveGallery = useAdminWebsiteData<GalleryPlacement & { asset?: MediaAsset }>(
    "gallery",
    demoMode ? seededGallery : [],
  );
  const liveMedia = useAdminWebsiteData<MediaAsset>(
    "media",
    demoMode ? seededMedia : [],
    { enabled: demoMode },
  );
  const [categories, setCategories] = useState<GalleryCollection[]>(() =>
    demoMode && !demoEmpty ? structuredClone(getGalleryCollections()) : [],
  );
  const [placements, setPlacements] = useState<GalleryPlacement[]>(() =>
    demoMode && !demoEmpty ? structuredClone(getGallery().map((row) => row.placement)) : [],
  );
  const [baseline, setBaseline] = useState(() =>
    demoMode && !demoEmpty
      ? snapshot(getGalleryCollections(), getGallery().map((row) => row.placement))
      : snapshot([], []),
  );
  const [hydrated, setHydrated] = useState(demoMode);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingMedia, setEditingMedia] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedMedia, setPickedMedia] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; label: string } | null>(null);
  const [confirmCategory, setConfirmCategory] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [undoPlacements, setUndoPlacements] = useState<GalleryPlacement[] | null>(null);
  const [draggingMediaId, setDraggingMediaId] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");

  const dirty = snapshot(orderCategories(categories), orderedPlacements(placements)) !== baseline;
  const loading = !demoMode && (liveCategories.loading || liveGallery.loading);
  const fetchError = !demoMode
    ? [
      liveCategories.error ? `Categories: ${liveCategories.error}` : "",
      liveGallery.error ? `Images: ${liveGallery.error}` : "",
    ].filter(Boolean).join(" ")
    : "";
  const canWrite = demoMode || (
    hydrated &&
    galleryWorkspaceDataReady({
      categoriesLoading: liveCategories.loading,
      placementsLoading: liveGallery.loading,
      categoriesError: liveCategories.error,
      placementsError: liveGallery.error,
    })
  );
  const groups = groupGalleryImages(placements);
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const activeCategoryRecord = activeCategory ? categoriesById.get(activeCategory) ?? null : null;
  const activeGroups = activeCategory
    ? groups.filter((group) => group.collectionKeys.includes(activeCategory))
    : [];
  const allMedia = demoMode ? store.media : liveMedia.items;
  const availableMedia = allMedia.filter(
    (media) =>
      !media.archived &&
      !!activeCategory &&
      !placements.some(
        (placement) =>
          placement.mediaId === media.id && placement.collectionKey === activeCategory,
      ),
  );
  const countFor = (category: GalleryCollection) =>
    category.imageCount ??
    groups.filter((group) => group.collectionKeys.includes(category.id)).length;
  const pendingCategory = categories.find((category) => category.id === confirmCategory) ?? null;
  const pendingCategoryCount = pendingCategory ? countFor(pendingCategory) : 0;

  useEffect(() => {
    if (
      demoMode ||
      !galleryWorkspaceDataReady({
        categoriesLoading: liveCategories.loading,
        placementsLoading: liveGallery.loading,
        categoriesError: liveCategories.error,
        placementsError: liveGallery.error,
      }) ||
      dirty
    ) return;
    const nextCategories = structuredClone(liveCategories.items);
    const nextPlacements = liveGallery.items.map((item) => ({
      id: item.id,
      mediaId: item.mediaId,
      alt: item.alt,
      caption: item.caption,
      order: item.order,
      visible: item.visible,
      version: item.version,
      collectionKey: item.collectionKey ?? "",
    }));
    setCategories(nextCategories);
    setPlacements(nextPlacements);
    setBaseline(snapshot(nextCategories, nextPlacements));
    setHydrated(true);
  }, [
    dirty,
    liveCategories.error,
    liveCategories.items,
    liveCategories.loading,
    liveGallery.error,
    liveGallery.items,
    liveGallery.loading,
  ]);

  function change() {
    setError("");
    setSuccess("");
  }

  function patchCategory(id: string, changes: Partial<GalleryCollection>) {
    setCategories((rows) => rows.map((row) => (row.id === id ? { ...row, ...changes } : row)));
    change();
  }

  function patchPlacement(id: string, changes: Partial<GalleryPlacement>) {
    setPlacements((rows) => rows.map((row) => (row.id === id ? { ...row, ...changes } : row)));
    change();
  }

  function moveCategory(id: string, delta: number) {
    const ordered = orderCategories(categories);
    const index = ordered.findIndex((category) => category.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setCategories(orderCategories(ordered));
    change();
  }

  function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const id = nextCategorySlug(name, categories);
    setCategories((rows) =>
      orderCategories([
        ...rows,
        { id, name, description: "", order: rows.length + 1, visible: true, version: 0, imageCount: 0 },
      ]),
    );
    setNewCategoryName("");
    change();
  }

  function deleteCategory(id: string) {
    setPlacements((rows) => unassignCategory(rows, id));
    setCategories((rows) => orderCategories(rows.filter((row) => row.id !== id)));
    setActiveCategory((current) => (current === id ? null : current));
    setEditingCategory(null);
    setConfirmCategory(null);
    change();
  }

  function openCategory(id: string) {
    setActiveCategory(id);
    setEditingMedia(null);
    if (!demoMode && !liveGallery.items.length) {
      void Promise.all([liveGallery.refetch(), liveMedia.refetch()]);
    }
  }

  function reorderImageRelative(mediaId: string, targetMediaId: string, after = false) {
    const next = moveGalleryImageRelative({ placements, mediaId, targetMediaId, after });
    if (next === placements) return;
    const position = groupGalleryImages(next).findIndex((group) => group.mediaId === mediaId) + 1;
    setUndoPlacements(placements);
    setPlacements(next);
    setReorderAnnouncement(`Image moved to global position ${position}.`);
    change();
  }

  function dropImage(targetMediaId: string, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const mediaId = event.dataTransfer.getData("text/plain") || draggingMediaId;
    if (!mediaId || mediaId === targetMediaId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > bounds.top + bounds.height / 2;
    reorderImageRelative(mediaId, targetMediaId, after);
    setDraggingMediaId(null);
  }

  function undoReorder() {
    if (!undoPlacements) return;
    setPlacements(undoPlacements);
    setUndoPlacements(null);
    setReorderAnnouncement("Last image move undone.");
    change();
  }

  function removePlacement(id: string) {
    setPlacements((rows) => orderedPlacements(rows.filter((row) => row.id !== id)));
    setUndoPlacements(null);
    setConfirmRemove(null);
    change();
  }

  function cancel() {
    const previous = JSON.parse(baseline) as {
      categories: GalleryCollection[];
      placements: GalleryPlacement[];
    };
    setCategories(structuredClone(previous.categories));
    setPlacements(structuredClone(previous.placements));
    setUndoPlacements(null);
    setActiveCategory(null);
    setEditingCategory(null);
    setEditingMedia(null);
    setNewCategoryName("");
    setError("");
    setSuccess("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !canWrite) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const nextCategories = orderCategories(categories).map((category) => ({
        ...category,
        id: category.id.trim(),
        name: category.name.trim(),
        description: (category.description ?? "").trim(),
      }));
      const nextPlacements = orderedPlacements(placements);
      const validation = galleryWorkspaceError(nextCategories, nextPlacements);
      if (validation) throw new Error(validation);
      const previous = JSON.parse(baseline) as {
        categories: GalleryCollection[];
        placements: GalleryPlacement[];
      };
      const saved = demoMode
        ? await saveGalleryWorkspace({ collections: nextCategories, placements: nextPlacements })
        : await saveLiveGalleryWorkspace(
          { collections: nextCategories, placements: nextPlacements },
          {
            collections: Object.fromEntries(previous.categories.map((row) => [row.id, row.version])),
            placements: Object.fromEntries(previous.placements.map((row) => [row.id, row.version])),
          },
        );
      setCategories(saved.collections);
      setPlacements(saved.placements);
      setBaseline(snapshot(saved.collections, saved.placements));
      setUndoPlacements(null);
      setSuccess("Changes saved. The website gallery now matches this view.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function imageCard(group: (typeof groups)[number]) {
    const asset = allMedia.find((media) => media.id === group.mediaId);
    const editing = editingMedia === group.mediaId;
    const currentPlacement = group.placements.find(
      (placement) => placement.collectionKey === activeCategory,
    );
    const globalPosition = groups.findIndex((entry) => entry.mediaId === group.mediaId) + 1;
    const categoryIndex = activeGroups.findIndex((entry) => entry.mediaId === group.mediaId);
    const groupedPlacements = group.placements.length > 1;
    return (
      <article
        className={`${styles.galleryOrderCard} panel form-stack${draggingMediaId === group.mediaId ? ` ${styles.galleryDragging}` : ""}`}
        key={group.mediaId}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => dropImage(group.mediaId, event)}
      >
        <div className={styles.row}>
          <div className={styles.thumb}>
            {asset ? (
              <Picture photo={{ src: asset.src, alt: group.alt || asset.alt }} sizes="150px" />
            ) : <p className={styles.inlineNote}>Image unavailable</p>}
          </div>
          <div className={styles.rowBody}>
            <div className={styles.galleryOrderHeader}>
              <span className={styles.galleryPosition} aria-label={`Global position ${globalPosition}`}>{globalPosition}</span>
              <div>
                <strong>Position {globalPosition}</strong>
                {groupedPlacements && <small>Moves in All and {group.collectionKeys.length} categories</small>}
              </div>
              <button
                type="button"
                className={styles.galleryDragHandle}
                draggable={!busy && canWrite}
                disabled={busy || !canWrite}
                aria-label={`Drag to reorder ${group.alt || "image"} at position ${globalPosition}`}
                title="Drag image to reorder"
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", group.mediaId);
                  setDraggingMediaId(group.mediaId);
                }}
                onDragEnd={() => setDraggingMediaId(null)}
              >
                <GripVertical aria-hidden="true" />
                <span>Drag to reorder</span>
              </button>
            </div>
            <div className={styles.cardActions}>
              <button
                type="button"
                className="button secondary"
                aria-label={`Move ${group.alt || "image"} up`}
                disabled={busy || !canWrite || categoryIndex <= 0}
                onClick={() => reorderImageRelative(group.mediaId, activeGroups[categoryIndex - 1]?.mediaId)}
              >
                Move Up
              </button>
              <button
                type="button"
                className="button secondary"
                aria-label={`Move ${group.alt || "image"} down`}
                disabled={busy || !canWrite || categoryIndex === activeGroups.length - 1}
                onClick={() => reorderImageRelative(group.mediaId, activeGroups[categoryIndex + 1]?.mediaId, true)}
              >
                Move Down
              </button>
              <button
                type="button"
                className="button secondary"
                aria-expanded={editing}
                onClick={() => setEditingMedia(editing ? null : group.mediaId)}
              >
                {editing ? "Close details" : "Edit Image"}
              </button>
              {currentPlacement && (
                <button
                  type="button"
                  className="button danger"
                  disabled={busy}
                  onClick={() =>
                    setConfirmRemove({
                      id: currentPlacement.id,
                      label: `this image from ${activeCategoryRecord?.name ?? "this category"}`,
                    })
                  }
                >
                  Remove from Category
                </button>
              )}
            </div>
            <h3>{group.alt || "Untitled image"}</h3>
            {group.caption && <p className={styles.inlineNote}>{group.caption}</p>}
            <span className={`badge status-${currentPlacement?.visible ? "visible" : "hidden"}`}>
              {currentPlacement?.visible ? "Shown on website" : "Hidden from website"}
            </span>
            {editing && currentPlacement && (
              <div className="form-stack">
                <TextField
                  id={`image-alt-${group.mediaId}`}
                  label="Image description *"
                  value={group.alt}
                  maxLength={300}
                  onChange={(event) => {
                    setPlacements((rows) =>
                      rows.map((row) =>
                        row.mediaId === group.mediaId ? { ...row, alt: event.target.value } : row,
                      ),
                    );
                    change();
                  }}
                />
                <TextField
                  id={`image-caption-${group.mediaId}`}
                  label="Caption"
                  value={group.caption}
                  maxLength={300}
                  onChange={(event) => {
                    setPlacements((rows) =>
                      rows.map((row) =>
                        row.mediaId === group.mediaId
                          ? { ...row, caption: event.target.value }
                          : row,
                      ),
                    );
                    change();
                  }}
                />
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={currentPlacement.visible}
                    onChange={(event) => patchPlacement(currentPlacement.id, { visible: event.target.checked })}
                  />
                  Show this image on the website
                </label>
              </div>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <>
      <UnsavedGuard dirty={dirty} />
      <form noValidate onSubmit={save}>
        <ModuleShell
          title="Gallery"
          description="Start with a category, then manage only the images assigned to it."
          backHref="/admin/content"
          backLabel="Website Content"
          badge={
            <div className={styles.cardActions}>
              {fetchError && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={loading}
                  onClick={() => void Promise.all([liveCategories.refetch(), liveGallery.refetch()])}
                >
                  Retry loading
                </button>
              )}
              {activeCategory && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !canWrite}
                  onClick={() => {
                    setPickedMedia([]);
                    setPickerOpen(true);
                    if (!demoMode) void liveMedia.refetch();
                  }}
                >
                  Add Images
                </button>
              )}
              <Submit busy={busy} disabled={!canWrite || !dirty} label="Save Changes" busyLabel="Saving…" />
              <button type="button" className="button secondary" disabled={busy || !dirty} onClick={cancel}>
                Cancel
              </button>
            </div>
          }
          error={[error, fetchError].filter(Boolean).join(" ")}
          success={success}
        />
        {!demoMode && loading && <div className="panel" role="status">Loading gallery data…</div>}
        {!demoMode && !hydrated && !loading && fetchError && (
          <div className="panel" role="status">Gallery data is unavailable. Retry loading before making changes.</div>
        )}
        {(hydrated || demoMode) && !activeCategory && (
          <section className="panel form-stack" aria-labelledby="gallery-categories-heading">
            <h2 id="gallery-categories-heading">Gallery Categories</h2>
            <p className={styles.inlineNote}>
              Each count is the number of saved image assignments. An image in two categories is counted once in each.
            </p>
            <div className={styles.twoColumnGrid}>
              {categories.map((category, index) => {
                const editing = editingCategory === category.id;
                return (
                  <article className="panel form-stack" key={category.id}>
                    <div className={styles.cardActions}>
                      <div>
                        <h3>{category.name}</h3>
                        <span className="badge">{countFor(category)} {countFor(category) === 1 ? "image" : "images"}</span>{" "}
                        <span className={`badge status-${category.visible ? "visible" : "hidden"}`}>
                          {category.visible ? "Shown on website" : "Hidden from website"}
                        </span>
                      </div>
                      <button type="button" className="button" onClick={() => openCategory(category.id)}>
                        Open Category
                      </button>
                    </div>
                    {category.description && <p className={styles.inlineNote}>{category.description}</p>}
                    <div className={styles.cardActions}>
                      <button type="button" className="button secondary" onClick={() => setEditingCategory(editing ? null : category.id)}>
                        {editing ? "Close details" : "Edit Category"}
                      </button>
                      <button type="button" className="button danger" disabled={busy} onClick={() => setConfirmCategory(category.id)}>
                        Delete Category
                      </button>
                    </div>
                    {editing && (
                      <div className="form-stack">
                        <TextField id={`category-name-${index}`} label="Category name *" value={category.name} maxLength={80} onChange={(event) => patchCategory(category.id, { name: event.target.value })} />
                        <TextField id={`category-description-${index}`} label="Description (optional)" value={category.description} maxLength={300} onChange={(event) => patchCategory(category.id, { description: event.target.value })} />
                        <div className={styles.cardActions}>
                          <button type="button" className="button secondary" disabled={busy || category.visible} onClick={() => patchCategory(category.id, { visible: true })}>Show on Website</button>
                          <button type="button" className="button secondary" disabled={busy || !category.visible} onClick={() => patchCategory(category.id, { visible: false })}>Hide from Website</button>
                          <button type="button" className="button secondary" disabled={busy || index === 0} onClick={() => moveCategory(category.id, -1)}>Move up</button>
                          <button type="button" className="button secondary" disabled={busy || index === categories.length - 1} onClick={() => moveCategory(category.id, 1)}>Move down</button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <div className={styles.cardActions}>
              <TextField id="new-category-name" label="New category name" value={newCategoryName} maxLength={80} onChange={(event) => setNewCategoryName(event.target.value)} />
              <button type="button" className="button secondary" disabled={busy || !canWrite || !newCategoryName.trim()} onClick={addCategory}>Add Category</button>
            </div>
          </section>
        )}
        {(hydrated || demoMode) && activeCategory && (
          <section className="form-stack" aria-labelledby="gallery-category-heading">
            <div className="panel form-stack">
              <div className={styles.cardActions}>
                <button type="button" className="button secondary" onClick={() => setActiveCategory(null)}>Back to Categories</button>
                <span className={`badge status-${activeCategoryRecord?.visible ? "visible" : "hidden"}`}>
                  {activeCategoryRecord?.visible ? "Category shown on website" : "Category hidden from website"}
                </span>
              </div>
              <h2 id="gallery-category-heading">{activeCategoryRecord?.name}</h2>
              {activeCategoryRecord?.description && <p className={styles.inlineNote}>{activeCategoryRecord.description}</p>}
              <p className={styles.inlineNote}>
                {activeGroups.length} {activeGroups.length === 1 ? "image is" : "images are"} assigned to this category.
                Removing an image here does not delete it from the Media Library or other categories.
              </p>
              <div className={styles.cardActions}>
                <button type="button" className="button secondary" disabled={busy || activeCategoryRecord?.visible} onClick={() => activeCategory && patchCategory(activeCategory, { visible: true })}>Show Category</button>
                <button type="button" className="button secondary" disabled={busy || !activeCategoryRecord?.visible} onClick={() => activeCategory && patchCategory(activeCategory, { visible: false })}>Hide Category</button>
              </div>
            </div>
            {liveGallery.loading && !demoMode && <div className="panel" role="status">Loading images…</div>}
            {activeGroups.length ? (
              <>
                <div className={styles.galleryOrderToolbar}>
                  <div>
                    <strong>{dirty ? "Unsaved changes" : "Saved order"}</strong>
                    <span>One global order is shared by All and every category. Reordering a shared image moves all its placements together.</span>
                    {dirty && <span role="status">Your changes are not public until you save.</span>}
                  </div>
                  <button type="button" className="button secondary" disabled={!undoPlacements || busy} onClick={undoReorder}>Undo last move</button>
                </div>
                <span className={styles.visuallyHidden} aria-live="polite">{reorderAnnouncement}</span>
                <div className={styles.twoColumnGrid}>{activeGroups.map(imageCard)}</div>
              </>
            ) : (
              <Empty title="No images in this category yet." body="Choose Add Images to select existing Media Library assets." />
            )}
          </section>
        )}
        <MediaPicker
          open={pickerOpen}
          multi
          title={`Add images to ${activeCategoryRecord?.name ?? "this category"}`}
          confirmLabel="Add Images"
          assets={availableMedia}
          loading={!demoMode && liveMedia.loading}
          error={!demoMode ? liveMedia.error : ""}
          onRetry={() => void liveMedia.refetch()}
          selectedIds={pickedMedia}
          onToggle={(asset) => setPickedMedia((ids) => ids.includes(asset.id) ? ids.filter((id) => id !== asset.id) : [...ids, asset.id])}
          onConfirm={() => {
            if (!activeCategory || !canWrite) return;
            const picked = allMedia
              .filter((media) => pickedMedia.includes(media.id) && !media.archived)
              .map((media) => ({ mediaId: media.id, alt: media.alt, caption: media.caption }));
            setPlacements((rows) => assignImagesToCategory({ placements: rows, images: picked, categoryKey: activeCategory, newId }));
            setPickedMedia([]);
            setPickerOpen(false);
            change();
          }}
          onClose={() => {
            setPickerOpen(false);
            setPickedMedia([]);
          }}
        />
        <Dialog open={confirmRemove !== null} onClose={() => setConfirmRemove(null)} title="Remove this image?">
          <p>Remove {confirmRemove?.label ?? "this image"}? The Media Library asset and its other category assignments will stay unchanged.</p>
          <div className="actions">
            <button type="button" className="button secondary" onClick={() => setConfirmRemove(null)}>Keep Image</button>
            <button type="button" className="button danger" disabled={busy} onClick={() => confirmRemove && removePlacement(confirmRemove.id)}>Remove Image</button>
          </div>
        </Dialog>
        <Dialog open={confirmCategory !== null} onClose={() => setConfirmCategory(null)} title="Delete this category?">
          <p>{pendingCategory?.name ?? "This category"} contains {pendingCategoryCount} {pendingCategoryCount === 1 ? "image assignment" : "image assignments"}.</p>
          <p>Deleting the category removes only its category assignments. Media Library assets and other category assignments are not deleted.</p>
          <div className="actions">
            <button type="button" className="button secondary" onClick={() => setConfirmCategory(null)}>Keep Category</button>
            <button type="button" className="button danger" disabled={busy} onClick={() => confirmCategory && deleteCategory(confirmCategory)}>Delete Category</button>
          </div>
        </Dialog>
      </form>
    </>
  );
}
