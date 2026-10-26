import test from "node:test";
import assert from "node:assert/strict";
import {
  canEditPublication,
  canModerate,
  canPublish,
  canReopen,
  mapReviewDatabaseError,
  reviewOperationPermission,
  validateModerationInput,
  validateOverrideInput,
  validatePublicationInput,
  validateReopenInput,
} from "../src/lib/reviews/moderation";
import { reviewErrorMessage, reviewErrorStatus } from "../src/lib/reviews/errors";
import {
  REVIEW_LIST_MAX_PAGE_SIZE,
  applyReviewFilters,
  mapReviewDetailRow,
  mapReviewSummaryRow,
  normaliseReviewListQuery,
  reviewListRange,
  reviewSearchFilter,
} from "../src/lib/reviews/admin";
import { hasPermission } from "../src/lib/auth/permissions";

const FULL = "full_admin" as const;
const OPERATIONAL = "operational_admin" as const;

test("the moderation state machine allows only legal transitions", () => {
  assert.equal(canModerate("pending"), true);
  assert.equal(canModerate("approved"), false);
  assert.equal(canModerate("rejected"), false);

  assert.equal(canReopen("rejected"), true);
  assert.equal(canReopen("pending"), false);
  assert.equal(canReopen("approved"), false);

  assert.equal(canPublish({ moderationStatus: "approved", consent: true }), true);
  assert.equal(canPublish({ moderationStatus: "approved", consent: false }), false);
  assert.equal(canPublish({ moderationStatus: "pending", consent: true }), false);

  assert.equal(canEditPublication({ published: true, canPublish: true }), true);
  assert.equal(canEditPublication({ published: false, canPublish: true }), false);
});

test("rejections require a reason and notes are bounded", () => {
  assert.deepEqual(validateModerationInput({ decision: "approved", note: "  " }), {
    ok: true,
    value: { decision: "approved", note: null },
  });

  const missing = validateModerationInput({ decision: "rejected", note: "   " });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "note_required");

  const long = validateModerationInput({ decision: "rejected", note: "x".repeat(501) });
  assert.equal(long.ok, false);
  if (!long.ok) assert.equal(long.code, "invalid_note");

  const unknown = validateModerationInput({ decision: "withdrawn" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, "invalid_operation");
});

test("publication requires public text except when unpublishing", () => {
  assert.deepEqual(validatePublicationInput({ action: "unpublish", body: "ignored" }), {
    ok: true,
    value: { action: "unpublish", body: null },
  });

  const empty = validatePublicationInput({ action: "publish", body: "   " });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "invalid_publication");

  const oversize = validatePublicationInput({
    action: "update",
    body: "x".repeat(4001),
  });
  assert.equal(oversize.ok, false);

  const valid = validatePublicationInput({ action: "update", body: "  Public text  " });
  assert.deepEqual(valid, {
    ok: true,
    value: { action: "update", body: "Public text" },
  });

  const unknown = validatePublicationInput({ action: "delete", body: "text" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, "invalid_operation");
});

