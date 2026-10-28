import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasPermission, resolveAdminRouteAccess } from "../src/lib/auth/permissions";

/**
 * Phase 5 MVP endpoint contract tests.
 *
 * The route modules import the `server-only` trust boundary, which only the
 * Next.js bundler resolves, so the endpoints are verified at the source-
 * contract level: session gate before read, `newsletter.manage` permission
 * between gate and query, method gates, transport hardening and the generic
 * response path (the response body itself is covered by
 * tests/newsletter-interest-submission.test.ts). The permission registry is
 * exercised directly because it drives both the route and the admin UI.
 */

const FULL = "full_admin" as const;
const OPERATIONAL = "operational_admin" as const;

const ADMIN_ROUTE = "src/app/api/admin/newsletter/route.ts";
const PUBLIC_ROUTE = "src/app/api/newsletter-interest/route.ts";
const REPOSITORY = "src/lib/newsletter/repository.ts";
const SUBMISSION = "src/lib/newsletter/submission.ts";

test("newsletter.manage is a Full Admin capability and gates the admin route", () => {
    assert.equal(hasPermission(FULL, "newsletter.manage"), true);
    assert.equal(hasPermission(OPERATIONAL, "newsletter.manage"), false);
    assert.equal(resolveAdminRouteAccess(OPERATIONAL, "/admin/newsletter").kind, "forbidden");
    assert.equal(resolveAdminRouteAccess(FULL, "/admin/newsletter").kind, "allowed");
});

test("the admin route resolves the session first, then the permission, then the read", () => {
    const route = readFileSync(ADMIN_ROUTE, "utf8");
    const gate = route.indexOf("await getCurrentAdmin()");
    const permission = route.indexOf('hasPermission(admin.role, "newsletter.manage")');
    const read = route.indexOf("await listNewsletterInterest()");
    assert.ok(gate >= 0 && permission > gate && read > permission);

    // 401 unauthenticated, 403 permission denied, 503 read failure, 405 writes.
    assert.ok(route.includes('status: 401'));
    assert.ok(route.includes('"unauthenticated"'));
    assert.ok(route.includes('status: 403'));
    assert.ok(route.includes('"permission_denied"'));
    assert.ok(route.includes('status: 503'));
    assert.ok(route.includes('status: 405'));
    assert.ok(route.includes("Allow: \"GET\""));
    assert.ok(route.includes('"private, no-store, max-age=0"'));

    // Read-only endpoint: no mutation method and no trusted submit call.
    for (const forbidden of [
        ".insert(",
        ".update(",
        ".delete(",
        ".upsert(",
        ".rpc(",
        "newsletter_interest_submit",
    ])
        assert.equal(route.includes(forbidden), false, forbidden);
});

test("the repository never exposes a write path for the interest list", () => {
    const repository = readFileSync(REPOSITORY, "utf8");
    assert.ok(repository.includes('.from("newsletter_interest")'));
    assert.ok(repository.includes('.order("created_at", { ascending: false })'));
    assert.ok(repository.includes(".limit(500)"));
    for (const forbidden of [
        '.from("newsletter_interest").insert(',
        '.from("newsletter_interest").update(',
        '.from("newsletter_interest").delete(',
        '.from("newsletter_interest").upsert(',
        "id, email, consent_version, source, created_at, source_ip_hash",
    ])
        assert.equal(repository.includes(forbidden), false, forbidden);
});

test("the public endpoint rejects non-JSON, oversized and unreadable bodies before any work", () => {
    const route = readFileSync(PUBLIC_ROUTE, "utf8");
    // Transport hardening happens before configuration, origin or limiter.
    const contentType = route.indexOf('contentType !== "application/json"');
    const origin = route.indexOf("checkRequestOrigin({");
    const handler = route.indexOf("handleNewsletterInterestSubmission(");
    assert.ok(contentType >= 0 && origin > contentType && handler > origin);
    assert.ok(route.includes("declaredLength > MAX_BODY_BYTES"));
    assert.ok(route.includes('"malformed_json"'));
    assert.ok(route.includes('"payload_too_large"'));
    assert.ok(route.includes('"unsupported_media_type"'));
    assert.ok(route.includes('"Cache-Control": "no-store"'));
});

test("the public endpoint hashes the caller and stays a generic adapter", () => {
    const route = readFileSync(PUBLIC_ROUTE, "utf8");
    // Hashed identity: no raw client address is ever passed downstream.
    assert.ok(route.includes('createHash("sha256")'));
    assert.ok(route.includes('digest("hex").slice(0, 32)'));
    // Server-side orchestration, never browser input.
    assert.ok(route.includes("readNewsletterInterestConfig()"));
    assert.ok(route.includes("resolveNewsletterRateLimiter()"));
    assert.ok(route.includes("request.headers.get(IDEMPOTENCY_HEADER) || null"));
    assert.ok(route.includes('after(() => dispatchPendingEmails("newsletter_interest_submit"))'));
    // The rejection log records the code and correlation, never the address.
    assert.ok(route.includes("console.warn"));
    for (const forbidden of ["JSON.stringify(body)", "body.email", "submitted.email", "subscriberEmail"])
        assert.equal(route.includes(forbidden), false, forbidden);
    // Every public answer flows through the handler that pins the generic body.
    assert.ok(route.includes("handleNewsletterInterestSubmission"));
    const submission = readFileSync(SUBMISSION, "utf8");
    assert.ok(submission.includes('"Thank you. Your interest has been recorded."'));
    assert.ok(submission.includes("status: 202"));
    // The success body itself never reveals the record or the duplicate state.
    const successBody = submission.slice(submission.indexOf("status: 202"));
    assert.equal(successBody.includes("interestId"), false);
    assert.equal(successBody.includes("isNew"), false);
});
