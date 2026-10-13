"use client";

/**
 * Customer-attached image panel (Sprint 2C refinement).
 *
 * Renders the photos a customer attached to their booking, with a zoomable
 * viewer for inspecting detail.
 *
 * Bytes are never loaded until they are wanted: the panel asks the authorised
 * endpoint for a short-lived signed URL only when a photo is about to be shown,
 * and again when the viewer is opened. Nothing here knows a bucket name or an
 * object key — the endpoint returns only display metadata and a URL that is a
 * bearer credential, so responses are held in memory and never logged.
 *
 * Every photo state is truthful: a booking with no photos says so, a photo
 * whose retention has lapsed or whose object is gone reports an error rather
 * than a broken image, and a failed load offers a retry.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut, X } from "lucide-react";
import type { AdminBookingPhoto } from "@/lib/bookings/admin";

type PhotoAccess = {
  url: string;
  width: number | null;
  height: number | null;
};

type LoadedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; access: PhotoAccess }
  | { status: "error" };

/** Zoom limits keep the whole image recoverable and stop runaway magnification. */
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.5;

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  return `${(bytes / 1_000_000).toFixed(1)}MB`;
}

async function fetchPhotoAccess(
  bookingId: string,
  photoId: string,
  signal: AbortSignal,
): Promise<PhotoAccess | null> {
  const response = await fetch(
    `/api/admin/bookings/${encodeURIComponent(bookingId)}/photos/${encodeURIComponent(photoId)}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as {
    photo?: { url?: string; width?: number | null; height?: number | null };
  };
  if (!data.photo?.url) return null;
  return {
    url: data.photo.url,
    width: data.photo.width ?? null,
    height: data.photo.height ?? null,
  };
}

export function BookingImagePanel({
  bookingId,
  photos,
}: {
  bookingId: string;
  photos: AdminBookingPhoto[];
}) {
  const [states, setStates] = useState<Record<string, LoadedState>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());

  const load = useCallback(
    async (photoId: string, force = false) => {
      if (!force && controllers.current.has(photoId)) return;
      controllers.current.get(photoId)?.abort();
      setStates((current) => ({ ...current, [photoId]: { status: "loading" } }));
      const controller = new AbortController();
      controllers.current.set(photoId, controller);
      try {
        const access = await fetchPhotoAccess(bookingId, photoId, controller.signal);
        if (controller.signal.aborted) return;
        controllers.current.delete(photoId);
        setStates((current) => ({
          ...current,
          [photoId]: access
            ? { status: "ready", access }
            : { status: "error" },
        }));
      } catch {
        if (controller.signal.aborted) return;
        controllers.current.delete(photoId);
        setStates((current) => ({ ...current, [photoId]: { status: "error" } }));
      }
    },
    [bookingId],
  );

  const photoIds = photos.map((photo) => photo.id).join(",");

  useEffect(() => {
    const requests = controllers.current;
    setStates({});
    requests.forEach((controller) => controller.abort());
    requests.clear();
    setActiveId(null);
    if (photoIds) photoIds.split(",").forEach((photoId) => void load(photoId));
    return () => {
      requests.forEach((controller) => controller.abort());
      requests.clear();
    };
  }, [bookingId, photoIds, load]);

  const markUnavailable = useCallback((photoId: string) => {
    setStates((current) => ({ ...current, [photoId]: { status: "error" } }));
  }, []);

  return (
    <section className="panel">
      <h2>Customer-attached image</h2>
      {photos.length === 0 ? (
        <p className="muted">No image attached to this booking.</p>
      ) : (
        <ul className="image-thumbs" role="list">
          {photos.map((photo) => {
            const state = states[photo.id] ?? { status: "idle" };
            return (
              <li key={photo.id}>
                <button
                  type="button"
                  className="image-thumb"
                  disabled={state.status !== "ready"}
                  aria-label={`Open image ${photos.indexOf(photo) + 1} of ${photos.length} in the viewer`}
                  onClick={() => {
                    if (state.status === "ready") {
                      setActiveId(photo.id);
                      void load(photo.id, true);
                    }
                  }}
                >
                  {state.status === "ready" ? (
                    // The signed URL is a bearer credential, so it is loaded
                    // lazily and never passed to the image optimiser, which
                    // would cache it beyond its lifetime.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={state.access.url}
                      alt={`Customer-attached image ${photos.findIndex((p) => p.id === photo.id) + 1}`}
                      width={state.access.width ?? undefined}
                      height={state.access.height ?? undefined}
                      loading="lazy"
                      onError={() => markUnavailable(photo.id)}
                    />
                  ) : (
                    <span className="image-thumb__status" aria-live="polite">
                      {state.status === "loading"
                        ? "Loading…"
                        : state.status === "error"
                          ? "Unavailable"
                          : ""}
                    </span>
                  )}
                </button>
                {state.status === "error" && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => void load(photo.id, true)}
                  >
                    Retry image {photos.indexOf(photo) + 1}
                  </button>
                )}
                <small className="muted">
                  {formatBytes(photo.byteSize)}
                  {photo.width && photo.height
                    ? ` · ${photo.width}×${photo.height}px`
                    : ""}
                </small>
              </li>
            );
          })}
        </ul>
      )}
      {activeId &&
        (() => {
          const photo = photos.find((p) => p.id === activeId);
          if (!photo) return null;
          const state = states[photo.id] ?? { status: "idle" };
          if (state.status !== "ready") return null;
          return (
            <ImageViewer
              access={state.access}
              alt={`Customer-attached image ${photos.findIndex((p) => p.id === photo.id) + 1}`}
              onClose={() => setActiveId(null)}
              onImageError={() => markUnavailable(photo.id)}
            />
          );
        })()}
    </section>
  );
}

/**
 * A modal lightbox with zoom, pan and a reset-to-fit control.
 *
 * Escape and the close control both dismiss it, focus is returned to the
 * element that opened it, and the zoom floor is always fit-to-screen so the
 * image can never be stranded outside the viewport.
 */
function ImageViewer({
  access,
  alt,
  onClose,
  onImageError,
}: {
  access: PhotoAccess;
  alt: string;
  onClose: () => void;
  onImageError: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    frameRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus();
    };
  }, []);

  // Zoom towards the pointer so the point under the cursor stays put.
  const clamp = useCallback((next: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)), []);

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const frame = frameRef.current;
      setZoom((current) => {
        const next = clamp(current * factor);
        if (next === current) return current;
        const rect = frame?.getBoundingClientRect();
        if (!rect || clientX === undefined || clientY === undefined) return next;
        const px = clientX - rect.left - rect.width / 2;
        const py = clientY - rect.top - rect.height / 2;
        const ratio = next / current;
        setOffset((o) => ({
          x: px - (px - o.x) * ratio,
          y: py - (py - o.y) * ratio,
        }));
        return next;
      });
    },
    [clamp],
  );

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      tabIndex={-1}
      ref={frameRef}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      onWheel={(e) => {
        if (!e.ctrlKey && Math.abs(e.deltaY) < 2) return;
        zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX, e.clientY);
      }}
    >
      <div className="image-viewer__bar">
        <button type="button" onClick={() => zoomAt(1 / ZOOM_STEP)} aria-label="Zoom out">
          <ZoomOut aria-hidden="true" />
        </button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomAt(ZOOM_STEP)} aria-label="Zoom in">
          <ZoomIn aria-hidden="true" />
        </button>
        <button type="button" onClick={reset} aria-label="Reset to fit">
          <RotateCcw aria-hidden="true" />
        </button>
        <button type="button" onClick={onClose} aria-label="Close viewer">
          <X aria-hidden="true" />
        </button>
      </div>
      <div
        className="image-viewer__stage"
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag) return;
          setOffset({ x: drag.ox + (e.clientX - drag.x), y: drag.oy + (e.clientY - drag.y) });
        }}
        onPointerUp={(e) => {
          dragRef.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={access.url}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? "grab" : "zoom-in",
          }}
          onDoubleClick={() => (zoom > 1 ? reset() : zoomAt(ZOOM_STEP))}
          onError={onImageError}
        />
      </div>
    </div>
  );
}
