import type { Metadata } from "next";
import {
  OG_IMAGE_ALT,
  OG_IMAGE_PATH,
  SITE_NAME,
  VERIFICATION,
  absoluteUrl,
} from "../site";

type PageMetadataInput = {
  /** Page title without the brand suffix (the root template adds it). */
  title: string;
  description: string;
  /** Site path, e.g. "/locations/ashaiman-atadeka". */
  path: string;
  /** Set false for transactional or duplicate pages. */
  index?: boolean;
  follow?: boolean;
  image?: string;
  imageAlt?: string;
  type?: "website" | "article";
  /** Absolute title, used by the home page where the brand leads. */
  absoluteTitle?: boolean;
  publishedTime?: string;
  modifiedTime?: string;
};

/**
 * One metadata shape for every public page: unique title, description,
 * self-referencing canonical and matching Open Graph / Twitter cards.
 *
 * Canonicals are absolute so the emitted tag is correct even before
 * `metadataBase` is applied by a consumer.
 */
export function pageMetadata({
  title,
  description,
  path,
  index = true,
  follow = true,
  image = OG_IMAGE_PATH,
  imageAlt = OG_IMAGE_ALT,
  type = "website",
  absoluteTitle = false,
  publishedTime,
  modifiedTime,
}: PageMetadataInput): Metadata {
  const url = absoluteUrl(path);
  const imageUrl = absoluteUrl(image);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    robots: { index, follow },
    openGraph: {
      type,
      url,
      siteName: SITE_NAME,
      locale: "en_GH",
      title,
      description,
      images: [{ url: imageUrl, width: 1200, height: 630, alt: imageAlt }],
      ...(type === "article" && (publishedTime || modifiedTime)
        ? { publishedTime, modifiedTime }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: imageUrl, alt: imageAlt }],
    },
    ...(VERIFICATION.google || VERIFICATION.bing
      ? {
          verification: {
            google: VERIFICATION.google,
            other: VERIFICATION.bing
              ? { "msvalidate.01": VERIFICATION.bing }
              : undefined,
          },
        }
      : {}),
  };
}

/** Metadata for pages that must never appear in an index. */
export function noIndexMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  return pageMetadata({
    title,
    description,
    path,
    index: false,
    follow: true,
  });
}
