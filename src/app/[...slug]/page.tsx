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
import { JsonLd } from "@/components/seo/json-ld";
import { BookingForm } from "@/components/forms/booking";
import { demoMode, sections } from "@/lib/content";
import { branchProfileFor } from "@/lib/locations";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  articleSchema,
  breadcrumbSchema,
  faqSchema,
  itemListSchema,
  localBusinessSchema,
  serviceSchema,
} from "@/lib/seo/schema";
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

type PageMeta = {
  title: string;
  description: string;
  index?: boolean;
};

const pageMeta: Record<string, PageMeta> = {
  services: {
    title: "Laundry Services in Ashaiman & Katamanso",
    description:
      "Explore wash, ironing and fold, wash and fold only, ironing, stain treatment, bedding, curtains, suits, shoe care and express laundry from 2nd Wave Laundry Services.",
  },
  "how-it-works": {
    title: "How Laundry Pickup and Drop-off Works",
    description:
      "See how a 2nd Wave Laundry request works: submit a pickup request, agree the details with our team, then collect your laundry or have it delivered.",
  },
  locations: {
    title: "Laundry Branches in Ashaiman & Katamanso",
    description:
      "Find the three 2nd Wave Laundry Services branches, with phone numbers and opening hours, and choose the branch or pickup option that suits you.",
  },
  about: {
    title: "About 2nd Wave Laundry Services",
    description:
      "Learn who 2nd Wave Laundry Services is, where our three branches are, what we clean and how laundry pickup and drop-off work in Ashaiman and Katamanso.",
  },
  contact: {
    title: "Contact 2nd Wave Laundry Services",
    description:
      "Call 059 522 4280, message us on WhatsApp or send an enquiry. Branch phone numbers, email contacts and opening hours for 2nd Wave Laundry Services.",
  },
  "commercial-laundry": {
    title: "Commercial Laundry Enquiries in Greater Accra",
    description:
      "Discuss business laundry requirements with 2nd Wave Laundry Services. Share your items, quantities and frequency, and the team will discuss the details.",
  },
  "commercial-laundry/quote": {
    title: "Request a Commercial Laundry Quote",
    description:
      "Tell 2nd Wave Laundry Services about your business laundry needs so the team can discuss quantities, timing and a quote with you.",
    index: false,
  },
  gallery: {
    title: "Laundry and Garment Care Gallery",
    description:
      "Photographs of laundry, folded linens and finished garments from 2nd Wave Laundry Services in Ashaiman and Katamanso, Ghana.",
  },
  faq: {
    title: "Laundry Questions Answered",
    description:
      "Answers about pickup, turnaround, branches, booking, payment and garment care from 2nd Wave Laundry Services. Check the details before you book.",
  },
  blog: {
    title: "Laundry Notes and Garment Care Advice",
    description:
      "Laundry care notes and updates from 2nd Wave Laundry Services, covering everyday washing, stain treatment and garment care in Ghana.",
  },
  reviews: {
    title: "Customer Reviews",
    description:
      "Read what customers have shared about their experience with 2nd Wave Laundry Services in Ashaiman and Katamanso.",
    index: false,
  },
  "reviews/share": {
    title: "Share Your Experience",
    description:
      "Share your experience with 2nd Wave Laundry Services. Reviews are published after moderation and with your consent.",
    index: false,
  },
  book: {
    title: "Book a Laundry Pickup",
    description:
      "Submit a laundry pickup request to 2nd Wave Laundry Services. The team confirms the arrangement, fee and timing with you before your booking.",
    index: false,
  },
  preview: {
    title: "Frontend review",
    description: "Frontend preview states for 2nd Wave Laundry Services.",
    index: false,
  },
  privacy: {
    title: "Privacy Policy",
    description:
      "How 2nd Wave Laundry Services collects, uses and protects personal information submitted through the website, including bookings and enquiries.",
  },
  terms: {
    title: "Terms & Conditions",
    description:
      "The terms that apply when you use the 2nd Wave Laundry Services website, submit a request or use our laundry and garment-care services.",
  },
  "laundry-care-terms": {
    title: "Laundry Care Terms",
    description:
      "Laundry care terms from 2nd Wave Laundry Services, covering item handling, care labels, stain treatment expectations and collection arrangements.",
  },
};

