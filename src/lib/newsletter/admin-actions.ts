"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { AdminAuthorisationError } from "@/lib/auth/roles";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { removeNewsletterInterest } from "./repository";

/**
 * Newsletter interest administration.
 *
 * Same control chain as the other admin write actions:
 *   1. verified session + `admin_profiles` role (`requireAdmin`);
 *   2. `newsletter.manage` (Full Admin only);
 *   3. origin verification for this cookie-authenticated write;
 *   4. per-actor rate limit;
 *   5. the database function re-checks the active Full Admin.
 *
 * The actor id always comes from the session, never from the browser.
 */

export type NewsletterRemovalCode =
  | "permission_denied"
  | "invalid_request"
  | "not_found"
  | "rate_limited"
  | "not_configured"
  | "unavailable";

export type NewsletterRemovalActionResult =
  | { ok: true; message: string }
  | { ok: false; code: NewsletterRemovalCode; message: string };

const MESSAGES: Record<NewsletterRemovalCode, string> = {
  permission_denied: "Your administrator role does not allow this action.",
  invalid_request: "That request was not valid. Reload the page and try again.",
  not_found: "This subscriber is no longer on the list. Reload the page.",
  rate_limited: "Too many changes. Wait a few minutes and try again.",
  not_configured: "Newsletter management is not configured on this deployment.",
  unavailable: "The subscriber could not be removed. Try again.",
};

const failure = (code: NewsletterRemovalCode): NewsletterRemovalActionResult => ({
  ok: false,
  code,
  message: MESSAGES[code],
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Permanently removes a subscriber who withdrew consent. */
export async function removeNewsletterInterestAction(input: {
  id: string;
}): Promise<NewsletterRemovalActionResult> {
  let actor;
  try {
    actor = await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAuthorisationError)
      return failure(error.code === "not_configured" ? "not_configured" : "permission_denied");
    return failure("permission_denied");
  }
  if (!hasPermission(actor.role, "newsletter.manage")) return failure("permission_denied");

  const requestHeaders = await headers();
  const origin = checkRequestOrigin({
    origin: requestHeaders.get("origin"),
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });
  if (!origin.ok) return failure("permission_denied");

  if (!consumeRateLimit("newsletter_mutation", actor.userId).ok) return failure("rate_limited");
  if (typeof input?.id !== "string" || !UUID.test(input.id)) return failure("invalid_request");

  const result = await removeNewsletterInterest(actor.userId, input.id);
  if (!result.ok)
    return failure(result.reason === "forbidden" ? "permission_denied" : result.reason);

  revalidatePath("/admin/newsletter");
  return { ok: true, message: "Subscriber removed." };
}
