"use client";
import { useSyncExternalStore } from "react";
import { branches, copy, demoMode, faqs, photos, services } from "./content";
import {
  confirmationError,
  faqErrors,
  galleryError,
  locationError,
  promoActive,
  promotionCtaError,
  promotionError,
  schedulingError,
  transitions,
  type Arrangement,
} from "./rules";
import type {
  Booking,
  BookingInput,
  ContentItem,
  FaqItem,
  GalleryPlacement,
  Lead,
  LocationRecord,
  MediaAsset,
  PromotionRecord,
  Repository,
  Settings,
  WebsiteContentState,
} from "./contracts";
export const blankArrangement: Arrangement = {
  branch: "",
  agreedPickup: "",
  fee: "",
  zeroReason: "",
  contactOutcome: "",
  confirmationNotes: "",
  returnDetails: "",
};
const date = new Date().toISOString().slice(0, 10);
const sampleInput: BookingInput = {
  services: ["wash-ironing-fold", "wash-and-fold-only"],
  category: "Clothing",
  items: "2 Standard Bags",
  notes: "",
  address: "Sample collection address",
  landmark: "",
  map: "",
  date,
  time: "",
  transport: "No preference",
  name: "Sample customer A",
  phone: "+233595224280",
  email: "",
  sameWhatsapp: true,
  whatsapp: "",
  contactMethod: "Phone call",
  acknowledged: true,
  photoNames: [],
};
const initialBookings: Booking[] = ["pending", "processing", "ready"].map(
  (s, i) => ({
    id: `demo-${i + 1}`,
    reference: `DEMO-00${i + 1}`,
    input: {
      ...sampleInput,
      name: `Sample customer ${String.fromCharCode(65 + i)}`,
      services:
        i === 1
          ? ["ironing"]
          : i === 2
            ? ["shoe-care"]
            : sampleInput.services,
    },
    status: s as Booking["status"],
    arrangement: {
      ...blankArrangement,
      branch: i === 0 ? "" : i === 1 ? "katamanso-no-1" : "newland-katamanso",
    },
    version: 1,
    history: [{ text: "Sample request created", at: new Date().toISOString() }],
    notes: [],
  }),
);
/** Approved service catalogue mirrored into demo CMS records (admin-only). */
const serviceSeeds: ContentItem[] = services.map((service, i) => {
  const body = copy(service.section, "Information", service.summary);
  const image = service.image?.src ?? "";
  const alt = service.image?.alt ?? "";
  return {
    id: service.slug,
    module: "Services",
    title: service.title,
    slug: service.slug,
    summary: service.summary,
    body,
    image,
    alt,
    status: "Published",
    sort: i + 1,
    version: 1,
    published: {
      title: service.title,
      slug: service.slug,
      summary: service.summary,
      body,
      image,
      alt,
    },
    extra: {},
  };
});
const locationSeeds: LocationRecord[] = branches.map((branch, i) => ({
  id: branch.slug,
  slug: branch.slug,
  section: branch.section,
  name: branch.title,
  label: branch.label,
  phone: branch.phone,
  map: branch.map,
  hours: branch.hours.map(([day, hours]) => [day, hours] as [string, string]),
  order: i + 1,
  version: 1,
}));
const gallerySeeds: GalleryPlacement[] = (photos.batch_14_gallery || []).map(
  (photo, i) => ({
    id: `placement-${i + 1}`,
    mediaId: `media-gallery-${i + 1}`,
    alt: photo.alt,
    caption: "",
    order: i + 1,
    visible: true,
    version: 1,
  }),
);
const faqSeeds: FaqItem[] = faqs.map((faq, i) => ({
  id: `faq-${i + 1}`,
  question: faq.q,
  answer: faq.a,
  order: i + 1,
  enabled: true,
  version: 1,
  ...(faq.glow ? { glow: faq.glow } : {}),
}));
const mediaSeeds: MediaAsset[] = [
  ...(photos.batch_24_media_library || [])
    .filter((p) => !/logo/i.test(p.alt))
    .map(
      (p, i) =>
        ({
          id: `media-${i}`,
          src: p.src,
          name: `marketing-asset-${i + 1}.webp`,
          alt: p.alt,
          caption: "",
          source: "Design handoff",
          permission: "Approval required before production",
          uses: i === 0 ? ["Services — Wash, Ironing & Fold", "Homepage"] : [],
          archived: false,
        }) satisfies MediaAsset,
    ),
  ...(photos.batch_14_gallery || []).map(
    (p, i) =>
      ({
        id: `media-gallery-${i + 1}`,
        src: p.src,
        name: p.src.split("/").pop() || `gallery-${i + 1}.jpg`,
        alt: p.alt,
        caption: "",
        source: "Design handoff",
        permission: "Approval required before production",
        uses: [],
        archived: false,
      }) satisfies MediaAsset,
  ),
];
let state: {
  bookings: Booking[];
  leads: Lead[];
  /** Public-facing demo records (Blog articles; public pages read these). */
  content: ContentItem[];
  media: MediaAsset[];
  settings: Settings;
  /** Admin-only Website Content records — never read by public pages. */
  websiteContent: WebsiteContentState;
} = {
  bookings: initialBookings,
  leads: [] as Lead[],
  content: serviceSeeds,
  media: mediaSeeds,
  websiteContent: {
    locations: locationSeeds,
    gallery: gallerySeeds,
    faqs: faqSeeds,
    promotions: [],
  },
  settings: {
    email: "",
    phone: "059 522 4280",
    whatsapp: "233595224280",
    instagram: "https://www.instagram.com/2ndwave_laundry/",
    tiktok: "https://www.tiktok.com/@2ndwave.com",
    facebook: "",
    acceptBookings: true,
    start: "07:00",
    end: "17:00",
    cutoff: "11:00",
    newsletter: false,
    version: 1,
  } satisfies Settings,
};
const serverSnapshot = state;
/** Read-only inspection for tests/adapters. Never a production persistence boundary. */
export const getDemoSnapshot = () => state;
const listeners = new Set<() => void>();
const notify = () => {
  state = { ...state };
  listeners.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const useDemoStore = () =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => serverSnapshot,
  );
