/**
 * Server-only loader for the active booking catalogue.
 *
 * The public booking form's selected services must be resolved against the
 * database's `public.services` table (active and bookable only), never against a
 * client-supplied list or the presentation content layer. Anonymous callers have
 * no grant on `public.services`, so this read uses the server-only elevated
 * client and is confined to the trusted submission path.
 *
 * Never import this module from a Client Component.
 */

import {
  createSupabaseAdminClient,
  SupabaseElevatedConfigError,
} from "@/lib/supabase/admin";
import type { CatalogueService, ServiceKind } from "./types";

const CATALOGUE_COLUMNS = "slug, title, kind, bookable, active";

const isServiceKind = (value: unknown): value is ServiceKind =>
  value === "laundry" ||
  value === "modifier" ||
  value === "information" ||
  value === "commercial";

/**
 * Returns the active catalogue, or `null` when it cannot be read.
 *
 * A missing or invalid elevated credential, a transport failure or an unexpected
 * payload all fail closed (`null`), so the submission route refuses to accept a
 * booking rather than validating against an unverified catalogue.
 */
export async function loadBookingCatalogue(): Promise<CatalogueService[] | null> {
  if (typeof window !== "undefined")
    throw new Error("The booking catalogue loader is server-only.");

  let client;
  try {
    client = createSupabaseAdminClient();
  } catch (error) {
    if (error instanceof SupabaseElevatedConfigError) return null;
    return null;
  }

  const { data, error } = await client
    .from("services")
    .select(CATALOGUE_COLUMNS)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error || !Array.isArray(data)) return null;

  const services: CatalogueService[] = [];
  for (const row of data as Array<Record<string, unknown>>) {
    if (
      typeof row.slug !== "string" ||
      typeof row.title !== "string" ||
      typeof row.bookable !== "boolean" ||
      !isServiceKind(row.kind)
    )
      return null;
    services.push({
      slug: row.slug,
      title: row.title,
      kind: row.kind,
      bookable: row.bookable,
      active: true,
    });
  }

  return services.length ? services : null;
}
