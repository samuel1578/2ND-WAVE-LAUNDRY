"use client";
import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Image from "next/image";
import { photos } from "@/lib/content";
import { Picture, Empty } from "./ui";
import { Dialog } from "./dialog";
import { CascadeSlider } from "./cascade-slider";
import { demoMode } from "@/lib/demo-mode";
import {
  dedupeGalleryPhotos,
  type PublicGallery,
  type PublicGalleryPhoto,
} from "@/lib/website/public-queries";

const demoGallery: PublicGalleryPhoto[] = (photos.batch_14_gallery || [])
  .filter((p) => !/logo/i.test(p.alt))
  .map((photo) => ({ ...photo, mediaId: photo.src, collections: [] }));

const emptyGallery: PublicGallery = { collections: [], photos: [] };

/**
 * Gallery grid. The server passes published collections and their placements,
 * so this component never fetches the gallery endpoint and never infers a
 * category from alt text: filters are built from stored collection records.
 */
export function Gallery({ gallery }: { gallery?: PublicGallery } = {}) {
  const source = demoMode
    ? { collections: [], photos: demoGallery }
    : (gallery ?? emptyGallery);
  const [active, setActive] = useState("all");
  const [index, setIndex] = useState<number | null>(null);
  const filters = [
    { id: "all", name: "All" },
    ...source.collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
    })),
  ];
  const filtered = dedupeGalleryPhotos(
    active === "all"
      ? source.photos
      : source.photos.filter((photo) => photo.collections.includes(active)),
  );
  const activeFilter =
    active === "all"
      ? undefined
      : source.collections.find((collection) => collection.id === active);
  const current = index !== null ? filtered[index] : undefined;
  return (
    <>
      <div className="filters" role="group" aria-label="Gallery category">
        {filters.map((filter) => (
          <button
            className={active === filter.id ? "active" : ""}
            aria-pressed={active === filter.id}
            key={filter.id}
            onClick={() => {
              setActive(filter.id);
              setIndex(null);
            }}
          >
            {filter.name}
          </button>
        ))}
      </div>
      {activeFilter?.description ? (
        <p className="muted">{activeFilter.description}</p>
      ) : null}
      {filtered.length ? (
        <CascadeSlider key={active} label="Gallery images">
          {filtered.map((photo, i) => (
            <button
              key={photo.mediaId + i}
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
        {current && (
          <>
            <div className="lightbox-image">
              <Image
                src={current.src}
                fill
                alt={current.alt}
                sizes="90vw"
                quality={85}
              />
            </div>
            <p>{current.alt}</p>
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
