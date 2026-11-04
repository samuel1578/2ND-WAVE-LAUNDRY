import type { BlogAuthor, BlogContentBlock, ContentItem, FaqItem, GalleryCollection, GalleryPlacement, LocationRecord, MediaAsset, PromotionRecord, Settings } from "@/lib/contracts";
import { branches, contact, faqs, photos, services } from "@/lib/content";

export type WebsiteRow = { id: string; key: string; module: string; payload: Record<string, unknown>; published: boolean; sort_order: number; version: number };
export type PublicSettings = Pick<Settings, "email" | "phone" | "whatsapp" | "instagram" | "tiktok" | "facebook" | "newsletter" | "version"> & { acceptBookings: boolean; start: string; end: string; cutoff: string };
export const defaultSettings: PublicSettings = {
  email: "", phone: contact.phone, whatsapp: "233595224280", instagram: contact.instagram,
  tiktok: contact.tiktok, facebook: "", newsletter: false, acceptBookings: true,
  start: "07:00", end: "17:00", cutoff: "11:00", version: 1,
};
export function toFaq(row: WebsiteRow): FaqItem {
  return { id: row.id || row.key, question: String(row.payload.question ?? ""), answer: String(row.payload.answer ?? ""), glow: typeof row.payload.glow === "string" ? row.payload.glow : undefined, enabled: row.payload.enabled !== false, order: row.sort_order, version: row.version };
}
export function toGallery(row: WebsiteRow, media: Record<string, unknown>): GalleryPlacement & { asset?: MediaAsset } {
  const asset = media[String(row.payload.media_id ?? "")] as Record<string, unknown> | undefined;
  // Gallery writes key placements by record_key; the table's UUID id is not the RPC key.
  return { id: row.key || row.id, mediaId: String(row.payload.media_id ?? ""), alt: String(row.payload.alt ?? ""), caption: String(row.payload.caption ?? ""), order: row.sort_order, visible: row.published, version: row.version, collectionKey: String(row.payload.collection_key ?? ""), asset: asset ? { id: String(asset.id), src: String(asset.public_url), name: String(asset.name), alt: String(asset.alt), caption: String(asset.caption ?? ""), source: String(asset.source), permission: String(asset.permission), uses: [], archived: Boolean(asset.archived) } : undefined };
}
export function toGalleryCollection(row: WebsiteRow): GalleryCollection {
  // The record_key is the stable identifier; it is never derived from alt text.
  return { id: row.key || row.id, name: String(row.payload.name ?? ""), description: String(row.payload.description ?? ""), order: row.sort_order, visible: row.published, version: row.version };
}
function storedBlogAuthor(value: unknown): BlogAuthor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const author = value as Record<string, unknown>;
  const name = typeof author.name === "string" ? author.name : "";
  const bio = typeof author.bio === "string" ? author.bio : "";
  const image = typeof author.image === "string" ? author.image : "";
  const imageAlt = typeof author.imageAlt === "string" ? author.imageAlt : "";
  const imageMediaId = typeof author.imageMediaId === "string" ? author.imageMediaId : "";
  if (!name && !bio && !image && !imageMediaId) return undefined;
  return {
    name,
    ...(bio ? { bio } : {}),
    ...(image ? { image } : {}),
    ...(imageAlt ? { imageAlt } : {}),
    ...(imageMediaId ? { imageMediaId } : {}),
  };
}

function storedBlogBlocks(value: unknown): BlogContentBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks = value.flatMap((entry, index): BlogContentBlock[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const block = entry as Record<string, unknown>;
    const numericOrder = Number(block.order);
    const order = Number.isFinite(numericOrder) ? numericOrder : index + 1;
    if (block.type === "text" && typeof block.text === "string") {
      return [{ type: "text", text: block.text, order }];
    }
    if (block.type === "image" && typeof block.src === "string") {
      return [{
        type: "image",
        mediaId: typeof block.mediaId === "string" ? block.mediaId : "",
        src: block.src,
        alt: typeof block.alt === "string" ? block.alt : "",
        caption: typeof block.caption === "string" ? block.caption : "",
        order,
      }];
    }
    return [];
  });
  return blocks.length ? blocks.sort((a, b) => a.order - b.order) : undefined;
}

