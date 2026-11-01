import "server-only";
import { unstable_cache } from "next/cache";
import {
  branches as defaultBranches,
  faqs as defaultFaqs,
  photos,
  services as defaultServices,
  type Photo,
} from "@/lib/content";
import type { PublishedPromotionRecord } from "@/lib/contracts";
import { demoMode } from "@/lib/demo-mode";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { PromotionServiceOption } from "./promotion-view";
import {
  BLOG_LIST_COLUMNS,
  BRANCHES_COLUMNS,
  CONTENT_COLUMNS,
  GALLERY_MEDIA_COLUMNS,
  PUBLIC_LIMITS,
  SERVICES_COLUMNS,
  buildGalleryPhotos,
  mapBlogPostRow,
  mapBranchRow,
  mapFaqRow,
  mapPublicSiteSettings,
  mapServiceRow,
  referencedMediaIds,
  summariseBlogRow,
  type BlogListRow,
  type BranchRow,
  type ContentRow,
  type GalleryMediaRow,
  type GalleryPlacementRow,
  type PublicBlogPost,
  type PublicBlogSummary,
  type PublicBranch,
  type PublicFaq,
  type PublicService,
  type PublicSettingsBookingRow,
  type PublicSettingsSiteRow,
  type PublicSiteSettings,
  type ServiceRow,
} from "./public-queries";
export type { PublicSiteSettings } from "./public-queries";
import { PUBLIC_TAGS } from "./revalidation-tags";
import { defaultSettings, toPromotion } from "./types";

/**
 * Cached loaders for the public website.
 *
 * Only data a page actually renders is read, and each loader is cached with the
 * repository's Next 16 primitive (`unstable_cache`; no `"use cache"` because
 * Cache Components are not enabled). Reads never touch `cookies()`/`headers()`,
 * so they are safe to cache.
 *
 * Two deliberate boundaries:
 * - promotion rows are cached raw: eligibility (`isPublicPromotionActive` with
 *   the current time) is evaluated at render, never inside the cache;
 * - pickup times here are display-only. Booking availability and enforcement
 *   continue using the uncached `readPublicSettings` in `./repository`.
 */

const REVALIDATE_SECONDS = 300;
const liveContent = !demoMode && isSupabaseConfigured;

type QueryError = { code?: string; message?: string } | null;

/** Sanitised logging: table, code and message only — never row data. */
function reportQueryError(table: string, error: QueryError): void {
  if (!error) return;
  console.error(
    `Public website query failed: table=${table} code=${error.code ?? "unknown"} message=${error.message ?? "unknown"}`,
  );
}

export type PublicPromotions = {
  promotions: PublishedPromotionRecord[];
  promotionServices: PromotionServiceOption[];
};

export type PublicWebsiteSnapshot = {
  services: PublicService[];
  promotionServices: PromotionServiceOption[];
  branches: PublicBranch[];
  faqs: PublicFaq[];
  gallery: Photo[];
  promotions: PublishedPromotionRecord[];
  settings: PublicSiteSettings;
};

const demoPromotionServices: PromotionServiceOption[] = defaultServices
  .filter((service) => service.bookable)
  .map((service) => ({ slug: service.slug, name: service.title, bookable: true }));

const demoGallery: Photo[] = photos.batch_14_gallery ?? [];

const demoDisplaySettings: PublicSiteSettings = {
  email: defaultSettings.email,
  phone: defaultSettings.phone,
  whatsapp: defaultSettings.whatsapp,
  instagram: defaultSettings.instagram,
  tiktok: defaultSettings.tiktok,
  facebook: defaultSettings.facebook,
  newsletter: defaultSettings.newsletter,
  pickupStart: "07:00",
  pickupEnd: "17:00",
};

async function readServices(): Promise<PublicService[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("services")
    .select(SERVICES_COLUMNS)
    .eq("active", true)
    .order("sort_order")
    .limit(PUBLIC_LIMITS.services);
  if (error) {
    reportQueryError("services", error);
    return defaultServices;
  }
  const rows = (data ?? []) as unknown as ServiceRow[];
  if (!rows.length) return defaultServices;
  const baseline = new Map(defaultServices.map((service) => [service.slug, service]));
  return rows.map((row) => mapServiceRow(row, baseline.get(row.slug)));
}

