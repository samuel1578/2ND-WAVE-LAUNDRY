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
import {
  getPublicBlogList,
  getPublicBlogPost,
  getPublicBranches,
  getPublicFaqs,
  getPublicGallery,
  getPublicPromotions,
  getPublicServices,
  getPublicSettings,
} from "@/lib/website/public";
import { getSiteSettings } from "@/lib/website/site-settings";

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

/**
 * Each arm loads only the loaders its page renders. Pages that show no website
 * content (policies, how-it-works, commercial, book, reviews) read nothing.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const key = slug.join("/");
  let page: React.ReactNode;

  switch (key) {
    case "services": {
      const serviceList = await getPublicServices();
      page = <ServicesPage services={serviceList} />;
      break;
    }
    case "how-it-works":
      page = <HowPage />;
      break;
    case "locations": {
      const branchList = await getPublicBranches();
      page = <LocationsPage branches={branchList} />;
      break;
    }
    case "about": {
      const { promotions, promotionServices } = await getPublicPromotions();
      page = (
        <AboutPage promotions={promotions} promotionServices={promotionServices} />
      );
      break;
    }
    case "contact": {
      const [branchList, settings] = await Promise.all([
        getPublicBranches(),
        getPublicSettings(),
      ]);
      page = <ContactPage branches={branchList} settings={settings} />;
      break;
    }
    case "commercial-laundry": {
      const settings = await getPublicSettings();
      page = <CommercialPage settings={settings} />;
      break;
    }
    case "commercial-laundry/quote":
      page = <QuotePage />;
      break;
    case "gallery": {
      const galleryPhotos = await getPublicGallery();
      page = <GalleryPage photos={galleryPhotos} />;
      break;
    }
    case "faq": {
      const faqs = await getPublicFaqs();
      page = <FAQPage faqs={faqs} />;
      break;
    }
    case "blog": {
      const posts = await getPublicBlogList();
      page = <BlogPage posts={posts} />;
      break;
    }
    case "reviews":
      page = <ReviewsPage />;
      break;
    case "reviews/share":
      page = <ReviewsPage form />;
      break;
    case "book": {
      // Only this arm reads request query data.
      const query = await searchParams;
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
    }
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
      if (slug[0] === "services" && slug.length === 2) {
        const [serviceList, settings] = await Promise.all([
          getPublicServices(),
          getSiteSettings(),
        ]);
        if (!serviceList.some((s) => s.slug === slug[1])) notFound();
        page = (
          <ServiceDetail
            slug={slug[1]}
            services={serviceList}
            settings={settings}
          />
        );
      } else if (slug[0] === "locations" && slug.length === 2) {
        const branchList = await getPublicBranches();
        if (!branchList.some((b) => b.slug === slug[1])) notFound();
        page = <BranchPage slug={slug[1]} branches={branchList} />;
      } else if (slug[0] === "blog" && slug.length === 2) {
        const post = await getPublicBlogPost(slug[1]);
        if (!post) notFound();
        page = <ArticlePage slug={slug[1]} post={post} />;
      } else {
        notFound();
      }
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
