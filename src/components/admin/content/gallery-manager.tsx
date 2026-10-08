"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Empty, Picture } from "@/components/ui";
import { Submit, TextField } from "@/components/forms/controls";
import { Dialog } from "@/components/dialog";
import { UnsavedGuard } from "../unsaved";
import { getGallery, saveGallery, useDemoStore } from "@/lib/mock-store";
import type { GalleryPlacement } from "@/lib/contracts";
import { ModuleShell } from "./shared/module-shell";
import { MediaPicker } from "./shared/media-picker";
import styles from "./content.module.css";
export function GalleryManager({ state }: { state?: string }) {
  const store = useDemoStore();
  const [draft, setDraft] = useState<GalleryPlacement[]>(() =>
    structuredClone(
      state === "empty" ? [] : getGallery().map((row) => row.placement),
    ),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(
      state === "empty" ? [] : getGallery().map((row) => row.placement),
    ),
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState("");
  const dirty = JSON.stringify(draft) !== baseline;
  function patch(index: number, changes: Partial<GalleryPlacement>) {
    setDraft((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...changes } : row)),
    );
    setSuccess("");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const ordered = [...draft].sort((a, b) => a.order - b.order);
      const saved = await saveGallery(ordered);
      setDraft(structuredClone(saved));
      setBaseline(JSON.stringify(saved));
      setSuccess("Gallery saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const availableAssets = store.media.filter(
    (m) => !m.archived && !draft.some((d) => d.mediaId === m.id),
  );
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
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setSelected([]);
                  setPicker(true);
                }}
              >
                Add Images
              </button>
              <Submit busy={busy} label="Save Gallery" busyLabel="Saving…" />
              <Link className="button secondary" href="/admin/content">
                Cancel
              </Link>
            </div>
          }
          error={error}
          success={success}
        />
        {draft.length ? (
          <div className="stack">
            {draft.map((placement, i) => {
              const asset = store.media.find((m) => m.id === placement.mediaId);
              const available = !!asset && !asset.archived;
              return (
                <article className="panel form-stack" key={placement.id}>
                  <div className={styles.row}>
                    {asset && (
                      <div className={styles.thumb}>
                        <Picture
                          photo={{ src: asset.src, alt: placement.alt }}
                        />
                      </div>
                    )}
                    <div className={styles.rowBody}>
                      {!available && (
                        <p className={styles.inlineNote}>
                          Media asset unavailable. Remove this image or add a
                          current asset.
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
                        onChange={(e) => patch(i, { alt: e.target.value })}
                      />
                      <TextField
                        id={`gallery-caption-${i}`}
                        label="Caption"
                        value={placement.caption}
                        maxLength={300}
                        onChange={(e) => patch(i, { caption: e.target.value })}
                      />
                      <TextField
                        id={`gallery-order-${i}`}
                        label="Display order"
                        type="number"
                        min={1}
                        step={1}
                        value={placement.order}
                        onChange={(e) =>
                          patch(i, { order: Number(e.target.value) })
                        }
                      />
                      <div className={styles.cardActions}>
                        <span className="badge">
                          {placement.visible
                            ? "Shown on website"
                            : "Hidden from website"}
                        </span>
                        <button
                          type="button"
                          className="button secondary"
                          aria-pressed={!placement.visible}
                          disabled={placement.visible || busy}
                          onClick={() => patch(i, { visible: true })}
                        >
                          Show on Website
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          aria-pressed={placement.visible}
                          disabled={!placement.visible || busy}
                          onClick={() => patch(i, { visible: false })}
                        >
                          Hide from Website
                        </button>
                        <button
                          type="button"
                          className="button danger"
                          disabled={busy}
                          onClick={() => setConfirmRemove(placement.id)}
                        >
                          Remove from Gallery
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty
            title="No gallery images selected."
            body="Add images from the Media Library to build the gallery."
          />
        )}
        <MediaPicker
          open={picker}
          multi
          title="Add gallery images"
          assets={availableAssets}
          selectedIds={selected}
          onToggle={(asset) =>
            setSelected((ids) =>
              ids.includes(asset.id)
                ? ids.filter((id) => id !== asset.id)
                : [...ids, asset.id],
            )
          }
          onConfirm={() => {
            const picked = store.media.filter((m) => selected.includes(m.id));
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
        <Dialog
          open={!!confirmRemove}
          onClose={() => setConfirmRemove("")}
          title="Remove from gallery?"
        >
          <p>
            Remove this image from the gallery? The Media Library asset itself
            is not deleted.
          </p>
          <div className="actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setConfirmRemove("")}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => {
                setDraft((rows) =>
                  rows.filter((row) => row.id !== confirmRemove),
                );
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
