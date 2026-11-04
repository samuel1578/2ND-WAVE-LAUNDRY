"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Upload } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { Empty, Picture } from "@/components/ui";
import { Notice, TextField } from "@/components/forms/controls";
import { demoMode } from "@/lib/demo-mode";
import { saveMedia } from "@/lib/mock-store";
import type { MediaAsset } from "@/lib/contracts";
import {
  MEDIA_UPLOAD_ACCEPT,
  MEDIA_UPLOAD_PERMISSION,
  MEDIA_UPLOAD_SOURCE,
  mediaUploadError,
  suggestMediaAlt,
  uploadMediaAsset,
} from "@/lib/website/media-upload";

type FormatFilter = "all" | "webp" | "jpeg" | "png";

type UploadStatus = "working" | "saving" | "done" | "error";

type UploadRow = {
  key: string;
  name: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error: string;
};

function assetFormat(asset: MediaAsset): Exclude<FormatFilter, "all"> | "other" {
  const path = asset.src.split("?")[0].toLowerCase();
  if (path.endsWith(".webp")) return "webp";
  if (path.endsWith(".png")) return "png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "jpeg";
  return "other";
}

function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function statusLabel(row: UploadRow): string {
  if (row.status === "done") return "Saved to Media Library";
  if (row.status === "error") return "Upload failed";
  if (row.status === "saving") return "Saving to Media Library…";
  return `Uploading ${row.progress}%`;
}

/**
 * Integrated Media Library picker: searchable thumbnails, preview/metadata,
 * validation and multi-file uploads using the existing marketing-assets bucket
 * and website_gallery_media records. Selecting an existing asset or finishing
 * an upload hands the saved asset straight back to the caller so the article
 * editor can insert it at the cursor.
 */
