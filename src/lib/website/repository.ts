import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseConfig } from "@/lib/supabase/config";
import { promotionImageError } from "./promotion-image";
import { promotionCtaError } from "@/lib/rules";
import type { ContentItem, FaqItem, LocationRecord, MediaAsset, PromotionRecord, Settings } from "@/lib/contracts";
import { buildBlogPayload, blogMediaIds } from "./blog-content";
import { blogDeletionTarget, serviceDeletionTarget, serviceReferenceDeletionError } from "./content-deletion";
import { sortBlogItems } from "./blog-order";
import { defaultSettings, toContent, toFaq, toGallery, toPromotion, type PublicSettings } from "./types";

const fail = (message = "The website content service is unavailable."): never => { throw new Error(message); };
const isConflict = (e?: { code?: string } | null) => e?.code === "PT409" || e?.code === "40001";
type RpcContentRow = { id: string; key: string; payload: Record<string, unknown>; published: boolean; sort_order: number; version: number };
type MediaRow = { id: string; public_url: string; name: string; alt: string; caption: string; source: string; permission: string; archived: boolean; version: number };
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameJson(value, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameJson(left[key], right[key]));
}
const mapSettings = (row: Record<string, unknown> | null): PublicSettings => row ? {
  email: String(row.business_email ?? ""), phone: String(row.phone), whatsapp: String(row.whatsapp), instagram: String(row.instagram), tiktok: String(row.tiktok), facebook: String(row.facebook), newsletter: Boolean(row.newsletter_visible),
  acceptBookings: Boolean(row.accept_public_bookings ?? true), start: String(row.pickup_start ?? "07:00").slice(0, 5), end: String(row.pickup_end ?? "17:00").slice(0, 5), cutoff: String(row.express_cutoff ?? "11:00").slice(0, 5), version: Number(row.version ?? 1),
} : defaultSettings;

const marketingAssetsPrefix = supabaseConfig.ok
  ? new URL("/storage/v1/object/public/marketing-assets/", supabaseConfig.url).toString()
  : "";

function marketingStoragePath(src: string): string | null {
  if (!marketingAssetsPrefix) return null;
  try {
    const url = new URL(src);
    const base = new URL(marketingAssetsPrefix);
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(base.pathname)
    ) return null;
    const path = decodeURIComponent(url.pathname.slice(base.pathname.length));
    if (!path || path.split("/").some((part) => !part || part === "." || part === ".." || part.includes("\\"))) return null;
    return path;
  } catch {
    return null;
  }
}

async function removeMarketingStorageObject(client: ReturnType<typeof createSupabaseAdminClient>, src: string): Promise<void> {
  const path = marketingStoragePath(src);
  if (!path) return;
  try {
    const { error } = await client.storage.from("marketing-assets").remove([path]);
    if (error) console.error("Marketing media storage cleanup failed.", error);
  } catch (error) {
    console.error("Marketing media storage cleanup failed.", error);
  }
}

