/**
 * Canonical public-site constants.
 *
 * `NEXT_PUBLIC_SITE_URL` is the single source of truth for the public origin.
 * It is normalised to `scheme://host` (no path, no trailing slash) so the same
 * value can be used for `metadataBase`, canonicals, sitemap entries and
 * JSON-LD `@id`s. When it is missing or malformed we fall back to the live
 * canonical domain rather than emitting a broken absolute URL.
 */

const FALLBACK_SITE_URL = "https://www.2ndwavelaundry.com";

function resolveSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return FALLBACK_SITE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return FALLBACK_SITE_URL;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return FALLBACK_SITE_URL;
  }
}

export const SITE_URL = resolveSiteUrl();

export const SITE_NAME = "2nd Wave Laundry Services";
export const SITE_SHORT_NAME = "2nd Wave Laundry";
export const SITE_TAGLINE = "A Redefined Laundry Experience.";

/** Phone numbers exactly as published on the site (display + E.164). */
export const PRIMARY_PHONE = "059 522 4280";
export const PRIMARY_PHONE_E164 = "+233595224280";

export const SITE_EMAIL = "info@2ndwavelaundry.com";

/** Areas where a staffed branch is published in `src/lib/content.ts`. */
export const SERVED_AREAS = [
  "Ashaiman",
  "Atadeka",
  "Katamanso",
  "Newland Katamanso",
] as const;

export const SOCIAL_PROFILE_URLS = {
  instagram: "https://www.instagram.com/2ndwave_laundry/",
  tiktok: "https://www.tiktok.com/@2ndwave.com",
} as const;

/** Google Maps share link published for the main branch. */
export const MAIN_BRANCH_MAP_URL =
  "https://maps.app.goo.gl/MfrvXSLGNtUu22HL8?g_st=ic";

/**
 * Default social/Open Graph image. Generated from the existing brand logo; a
 * stable public path so crawlers never see a deploy-specific hash.
 */
export const OG_IMAGE_PATH = "/og-image.png";
export const OG_IMAGE_ALT =
  "2nd Wave Laundry Services — A Redefined Laundry Experience";

export const LOGO_PATH = "/icon-512.png";

/** Build an absolute URL for a site path. Absolute inputs pass through. */
export function absoluteUrl(path = "/"): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/**
 * Optional verification tokens. Never hard-coded: set the environment values
 * in the hosting dashboard and they render into the page metadata.
 */
export const VERIFICATION = {
  google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim() || undefined,
  bing: process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION?.trim() || undefined,
};
