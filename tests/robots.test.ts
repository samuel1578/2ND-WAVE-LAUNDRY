import test from "node:test";
import assert from "node:assert/strict";
import robots from "../src/app/robots";
import { SITE_URL } from "../src/lib/site";

/**
 * Guards the failure that made Search Console report "blocked by robots.txt":
 * a blanket `Disallow: /` (or any rule that prefixes a public URL) must never
 * return. These tests use robots.txt prefix/wildcard semantics, not a URL
 * router.
 */

type RobotsRule = {
  userAgent?: string | string[];
  allow?: string | string[];
  disallow?: string | string[];
};

const list = (value?: string | string[]): string[] =>
  Array.isArray(value) ? value : value ? [value] : [];

/** Google-style robots matching: prefix unless `$`, `*` matches any run. */
export function robotsRuleMatches(pattern: string, path: string): boolean {
  let anchored = false;
  let body = pattern;
  if (body.endsWith("$")) {
    anchored = true;
    body = body.slice(0, -1);
  }
  if (!body.includes("*")) {
    return anchored ? path === body : path.startsWith(body);
  }
  const parts = body.split("*");
  if (!path.startsWith(parts[0])) return false;
  let position = parts[0].length;
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    const found = path.indexOf(part, position);
    if (found === -1) return false;
    position = found + part.length;
  }
  return anchored ? position === path.length : true;
}

function rules(): RobotsRule[] {
  const config = robots();
  return (Array.isArray(config.rules) ? config.rules : [config.rules]) as RobotsRule[];
}

function blockingRules(path: string): string[] {
  return rules().flatMap((rule) =>
    list(rule.disallow).filter((pattern) => robotsRuleMatches(pattern, path)),
  );
}

test("no robots rule blocks a public page", () => {
  const publicPaths = [
    "/",
    "/locations",
    "/locations/",
    "/locations/ashaiman-atadeka",
    "/locations/katamanso-no-1",
    "/locations/newland-katamanso",
    "/services",
    "/services/wash-ironing-fold",
    "/services/ironing",
    "/commercial-laundry",
    "/about",
    "/contact",
    "/faq",
    "/blog",
    "/privacy",
    "/terms",
    "/laundry-care-terms",
    "/sitemap.xml",
    "/icon.png",
  ];
  for (const path of publicPaths) {
    assert.deepEqual(
      blockingRules(path),
      [],
      `${path} must be crawlable but is blocked by ${blockingRules(path).join(", ")}`,
    );
  }
});

test("no blanket disallow rule exists", () => {
  for (const rule of rules()) {
    assert.ok(
      !list(rule.disallow).includes("/"),
      "A blanket `Disallow: /` would block the entire site",
    );
  }
});

test("private and parameterised routes stay blocked", () => {
  const privatePaths = [
    "/admin",
    "/admin/login",
    "/auth/confirm",
    "/api/website",
    "/book",
    "/commercial-laundry/quote",
    "/reviews/share",
    "/preview",
    "/locations?state=x",
  ];
  for (const path of privatePaths) {
    assert.ok(
      blockingRules(path).length > 0,
      `${path} should remain blocked by robots.txt`,
    );
  }
});

test("robots.txt points at the canonical sitemap", () => {
  const sitemap = robots().sitemap;
  const value = Array.isArray(sitemap) ? sitemap[0] : sitemap;
  assert.equal(value, `${SITE_URL}/sitemap.xml`);
});
