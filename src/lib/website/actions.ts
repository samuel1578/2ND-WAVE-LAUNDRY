"use server";
import { headers } from "next/headers";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import type { ContentItem, FaqItem, GalleryCollection, GalleryPlacement, LocationRecord, PromotionRecord, Settings } from "@/lib/contracts";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { writeFaqs, writeContent, writePromotion, writeSettings, writeLocation, writeService, writeMedia, deleteMedia as deleteMediaRecord, deleteBlog, deleteService, reorderBlog } from "./repository";
import { writeGalleryWorkspace } from "./gallery-write";
import { galleryWorkspaceError } from "./gallery-collections";
import type { MediaAsset } from "@/lib/contracts";
import { supabaseConfig } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validatePromotionServiceSlug } from "./promotion-service-validation";
import { isBlogImageAlign, isBlogImageSize, isBlogTextStyle, isValidBlogSegments } from "./blog-blocks";
import { settingsForWrite } from "./settings-validation";
import { assertWebsiteWritesEnabled, consumeWebsiteWrite } from "./write-guard";
import { revalidatePublicPaths, writeAndRevalidate } from "./revalidation";
import { PUBLIC_WRITE_TAGS } from "./revalidation-tags";

function isMarketingAssetUrl(src: string, prefix: string): boolean {
  try {
    const url = new URL(src);
    const base = new URL(prefix);
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(base.pathname)
    ) return false;
    const path = decodeURIComponent(url.pathname.slice(base.pathname.length));
    return !!path && path.split("/").every((part) => part && part !== "." && part !== ".." && !part.includes("\\"));
  } catch {
    return false;
  }
}

async function actor(permission: "content.manage" | "media.manage" | "settings.manage") {
  const admin = await getCurrentAdmin();
  if (!admin) throw new Error("Sign in with an administrator account.");
  if (!hasPermission(admin.role, permission)) throw new Error("Your administrator role does not allow this action.");
  const h = await headers();
  const origin = checkRequestOrigin({ origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), siteUrl: process.env.SITE_URL });
  if (!origin.ok) throw new Error("This request could not be verified.");
  return admin;
}
export async function saveLiveFaqs(items: FaqItem[]) {
  await assertWebsiteWritesEnabled();
  const admin = await actor("content.manage");
  if (!Array.isArray(items) || items.length > 500) throw new Error("FAQ collection is invalid.");
  consumeWebsiteWrite(admin.userId);
  return writeAndRevalidate(
    () => writeFaqs(admin.userId, items),
    ["/", "/faq"],
    undefined,
    PUBLIC_WRITE_TAGS.faqs,
  );
}
export async function saveLiveGalleryWorkspace(
  input: { collections: GalleryCollection[]; placements: GalleryPlacement[] },
  previousVersions: {
    collections?: Record<string, number>;
    placements?: Record<string, number>;
  } = {},
) {
  await assertWebsiteWritesEnabled();
  const admin = await actor("content.manage");
  if (!input || !Array.isArray(input.collections) || !Array.isArray(input.placements)) {
    throw new Error("Gallery is invalid. Reload and try again.");
  }
  if (input.collections.length > 100 || input.placements.length > 500) {
    throw new Error("Gallery is too large.");
  }
  const versionMap = (value: Record<string, number> | undefined) => {
    if (value && (typeof value !== "object" || Array.isArray(value))) {
      throw new Error("Gallery version data is invalid. Reload and try again.");
    }
    const map: Record<string, number> = {};
    for (const [id, version] of Object.entries(value ?? {})) {
      if (!id || !Number.isSafeInteger(version) || version < 0) {
        throw new Error("Gallery version data is invalid. Reload and try again.");
      }
      map[id] = version;
    }
    return map;
  };
  const safeCollections: GalleryCollection[] = input.collections.map((collection) => ({
    id: String(collection.id ?? ""),
    name: String(collection.name ?? ""),
    description: String(collection.description ?? ""),
    order: Number(collection.order),
    visible: collection.visible === true,
    version: Number(collection.version),
  }));
  const safePlacements: GalleryPlacement[] = input.placements.map((placement) => ({
    id: String(placement.id ?? ""),
    mediaId: String(placement.mediaId ?? ""),
    alt: String(placement.alt ?? ""),
    caption: String(placement.caption ?? ""),
    order: Number(placement.order),
    visible: placement.visible === true,
    version: Number(placement.version),
    collectionKey: String(placement.collectionKey ?? ""),
  }));
  const validation = galleryWorkspaceError(safeCollections, safePlacements);
  if (validation) throw new Error(validation);
  const safePrevious = {
    collections: versionMap(previousVersions.collections),
    placements: versionMap(previousVersions.placements),
  };
  consumeWebsiteWrite(admin.userId);
  return writeAndRevalidate(
    () =>
      writeGalleryWorkspace(admin.userId, {
        collections: safeCollections,
        placements: safePlacements,
        previousCollectionVersions: safePrevious.collections,
        previousPlacementVersions: safePrevious.placements,
      }),
    ["/", "/gallery"],
    undefined,
    PUBLIC_WRITE_TAGS.gallery,
  );
}
export async function saveLiveBlogOrder(items: Array<{ id: string; version: number }>) {
  await assertWebsiteWritesEnabled();
  const admin = await actor("content.manage");
  if (!Array.isArray(items) || items.length > 500 || items.some((item) =>
    !item || typeof item.id !== "string" || item.id.length < 1 || item.id.length > 180 ||
    !Number.isInteger(item.version) || item.version < 1
  )) throw new Error("Article order is invalid. Reload the list and try again.");
  consumeWebsiteWrite(admin.userId);
  return writeAndRevalidate(
    () => reorderBlog(admin.userId, items),
    ["/", "/blog"],
    undefined,
    PUBLIC_WRITE_TAGS.content,
  );
}

