import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseConfig } from "@/lib/supabase/config";
import { promotionImageError } from "./promotion-image";
import { promotionCtaError } from "@/lib/rules";
import type { ContentItem, FaqItem, GalleryPlacement, LocationRecord, MediaAsset, PromotionRecord, Settings } from "@/lib/contracts";
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
    client.from("website_content").select("id,record_key,payload,published,sort_order,version").eq("module", "gallery").eq("published", true).order("sort_order", { ascending: true }),
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
type GallerySupabaseError = {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

class GalleryWriteFailure extends Error { }

function logGalleryError(stage: string, value: unknown): void {
  const error = value && typeof value === "object"
    ? value as GallerySupabaseError
    : { message: String(value) };
  console.error("Gallery save failed.", {
    stage,
    message: error.message ?? "Unknown error",
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  });
}

export async function writeGallery(
  actor: string,
  items: GalleryPlacement[],
  previousVersions: Record<string, number> = {},
) {
  try {
    if (!Array.isArray(items) || items.length > 200) {
      throw new GalleryWriteFailure("Gallery is invalid or too large. Reload and try again.");
    }

    // Whitelist at the persistence boundary as well as the client boundary.
    const safeItems = items.map((item) => ({
      id: item.id,
      mediaId: item.mediaId,
      alt: item.alt,
      caption: item.caption,
      order: item.order,
      visible: item.visible,
      version: item.version,
    }));
    if (safeItems.some((item) =>
      typeof item.id !== "string" || !item.id ||
      typeof item.mediaId !== "string" || !item.mediaId ||
      typeof item.alt !== "string" ||
      typeof item.caption !== "string" ||
      !Number.isSafeInteger(item.order) ||
      typeof item.visible !== "boolean" ||
      !Number.isSafeInteger(item.version) || item.version < 0
    )) {
      throw new GalleryWriteFailure("Gallery contains an invalid placement. Reload and try again.");
    }

    const orderedItems = [...safeItems].sort((a, b) => a.order - b.order);
    const client = createSupabaseAdminClient();
    const { data: currentRows, error: currentError } = await client
      .from("website_content")
      .select("record_key,payload")
      .eq("module", "gallery");
    if (currentError || !Array.isArray(currentRows)) {
      logGalleryError("existing placement validation", currentError ?? new Error("Gallery rows were not returned."));
      throw new GalleryWriteFailure("Existing gallery placements could not be verified. Reload and try again.");
    }
    const existingMediaByPlacement = new Map(
      currentRows.map((row) => [row.record_key, String(row.payload?.media_id ?? "")]),
    );

    const mediaIds = [...new Set(orderedItems.map((item) => item.mediaId))];
    const available = new Map<string, boolean>();
    if (mediaIds.length) {
      const { data, error } = await client
        .from("website_gallery_media")
        .select("id,archived")
        .in("id", mediaIds);
      if (error || !Array.isArray(data)) {
        logGalleryError("mediaId validation", error ?? new Error("Media rows were not returned."));
        throw new GalleryWriteFailure("Media Library assets could not be verified. Reload and try again.");
      }
      for (const asset of data) available.set(asset.id, asset.archived);
      const missingMediaIds = mediaIds.filter((id) => !available.has(id));
      if (missingMediaIds.length) {
        console.warn("Gallery mediaId validation rejected missing assets.", { count: missingMediaIds.length });
        throw new GalleryWriteFailure("A selected Media Library asset no longer exists. Refresh the gallery and try again.");
      }

      const newlyAttachedArchived = orderedItems.some((item) =>
        available.get(item.mediaId) === true && existingMediaByPlacement.get(item.id) !== item.mediaId,
      );
      if (newlyAttachedArchived) {
        console.warn("Gallery mediaId validation rejected a newly attached archived asset.", {
          code: "GALLERY_ARCHIVED_MEDIA",
          message: "Archived media cannot be newly added to the gallery.",
          details: null,
        });
        throw new GalleryWriteFailure("Archived media cannot be newly added to the gallery. Choose an active Media Library asset.");
      }
    }

    const rows = orderedItems.map((item, index) => ({
      key: item.id,
      payload: { media_id: item.mediaId, alt: item.alt, caption: item.caption },
      published: item.visible,
      sort_order: index + 1,
    }));
    const expected: Record<string, number> = {};
    for (const [id, version] of Object.entries(previousVersions)) {
      if (id && Number.isSafeInteger(version) && version >= 0) expected[id] = version;
    }
    for (const item of orderedItems) expected[item.id] = item.version;

    const { data, error } = await client.rpc("website_content_replace", {
      p_actor: actor,
      p_module: "gallery",
      p_items: rows,
      p_expected_versions: expected,
    });
    if (error) {
      logGalleryError("website_content_replace RPC", error);
      if (isConflict(error)) {
        throw new GalleryWriteFailure("Gallery changed while editing. Reload the latest gallery and try again.");
      }
      throw new GalleryWriteFailure("Gallery could not be saved. Please retry; if the issue continues, contact support.");
    }
    if (!Array.isArray(data)) throw new Error("Gallery save RPC returned an invalid response.");
    return (data as RpcContentRow[]).map((row) => ({
      id: row.key,
      mediaId: String(row.payload.media_id ?? ""),
      alt: String(row.payload.alt ?? ""),
      caption: String(row.payload.caption ?? ""),
      order: row.sort_order,
      visible: row.published,
      version: row.version,
    }));
  } catch (error) {
    if (error instanceof GalleryWriteFailure) throw error;
    logGalleryError("unexpected writeGallery failure", error);
    throw new Error("Gallery could not be saved. Please retry; if the issue continues, contact support.");
  }
}
export async function writeContent(actor: string, item: ContentItem, action: "draft" | "publish" | "archive" | "unpublish") {
  const client = createSupabaseAdminClient();
  const published = action === "publish" || (action === "draft" && !!item.published);
  const payload = { title: item.title, slug: item.slug, summary: item.summary, body: item.body, image: item.image, alt: item.alt, extra: item.extra, status: action === "archive" ? "Archived" : published ? "Published" : "Draft" };
  const { data, error } = await client.rpc("website_content_upsert", { p_actor: actor, p_module: "blog", p_key: item.slug, p_payload: payload, p_published: published, p_sort_order: item.sort, p_expected_version: item.version || null });
  if (isConflict(error)) {
    const current = await client.from("website_content").select("id,record_key,payload,published,sort_order,version").eq("module", "blog").eq("record_key", item.slug).maybeSingle();
    if (!current.error && current.data && current.data.published === published && current.data.sort_order === item.sort && sameJson(current.data.payload, payload)) {
      return toContent({ id: current.data.record_key, key: current.data.record_key, module: "blog", payload: current.data.payload, published: current.data.published, sort_order: current.data.sort_order, version: current.data.version });
    }
  }
  if (error) return fail(isConflict(error) ? "Article changed while editing. Reload and try again." : "Article could not be saved.");
  return toContent({ id: data.id, key: data.key, module: "blog", payload: data.payload, published: data.published, sort_order: data.sort_order, version: data.version });
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
  const { data, error } = await client.rpc("phase6_settings_update", { p_actor: actor, p_site_version: settings.version, p_booking_version: settings.version, p_settings: { business_email: settings.email, phone: settings.phone, whatsapp: settings.whatsapp, instagram: settings.instagram, tiktok: settings.tiktok, facebook: settings.facebook, newsletter_visible: settings.newsletter, pickup_start: settings.start, pickup_end: settings.end, express_cutoff: settings.cutoff, accept_public_bookings: settings.acceptBookings } });
  if (error) return fail("Settings could not be saved. Reload the latest values and try again.");
  return mapSettings(data);
}
export async function writeLocation(actor: string, location: LocationRecord) {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.rpc("website_branch_update", { p_actor: actor, p_id: location.id, p_expected_version: location.version, p_title: location.name, p_label: location.label, p_phone: location.phone, p_map_url: location.map, p_public_hours: location.hours, p_sort_order: location.order });
  if (error) return fail("Branch changed or could not be saved. Reload and try again.");
  return { ...location, id: data.id, slug: data.slug, name: data.title, label: data.label, phone: data.phone, map: data.map_url, hours: data.hours, order: data.sort_order, version: data.version };
}
export async function writeService(actor: string, item: ContentItem) {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.rpc("website_service_update", { p_actor: actor, p_slug: item.slug, p_expected_version: item.version, p_title: item.title, p_summary: item.summary, p_body: item.body, p_image: item.image, p_alt: item.alt, p_sort_order: item.sort });
  if (error) return fail("Service changed or could not be saved. Reload and try again.");
  return { ...item, id: data.slug, version: data.version, published: { title: data.title, slug: data.slug, summary: data.summary, body: data.body, image: data.image, alt: data.alt } };
}
export async function writeMedia(actor: string, asset: MediaAsset, expectedVersion?: number) {
  const client = createSupabaseAdminClient();
  const id = asset.id || crypto.randomUUID();
  const { data: previous, error: previousError } = asset.id
    ? await client.from("website_gallery_media").select("public_url").eq("id", id).maybeSingle()
    : { data: null, error: null };
  if (previousError) return fail("The existing media asset could not be verified. Reload and try again.");
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
  const referenced = (contentReferences.data ?? []).some((row) => containsString(row.payload, asset.public_url))
    || (serviceReferences.data ?? []).some((row) => row.public_image === asset.public_url);
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

export async function deleteBlog(actor: string, item: ContentItem) {
  const client = createSupabaseAdminClient();
  if (item.published) return fail("Unpublish this article before deleting it.");
  const { error } = await client.rpc("website_content_upsert", { p_actor: actor, p_module: "blog", p_key: item.slug, p_payload: { ...item, deleted: true }, p_published: false, p_sort_order: item.sort, p_expected_version: item.version });
  if (error) return fail("Article could not be removed.");
}