function containsString(value: unknown, target: string): boolean {
  if (typeof value === "string") return value === target;
  if (Array.isArray(value)) return value.some((entry) => containsString(entry, target));
  if (value && typeof value === "object") return Object.values(value).some((entry) => containsString(entry, target));
  return false;
}
export async function readPublicSettings(): Promise<PublicSettings> {
  const client = createSupabaseAdminClient();
  const [site, booking] = await Promise.all([
    client.from("public_site_settings").select("business_email,phone,whatsapp,instagram,tiktok,facebook,newsletter_visible,version").eq("id", true).maybeSingle(),
    client.from("booking_settings").select("accept_public_bookings,pickup_start,pickup_end,express_cutoff,version").eq("id", true).maybeSingle(),
  ]);
  if (site.error || booking.error || !site.data || !booking.data) return fail();
  return mapSettings({ ...site.data, ...booking.data, version: site.data.version });
}
export async function readPublicContent(module: string) {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.from("website_content").select("id,module,record_key,payload,published,sort_order,version").eq("module", module).eq("published", true).order("sort_order", { ascending: true });
  if (error || !Array.isArray(data)) return fail();
  return data as unknown as Array<{ id: string; module: string; record_key: string; payload: Record<string, unknown>; published: boolean; sort_order: number; version: number }>;
}
export async function readPublicGallery() {
  const client = createSupabaseAdminClient();
  const [galleryResult, mediaResult] = await Promise.all([
    client.from("website_content").select("id,record_key,payload,published,sort_order,version").eq("module", "gallery").eq("published", true).order("sort_order", { ascending: true }).order("record_key", { ascending: true }),
    client.from("website_gallery_media").select("id,public_url,name,alt,caption,source,permission,archived"),
  ]);
  if (galleryResult.error || mediaResult.error || !Array.isArray(galleryResult.data)) return fail();
  const mediaById = Object.fromEntries((mediaResult.data ?? []).map(media => [media.id, media]));
  return galleryResult.data.map(r => {
    const media = mediaById[String(r.payload.media_id ?? "")];
    return toGallery({ id: r.id, key: r.record_key, module: "gallery", payload: r.payload, published: r.published, sort_order: r.sort_order, version: r.version }, media ? { [media.id]: media } : {});
  }).filter(row => row.visible && row.asset && !row.asset.archived);
}
export async function readAdminContent() {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.from("website_content").select("id,module,record_key,payload,published,sort_order,version").order("sort_order", { ascending: true });
  if (error || !Array.isArray(data)) return fail();
  return data as unknown as Array<{ id: string; module: string; record_key: string; payload: Record<string, unknown>; published: boolean; sort_order: number; version: number }>;
}
export async function readAdminMedia(): Promise<MediaAsset[]> {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.from("website_gallery_media").select("id,storage_path,public_url,name,alt,caption,source,permission,archived,version").order("created_at", { ascending: false });
  if (error || !Array.isArray(data)) return fail();
  return (data as unknown as MediaRow[]).map(r => ({ id: r.id, src: r.public_url, name: r.name, alt: r.alt, caption: r.caption, source: r.source, permission: r.permission, uses: [], archived: r.archived, version: r.version }));
}
export async function writeFaqs(actor: string, items: FaqItem[]) {
  const client = createSupabaseAdminClient();
  const rows = items.map((f, i) => ({ key: f.id, payload: { question: f.question, answer: f.answer, glow: f.glow, enabled: f.enabled }, published: true, sort_order: i + 1 }));
  const expected = Object.fromEntries(items.map(f => [f.id, f.version]));
  const { data, error } = await client.rpc("website_content_replace", { p_actor: actor, p_module: "faq", p_items: rows, p_expected_versions: expected });
  if (isConflict(error)) {
    const current = await client.from("website_content").select("id,record_key,payload,published,sort_order,version").eq("module", "faq").order("sort_order");
    if (!current.error && Array.isArray(current.data) && current.data.length === rows.length) {
      const matches = current.data.every((row, i) => {
        const wanted = rows[i];
        return row.record_key === wanted.key
          && row.published === wanted.published
          && row.sort_order === wanted.sort_order
          && JSON.stringify(row.payload) === JSON.stringify(wanted.payload);
      });
      if (matches) {
        return current.data.map(r => toFaq({ id: r.record_key, key: r.record_key, module: "faq", payload: r.payload as Record<string, unknown>, published: r.published, sort_order: r.sort_order, version: r.version }));
      }
    }
    return fail("FAQs changed while editing. The latest saved version is different; reload the page before trying again.");
  }
  if (error) return fail(error.code === "55P03" ? "Another website content save is still finishing. Wait a few seconds and retry." : `FAQs could not be saved. ${error.message ?? ""}`.trim());
  return (data as RpcContentRow[]).map(r => toFaq({ id: r.key, key: r.key, module: "faq", payload: r.payload, published: r.published, sort_order: r.sort_order, version: r.version }));
}
export async function writeContent(actor: string, item: ContentItem, action: "draft" | "publish" | "archive" | "unpublish") {
  const client = createSupabaseAdminClient();
  let trustedItem = item;
  if (item.version > 0) {
    const { data: stored, error: storedError } = await client
      .from("website_content")
      .select("id,record_key,payload,published,sort_order,version")
      .eq("module", "blog")
      .eq("record_key", item.slug)
      .maybeSingle();
    if (storedError) return fail("The saved article could not be verified. Reload and try again.");
    if (stored && stored.version === item.version) {
      const saved = toContent({
        id: stored.id,
        key: stored.record_key,
        module: "blog",
        payload: stored.payload as Record<string, unknown>,
        published: stored.published,
        sort_order: stored.sort_order,
        version: stored.version,
      });
      trustedItem = {
        ...item,
        published: saved.published,
        publishedAt: saved.publishedAt,
        modifiedAt: saved.modifiedAt,
      };
    } else if (!stored) {
      trustedItem = { ...item, published: undefined, publishedAt: undefined, modifiedAt: undefined };
    }
  } else {
    trustedItem = { ...item, published: undefined, publishedAt: undefined, modifiedAt: undefined };
  }
  if (trustedItem.version === 0 && trustedItem.sort === 0) {
    const { data: last, error: orderError } = await client
      .from("website_content")
      .select("sort_order")
      .eq("module", "blog")
      .order("sort_order", { ascending: false })
      .order("record_key", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (orderError) return fail("The article order could not be determined. Reload and try again.");
    trustedItem = { ...trustedItem, sort: Number(last?.sort_order ?? 0) + 1 };
  }
  const { payload, published } = buildBlogPayload(trustedItem, action);
  const mediaIds = blogMediaIds(trustedItem);
  if (mediaIds.length) {
    const { data: media, error: mediaError } = await client
      .from("website_gallery_media")
      .select("id")
      .in("id", mediaIds)
      .eq("archived", false);
    if (mediaError || media?.length !== mediaIds.length) {
      return fail("Choose images from the active Media Library before saving this article.");
    }
  }
  const { data, error } = await client.rpc("website_content_upsert", { p_actor: actor, p_module: "blog", p_key: trustedItem.slug, p_payload: payload, p_published: published, p_sort_order: trustedItem.sort, p_expected_version: trustedItem.version || null });
  if (isConflict(error)) {
    const current = await client.from("website_content").select("id,record_key,payload,published,sort_order,version").eq("module", "blog").eq("record_key", trustedItem.slug).maybeSingle();
    if (!trustedItem.version && current.data) return fail("That article slug is already in use. Choose a different title.");
    if (!current.error && current.data && current.data.published === published && current.data.sort_order === item.sort && sameJson(current.data.payload, payload)) {
      return toContent({ id: current.data.record_key, key: current.data.record_key, module: "blog", payload: current.data.payload, published: current.data.published, sort_order: current.data.sort_order, version: current.data.version });
    }
  }
  if (error) return fail(isConflict(error) ? "Article changed while editing. Reload and try again." : "Article could not be saved.");
  return toContent({ id: data.id, key: data.key, module: "blog", payload: data.payload, published: data.published, sort_order: data.sort_order, version: data.version });
}
export async function reorderBlog(actor: string, items: Array<{ id: string; version: number }>) {
  const client = createSupabaseAdminClient();
  const payload = items.map((item) => ({ key: item.id, version: item.version }));
  const { data, error } = await client.rpc("website_blog_reorder", {
    p_actor: actor,
    p_items: payload,
  });
  if (error) return fail(isConflict(error) ? "Articles changed while sorting. Reload the list and try again." : "Article order could not be saved.");
  const rows = (Array.isArray(data) ? data : []) as RpcContentRow[];
  const articles: ContentItem[] = rows.map((row) => toContent({
    id: row.id,
    key: row.key,
    module: "blog",
    payload: row.payload,
    published: row.published,
    sort_order: row.sort_order,
    version: row.version,
  }));
  return sortBlogItems(articles, (item) => ({ order: item.sort, id: item.id }));
}

export async function writePromotion(actor: string, item: PromotionRecord) {
  const ctaError = promotionCtaError(item);
  if (ctaError) throw new Error(ctaError);
  const imageError = promotionImageError(item, supabaseConfig.ok ? supabaseConfig.url : "");
  if (imageError) throw new Error(imageError);
  const client = createSupabaseAdminClient();
  const payload = { ...item };
  const isPublished = item.enabled && item.yearConfirmed && ["active", "scheduled"].includes(item.status);
  const { data, error } = await client.rpc("website_content_upsert", { p_actor: actor, p_module: "promotion", p_key: item.id || crypto.randomUUID(), p_payload: payload, p_published: isPublished, p_sort_order: item.priority, p_expected_version: item.version || null });
  if (isConflict(error) && item.id) {
    const current = await client.from("website_content").select("id,record_key,payload,published,sort_order,version").eq("module", "promotion").eq("record_key", item.id).maybeSingle();
    if (!current.error && current.data && current.data.published === isPublished && current.data.sort_order === item.priority && sameJson(current.data.payload, payload)) {
      return toPromotion({ id: current.data.record_key, key: current.data.record_key, module: "promotion", payload: current.data.payload, published: current.data.published, sort_order: current.data.sort_order, version: current.data.version });
    }
  }
  if (error) return fail("Promotion could not be saved.");
  return toPromotion({ id: data.id, key: data.key, module: "promotion", payload: data.payload, published: data.published, sort_order: data.sort_order, version: data.version });
}
export async function writeSettings(actor: string, settings: Settings) {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.rpc("phase6_settings_update", { p_actor: actor, p_site_version: settings.version, p_booking_version: settings.bookingVersion ?? settings.version, p_settings: { business_email: settings.email, phone: settings.phone, whatsapp: settings.whatsapp, instagram: settings.instagram, tiktok: settings.tiktok, facebook: settings.facebook, newsletter_visible: settings.newsletter, pickup_start: settings.start, pickup_end: settings.end, express_cutoff: settings.cutoff, accept_public_bookings: settings.acceptBookings } });
  if (error) return fail("Settings could not be saved. Reload the latest values and try again.");
  return { ...mapSettings(data), bookingVersion: (settings.bookingVersion ?? settings.version) + 1 };
}
export async function writeLocation(actor: string, location: LocationRecord) {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.rpc("website_branch_update", { p_actor: actor, p_id: location.id, p_expected_version: location.version, p_title: location.name, p_label: location.label, p_phone: location.phone, p_map_url: location.map, p_public_hours: location.hours, p_sort_order: location.order });
  if (error) return fail("Branch changed or could not be saved. Reload and try again.");
  return { ...location, id: data.id, slug: data.slug, name: data.title, label: data.label, phone: data.phone, map: data.map_url, hours: data.hours, order: data.sort_order, version: data.version };
}
type SavedServiceRow = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  image: string;
  alt: string;
  kind: string;
  bookable: boolean;
  active: boolean;
  sort_order: number;
  version: number;
};

const SERVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Existing services are addressed by their immutable row id so slug edits update the same record. */
function serviceRecordId(item: ContentItem): string | null {
  const id = item.extra?.recordId ?? "";
  return SERVICE_ID.test(id) ? id : null;
}

function toServiceItem(item: ContentItem, row: SavedServiceRow): ContentItem {
  return {
    ...item,
    id: row.slug,
    module: "Services",
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    body: row.body,
    image: row.image,
    alt: row.alt,
    status: row.active ? "Published" : "Draft",
    sort: row.sort_order,
    version: row.version,
    published: row.active
      ? {
        title: row.title,
        slug: row.slug,
        summary: row.summary,
        body: row.body,
        image: row.image,
        alt: row.alt,
      }
      : undefined,
    extra: {
      ...(item.extra ?? {}),
      recordId: row.id,
      kind: row.kind,
      bookable: String(row.bookable),
      active: String(row.active),
    },
  };
}

export async function writeService(
  actor: string,
  item: ContentItem,
  action: "draft" | "publish" | "archive" | "unpublish",
) {
  const client = createSupabaseAdminClient();
  const recordId = serviceRecordId(item);
  // The services table has one stored copy per service, so `active` is the
  // publish state. Editing a published service keeps it live; a new draft stays
  // hidden until published.
  const active =
    action === "publish"
      ? true
      : action === "unpublish" || action === "archive"
        ? false
        : Boolean(item.published);
  const { data, error } = await client.rpc("website_service_upsert", {
    p_actor: actor,
    p_service_id: recordId,
    p_slug: item.slug,
    p_expected_version: recordId ? item.version : null,
    p_title: item.title,
    p_summary: item.summary,
    p_body: item.body,
    p_image: item.image,
    p_alt: item.alt,
    p_sort_order: item.sort,
    p_active: active,
  });
  if (error) {
    if (isConflict(error)) {
      if (!recordId) {
        const { data: existing } = await client
          .from("services")
          .select("id")
          .eq("slug", item.slug)
          .maybeSingle();
        if (existing) return fail("That service slug is already in use. Choose a different slug.");
      }
      return fail("Service changed while editing. Reload the latest details and try again.");
    }
    if (error.code === "23505") return fail("That service slug is already in use. Choose a different slug.");
    return fail("Service could not be saved. Reload and try again.");
  }
  return toServiceItem(item, data as unknown as SavedServiceRow);
}
export async function writeMedia(actor: string, asset: MediaAsset, expectedVersion?: number) {
  const client = createSupabaseAdminClient();
  const id = asset.id || crypto.randomUUID();
  const { data: previous, error: previousError } = asset.id
    ? await client.from("website_gallery_media").select("public_url").eq("id", id).maybeSingle()
    : { data: null, error: null };
  if (previousError) return fail("The existing media asset could not be verified. Reload and try again.");
  if (previous && (asset.archived || previous.public_url !== asset.src)) {
    const { data: contentRows, error: contentError } = await client
      .from("website_content")
      .select("module,payload");
    if (contentError || !Array.isArray(contentRows)) return fail("Media usage could not be verified. Reload and try again.");
    const blogReference = contentRows.some((row) =>
      row.module === "blog" && (containsString(row.payload, id) || containsString(row.payload, previous.public_url)),
    );
    const urlReference = previous.public_url !== asset.src && contentRows.some((row) => containsString(row.payload, previous.public_url));
    if (blogReference || urlReference) {
      return fail("This media asset is in use by Blog content. Replace its references before archiving or changing its URL.");
    }
  }
  const storagePath = marketingStoragePath(asset.src) ?? asset.src.split("/").slice(-2).join("/");
  const { data, error } = await client.rpc("website_media_upsert", { p_actor: actor, p_id: id, p_storage_path: storagePath, p_public_url: asset.src, p_name: asset.name, p_alt: asset.alt, p_caption: asset.caption, p_source: asset.source, p_permission: asset.permission, p_archived: asset.archived, p_expected_version: expectedVersion ?? null });
  if (error) return fail(error.code === "40001" ? "Media changed or is currently in use. Reload and try again." : "Media could not be saved.");
  if (previous?.public_url && previous.public_url !== asset.src) {
    await removeMarketingStorageObject(client, previous.public_url);
  }
  return { ...asset, id: data.id, version: data.version };
}

