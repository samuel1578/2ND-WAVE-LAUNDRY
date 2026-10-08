import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Boogaloo } from "next/font/google";
import { Providers } from "@/components/providers";
import { Header, Footer, DemoBanner } from "@/components/shell";
import "./globals.css";
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
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GH" suppressHydrationWarning>
      <body className={`${jakarta.variable} ${boogaloo.variable}`}>
        <Providers>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <DemoBanner />
          <Header />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
