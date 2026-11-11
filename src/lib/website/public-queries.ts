import type { BlogAuthor, BlogContentBlock } from "@/lib/contracts";
import type { Photo, branches, services } from "../content";
import { normalizeBlogBlocks } from "./blog-blocks";
import {
  DEFAULT_PICKUP_END,
  DEFAULT_PICKUP_START,
  normalizePickupTime,
} from "../pickup-time";

/**
 * Pure query shapes and mappers for the public site.
 *
 * Nothing here imports Next.js or Supabase, so the select lists and mapping
 * rules can be unit tested without a running app. Column lists deliberately
 * exclude `services.section` (no such column exists), and the blog list projects
 * JSON subpaths so a post body is never transferred for an index page.
 */

export const SERVICES_COLUMNS =
  "slug,title,summary,public_body,public_image,public_alt,bookable,sort_order";

export const BRANCHES_COLUMNS =
  "slug,title,label,phone,public_map_url,public_hours,sort_order";

/** Full content row, used where the payload is actually rendered. */
export const CONTENT_COLUMNS =
  "id,record_key,payload,sort_order,version,published";

/** Blog index: no `payload.body` and no full payload blob. */
export const BLOG_LIST_COLUMNS =
  "id,record_key,published,sort_order,version,title:payload->>title,slug:payload->>slug,summary:payload->>summary,image:payload->>image,alt:payload->>alt,author:payload->author,publishedAt:payload->>publishedAt,modifiedAt:payload->>modifiedAt";

/** Gallery media: only the columns a tile needs. Archived rows are filtered in SQL. */
export const GALLERY_MEDIA_COLUMNS = "id,public_url,alt";

/** Gallery collection rows: the stable slug plus its public label. */
export const GALLERY_COLLECTION_COLUMNS =
  "id,record_key,payload,sort_order,version,published";

/** Hard caps so one bad row set can never turn into an unbounded response. */
export const PUBLIC_LIMITS = {
  services: 50,
  branches: 50,
  faqs: 200,
  gallery: 200,
  galleryCollections: 100,
  blog: 500,
  promotions: 20,
} as const;

export type PublicSiteSettings = {
  email: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  tiktok: string;
  facebook: string;
  newsletter: boolean;
  pickupStart: string;
  pickupEnd: string;
};

export type PublicSettingsSiteRow = {
  business_email: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  tiktok: string | null;
  facebook: string | null;
  newsletter_visible: boolean | null;
};

export type PublicSettingsBookingRow = {
  pickup_start: string | null;
  pickup_end: string | null;
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Maps the cached, public-display settings only; booking enforcement reads elsewhere. */
export function mapPublicSiteSettings(
  site: PublicSettingsSiteRow,
  booking?: PublicSettingsBookingRow | null,
): PublicSiteSettings {
  return {
    email: text(site.business_email),
    phone: text(site.phone),
    whatsapp: text(site.whatsapp),
    instagram: text(site.instagram),
    tiktok: text(site.tiktok),
    facebook: text(site.facebook),
    newsletter: site.newsletter_visible === true,
    pickupStart: normalizePickupTime(
      booking?.pickup_start,
      DEFAULT_PICKUP_START,
    ),
    pickupEnd: normalizePickupTime(booking?.pickup_end, DEFAULT_PICKUP_END),
  };
}

export type PublicService = (typeof services)[number];
export type PublicBranch = (typeof branches)[number];

export type ServiceRow = {
  slug: string;
  title: string;
  summary: string;
  public_body: string | null;
  public_image: string | null;
  public_alt: string | null;
  bookable: boolean;
  sort_order: number;
};

export type BranchRow = {
  slug: string;
  title: string;
  label: string | null;
  phone: string;
  public_map_url: string | null;
  public_hours: unknown;
  sort_order: number;
};

export type ContentRow = {
  id: string;
  record_key: string;
  payload: Record<string, unknown>;
  sort_order: number;
  version: number;
  published: boolean;
};

export type GalleryPlacementRow = Pick<
  ContentRow,
  "id" | "record_key" | "payload" | "sort_order"
>;

/** A published gallery collection, as the public filter bar renders it. */
export type PublicGalleryCollection = {
  /** Stable collection slug (website_content record_key). */
  id: string;
  name: string;
  description: string;
};

/** A public tile: collection membership comes from stored data, never alt text. */
export type PublicGalleryPhoto = Photo & {
  mediaId: string;
  collections: string[];
};

export type PublicGallery = {
  collections: PublicGalleryCollection[];
  photos: PublicGalleryPhoto[];
};

export type GalleryMediaRow = {
  id: string;
  public_url: string;
  alt: string | null;
};

export type BlogListRow = {
  id: string;
  record_key: string;
  published: boolean;
  sort_order: number;
  version: number;
  title: string | null;
  slug: string | null;
  summary: string | null;
  image: string | null;
  alt: string | null;
  author?: unknown;
  publishedAt?: string | null;
  modifiedAt?: string | null;
};

/** A blog index card. Deliberately has no `body` property. */
export type PublicBlogSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  image: string;
  alt: string;
  author?: BlogAuthor;
  publishedAt?: string;
  order: number;
  version: number;
};

export type PublicBlogPost = PublicBlogSummary & {
  body: string;
  contentBlocks?: BlogContentBlock[];
  modifiedAt?: string;
};

/**
 * Map a services row to a public card.
 *
 * The database is the source of truth for the copy and featured image, so an
 * admin edit is what the public site renders. The built-in baseline only
 * supplies layout metadata (`section`, `focal`) and a fallback when a stored
 * field is still blank; a newly created service has no baseline and renders its
 * own title, summary and body.
 */
