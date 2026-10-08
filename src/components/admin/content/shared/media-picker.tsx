"use client";
import { Dialog } from "@/components/dialog";
import { Empty, Picture } from "@/components/ui";
import type { MediaAsset } from "@/lib/contracts";
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
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="grid two">
        {assets.map((m) => {
          const selected = selectedIds.includes(m.id);
          return (
            <button
              className="media-picker-item"
              type="button"
              key={m.id}
              aria-pressed={multi ? selected : undefined}
              onClick={() =>
                multi ? onToggle?.(m) : onPick?.(m)
              }
            >
              <Picture photo={{ src: m.src, alt: m.alt }} />
              <span>
                {m.name}
                {multi && selected ? " — selected" : ""}
              </span>
            </button>
          );
        })}
      </div>
      {!assets.length && (
        <Empty title="No marketing media uploaded yet." />
      )}
      {multi && (
        <div className="actions">
          <button
            type="button"
            className="button"
            disabled={!selectedIds.length}
            onClick={() => onConfirm?.()}
          >
            {confirmLabel}
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      )}
    </Dialog>
  );
}
