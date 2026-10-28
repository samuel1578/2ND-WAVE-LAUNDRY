import test from "node:test";
import assert from "node:assert/strict";
import {
    isValidNewsletterIdempotencyKey,
    validateNewsletterSubmission,
} from "../src/lib/newsletter/validation";
import {
    handleNewsletterInterestSubmission,
    type NewsletterSubmissionDeps,
    type NewsletterSubmissionInput,
} from "../src/lib/newsletter/submission";
import {
    newsletterConsentVersion,
    newsletterManagerEmail,
    readNewsletterInterestConfig,
} from "../src/lib/newsletter/config";
import { newsletterErrorMessage, newsletterErrorStatus } from "../src/lib/newsletter/errors";
import {
    buildNewsletterInterestParams,
    isNewsletterInterestTemplate,
    newsletterInterestTemplates,
    validateEmailTemplateParams,
    type NewsletterInterestContext,
} from "../src/lib/email/templates";

const valid = { email: "Ama@Example.test", consent: true };
const key = "newsletter-idempotency-0123456789";
const allow = { consume: async () => ({ status: "allowed" as const, remaining: 4, limit: 5 }) };

function dependencies(overrides: Partial<NewsletterSubmissionDeps> = {}) {
    const calls: Parameters<NewsletterSubmissionDeps["submit"]>[0][] = [];
    const deps: NewsletterSubmissionDeps = {
        configured: true,
        consentVersion: newsletterConsentVersion,
        managerEmail: newsletterManagerEmail,
        rateLimiter: allow,
        submit: async (input) => {
            calls.push(input);
            return { ok: true, interestId: "0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d", isNew: true };
        },
        ...overrides,
    };
    return { deps, calls };
}

function request(overrides: Partial<NewsletterSubmissionInput> = {}): NewsletterSubmissionInput {
    return {
        body: valid,
        idempotencyKey: key,
        origin: { ok: true } as const,
        identity: "a".repeat(32),
        correlationId: "3e604d1c-6685-4ab5-8675-98d46716ea01",
        ...overrides,
    };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

test("a valid sign-up normalises the address to one canonical lower-case form", () => {
    const result = validateNewsletterSubmission(valid);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, { email: "ama@example.test", consent: true });
});

test("invalid address, missing consent and honeypot are rejected with field errors", () => {
    const badEmail = validateNewsletterSubmission({ ...valid, email: "not-an-email" });
    assert.equal(badEmail.ok, false);
    if (!badEmail.ok) {
        assert.equal(badEmail.code, "invalid_email");
        assert.ok(badEmail.fieldErrors.email);
    }

    const noConsent = validateNewsletterSubmission({ ...valid, consent: false });
    assert.equal(noConsent.ok, false);
    if (!noConsent.ok) assert.equal(noConsent.code, "consent_required");

    const spam = validateNewsletterSubmission({ ...valid, website: "bot filled this" });
    assert.equal(spam.ok, false);
    if (!spam.ok) assert.equal(spam.code, "spam_rejected");

    const empty = validateNewsletterSubmission("not a record");
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.code, "invalid_payload");

    const oversized = validateNewsletterSubmission({ ...valid, email: `${"a".repeat(250)}@example.test` });
    assert.equal(oversized.ok, false);
});

test("idempotency keys are bounded and cannot contain surrounding whitespace", () => {
    assert.equal(isValidNewsletterIdempotencyKey(key), true);
    assert.equal(isValidNewsletterIdempotencyKey(null), false);
    assert.equal(isValidNewsletterIdempotencyKey("short"), false);
    assert.equal(isValidNewsletterIdempotencyKey(` ${key}`), false);
    assert.equal(isValidNewsletterIdempotencyKey("x".repeat(129)), false);
});

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

test("the feature flag fails closed and only accepts explicit affirmative values", () => {
    for (const disabled of [undefined, "", "false", "0", "no", "TRUE-ish", "1x", "on"])
        assert.equal(readNewsletterInterestConfig({ NEWSLETTER_INTEREST_ENABLED: disabled }).enabled, false, String(disabled));
    for (const enabled of ["true", "1", "yes", " TRUE ", "Yes"])
        assert.equal(readNewsletterInterestConfig({ NEWSLETTER_INTEREST_ENABLED: enabled }).enabled, true, enabled);
});

test("manager recipient and consent wording are server constants", () => {
    const config = readNewsletterInterestConfig({});
    assert.equal(config.managerEmail, "manager@2ndwavelaundry.com");
    assert.equal(config.consentVersion, "2026-10-27");
    assert.equal(config.consentVersion, newsletterConsentVersion);
    // An attacker-controlled environment value can never redirect the alert.
    assert.equal(
        readNewsletterInterestConfig({ NEWSLETTER_MANAGER_EMAIL: "attacker@example.test" }).managerEmail,
        newsletterManagerEmail,
    );
});

