import test from "node:test";
import assert from "node:assert/strict";
import {
  commitUploadedMedia,
  MEDIA_METADATA_FAILURE_MESSAGE,
} from "../src/lib/website/media-upload-server";
import {
  mediaUploadError,
  suggestMediaAlt,
} from "../src/lib/website/media-upload";
import type { MediaAsset } from "../src/lib/contracts";

const asset: MediaAsset = {
  id: "6d1c2b7e-5b2a-4f0d-9c2f-7a1b2c3d4e5f",
  src: "https://example.test/storage/v1/object/public/marketing-assets/media/a.webp",
  name: "care-notes.webp",
  alt: "Care notes",
  caption: "",
  source: "Blog editor upload",
  permission: "Uploaded by administrator",
  uses: [],
  archived: false,
};

test("upload validation rejects unsupported formats and oversized images", () => {
  assert.equal(
    mediaUploadError({ name: "care.webp", type: "image/webp", size: 1024 }),
    "",
  );
  assert.match(
    mediaUploadError({ name: "care.svg", type: "image/svg+xml", size: 1024 }),
    /WebP, JPEG or PNG/,
  );
  assert.match(
    mediaUploadError({ name: "care.png", type: "image/png", size: 5_000_001 }),
    /5MB/,
  );
});

test("upload alt text is derived from a readable filename", () => {
  assert.equal(suggestMediaAlt("care-notes_2026.webp"), "care notes 2026");
  assert.equal(suggestMediaAlt(".webp"), "");
});

test("a metadata failure removes the uploaded object and never reports success", async () => {
  const removed: string[] = [];
  const result = await commitUploadedMedia(
    { asset, storagePath: "media/a.webp" },
    {
      write: async () => {
        throw new Error("database unavailable");
      },
      removeObject: async (path) => {
        removed.push(path);
      },
    },
  );
  assert.deepEqual(result, { ok: false, message: MEDIA_METADATA_FAILURE_MESSAGE });
  assert.deepEqual(removed, ["media/a.webp"]);
});

test("a successful metadata write keeps the storage object", async () => {
  let removed = 0;
  const saved: MediaAsset = { ...asset, version: 1 };
  const result = await commitUploadedMedia(
    { asset, storagePath: "media/a.webp" },
    {
      write: async () => saved,
      removeObject: async () => {
        removed += 1;
      },
    },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.asset, saved);
  assert.equal(removed, 0);
});

test("a cleanup failure still reports the upload as failed", async () => {
  const result = await commitUploadedMedia(
    { asset, storagePath: "media/a.webp" },
    {
      write: async () => {
        throw new Error("database unavailable");
      },
      removeObject: async () => {
        throw new Error("storage unavailable");
      },
    },
  );
  assert.equal(result.ok, false);
});
