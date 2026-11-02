import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Boogaloo } from "next/font/google";
import { Providers } from "@/components/providers";
import { Header, Footer, DemoBanner } from "@/components/shell";
import { ScrollToTop } from "@/components/scroll-to-top";
import { SiteSettingsProvider } from "@/components/site-settings-provider";
import { JsonLd } from "@/components/seo/json-ld";
import { organizationSchema, websiteSchema } from "@/lib/seo/schema";
import { getSiteSettings } from "@/lib/website/site-settings";
import {
  OG_IMAGE_ALT,
  OG_IMAGE_PATH,
  SITE_NAME,
  SITE_SHORT_NAME,
  SITE_URL,
  VERIFICATION,
  absoluteUrl,
} from "@/lib/site";
import "./globals.css";
import "./ui-fixes.css";

const jakarta = localFont({
  src: "../../public/plus-jakarta-sans.woff2",
  display: "swap",
  variable: "--font-jakarta",
  weight: "200 800",
});

const boogaloo = Boogaloo({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-boogaloo",
});

const HOME_TITLE =
  "2nd Wave Laundry | Laundry Services in Ashaiman & Katamanso";
const DEFAULT_DESCRIPTION =
  "2nd Wave Laundry Services offers wash, ironing and fold, stain treatment, shoe care and express laundry from three branches in Ashaiman and Katamanso, Ghana.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: HOME_TITLE,
    template: `%s | ${SITE_SHORT_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  generator: "Next.js",
  referrer: "strict-origin-when-cross-origin",
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "en_GH",
    title: HOME_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [
      {
        url: absoluteUrl(OG_IMAGE_PATH),
        width: 1200,
        height: 630,
        alt: OG_IMAGE_ALT,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [{ url: absoluteUrl(OG_IMAGE_PATH), alt: OG_IMAGE_ALT }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
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
  other: {
    "format-detection": "telephone=no",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1326" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reads the single cached settings entry (tag "site-settings"); no request API,
  // so routes keep their existing static/ISR/dynamic behaviour.
  const settings = await getSiteSettings();
  return (
    <html lang="en-GH" suppressHydrationWarning>
      <body className={`${jakarta.variable} ${boogaloo.variable}`}>
        {/* Brand entity for search and answer engines. Server-rendered on every
            page so the Organization/WebSite graph is never fetched client-side. */}
        <JsonLd data={[organizationSchema(), websiteSchema()]} />
        <Providers>
          <SiteSettingsProvider settings={settings}>
            <ScrollToTop />
            <a className="skip-link" href="#main">
              Skip to content
            </a>
            <DemoBanner />
            <Header />
            {children}
            <Footer />
          </SiteSettingsProvider>
        </Providers>
      </body>
    </html>
  );
}
