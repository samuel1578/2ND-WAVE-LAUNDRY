import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPublishedReviews } from "../src/lib/reviews/public-service";
import { SupabaseConfigError } from "../src/lib/supabase/config";

const PUBLISHED_ID = "11111111-1111-1111-1111-111111111111";
const DRAFT_REPLY_ID = "22222222-2222-2222-2222-222222222222";
const PENDING_ID = "33333333-3333-3333-3333-333333333333";
const REJECTED_ID = "44444444-4444-4444-4444-444444444444";
const UNCONSENTED_ID = "55555555-5555-5555-5555-555555555555";

/**
 * Hostile row set: the public reader must drop unapproved reviews and project
 * only the whitelist even when a query returns private columns.
 */
const HOSTILE_ROWS = [
    {
        id: PUBLISHED_ID,
        customer_name: "Ama Mensah",
        rating: 5,
        branch: "Ashaiman",
        body_published: "Published customer text.",
        published_at: "2026-10-20T10:00:00.000Z",
        published_version: 1,
        reply_body: "Published response.",
        reply_published_at: "2026-10-21T10:00:00.000Z",
        reply_status: "published",
        moderation_status: "approved",
        consent: true,
        body_original: "Original private submission.",
        source_ip_hash: "a".repeat(32),
        moderation_note: "Internal moderation note",
        consent_version: "review-copy-v1",
        idempotency_key: "idempotency-key-0123456789",
        submission_hash: "b".repeat(32),
    },
    {
        id: DRAFT_REPLY_ID,
        customer_name: "Kofi Boateng",
        rating: 4,
        branch: "Tema",
        body_published: "Another published review.",
        published_at: "2026-10-19T10:00:00.000Z",
        published_version: 1,
        reply_body: "Draft reply must stay private.",
        reply_published_at: null,
        reply_status: "draft",
        moderation_status: "approved",
        consent: true,
    },
    {
        id: PENDING_ID,
        customer_name: "Pending person",
        body_published: "Pending review text must not leak.",
        moderation_status: "pending",
        consent: true,
    },
    {
        id: REJECTED_ID,
        customer_name: "Rejected person",
        body_published: "Rejected review text must not leak.",
        moderation_status: "rejected",
        consent: true,
    },
    {
        id: UNCONSENTED_ID,
        customer_name: "Unconsented person",
        body_published: "Unconsented review text must not leak.",
        moderation_status: "approved",
        consent: false,
    },
    {
        // A row that only has the original text (for example a mistaken select).
        id: "66666666-6666-6666-6666-666666666666",
        customer_name: "Original-only person",
        body_original: "Original-only text must not leak.",
        moderation_status: "approved",
        consent: true,
    },
];

test("the public payload excludes unapproved reviews, private columns and reply drafts", async () => {
    const result = await loadPublishedReviews(async () => ({
        data: HOSTILE_ROWS,
        error: null,
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(
        result.reviews.map((review) => review.id),
        [PUBLISHED_ID, DRAFT_REPLY_ID],
    );
    const draftReplyReview = result.reviews.find(
        (review) => review.id === DRAFT_REPLY_ID,
    );
    assert.equal(draftReplyReview?.reply, null);
    assert.equal(draftReplyReview?.replyPublishedAt, null);

    for (const review of result.reviews)
        assert.deepEqual(Object.keys(review).sort(), [
            "body",
            "branch",
            "id",
            "name",
            "publishedAt",
            "publishedVersion",
            "rating",
            "reply",
            "replyPublishedAt",
        ]);

    const serialised = JSON.stringify(result.reviews);
    for (const forbidden of [
        "Original private submission.",
        "Pending review text must not leak.",
        "Rejected review text must not leak.",
        "Unconsented review text must not leak.",
        "Original-only text must not leak.",
        "Draft reply must stay private.",
        "Internal moderation note",
        "idempotency-key-0123456789",
        "review-copy-v1",
        "source_ip_hash",
        "body_original",
        "moderation_note",
        "submission_hash",
        "aaaa",
        "bbbb",
    ])
        assert.equal(serialised.includes(forbidden), false, forbidden);
});

test("a failing or unconfigured public read fails closed to no reviews", async () => {
    const failure = await loadPublishedReviews(async () => ({
        data: HOSTILE_ROWS,
        error: { message: "permission denied for table review_submissions" },
    }));
    assert.deepEqual(failure, { ok: false, code: "storage_unavailable" });

    const unconfigured = await loadPublishedReviews(async () => {
        throw new SupabaseConfigError("missing");
    });
    assert.deepEqual(unconfigured, { ok: false, code: "not_configured" });

    const malformed = await loadPublishedReviews(async () => ({
        data: { not: "an array" },
        error: null,
    }));
    assert.deepEqual(malformed, { ok: true, reviews: [] });

    const network = await loadPublishedReviews(async () => {
        throw new Error("network unreachable");
    });
    assert.deepEqual(network, { ok: false, code: "storage_unavailable" });
});

test("the public endpoint only returns the published review list", () => {
    const route = readFileSync(
        "src/app/api/reviews/public/route.ts",
        "utf8",
    );
    assert.ok(route.includes("reviews: result.reviews"));
    assert.ok(route.includes("Cache-Control"));
    for (const privateField of [
        "body_original",
        "source_ip_hash",
        "moderation_note",
        "submission_hash",
        "idempotency_key",
    ])
        assert.equal(route.includes(privateField), false, privateField);
    // Public failures never echo a database/provider message.
    assert.equal(route.includes("error.message"), false);
});