const idempotency = new Map<string, { hash: string; value: Booking | Lead }>();
let failNext = false;
export function simulateNextFailure() {
  failNext = true;
}
async function operation() {
  if (!demoMode)
    throw Error(
      "Backend integration is not configured. Contact the team directly.",
    );
  await new Promise((r) => setTimeout(r, 550));
  if (failNext) {
    failNext = false;
    throw Error("We couldn’t save your changes. Please try again.");
  }
}
export const repository: Repository = {
  async createBooking(input, key) {
    const hash = JSON.stringify(input);
    const replay = idempotency.get(key);
    if (replay) {
      if (replay.hash !== hash)
        throw Error("This request changed. Please review and submit again.");
      return replay.value as Booking;
    }
    await operation();
    const committedReplay = idempotency.get(key);
    if (committedReplay) {
      if (committedReplay.hash !== hash)
        throw Error("This request changed. Please review and submit again.");
      return committedReplay.value as Booking;
    }
    if (!state.settings.acceptBookings)
      throw Error(
        "Online pickup requests are paused for now. Your details are still here.",
      );
    const invalid = schedulingError(
      input.date,
      input.time,
      input.services.includes("express-same-day-laundry"),
      new Date(),
      state.settings,
    );
    if (invalid) throw Error(invalid);
    const booking: Booking = {
      id: crypto.randomUUID(),
      reference: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      input: structuredClone(input),
      status: "pending",
      arrangement: { ...blankArrangement },
      version: 1,
      history: [
        {
          text: "Request saved as pending (demo)",
          at: new Date().toISOString(),
        },
      ],
      notes: [],
    };
    state.bookings = [booking, ...state.bookings];
    idempotency.set(key, { hash, value: booking });
    notify();
    return booking;
  },
  async updateBooking(id, version, patch) {
    await operation();
    const b = state.bookings.find((b) => b.id === id);
    if (!b) throw Error("Record not found.");
    if (b.version !== version)
      throw Error(
        "This booking changed while you were editing it. Reload the latest details before saving.",
      );
    const arrangement = patch.arrangement ?? b.arrangement;
    if (patch.status && patch.status !== b.status) {
      if (!transitions[b.status].includes(patch.status))
        throw Error("This status change is not allowed.");
      if (patch.status === "confirmed") {
        const error = confirmationError(arrangement);
        if (error) throw Error(error);
      }
      if (patch.status === "cancelled" && !patch.reason?.trim())
        throw Error("Enter a reason for cancellation.");
    }
    const updated = {
      ...b,
      status: patch.status ?? b.status,
      arrangement,
      version: b.version + 1,
      notes: patch.note ? [...b.notes, patch.note] : b.notes,
      history: [
        ...b.history,
        {
          text: patch.status
            ? `Status: ${patch.status}${patch.reason ? ` — ${patch.reason}` : ""}`
            : patch.note
              ? "Internal note added"
              : "Agreed arrangements updated",
          at: new Date().toISOString(),
        },
      ],
    };
    state.bookings = state.bookings.map((row) =>
      row.id === id ? updated : row,
    );
    notify();
    return updated;
  },
  async createLead(kind, fields, key) {
    const hash = JSON.stringify({ kind, fields });
    const replay = idempotency.get(key);
    if (replay) {
      if (replay.hash !== hash)
        throw Error("This submission changed. Please review it again.");
      return replay.value as Lead;
    }
    await operation();
    const committedReplay = idempotency.get(key);
    if (committedReplay) {
      if (committedReplay.hash !== hash)
        throw Error("This submission changed. Please review it again.");
      return committedReplay.value as Lead;
    }
    if (kind === "newsletter") {
      const existing = state.leads.find(
        (l) =>
          l.kind === kind &&
          l.fields.email.toLowerCase() === fields.email.toLowerCase() &&
          l.status !== "withdrawn",
      );
      if (existing) return existing;
    }
    const lead: Lead = {
      id: crypto.randomUUID(),
      kind,
      fields: structuredClone(fields),
      status: "new",
      createdAt: new Date().toISOString(),
      notes: [],
    };
    state.leads = [lead, ...state.leads];
    idempotency.set(key, { hash, value: lead });
    notify();
    return lead;
  },
};
export async function updateLead(
  id: string,
  status: Lead["status"],
  note?: string,
) {
  await operation();
  state.leads = state.leads.map((l) =>
    l.id === id
      ? { ...l, status, notes: note ? [...l.notes, note] : l.notes }
      : l,
  );
  notify();
}
export async function saveContent(
  item: ContentItem,
  action: "draft" | "publish" | "archive" | "save" | "unpublish",
) {
  await operation();
  const previous = state.content.find((c) => c.id === item.id);
  if (previous && previous.version !== item.version)
    throw Error(
      "This item changed while you were editing it. Reload the latest details before saving.",
    );
  if (
    action === "publish" &&
    (!item.title.trim() ||
      !item.slug.trim() ||
      !item.summary.trim() ||
      !item.body.trim() ||
      (item.image && !item.alt.trim()))
  )
    throw Error("Complete the required fields before publishing.");
  if (action === "publish" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug))
    throw Error("Use lowercase letters, numbers and hyphens for the slug.");
  if (
    state.content.some(
      (c) =>
        c.id !== item.id && c.module === item.module && c.slug === item.slug,
    )
  )
    throw Error("This slug is already used in this module.");
  const next: ContentItem = {
    ...item,
    id: item.id || crypto.randomUUID(),
    version: item.version + 1,
    status:
      action === "publish"
        ? "Published"
        : action === "archive"
          ? "Archived"
          : "Draft",
    published:
      action === "publish"
        ? {
            title: item.title,
            slug: item.slug,
            summary: item.summary,
            body: item.body,
            image: item.image,
            alt: item.alt,
          }
        : action === "unpublish" || action === "archive"
          ? undefined
          : previous?.published,
  };
  state.content = [next, ...state.content.filter((c) => c.id !== next.id)];
  notify();
  return next;
}
export async function deleteContent(id: string) {
  await operation();
  const item = state.content.find((c) => c.id === id);
  if (item?.published) throw Error("Unpublish this item before deleting it.");
  state.content = state.content.filter((c) => c.id !== id);
  notify();
}
const mediaInUse = (asset: Pick<MediaAsset, "id" | "src" | "uses">) =>
  asset.uses.length > 0 ||
  state.content.some(
    (c) => c.image === asset.src || c.published?.image === asset.src,
  ) ||
  state.websiteContent.gallery.some((p) => p.mediaId === asset.id);
