import test from "node:test";
import assert from "node:assert/strict";
import {
    countReviewLinks,
    isValidReviewIdempotencyKey,
    validateReviewSubmission,
} from "../src/lib/reviews/validation";
import { handleReviewSubmission, type ReviewSubmissionDeps, type ReviewSubmissionInput } from "../src/lib/reviews/submission";
import { readReviewSubmissionConfig } from "../src/lib/reviews/config";
import { reviewConsentVersion } from "../src/lib/reviews/config";

const valid = {
    name: "Ama Mensah",
    body: "The service was careful and fast.",
    rating: "5",
    branch: "Ashaiman – Atadeka",
    consent: true,
    website: "",
};
const key = "review-idempotency-0123456789";
const allow = { consume: async () => ({ status: "allowed" as const, remaining: 4, limit: 5 }) };

function dependencies(overrides: Partial<ReviewSubmissionDeps> = {}) {
    const calls: unknown[] = [];
    const deps: ReviewSubmissionDeps = {
        configured: true,
        consentVersion: reviewConsentVersion,
        rateLimiter: allow,
        submit: async (input) => {
            calls.push(input);
            return { ok: true, reviewId: "7a9e1f6b-3f2c-4f7d-a41d-7c56e20fe001", replayed: false };
        },
        ...overrides,
    };
    return { deps, calls };
}

function request(overrides: Record<string, unknown> = {}): ReviewSubmissionInput {
    return {
        body: { ...valid, ...overrides },
        idempotencyKey: key,
        origin: { ok: true } as const,
        identity: "a".repeat(32),
        correlationId: "3e604d1c-6685-4ab5-8675-98d46716ea01",
    };
}

test("valid review normalizes optional rating and branch into the persistence contract", () => {
    const result = validateReviewSubmission(valid);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, {
        customerName: "Ama Mensah",
        bodyOriginal: "The service was careful and fast.",
        rating: 5,
        branch: "Ashaiman – Atadeka",
        consent: true,
    });
});

test("rating is optional, but invalid values and excessive lengths fail validation", () => {
    assert.equal(validateReviewSubmission({ ...valid, rating: "" }).ok, true);
    assert.equal(validateReviewSubmission({ ...valid, rating: 6 }).ok, false);
    assert.equal(validateReviewSubmission({ ...valid, name: "x".repeat(121) }).ok, false);
    assert.equal(validateReviewSubmission({ ...valid, body: "x".repeat(4001) }).ok, false);
});

test("consent is mandatory and honeypot or excessive links are rejected", () => {
    assert.equal(validateReviewSubmission({ ...valid, consent: false }).ok, false);
    assert.equal(validateReviewSubmission({ ...valid, website: "bot filled this" }).ok, false);
    const spam = validateReviewSubmission({ ...valid, body: "a https://a.test https://b.test www.c.test" });
    assert.equal(spam.ok, false);
    if (!spam.ok) assert.equal(spam.code, "spam_rejected");
    assert.equal(countReviewLinks("https://one.test and www.two.test"), 2);
});

test("idempotency keys are bounded and cannot contain surrounding whitespace", () => {
    assert.equal(isValidReviewIdempotencyKey(key), true);
    assert.equal(isValidReviewIdempotencyKey("short"), false);
    assert.equal(isValidReviewIdempotencyKey(` ${key}`), false);
    assert.equal(isValidReviewIdempotencyKey("x".repeat(129)), false);
});

test("review consent version is server-controlled", () => {
    assert.equal(readReviewSubmissionConfig({}).noticeVersion, reviewConsentVersion);
    assert.equal(readReviewSubmissionConfig({}).ready, true);
});

test("origin and missing configuration fail before limiter or database", async () => {
    const cases: Array<[Partial<ReviewSubmissionDeps>, ReturnType<typeof request>, number, string]> = [
        [{}, { ...request(), origin: { ok: false, reason: "cross-origin" } }, 403, "origin_rejected"],
        [{ configured: false }, request(), 503, "not_configured"],
    ];
    for (const [overrides, input, status, code] of cases) {
        let rateCalls = 0;
        const { deps, calls } = dependencies({
            ...overrides,
            rateLimiter: { consume: async () => { rateCalls++; return { status: "allowed", remaining: 1, limit: 5 }; } },
        });
        const response = await handleReviewSubmission(input, deps);
        assert.equal(response.status, status);
        assert.equal(response.body.code, code);
        assert.equal(calls.length, 0);
        assert.equal(rateCalls, 0);
        assert.equal(response.headers["Cache-Control"], "no-store");
    }
});

test("request validation and failed rate limiting do not reach the repository", async () => {
    const invalidDeps = dependencies();
    const invalid = await handleReviewSubmission(request({ consent: false }), invalidDeps.deps);
    assert.equal(invalid.status, 422);
    assert.equal(invalid.body.code, "consent_required");
    assert.equal(invalidDeps.calls.length, 0);

    const deniedDeps = dependencies({
        rateLimiter: { consume: async () => ({ status: "limited", retryAfterSeconds: 90, limit: 5 }) },
    });
    const denied = await handleReviewSubmission(request(), deniedDeps.deps);
    assert.equal(denied.status, 429);
    assert.equal(denied.headers["Retry-After"], "90");
    assert.equal(deniedDeps.calls.length, 0);

    const brokenLimiterDeps = dependencies({
        rateLimiter: { consume: async () => { throw new Error("database unavailable"); } },
    });
    const limiterFailure = await handleReviewSubmission(request(), brokenLimiterDeps.deps);
    assert.equal(limiterFailure.status, 503);
    assert.equal(limiterFailure.body.code, "rate_limit_unavailable");

    const brokenRepositoryDeps = dependencies({
        submit: async () => { throw new Error("database unavailable"); },
    });
    const storageFailure = await handleReviewSubmission(request(), brokenRepositoryDeps.deps);
    assert.equal(storageFailure.status, 503);
    assert.equal(storageFailure.body.code, "storage_unavailable");
});

test("submission passes only normalized data and returns pending receipt without customer PII", async () => {
    let stored: unknown;
    const { deps } = dependencies({
        submit: async (input) => {
            stored = input;
            return { ok: true, reviewId: "7a9e1f6b-3f2c-4f7d-a41d-7c56e20fe001", replayed: false };
        },
    });
    const response = await handleReviewSubmission(request(), deps);
    assert.equal(response.status, 201);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.message, "Thank you. Your review has been received and is pending review.");
    assert.deepEqual(Object.keys(response.body).sort(), ["correlationId", "message", "ok", "replayed", "reviewId"].sort());
    assert.deepEqual(stored, {
        submission: {
            customerName: "Ama Mensah",
            bodyOriginal: "The service was careful and fast.",
            rating: 5,
            branch: "Ashaiman – Atadeka",
            consent: true,
        },
        idempotencyKey: key,
        sourceIpHash: "a".repeat(32),
        consentVersion: reviewConsentVersion,
        correlationId: "3e604d1c-6685-4ab5-8675-98d46716ea01",
    });
});

test("same successful idempotency replay returns HTTP 200", async () => {
    const { deps } = dependencies({
        submit: async () => ({ ok: true, reviewId: "7a9e1f6b-3f2c-4f7d-a41d-7c56e20fe001", replayed: true }),
    });
    const response = await handleReviewSubmission(request(), deps);
    assert.equal(response.status, 200);
    assert.equal(response.body.replayed, true);
});
