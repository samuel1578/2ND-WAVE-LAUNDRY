import Link from "next/link";
import Image from "next/image";
import {
  AlarmClock,
  ArrowUpRight,
  BedDouble,
  Camera,
  ChevronRight,
  Clock,
  Info,
  Layers,
  ListChecks,
  Mail,
  MapPin,
  Package,
  Phone,
  Shirt,
  ShoppingBag,
  Sparkles,
  SprayCan,
  Store,
  StickyNote,
  Tag,
  Truck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  copy,
  services,
  commercial,
  branches,
  photos,
  faqs,
  sections,
  contact,
  bookingHref,
  relatedFor,
  serviceHref,
} from "@/lib/content";
import {
  Action,
  Breadcrumb,
  BranchCards,
  Closing,
  FAQ,
  HandoverChoice,
  Heading,
  Picture,
  PickupChoice,
  Section,
  ServiceCard,
  ServiceHero,
} from "./ui";
import { Reveal } from "./motion";
import { SwipeTrack } from "./swipe-track";
import { BrandText, Glow } from "./brand-text";
import { DottedGlowBackground } from "./dotted-glow-background";
import { LogoVideoHero } from "./logo-video-hero";
import { PublicForm } from "./forms/public-form";
import { isElevatedConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Gallery } from "./gallery";
import {
  PublishedBlog,
  PublishedArticle,
  PublishedReviews,
} from "./published-content";
export function ServicesPage() {
  return (
    <>
      <section className="page-hero">
        <DottedGlowBackground gap={14} radius={1.8} opacity={0.75} />
        <div className="page-hero__inner">
          <Heading
            title={copy("03", "H1")}
            description={copy("03", "Intro")}
            eyebrow="A Redefined Laundry Experience"
          />
        </div>
      </section>
      <div className="container">
        <SwipeTrack className="grid three">
          {[...services, commercial].map((s, i) => (
            <ServiceCard service={s} index={i} key={s.slug} />
          ))}
        </SwipeTrack>
        <Section
          title={copy("03", "Closing heading")}
          description={copy("03", "Closing text")}
        >
          <div className="actions">
            <Action href="/contact">Contact the Team</Action>
            <Action href="/book" secondary>
              Book a Pickup
            </Action>
          </div>
        </Section>
      </div>
    </>
  );
}
type DetailCard = {
  key: string;
  title?: string;
  body: string;
  icon?: LucideIcon;
  step?: string;
  action?: { href: string; label: string };
};
const detailCardIcons: LucideIcon[] = [ShoppingBag, Tag, Camera];
const sharedFieldCards: [string, string, LucideIcon][] = [
  ["Eligibility heading", "Eligibility", ListChecks],
  ["Additional information heading", "Additional information", StickyNote],
  ["Cutoff heading", "Cutoff text", AlarmClock],
  ["Availability heading", "Availability text", Info],
  ["Hours heading", "Hours", Clock],
  ["Collection heading", "Collection", Truck],
  ["Express heading", "Express", Zap],
  ["Alternative heading", "Alternative", Store],
];
const relatedIcons: Record<string, LucideIcon> = {
  "wash-ironing-fold": Sparkles,
  "wash-and-fold-only": ShoppingBag,
  ironing: Shirt,
  "stain-treatment": SprayCan,
  "duvet-and-bedding-cleaning": BedDouble,
  "curtain-cleaning": Layers,
  "suit-cleaning": Shirt,
  "shoe-care": Package,
  "express-same-day-laundry": Zap,
  "pickup-and-delivery": Truck,
};
export function ServiceDetail({ slug }: { slug: string }) {
  const s = services.find((s) => s.slug === slug)!;
  const id = s.section;
  const fields = sections[id].fields;
  const ctaLabel = copy(id, "CTA", copy(id, "Closing CTA", "Book a Pickup"));
  const cards: DetailCard[] = [];
  const detailEntries = [1, 2, 3]
    .map(
      (n) =>
        [
          n,
          fields[`Detail card ${n} title`],
          fields[`Detail card ${n} text`],
        ] as const,
    )
    .filter(([, title, body]) => title && body);
  if (detailEntries.length) {
    detailEntries.forEach(([n, title, body]) => {
      cards.push({
        key: `detail-${n}`,
        title,
        body,
        icon: detailCardIcons[n - 1],
      });
    });
  } else if (fields["Information"]) {
    cards.push({
      key: "information",
      title: fields["Information heading"] || s.title,
      body: fields["Information"],
      icon: Package,
    });
  }
  ["Step 1", "Step 2", "Step 3"].forEach((key, i) => {
    if (!fields[key]) return;
    const [title, ...rest] = fields[key].split(" — ");
    cards.push({ key, title, body: rest.join(" — "), step: `0${i + 1}` });
  });
  sharedFieldCards.forEach(([titleKey, bodyKey, icon]) => {
    if (!fields[bodyKey]) return;
    cards.push({
      key: bodyKey,
      title: fields[titleKey],
      body: fields[bodyKey],
      icon,
      action:
        bodyKey === "Alternative" && fields["Alternative CTA"]
          ? { href: "/locations", label: fields["Alternative CTA"] }
          : undefined,
    });
  });
  const detailsHeading = copy(
    id,
    "Details heading",
    copy(id, "Process heading", copy("04.00", "Details heading")),
  );
  return (
    <>
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Services", href: "/services" },
          { label: s.title },
        ]}
      />
      <ServiceHero
        service={s}
        primary={{ href: bookingHref(slug), label: ctaLabel }}
        secondary={{
          href: "/locations",
          label: copy("04.00", "Secondary opening CTA"),
        }}
      />
      {cards.length > 0 && (
        <Section className="brief-band" title={detailsHeading}>
          <div className="brief-grid">
            {cards.map((card, i) => (
              <Reveal
                className="brief-card"
                key={card.key}
                delay={(i % 2) * 0.06}
              >
                <span className="icon-chip">
                  {card.step ? (
                    <span className="step-number">{card.step}</span>
                  ) : card.icon ? (
                    <card.icon size={20} aria-hidden="true" />
                  ) : null}
                </span>
                <div className="brief-card-body">
                  {card.title && <h3>{card.title}</h3>}
                  {card.body && <p>{card.body}</p>}
                  {card.action && (
                    <Action href={card.action.href} secondary>
                      {card.action.label}
                    </Action>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </Section>
      )}
      <Section
        title={copy(id, "Handover heading", copy("04.00", "Handover heading"))}
      >
        <HandoverChoice slug={slug} cta={ctaLabel} />
      </Section>
      <Section title={copy(id, "FAQ heading", copy("04.00", "FAQ heading"))}>
        <FAQ
          items={
            sections[id].faq.length ? sections[id].faq : sections["04.00"].faq
          }
        />
      </Section>
      <Section title={copy("04.00", "Related heading")}>
        <div className="related-list">
          {relatedFor(slug).map((service, i) => {
            const Icon = relatedIcons[service.slug] ?? Package;
            return (
              <Reveal key={service.slug} delay={i * 0.06}>
                <Link href={serviceHref(service.slug)} className="related-row">
                  <span className="icon-chip">
                    {service.slug === "wash-ironing-fold" ? (
                      <Image
                        src="/images/logo.png"
                        alt=""
                        width={22}
                        height={22}
                        aria-hidden="true"
                      />
                    ) : (
                      <Icon size={20} aria-hidden="true" />
                    )}
                  </span>
                  <span className="related-copy">
                    <strong>{service.title}</strong>
                    <span className="related-summary">{service.summary}</span>
                  </span>
                  <span className="related-action">
                    {copy("02", "Card action", "View Service")}
                    <ChevronRight size={16} aria-hidden="true" />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </Section>
      <Reveal>
        <section className="closing service-closing">
          <span className="closing-icon">
            <Image
              src="/images/logo.png"
              alt=""
              width={32}
              height={32}
              aria-hidden="true"
            />
          </span>
          <h2>{copy(id, "Closing", copy("02", "Closing heading"))}</h2>
          <p className="closing-line">{copy("04.00", "Closing text")}</p>
          <div className="actions">
            <Action href={bookingHref(slug)}>{ctaLabel}</Action>
            <a className="button whatsapp" href={contact.whatsapp}>
              Chat on WhatsApp
            </a>
          </div>
        </section>
      </Reveal>
    </>
  );
}
export function HowPage() {
  return (
    <>
      <section className="page-hero">
        <DottedGlowBackground gap={14} radius={1.8} opacity={0.75} />
        <div className="page-hero__inner">
          <Heading title={copy("05", "H1")} description={copy("05", "Intro")} />
          <div className="actions">
            <Action href="/book">Book a Pickup</Action>
            <Action href="/locations" secondary>
              Visit a Branch
            </Action>
          </div>
        </div>
      </section>
      <div className="container">
        <Section title={copy("05", "Pickup heading")}>
          <div className="timeline">
            {[1, 2, 3, 4, 5].map((n) => {
              const [title, body] = copy("05", `Step ${n}`).split(" â€” ");
              return (
                <Reveal className="timeline-row" key={n}>
                  <span>0{n}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </Section>
        <Section>
          <div className="grid two">
            <article className="choice-card">
              <h2>{copy("05", "Walk-in heading")}</h2>
              <p>{copy("05", "Walk-in text")}</p>
              <Action href="/locations" secondary>
                View Locations
              </Action>
            </article>
            <article className="choice-card tint">
              <h2>{copy("05", "Express heading")}</h2>
              <p>{copy("05", "Express text")}</p>
              <Action href={bookingHref("express-same-day-laundry")}>
                Request Express Laundry
              </Action>
            </article>
          </div>
        </Section>
        <Closing />
      </div>
    </>
  );
}
export function LocationsPage() {
  return (
    <>
      <section className="page-hero">
        <DottedGlowBackground gap={14} radius={1.8} opacity={0.75} />
        <div className="page-hero__inner">
          <Heading
            title={copy("07.01", "H1")}
            description={copy("07.01", "Intro")}
          />
        </div>
      </section>
      <div className="container">
        <BranchCards />
        <Section
          title={copy("07.01", "Pickup heading")}
          description={copy("07.01", "Pickup text")}
        >
          <Action href="/book">Book a Pickup</Action>
        </Section>
      </div>
    </>
  );
}
export function BranchPage({ slug }: { slug: string }) {
  const branch = branches.find((b) => b.slug === slug)!;
  return (
    <>
      <Link className="back-link" href="/locations">
        â† View All Branches
      </Link>
      <Heading
        title={branch.title}
        description={copy(branch.section, "Intro")}
        eyebrow={branch.label || "Our branches"}
      />
      <div className="grid two">
        <Reveal className="branch-feature">
          <MapPin size={38} />
          <h2>{branch.title}</h2>
          <a className="branch-phone" href={branch.tel}>
            {branch.phone}
          </a>
          <div className="actions">
            <a className="button" href={branch.tel}>
              <Phone size={18} />
              Call Branch
            </a>
            <Action href="/book" secondary>
              Book a Pickup
            </Action>
          </div>
        </Reveal>
        <Reveal className="panel">
          <h2>Opening hours</h2>
          {branch.hours.map(([day, hours]) => (
            <div className="hours-row" key={day}>
              <span>{day}</span>
              <strong>{hours}</strong>
            </div>
          ))}
          {branch.map && (
            <>
              <h3>Find the main branch</h3>
              <a
                className="button secondary"
                href={branch.map}
                target="_blank"
                rel="noreferrer"
              >
                Get Directions <ArrowUpRight size={18} />
              </a>
              <small>Opens your maps app</small>
            </>
          )}
        </Reveal>
      </div>
      <Section
        title="Prefer collection?"
        description={copy("07.01", "Pickup text")}
      >
        <Action href="/book">Book a Pickup</Action>
      </Section>
    </>
  );
}
export function AboutPage() {
  return (
    <>
      <div className="detail-hero">
        <Heading title={copy("08", "H1")} description={copy("08", "Tagline")} />
        <Picture photo={photos.batch_14_about?.[0]} priority />
      </div>
      <Section className="about-body">
        <p className="large-copy">
          <BrandText text={copy("08", "Body")} />
        </p>
      </Section>
      <Section title={copy("08", "Heading")} description={copy("08", "Text")}>
        <PickupChoice />
      </Section>
      <Closing />
    </>
  );
}
export function ContactPage() {
  const emailContacts = [
    {
      label: "Orders & scheduling",
      purpose: "Pickup and drop-off scheduling, booking confirmations, and order updates.",
      email: contact.emails.orders,
    },
    {
      label: "Customer support",
      purpose: "Questions about orders, services, pricing, or garment care.",
      email: contact.emails.support,
    },
    {
      label: "Business & partnerships",
      purpose: "Commercial laundry enquiries, partnerships, and business opportunities.",
      email: contact.emails.info,
    },
    {
      label: "Billing",
      purpose: "Invoices, payment confirmations, business billing, and receipts.",
      email: contact.emails.billing,
    },
    {
      label: "Careers",
      purpose: "Management, job opportunities, and payroll enquiries.",
      email: contact.emails.manager,
    },
  ];

  return (
    <>
      <section className="page-hero">
        <DottedGlowBackground gap={14} radius={1.8} opacity={0.75} />
        <div className="page-hero__inner">
          <Heading title={copy("09", "H1")} description={copy("09", "Intro")} />
        </div>
      </section>
      <div className="container">
        <div className="contact-grid">
          <aside className="contact-panel">
            <p className="eyebrow">Get in touch</p>
            <a className="contact-number" href={contact.tel}>
              {contact.phone}
            </a>
            <div className="menu-actions">
              <a className="button" href={contact.tel}>
                Call Us
              </a>
              <a className="button whatsapp" href={contact.whatsapp}>
                Chat on WhatsApp
              </a>
              <Action href="/locations" secondary>
                View Locations
              </Action>
            </div>
            <section
              className="contact-emails"
              aria-label="Email contacts by purpose"
            >
              {emailContacts.map(({ label, purpose, email }) => (
                <div className="contact-email" key={email}>
                  <span className="contact-email__icon" aria-hidden="true">
                    <Mail size={18} />
                  </span>
                  <div>
                    <h3>{label}</h3>
                    <p>{purpose}</p>
                    <a className="contact-email__address" href={`mailto:${email}`}>
                      <Glow>{email}</Glow>
                    </a>
                  </div>
                </div>
              ))}
            </section>
            <div className="contact-branches">
              {branches.map((b) => (
                <div key={b.slug}>
                  <strong>{b.title}</strong>
                  <a href={b.tel}>{b.phone}</a>
                </div>
              ))}
            </div>
          </aside>
          <div className="panel">
            <h2>{copy("09", "Form heading")}</h2>
            <p>{copy("09", "Form intro")}</p>
            <PublicForm kind="general" />
          </div>
        </div>
      </div>
    </>
  );
}
export function CommercialPage() {
  return (
    <>
      <Link className="back-link" href="/services">
        â† All Services
      </Link>
      <div className="detail-hero">
        <div>
          <Heading
            title="Commercial Laundry"
            description={copy("10.01", "Intro")}
          />
          <div className="actions">
            <Action href="/commercial-laundry/quote">Request a Quote</Action>
            <Action href="/contact" secondary>
              Contact the Team
            </Action>
          </div>
          <p className="commercial-email-contact">
            Commercial enquiries?{" "}
            <a href={`mailto:${contact.emails.info}`}>
              <Glow>{contact.emails.info}</Glow>
            </a>
          </p>
        </div>
        <Picture photo={commercial.image} priority />
      </div>
      <Section
        title={copy("10.01", "Information heading")}
        description={copy("10.01", "Information")}
      >
        <div className="process-grid">
          {[1, 2, 3].map((n) => {
            const [title, body] = copy("10.01", `Step ${n}`).split(" â€” ");
            return (
              <Reveal key={n}>
                <span className="process-number">0{n}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </Reveal>
            );
          })}
        </div>
      </Section>
      <Section title={copy("10.01", "FAQ heading")}>
        <FAQ items={sections["10.01"].faq} />
      </Section>
      <section className="closing">
        <h2>{copy("10.01", "Closing")}</h2>
        <Action href="/commercial-laundry/quote">Request a Quote</Action>
      </section>
    </>
  );
}
export function QuotePage() {
  return (
    <div className="narrow">
      <Link className="back-link" href="/commercial-laundry">
        â† Commercial Laundry
      </Link>
      <Heading
        title={copy("10.02", "H1")}
        description={copy("10.02", "Intro")}
      />
      <div className="panel">
        <PublicForm kind="commercial" />
      </div>
    </div>
  );
}
export function GalleryPage() {
  return (
    <>
      <section className="page-hero">
        <DottedGlowBackground gap={14} radius={1.8} opacity={0.75} />
        <div className="page-hero__inner">
          <Heading title="Gallery" description={copy("11", "Intro")} />
        </div>
      </section>
      <div className="container">
        <Gallery />
        <Section>
          <div className="actions">
            <Action href="/services">Explore Services</Action>
            <Action href="/book" secondary>
              Book a Pickup
            </Action>
          </div>
        </Section>
      </div>
    </>
  );
}
export function FAQPage() {
  return (
    <>
      <section className="page-hero">
        <DottedGlowBackground gap={14} radius={1.8} opacity={0.75} />
        <div className="page-hero__inner narrow">
          <Heading title={copy("13", "H1")} description={copy("13", "Intro")} />
        </div>
      </section>
      <div className="container narrow">
        <FAQ items={faqs} />
        <Section title={copy("13", "Closing")}>
          <Action href="/contact">Contact the Team</Action>
        </Section>
      </div>
    </>
  );
}
export function BlogPage() {
  return (
    <>
      <section className="page-hero">
        <DottedGlowBackground gap={14} radius={1.8} opacity={0.75} />
        <div className="page-hero__inner">
          <Heading
            title={copy("12", "Index H1")}
            description={copy("12", "Intro")}
          />
        </div>
      </section>
      <div className="container">
        <PublishedBlog />
      </div>
    </>
  );
}
export function ArticlePage({ slug }: { slug: string }) {
  return <PublishedArticle slug={slug} />;
}
export function ReviewsPage({ form = false }: { form?: boolean }) {
  return (
    <>
      <section className="page-hero page-hero--video">
        <div className="page-hero__inner">
          <div className="logo-video">
            <LogoVideoHero />
          </div>
          <Heading
            title={form ? copy("15", "Form H1") : copy("15", "H1")}
            description={form ? undefined : copy("15", "Intro")}
          />
        </div>
      </section>
      <div className="container narrow">
        {form ? (
          <div className="panel">
            <PublicForm
              kind="review"
              reviewSubmissionsEnabled={isSupabaseConfigured && isElevatedConfigured}
            />
          </div>
        ) : (
          <>
            <PublishedReviews />
            <Action href="/reviews/share">Share Your Experience</Action>
          </>
        )}
      </div>
    </>
  );
}
export { PolicyPage } from "./policy-page";
