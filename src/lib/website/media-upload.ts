import { optimizeImage } from "@/lib/images/optimize";
import type { MediaAsset } from "@/lib/contracts";

/** Browser-side media upload helpers shared by every admin Media Library picker. */

export const MEDIA_UPLOAD_ACCEPT = "image/webp,image/jpeg,image/png";
export const MEDIA_UPLOAD_MAX_BYTES = 5_000_000;
export const MEDIA_UPLOAD_SOURCE = "Blog editor upload";
export const MEDIA_UPLOAD_PERMISSION = "Uploaded by administrator";

/** Readable alt text suggestion derived from the original filename. */
export function suggestMediaAlt(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mediaUploadError(
  file: Pick<File, "name" | "type" | "size">,
): string {
  if (!file.name.trim()) return "Choose an image file with a filename.";
  if (file.size > MEDIA_UPLOAD_MAX_BYTES)
    return "Each image must be 5MB or smaller.";
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "Choose a WebP, JPEG or PNG image.";
  return "";
}

type UploadResponse = {
  asset?: MediaAsset;
  publicUrl?: string;
  message?: string;
};

/**
 * Optimises the image in the browser, then uploads the bytes and persists the
 * Media Library record in one request. The request only resolves when both the
 * storage write and the metadata write succeeded; the server removes the stored
 * object if metadata persistence fails, so a failed upload never reports success.
 */
export async function uploadMediaAsset(input: {
  file: File;
  alt: string;
  caption: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<MediaAsset> {
  if (input.signal?.aborted) {
    throw new DOMException("Upload cancelled", "AbortError");
  }
  const optimized = await optimizeImage(input.file);
  if (input.signal?.aborted) {
    throw new DOMException("Upload cancelled", "AbortError");
  }
  return new Promise<MediaAsset>((resolve, reject) => {
    const form = new FormData();
    form.set("file", optimized);
    form.set("name", input.file.name);
    form.set("alt", input.alt);
    form.set("caption", input.caption);
    form.set("source", MEDIA_UPLOAD_SOURCE);
    form.set("permission", MEDIA_UPLOAD_PERMISSION);

    const request = new XMLHttpRequest();
    request.open("POST", "/api/admin/website-media");
    request.responseType = "json";
    const abort = () => request.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    const finish = () => input.signal?.removeEventListener("abort", abort);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        input.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () => {
      finish();
      reject(
        new Error(
          "The image could not be uploaded. Check your connection and try again.",
        ),
      );
    };
    request.onabort = () => {
      finish();
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    request.onload = () => {
      finish();
      const body = (request.response ?? {}) as UploadResponse;
      if (request.status >= 200 && request.status < 300 && body.asset) {
        resolve(body.asset);
        return;
      }
      reject(
        new Error(
          body.message ||
            "The image could not be uploaded. It was not added to the Media Library.",
        ),
      );
    };
    request.send(form);
  });
}
