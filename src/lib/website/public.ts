import "server-only";
import { branches as defaultBranches, contact, faqs as defaultFaqs, photos, services as defaultServices, type Photo } from "@/lib/content";
import type { ContentItem, PromotionRecord } from "@/lib/contracts";
import { demoMode } from "@/lib/demo-mode";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { defaultSettings, toContent, toPromotion, type PublicSettings } from "./types";

export type PublicBranch = (typeof defaultBranches)[number];
export type PublicService = (typeof defaultServices)[number];
export type PublicWebsiteSnapshot = {
  services: PublicService[];
  branches: PublicBranch[];
  faqs: typeof defaultFaqs;
  gallery: Photo[];
  blog: ContentItem[];
  promotions: PromotionRecord[];
  settings: PublicSettings;
};
type PublicContentRow = {
  id: string;
  record_key: string;
  payload: Record<string, unknown>;
  sort_order: number;
  version: number;
  published: boolean;
};

const emptyLiveSnapshot: PublicWebsiteSnapshot = {
  services: defaultServices,
  branches: defaultBranches,
  faqs: [],
  gallery: [],
  blog: [],
  promotions: [],
  settings: defaultSettings,
};

function photo(src: string, alt: string): Photo | undefined {
  return src ? { src, alt } : undefined;
}

export async function getPublicWebsiteSnapshot(): Promise<PublicWebsiteSnapshot> {
  if (demoMode || !isSupabaseConfigured) {
    return {
      services: defaultServices,
      branches: defaultBranches,
      faqs: defaultFaqs,
      gallery: photos.batch_14_gallery ?? [],
      blog: [],
      promotions: [],
      settings: defaultSettings,
    };
  }

  const db = createSupabaseAdminClient();
  const [servicesResult, branchesResult, faqResult, galleryResult, blogResult, promotionResult, siteResult, bookingResult] = await Promise.all([
    db.from("services").select("slug,section,title,summary,public_body,public_image,public_alt,active,bookable,sort_order").eq("active", true).order("sort_order"),
    db.from("branches").select("slug,title,label,phone,public_map_url,public_hours,sort_order,active").eq("active", true).order("sort_order"),
    db.from("website_content").select("id,record_key,payload,sort_order,version,published").eq("module", "faq").eq("published", true).order("sort_order"),
    db.from("website_content").select("id,record_key,payload,sort_order,version,published,website_gallery_media(id,public_url,alt,archived)").eq("module", "gallery").eq("published", true).order("sort_order"),
    db.from("website_content").select("id,record_key,payload,sort_order,version,published").eq("module", "blog").eq("published", true).order("sort_order"),
    db.from("website_content").select("id,record_key,payload,sort_order,version,published").eq("module", "promotion").eq("published", true).order("sort_order"),
    db.from("public_site_settings").select("business_email,phone,whatsapp,instagram,tiktok,facebook,newsletter_visible").eq("id", true).maybeSingle(),
    db.from("booking_settings").select("accept_public_bookings,pickup_start,pickup_end,express_cutoff").eq("id", true).maybeSingle(),
  ]);
  if ([servicesResult, branchesResult, faqResult, galleryResult, blogResult, promotionResult, siteResult, bookingResult].some(result => result.error)) {
    return emptyLiveSnapshot;
  }

  const serviceRows = servicesResult.data ?? [];
  const serviceBySlug = new Map(defaultServices.map(service => [service.slug, service]));
  const services = serviceRows.map(row => {
    const baseline = serviceBySlug.get(row.slug);
    return {
      slug: row.slug,
      section: baseline?.section ?? row.slug,
      title: row.title,
      summary: row.summary,
      image: photo(row.public_image, row.public_alt) ?? baseline?.image,
      focal: baseline?.focal,
      bookable: row.bookable,
    };
  });
  const branchBySlug = new Map(defaultBranches.map(branch => [branch.slug, branch]));
  const branches = (branchesResult.data ?? []).map(row => {
    const baseline = branchBySlug.get(row.slug);
    return {
      slug: row.slug,
      section: baseline?.section ?? row.slug,
      title: row.title,
      label: row.label,
      phone: row.phone,
      tel: baseline?.tel ?? `tel:${row.phone.replace(/\D/g, "")}`,
      hours: Array.isArray(row.public_hours) && row.public_hours.length ? row.public_hours as [string, string][] : baseline?.hours ?? [],
      map: row.public_map_url || baseline?.map || "",
    };
  });
  const faqs = (faqResult.data ?? []).map(row => ({
    q: String(row.payload.question ?? ""),
    a: String(row.payload.answer ?? ""),
    ...(typeof row.payload.glow === "string" ? { glow: row.payload.glow } : {}),
  }));
  const gallery = (galleryResult.data ?? []).flatMap(row => {
    const media = Array.isArray(row.website_gallery_media) ? row.website_gallery_media[0] : row.website_gallery_media;
    return media && !media.archived ? [{ src: media.public_url, alt: String(row.payload.alt ?? media.alt) }] : [];
  });
  const toRow = (row: PublicContentRow) => ({
    id: row.id,
    key: row.record_key,
    module: "blog",
    payload: row.payload as Record<string, unknown>,
    published: row.published,
    sort_order: row.sort_order,
    version: row.version,
  });
  const blog = (blogResult.data ?? []).map(row => toContent(toRow(row as PublicContentRow)));
  const promotions = (promotionResult.data ?? []).map(row => toPromotion({ ...toRow(row as PublicContentRow), module: "promotion" }));
  return {
    services: services.length ? services : defaultServices,
    branches: branches.length ? branches : defaultBranches,
    faqs,
    gallery,
    blog,
    promotions,
    settings: siteResult.data && bookingResult.data ? {
      email: siteResult.data.business_email || contact.emails.info,
      phone: siteResult.data.phone,
      whatsapp: siteResult.data.whatsapp,
      instagram: siteResult.data.instagram,
      tiktok: siteResult.data.tiktok,
      facebook: siteResult.data.facebook,
      newsletter: siteResult.data.newsletter_visible,
      acceptBookings: bookingResult.data.accept_public_bookings,
      start: String(bookingResult.data.pickup_start).slice(0, 5),
      end: String(bookingResult.data.pickup_end).slice(0, 5),
      cutoff: String(bookingResult.data.express_cutoff).slice(0, 5),
      version: 1,
    } : defaultSettings,
  };
}
