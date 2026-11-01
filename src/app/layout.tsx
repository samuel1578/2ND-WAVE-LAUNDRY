import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Boogaloo } from "next/font/google";
import { Providers } from "@/components/providers";
import { Header, Footer, DemoBanner } from "@/components/shell";
import { ScrollToTop } from "@/components/scroll-to-top";
import { SiteSettingsProvider } from "@/components/site-settings-provider";
import { getSiteSettings } from "@/lib/website/site-settings";
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
export const metadata: Metadata = {
  title: {
    default: "2nd Wave Laundry Services",
    template: "%s | 2nd Wave Laundry Services",
  },
  description:
    "From everyday laundry to items needing extra attention, explore our services, book a pickup or visit one of our three branches.",
  robots: { index: false, follow: false },
  icons: { icon: "/images/logo.png" },
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
