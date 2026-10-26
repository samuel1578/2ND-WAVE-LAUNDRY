import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  AboutPage,
  ArticlePage,
  BlogPage,
  BranchPage,
  CommercialPage,
  ContactPage,
  FAQPage,
  GalleryPage,
  HowPage,
  LocationsPage,
  PolicyPage,
  QuotePage,
  ReviewsPage,
  ServiceDetail,
  ServicesPage,
} from "@/components/public-pages";
import { BookingForm } from "@/components/forms/booking";
import { branches, demoMode, services } from "@/lib/content";
import { PreviewPage } from "@/components/preview";
const titles: Record<string, string> = {
  services: "Our Services",
  "how-it-works": "Laundry arrangements made clear",
  locations: "Our Branches",
  about: "About 2nd Wave Laundry Services",
  contact: "Contact Us",
  "commercial-laundry": "Commercial Laundry",
  "commercial-laundry/quote": "Request a Commercial Quote",
  gallery: "Gallery",
  faq: "Frequently Asked Questions",
  blog: "Laundry Notes",
  reviews: "Customer Reviews",
  "reviews/share": "Share Your Experience",
  book: "Book a Pickup",
  privacy: "Privacy Policy",
  terms: "Terms & Conditions",
  "laundry-care-terms": "Laundry Care Terms",
  preview: "Frontend review",
};
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const key = slug.join("/");
  return {
    title:
      titles[key] ||
      services.find((s) => s.slug === slug[1])?.title ||
      branches.find((b) => b.slug === slug[1])?.title ||
      "Page",
    robots: { index: false, follow: false },
  };
}
const fullBleed = new Set([
  "how-it-works",
  "contact",
  "gallery",
  "faq",
  "locations",
  "services",
  "blog",
  "privacy",
  "terms",
  "laundry-care-terms",
  "reviews",
  "reviews/share",
  "preview",
]);
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const key = slug.join("/");
  let page: React.ReactNode;
  switch (key) {
    case "services":
      page = <ServicesPage />;
      break;
    case "how-it-works":
      page = <HowPage />;
      break;
    case "locations":
      page = <LocationsPage />;
      break;
    case "about":
      page = <AboutPage />;
      break;
    case "contact":
      page = <ContactPage />;
      break;
    case "commercial-laundry":
      page = <CommercialPage />;
      break;
    case "commercial-laundry/quote":
      page = <QuotePage />;
      break;
    case "gallery":
      page = <GalleryPage />;
      break;
    case "faq":
      page = <FAQPage />;
      break;
    case "blog":
      page = <BlogPage />;
      break;
    case "reviews":
      page = <ReviewsPage />;
      break;
    case "reviews/share":
      page = <ReviewsPage form />;
      break;
    case "book":
      page = (
        <BookingForm
          preselect={
            typeof query.service === "string" ? query.service : undefined
          }
          previewState={
            demoMode && typeof query.state === "string"
              ? query.state
              : undefined
          }
        />
      );
      break;
    case "privacy":
    case "terms":
    case "laundry-care-terms":
      page = <PolicyPage slug={key} />;
      break;
    case "preview":
      if (!demoMode) notFound();
      page = <PreviewPage />;
      break;
    default:
      if (
        slug[0] === "services" &&
        slug.length === 2 &&
        services.some((s) => s.slug === slug[1])
      )
        page = <ServiceDetail slug={slug[1]} />;
      else if (
        slug[0] === "locations" &&
        slug.length === 2 &&
        branches.some((b) => b.slug === slug[1])
      )
        page = <BranchPage slug={slug[1]} />;
      else if (slug[0] === "blog" && slug.length === 2 && demoMode)
        page = <ArticlePage slug={slug[1]} />;
      else notFound();
  }
  return (
    <main
      id="main"
      className={fullBleed.has(key) ? "public-main" : "container public-main"}
    >
      {page}
    </main>
  );
}