export async function saveLiveContent(item: ContentItem, action: "draft" | "publish" | "archive" | "unpublish") {
  await assertWebsiteWritesEnabled();
  const admin = await actor("content.manage");
  const rawBlocks: unknown = item?.contentBlocks;
  const rawAuthor: unknown = item?.author;
  const validAuthor = rawAuthor === undefined || (
    !!rawAuthor && typeof rawAuthor === "object" && !Array.isArray(rawAuthor) &&
    typeof (rawAuthor as Record<string, unknown>).name === "string" &&
    ["bio", "image", "imageAlt", "imageMediaId"].every((key) => {
      const value = (rawAuthor as Record<string, unknown>)[key];
      return value === undefined || typeof value === "string";
    })
  );
  const validBlocks = rawBlocks === undefined || (
    Array.isArray(rawBlocks) &&
    rawBlocks.length <= 100 &&
    rawBlocks.every((block: unknown) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return false;
      const value = block as Record<string, unknown>;
      const validOrder = typeof value.order === "number" && Number.isFinite(value.order);
      const validStyle = value.style === undefined || isBlogTextStyle(value.style);
      const validAlign = value.align === undefined || isBlogImageAlign(value.align);
      const validSize = value.size === undefined || isBlogImageSize(value.size);
      return value.type === "text"
        ? typeof value.text === "string" && validOrder && validStyle &&
          isValidBlogSegments(value.segments)
        : value.type === "image" &&
        typeof value.mediaId === "string" &&
        typeof value.src === "string" &&
        typeof value.alt === "string" &&
        typeof value.caption === "string" &&
        validOrder &&
        validAlign &&
        validSize;
    })
  );
  if (
    !item ||
    !validAuthor ||
    !validBlocks ||
    item.module !== "Blog" ||
    typeof item.title !== "string" ||
    typeof item.slug !== "string" ||
    typeof item.summary !== "string" ||
    typeof item.body !== "string" ||
    typeof item.image !== "string" ||
    typeof item.alt !== "string" ||
    item.body.length > 50000 ||
    JSON.stringify(item).length > 80000
  ) {
    throw new Error("Article is invalid.");
  }
  if (action === "publish") {
    if (!item.title.trim() || !item.slug.trim() || !item.summary.trim() || !item.body.trim()) {
      throw new Error("Complete the title, slug, summary and article body before publishing.");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) {
      throw new Error("Use lowercase letters, numbers and hyphens for the article slug.");
    }
    if (item.image && !item.alt.trim()) {
      throw new Error("Add alt text to the featured image before publishing.");
    }
    if (item.contentBlocks?.some((block) => block.type === "image" && !block.alt.trim())) {
      throw new Error("Add alt text to every article image before publishing.");
    }
  }
  consumeWebsiteWrite(admin.userId);
  const saved = await writeContent(admin.userId, item, action);
  revalidatePublicPaths(
    ["/", "/blog", `/blog/${saved.slug}`],
    PUBLIC_WRITE_TAGS.content,
  );
  return saved;
}