async function readBranches(): Promise<PublicBranch[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("branches")
    .select(BRANCHES_COLUMNS)
    .eq("active", true)
    .order("sort_order")
    .limit(PUBLIC_LIMITS.branches);
  if (error) {
    reportQueryError("branches", error);
    return defaultBranches;
  }
  const rows = (data ?? []) as unknown as BranchRow[];
  if (!rows.length) return defaultBranches;
  const baseline = new Map(defaultBranches.map((branch) => [branch.slug, branch]));
  return rows.map((row) => mapBranchRow(row, baseline.get(row.slug)));
}

async function readFaqs(): Promise<PublicFaq[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("website_content")
    .select(CONTENT_COLUMNS)
    .eq("module", "faq")
    .eq("published", true)
    .order("sort_order")
    .limit(PUBLIC_LIMITS.faqs);
  if (error) {
    reportQueryError("website_content", error);
    return defaultFaqs;
  }
  return ((data ?? []) as unknown as ContentRow[])
    .map(mapFaqRow)
    .filter((faq): faq is PublicFaq => faq !== null);
}

async function readGallery(): Promise<Photo[]> {
  const db = createSupabaseAdminClient();
  const placements = await db
    .from("website_content")
    .select(CONTENT_COLUMNS)
    .eq("module", "gallery")
    .eq("published", true)
    .order("sort_order")
    .limit(PUBLIC_LIMITS.gallery);
  if (placements.error) {
    reportQueryError("website_content", placements.error);
    return [];
  }
  const placementRows = (placements.data ?? []) as unknown as GalleryPlacementRow[];
  const mediaIds = referencedMediaIds(placementRows);
  if (!mediaIds.length) return [];

  // Only referenced assets, only non-archived rows: archived media is filtered
  // in SQL instead of being downloaded and discarded.
  const media = await db
    .from("website_gallery_media")
    .select(GALLERY_MEDIA_COLUMNS)
    .in("id", mediaIds)
    .eq("archived", false);
  if (media.error) {
    reportQueryError("website_gallery_media", media.error);
    return [];
  }
  return buildGalleryPhotos(
    placementRows,
    (media.data ?? []) as unknown as GalleryMediaRow[],
  );
}

async function readBlogList(): Promise<PublicBlogSummary[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("website_content")
    .select(BLOG_LIST_COLUMNS)
    .eq("module", "blog")
    .eq("published", true)
    .order("sort_order")
    .limit(PUBLIC_LIMITS.blog);
  if (error) {
    reportQueryError("website_content", error);
    return [];
  }
  return ((data ?? []) as unknown as BlogListRow[]).map(summariseBlogRow);
}

async function readBlogPost(slug: string): Promise<PublicBlogPost | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("website_content")
    .select(CONTENT_COLUMNS)
    .eq("module", "blog")
    .eq("record_key", slug)
    .eq("published", true)
    .maybeSingle();
  if (error) {
    reportQueryError("website_content", error);
    return null;
  }
  return data ? mapBlogPostRow(data as unknown as ContentRow) : null;
}

async function readPromotions(): Promise<PublicPromotions> {
  const db = createSupabaseAdminClient();
  const [promotionResult, serviceResult] = await Promise.all([
    db
      .from("website_content")
      .select(CONTENT_COLUMNS)
      .eq("module", "promotion")
      .eq("published", true)
      .order("sort_order")
      .limit(PUBLIC_LIMITS.promotions),
    db
      .from("services")
      .select("slug,title,bookable")
      .eq("active", true)
      .eq("bookable", true)
      .order("sort_order")
      .limit(PUBLIC_LIMITS.services),
  ]);
  if (promotionResult.error) reportQueryError("website_content", promotionResult.error);
  if (serviceResult.error) reportQueryError("services", serviceResult.error);

  const promotions = ((promotionResult.data ?? []) as unknown as ContentRow[]).map((row) => ({
    ...toPromotion({
      id: row.id,
      key: row.record_key,
      module: "promotion",
      payload: row.payload,
      published: row.published,
      sort_order: row.sort_order,
      version: row.version,
    }),
    published: row.published,
  }));
  const promotionServices = (
    (serviceResult.data ?? []) as unknown as Array<{
      slug: string;
      title: string;
      bookable: boolean;
    }>
  ).map((service) => ({
    slug: service.slug,
    name: service.title,
    bookable: service.bookable,
  }));
  return { promotions, promotionServices };
}