/**
 * Unknown public URLs must return a real 404 status, not a rendered 200.
 * Resolving this in generateMetadata happens before streaming starts, so the
 * response status is correct as well as the visible not-found page.
 */
function missingPage(): never {
  notFound();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const key = slug.join("/");
  const staticMeta = pageMeta[key];

  if (staticMeta) {
    return pageMetadata({
      title: staticMeta.title,
      description: staticMeta.description,
      path: `/${key}`,
      index: staticMeta.index !== false,
    });
  }

  if (slug[0] === "services" && slug.length === 2) {
    const serviceList = await getPublicServices();
    const service = serviceList.find((s) => s.slug === slug[1]);
    if (!service) return missingPage();
    return pageMetadata({
      title: service.title,
      description: service.summary,
      path: `/services/${service.slug}`,
    });
  }

  if (slug[0] === "locations" && slug.length === 2) {
    const branchList = await getPublicBranches();
    const branch = branchList.find((b) => b.slug === slug[1]);
    if (!branch) return missingPage();
    const profile = branchProfileFor(branch.slug);
    return pageMetadata({
      title: profile
        ? `Laundry in ${profile.locality === "Ashaiman" ? "Ashaiman & Atadeka" : branch.title}`
        : branch.title,
      description: profile
        ? `${profile.intro.slice(0, 157).trim()}…`
        : `Visit the ${branch.title} branch of 2nd Wave Laundry Services.`,
      path: `/locations/${branch.slug}`,
    });
  }

  if (slug[0] === "blog" && slug.length === 2) {
    const post = await getPublicBlogPost(slug[1]);
    if (!post) return missingPage();
    return pageMetadata({
      title: post.title,
      description: post.summary,
      path: `/blog/${post.slug}`,
      type: "article",
      image: post.image || undefined,
      imageAlt: post.alt || undefined,
      publishedTime: post.publishedAt,
      modifiedTime: post.modifiedAt,
    });
  }

  return missingPage();
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

const HOME_BREADCRUMB = [{ name: "Home", path: "/" }];

/**
 * Each arm loads only the loaders its page renders. Pages that show no website
 * content (policies, how-it-works, commercial, book, reviews) read nothing.
 * Page-specific JSON-LD is built here, from the same data the page renders.
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
  let jsonLd: unknown[] = [];

  switch (key) {
    case "services": {
      const serviceList = await getPublicServices();
      page = <ServicesPage services={serviceList} />;
      jsonLd = [
        breadcrumbSchema([
          ...HOME_BREADCRUMB,
          { name: "Services", path: "/services" },
        ]),
        itemListSchema(
          "Laundry services",
          serviceList.map((service) => ({
            name: service.title,
            path: `/services/${service.slug}`,
          })),
        ),
      ];
      break;
    }
    case "how-it-works":
      page = <HowPage />;
      jsonLd = [
        breadcrumbSchema([
          ...HOME_BREADCRUMB,
          { name: "How it works", path: "/how-it-works" },
        ]),
      ];
      break;
    case "locations": {
      const branchList = await getPublicBranches();
      page = <LocationsPage branches={branchList} />;
      jsonLd = [
        breadcrumbSchema([
          ...HOME_BREADCRUMB,
          { name: "Locations", path: "/locations" },
        ]),
        itemListSchema(
          "2nd Wave Laundry Services branches",
          branchList.map((branch) => ({
            name: branch.title,
            path: `/locations/${branch.slug}`,
          })),
        ),
      ];
      break;
    }
    case "about": {
      const { promotions, promotionServices } = await getPublicPromotions();
      page = (
        <AboutPage promotions={promotions} promotionServices={promotionServices} />
      );
      jsonLd = [
        breadcrumbSchema([...HOME_BREADCRUMB, { name: "About", path: "/about" }]),
      ];
      break;
    }
    case "contact": {
      const [branchList, settings] = await Promise.all([
        getPublicBranches(),
        getPublicSettings(),
      ]);
      page = <ContactPage branches={branchList} settings={settings} />;
      jsonLd = [
        breadcrumbSchema([
          ...HOME_BREADCRUMB,
          { name: "Contact", path: "/contact" },
        ]),
      ];
      break;
    }
    case "commercial-laundry": {
      const settings = await getPublicSettings();
      page = <CommercialPage settings={settings} />;
      const commercialService = {
        slug: "commercial-laundry",
        title: "Commercial Laundry",
        summary:
          "Business laundry enquiries for organisations that need regular laundry arrangements discussed directly with the team.",
      };
      jsonLd = [
        breadcrumbSchema([
          ...HOME_BREADCRUMB,
          { name: "Commercial laundry", path: "/commercial-laundry" },
        ]),
        serviceSchema(commercialService, "/commercial-laundry"),
        faqSchema(sections["10.01"].faq),
      ];
      break;
    }
    case "commercial-laundry/quote":
      page = <QuotePage />;
      break;
    case "gallery": {
      const gallery = await getPublicGallery();
      page = <GalleryPage gallery={gallery} />;
      jsonLd = [
        breadcrumbSchema([
          ...HOME_BREADCRUMB,
          { name: "Gallery", path: "/gallery" },
        ]),
      ];
      break;
    }
    case "faq": {
      const faqs = await getPublicFaqs();
      page = <FAQPage faqs={faqs} />;
      jsonLd = [
        breadcrumbSchema([...HOME_BREADCRUMB, { name: "FAQs", path: "/faq" }]),
        faqSchema(faqs),
      ];
      break;
    }
    case "blog": {
      const posts = await getPublicBlogList();
      page = <BlogPage posts={posts} />;
      jsonLd = [
        breadcrumbSchema([...HOME_BREADCRUMB, { name: "Blog", path: "/blog" }]),
        itemListSchema(
          "Laundry Notes",
          posts.map((post) => ({
            name: post.title,
            path: `/blog/${post.slug}`,
          })),
        ),
      ];
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
    case "laundry-care-terms": {
      page = <PolicyPage slug={key} />;
      jsonLd = [
        breadcrumbSchema([
          ...HOME_BREADCRUMB,
          { name: pageMeta[key].title, path: `/${key}` },
        ]),
      ];
      break;
    }
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
        const service = serviceList.find((s) => s.slug === slug[1]);
        if (!service) notFound();
        page = (
          <ServiceDetail
            slug={service.slug}
            services={serviceList}
            settings={settings}
          />
        );
        const serviceFaq = sections[service.section]?.faq.length
          ? sections[service.section].faq
          : sections["04.00"].faq;
        jsonLd = [
          breadcrumbSchema([
            ...HOME_BREADCRUMB,
            { name: "Services", path: "/services" },
            { name: service.title, path: `/services/${service.slug}` },
          ]),
          serviceSchema(service),
          faqSchema(serviceFaq),
        ];
      } else if (slug[0] === "locations" && slug.length === 2) {
        const branchList = await getPublicBranches();
        const branch = branchList.find((b) => b.slug === slug[1]);
        if (!branch) notFound();
        const profile = branchProfileFor(branch.slug);
        page = (
          <BranchPage
            slug={branch.slug}
            branches={branchList}
            profile={profile}
          />
        );
        jsonLd = [
          breadcrumbSchema([
            ...HOME_BREADCRUMB,
            { name: "Locations", path: "/locations" },
            { name: branch.title, path: `/locations/${branch.slug}` },
          ]),
          localBusinessSchema(branch, profile),
          ...(profile?.faq.length ? [faqSchema(profile.faq)] : []),
        ];
      } else if (slug[0] === "blog" && slug.length === 2) {
        const post = await getPublicBlogPost(slug[1]);
        if (!post) notFound();
        page = <ArticlePage slug={post.slug} post={post} />;
        jsonLd = [
          breadcrumbSchema([
            ...HOME_BREADCRUMB,
            { name: "Blog", path: "/blog" },
            { name: post.title, path: `/blog/${post.slug}` },
          ]),
          articleSchema({
            ...post,
            datePublished: post.publishedAt,
            dateModified: post.modifiedAt,
          }),
        ];
      } else {
        notFound();
      }
  }

  return (
    <main
      id="main"
      className={fullBleed.has(key) ? "public-main" : "container public-main"}
    >
      <JsonLd data={jsonLd} />
      {page}
    </main>
  );
}
