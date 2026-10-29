import type { ContentItem, FaqItem, GalleryPlacement, LocationRecord, MediaAsset, PromotionRecord, Settings } from "@/lib/contracts";
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
  return { id: row.id || row.key, mediaId: String(row.payload.media_id ?? ""), alt: String(row.payload.alt ?? ""), caption: String(row.payload.caption ?? ""), order: row.sort_order, visible: row.published, version: row.version, asset: asset ? { id: String(asset.id), src: String(asset.public_url), name: String(asset.name), alt: String(asset.alt), caption: String(asset.caption ?? ""), source: String(asset.source), permission: String(asset.permission), uses: [], archived: Boolean(asset.archived) } : undefined };
}
export function toContent(row: WebsiteRow): ContentItem {
  const p = row.payload;
  const title = String(p.title ?? "");
  const slug = String(p.slug ?? row.key);
  const summary = String(p.summary ?? "");
  const body = String(p.body ?? "");
  const image = String(p.image ?? "");
  const alt = String(p.alt ?? "");
  return { id: row.key || row.id, module: row.module === "blog" ? "Blog" : "Promotions", title, slug, summary, body, image, alt, status: row.published ? "Published" : "Draft", sort: row.sort_order, version: row.version, published: row.published ? { title, slug, summary, body, image, alt } : undefined, extra: (p.extra && typeof p.extra === "object" ? p.extra : {}) as Record<string, string> };
}
export function toPromotion(row: WebsiteRow): PromotionRecord {
  const p = row.payload;
  return { id: row.key || row.id, internalTitle: String(p.internalTitle ?? ""), heading: String(p.heading ?? ""), body: String(p.body ?? ""), terms: String(p.terms ?? ""), exclusions: String(p.exclusions ?? ""), start: String(p.start ?? ""), end: String(p.end ?? ""), placement: String(p.placement ?? ""), priority: Number(p.priority ?? 0), ctaLabel: String(p.ctaLabel ?? ""), ctaHref: String(p.ctaHref ?? ""), enabled: p.enabled === true, yearConfirmed: p.yearConfirmed === true, status: p.status === "active" || p.status === "scheduled" || p.status === "paused" || p.status === "ended" ? p.status : "draft", version: row.version };
}
export const seededFaqs: FaqItem[] = faqs.map((item, i) => ({ id: `seed-faq-${i + 1}`, question: item.q, answer: item.a, glow: item.glow, order: i + 1, enabled: true, version: 1 }));
export const seededLocations: LocationRecord[] = branches.map((item, i) => ({ id: item.slug, slug: item.slug, section: item.section, name: item.title, label: item.label, phone: item.phone, map: item.map, hours: item.hours.map(([d,h]) => [d,h]), order: i + 1, version: 1 }));
export const seededGallery: (GalleryPlacement & { asset?: MediaAsset })[] = (photos.batch_14_gallery ?? []).filter(p => !/logo/i.test(p.alt)).map((photo, i) => ({ id: `seed-gallery-${i + 1}`, mediaId: `seed-gallery-${i + 1}`, alt: photo.alt, caption: "", order: i + 1, visible: true, version: 1, asset: { id: `seed-gallery-${i + 1}`, src: photo.src, name: photo.src.split("/").pop() ?? "marketing-image", alt: photo.alt, caption: "", source: "Approved design handoff", permission: "Approved marketing image", uses: [], archived: false } }));
export const seededServices: ContentItem[] = services.map((service, i) => ({ id: service.slug, module: "Services", title: service.title, slug: service.slug, summary: service.summary, body: "", image: service.image?.src ?? "", alt: service.image?.alt ?? "", status: "Published", sort: i + 1, version: 1, published: { title: service.title, slug: service.slug, summary: service.summary, body: "", image: service.image?.src ?? "", alt: service.image?.alt ?? "" }, extra: {} }));
export const seededPromotions: PromotionRecord[] = [];
export const seededMedia: MediaAsset[] = seededGallery.flatMap(g => g.asset ? [g.asset] : []);
