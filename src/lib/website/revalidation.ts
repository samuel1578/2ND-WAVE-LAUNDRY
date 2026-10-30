import { revalidatePath } from "next/cache";

export function revalidatePublicPaths(
  paths: Array<string | [string, "page" | "layout"]>,
  revalidate: (path: string, type?: "page" | "layout") => void = revalidatePath,
): void {
  try {
    for (const path of paths) {
      if (Array.isArray(path)) revalidate(path[0], path[1]);
      else revalidate(path);
    }
  } catch (error) {
    console.error("Public website revalidation failed.", error);
  }
}

export async function writeAndRevalidate<T>(
  write: () => Promise<T>,
  paths: Array<string | [string, "page" | "layout"]>,
  revalidate: (path: string, type?: "page" | "layout") => void = revalidatePath,
): Promise<T> {
  const saved = await write();
  revalidatePublicPaths(paths, revalidate);
  return saved;
}
