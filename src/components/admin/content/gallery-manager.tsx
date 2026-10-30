"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Empty, Picture } from "@/components/ui";
import { Submit, TextField } from "@/components/forms/controls";
import { Dialog } from "@/components/dialog";
import { UnsavedGuard } from "../unsaved";
import { getGallery, saveGallery, useDemoStore } from "@/lib/mock-store";
import type { GalleryPlacement, MediaAsset } from "@/lib/contracts";
import { ModuleShell } from "./shared/module-shell";
import { MediaPicker } from "./shared/media-picker";
import styles from "./content.module.css";
import { demoMode } from "@/lib/demo-mode";
import { useAdminWebsiteData } from "@/lib/website/use-admin-data";
import { saveLiveGallery } from "@/lib/website/actions";
import { seededGallery, seededMedia } from "@/lib/website/types";

export function GalleryManager({ state }: { state?: string }) {
  const store = useDemoStore();
  const liveGallery = useAdminWebsiteData<(GalleryPlacement & { asset?: MediaAsset })>(
    "gallery",
    demoMode ? seededGallery : [],
  );
  const liveMedia = useAdminWebsiteData<MediaAsset>(
    "media",
    demoMode ? seededMedia : [],
  );
  const allMedia = demoMode ? store.media : liveMedia.items;
  const demoGallery = demoMode && state !== "empty"
    ? getGallery().map((row) => row.placement)
    : [];
  const [draft, setDraft] = useState<GalleryPlacement[]>(() =>
    structuredClone(demoMode ? demoGallery : []),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(demoMode ? demoGallery : []),
  );
  const [hydrated, setHydrated] = useState(demoMode);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState("");
  const dirty = JSON.stringify(draft) !== baseline;
  const loading = !demoMode && (liveGallery.loading || liveMedia.loading);
  const fetchError = !demoMode
    ? [liveGallery.error && `Gallery: ${liveGallery.error}`, liveMedia.error && `Media Library: ${liveMedia.error}`]
      .filter(Boolean)
      .join(" ")
    : "";
  const canWrite = demoMode || (hydrated && !loading && !fetchError);

  useEffect(() => {
    if (demoMode || liveGallery.loading || liveGallery.error || liveMedia.loading || liveMedia.error || dirty) {
      return;
    }
    const next = structuredClone(liveGallery.items);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setHydrated(true);
  }, [dirty, liveGallery.error, liveGallery.items, liveGallery.loading, liveMedia.error, liveMedia.loading]);

  function patch(index: number, changes: Partial<GalleryPlacement>) {
    setDraft((rows) => rows.map((row, i) => (i === index ? { ...row, ...changes } : row)));
    setSuccess("");
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next.map((row, i) => ({ ...row, order: i + 1 })));
    setSuccess("");
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !canWrite) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const ordered = [...draft].sort((a, b) => a.order - b.order);
      const saved = demoMode
        ? await saveGallery(ordered)
        : await (() => {
          const payload = ordered.map((row) => ({
            id: row.id,
            mediaId: row.mediaId,
            alt: row.alt,
            caption: row.caption,
            order: row.order,
            visible: row.visible,
            version: row.version,
          }));
          const previousRows = JSON.parse(baseline) as GalleryPlacement[];
          const previousVersions = Object.fromEntries(
            previousRows.map((row) => [row.id, row.version]),
          );
          for (const row of payload) previousVersions[row.id] = row.version;
          return saveLiveGallery(payload, previousVersions);
        })();
      setDraft(structuredClone(saved));
      setBaseline(JSON.stringify(saved));
      setSuccess("Gallery saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const availableAssets = allMedia.filter(
    (media) => !media.archived && !draft.some((placement) => placement.mediaId === media.id),
  );
  const retryData = () => {
    void Promise.all([liveGallery.refetch(), liveMedia.refetch()]);
  };

  return (
    <>
      <UnsavedGuard dirty={dirty} />
      <form noValidate onSubmit={save}>
        <ModuleShell
          title="Gallery"
          description="Placed Media Library images. Removing an image here never deletes the library asset."
          backHref="/admin/content"
          backLabel="Website Content"
          badge={
            <div className={styles.cardActions}>
              {fetchError && (
                <button type="button" className="button secondary" disabled={loading} onClick={retryData}>
                  Retry loading
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={busy || !canWrite}
                onClick={() => {
                  setSelected([]);
                  setPicker(true);
                  if (!demoMode) void liveMedia.refetch();
                }}
              >
                Add Images
              </button>
              <Submit busy={busy} disabled={!canWrite} label="Save Gallery" busyLabel="Saving…" />
              <Link className="button secondary" href="/admin/content">
                Cancel
              </Link>
            </div>
          }
          error={[error, fetchError].filter(Boolean).join(" ")}
          success={success}
        />
        {!demoMode && loading && (
          <div className="panel" role="status" aria-live="polite">
            Loading gallery and Media Library…
          </div>
        )}
        {!demoMode && !hydrated && !loading && fetchError && (
          <div className="panel" role="status">
            Gallery data is unavailable. Retry loading before making changes.
          </div>
        )}
        {(hydrated || demoMode) && draft.length ? (
          <div className="stack">
            {draft.map((placement, i) => {
              const asset = demoMode
                ? store.media.find((media) => media.id === placement.mediaId)
                : allMedia.find((media) => media.id === placement.mediaId);
              const available = !!asset && !asset.archived;
              return (
                <article className="panel form-stack" key={placement.id}>
                  <div className={styles.row}>
                    {asset && (
                      <div className={styles.thumb}>
                        <Picture
                          photo={{ src: asset.src, alt: placement.alt }}
                          sizes="96px"
                        />
                      </div>
                    )}
                    <div className={styles.rowBody}>
                      {!available && (
                        <p className={styles.inlineNote}>
                          Media asset unavailable. Remove this image or add a current asset.
                        </p>
                      )}
                      {asset && asset.uses.length > 0 && (
                        <p className={styles.inlineNote}>
                          Also referenced as: {asset.uses.join("; ")}.
                        </p>
                      )}
                      <TextField
                        id={`gallery-alt-${i}`}
                        label="Alt text *"
                        value={placement.alt}
                        maxLength={300}
                        onChange={(event) => patch(i, { alt: event.target.value })}
                      />
                      <TextField
                        id={`gallery-caption-${i}`}
                        label="Caption"
                        value={placement.caption}
                        maxLength={300}
                        onChange={(event) => patch(i, { caption: event.target.value })}
                      />
                      <div className={styles.cardActions}>
                        <span className="badge">Position {i + 1}</span>
                        <button type="button" className="button secondary" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                          Move earlier
                        </button>
                        <button type="button" className="button secondary" disabled={busy || i === draft.length - 1} onClick={() => move(i, 1)}>
                          Move later
                        </button>
                        <span className={`badge status-${placement.visible ? "visible" : "hidden"}`}>
                          {placement.visible ? "Shown on website" : "Hidden from website"}
                        </span>
                        <button type="button" className="button secondary" aria-pressed={!placement.visible} disabled={placement.visible || busy} onClick={() => patch(i, { visible: true })}>
                          Show on Website
                        </button>
                        <button type="button" className="button secondary" aria-pressed={placement.visible} disabled={!placement.visible || busy} onClick={() => patch(i, { visible: false })}>
                          Hide from Website
                        </button>
                        <button type="button" className="button danger" disabled={busy} onClick={() => setConfirmRemove(placement.id)}>
                          Remove from Gallery
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (hydrated || demoMode) && !fetchError ? (
          <Empty title="No gallery images selected." body="Add images from the Media Library to build the gallery." />
        ) : null}
        <MediaPicker
          open={picker}
          multi
          title="Add gallery images"
          assets={availableAssets}
          loading={!demoMode && liveMedia.loading}
          error={!demoMode ? liveMedia.error : ""}
          onRetry={() => liveMedia.refetch()}
          selectedIds={selected}
          onToggle={(asset) =>
            setSelected((ids) =>
              ids.includes(asset.id) ? ids.filter((id) => id !== asset.id) : [...ids, asset.id],
            )
          }
          onConfirm={() => {
            if (!canWrite) return;
            const picked = allMedia.filter((media) => selected.includes(media.id) && !media.archived);
            setDraft((rows) => [
              ...rows,
              ...picked.map((asset, index) => ({
                id: crypto.randomUUID(),
                mediaId: asset.id,
                alt: asset.alt,
                caption: asset.caption,
                order: rows.length + index + 1,
                visible: true,
                version: 0,
              })),
            ]);
            setSelected([]);
            setPicker(false);
            setSuccess("");
          }}
          onClose={() => setPicker(false)}
        />
        <Dialog open={!!confirmRemove} onClose={() => setConfirmRemove("")} title="Remove from gallery?">
          <p>Remove this image from the gallery? The Media Library asset itself is not deleted.</p>
          <div className="actions">
            <button type="button" className="button secondary" onClick={() => setConfirmRemove("")}>
              Cancel
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => {
                setDraft((rows) => rows.filter((row) => row.id !== confirmRemove));
                setConfirmRemove("");
                setSuccess("");
              }}
            >
              Remove from Gallery
            </button>
          </div>
        </Dialog>
      </form>
    </>
  );
}