export function MediaLibraryPicker({
  open,
  title,
  selectLabel,
  assets,
  loading = false,
  error = "",
  onRetry,
  onClose,
  onSelect,
  onUploaded,
  insertOnUpload = false,
}: {
  open: boolean;
  title: string;
  selectLabel: string;
  assets: MediaAsset[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onClose: () => void;
  onSelect: (asset: MediaAsset) => void;
  onUploaded: (asset: MediaAsset) => void;
  /** True when the caller inserts uploads at the editor cursor (inline images). */
  insertOnUpload?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<FormatFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [insertedIds, setInsertedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
    if (open) return;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setFormat("all");
    setSelectedId(null);
    setRows([]);
    setInsertedIds([]);
    setNotice("");
    setProblem("");
  }, [open]);

  const library = useMemo(() => assets.filter((asset) => !asset.archived), [assets]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return library.filter((asset) => {
      if (format !== "all" && assetFormat(asset) !== format) return false;
      if (!needle) return true;
      return `${asset.name} ${asset.alt} ${asset.caption}`.toLowerCase().includes(needle);
    });
  }, [library, format, query]);
  const selected = library.find((asset) => asset.id === selectedId) ?? null;
  const uploading = rows.some((row) => row.status === "working" || row.status === "saving");

  function patchRow(key: string, patch: Partial<UploadRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  async function demoUpload(
    file: File,
    alt: string,
    signal: AbortSignal,
  ): Promise<MediaAsset> {
    const asset: MediaAsset = {
      id: newKey(),
      src: URL.createObjectURL(file),
      name: file.name,
      alt,
      caption: "",
      source: MEDIA_UPLOAD_SOURCE,
      permission: MEDIA_UPLOAD_PERMISSION,
      uses: [],
      archived: false,
    };
    await saveMedia(asset, signal);
    return asset;
  }

  async function uploadOne(file: File) {
    const key = newKey();
    const controller = new AbortController();
    controllers.current.set(key, controller);
    setRows((current) => [
      ...current,
      {
        key,
        name: file.name,
        file,
        status: "working",
        progress: 0,
        error: "",
      },
    ]);
    const alt = suggestMediaAlt(file.name) || "Uploaded image";
    try {
      setNotice("");
      setProblem("");
      const asset = demoMode
        ? await demoUpload(file, alt, controller.signal)
        : await uploadMediaAsset({
          file,
          alt,
          caption: "",
          signal: controller.signal,
          onProgress: (progress) =>
            patchRow(key, {
              progress,
              status: progress >= 100 ? "saving" : "working",
            }),
        });
      if (!openRef.current) return;
      patchRow(key, { status: "done", progress: 100, error: "" });
      if (insertOnUpload) {
        setInsertedIds((current) =>
          current.includes(asset.id) ? current : [...current, asset.id],
        );
      }
      setSelectedId(asset.id);
      setNotice(
        `${file.name} was uploaded and added to the Media Library.`,
      );
      onUploaded(asset);
    } catch (cause) {
      if ((cause as { name?: string } | null)?.name === "AbortError") return;
      const message =
        cause instanceof Error && cause.message
          ? cause.message
          : "The image could not be uploaded.";
      patchRow(key, { status: "error", error: message });
      setProblem(message);
    } finally {
      controllers.current.delete(key);
    }
  }

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    setNotice("");
    setProblem("");
    const batch = files.slice(0, 6);
    if (files.length > batch.length) {
      setProblem("Upload up to 6 images at a time.");
    }
    for (const file of batch) {
      const validation = mediaUploadError(file);
      if (validation) {
        setRows((current) => [
          ...current,
          {
            key: newKey(),
            name: file.name,
            file,
            status: "error",
            progress: 0,
            error: validation,
          },
        ]);
        setProblem(validation);
        continue;
      }
      await uploadOne(file);
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function retry(row: UploadRow) {
    setRows((current) => current.filter((entry) => entry.key !== row.key));
    void uploadOne(row.file);
  }

  const filters: { value: FormatFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "webp", label: "WebP" },
    { value: "jpeg", label: "JPEG" },
    { value: "png", label: "PNG" },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      className="media-library-dialog"
    >
      <div className="media-library">
        <div className="media-library__toolbar">
          <div className="media-library__search">
            <TextField
              id="media-library-search"
              label="Search Media Library"
              type="search"
              value={query}
              placeholder="Search by filename, alt text or caption"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="media-library__filters" role="group" aria-label="Filter by file type">
            {filters.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`button secondary${format === option.value ? " is-active" : ""}`}
                aria-pressed={format === option.value}
                onClick={() => setFormat(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className={`media-library__dropzone${dragging ? " is-over" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void handleFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div>
            <strong>Drag images here</strong>
            <p className="media-library__hint">
              WebP, JPEG or PNG · up to 5 MB each. Uploads are added to the shared Media Library.
            </p>
          </div>
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={16} aria-hidden="true" />
              Upload Images
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={MEDIA_UPLOAD_ACCEPT}
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void handleFiles(files);
              }}
            />
          </div>
        </div>

        {notice && <Notice success>{notice}</Notice>}
        {problem && <Notice error>{problem}</Notice>}

        {rows.length > 0 && (
          <ul className="media-library__uploads" aria-label="Upload progress">
            {rows.map((row) => (
              <li className={`media-upload-row status-${row.status}`} key={row.key}>
                <div className="media-upload-row__top">
                  <span className="media-upload-row__name">{row.name}</span>
                  <span className="media-upload-row__status" role="status" aria-live="polite">
                    {row.status === "done" ? (
                      <CheckCircle2 size={14} aria-hidden="true" />
                    ) : row.status === "error" ? (
                      <AlertCircle size={14} aria-hidden="true" />
                    ) : (
                      <LoaderCircle size={14} className="spin" aria-hidden="true" />
                    )}
                    {statusLabel(row)}
                  </span>
                </div>
                {(row.status === "working" || row.status === "saving") && (
                  <progress max={100} value={row.status === "saving" ? 100 : row.progress} />
                )}
                {row.error && (
                  <div className="media-upload-row__error">
                    <span>{row.error}</span>
                    <button type="button" className="text-link" onClick={() => retry(row)}>
                      Retry upload
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="media-library__layout">
          <div>
            {error && (
              <Notice error>
                {error}
                {onRetry && (
                  <button type="button" className="button secondary" onClick={onRetry}>
                    Retry loading
                  </button>
                )}
              </Notice>
            )}
            {loading && !library.length ? (
              <p role="status" aria-live="polite">Loading Media Library…</p>
            ) : visible.length ? (
              <div className="media-library__grid" aria-busy={uploading}>
                {visible.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    className="media-library-item"
                    aria-pressed={selectedId === asset.id}
                    onClick={() => setSelectedId(asset.id)}
                  >
                    <Picture
                      photo={{ src: asset.src, alt: asset.alt }}
                      sizes="(max-width: 900px) 45vw, 220px"
                    />
                    <span className="media-library-item__name">{asset.name}</span>
                    {insertOnUpload && insertedIds.includes(asset.id) && (
                      <span className="badge">Inserted</span>
                    )}
                  </button>
                ))}
              </div>
            ) : library.length ? (
              <Empty
                title="No images match this search"
                body="Try a different filename, alt text or file type."
              />
            ) : error ? null : (
              <Empty
                title="No images in the Media Library yet"
                body="Upload images above to add them to the library and insert them here."
              />
            )}
          </div>

          <aside className="media-library__detail" aria-live="polite">
            {selected ? (
              <>
                <Picture
                  photo={{ src: selected.src, alt: selected.alt }}
                  sizes="(max-width: 900px) 100vw, 360px"
                />
                <dl className="media-library__meta">
                  <div>
                    <dt>Filename</dt>
                    <dd>{selected.name}</dd>
                  </div>
                  <div>
                    <dt>Alt text</dt>
                    <dd>{selected.alt || "Not set"}</dd>
                  </div>
                  <div>
                    <dt>Caption</dt>
                    <dd>{selected.caption || "None"}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{selected.source || "—"}</dd>
                  </div>
                </dl>
                {insertOnUpload && insertedIds.includes(selected.id) && (
                  <p className="media-library__inserted">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    Uploaded and inserted into the article.
                  </p>
                )}
              </>
            ) : (
              <p className="media-picker-help">
                Select an image to preview it and check its filename, alt text and caption.
              </p>
            )}
          </aside>
        </div>

        <div className="media-library__footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button"
            disabled={!selected}
            onClick={() => {
              if (selected) onSelect(selected);
            }}
          >
            {selectLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
