"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { copy, demoMode, bookingHref } from "@/lib/content";
import { useDemoStore } from "@/lib/mock-store";
import { promoActive } from "@/lib/rules";
import {
  demoPublicReviews,
  projectPublicReviewPayloads,
  type PublicReview,
} from "@/lib/reviews/public";
import { Action, Empty, Picture, Section, Skeleton } from "./ui";
import { BrandText } from "./brand-text";
import { PublicForm } from "./forms/public-form";
import { Dialog } from "./dialog";
import type { ContentItem, PromotionRecord } from "@/lib/contracts";
import { BrandedText } from "@/lib/brand-highlight";
export function PublishedBlog({ posts: snapshotPosts }: { posts?: ContentItem[] } = {}) {
  const store = useDemoStore();
  const [livePosts, setLivePosts] = useState<ContentItem[] | null>(null);
  useEffect(() => {
    if (demoMode) return;
    fetch("/api/website?module=blog", { cache: "no-store" })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("Blog unavailable")))
      .then(body => setLivePosts(body.items ?? []))
      .catch(() => setLivePosts([]));
  }, []);
  const posts = demoMode
    ? store.content.filter((c) => c.module === "Blog" && c.published)
    : snapshotPosts ?? livePosts ?? [];
  return posts.length ? (
    <div className="grid three">
      {posts.map((p) => (
        <Link
          href={`/blog/${p.published!.slug}`}
          className="service-card"
          key={p.id}
        >
          <Picture
            photo={
              p.published!.image
                ? { src: p.published!.image, alt: p.published!.alt }
                : undefined
            }
          />
          <div className="card-body">
            <h2>{p.published!.title}</h2>
            <p>{p.published!.summary}</p>
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
export function PublishedArticle({ slug }: { slug: string }) {
  const store = useDemoStore();
  const [livePost, setLivePost] = useState<ContentItem | null>(null);
  useEffect(() => {
    if (demoMode) return;
    fetch("/api/website?module=blog", { cache: "no-store" })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("Article unavailable")))
      .then(body => setLivePost((body.items ?? []).find((item: ContentItem) => item.slug === slug) ?? null))
      .catch(() => setLivePost(null));
  }, [slug]);
  const post = demoMode
    ? store.content.find((c) => c.module === "Blog" && c.published?.slug === slug)?.published
    : livePost?.published;
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
export function Newsletter({ interestEnabled = false }: { interestEnabled?: boolean }) {
  const store = useDemoStore();
  // Demo workspace keeps the settings toggle; the live site is gated by the
  // server-read NEWSLETTER_INTEREST_ENABLED flag, never a NEXT_PUBLIC_* value.
  const visible = demoMode ? store.settings.newsletter : interestEnabled;
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
export function Promotion({ force = false, promotions, previewPromotion }: { force?: boolean; promotions?: PromotionRecord[]; previewPromotion?: PromotionRecord }) {
  const store = useDemoStore();
  const [open, setOpen] = useState(false);
  const approved = demoMode ? store.content.find(
    (c) =>
      c.module === "Promotions" &&
      c.published &&
      c.extra.enabled === "yes" &&
      c.extra.yearConfirmed === "yes" &&
      promoActive(true, c.extra.start, c.extra.end),
  ) : promotions?.find(p => p.enabled && p.yearConfirmed && p.status === "active");
  const livePromotion = approved && "internalTitle" in approved ? approved : undefined;
  const selected = previewPromotion ?? livePromotion;
  if (!force && !selected) return null;
  const imageUrl = selected?.imageUrl ?? "";
  const imageAlt = selected?.imageAlt ?? "";
  const heading = previewPromotion?.heading || copy("14", "Heading");
  const body = previewPromotion?.body || copy("14", "Body");
  const terms = previewPromotion?.terms || copy("14", "Terms");
  const customCta = selected?.ctaLabel?.trim() && selected?.ctaHref?.trim();
  return (
    <section className={`promotion${imageUrl ? " promotion-with-image" : ""}`}>
      {imageUrl && (
        <img
          className="promotion-image"
          src={imageUrl}
          alt={imageAlt || ""}
          width={800}
          height={600}
          loading="lazy"
        />
      )}
      <div className="promotion-content">
        <span className="eyebrow">Wash, Ironing & Fold</span>
        <h2>{heading}</h2>
        <p>{body}</p>
        <p className="promotion-terms"><span className="brand-glow"><BrandedText text={terms} /></span></p>
        <div className="actions">
          {selected && customCta && (
            <Action href={selected.ctaHref}>{selected.ctaLabel}</Action>
          )}
          {!customCta && !previewPromotion && (
            <Action href={bookingHref("wash-ironing-fold")}>Book Wash, Ironing & Fold</Action>
          )}
          <button className="button secondary" onClick={() => setOpen(true)}>
            View Offer Details
          </button>
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
        title={copy("14", "Heading")}
      >
        <p>{copy("14", "Body")}</p>
        <h3>{copy("14", "Terms heading")}</h3>
        <p>{copy("14", "Terms")}</p>
        <p>{copy("14", "Supporting line")}</p>
        <Action href={bookingHref("wash-ironing-fold")}>
          Book Wash, Ironing & Fold
        </Action>
        <button className="text-link" onClick={() => setOpen(false)}>
          Not Now
        </button>
      </Dialog>
    </section>
  );
}
function activePromotions(promotions?: PromotionRecord[]) {
  return (promotions ?? [])
    .filter((promotion) => promotion.enabled && promotion.yearConfirmed && promotion.status === "active")
    .sort((a, b) => a.priority - b.priority);
}
export function PromotionPopup({ promotions }: { promotions?: PromotionRecord[] }) {
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
        <Promotion force previewPromotion={active[0]} />
        <button type="button" className="button secondary" onClick={() => setOpen(false)}>
          Continue to the website
        </button>
      </div>
    </Dialog>
  );
}
export function PromotionCarousel({ promotions }: { promotions?: PromotionRecord[] }) {
  const active = activePromotions(promotions);
  const [index, setIndex] = useState(0);
  if (active.length === 0) return null;
  const promotion = active[index % active.length];
  return (
    <Section title="Current offers" description="Browse all active offers before you book.">
      <div className="promotion-carousel">
        <Promotion force previewPromotion={promotion} />
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