export function toContent(row: WebsiteRow): ContentItem {
  const payload = row.payload;
  const draft = row.published && payload.draft && typeof payload.draft === "object" && !Array.isArray(payload.draft)
    ? payload.draft as Record<string, unknown>
    : payload;
  const readSnapshot = (source: Record<string, unknown>) => ({
    title: String(source.title ?? ""),
    slug: String(source.slug ?? row.key),
    summary: String(source.summary ?? ""),
    body: String(source.body ?? ""),
    image: String(source.image ?? ""),
    alt: String(source.alt ?? ""),
    ...(typeof source.imageMediaId === "string" ? { imageMediaId: source.imageMediaId } : {}),
    ...(storedBlogAuthor(source.author) ? { author: storedBlogAuthor(source.author) } : {}),
    ...(storedBlogBlocks(source.contentBlocks) ? { contentBlocks: storedBlogBlocks(source.contentBlocks) } : {}),
    ...(typeof source.publishedAt === "string" ? { publishedAt: source.publishedAt } : {}),
    ...(typeof source.modifiedAt === "string" ? { modifiedAt: source.modifiedAt } : {}),
    extra: (source.extra && typeof source.extra === "object" ? source.extra : {}) as Record<string, string>,
  });
  const current = readSnapshot(draft);
  const publishedSnapshot = row.published ? readSnapshot(payload) : undefined;
  const status = row.published
    ? draft === payload ? "Published" : "Draft"
    : payload.status === "Archived" ? "Archived" : "Draft";
  return {
    id: row.key || row.id,
    module: row.module === "blog" ? "Blog" : "Promotions",
    ...current,
    status,
    sort: row.sort_order,
    version: row.version,
    published: publishedSnapshot,
  };
}
export function toPromotion(row: WebsiteRow): PromotionRecord {
  const p = row.payload;
  return { id: row.key || row.id, internalTitle: String(p.internalTitle ?? ""), heading: String(p.heading ?? ""), body: String(p.body ?? ""), terms: String(p.terms ?? ""), exclusions: String(p.exclusions ?? ""), start: String(p.start ?? ""), end: String(p.end ?? ""), placement: String(p.placement ?? ""), priority: Number(p.priority ?? 0), ctaLabel: String(p.ctaLabel ?? ""), ctaHref: String(p.ctaHref ?? ""), enabled: p.enabled === true, yearConfirmed: p.yearConfirmed === true, status: p.status === "active" || p.status === "scheduled" || p.status === "paused" || p.status === "ended" ? p.status : "draft", version: row.version, ...(typeof p.imageUrl === "string" ? { imageUrl: p.imageUrl } : {}), ...(typeof p.imageAlt === "string" ? { imageAlt: p.imageAlt } : {}), ...(typeof p.serviceSlug === "string" && p.serviceSlug.trim() ? { serviceSlug: p.serviceSlug } : {}) };
}
export const seededFaqs: FaqItem[] = faqs.map((item, i) => ({ id: `seed-faq-${i + 1}`, question: item.q, answer: item.a, glow: item.glow, order: i + 1, enabled: true, version: 1 }));
export const seededLocations: LocationRecord[] = branches.map((item, i) => ({ id: item.slug, slug: item.slug, section: item.section, name: item.title, label: item.label, phone: item.phone, map: item.map, hours: item.hours.map(([d, h]) => [d, h]), order: i + 1, version: 1 }));
export const seededGalleryCollections: GalleryCollection[] = [
  { id: "laundry", name: "Laundry", description: "", order: 1, visible: true, version: 1 },
  { id: "garment-care", name: "Garment Care", description: "", order: 2, visible: true, version: 1 },
  { id: "shoe-care", name: "Shoe Care", description: "", order: 3, visible: true, version: 1 },
  { id: "behind-the-scenes", name: "BTS / Behind the Scenes", description: "", order: 4, visible: true, version: 1 },
  { id: "others", name: "Others", description: "", order: 5, visible: true, version: 1 },
];
export const seededGallery: (GalleryPlacement & { asset?: MediaAsset })[] = (photos.batch_14_gallery ?? []).filter(p => !/logo/i.test(p.alt)).map((photo, i) => ({ id: `seed-gallery-${i + 1}`, mediaId: `seed-gallery-${i + 1}`, alt: photo.alt, caption: "", order: i + 1, visible: true, version: 1, collectionKey: "", asset: { id: `seed-gallery-${i + 1}`, src: photo.src, name: photo.src.split("/").pop() ?? "marketing-image", alt: photo.alt, caption: "", source: "Approved design handoff", permission: "Approved marketing image", uses: [], archived: false } }));
export const seededServices: ContentItem[] = services.map((service, i) => ({ id: service.slug, module: "Services", title: service.title, slug: service.slug, summary: service.summary, body: "", image: service.image?.src ?? "", alt: service.image?.alt ?? "", status: "Published", sort: i + 1, version: 1, published: { title: service.title, slug: service.slug, summary: service.summary, body: "", image: service.image?.src ?? "", alt: service.image?.alt ?? "" }, extra: {} }));
export const seededPromotions: PromotionRecord[] = [];
export const seededMedia: MediaAsset[] = seededGallery.flatMap(g => g.asset ? [g.asset] : []);
