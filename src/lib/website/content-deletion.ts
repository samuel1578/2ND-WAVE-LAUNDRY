import type { ContentItem } from "@/lib/contracts";

/**
 * Permanent deletion rules for admin-managed content.
 *
 * Every decision that can *refuse* a hard delete lives here as a pure function
 * with no server, database or framework dependency, so the rules can be unit
 * tested directly. The repository issues the matching delete statement only
 * after these checks pass, and reports the returned message verbatim.
 *
 * Deleting content never touches the Media Library: featured and inline images
 * are shared between records, so they stay in the library for other content to
 * reuse. Service deletion additionally stops before any row is removed when a
 * historical record still references the service.
 */

export type ContentDeletion =
  | { ok: true; key: string }
  | { ok: false; error: string };

const BLOG_MODULE = "Blog";
const SERVICE_MODULE = "Services";
const MAX_RECORD_KEY = 180;

/** A blog record is addressed by its slug: the `website_content` record key. */
export function blogDeletionTarget(
  item: ContentItem | null | undefined,
): ContentDeletion {
  const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
  if (!item || item.module !== BLOG_MODULE) {
    return {
      ok: false,
      error: "This article cannot be deleted. Reload the page and try again.",
    };
  }
  if (!slug || slug.length > MAX_RECORD_KEY) {
    return {
      ok: false,
      error:
        "This article could not be identified. Reload the page and try again.",
    };
  }
  return { ok: true, key: slug };
}

/**
 * A service is addressed by its immutable row id, so a slug edit never moves a
 * record and a seeded row without a stored id cannot be deleted from here.
 */
export function serviceDeletionTarget(
  item: ContentItem | null | undefined,
  recordId: string | null,
): ContentDeletion {
  if (!item || item.module !== SERVICE_MODULE) {
    return {
      ok: false,
      error: "This service cannot be deleted. Reload the page and try again.",
    };
  }
  if (!recordId) {
    return {
      ok: false,
      error:
        "This service could not be identified. Reload the page and try again.",
    };
  }
  return { ok: true, key: recordId };
}

/**
 * Bookings snapshot the name and slug of every service they use, so deleting a
 * service that any booking still references would strand that history. The
 * service is refused here and the administrator is told to archive it instead;
 * no booking row is ever rewritten or removed.
 */
export function serviceReferenceDeletionError(references: number): string {
  if (!Number.isFinite(references) || references <= 0) return "";
  return (
    "This service is used by existing bookings, so it cannot be permanently " +
    "deleted. Archive the service instead: booking history keeps the service " +
    "name and slug recorded when the request was made."
  );
}
