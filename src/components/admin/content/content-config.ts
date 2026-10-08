export type ContentModuleName =
  | "Services"
  | "Locations"
  | "Gallery"
  | "Blog"
  | "FAQs"
  | "Promotions";
export type ContentModule = {
  name: ContentModuleName;
  slug: string;
  description: string;
  action: string;
  createLabel?: string;
  publicationStates: boolean;
};
/**
 * Website Content modules. Homepage, About, Reviews and Policy Pages are
 * intentionally absent: they are code-managed or operational, not generic
 * CMS content.
 */
export const contentModules: ContentModule[] = [
  {
    name: "Services",
    slug: "services",
    description:
      "Catalogue entries for the public services with a draft, published and archived lifecycle.",
    action: "Manage Services",
    createLabel: "New Service",
    publicationStates: true,
  },
  {
    name: "Locations",
    slug: "locations",
    description:
      "Branch names, labels, phone numbers, opening hours and map links for the three documented branches.",
    action: "Manage Locations",
    publicationStates: false,
  },
  {
    name: "Gallery",
    slug: "gallery",
    description:
      "Selected Media Library images placed in the gallery with alt text, captions and display order.",
    action: "Manage Gallery",
    publicationStates: false,
  },
  {
    name: "Blog",
    slug: "blog",
    description:
      "Editorial articles with a draft, published and archived lifecycle.",
    action: "Manage Articles",
    createLabel: "New Article",
    publicationStates: true,
  },
  {
    name: "FAQs",
    slug: "faqs",
    description:
      "Questions and answers with display order and an enabled state.",
    action: "Manage FAQs",
    publicationStates: false,
  },
  {
    name: "Promotions",
    slug: "promotions",
    description:
      "Time-boxed campaigns with draft, scheduled, active, paused and ended states.",
    action: "Manage Promotions",
    createLabel: "New Promotion",
    publicationStates: true,
  },
];
export const modules = contentModules.map((m) => m.name);
export const codeManagedModules = [
  { slug: "homepage", name: "Homepage" },
  { slug: "about", name: "About" },
  { slug: "policy-pages", name: "Policy Pages" },
];
export type ContentRoute =
  | { kind: "dashboard" }
  | { kind: "module"; module: ContentModule; id?: string }
  | { kind: "code-managed"; name: string }
  | { kind: "reviews-moved" }
  | { kind: "not-found" };
export function resolveContentRoute(segments: string[]): ContentRoute {
  if (!segments.length) return { kind: "dashboard" };
  const [head, id] = segments;
  const entry = contentModules.find((m) => m.slug === head);
  if (entry) return { kind: "module", module: entry, id };
  if (head === "reviews") return { kind: "reviews-moved" };
  const managed = codeManagedModules.find((m) => m.slug === head);
  if (managed) return { kind: "code-managed", name: managed.name };
  return { kind: "not-found" };
}
