import "server-only";

import { resolveSiteSettings, type SiteSettings } from "@/lib/contact-links";
import { demoMode } from "@/lib/demo-mode";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getPublicSettings } from "./public";

/**
 * The public site's contact details.
 *
 * A thin, never-throwing wrapper over the single cached settings loader
 * (`getPublicSettings`, tag `site-settings`) — it does not add a second cache.
 * Demo mode and unconfigured Supabase render the built-in `contact` defaults.
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  if (demoMode || !isSupabaseConfigured) return resolveSiteSettings(null);
  try {
    return resolveSiteSettings(await getPublicSettings());
  } catch (error) {
    console.error(
      "Public site settings unavailable; using built-in contact defaults.",
      error instanceof Error ? error.message : "unknown error",
    );
    return resolveSiteSettings(null);
  }
}