export function mapServiceRow(
  row: ServiceRow,
  baseline?: PublicService,
): PublicService {
  const title = row.title.trim() || baseline?.title || row.slug;
  const summary = row.summary.trim() || baseline?.summary || "";
  const body = (row.public_body ?? "").trim();
  const image = row.public_image
    ? { src: row.public_image, alt: row.public_alt || baseline?.image?.alt || "" }
    : baseline?.image;
  return {
    slug: row.slug,
    section: baseline?.section ?? row.slug,
    title,
    summary,
    ...(body ? { body } : {}),
    image,
    focal: baseline?.focal,
    bookable: row.bookable,
  } as PublicService;
}

export function mapBranchRow(
  row: BranchRow,
  baseline?: PublicBranch,
): PublicBranch {
  const hours =
    Array.isArray(row.public_hours) && row.public_hours.length
      ? (row.public_hours as [string, string][])
      : (baseline?.hours ?? []);
  return {
    slug: row.slug,
    section: baseline?.section ?? row.slug,
    title: row.title,
    label: row.label ?? "",
    phone: row.phone,
    tel: baseline?.tel ?? `tel:${row.phone.replace(/\D/g, "")}`,
    hours,
    map: row.public_map_url || baseline?.map || "",
  } as PublicBranch;
}

export type PublicFaq = { q: string; a: string; glow?: string };

export function mapFaqRow(row: Pick<ContentRow, "payload">): PublicFaq | null {
  const question = text(row.payload.question);
  const answer = text(row.payload.answer);
  if (row.payload.enabled === false) return null;
  if (!question.trim() || !answer.trim()) return null;
  return {
    q: question,
    a: answer,
    ...(typeof row.payload.glow === "string" ? { glow: row.payload.glow } : {}),
  };
}

/** Media ids referenced by published gallery placements, in placement order. */
export function referencedMediaIds(
  placements: Pick<GalleryPlacementRow, "payload">[],
): string[] {
  const ids: string[] = [];
  for (const placement of placements) {
    const id = text(placement.payload.media_id);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Gallery tiles in placement order. Media that is missing from the supplied
 * (already filtered) rows is skipped, e.g. archived or deleted assets.
 */
export function buildGalleryPhotos(
  placements: GalleryPlacementRow[],
  media: GalleryMediaRow[],
): PublicGalleryPhoto[] {
  const byId = new Map(media.map((asset) => [asset.id, asset]));
  const tiles: PublicGalleryPhoto[] = [];
  for (const placement of placements) {
    const asset = byId.get(text(placement.payload.media_id));
    if (!asset) continue;
    const collection = text(placement.payload.collection_key);
    tiles.push({
      src: asset.public_url,
      alt: text(placement.payload.alt) || asset.alt || "",
      mediaId: asset.id,
      collections: collection ? [collection] : [],
    });
  }
  return tiles;
}

/** Visible collections in configured order. Rows without a name are ignored. */
export function mapGalleryCollectionRows(
  rows: ContentRow[],
): PublicGalleryCollection[] {
  const collections: PublicGalleryCollection[] = [];
  for (const row of rows) {
    const name = text(row.payload.name).trim();
    if (!name) continue;
    collections.push({
      id: row.record_key,
      name,
      description: text(row.payload.description).trim(),
    });
  }
  return collections;
}

/**
 * One card per media asset. The same asset can be placed in several collections,
 * so the All view (and any filtered view) must not repeat it.
 */
export function dedupeGalleryPhotos(
  photos: PublicGalleryPhoto[],
): PublicGalleryPhoto[] {
  const seen = new Set<string>();
  const unique: PublicGalleryPhoto[] = [];
  for (const photo of photos) {
    const key = photo.mediaId || photo.src;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(photo);
  }
  return unique;
}

function mapBlogAuthor(value: unknown): BlogAuthor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const author = value as Record<string, unknown>;
  const name = text(author.name).trim();
  const bio = text(author.bio).trim();
  const image = text(author.image);
  const imageAlt = text(author.imageAlt);
  const imageMediaId = text(author.imageMediaId);
  if (!name && !bio && !image) return undefined;
  return {
    name,
    ...(bio ? { bio } : {}),
    ...(image ? { image } : {}),
    ...(imageAlt ? { imageAlt } : {}),
    ...(imageMediaId ? { imageMediaId } : {}),
  };
}

function mapBlogBlocks(value: unknown): BlogContentBlock[] | undefined {
  return normalizeBlogBlocks(value);
}

export function summariseBlogRow(row: BlogListRow): PublicBlogSummary {
  const author = mapBlogAuthor(row.author);
  return {
    id: row.record_key || row.id,
    slug: row.slug || row.record_key,
    title: row.title ?? "",
    summary: row.summary ?? "",
    image: row.image ?? "",
    alt: row.alt ?? "",
    ...(author ? { author } : {}),
    ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
    order: row.sort_order,
    version: row.version,
  };
}

export function mapBlogPostRow(row: ContentRow): PublicBlogPost {
  const author = mapBlogAuthor(row.payload.author);
  const contentBlocks = mapBlogBlocks(row.payload.contentBlocks);
  const publishedAt = text(row.payload.publishedAt);
  const modifiedAt = text(row.payload.modifiedAt);
  return {
    id: row.record_key || row.id,
    slug: text(row.payload.slug) || row.record_key,
    title: text(row.payload.title),
    summary: text(row.payload.summary),
    image: text(row.payload.image),
    alt: text(row.payload.alt),
    body: text(row.payload.body),
    ...(author ? { author } : {}),
    ...(contentBlocks ? { contentBlocks } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(modifiedAt ? { modifiedAt } : {}),
    order: row.sort_order,
    version: row.version,
  };
}
