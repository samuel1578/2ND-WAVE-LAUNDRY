import { demoMode } from "./demo-mode";
import { supabaseConfig } from "./supabase/config";

/**
 * Availability of the business-data backend.
 *
 * Sprint 1B authenticated administrators for real but did not connect business
 * data; Sprint 2C connects the administrator **bookings** experience to Supabase
 * (reads under RLS, writes through the trusted lifecycle functions). Reviews,
 * enquiries, the CMS, media and settings remain sample data.
 *
 * This module is the single place that describes that mixed state so the
 * interface stays honest instead of scattering conditionals through the console.
 *
 * - `demo`: the isolated in-memory workspace (no verified session);
 * - `live`: a verified session on a Supabase-configured deployment, where
 *   bookings are persisted and every other module is still sample data;
 * - `unconfigured`: no Supabase project, so no business data is reachable.
 */
export type DataBackendState = "demo" | "live" | "unconfigured";

/** True when the administrator booking store is connected to Supabase. */
export const bookingsBackendConnected = !demoMode && supabaseConfig.ok;

export const dataBackendState: DataBackendState = demoMode
  ? "demo"
  : bookingsBackendConnected
    ? "live"
    : "unconfigured";

/** True when durable business-data operations are not available. */
export const businessDataUnavailable = dataBackendState !== "live";

export const BUSINESS_DATA_NOTICE =
  "Preview build: business data is not connected here. Sample records are shown for layout review only, and nothing is stored — saved bookings, reviews and content are not written anywhere yet.";

/** Shown when bookings, reviews and newsletter interest are live but the remaining modules are sample data. */
export const PARTIAL_DATA_NOTICE =
  "Bookings, reviews and newsletter interest are stored in the live database. Enquiries, website content, media and settings are still sample data and are not saved.";

/** Notice to show above administrative content, or `null` when fully connected. */
export function dataBackendNotice(
  state: DataBackendState = dataBackendState,
): string | null {
  if (state === "demo") return null;
  return state === "live" ? PARTIAL_DATA_NOTICE : BUSINESS_DATA_NOTICE;
}
