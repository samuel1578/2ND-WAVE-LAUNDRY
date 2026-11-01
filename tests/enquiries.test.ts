import test from "node:test";
import assert from "node:assert/strict";
import {
    isValidEnquiryIdempotencyKey,
    validateEnquirySubmission,
} from "../src/lib/enquiries/validation";
import { handleEnquirySubmission } from "../src/lib/enquiries/submission";
import { buildEnquiryReceivedParams } from "../src/lib/email/templates";

const GENERAL = {
    kind: "general",
    name: "Amina Mensah",
    phone: "+233595224280",
    email: "amina@example.test",
    topic: "Services",
    message: "Could you tell me more about wash and fold?",
    website: "",
};
const COMMERCIAL = {
    kind: "commercial",
    name: "Amina Mensah",
    business: "Sample Business",
    phone: "+233595224280",
    email: "amina@example.test",
    items: "Hotel linen, approximately 40 pieces per week",
    frequency: "Weekly",
    location: "Accra",
    requirements: "Collection before 9am",
    website: "",
};
const BASE = {
    body: GENERAL,
    idempotencyKey: "enquiry-submit-key-012345",
    origin: { ok: true } as const,
    identity: "a".repeat(32),
    correlationId: "correlation-test",
};

const allowed = { status: "allowed" as const, remaining: 4, limit: 5 };
const baseDeps = {
    configured: true,
    rateLimiter: { consume: async () => allowed },
    submit: async () => ({ ok: true as const, enquiryId: "opaque-id", isNew: true }),
};

test("validates and normalises general enquiries and commercial quotes", () => {
    const general = validateEnquirySubmission(GENERAL);
    assert.equal(general.ok, true);
    if (general.ok) {
        assert.equal(general.value.kind, "general");
        assert.equal(general.value.email, "amina@example.test");
        assert.equal(general.value.message, GENERAL.message);
        assert.deepEqual(general.value.details, {});
    }

    const commercial = validateEnquirySubmission(COMMERCIAL);
    assert.equal(commercial.ok, true);
    if (commercial.ok) {
        assert.equal(commercial.value.kind, "commercial");
        assert.equal(commercial.value.business, "Sample Business");
        assert.equal(commercial.value.details.items, COMMERCIAL.items);
        assert.equal(commercial.value.details.frequency, "Weekly");
    }
});

test("rejects invalid topics, missing required fields, overlong data and honeypot submissions", () => {
    const badTopic = validateEnquirySubmission({ ...GENERAL, topic: "Other" });
    assert.equal(badTopic.ok, false);
    if (!badTopic.ok) assert.equal(badTopic.fieldErrors.topic, "Choose an enquiry topic.");

    const missing = validateEnquirySubmission({ ...COMMERCIAL, business: "", items: "" });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
        assert.ok(missing.fieldErrors.business);
        assert.ok(missing.fieldErrors.items);
    }

    const tooLong = validateEnquirySubmission({ ...GENERAL, message: "x".repeat(4001) });
    assert.equal(tooLong.ok, false);
    if (!tooLong.ok) assert.ok(tooLong.fieldErrors.message);

    const spam = validateEnquirySubmission({ ...GENERAL, website: "filled by bot" });
    assert.equal(spam.ok, false);
    if (!spam.ok) assert.equal(spam.code, "spam_rejected");
});

test("idempotency keys have bounded length and preserve exact header value", () => {
    assert.equal(isValidEnquiryIdempotencyKey("enquiry-submit-key-012345"), true);
    assert.equal(isValidEnquiryIdempotencyKey(" too-short "), false);
    assert.equal(isValidEnquiryIdempotencyKey("x".repeat(129)), false);
    assert.equal(isValidEnquiryIdempotencyKey(" enquiry-submit-key-012345"), false);
});

test("submission checks origin/config/rate limit and returns a generic success without personal data", async () => {
    let calls = 0;
    const success = await handleEnquirySubmission(BASE, {
        ...baseDeps,
        submit: async () => {
            calls += 1;
            return { ok: true as const, enquiryId: "opaque-id", isNew: true };
        },
    });
    assert.equal(success.status, 202);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(success.body).includes("amina@example.test"), false);
    assert.equal(JSON.stringify(success.body).includes("Amina Mensah"), false);

    const wrongOrigin = await handleEnquirySubmission({ ...BASE, origin: { ok: false, reason: "cross-origin" } }, baseDeps);
    assert.equal(wrongOrigin.status, 403);

    const unavailable = await handleEnquirySubmission(BASE, { ...baseDeps, configured: false });
    assert.equal(unavailable.status, 503);

    const limited = await handleEnquirySubmission(BASE, {
        ...baseDeps,
        rateLimiter: { consume: async () => ({ status: "limited" as const, retryAfterSeconds: 120, limit: 5 }) },
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers["Retry-After"], "120");
});

test("submission rejects idempotency conflicts without disclosing submitted details", async () => {
    const conflict = await handleEnquirySubmission(BASE, {
        ...baseDeps,
        submit: async () => ({ ok: false as const, code: "idempotency_mismatch" as const }),
    });
    assert.equal(conflict.status, 409);
    assert.equal(JSON.stringify(conflict.body).includes("amina@example.test"), false);
});

test("internal enquiry email parameters escape user text and omit message/private notes", () => {
    const params = buildEnquiryReceivedParams({
        enquiryId: "123e4567-e89b-12d3-a456-426614174000",
        kind: "commercial",
        name: "Amina <script>alert(1)</script>",
        business: "B & C Laundry",
        phone: "+233 59 522 4280",
        topic: "Commercial",
    }, { siteUrl: "https://2ndwave.example" });
    assert.equal(params.name, "Amina &lt;script&gt;alert(1)&lt;/script&gt;");
    assert.equal(params.business, "B &amp; C Laundry");
    assert.equal(params.enquiryUrl, "https://2ndwave.example/admin/enquiries/123e4567-e89b-12d3-a456-426614174000");
    assert.deepEqual(Object.keys(params).sort(), ["business", "enquiryUrl", "kind", "name", "phone", "topic", "websiteUrl"].sort());
});
