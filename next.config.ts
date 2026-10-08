import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
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
