"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { copy, demoMode } from "@/lib/content";
import { buildPromotionView, type PromotionServiceOption } from "@/lib/website/promotion-view";
import { useDemoStore } from "@/lib/mock-store";
import { isPublicPromotionActive, promoActive } from "@/lib/rules";
import {
  demoPublicReviews,
  projectPublicReviewPayloads,
  type PublicReview,
} from "@/lib/reviews/public";
import { Action, Empty, Picture, Section, Skeleton } from "./ui";
import { BrandText } from "./brand-text";
import { PublicForm } from "./forms/public-form";
import { Dialog } from "./dialog";
import type { PromotionRecord, PublishedPromotionRecord } from "@/lib/contracts";
import type {
  PublicBlogPost,
  PublicBlogSummary,
} from "@/lib/website/public-queries";
import { BrandedText } from "@/lib/brand-highlight";
/** Blog index. Posts are supplied by the server loader (no body field). */
export function PublishedBlog({ posts = [] }: { posts?: PublicBlogSummary[] }) {
  const store = useDemoStore();
  const demoPosts: PublicBlogSummary[] = store.content
    .filter((c) => c.module === "Blog" && c.published)
    .map((c) => ({
      id: c.id,
      slug: c.published!.slug,
      title: c.published!.title,
      summary: c.published!.summary,
      image: c.published!.image,
      alt: c.published!.alt,
      order: c.sort,
      version: c.version,
    }));
  const list = demoMode ? demoPosts : posts;
  return list.length ? (
    <div className="grid three">
      {list.map((p) => (
        <Link href={`/blog/${p.slug}`} className="service-card" key={p.id}>
          <Picture photo={p.image ? { src: p.image, alt: p.alt } : undefined} />
          <div className="card-body">
            <h2>{p.title}</h2>
            <p>{p.summary}</p>
            <span className="text-link">Read Article ↗</span>
          </div>
        </Link>
      ))}
    </div>
  ) : (
    <Empty title={copy("12", "Empty heading")} body={copy("12", "Empty body")}>
      <div className="actions">
        <Action href="/services">Explore Services</Action>
        <Action href="/contact" secondary>
          Contact the Team
        </Action>
      </div>
    </Empty>
  );
}
/** Article page. The server loader supplies the single post, body included. */
export function PublishedArticle({
  slug,
  post: loadedPost,
}: {
  slug: string;
  post?: PublicBlogPost;
}) {
  const store = useDemoStore();
  const demoPost = demoMode
    ? store.content.find((c) => c.module === "Blog" && c.published?.slug === slug)?.published
    : undefined;
  const post =
    loadedPost ??
    (demoPost
      ? {
          title: demoPost.title,
          summary: demoPost.summary,
          image: demoPost.image,
          alt: demoPost.alt,
          body: demoPost.body,
        }
      : undefined);
  if (!post)
    return (
      <Empty
        title="We couldn’t find that page"
        body="The article is unpublished or unavailable."
      >
        <Action href="/blog">All Articles</Action>
      </Empty>
    );
  return (
    <article className="narrow article">
      <Link href="/blog" className="back-link">
        ← All Articles
      </Link>
      <h1>
        <BrandText text={post.title} />
      </h1>
      <p className="lead">
        <BrandText text={post.summary} />
      </p>
      <Picture
        photo={post.image ? { src: post.image, alt: post.alt } : undefined}
      />
      {post.body.split("\n\n").map((p, i) => (
        <p key={i}>
          <BrandText text={p} />
        </p>
      ))}
      <Action href="/services" secondary>
        Explore Services
      </Action>
    </article>
  );
}
function ReviewCards({ reviews }: { reviews: PublicReview[] }) {
  return reviews.length ? (
    <div className="review-cards">
      {reviews.map((r) => (
        <blockquote key={r.id}>
          {/* Plain text only: React escapes customer and administrative text.
              Never render review content through dangerouslySetInnerHTML. */}
          <p>{r.body}</p>
          {r.reply && (
            <div>
              <small className="muted">
                Response from 2nd Wave Laundry Services
              </small>
              <p>{r.reply}</p>
            </div>
          )}
          <footer>
            {r.name}
            {r.rating ? ` · ${r.rating}/5` : ""}
            {r.branch ? ` · ${r.branch}` : ""}
          </footer>
        </blockquote>
      ))}
    </div>
  ) : (
    <Empty title={copy("15", "Empty")} />
  );
}

/** Demo workspace: the isolated in-memory reviews, using the same rendering. */
function DemoPublishedReviews() {
  const store = useDemoStore();
  return <ReviewCards reviews={demoPublicReviews(store.leads)} />;
}

/**
 * Live public reviews. The endpoint already applies the published/consented
 * predicate under RLS; the response is projected again here so the client can
 * never render a field the whitelist does not allow.
 */
