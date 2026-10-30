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
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
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
      {
        // Authenticated administration HTML must never be cached or shared.
        source: "/admin/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0",
          },
        ],
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
