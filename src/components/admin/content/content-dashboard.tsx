"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Heading } from "@/components/ui";
import {
  getBlogPosts,
  getFaqs,
  getGallery,
  getLocations,
  getPromotions,
  getServices,
  useDemoStore,
  visibleGalleryPlacements,
} from "@/lib/mock-store";
import { contentModules } from "./content-config";
import styles from "./content.module.css";
export function ContentDashboard({ state }: { state?: string }) {
  useDemoStore();
  const empty = state === "empty";
  const locations = empty ? [] : getLocations();
  const gallery = empty ? [] : getGallery();
  const visible = empty ? 0 : visibleGalleryPlacements().length;
  const articles = empty ? [] : getBlogPosts();
  const publishedArticles = articles.filter((c) => c.published).length;
  const services = empty ? [] : getServices();
  const publishedServices = services.filter((c) => c.published).length;
  const faqs = empty ? [] : getFaqs();
  const enabledFaqs = faqs.filter((f) => f.enabled).length;
  const promotions = empty ? [] : getPromotions();
  const activePromotions = promotions.filter(
    (p) => p.status === "active" || p.status === "scheduled",
  ).length;
  const counts: Record<string, string> = {
    services: `${services.length} ${services.length === 1 ? "service" : "services"} · ${publishedServices} published`,
    locations: `${locations.length} ${locations.length === 1 ? "branch" : "branches"}`,
    gallery: `${gallery.length} ${gallery.length === 1 ? "image" : "images"} · ${visible} shown`,
    blog: `${articles.length} ${articles.length === 1 ? "article" : "articles"} · ${publishedArticles} published`,
    faqs: `${faqs.length} ${faqs.length === 1 ? "FAQ" : "FAQs"} · ${enabledFaqs} enabled`,
    promotions: promotions.length
      ? `${promotions.length} ${promotions.length === 1 ? "promotion" : "promotions"} · ${activePromotions} active`
      : "No promotions yet",
  };
  return (
    <>
      <Heading
        title="Website Content"
        description="Managed records for the public website. Homepage, About and Policy Pages are managed in code."
      />
      <div className="grid two">
        {contentModules.map((m) => (
          <Link
            href={`/admin/content/${m.slug}`}
            className="module-card"
            key={m.slug}
          >
            <div>
              <h2>{m.name}</h2>
              <p className={styles.description}>{m.description}</p>
              <small className={styles.count}>{counts[m.slug]}</small>
              <span className="text-link">{m.action}</span>
            </div>
            <ArrowUpRight />
          </Link>
        ))}
      </div>
    </>
  );
}
