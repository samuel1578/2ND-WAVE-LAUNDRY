"use client";

import { createContext, useContext, type ReactNode } from "react";
import { resolveSiteSettings, type SiteSettings } from "@/lib/contact-links";

const SiteSettingsContext = createContext<SiteSettings | null>(null);

/**
 * Shares the server-resolved contact details with client components (shell,
 * booking form, hero). The root layout passes the value from `getSiteSettings()`.
 */
export function SiteSettingsProvider({
  settings,
  children,
}: {
  settings: SiteSettings;
  children: ReactNode;
}) {
  return (
    <SiteSettingsContext.Provider value={settings}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

/** Falls back to the built-in defaults if a component renders outside the provider. */
export function useSiteSettings(): SiteSettings {
  return useContext(SiteSettingsContext) ?? resolveSiteSettings(null);
}