function LivePublishedReviews() {
  const [reviews, setReviews] = useState<PublicReview[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/reviews/public", {
          cache: "no-store",
        });
        const data = response.ok
          ? ((await response.json()) as { reviews?: unknown })
          : {};
        if (!cancelled)
          setReviews(projectPublicReviewPayloads(data.reviews ?? []));
      } catch {
        // Fail closed to the honest empty state; no sample reviews appear.
        if (!cancelled) setReviews([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (reviews === null) return <Skeleton count={2} />;
  return <ReviewCards reviews={reviews} />;
}

export function PublishedReviews() {
  return demoMode ? <DemoPublishedReviews /> : <LivePublishedReviews />;
}
export function Newsletter({
  interestEnabled = false,
  adminEnabled = false,
}: {
  interestEnabled?: boolean;
  adminEnabled?: boolean;
}) {
  const store = useDemoStore();
  // Demo workspace keeps the settings toggle; live sign-ups require both the
  // persisted admin visibility toggle and the server-read feature flag.
  const visible = demoMode
    ? store.settings.newsletter
    : interestEnabled && adminEnabled;
  if (!visible) return null;
  return (
    <Section
      className="newsletter"
      title={copy("16", "Heading")}
      description={copy("16", "Body")}
    >
      <PublicForm
        kind="newsletter"
        newsletterInterestEnabled={demoMode || interestEnabled}
      />
    </Section>
  );
}
export function Promotion({
  force = false,
  promotions,
  previewPromotion,
  services = [],
}: {
  force?: boolean;
  promotions?: PublishedPromotionRecord[];
  previewPromotion?: PromotionRecord;
  services?: PromotionServiceOption[];
}) {
  const store = useDemoStore();
  const [open, setOpen] = useState(false);
  const approved = demoMode ? store.content.find(
    (c) =>
      c.module === "Promotions" &&
      c.published &&
      c.extra.enabled === "yes" &&
      c.extra.yearConfirmed === "yes" &&
      promoActive(true, c.extra.start, c.extra.end),
  ) : promotions?.find((promotion) => isPublicPromotionActive(promotion));
  const livePromotion = approved && "internalTitle" in approved ? approved : undefined;
  const selected = previewPromotion ?? livePromotion;
  if (!force && !selected) return null;
  const view = buildPromotionView(selected, services, demoMode && !selected);
  const imageUrl = selected?.imageUrl ?? "";
  const imageAlt = selected?.imageAlt ?? "";
  return (
    <section className={`promotion${imageUrl ? " promotion-with-image" : ""}`}>
      {imageUrl && (
        <Image
          className="promotion-image"
          src={imageUrl}
          alt={imageAlt || ""}
          width={800}
          height={600}
          sizes="(max-width: 900px) 100vw, 800px"
          quality={82}
          loading="lazy"
        />
      )}
      <div className="promotion-content">
        {view.eyebrow && <span className="eyebrow">{view.eyebrow}</span>}
        <h2>{view.heading}</h2>
        <p style={{ whiteSpace: "pre-line" }}>{view.body}</p>
        {view.terms.trim() && (
          <p className="promotion-terms">
            <span className="brand-glow"><BrandedText text={view.terms} /></span>
          </p>
        )}
        <div className="actions">
          {view.cta && <Action href={view.cta.href}>{view.cta.label}</Action>}
          {view.showDetails && (
            <button className="button secondary" onClick={() => setOpen(true)}>
              View Offer Details
            </button>
          )}
        </div>
        {force && demoMode && (
          <small>
            Preview only. Offer activation requires client confirmation.
          </small>
        )}
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={view.heading}
      >
        <p style={{ whiteSpace: "pre-line" }}>{view.body}</p>
        {view.endDate && <p>Valid until {view.endDate}</p>}
        {view.legacyDemoFallback ? (
          <>
            <h3>{copy("14", "Terms heading")}</h3>
            <p style={{ whiteSpace: "pre-line" }}>{view.exclusions}</p>
            <p>{copy("14", "Supporting line")}</p>
          </>
        ) : (
          <>
            {view.terms.trim() && (
              <section>
                <h3>Terms</h3>
                <p style={{ whiteSpace: "pre-line" }}>{view.terms}</p>
              </section>
            )}
            {view.exclusions.trim() && (
              <section>
                <h3>Offer exclusions</h3>
                <p style={{ whiteSpace: "pre-line" }}>{view.exclusions}</p>
              </section>
            )}
          </>
        )}
        {view.cta && <Action href={view.cta.href}>{view.cta.label}</Action>}
        <button className="text-link" onClick={() => setOpen(false)}>
          Not Now
        </button>
      </Dialog>
    </section>
  );
}
function activePromotions(promotions?: PublishedPromotionRecord[], now = new Date()) {
  return (promotions ?? [])
    .filter((promotion) => isPublicPromotionActive(promotion, now))
    .sort((a, b) => a.priority - b.priority);
}
export function PromotionPopup({
  promotions,
  services = [],
}: {
  promotions?: PublishedPromotionRecord[];
  services?: PromotionServiceOption[];
}) {
  const active = activePromotions(promotions);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (active.length === 0 || window.sessionStorage.getItem("2ndwave-promotion-seen") === "1") return;
    window.sessionStorage.setItem("2ndwave-promotion-seen", "1");
    setOpen(true);
  }, [active.length]);
  if (active.length === 0) return null;
  return (
    <Dialog className="promotion-popup-dialog" open={open} onClose={() => setOpen(false)} title="Current offers">
      <div className="promotion-popup">
        <Promotion force previewPromotion={active[0]} services={services} />
        <button type="button" className="button secondary" onClick={() => setOpen(false)}>
          Continue to the website
        </button>
      </div>
    </Dialog>
  );
}
export function PromotionCarousel({
  promotions,
  services = [],
}: {
  promotions?: PublishedPromotionRecord[];
  services?: PromotionServiceOption[];
}) {
  const active = activePromotions(promotions);
  const [index, setIndex] = useState(0);
  if (active.length === 0) return null;
  const promotion = active[index % active.length];
  return (
    <Section title="Current offers" description="Browse all active offers before you book.">
      <div className="promotion-carousel">
        <Promotion force previewPromotion={promotion} services={services} />
        {active.length > 1 && (
          <div className="actions">
            <button type="button" className="button secondary" onClick={() => setIndex((value) => (value - 1 + active.length) % active.length)}>
              Previous offer
            </button>
            <button type="button" className="button secondary" onClick={() => setIndex((value) => (value + 1) % active.length)}>
              Next offer
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}
