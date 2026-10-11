import { demoMode } from "./demo-mode";

/**
 * Availability of the business-data backend.
 *
 * Sprint 1B authenticates administrators for real but does not connect bookings,
 * reviews, enquiries, CMS, media or settings to Supabase. Every write still runs
 * against the in-memory demonstration repository, which fails closed when demo
 * mode is off (`src/lib/mock-store.ts`). This module is the single place that
 * describes that state so the interface can be honest about it instead of
 * scattering conditionals through the dashboard.
 *
 * When a real backend is connected, replace this with a capability derived from
 * configuration and the availability of that backend.
 */
export type DataBackendState = "demo" | "unconfigured";

export const dataBackendState: DataBackendState = demoMode
  ? "demo"
  : "unconfigured";

/** True when durable business-data operations are not available. */
export const businessDataUnavailable = dataBackendState === "unconfigured";

export const BUSINESS_DATA_NOTICE =
  "Preview build: business data is not connected here. Sample records are shown for layout review only, and nothing is stored — saved bookings, reviews and content are not written anywhere yet.";

/** Notice to show above administrative content, or `null` when connected. */
export function dataBackendNotice(
  state: DataBackendState = dataBackendState,
): string | null {
  return state === "unconfigured" ? BUSINESS_DATA_NOTICE : null;
}
