import type { Arrangement, BookingStatus } from "./rules";
export type BookingInput = {
  services: string[];
  category: string;
  items: string;
  notes: string;
  address: string;
  landmark: string;
  map: string;
  date: string;
  time: string;
  transport: string;
  name: string;
  phone: string;
  email: string;
  sameWhatsapp: boolean;
  whatsapp: string;
  contactMethod: string;
  acknowledged: boolean;
  photoNames: string[];
};
export type Booking = {
  id: string;
  reference: string;
  input: BookingInput;
  status: BookingStatus;
  arrangement: Arrangement;
  version: number;
  history: { text: string; at: string }[];
  notes: string[];
};
export type Lead = {
  id: string;
  kind: "general" | "commercial" | "review" | "newsletter";
  fields: Record<string, string>;
  status:
  "new" | "contacted" | "closed" | "approved" | "rejected" | "withdrawn";
  createdAt: string;
  notes: string[];
};
export type BlogAuthor = {
  name: string;
  bio?: string;
  image?: string;
  imageAlt?: string;
  imageMediaId?: string;
};
export type BlogTextStyle =
  | "paragraph"
  | "heading2"
  | "heading3"
  | "bulleted"
  | "numbered";
export type BlogTextMark = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSize?: 12 | 14 | 16 | 18 | 20 | 24 | 28 | 32 | 36 | 48;
  color?: string;
  highlight?: string;
  fontFamily?: "Arial" | "Georgia" | "Inter" | "Times New Roman" | "Verdana";
  link?: string;
};
export type BlogTextSegment = {
  text: string;
  marks?: BlogTextMark;
};
export type BlogImageAlign = "left" | "center" | "right";
export type BlogImageSize = "small" | "medium" | "large" | "full";
export type BlogTextBlock = {
  type: "text";
  text: string;
  order: number;
  /** Block formatting; a missing style renders as a paragraph. */
  style?: BlogTextStyle;
  segments?: BlogTextSegment[];
};
export type BlogImageBlock = {
  type: "image";
  mediaId: string;
  src: string;
  alt: string;
  caption: string;
  order: number;
  /** Inline image placement; missing values fall back to centred and full width. */
  align?: BlogImageAlign;
  size?: BlogImageSize;
};
export type BlogContentBlock = BlogTextBlock | BlogImageBlock;
export type BlogArticleSnapshot = {
  title: string;
  slug: string;
  summary: string;
  body: string;
  image: string;
  alt: string;
  imageMediaId?: string;
  author?: BlogAuthor;
  contentBlocks?: BlogContentBlock[];
  publishedAt?: string;
  modifiedAt?: string;
  extra?: Record<string, string>;
};
export type ContentItem = {
  id: string;
  module: string;
  title: string;
  slug: string;
  summary: string;
  body: string;
  image: string;
  alt: string;
  imageMediaId?: string;
  author?: BlogAuthor;
  contentBlocks?: BlogContentBlock[];
  publishedAt?: string;
  modifiedAt?: string;
  status: "Draft" | "Published" | "Archived";
  sort: number;
  version: number;
  published?: BlogArticleSnapshot;
  extra: Record<string, string>;
};
export type MediaAsset = {
  id: string;
  src: string;
  name: string;
  alt: string;
  caption: string;
  source: string;
  permission: string;
  uses: string[];
  archived: boolean;
  version?: number;
};
/** Admin Website Content — fixed branch records (demo, admin-only namespace). */
export type LocationRecord = {
  id: string;
  slug: string;
  section: string;
  name: string;
  label: string;
  phone: string;
  map: string;
  hours: [string, string][];
  order: number;
  version: number;
};
/** Admin Website Content — a placed Media Library asset in the gallery. */
export type GalleryPlacement = {
  id: string;
  mediaId: string;
  alt: string;
  caption: string;
  order: number;
  visible: boolean;
  version: number;
  /** Stable slug of the collection this placement belongs to; empty = unassigned. */
  collectionKey: string;
};
/** Admin Website Content — an explicit, admin-managed gallery collection. */
export type GalleryCollection = {
  /** Stable slug (the website_content record_key), never derived from alt text. */
  id: string;
  name: string;
  description: string;
  order: number;
  visible: boolean;
  version: number;
  /** Count of assigned placements, populated by the admin overview query. */
  imageCount?: number;
};
/** Admin Website Content — structured question/answer record. */
export type FaqItem = {
  id: string;
  question: string;
  answer: string;
  order: number;
  enabled: boolean;
  version: number;
  glow?: string;
};
export type PromotionStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "paused"
  | "ended";
/** Admin Website Content — campaign record (admin-only namespace). */
export type PromotionRecord = {
  id: string;
  internalTitle: string;
  heading: string;
  body: string;
  terms: string;
  exclusions: string;
  start: string;
  end: string;
  placement: string;
  priority: number;
  ctaLabel: string;
  ctaHref: string;
  enabled: boolean;
  yearConfirmed: boolean;
  status: PromotionStatus;
  version: number;
  imageUrl?: string;
  imageAlt?: string;
  serviceSlug?: string;
};
export type PublishedPromotionRecord = PromotionRecord & { published: boolean };
/** Admin-only demo records for Website Content (isolated from public pages). */
export type WebsiteContentState = {
  locations: LocationRecord[];
  gallery: GalleryPlacement[];
  collections: GalleryCollection[];
  faqs: FaqItem[];
  promotions: PromotionRecord[];
};
export type Settings = {
  email: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  tiktok: string;
  facebook: string;
  acceptBookings: boolean;
  start: string;
  end: string;
  cutoff: string;
  newsletter: boolean;
  version: number;
  bookingVersion?: number;
};
export type Repository = {
  createBooking(input: BookingInput, key: string): Promise<Booking>;
  updateBooking(
    id: string,
    version: number,
    patch: {
      status?: BookingStatus;
      arrangement?: Arrangement;
      note?: string;
      reason?: string;
    },
  ): Promise<Booking>;
  createLead(
    kind: Lead["kind"],
    fields: Record<string, string>,
    key: string,
  ): Promise<Lead>;
};