export async function saveMedia(asset: MediaAsset, signal?: AbortSignal) {
  await operation();
  if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
  const existing = state.media.find((m) => m.id === asset.id);
  if (asset.archived && !existing?.archived && mediaInUse(asset))
    throw Error(
      "This media is still in use. Remove or replace its uses before archiving it.",
    );
  state.media = [asset, ...state.media.filter((m) => m.id !== asset.id)];
  notify();
}
export async function deleteMedia(id: string) {
  await operation();
  const m = state.media.find((m) => m.id === id);
  if (m && mediaInUse(m))
    throw Error(
      "This media is still in use. Remove or replace its uses before deleting it.",
    );
  if (m?.src.startsWith("blob:")) URL.revokeObjectURL(m.src);
  state.media = state.media.filter((m) => m.id !== id);
  notify();
}
export async function saveSettings(settings: Settings) {
  await operation();
  if (settings.version !== state.settings.version)
    throw Error("Settings changed. Reload the latest values before saving.");
  state.settings = { ...settings, version: settings.version + 1 };
  notify();
  return state.settings;
}
const conflict = (what: string) =>
  `This ${what} changed while you were editing it. Reload the latest details before saving.`;
/** Admin Website Content — fixed branch records (edit only, never create/delete). */
export async function saveLocation(next: LocationRecord) {
  await operation();
  const previous = state.websiteContent.locations.find(
    (l) => l.id === next.id,
  );
  if (!previous)
    throw Error("Record unavailable. Reload the list and try again.");
  if (previous.version !== next.version) throw Error(conflict("branch"));
  const error = locationError(next);
  if (error) throw Error(error);
  const saved: LocationRecord = { ...next, version: next.version + 1 };
  state.websiteContent = {
    ...state.websiteContent,
    locations: state.websiteContent.locations.map((l) =>
      l.id === saved.id ? saved : l,
    ),
  };
  notify();
  return saved;
}
/** Admin Website Content — replace the gallery placement list (never media assets). */
export async function saveGallery(items: GalleryPlacement[]) {
  await operation();
  const error = galleryError(items);
  if (error) throw Error(error);
  for (const item of items) {
    const asset = state.media.find((m) => m.id === item.mediaId);
    if (!asset || asset.archived)
      throw Error(
        "One of the selected media assets is unavailable. Remove it and try again.",
      );
  }
  for (const item of items) {
    const previous = state.websiteContent.gallery.find(
      (p) => p.id === item.id,
    );
    if (previous && previous.version !== item.version)
      throw Error(conflict("gallery"));
  }
  const saved = items.map((item, index) => ({
    ...item,
    order: index + 1,
    version: item.version + 1,
  }));
  state.websiteContent = { ...state.websiteContent, gallery: saved };
  notify();
  return saved;
}
/** Admin Website Content — commit the FAQ collection. */
export async function saveFaqs(items: FaqItem[]) {
  await operation();
  const error = faqErrors(items);
  if (error) throw Error(error);
  for (const item of items) {
    const previous = state.websiteContent.faqs.find((p) => p.id === item.id);
    if (previous && previous.version !== item.version)
      throw Error(conflict("FAQ"));
  }
  const saved = items.map((item, index) => ({
    ...item,
    order: index + 1,
    version: item.version + 1,
  }));
  state.websiteContent = { ...state.websiteContent, faqs: saved };
  notify();
  return saved;
}
/** Admin Website Content — campaign records (isolated from public pages). */
export async function savePromotion(next: PromotionRecord) {
  await operation();
  const dateError = promotionError(next);
  if (dateError) throw Error(dateError);
  const ctaError = promotionCtaError(next);
  if (ctaError) throw Error(ctaError);
  if (!next.internalTitle.trim())
    throw Error("Enter an internal title for this promotion.");
  const previous = state.websiteContent.promotions.find(
    (p) => p.id === next.id,
  );
  if (previous && previous.version !== next.version)
    throw Error(conflict("promotion"));
  const saved: PromotionRecord = {
    ...next,
    id: next.id || crypto.randomUUID(),
    version: (previous?.version ?? 0) + 1,
    status: previous?.status ?? "draft",
  };
  state.websiteContent = {
    ...state.websiteContent,
    promotions: previous
      ? state.websiteContent.promotions.map((p) =>
          p.id === saved.id ? saved : p,
        )
      : [saved, ...state.websiteContent.promotions],
  };
  notify();
  return saved;
}
export type PromotionAction =
  | "activate"
  | "pause"
  | "resume"
  | "end"
  | "delete-draft";
