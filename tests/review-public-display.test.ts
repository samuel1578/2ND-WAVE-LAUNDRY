import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    PUBLIC_REVIEW_COLUMNS,
    PUBLIC_REVIEW_LIMIT,
    demoPublicReviews,
    mapPublicReviewRow,
    projectPublicReviews,
} from "../src/lib/reviews/public";
import {
    mapReviewDatabaseError,
    reviewOperationPermission,
    validateReplyInput,
} from "../src/lib/reviews/moderation";
import { reviewErrorMessage, reviewErrorStatus } from "../src/lib/reviews/errors";
import { hasPermission } from "../src/lib/auth/permissions";
import type { Lead } from "../src/lib/contracts";

const APPROVED_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";

function publishedRow(overrides: Record<string, unknown> = {}) {
    return {
        id: APPROVED_ID,
        customer_name: "Ama Mensah",
        rating: 5,
        branch: "Ashaiman",
        body_published: "Public customer text.",
        published_at: "2026-10-20T10:00:00.000Z",
        published_version: 2,
        reply_body: "Published response.",
        reply_published_at: "2026-10-21T10:00:00.000Z",
        ...overrides,
    };
}

test("the public projection contains only whitelisted published fields", () => {
    const review = mapPublicReviewRow(
        publishedRow({
            // Private columns that must never be projected even if selected.
            body_original: "Original private text.",
            source_ip_hash: "a".repeat(32),
            moderation_note: "Internal moderation note",
            consent_version: "review-copy-v1",
            idempotency_key: "idempotency-key-0123456789",
            submission_hash: "b".repeat(32),
        }),
    );
    assert.ok(review);
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
    assert.equal(review.body, "Public customer text.");
    assert.equal(review.reply, "Published response.");
    assert.equal(review.rating, 5);
    assert.equal(review.publishedVersion, 2);

    for (const privateField of [
        "body_original",
        "source_ip_hash",
        "moderation_note",
        "consent_version",
        "idempotency_key",
        "submission_hash",
    ])
        assert.equal(
            PUBLIC_REVIEW_COLUMNS.includes(privateField),
            false,
            privateField,
        );
});

test("pending, rejected, unconsented and bodyless rows are never public", () => {
    assert.equal(
        mapPublicReviewRow(publishedRow({ moderation_status: "pending" })),
        null,
    );
    assert.equal(
        mapPublicReviewRow(
            publishedRow({
                moderation_status: "rejected",
                body_published: "Leaked rejected text",
            }),
        ),
        null,
    );
    assert.equal(
        mapPublicReviewRow(publishedRow({ consent: false })),
        null,
    );
    assert.equal(
        mapPublicReviewRow(publishedRow({ body_published: "   " })),
        null,
    );
    assert.equal(mapPublicReviewRow(publishedRow({ id: "not-a-uuid" })), null);
    assert.equal(mapPublicReviewRow(null), null);
});

test("a reply draft is withheld while the approved publication stays public", () => {
    const review = mapPublicReviewRow(
        publishedRow({
            reply_status: "draft",
            reply_body: "Draft reply must stay private.",
            reply_published_at: null,
        }),
    );
    assert.ok(review);
    assert.equal(review.body, "Public customer text.");
    assert.equal(review.reply, null);
    assert.equal(review.replyPublishedAt, null);

    const publishedReply = mapPublicReviewRow(
        publishedRow({ reply_status: "published" }),
    );
    assert.equal(publishedReply?.reply, "Published response.");
});

test("demo reviews use the approved + consented predicate and plain text", () => {
    const lead = (
        id: string,
        status: Lead["status"],
        consent: string,
        body: string,
    ): Lead => ({
        id,
        kind: "review",
        fields: { name: "Ama", review: body, consent, rating: "4", branch: "Tema" },
        status,
        createdAt: "2026-10-20T10:00:00.000Z",
        notes: [],
    });
    const leads: Lead[] = [
        lead(APPROVED_ID, "approved", "yes", "Approved demo text."),
        lead(OTHER_ID, "new", "yes", "Pending demo text."),
        lead("33333333-3333-3333-3333-333333333333", "rejected", "yes", "Rejected demo text."),
        lead("44444444-4444-4444-4444-444444444444", "approved", "no", "No permission text."),
    ];
    const reviews = demoPublicReviews(leads);
    assert.deepEqual(reviews.map((review) => review.body), ["Approved demo text."]);
    assert.equal(reviews[0].reply, null);
    assert.equal(reviews[0].rating, 4);
    assert.equal(reviews[0].branch, "Tema");
});

test("the public list is bounded and tolerates malformed input", () => {
    assert.deepEqual(projectPublicReviews(null), []);
    assert.deepEqual(projectPublicReviews("rows"), []);
    const many = Array.from({ length: PUBLIC_REVIEW_LIMIT + 10 }, (_, index) =>
        publishedRow({
            id: `${String(index + 1).padStart(8, "0")}-1111-1111-1111-111111111111`,
        }),
    );
    assert.equal(projectPublicReviews(many).length, PUBLIC_REVIEW_LIMIT);
});

test("customer and reply text is rendered as React text, never as HTML", () => {
    const source = readFileSync("src/components/published-content.tsx", "utf8");
    // The comment above the render explicitly forbids the HTML path; match the
    // JSX attribute so the prose itself does not fail the check.
    assert.equal(source.includes("dangerouslySetInnerHTML="), false);
    assert.ok(source.includes("{r.body}"));
    assert.ok(source.includes("{r.reply}"));
    assert.equal(source.includes("body_original"), false);
    assert.equal(source.includes("source_ip_hash"), false);

    // A hostile string stays data. React escapes it at render time.
    const hostile = mapPublicReviewRow(
        publishedRow({
            body_published: '<script>alert("x")</script>',
            reply_body: "<img src=x onerror=alert(1)>",
            reply_status: "published",
        }),
    );
    assert.equal(hostile?.body, '<script>alert("x")</script>');
    assert.equal(hostile?.reply, "<img src=x onerror=alert(1)>");
});

test("reply drafting is a shared capability with bounded plain text", () => {
    assert.equal(reviewOperationPermission("reply"), "reviews.reply");
    assert.equal(hasPermission("full_admin", "reviews.reply"), true);
    assert.equal(hasPermission("operational_admin", "reviews.reply"), true);
    assert.equal(hasPermission(null, "reviews.reply"), false);

    assert.deepEqual(validateReplyInput({ body: "  Thank you.  " }), {
        ok: true,
        value: { body: "Thank you." },
    });
    for (const body of ["   ", "x".repeat(4001)]) {
        const result = validateReplyInput({ body });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.code, "invalid_reply");
    }

    assert.equal(mapReviewDatabaseError("REVIEW_INVALID_REPLY: empty"), "invalid_reply");
    assert.equal(reviewErrorStatus("invalid_reply"), 422);
    assert.equal(
        reviewErrorMessage("invalid_reply").includes("REVIEW_"),
        false,
    );
});
