import type { NextConfig } from "next";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseHost = supabaseUrl
  ? (() => {
    try {
      return new URL(supabaseUrl).hostname;
    } catch {
      return "";
    }
  })()
  : "";
// Vercel preview deployments must never be indexed. Evaluated at build time on
// Vercel, where the header applies to every response.
const isPreview = process.env.VERCEL_ENV === "preview";
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Canonical URLs never use a trailing slash. Next also redirects the
  // trailing-slash variant, so there is one URL per page.
  trailingSlash: false,
  images: {
    remotePatterns: supabaseHost
      ? [
        {
          protocol: "https",
          hostname: supabaseHost,
          pathname: "/storage/v1/object/public/marketing-assets/**",
        },
      ]
      : [],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31536000,
    qualities: [80, 82, 85],
  },
  async headers() {
    return [
      ...(isPreview
        ? [
            {
              source: "/:path*",
              headers: [
                { key: "X-Robots-Tag", value: "noindex, nofollow" },
              ],
            },
          ]
        : []),
      {
        // Authenticated administration HTML must never be cached or shared,
        // and must never be indexed.
        source: "/admin/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0",
          },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // Auth callbacks and API responses are never pages.
        source: "/auth/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/services/commercial-laundry",
        destination: "/commercial-laundry",
        permanent: true,
      },
      {
        source: "/services/wash-and-fold",
        destination: "/services/wash-ironing-fold",
        permanent: true,
      },
      {
        source: "/services/dry-cleaning",
        destination: "/services/ironing",
        permanent: true,
      },
    ];
  },
};
export default config;