test("re-open and override demand a recorded reason", () => {
  const noReason = validateReopenInput({ reason: "  " });
  assert.equal(noReason.ok, false);
  if (!noReason.ok) assert.equal(noReason.code, "reason_required");

  assert.deepEqual(validateReopenInput({ reason: " Customer supplied details " }), {
    ok: true,
    value: { reason: "Customer supplied details" },
  });

  const overrideNoReason = validateOverrideInput({ operation: "approve" });
  assert.equal(overrideNoReason.ok, false);
  if (!overrideNoReason.ok) assert.equal(overrideNoReason.code, "reason_required");

  const overridePublish = validateOverrideInput({
    operation: "publish",
    reason: "Owner correction",
    body: "Corrected text",
  });
  assert.deepEqual(overridePublish, {
    ok: true,
    value: { operation: "publish", reason: "Owner correction", body: "Corrected text" },
  });

  const overridePublishNoBody = validateOverrideInput({
    operation: "publish",
    reason: "Owner correction",
  });
  assert.equal(overridePublishNoBody.ok, false);
  if (!overridePublishNoBody.ok)
    assert.equal(overridePublishNoBody.code, "invalid_publication");

  const unknown = validateOverrideInput({ operation: "delete", reason: "Because" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, "invalid_operation");
});

test("re-open and override are Full Admin capabilities, moderation is shared", () => {
  assert.equal(reviewOperationPermission("moderate"), "reviews.moderate");
  assert.equal(reviewOperationPermission("publish"), "reviews.moderate");
  assert.equal(reviewOperationPermission("reply"), "reviews.reply");
  assert.equal(reviewOperationPermission("reopen"), "reviews.override");
  assert.equal(reviewOperationPermission("override"), "reviews.override");

  for (const operation of ["moderate", "publish", "reply"] as const) {
    assert.equal(hasPermission(OPERATIONAL, reviewOperationPermission(operation)), true);
    assert.equal(hasPermission(FULL, reviewOperationPermission(operation)), true);
  }
  for (const operation of ["reopen", "override"] as const) {
    assert.equal(hasPermission(OPERATIONAL, reviewOperationPermission(operation)), false);
    assert.equal(hasPermission(FULL, reviewOperationPermission(operation)), true);
  }
});

test("database markers map onto the stable review error taxonomy", () => {
  const cases: Array<[string, string]> = [
    ["REVIEW_ACTOR_REQUIRED: no identity", "actor_required"],
    ["REVIEW_FORBIDDEN: Full Admin required", "permission_denied"],
    ["REVIEW_NOT_FOUND: gone", "not_found"],
    ["REVIEW_CONFLICT: stale", "version_conflict"],
    ["REVIEW_INVALID_TRANSITION: decided", "invalid_transition"],
    ["REVIEW_STATE_UNCHANGED: already published", "state_unchanged"],
    ["REVIEW_NOTE_REQUIRED: reason", "note_required"],
    ["REVIEW_REASON_REQUIRED: reason", "reason_required"],
    ["REVIEW_INVALID_OPERATION: unsupported", "invalid_operation"],
    ["REVIEW_INVALID_NOTE: too long", "invalid_note"],
    ["REVIEW_INVALID_BODY: empty", "invalid_publication"],
    ["REVIEW_CONSENT_REQUIRED: no permission", "consent_required"],
  ];
  for (const [marker, code] of cases)
    assert.equal(mapReviewDatabaseError(marker), code, marker);
  assert.equal(mapReviewDatabaseError("database is on fire"), "conflict");
  assert.equal(mapReviewDatabaseError(null), "conflict");
});

test("error codes carry safe messages and correct HTTP statuses", () => {
  assert.equal(reviewErrorStatus("not_found"), 404);
  assert.equal(reviewErrorStatus("permission_denied"), 403);
  assert.equal(reviewErrorStatus("actor_required"), 401);
  assert.equal(reviewErrorStatus("version_conflict"), 409);
  assert.equal(reviewErrorStatus("invalid_transition"), 409);
  assert.equal(reviewErrorStatus("note_required"), 422);
  assert.equal(reviewErrorStatus("rate_limited"), 429);
  for (const code of ["not_found", "permission_denied", "version_conflict"] as const) {
    const message = reviewErrorMessage(code);
    assert.ok(message.length > 0);
    assert.equal(message.includes("REVIEW_"), false);
  }
});

test("queue filters are normalised and bounded", () => {
  const query = normaliseReviewListQuery({
    search: "  Ama,(test)*  ",
    status: "pending",
    branch: "Ashaiman",
    rating: "4",
    from: "2026-10-01",
    to: "not-a-date",
    page: "3",
    pageSize: "500",
  });
  assert.equal(query.status, "pending");
  assert.equal(query.branch, "Ashaiman");
  assert.equal(query.rating, 4);
  assert.equal(query.from, "2026-10-01");
  assert.equal(query.to, "");
  assert.equal(query.page, 3);
  assert.equal(query.pageSize, REVIEW_LIST_MAX_PAGE_SIZE);
  assert.equal(query.search, "Ama test");

  const hostile = normaliseReviewListQuery({
    status: "withdrawn",
    rating: "9",
    page: "-4",
    pageSize: "0",
  });
  assert.equal(hostile.status, "");
  assert.equal(hostile.rating, null);
  assert.equal(hostile.page, 1);
  assert.equal(hostile.pageSize, 20);

  assert.equal(reviewSearchFilter(""), null);
  assert.equal(
    reviewSearchFilter("Ama"),
    "customer_name.ilike.*Ama*,body_original.ilike.*Ama*",
  );
  assert.deepEqual(reviewListRange(query), { from: 100, to: 149 });
});

test("queue filtering mirrors the SQL filters", () => {
  const base = {
    customerName: "Ama Mensah",
    rating: 5,
    branch: "Ashaiman",
    consent: true,
    moderationStatus: "pending" as const,
    published: false,
    publishedVersion: null,
    version: 1,
    moderatedAt: null,
  };
  const rows = [
    { ...base, id: "1", createdAt: "2026-10-01T09:00:00.000Z" },
    {
      ...base,
      id: "2",
      customerName: "Kofi Boateng",
      rating: 3,
      branch: "Tema",
      moderationStatus: "approved" as const,
      published: true,
      publishedVersion: 1,
      createdAt: "2026-10-15T09:00:00.000Z",
    },
    {
      ...base,
      id: "3",
      customerName: "Esi Owusu",
      rating: 4,
      moderationStatus: "rejected" as const,
      createdAt: "2026-11-02T09:00:00.000Z",
    },
  ];

  const byStatus = applyReviewFilters(
    rows,
    normaliseReviewListQuery({ status: "approved" }),
  );
  assert.deepEqual(byStatus.map((row) => row.id), ["2"]);

  const byDate = applyReviewFilters(
    rows,
    normaliseReviewListQuery({ from: "2026-10-05", to: "2026-10-31" }),
  );
  assert.deepEqual(byDate.map((row) => row.id), ["2"]);

  const byBranchAndRating = applyReviewFilters(
    rows,
    normaliseReviewListQuery({ branch: "Ashaiman", rating: "5" }),
  );
  assert.deepEqual(byBranchAndRating.map((row) => row.id), ["1"]);

  const bySearch = applyReviewFilters(
    rows,
    normaliseReviewListQuery({ search: "esi" }),
  );
  assert.deepEqual(bySearch.map((row) => row.id), ["3"]);
});

test("row mappers fail closed and never project private columns", () => {
  assert.equal(mapReviewSummaryRow(null), null);
  assert.equal(mapReviewSummaryRow({ id: "not-a-uuid" }), null);
  assert.equal(
    mapReviewSummaryRow({
      id: "11111111-1111-1111-1111-111111111111",
      moderation_status: "unknown",
    }),
    null,
  );

  const summary = mapReviewSummaryRow({
    id: "11111111-1111-1111-1111-111111111111",
    customer_name: "Ama Mensah",
    rating: "5",
    branch: "Ashaiman",
    consent: true,
    moderation_status: "approved",
    body_published: "Public text",
    published_version: 2,
    version: 3,
    created_at: "2026-10-01T09:00:00.000Z",
    moderated_at: "2026-10-01T10:00:00.000Z",
    // Private columns must not appear in the projection even if selected.
    source_ip_hash: "a".repeat(32),
    moderation_note: "internal",
    body_original: "original",
  });
  assert.ok(summary);
  assert.deepEqual(Object.keys(summary).sort(), [
    "branch",
    "consent",
    "createdAt",
    "customerName",
    "id",
    "moderatedAt",
    "moderationStatus",
    "published",
    "publishedVersion",
    "rating",
    "version",
  ]);
  assert.equal(summary.published, true);
  assert.equal(summary.publishedVersion, 2);

  const detail = mapReviewDetailRow(
    {
      id: "11111111-1111-1111-1111-111111111111",
      customer_name: "Ama Mensah",
      body_original: "Original customer wording.",
      body_published: "Public wording.",
      rating: 5,
      branch: "Ashaiman",
      consent: true,
      consent_version: "review-copy-v1",
      moderation_status: "approved",
      moderated_at: "2026-10-01T10:00:00.000Z",
      moderation_note: "Verified",
      published_at: "2026-10-01T11:00:00.000Z",
      published_version: 1,
      version: 3,
      created_at: "2026-10-01T09:00:00.000Z",
      updated_at: "2026-10-01T11:00:00.000Z",
    },
    {
      audit: [
        {
          id: 7,
          action: "review.approved",
          actor_id: "22222222-2222-2222-2222-222222222222",
          reason: "Verified",
          before_state: { moderation_status: "pending" },
          after_state: { moderation_status: "approved" },
          created_at: "2026-10-01T10:00:00.000Z",
        },
      ],
    },
  );
  assert.ok(detail);
  assert.equal(detail.bodyOriginal, "Original customer wording.");
  assert.equal(detail.bodyPublished, "Public wording.");
  assert.equal(detail.audit.length, 1);
  assert.equal(detail.audit[0].id, "7");
  assert.equal(detail.audit[0].action, "review.approved");
});
