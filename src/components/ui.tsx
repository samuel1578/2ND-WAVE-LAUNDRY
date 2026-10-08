import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  MapPin,
  Phone,
  Store,
  Truck,
  Info,
} from "lucide-react";
import { type ReactNode } from "react";
import { Reveal } from "./motion";
import { BrandText } from "./brand-text";
import { FaqAccordion } from "./faq-accordion";
import {
  branches,
  bookingHref,
  contact,
  copy,
  serviceHref,
  type Photo,
  type services,
} from "@/lib/content";
export function Action({
  href,
  children,
  secondary = false,
  className = "",
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
  className?: string;
}) {
  return (
    <Link
      className={`button ${secondary ? "secondary" : ""} ${className}`}
      href={href}
    >
      {children}
      <ArrowUpRight size={18} aria-hidden="true" />
    </Link>
  );
}
export function Picture({
  photo,
  className = "",
  priority = false,
  position,
  sizes,
}: {
  photo?: Photo;
  className?: string;
  priority?: boolean;
  position?: string;
  sizes?: string;
}) {
  if (!photo) return null;
  return (
    <div className={`picture ${className}`}>
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        sizes={
          sizes ?? "(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 600px"
        }
        priority={priority}
        unoptimized={photo.src.startsWith("blob:")}
        style={position ? { objectPosition: position } : undefined}
      />
    </div>
  );
}
export function Heading({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <Reveal className="page-heading">
      <div>
        {eyebrow && (
          <p className="eyebrow">
            <BrandText text={eyebrow} />
          </p>
        )}
        <h1>
          <BrandText text={title} />
        </h1>
        {description && (
          <p className="lead">
            <BrandText text={description} />
          </p>
        )}
      </div>
      {children}
    </Reveal>
  );
}
export function ServiceHero({
  service,
  primary,
  secondary,
}: {
  service: (typeof services)[number];
  primary: { href: string; label: string };
  secondary: { href: string; label: string };
}) {
  return (
    <div className="service-hero">
      <div className="service-hero__frame">
        <Picture
          photo={service.image}
          className="service-hero__picture"
          position={service.focal}
          priority
          sizes="(max-width: 900px) 100vw, 1200px"
        />
        <div className="service-hero__panel">
          <Heading title={service.title} description={service.summary} />
          <div className="actions">
            <Action href={primary.href}>{primary.label}</Action>
            <Action href={secondary.href} secondary>
              {secondary.label}
            </Action>
          </div>
        </div>
      </div>
    </div>
  );
}
export function Section({
  title,
  description,
  children,
  id,
  className = "",
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section className={`section ${className}`} id={id}>
      {title && (
        <Reveal className="section-heading">
          <h2>
            <BrandText text={title} />
          </h2>
          {description && (
            <p>
              <BrandText text={description} />
            </p>
          )}
        </Reveal>
      )}
      {children}
    </section>
  );
}
export function ServiceCard({
  service,
  index = 0,
}: {
  service: (typeof services)[number];
  index?: number;
}) {
  return (
    <Reveal delay={(index % 3) * 0.06}>
      <Link href={serviceHref(service.slug)} className="service-card">
        <Picture photo={service.image} />
        <div className="card-body">
          <h3>{service.title}</h3>
          <p>{service.summary}</p>
          <span className="text-link">
            View Service <ArrowUpRight size={19} />
          </span>
        </div>
      </Link>
    </Reveal>
  );
}
export function BranchCards() {
  return (
    <div className="grid three">
      {branches.map((b, i) => (
        <Reveal key={b.slug} delay={i * 0.06}>
          <article className="branch-card">
            <MapPin size={25} />
            {b.label && <span className="badge">{b.label}</span>}
            <h3>{b.title}</h3>
            {b.hours.map(([day, hours]) => (
              <div className="split" key={day}>
                <span>{day}</span>
                <strong>{hours}</strong>
              </div>
            ))}
            <a className="text-link" href={b.tel}>
              <Phone size={17} />
              {b.phone}
            </a>
            <Link
              className="text-link branch-card__view"
              href={`/locations/${b.slug}`}
            >
              View Branch <ArrowRight size={18} />
            </Link>
            {b.map && (
              <a
                className="button secondary"
                href={b.map}
                target="_blank"
                rel="noreferrer"
              >
                View in Maps <ArrowUpRight size={18} />
              </a>
            )}
          </article>
        </Reveal>
      ))}
    </div>
  );
}
export function FAQ({
  items,
}: {
  items: { q: string; a: string; glow?: string }[];
}) {
  return <FaqAccordion items={items} />;
}
export function Breadcrumb({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumb">
      <ol>
        {items.map((item, i) => (
          <li key={item.label}>
            {item.href ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
            {i < items.length - 1 && (
              <span className="breadcrumb-sep" aria-hidden="true">
                /
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
export function HandoverChoice({ slug, cta }: { slug: string; cta: string }) {
  return (
    <>
      <div className="grid two choice-grid handover-grid">
        <Reveal x={-48}>
          <article className="choice-card handover-card">
            <span className="icon-chip">
              <Store size={20} aria-hidden="true" />
            </span>
            <h3>{copy("04.00", "Branch heading")}</h3>
            <p>{copy("04.00", "Branch text")}</p>
            <Action href="/locations" secondary>
              {copy("04.00", "Branch CTA")}
            </Action>
          </article>
        </Reveal>
        <Reveal x={48} delay={0.06}>
          <article className="choice-card handover-card accent">
            <span className="icon-chip">
              <Truck size={20} aria-hidden="true" />
            </span>
            <h3>{copy("04.00", "Pickup heading")}</h3>
            <p>{copy("04.00", "Pickup text")}</p>
            <Action href={bookingHref(slug)}>{cta}</Action>
          </article>
        </Reveal>
      </div>
      <div className="handover-note">
        <Info size={18} aria-hidden="true" />
        <div className="handover-note__body">
          <p>{copy("04.00", "Handover note")}</p>
          <p>
            Our customer service team will contact you on{" "}
            <a href={contact.whatsapp}>WhatsApp</a> or by{" "}
            <a href={contact.tel}>mobile</a> to confirm your arrangements.
          </p>
        </div>
      </div>
    </>
  );
}
export function PickupChoice() {
  return (
    <div className="grid two choice-grid">
      <Reveal x={-48}>
        <article className="choice-card">
          <span className="eyebrow">01 / Collection</span>
          <h3>{copy("04.00", "Pickup heading")}</h3>
          <p>{copy("04.00", "Pickup text")}</p>
          <Action href={bookingHref()}>Book a Pickup</Action>
        </article>
      </Reveal>
      <Reveal x={48} delay={0.06}>
        <article className="choice-card tint">
          <span className="eyebrow">02 / Walk-ins</span>
          <h3>{copy("04.00", "Branch heading")}</h3>
          <p>{copy("04.00", "Branch text")}</p>
          <Action href="/locations" secondary>
            View Locations
          </Action>
        </article>
      </Reveal>
    </div>
  );
}
export function Closing() {
  return (
    <Reveal>
      <section className="closing">
        <p className="eyebrow">
          <BrandText text="2nd Wave Laundry Services" />
        </p>
        <h2>{copy("02", "Closing heading")}</h2>
        <div className="actions">
          <Action href="/book">Book a Pickup</Action>
          <Action href="/locations" secondary>
            Visit a Branch
          </Action>
        </div>
      </section>
    </Reveal>
  );
}
export function Empty({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        ↗
      </span>
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {children}
    </div>
  );
}
export function Skeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading…" className="grid two">
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