export async function deleteMedia(id: string, knownUses: string[] = []) {
  if (knownUses.length) return fail("This media asset is listed as in use. Remove those references before deleting it.");
  const client = createSupabaseAdminClient();
  const { data: asset, error: assetError } = await client
    .from("website_gallery_media")
    .select("id,public_url")
    .eq("id", id)
    .maybeSingle();
  if (assetError) return fail("The media asset could not be verified. Reload and try again.");
  if (!asset) return fail("This Media Library asset no longer exists.");

  const { data: galleryRows, error: galleryError } = await client
    .from("website_content")
    .select("payload")
    .eq("module", "gallery");
  if (galleryError || !Array.isArray(galleryRows)) return fail("Media usage could not be verified. Reload and try again.");
  if (galleryRows.some((row) => row.payload?.media_id === id)) {
    return fail("This media asset is used in the website gallery. Remove it from the gallery before deleting it.");
  }

  const [contentReferences, serviceReferences] = await Promise.all([
    client.from("website_content").select("payload"),
    client.from("services").select("public_image"),
  ]);
  if (contentReferences.error || serviceReferences.error) return fail("Media usage could not be verified. Reload and try again.");
  const referenced = (contentReferences.data ?? []).some((row) =>
    containsString(row.payload, id) || containsString(row.payload, asset.public_url),
  ) || (serviceReferences.data ?? []).some((row) => row.public_image === asset.public_url);
  if (referenced) return fail("This media asset is in use on the website. Remove its references before deleting it.");

  const { data: deleted, error: deleteError } = await client
    .from("website_gallery_media")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (deleteError || !deleted) return fail("Media could not be deleted. Reload and try again.");
  await removeMarketingStorageObject(client, asset.public_url);
}

