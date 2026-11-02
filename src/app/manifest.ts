import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_SHORT_NAME, SITE_TAGLINE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_SHORT_NAME,
    description: `${SITE_TAGLINE} Laundry, ironing and folding, stain treatment and shoe care across three branches in Ashaiman and Katamanso.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafbfc",
    theme_color: "#00609a",
    lang: "en-GH",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
