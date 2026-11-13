import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveRateLimitMode } from "../src/lib/security/rate-limit-mode";
import { configuredAuthOrigin } from "../src/lib/auth/redirect";
import { enquiryStatusLabel } from "../src/lib/enquiries/presentation";

/**
 * Pre-handover cleanup checks. Modules that import `server-only` (which only the
 * Next.js bundler resolves) are checked at the source-contract level, as in
 * tests/newsletter-admin.test.ts.
 */

const source = (path: string) => readFileSync(path, "utf8");

test("BOOKING_RATE_LIMIT_MODE=memory is ignored in production", () => {
  assert.equal(resolveRateLimitMode({ mode: "memory", nodeEnv: "production", demo: false }), "database");
  assert.equal(resolveRateLimitMode({ mode: "memory", nodeEnv: "development", demo: false }), "memory");
  assert.equal(resolveRateLimitMode({ mode: "database", nodeEnv: "development", demo: true }), "database");
  assert.equal(resolveRateLimitMode({ mode: undefined, nodeEnv: "production", demo: false }), "database");
  assert.equal(resolveRateLimitMode({ mode: "", nodeEnv: "production", demo: true }), "memory");
  const limiter = source("src/lib/security/booking-rate-limit.ts");
  assert.match(limiter, /resolveRateLimitMode\(\{/);
  assert.match(limiter, /nodeEnv: process\.env\.NODE_ENV/);
});

test("invite and password reset resolve the auth origin in the same order", () => {
  assert.equal(
    configuredAuthOrigin({ SITE_URL: "https://www.2ndwavelaundry.com", NEXT_PUBLIC_SITE_URL: "https://other.example" }),
    "https://www.2ndwavelaundry.com",
  );
  assert.equal(configuredAuthOrigin({ NEXT_PUBLIC_SITE_URL: "https://www.2ndwavelaundry.com" }), "https://www.2ndwavelaundry.com");
  assert.equal(configuredAuthOrigin({}), null);

  const staff = source("src/lib/admin/staff-actions.ts");
  const auth = source("src/lib/auth/actions.ts");
  assert.equal((staff.match(/resolveCallbackOrigin\(\s*configuredAuthOrigin\(\),?\s*\)/g) ?? []).length, 2);
  assert.match(auth, /siteUrl: configuredAuthOrigin\(\)/);
  assert.doesNotMatch(staff, /NEXT_PUBLIC_SITE_URL \?\? process\.env\.SITE_URL \?\? null,\s*\)/);
});

test("public reviews are read on the server with the secret-key client", () => {
  const reader = source("src/lib/reviews/public-reader.ts");
  assert.match(reader, /^import "server-only";/);
  assert.match(reader, /createSupabaseAdminClient\(\)/);
  assert.match(reader, /\.from\("published_reviews"\)/);
  assert.doesNotMatch(reader, /createSupabaseServerClient|createSupabaseBrowserClient/);

  const service = source("src/lib/reviews/public-service.ts");
  assert.doesNotMatch(service, /createSupabase(Server|Browser|Admin)Client/);

  const route = source("src/app/api/reviews/public/route.ts");
  assert.match(route, /loadPublishedReviews\(fetchPublishedReviewRows\)/);

  // No browser code reads reviews from Supabase directly.
  const published = source("src/components/published-content.tsx");
  assert.doesNotMatch(published, /published_reviews|review_submissions|createSupabase/);
});

test("publishing actions refresh the public review pages", () => {
  const actions = source("src/lib/reviews/actions.ts");
  assert.match(actions, /revalidatePublicPaths\(\["\/reviews", "\/reviews\/share"\]\)/);
  for (const fn of ["publishReviewAction", "reopenReviewAction", "publishReplyAction", "overrideReviewAction"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`));
    const end = body.indexOf("\nexport async function", 10);
    assert.match(end > 0 ? body.slice(0, end) : body, /revalidatePublicReviews\(\)/, fn);
  }
});

test("email configuration and the Brevo client are server-only entry points", () => {
  for (const path of ["src/lib/email/config.ts", "src/lib/email/brevo.ts"])
    assert.match(source(path), /^import "server-only";[\s\S]*export \* from "\.\/(config|brevo)-core";/, path);
});

test("the newsletter removal action resolves the actor from the session", () => {
  const action = source("src/lib/newsletter/admin-actions.ts");
  assert.match(action, /^"use server";/);
  assert.match(action, /await requireAdmin\(\)/);
  assert.match(action, /hasPermission\(actor\.role, "newsletter\.manage"\)/);
  assert.match(action, /consumeRateLimit\("newsletter_mutation", actor\.userId\)/);
  assert.match(action, /removeNewsletterInterest\(actor\.userId, input\.id\)/);
});

test("enquiry statuses display as words", () => {
  assert.equal(enquiryStatusLabel("new"), "New");
  assert.equal(enquiryStatusLabel("contacted"), "Contacted");
  assert.equal(enquiryStatusLabel("closed"), "Closed");
});
