import type { MediaAsset } from "@/lib/contracts";

/**
 * Commits an already-uploaded storage object as a Media Library record.
 *
 * Uploading the file and persisting its metadata are two different systems, so a
 * metadata failure must not leave an untracked object in the bucket. The caller
 * supplies the cleanup action (remove the storage object) and this module removes
 * it before reporting failure. Cleanup errors are swallowed: a failure must never
 * be reported as success, and the caller logs the cleanup problem separately.
 */

export type UploadedMediaCommitInput = {
  asset: MediaAsset;
  storagePath: string;
};

export type UploadedMediaCommitDeps = {
  write: (asset: MediaAsset) => Promise<MediaAsset>;
  removeObject: (storagePath: string) => Promise<void>;
};

export type UploadedMediaCommitResult =
  | { ok: true; asset: MediaAsset }
  | { ok: false; message: string };

export const MEDIA_METADATA_FAILURE_MESSAGE =
  "The image could not be added to the Media Library, so the uploaded file was removed. Check the image details and try again.";

export async function commitUploadedMedia(
  input: UploadedMediaCommitInput,
  deps: UploadedMediaCommitDeps,
): Promise<UploadedMediaCommitResult> {
  try {
    const asset = await deps.write(input.asset);
    return { ok: true, asset };
  } catch {
    try {
      await deps.removeObject(input.storagePath);
    } catch {
      // The object may remain in the bucket; the caller logs it for operators.
    }
    return { ok: false, message: MEDIA_METADATA_FAILURE_MESSAGE };
  }
}