/**
 * Permanently deletes one blog article.
 *
 * Only administrators holding `content.manage` may delete, the origin of the
 * request is verified, and the Media Library is left untouched: shared images
 * remain available to other content. The public blog is revalidated so the
 * article disappears from the website immediately.
 */
export async function deleteLiveBlog(item: ContentItem) {
  await assertWebsiteWritesEnabled();
  const admin = await actor("content.manage");
  if (
    !item ||
    item.module !== "Blog" ||
    typeof item.slug !== "string" ||
    item.slug.length > 180
  ) {
    throw new Error("Article is invalid.");
  }
  consumeWebsiteWrite(admin.userId);
  await deleteBlog(item);
  revalidatePublicPaths(
    ["/", "/blog", `/blog/${item.slug.trim()}`],
    PUBLIC_WRITE_TAGS.content,
  );
}
export async function saveLivePromotion(item: PromotionRecord) {
  await assertWebsiteWritesEnabled();
  const admin = await actor("content.manage");
  if (!item || JSON.stringify(item).length > 20000) throw new Error("Promotion is invalid.");
  const serviceSlug = await validatePromotionServiceSlug(item.serviceSlug, async (slug) => {
    const client = createSupabaseAdminClient();
    const { data, error } = await client
      .from("services")
      .select("slug")
      .eq("slug", slug)
      .eq("active", true)
      .eq("bookable", true)
      .maybeSingle();
    return !error && !!data;
  });
  const promotion = { ...item, serviceSlug };
  consumeWebsiteWrite(admin.userId);
  return writeAndRevalidate(
    () => writePromotion(admin.userId, promotion),
    ["/", "/about", "/preview"],
    undefined,
    PUBLIC_WRITE_TAGS.promotion,
  );
}
export async function saveLiveSettings(settings: Settings) {
  await assertWebsiteWritesEnabled();
  const admin = await actor("settings.manage");
  if (!settings || JSON.stringify(settings).length > 5000) throw new Error("Settings are invalid.");
  const safeSettings = settingsForWrite(settings);
  consumeWebsiteWrite(admin.userId);
  return writeAndRevalidate(
    () => writeSettings(admin.userId, safeSettings),
    [["/", "layout"]],
    undefined,
    PUBLIC_WRITE_TAGS.settings,
  );
}
export async function saveLiveLocation(location: LocationRecord) {
  await assertWebsiteWritesEnabled();
  const admin = await actor("content.manage");
  if (!location || location.hours.length > 14) throw new Error("Branch is invalid.");
  consumeWebsiteWrite(admin.userId);
  return writeAndRevalidate(
    () => writeLocation(admin.userId, location),
    [],
    undefined,
    PUBLIC_WRITE_TAGS.location,
  );
}
export async function saveLiveMedia(asset: MediaAsset, expectedVersion?: number) {
  await assertWebsiteWritesEnabled();
  const admin = await actor("media.manage");
  const prefix = supabaseConfig.ok
    ? new URL("/storage/v1/object/public/marketing-assets/", supabaseConfig.url).toString()
    : "";
  if (
    !asset ||
    typeof asset.src !== "string" ||
    !prefix ||
    !isMarketingAssetUrl(asset.src, prefix) ||
    typeof asset.alt !== "string" ||
    asset.alt.length > 1000 ||
    typeof asset.name !== "string" ||
    asset.name.length > 255
  ) {
    throw new Error("Marketing media must use an image in the marketing-assets storage bucket.");
  }
  consumeWebsiteWrite(admin.userId);
  return writeAndRevalidate(
    () => writeMedia(admin.userId, asset, expectedVersion),
    ["/", "/gallery"],
    undefined,
    PUBLIC_WRITE_TAGS.media,
  );
}