/* -------------------------------------------------------------------------- */
/* Handler ordering and responses                                             */
/* -------------------------------------------------------------------------- */

test("origin, missing configuration and limiter failures never reach the repository", async () => {
    const counting = () => {
        const state = { rateCalls: 0 };
        return {
            state,
            limiter: {
                consume: async () => {
                    state.rateCalls += 1;
                    return { status: "allowed" as const, remaining: 1, limit: 5 };
                },
            },
        };
    };

    // [overrides, input, expected status, expected code, expected limiter calls]
    const cases: Array<[Partial<NewsletterSubmissionDeps>, NewsletterSubmissionInput, number, string, number]> = [
        [{}, request({ origin: { ok: false, reason: "cross-origin" } }), 403, "origin_rejected", 0],
        [{ configured: false }, request(), 503, "not_configured", 0],
        [{ rateLimiter: null }, request(), 503, "not_configured", 0],
        [{ rateLimiter: { consume: async () => { throw new Error("db down"); } } }, request(), 503, "rate_limit_unavailable", 0],
        [{ rateLimiter: { consume: async () => ({ status: "unavailable" as const }) } }, request(), 503, "rate_limit_unavailable", 0],
    ];
    for (const [overrides, input, status, code, expectedRateCalls] of cases) {
        const { state, limiter } = counting();
        const { deps, calls } = dependencies({
            ...overrides,
            rateLimiter: Object.prototype.hasOwnProperty.call(overrides, "rateLimiter")
                ? overrides.rateLimiter
                : limiter,
        });
        const response = await handleNewsletterInterestSubmission(input, deps);
        assert.equal(response.status, status, code);
        assert.equal(response.body.code, code);
        assert.equal(calls.length, 0, code);
        if (Object.prototype.hasOwnProperty.call(overrides, "rateLimiter"))
            assert.equal(0, expectedRateCalls, code);
        else assert.equal(state.rateCalls, expectedRateCalls, code);
        assert.equal(response.headers["Cache-Control"], "no-store");
    }
});

test("rate limiting answers 429 with Retry-After before any validation", async () => {
    const { deps, calls } = dependencies({
        rateLimiter: { consume: async () => ({ status: "limited", retryAfterSeconds: 90, limit: 5 }) },
    });
    const response = await handleNewsletterInterestSubmission(
        request({ idempotencyKey: null, body: { email: "bad", consent: false } }),
        deps,
    );
    assert.equal(response.status, 429);
    assert.equal(response.body.code, "rate_limited");
    assert.equal(response.body.retryAfterSeconds, 90);
    assert.equal(response.headers["Retry-After"], "90");
    assert.equal(calls.length, 0);
});

test("missing idempotency key and request validation fail before persistence", async () => {
    const noKey = dependencies();
    const keyless = await handleNewsletterInterestSubmission(request({ idempotencyKey: "short" }), noKey.deps);
    assert.equal(keyless.status, 422);
    assert.equal(keyless.body.code, "idempotency_required");
    assert.equal(noKey.calls.length, 0);

    const invalid = dependencies();
    const consent = await handleNewsletterInterestSubmission(
        request({ body: { ...valid, consent: false } }),
        invalid.deps,
    );
    assert.equal(consent.status, 422);
    assert.equal(consent.body.code, "consent_required");
    assert.ok((consent.body.fieldErrors as Record<string, string>).consent);
    assert.equal(invalid.calls.length, 0);

    const spammy = dependencies();
    const spam = await handleNewsletterInterestSubmission(
        request({ body: { ...valid, website: "filled" } }),
        spammy.deps,
    );
    assert.equal(spam.status, 422);
    assert.equal(spam.body.code, "spam_rejected");
    assert.equal(spammy.calls.length, 0);
});

test("the repository receives the server-controlled consent version and manager address", async () => {
    const { deps, calls } = dependencies();
    const response = await handleNewsletterInterestSubmission(request(), deps);
    assert.equal(response.status, 202);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].submission.email, "ama@example.test");
    assert.equal(calls[0].consentVersion, newsletterConsentVersion);
    assert.equal(calls[0].managerEmail, newsletterManagerEmail);
    assert.equal(calls[0].sourceIpHash, "a".repeat(32));
    assert.equal(calls[0].idempotencyKey, key);
    assert.equal(calls[0].correlationId, "3e604d1c-6685-4ab5-8675-98d46716ea01");
});

