"use client";
import { Empty } from "@/components/ui";
import { resolveContentRoute } from "./content/content-config";
import { ContentDashboard } from "./content/content-dashboard";
import { LocationsManager } from "./content/locations-manager";
import { GalleryManager } from "./content/gallery-manager";
import { BlogManager } from "./content/blog-manager";
import { ServicesManager } from "./content/services-manager";
import { FaqManager } from "./content/faq-manager";
import { PromotionsManager } from "./content/promotions-manager";
import {
  CodeManagedNotice,
  ReviewsMovedNotice,
} from "./content/shared/module-shell";
export function ContentAdmin({
  segments,
  state,
}: {
  segments: string[];
  state?: string;
}) {
  const route = resolveContentRoute(segments);
  switch (route.kind) {
    case "dashboard":
      return <ContentDashboard state={state} />;
    case "code-managed":
      return <CodeManagedNotice name={route.name} />;
    case "reviews-moved":
      return <ReviewsMovedNotice />;
    case "module":
      switch (route.module.slug) {
        case "services":
          return <ServicesManager id={route.id} state={state} />;
        case "locations":
          return <LocationsManager id={route.id} state={state} />;
        case "gallery":
          return <GalleryManager state={state} />;
        case "blog":
          return <BlogManager id={route.id} state={state} />;
        case "faqs":
          return <FaqManager state={state} />;
        case "promotions":
          return <PromotionsManager id={route.id} state={state} />;
        default:
          return <Empty title="Record not found" />;
      }
    default:
      return <Empty title="Record not found" />;
  }
}
