import { revalidatePath, updateTag } from "next/cache";

type PathRevalidate = (path: string, type?: "page" | "layout") => void;
type TagInvalidate = (tag: string) => void;

/**
 * Invalidate cached public data.
 *
 * Next 16 requires a cacheLife profile for `revalidateTag` (e.g. `"max"`), which
 * serves stale content while refreshing in the background. Admin saves must be
 * visible on the next page load, so Server Actions use `updateTag(tag)` instead:
 * it expires the entry immediately and the next read blocks on fresh data.
 * `updateTag` is only valid inside a Server Action, which is where these run.
 */
export function revalidatePublicPaths(
  paths: Array<string | [string, "page" | "layout"]>,
  tags: readonly string[] = [],
  revalidate: PathRevalidate = revalidatePath,
  invalidate: TagInvalidate = updateTag,
): void {
  try {
    for (const path of paths) {
      if (Array.isArray(path)) revalidate(path[0], path[1]);
      else revalidate(path);
    }
    for (const tag of tags) invalidate(tag);
  } catch (error) {
    console.error("Public website revalidation failed.", error);
  }
}

export async function writeAndRevalidate<T>(
  write: () => Promise<T>,
  paths: Array<string | [string, "page" | "layout"]>,
  revalidate: PathRevalidate = revalidatePath,
  tags: readonly string[] = [],
  invalidate: TagInvalidate = updateTag,
): Promise<T> {
  const saved = await write();
  revalidatePublicPaths(paths, tags, revalidate, invalidate);
  return saved;
}