async function readSettings(): Promise<PublicSiteSettings> {
  const db = createSupabaseAdminClient();
  const [site, booking] = await Promise.all([
    db
      .from("public_site_settings")
      .select("business_email,phone,whatsapp,instagram,tiktok,facebook,newsletter_visible")
      .eq("id", true)
      .maybeSingle(),
    db
      .from("booking_settings")
      .select("pickup_start,pickup_end")
      .eq("id", true)
      .maybeSingle(),
  ]);
  if (site.error) {
    reportQueryError("public_site_settings", site.error);
    return demoDisplaySettings;
  }
  if (!site.data) return demoDisplaySettings;
  if (booking.error) reportQueryError("booking_settings", booking.error);
  return mapPublicSiteSettings(
    site.data as unknown as PublicSettingsSiteRow,
    booking.error
      ? null
      : (booking.data as unknown as PublicSettingsBookingRow | null),
  );
}

const cachedServices = unstable_cache(readServices, ["public-services"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [PUBLIC_TAGS.services],
});
const cachedBranches = unstable_cache(readBranches, ["public-branches"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [PUBLIC_TAGS.branches],
});
const cachedFaqs = unstable_cache(readFaqs, ["public-faqs"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [PUBLIC_TAGS.faq],
});
const cachedGallery = unstable_cache(readGallery, ["public-gallery"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [PUBLIC_TAGS.gallery],
});
const cachedBlogList = unstable_cache(readBlogList, ["public-blog-list"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [PUBLIC_TAGS.blog],
});
const cachedBlogPost = unstable_cache(readBlogPost, ["public-blog-post"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [PUBLIC_TAGS.blog],
});
// Services feed the promotion card's "Book <service>" link, so a service edit
// must refresh this entry too.
const cachedPromotions = unstable_cache(readPromotions, ["public-promotions"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [PUBLIC_TAGS.promotions, PUBLIC_TAGS.services],
});
const cachedSettings = unstable_cache(readSettings, ["public-settings"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [PUBLIC_TAGS.settings],
});

/** Active services, in database order. Title/summary stay built-in for now. */
export async function getPublicServices(): Promise<PublicService[]> {
  return liveContent ? cachedServices() : defaultServices;
}

export async function getPublicBranches(): Promise<PublicBranch[]> {
  return liveContent ? cachedBranches() : defaultBranches;
}

export async function getPublicFaqs(): Promise<PublicFaq[]> {
  return liveContent ? cachedFaqs() : defaultFaqs;
}

export async function getPublicGallery(): Promise<Photo[]> {
  return liveContent ? cachedGallery() : demoGallery;
}

export async function getPublicBlogList(): Promise<PublicBlogSummary[]> {
  return liveContent ? cachedBlogList() : [];
}

export async function getPublicBlogPost(slug: string): Promise<PublicBlogPost | null> {
  return liveContent ? cachedBlogPost(slug) : null;
}

/** Raw promotion rows plus bookable services; eligibility is decided at render. */
export async function getPublicPromotions(): Promise<PublicPromotions> {
  return liveContent
    ? cachedPromotions()
    : { promotions: [], promotionServices: demoPromotionServices };
}

/** Display fields only. Booking availability stays uncached in `./repository`. */
export async function getPublicSettings(): Promise<PublicSiteSettings> {
  return liveContent ? cachedSettings() : demoDisplaySettings;
}

/** Thin composer for the home page, which renders every public content family. */
export async function getPublicWebsiteSnapshot(): Promise<PublicWebsiteSnapshot> {
  const [services, branches, faqs, gallery, promotions, settings] = await Promise.all([
    getPublicServices(),
    getPublicBranches(),
    getPublicFaqs(),
    getPublicGallery(),
    getPublicPromotions(),
    getPublicSettings(),
  ]);
  return {
    services,
    branches,
    faqs,
    gallery,
    promotions: promotions.promotions,
    promotionServices: promotions.promotionServices,
    settings,
  };
}
