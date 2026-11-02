import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Crawl policy.
 *
 * Public marketing pages are open. Authenticated, transactional and
 * parameterised states are closed. The answer-engine crawlers are allowed
 * explicitly because being quotable/citable is a goal; they still cannot reach
 * /admin, /auth or /api.
 *
 * NOTE: `Google-Extended` is deliberately absent. Google documents it as a
 * training/grounding control for Gemini, not a search crawler, so the wildcard
 * rule (allow) applies. Changing that is an owner decision.
 */
const PRIVATE_PATHS = [
  "/admin",
  "/admin/",
  "/auth/",
  "/api/",
  "/book",
  "/commercial-laundry/quote",
  "/reviews/share",
  "/preview",
  "/*?state=",
  "/*?kind=",
  "/*?next=",
];

const SEARCH_AND_ANSWER_BOTS = [
  "Googlebot",
  "Googlebot-Image",
  "Bingbot",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: SEARCH_AND_ANSWER_BOTS,
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
