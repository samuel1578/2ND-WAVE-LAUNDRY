import type { MetadataRoute } from "next";
import { services as defaultServices } from "@/lib/content";
import {
  getPublicBlogList,
  getPublicBranches,
  getPublicServices,
} from "@/lib/website/public";
import { SITE_URL } from "@/lib/site";

/**
 * Every public, indexable URL.
 *
 * Excluded on purpose: /admin, /auth, /api, /book, /commercial-laundry/quote,
 * /reviews/share and /preview (transactional or duplicate states).
 *
 * `lastModified` is omitted rather than invented: the site does not expose a
 * reliable content-updated date for static pages or blog posts.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [servicesResult, branchesResult, postsResult] = await Promise.allSettled([
    getPublicServices(),
    getPublicBranches(),
    getPublicBlogList(),
  ]);

  const services =
    servicesResult.status === "fulfilled" ? servicesResult.value : defaultServices;
  const branches = branchesResult.status === "fulfilled" ? branchesResult.value : [];
  const posts = postsResult.status === "fulfilled" ? postsResult.value : [];

  for (const [source, result] of [
    ["services", servicesResult],
    ["branches", branchesResult],
    ["blog", postsResult],
  ] as const) {
    if (result.status === "rejected") {
      console.error(`Sitemap data source failed: source=${source}`, result.reason);
    }
  }

  const url = (path: string): string =>
    path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;

  const staticPages: MetadataRoute.Sitemap = [
    { url: url("/"), changeFrequency: "weekly", priority: 1 },
    { url: url("/services"), changeFrequency: "monthly", priority: 0.9 },
    { url: url("/locations"), changeFrequency: "monthly", priority: 0.9 },
    { url: url("/commercial-laundry"), changeFrequency: "monthly", priority: 0.8 },
    { url: url("/how-it-works"), changeFrequency: "monthly", priority: 0.7 },
    { url: url("/about"), changeFrequency: "monthly", priority: 0.7 },
    { url: url("/contact"), changeFrequency: "monthly", priority: 0.8 },
    { url: url("/faq"), changeFrequency: "monthly", priority: 0.7 },
    { url: url("/blog"), changeFrequency: "weekly", priority: 0.6 },
    { url: url("/gallery"), changeFrequency: "monthly", priority: 0.5 },
    { url: url("/privacy"), changeFrequency: "yearly", priority: 0.2 },
    { url: url("/terms"), changeFrequency: "yearly", priority: 0.2 },
    { url: url("/laundry-care-terms"), changeFrequency: "yearly", priority: 0.2 },
  ];

  const serviceList = services.length ? services : defaultServices;

  return [
    ...staticPages,
    ...serviceList.map((service) => ({
      url: url(`/services/${service.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...branches.map((branch) => ({
      url: url(`/locations/${branch.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.9,
    })),
    ...posts
      .filter((post) => post.slug)
      .map((post) => ({
        url: url(`/blog/${post.slug}`),
        changeFrequency: "monthly" as const,
        priority: 0.6,
      })),
  ];
}
