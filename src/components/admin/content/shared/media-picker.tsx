"use client";
import { Dialog } from "@/components/dialog";
import { Empty, Picture } from "@/components/ui";
import { Notice } from "@/components/forms/controls";
import type { MediaAsset } from "@/lib/contracts";
import Link from "next/link";

export function MediaPicker({
  open,
  onClose,
  assets,
  onPick,
  multi = false,
  selectedIds = [],
  onToggle,
  onConfirm,
  title = "Select Media",
  confirmLabel = "Add Images",
  loading = false,
  error = "",
  onRetry,
}: {
  open: boolean;
  onClose: () => void;
  assets: MediaAsset[];
  onPick?: (asset: MediaAsset) => void;
  multi?: boolean;
  selectedIds?: string[];
  onToggle?: (asset: MediaAsset) => void;
  onConfirm?: () => void;
  title?: string;
  confirmLabel?: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {multi && assets.length > 0 && !loading && !error && (
        <p className="media-picker-help">Select the images you want to add.</p>
      )}
      {loading ? (
        <p role="status" aria-live="polite">Loading Media Library…</p>
      ) : error ? (
        <div>
          <Notice error>{error}</Notice>
          {onRetry && (
            <button type="button" className="button secondary" onClick={onRetry}>
              Retry loading
            </button>
          )}
        </div>
      ) : assets.length ? (
        <div className="grid two">
          {assets.map((media) => {
            const selected = selectedIds.includes(media.id);
            return (
              <button
                className="media-picker-item"
                type="button"
                key={media.id}
                aria-pressed={multi ? selected : undefined}
                onClick={() => (multi ? onToggle?.(media) : onPick?.(media))}
              >
                <Picture
                  photo={{ src: media.src, alt: media.alt }}
                  sizes="(max-width: 700px) 42vw, 240px"
                />
                <span>
                  {media.name}
                  {multi && selected ? "Selected" : ""}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty title="No marketing media uploaded yet.">
          <Link className="button" href="/admin/media/upload">
            Upload media
          </Link>
        </Empty>
      )}
      {multi && (
        <div className="actions">
          <button
            type="button"
            className="button"
            disabled={loading || !!error || !selectedIds.length}
            onClick={() => onConfirm?.()}
          >
            {confirmLabel}{selectedIds.length ? ` (${selectedIds.length})` : ""}
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      )}
    </Dialog>
  );
}