const promotionTransitions: Record<
  PromotionAction,
  { from: PromotionRecord["status"][]; message: string }
> = {
  activate: {
    from: ["draft"],
    message: "Only draft promotions can be activated.",
  },
  pause: {
    from: ["scheduled", "active"],
    message: "Only scheduled or active promotions can be paused.",
  },
  resume: { from: ["paused"], message: "Only paused promotions can be resumed." },
  end: {
    from: ["scheduled", "active", "paused"],
    message: "Only scheduled, active or paused promotions can be ended.",
  },
  "delete-draft": {
    from: ["draft"],
    message: "Only draft promotions can be deleted.",
  },
};
export async function transitionPromotion(
  id: string,
  version: number,
  action: PromotionAction,
  now = new Date(),
) {
  await operation();
  const record = state.websiteContent.promotions.find((p) => p.id === id);
  if (!record)
    throw Error("Record unavailable. Reload the list and try again.");
  if (record.version !== version) throw Error(conflict("promotion"));
  const rule = promotionTransitions[action];
  if (!rule.from.includes(record.status)) throw Error(rule.message);
  if (action === "delete-draft") {
    state.websiteContent = {
      ...state.websiteContent,
      promotions: state.websiteContent.promotions.filter((p) => p.id !== id),
    };
    notify();
    return record;
  }
  if (action === "activate" || action === "resume") {
    const error = promotionError(record, "activate");
    if (error) throw Error(error);
  }
  const armed = Date.parse(record.start) > now.getTime();
  const status: PromotionRecord["status"] =
    action === "pause"
      ? "paused"
      : action === "end"
        ? "ended"
        : armed
          ? "scheduled"
          : "active";
  const saved = { ...record, status, version: record.version + 1 };
  state.websiteContent = {
    ...state.websiteContent,
    promotions: state.websiteContent.promotions.map((p) =>
      p.id === id ? saved : p,
    ),
  };
  notify();
  return saved;
}
/** Reviews are operational submissions — moderation only, never fabricatable. */
export async function moderateReview(
  id: string,
  status: "approved" | "rejected" | "withdrawn",
  note?: string,
) {
  await operation();
  const review = state.leads.find((l) => l.id === id);
  if (!review || review.kind !== "review")
    throw Error("Record unavailable. Reload the list and try again.");
  if (status === "approved" && review.fields.consent !== "yes")
    throw Error("Publication permission is required.");
  state.leads = state.leads.map((l) =>
    l.id === id
      ? { ...l, status, notes: note ? [...l.notes, note] : l.notes }
      : l,
  );
  notify();
}
export type GalleryRow = {
  placement: GalleryPlacement;
  asset?: MediaAsset;
  available: boolean;
};
export const getLocations = () =>
  [...state.websiteContent.locations].sort((a, b) => a.order - b.order);
export const getGallery = (): GalleryRow[] =>
  [...state.websiteContent.gallery]
    .sort((a, b) => a.order - b.order)
    .map((placement) => {
      const asset = state.media.find((m) => m.id === placement.mediaId);
      return { placement, asset, available: !!asset && !asset.archived };
    });
export const visibleGalleryPlacements = () =>
  getGallery().filter((row) => row.placement.visible && row.available);
export const getFaqs = () =>
  [...state.websiteContent.faqs].sort((a, b) => a.order - b.order);
export const enabledFaqsOrdered = () => getFaqs().filter((f) => f.enabled);
export const getPromotions = () => [...state.websiteContent.promotions];
export const activePromotion = (now = new Date()) =>
  state.websiteContent.promotions.find(
    (p) =>
      (p.status === "active" || p.status === "scheduled") &&
      promoActive(p.enabled, p.start, p.end, now),
  );
export const getBlogPosts = () =>
  state.content.filter((c) => c.module === "Blog");
export const getServices = () =>
  state.content.filter((c) => c.module === "Services");
