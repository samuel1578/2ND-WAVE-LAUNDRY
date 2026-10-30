"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { photos } from "@/lib/content";
import { Picture, Empty } from "./ui";
import { Dialog } from "./dialog";
import { CascadeSlider } from "./cascade-slider";
import { demoMode } from "@/lib/demo-mode";
const gallery = (photos.batch_14_gallery || []).filter(
  (p) => !/logo/i.test(p.alt),
);
export function Gallery() {
  const [filter, setFilter] = useState("All");
  const [index, setIndex] = useState<number | null>(null);
  const [liveGallery, setLiveGallery] = useState<typeof gallery | null>(null);
  useEffect(() => {
    if (demoMode) return;
    fetch("/api/website?module=gallery", { cache: "no-store" })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("Gallery unavailable")))
      .then(body => setLiveGallery((body.items ?? []).map((item: { src: string; alt: string }) => ({ src: item.src, alt: item.alt }))))
      .catch(() => setLiveGallery([]));
  }, []);
  const sourceGallery = demoMode ? gallery : (liveGallery ?? []);
  const filtered = sourceGallery.filter(
    (p) =>
      filter === "All" ||
      (filter === "Garments"
        ? /shirt|suit|garment|shoe/i.test(p.alt)
        : filter === "Laundry"
          ? !/branch|exterior|store/i.test(p.alt)
          : /branch|exterior|store/i.test(p.alt)),
  );
  const active = index !== null ? filtered[index] : undefined;
  useEffect(() => {
    if (index === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight")
        setIndex((i) => (i === null ? null : (i + 1) % filtered.length));
      if (e.key === "ArrowLeft")
        setIndex((i) =>
          i === null ? null : (i - 1 + filtered.length) % filtered.length,
        );
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, filtered.length]);
  return (
    <>
      <div className="filters" role="group" aria-label="Gallery category">
        {["All", "Laundry", "Garments", "Branches"].map((f) => (
          <button
            className={filter === f ? "active" : ""}
            aria-pressed={filter === f}
            key={f}
            onClick={() => {
              setFilter(f);
              setIndex(null);
            }}
          >
            {f}
          </button>
        ))}
      </div>
      {filtered.length ? (
        <CascadeSlider key={filter} label="Gallery images">
          {filtered.map((photo, i) => (
            <button
              key={photo.src + i}
              type="button"
              className="gallery-slide"
              onClick={() => setIndex(i)}
              aria-label={`Open image: ${photo.alt}`}
            >
              <Picture
                photo={photo}
                sizes="(max-width: 700px) 82vw, (max-width: 1100px) 40vw, 360px"
              />
            </button>
          ))}
        </CascadeSlider>
      ) : (
        <Empty title="No images in this category yet." />
      )}
      <Dialog
        title="Image viewer"
        open={index !== null}
        onClose={() => setIndex(null)}
        className="lightbox"
      >
        {active && (
          <>
            <div className="lightbox-image">
              <Image src={active.src} fill alt={active.alt} sizes="90vw" quality={85} />
            </div>
            <p>{active.alt}</p>
            <div className="split">
              <button
                className="icon-button"
                aria-label="Previous image"
                onClick={() =>
                  setIndex((i) =>
                    i === null
                      ? null
                      : (i - 1 + filtered.length) % filtered.length,
                  )
                }
              >
                <ArrowLeft />
              </button>
              <span>
                {(index ?? 0) + 1} / {filtered.length}
              </span>
              <button
                className="icon-button"
                aria-label="Next image"
                onClick={() =>
                  setIndex((i) =>
                    i === null ? null : (i + 1) % filtered.length,
                  )
                }
              >
                <ArrowRight />
              </button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}