test("repository failures map to their documented status without leaking detail", async () => {
    const failures: Array<[Awaited<ReturnType<NewsletterSubmissionDeps["submit"]>>, number]> = [
        [{ ok: false, code: "invalid_email" }, 422],
        [{ ok: false, code: "not_configured" }, 503],
        [{ ok: false, code: "storage_unavailable" }, 503],
        [{ ok: false, code: "conflict" }, 400],
    ];
    for (const [result, status] of failures) {
        const { deps } = dependencies({ submit: async () => result });
        const response = await handleNewsletterInterestSubmission(request(), deps);
        assert.equal(response.status, status);
        assert.equal(response.body.ok, false);
        assert.equal(JSON.stringify(response.body).includes("postgres"), false);
        assert.equal(JSON.stringify(response.body).includes("supabase"), false);
    }

    const throwing = dependencies({ submit: async () => { throw new Error("connection refused"); } });
    const response = await handleNewsletterInterestSubmission(request(), throwing.deps);
    assert.equal(response.status, 503);
    assert.equal(response.body.code, "storage_unavailable");
});

test("success answers one identical generic body for first-time and duplicate sign-ups", async () => {
    const first = dependencies({ submit: async () => ({ ok: true, interestId: "id-1", isNew: true }) });
    const firstResponse = await handleNewsletterInterestSubmission(request(), first.deps);

    const duplicate = dependencies({ submit: async () => ({ ok: true, interestId: "id-1", isNew: false }) });
    const duplicateResponse = await handleNewsletterInterestSubmission(request(), duplicate.deps);

    assert.equal(firstResponse.status, 202);
    assert.equal(duplicateResponse.status, 202);
    assert.deepEqual(firstResponse.body, duplicateResponse.body);
    assert.deepEqual(firstResponse.body, {
        ok: true,
        message: "Thank you. Your interest has been recorded.",
        correlationId: "3e604d1c-6685-4ab5-8675-98d46716ea01",
    });
    // The response must never reveal whether an address was already known.
    const serialised = JSON.stringify(firstResponse.body);
    for (const forbidden of ["interestId", "isNew", "subscriber", "manager@", "ama@example.test"])
        assert.equal(serialised.includes(forbidden), false, forbidden);
    assert.equal(firstResponse.headers["Cache-Control"], "no-store");
});

test("error messages and statuses stay aligned for every public code", () => {
    for (const code of ["invalid_payload", "invalid_email", "consent_required", "spam_rejected", "origin_rejected", "not_configured", "rate_limited", "idempotency_required"] as const) {
        const status = newsletterErrorStatus(code);
        assert.ok(status >= 400 && status <= 503, code);
        assert.ok(newsletterErrorMessage(code).length > 0, code);
    }
    assert.equal(newsletterErrorStatus("storage_unavailable"), 503);
    assert.equal(newsletterErrorStatus("rate_limited"), 429);
    assert.equal(newsletterErrorStatus("origin_rejected"), 403);
});

/* -------------------------------------------------------------------------- */
/* Manager alert parameter contract                                           */
/* -------------------------------------------------------------------------- */

const NEWSLETTER_CONTEXT: NewsletterInterestContext = {
    subscriberEmail: "ama@example.test",
    submittedAt: "2026-10-27T09:30:00Z",
    source: "public_newsletter_form",
};

test("the manager alert renders exactly the committed parameter contract", () => {
    const params = buildNewsletterInterestParams(NEWSLETTER_CONTEXT, { siteUrl: "https://2ndwave.example/" });
    assert.deepEqual(Object.keys(params).sort(), [
        "contactUrl",
        "headerImageAlt",
        "headerImageUrl",
        "privacyUrl",
        "source",
        "submittedAt",
        "subscriberEmail",
        "websiteUrl",
    ]);
    assert.equal(params.subscriberEmail, "ama@example.test");
    assert.equal(params.source, "2nd Wave Laundry website");
    assert.equal(params.websiteUrl, "https://2ndwave.example");
    assert.equal(params.contactUrl, "https://2ndwave.example/contact");
    assert.equal(params.privacyUrl, "https://2ndwave.example/privacy");
    assert.equal(params.headerImageUrl, "https://2ndwave.example/headers/newsletter.png");
    validateEmailTemplateParams("newsletter_interest_received", params);
});

test("an unparseable enqueue timestamp or unknown source never reaches the provider", () => {
    assert.throws(() =>
        buildNewsletterInterestParams({ ...NEWSLETTER_CONTEXT, submittedAt: "not a time" }, { siteUrl: "https://2ndwave.example" }),
    );
    const unknownSource = buildNewsletterInterestParams(
        { ...NEWSLETTER_CONTEXT, source: "unexpected_source" },
        { siteUrl: "https://2ndwave.example" },
    );
    assert.equal(unknownSource.source, "unexpected_source");
    assert.throws(() =>
        validateEmailTemplateParams("newsletter_interest_received", { subscriberEmail: "x@y.test" }),
    );
});

test("the alert template is a recognised internal template and nothing else claims its name", () => {
    assert.deepEqual(newsletterInterestTemplates, ["newsletter_interest_received"]);
    assert.equal(isNewsletterInterestTemplate("newsletter_interest_received"), true);
    assert.equal(isNewsletterInterestTemplate("booking_created"), false);
});
