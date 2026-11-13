import type { PublicBranch, PublicService } from "@/lib/website/public-queries";
import type { BranchProfile } from "@/lib/locations";
import {
  LOGO_PATH,
  MAIN_BRANCH_MAP_URL,
  OG_IMAGE_PATH,
  ORGANIZATION_ID,
  PRIMARY_PHONE_E164,
  SERVED_AREAS,
  SITE_EMAIL,
  SITE_NAME,
  SITE_SHORT_NAME,
  SITE_TAGLINE,
  SITE_URL,
  SOCIAL_PROFILE_URLS,
  WEBSITE_ID,
  absoluteUrl,
} from "../site";

type Schema = Record<string, unknown>;

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const DAY_RANGES: Record<string, readonly string[]> = {
  "monday–saturday": DAY_NAMES.slice(0, 6),
  "monday-saturday": DAY_NAMES.slice(0, 6),
  "monday–friday": DAY_NAMES.slice(0, 5),
  "monday-friday": DAY_NAMES.slice(0, 5),
  "saturday–sunday": DAY_NAMES.slice(5),
  "saturday-sunday": DAY_NAMES.slice(5),
  "opening hours": DAY_NAMES,
  "every day": DAY_NAMES,
  daily: DAY_NAMES,
};

/** "7am" → "07:00", "7:30pm" → "19:30". Returns null when unparseable. */
export function to24Hour(value: string): string | null {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minutes = match[2] ?? "00";
  const suffix = match[3];
  if (hour > 12 || Number(minutes) > 59) return null;
  if (suffix === "pm" && hour !== 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minutes}`;
}

/**
 * Convert the display strings already shown on a branch page into
 * `openingHoursSpecification`. Unparseable labels are dropped instead of
 * guessed, so structured data can never claim hours the page does not show.
 */
export function openingHoursSchema(
  hours: readonly (readonly string[])[],
): Schema[] {
  return hours.flatMap((entry) => {
    const label = entry[0] ?? "";
    const value = entry[1] ?? "";
    const days = DAY_RANGES[label.trim().toLowerCase()];
    const parts = value.split(/[–-]/);
    if (!days || parts.length !== 2) return [];
    const opens = to24Hour(parts[0]);
    const closes = to24Hour(parts[1]);
    if (!opens || !closes) return [];
    return [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [...days],
        opens,
        closes,
      },
    ];
  });
}

export function organizationSchema(): Schema {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE_NAME,
    alternateName: SITE_SHORT_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl(LOGO_PATH),
      width: 512,
      height: 512,
      caption: SITE_NAME,
    },
    image: absoluteUrl(OG_IMAGE_PATH),
    description:
      "2nd Wave Laundry Services provides wash, ironing and fold, wash and fold only, ironing, stain treatment, duvet and bedding cleaning, curtain cleaning, suit cleaning, shoe care and express laundry from three branches in Ashaiman and Katamanso, Ghana.",
    slogan: SITE_TAGLINE,
    telephone: PRIMARY_PHONE_E164,
    email: SITE_EMAIL,
    areaServed: SERVED_AREAS.map((name) => ({ "@type": "City", name })),
    contactPoint: [
      {
        "@type": "ContactPoint",
        telephone: PRIMARY_PHONE_E164,
        contactType: "customer service",
        areaServed: "GH",
        availableLanguage: ["en"],
      },
    ],
    sameAs: [
      SOCIAL_PROFILE_URLS.instagram,
      SOCIAL_PROFILE_URLS.tiktok,
      MAIN_BRANCH_MAP_URL,
    ],
  };
}

export function websiteSchema(): Schema {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    alternateName: SITE_SHORT_NAME,
    url: SITE_URL,
    inLanguage: "en-GH",
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/**
 * LocalBusiness for a staffed branch. `DryCleaningOrLaundry` is the valid
 * schema.org LocalBusiness subtype for laundry businesses.
 */
export function localBusinessSchema(
  branch: Pick<PublicBranch, "slug" | "title" | "label" | "phone" | "map"> & {
    tel: string;
    hours: string[][];
  },
  profile?: BranchProfile,
): Schema {
  const url = absoluteUrl(`/locations/${branch.slug}`);
  const address: Schema = {
    "@type": "PostalAddress",
    addressLocality: profile?.locality ?? branch.title,
    addressRegion: "Greater Accra",
    addressCountry: "GH",
  };
  return {
    "@context": "https://schema.org",
    "@type": "DryCleaningOrLaundry",
    "@id": `${url}#branch`,
    name: `${SITE_NAME} — ${branch.title}`,
    url,
    image: absoluteUrl(OG_IMAGE_PATH),
    logo: absoluteUrl(LOGO_PATH),
    telephone: branch.tel.replace(/^tel:/, ""),
    address,
    openingHoursSpecification: openingHoursSchema(branch.hours),
    areaServed: (profile?.areaServed ?? [branch.title]).map((name) => ({
      "@type": "City",
      name,
    })),
    parentOrganization: { "@id": ORGANIZATION_ID },
    ...(branch.map ? { hasMap: branch.map } : {}),
    ...(profile?.latitude && profile?.longitude
      ? {
        geo: {
          "@type": "GeoCoordinates",
          latitude: profile.latitude,
          longitude: profile.longitude,
        },
      }
      : {}),
  };
}

export function breadcrumbSchema(
  items: { name: string; path: string }[],
): Schema {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function itemListSchema(
  name: string,
  items: { name: string; path: string }[],
): Schema {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.path),
    })),
  };
}

export function serviceSchema(
  service: Pick<PublicService, "slug" | "title" | "summary">,
  path = `/services/${service.slug}`,
): Schema {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.title,
    description: service.summary,
    serviceType: service.title,
    url: absoluteUrl(path),
    provider: { "@id": ORGANIZATION_ID },
    areaServed: SERVED_AREAS.map((name) => ({ "@type": "City", name })),
  };
}

export function faqSchema(items: readonly { q: string; a: string }[]): Schema {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function articleSchema(post: {
  slug: string;
  title: string;
  summary: string;
  image: string;
  body: string;
  author?: { name: string; image?: string };
  datePublished?: string;
  dateModified?: string;
}): Schema {
  const author = post.author?.name.trim()
    ? {
      "@type": "Person",
      name: post.author.name.trim(),
      ...(post.author.image ? { image: absoluteUrl(post.author.image) } : {}),
    }
    : { "@id": ORGANIZATION_ID };
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.summary,
    url: absoluteUrl(`/blog/${post.slug}`),
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
    image: post.image ? absoluteUrl(post.image) : absoluteUrl(OG_IMAGE_PATH),
    author,
    publisher: { "@id": ORGANIZATION_ID },
    inLanguage: "en-GH",
    articleSection: "Laundry Notes",
    ...(post.datePublished ? { datePublished: post.datePublished } : {}),
    ...(post.dateModified ? { dateModified: post.dateModified } : {}),
  };
}
