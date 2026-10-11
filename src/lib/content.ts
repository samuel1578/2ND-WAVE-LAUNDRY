import content from "@/data/content.json";
import assetData from "@/data/assets.json";
import { demoMode } from "./demo-mode";
import { adminRoutes } from "./auth/permissions";
export { demoMode };
export type Photo = { src: string; alt: string };
type Section = {
  heading: string;
  fields: Record<string, string>;
  faq: { q: string; a: string; glow?: string }[];
};
export const sections = content as Record<string, Section>;
export const copy = (id: string, key: string, fallback = "") =>
  sections[id]?.fields[key] ?? fallback;
// The original export incorrectly labels several logo PNGs as service photography.
// Use the recovered photographic JPEG/WebP assets, never those mislabeled logos.
export const photos = Object.fromEntries(
  Object.entries(assetData).map(([key, items]) => [
    key,
    items.filter(
      (p) => !p.src.endsWith(".png") && !/2nd wave|logo|brand/i.test(p.alt),
    ),
  ]),
) as Record<string, Photo[]>;
export const contact = {
  phone: "059 522 4280",
  tel: "tel:+233595224280",
  whatsapp: "https://wa.me/233595224280",
  instagram: "https://www.instagram.com/2ndwave_laundry/",
  tiktok: "https://www.tiktok.com/@2ndwave.com",
};
export const foldedLinen: Photo = {
  src: "/images/commercial-linen-stacks.jpg",
  alt: "Freshly folded white towels and linens stacked on a stainless-steel table in a laundry facility",
};
const overridePhotos: Record<string, Photo> = {
  "duvet-and-bedding-cleaning": foldedLinen,
  "pickup-and-delivery": {
    src: "/images/pickup.jpg",
    alt: "Laundry attendant at the front counter with a customer's bag and packaged garments ready for pickup",
  },
  "curtain-cleaning": {
    src: "/images/curtain.png",
    alt: "Laundry technician deep-cleaning a hanging beige curtain with an extraction wand",
  },
};
type ServiceDef = {
  slug: string;
  section: string;
  source: string;
  focal?: string;
  bookable?: boolean;
};
const serviceDefs: ServiceDef[] = [
  {
    slug: "wash-ironing-fold",
    section: "04.01",
    source: "service-wash-and-fold",
    focal: "left center",
  },
  {
    slug: "wash-and-fold-only",
    section: "04.02",
    source: "service_detail_ironing",
  },
  {
    slug: "ironing",
    section: "04.03",
    source: "service_ironing",
    focal: "left center",
  },
  { slug: "shoe-care", section: "04.08", source: "service_detail_shoe_care" },
  {
    slug: "stain-treatment",
    section: "04.04",
    source: "service_stain_treatment",
  },
  {
    slug: "duvet-and-bedding-cleaning",
    section: "04.05",
    source: "service_detail_duvet_bedding_cleaning",
  },
  {
    slug: "curtain-cleaning",
    section: "04.06",
    source: "service_detail_curtain_cleaning",
  },
  {
    slug: "suit-cleaning",
    section: "04.07",
    source: "service_suit_cleaning",
  },
  {
    slug: "express-same-day-laundry",
    section: "04.09",
    source: "service_express_same_day_laundry",
  },
  {
    slug: "pickup-and-delivery",
    section: "04.10",
    source: "service_detail_pickup_delivery",
    bookable: false,
  },
];
export type Service = {
  slug: string;
  section: string;
  title: string;
  summary: string;
  image?: Photo;
  focal?: string;
  bookable: boolean;
};
export const services: Service[] = serviceDefs.map((def) => ({
  slug: def.slug,
  section: def.section,
  title: copy(def.section, "H1"),
  summary: copy(def.section, "Intro"),
  focal: def.focal,
  image: overridePhotos[def.slug] ?? photos[def.source]?.[0],
  bookable: def.bookable !== false,
}));
export const commercial = {
  slug: "commercial-laundry",
  section: "10.01",
  title: "Commercial Laundry",
  summary: copy("10.01", "Intro"),
  image: photos.batch_7_commercial_laundry?.find((p) => !/logo/i.test(p.alt)),
  bookable: false,
};
const relatedBySlug: Record<string, string[]> = {
  "wash-ironing-fold": [
    "wash-and-fold-only",
    "ironing",
    "stain-treatment",
  ],
  "wash-and-fold-only": [
    "ironing",
    "stain-treatment",
    "duvet-and-bedding-cleaning",
  ],
  ironing: ["wash-ironing-fold", "suit-cleaning", "stain-treatment"],
  "stain-treatment": ["wash-and-fold-only", "suit-cleaning", "shoe-care"],
  "duvet-and-bedding-cleaning": [
    "curtain-cleaning",
    "wash-ironing-fold",
    "wash-and-fold-only",
  ],
  "curtain-cleaning": ["duvet-and-bedding-cleaning", "wash-ironing-fold", "ironing"],
  "suit-cleaning": ["ironing", "stain-treatment", "shoe-care"],
  "shoe-care": ["stain-treatment", "suit-cleaning", "ironing"],
  "express-same-day-laundry": [
    "pickup-and-delivery",
    "wash-ironing-fold",
    "wash-and-fold-only",
  ],
  "pickup-and-delivery": [
    "express-same-day-laundry",
    "wash-and-fold-only",
    "wash-ironing-fold",
  ],
};
export const relatedFor = (slug: string): Service[] => {
  const picks = (relatedBySlug[slug] || [])
    .map((s) => services.find((service) => service.slug === s))
    .filter((s): s is Service => Boolean(s));
  if (picks.length >= 3) return picks.slice(0, 3);
  const extras = services.filter(
    (s) => s.slug !== slug && !picks.some((p) => p.slug === s.slug),
  );
  return [...picks, ...extras].slice(0, 3);
};
export const branches = [
  {
    slug: "ashaiman-atadeka",
    section: "07.02",
    title: "Ashaiman–Atadeka",
    label: "Main Branch",
    phone: "059 522 4280",
    tel: "tel:+233595224280",
    hours: [
      ["Monday–Saturday", "7am–8pm"],
      ["Sunday", "9am–7:30pm"],
    ],
    map: "https://maps.app.goo.gl/MfrvXSLGNtUu22HL8?g_st=ic",
  },
  {
    slug: "katamanso-no-1",
    section: "07.03",
    title: "Katamanso No. 1",
    label: "",
    phone: "059 814 8620",
    tel: "tel:+233598148620",
    hours: [["Opening hours", "7am–8pm"]],
    map: "",
  },
  {
    slug: "newland-katamanso",
    section: "07.04",
    title: "Newland Katamanso",
    label: "",
    phone: "024 614 4412",
    tel: "tel:+233246144412",
    hours: [["Opening hours", "7am–8pm"]],
    map: "",
  },
];
export const publicNav = [
  ["Home", "/"],
  ["Services", "/services"],
  ["How It Works", "/how-it-works"],
  ["Locations", "/locations"],
  ["Gallery", "/gallery"],
  ["Blog", "/blog"],
  ["About", "/about"],
  ["Commercial Laundry", "/commercial-laundry"],
  ["Contact", "/contact"],
  ["FAQs", "/faq"],
];
/**
 * Full administrative navigation, derived from the central permission registry
 * (`src/lib/auth/permissions.ts`) so labels and hrefs have a single source.
 *
 * This list is deliberately role-independent: role-filtered navigation is built
 * with `adminNavigationFor(role)`. Never render this unfiltered list for a role
 * other than `full_admin`.
 */
export const adminNav: [string, string][] = adminRoutes.map(({ label, href }) => [
  label,
  href,
]);
export const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export const faqs = [...sections["04.00"].faq, ...sections["13"].faq];
export const serviceHref = (slug: string) =>
  slug === "commercial-laundry" ? "/commercial-laundry" : `/services/${slug}`;
export const bookingHref = (slug?: string) =>
  slug && slug !== "pickup-and-delivery" ? `/book?service=${slug}` : "/book";