/**
 * Permanently removes one blog record from `website_content`.
 *
 * The row disappears from the admin list and the public blog on the next read.
 * Media Library assets are deliberately left alone: featured and inline images
 * may be shared with other content, so they stay in the library.
 */
export async function deleteBlog(item: ContentItem) {
  const target = blogDeletionTarget(item);
  if (!target.ok) return fail(target.error);
  const client = createSupabaseAdminClient();
  const { data, error } = await client
    .from("website_content")
    .delete()
    .eq("module", "blog")
    .eq("record_key", target.key)
    .select("id,record_key");
  if (error) return fail("Article could not be deleted. Reload and try again.");
  if (!data?.length) {
    return fail("This article no longer exists. Reload the page to see the latest list.");
  }
}

/**
 * Permanently removes one service from the catalogue.
 *
 * A service any booking still references is refused before a single row is
 * touched, so historical bookings keep their recorded service name and slug.
 * Unreferenced services are removed outright; the `booking_services` foreign
 * key stays `ON DELETE SET NULL` so booking history can never be damaged.
 */
export async function deleteService(item: ContentItem) {
  const recordId = serviceRecordId(item);
  const target = serviceDeletionTarget(item, recordId);
  if (!target.ok) return fail(target.error);
  const client = createSupabaseAdminClient();

  const { data: references, error: referenceError } = await client
    .from("booking_services")
    .select("id")
    .eq("service_id", target.key)
    .limit(1);
  if (referenceError) {
    return fail("Service usage could not be verified. Reload and try again.");
  }
  const blocked = serviceReferenceDeletionError(references?.length ?? 0);
  if (blocked) return fail(blocked);

  const { data: deleted, error: deleteError } = await client
    .from("services")
    .delete()
    .eq("id", target.key)
    .select("id")
    .maybeSingle();
  if (deleteError) {
    return fail(
      deleteError.code === "23503"
        ? serviceReferenceDeletionError(1)
        : "Service could not be deleted. Reload and try again.",
    );
  }
  if (!deleted) {
    return fail("This service no longer exists. Reload the page to see the latest list.");
  }
}