export async function deleteLiveMedia(id: string, uses: string[] = []) {
  await assertWebsiteWritesEnabled();
  const admin = await actor("media.manage");
  if (typeof id !== "string" || !id || !Array.isArray(uses)) {
    throw new Error("Marketing media selection is invalid.");
  }
  consumeWebsiteWrite(admin.userId);
  return writeAndRevalidate(
    () => deleteMediaRecord(id, uses),
    ["/", "/gallery"],
    undefined,
    PUBLIC_WRITE_TAGS.media,
  );
}
export async function saveLiveService(
  item: ContentItem,
  action: "draft" | "publish" | "archive" | "unpublish",
) {
  await assertWebsiteWritesEnabled();
  const admin = await actor("content.manage");
  if (
    !item ||
    item.module !== "Services" ||
    !["draft", "publish", "archive", "unpublish"].includes(action) ||
    typeof item.title !== "string" ||
    typeof item.slug !== "string" ||
    typeof item.summary !== "string" ||
    typeof item.body !== "string" ||
    typeof item.image !== "string" ||
    typeof item.alt !== "string" ||
    item.title.length > 120 ||
    item.summary.length > 2000 ||
    item.body.length > 50000 ||
    item.image.length > 2000 ||
    item.alt.length > 1000 ||
    !Number.isInteger(item.sort) ||
    item.sort < 0
  ) {
    throw new Error("Service is invalid.");
  }
  if (!item.title.trim()) throw new Error("Enter a title for this service.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) {
    throw new Error("Use lowercase letters, numbers and hyphens for the service slug.");
  }
  if (action === "publish" && !item.summary.trim()) {
    throw new Error("Add a summary before publishing this service.");
  }
  if (action === "publish" && item.image && !item.alt.trim()) {
    throw new Error("Add alt text to the featured image before publishing.");
  }
  consumeWebsiteWrite(admin.userId);
  return writeAndRevalidate(
    () => writeService(admin.userId, item, action),
    ["/", "/services", `/services/${item.slug}`],
    undefined,
    PUBLIC_WRITE_TAGS.service,
  );
}

/**
 * Permanently deletes one service from the catalogue.
 *
 * The repository refuses the delete when any booking still references the
 * service, and its error message explains that the service must be archived
 * instead, so historical booking records are never rewritten or removed.
 * Unreferenced services are deleted and the affected public pages revalidated.
 */
export async function deleteLiveService(item: ContentItem) {
  await assertWebsiteWritesEnabled();
  const admin = await actor("content.manage");
  if (
    !item ||
    item.module !== "Services" ||
    typeof item.slug !== "string" ||
    item.slug.length > 180
  ) {
    throw new Error("Service is invalid.");
  }
  consumeWebsiteWrite(admin.userId);
  await deleteService(item);
  revalidatePublicPaths(
    ["/", "/services", `/services/${item.slug}`],
    PUBLIC_WRITE_TAGS.service,
  );
}
