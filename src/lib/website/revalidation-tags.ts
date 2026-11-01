/**
 * Cache tags for the public website's cached loaders.
 *
 * Each tag covers exactly one publicly rendered data family, and the matching
 * server action revalidates that tag after a successful write. The mapping is a
 * plain table (no Next.js imports) so it can be unit tested directly.
 */
export const PUBLIC_TAGS = {
  services: "site-services",
  branches: "site-branches",
  faq: "site-faq",
  gallery: "site-gallery",
  blog: "site-blog",
  promotions: "site-promotions",
  settings: "site-settings",
} as const;

export type PublicTag = (typeof PUBLIC_TAGS)[keyof typeof PUBLIC_TAGS];

/** Every public write path, named after the server action that performs it. */
export type PublicWrite =
  | "faqs"
  | "gallery"
  | "media"
  | "content"
  | "promotion"
  | "service"
  | "location"
  | "settings";

/**
 * Tags each public write must invalidate.
 *
 * Media uploads, edits and deletions change gallery tiles, so they invalidate
 * the gallery tag rather than a media-specific one.
 */
export const PUBLIC_WRITE_TAGS: Record<PublicWrite, readonly string[]> = {
  faqs: [PUBLIC_TAGS.faq],
  gallery: [PUBLIC_TAGS.gallery],
  media: [PUBLIC_TAGS.gallery],
  content: [PUBLIC_TAGS.blog],
  promotion: [PUBLIC_TAGS.promotions],
  service: [PUBLIC_TAGS.services],
  location: [PUBLIC_TAGS.branches],
  settings: [PUBLIC_TAGS.settings],
};
