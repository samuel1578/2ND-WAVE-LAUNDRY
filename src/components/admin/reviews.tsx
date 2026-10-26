"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { moderateReview, useDemoStore } from "@/lib/mock-store";
import type { Lead } from "@/lib/contracts";
import { statusLabel } from "@/lib/rules";
import { Empty, Heading, Skeleton } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import {
  DemoFailure,
  Field,
  Notice,
  TextField,
} from "@/components/forms/controls";
import {
  REVIEW_LIST_PAGE_SIZE,
  type AdminReviewDetail,
  type AdminReviewSummary,
  type ReviewAuditEntry,
  type ReviewListPage,
} from "@/lib/reviews/admin";
import {
  REVIEW_MODERATION_STATUSES,
  canModerate,
  canPublish,
  canReopen,
  type ReviewModerationStatus,
  type ReviewOverrideOperation,
} from "@/lib/reviews/moderation";
import {
  draftReplyAction,
  moderateReviewAction,
  overrideReviewAction,
  publishReplyAction,
  publishReviewAction,
  reopenReviewAction,
  type ReviewActionResult,
} from "@/lib/reviews/actions";

/**
 * Administrator reviews (Sprint 3B).
 *
 * Two isolated experiences share this entry point:
 *
 *  - the **demo** workspace (no verified session) keeps the in-memory sample
 *    reviews and allows approve/reject for design review;
 *  - the **live** workspace (a verified administrator session) reads persisted
 *    submissions through `/api/admin/reviews` and mutates them through the guarded
 *    server actions. Publication, re-open and overrides exist only on the live
 *    path because only it writes audit history.
 *
 * A database failure surfaces as an error state and never falls back to sample
 * data. Customer text is always rendered as text — never as HTML.
 */

const STATUS_LABELS: Record<ReviewModerationStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const OCCURRED_FORMAT = "en-GB";

const formatInstant = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(OCCURRED_FORMAT, { timeZone: "Africa/Accra" })
    : "—";

const AUDIT_LABELS: Record<string, string> = {
  "review.submitted": "Submitted by customer",
  "review.approved": "Approved",
  "review.rejected": "Rejected",
  "review.published": "Published",
  "review.unpublished": "Unpublished",
  "review.publication_updated": "Public version edited",
  "review.reopened": "Re-opened for moderation",
  "review.reply_drafted": "Reply drafted",
  "review.reply_published": "Reply published",
  "review.override_approve": "Override — approved",
  "review.override_reject": "Override — rejected",
  "review.override_publish": "Override — published",
  "review.override_unpublish": "Override — unpublished",
};

function auditActionLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action.replaceAll("_", " ");
}

function auditSummary(entry: ReviewAuditEntry): string {
  const before = entry.beforeState ?? {};
  const after = entry.afterState ?? {};
  const parts: string[] = [];
  if (
    typeof before.moderation_status === "string" ||
    typeof after.moderation_status === "string"
  )
    parts.push(
      `${String(before.moderation_status ?? "—")} → ${String(after.moderation_status ?? "—")}`,
    );
  if (typeof after.published === "boolean")
    parts.push(after.published ? "published" : "not published");
  return parts.join(" · ");
}

export function ReviewsAdmin({
  id,
  state,
  demo,
  canOverride,
}: {
  id?: string;
  state?: string;
  demo: boolean;
  canOverride: boolean;
}) {
  return demo ? (
    <DemoReviews id={id} state={state} />
  ) : (
    <LiveReviews id={id} canOverride={canOverride} />
  );
}

/* -------------------------------------------------------------------------- */
/* Demo workspace — isolated, in-memory sample reviews                         */
/* -------------------------------------------------------------------------- */

function DemoReviews({ id, state }: { id?: string; state?: string }) {
  const store = useDemoStore();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  if (id) {
    const lead = store.leads.find((l) => l.id === id && l.kind === "review");
    return lead ? (
      <DemoReviewDetail key={id} lead={lead} />
    ) : (
      <Empty
        title="Record not found"
        body="This review may no longer be available."
      >
        <Link className="button" href="/admin/reviews">
          View All Reviews
        </Link>
      </Empty>
    );
  }

  const rows =
    state === "empty"
      ? []
      : store.leads.filter(
          (l) =>
            l.kind === "review" &&
            (!status || l.status === status) &&
            (!search ||
              `${l.fields.name ?? ""} ${l.fields.review ?? ""}`
                .toLowerCase()
                .includes(search.toLowerCase())),
        );

  return (
    <>
      <Heading
        title="Reviews"
        description="Customer review submissions awaiting moderation."
      />
      <div className="filter-panel">
        <TextField
          id="demo-review-search"
          label="Search reviews"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Field id="demo-review-status" label="Status">
          <select
            id="demo-review-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="new">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </Field>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Review moderation queue</caption>
            <thead>
              <tr>
                {["Submitted", "Customer", "Rating", "Branch", "Status"].map(
                  (h) => (
                    <th key={h}>{h}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <Link href={`/admin/reviews/${lead.id}`}>
                      {new Date(lead.createdAt).toLocaleDateString("en-GB")} ↗
                    </Link>
                  </td>
                  <td>{lead.fields.name}</td>
                  <td>{lead.fields.rating ? `${lead.fields.rating} / 5` : "—"}</td>
                  <td>{lead.fields.branch || "—"}</td>
                  <td>
                    <span className={`badge ${lead.status}`}>
                      {statusLabel(lead.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No reviews match these filters." />
      )}
      <p className="demo-caption">
        Publication controls, audit history and overrides are available in the
        live console.
      </p>
    </>
  );
}

function DemoReviewDetail({ lead }: { lead: Lead }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  async function moderate(status: "approved" | "rejected", reason?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await moderateReview(lead.id, status, reason);
      setSuccess(status === "approved" ? "Review approved." : "Review rejected.");
      setRejectOpen(false);
      setNote("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const decided = lead.status !== "new";

  return (
    <>
      <Link className="back-link" href="/admin/reviews">
        ← Reviews
      </Link>
      <Heading title={lead.fields.name || "Review"} description="Sample review">
        <span className={`badge ${lead.status}`}>{statusLabel(lead.status)}</span>
      </Heading>
      {error && <Notice error>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      <div className="admin-columns">
        <section className="panel">
          <h2>Original submission</h2>
          <dl className="review-list">
            <div>
              <dt>Review</dt>
              <dd>{lead.fields.review}</dd>
            </div>
            <div>
              <dt>Rating</dt>
              <dd>{lead.fields.rating ? `${lead.fields.rating} / 5` : "Not given"}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{lead.fields.branch || "Not given"}</dd>
            </div>
            <div>
              <dt>Publication permission</dt>
              <dd>{lead.fields.consent === "yes" ? "Recorded" : "Not recorded"}</dd>
            </div>
          </dl>
          {lead.notes.length > 0 && (
            <>
              <h3>Decision notes</h3>
              {lead.notes.map((entry, index) => (
                <p className="internal-note" key={index}>
                  {entry}
                </p>
              ))}
            </>
          )}
        </section>
        <section className="panel form-stack" aria-busy={busy}>
          <h2>Moderation</h2>
          {decided ? (
            <p>
              This sample review has been {statusLabel(lead.status).toLowerCase()}.
              Re-opening and overrides are available in the live console.
            </p>
          ) : (
            <>
              <p>
                Approving a sample review never publishes it: the public site is
                unchanged in demo mode.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void moderate("approved")}
                >
                  Approve Review
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setRejectOpen(true)}
                >
                  Reject Review
                </button>
              </div>
            </>
          )}
          <DemoFailure />
        </section>
      </div>
      <Dialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject Review"
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void moderate("rejected", note);
          }}
        >
          <p>A recorded reason is required before a review can be rejected.</p>
          <Field id="demo-reject-note" label="Reason for rejection">
            <textarea
              id="demo-reject-note"
              value={note}
              maxLength={500}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="actions">
            <button
              type="submit"
              className="button danger"
              disabled={busy || !note.trim()}
            >
              Reject Review
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setRejectOpen(false)}
            >
              Keep Review
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Live workspace — persisted Supabase reviews                                */
/* -------------------------------------------------------------------------- */

type ReviewListPayload = {
  rows: AdminReviewSummary[];
  total: number;
  page: number;
  pageSize: number;
};

function LiveReviews({ id, canOverride }: { id?: string; canOverride: boolean }) {
  return id ? (
    <LiveReviewDetail id={id} canOverride={canOverride} />
  ) : (
    <LiveReviewList />
  );
}

function LiveReviewList() {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [branch, setBranch] = useState("");
  const [rating, setRating] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<ReviewListPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (branch) params.set("branch", branch);
      if (rating) params.set("rating", rating);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("page", String(page));
      const response = await fetch(`/api/admin/reviews?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setError(
          response.status === 403
            ? "Your administrator role does not include reviews."
            : "Reviews could not be loaded. Reload the page and try again.",
        );
        setPayload(null);
        return;
      }
      const data = (await response.json()) as Partial<ReviewListPayload>;
      setPayload({
        rows: data.rows ?? [],
        total: data.total ?? 0,
        page: data.page ?? 1,
        pageSize: data.pageSize ?? REVIEW_LIST_PAGE_SIZE,
      });
    } catch {
      setError("Reviews could not be loaded. Reload the page and try again.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [search, status, branch, rating, from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = payload?.rows ?? [];
  const total = payload?.total ?? 0;
  const pageSize = payload?.pageSize ?? REVIEW_LIST_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const filtered = Boolean(
    search || status || branch || rating || from || to,
  );

  function clearFilters() {
    setSearchDraft("");
    setSearch("");
    setStatus("");
    setBranch("");
    setRating("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  return (
    <>
      <Heading
        title="Reviews"
        description="Customer review submissions, decisions and publication."
      />
      <form
        className="filter-panel"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchDraft.trim());
        }}
      >
        <TextField
          id="review-search"
          label="Search reviews"
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
        />
        <Field id="review-status-filter" label="Status">
          <select
            id="review-status-filter"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {REVIEW_MODERATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <TextField
          id="review-branch-filter"
          label="Branch"
          value={branch}
          maxLength={120}
          onChange={(e) => {
            setBranch(e.target.value);
            setPage(1);
          }}
        />
        <Field id="review-rating-filter" label="Rating">
          <select
            id="review-rating-filter"
            value={rating}
            onChange={(e) => {
              setRating(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All ratings</option>
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>
                {value} / 5
              </option>
            ))}
          </select>
        </Field>
        <TextField
          id="review-from-filter"
          label="Submitted from"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <TextField
          id="review-to-filter"
          label="Submitted to"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
        <button type="submit" className="button">
          Search
        </button>
      </form>
      <button type="button" className="text-link" onClick={clearFilters}>
        Clear filters
      </button>

      {loading ? (
        <Skeleton count={6} />
      ) : error ? (
        <Empty title="Reviews are unavailable" body={error}>
          <button className="button" onClick={() => void load()}>
            Try Again
          </button>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty
          title={
            filtered ? "No reviews match these filters." : "No reviews yet."
          }
        />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Review moderation queue</caption>
              <thead>
                <tr>
                  {[
                    "Submitted",
                    "Customer",
                    "Rating",
                    "Branch",
                    "Status",
                    "Publication",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/admin/reviews/${row.id}`}>
                        {formatInstant(row.createdAt)} ↗
                      </Link>
                    </td>
                    <td>{row.customerName || "—"}</td>
                    <td>{row.rating ? `${row.rating} / 5` : "—"}</td>
                    <td>{row.branch || "—"}</td>
                    <td>
                      <span className={`badge ${row.moderationStatus}`}>
                        {STATUS_LABELS[row.moderationStatus]}
                      </span>
                    </td>
                    <td>
                      {row.published
                        ? `Published v${row.publishedVersion ?? 1}`
                        : "Not published"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              Showing {rangeStart}–{rangeEnd} of {total}
            </span>
            <div className="actions">
              <button
                className="button secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="muted">
                Page {page} of {totalPages}
              </span>
              <button
                className="button secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

type ReviewNotice = {
  kind: "success" | "error";
  text: string;
  conflict?: boolean;
};

function LiveReviewDetail({
  id,
  canOverride,
}: {
  id: string;
  canOverride: boolean;
}) {
  const [review, setReview] = useState<AdminReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ReviewNotice | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [replyDraft, setReplyDraft] = useState("");

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishAction, setPublishAction] = useState<"publish" | "update">(
    "publish",
  );
  const [publicBody, setPublicBody] = useState("");

  const [unpublishOpen, setUnpublishOpen] = useState(false);

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideOperation, setOverrideOperation] =
    useState<ReviewOverrideOperation>("approve");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideBody, setOverrideBody] = useState("");

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/admin/reviews?id=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        if (response.status === 404) {
          setNotFound(true);
          setReview(null);
          return;
        }
        if (!response.ok) {
          setError(
            response.status === 403
              ? "Your administrator role does not include reviews."
              : "This review could not be loaded. Reload the page and try again.",
          );
          setReview(null);
          return;
        }
        const data = (await response.json()) as { review: AdminReviewDetail };
        setNotFound(false);
        setReview(data.review);
        setReplyDraft(data.review.replyBody ?? "");
        setFieldErrors({});
      } catch {
        setError(
          "This review could not be loaded. Reload the page and try again.",
        );
        setReview(null);
      } finally {
        if (mode === "initial") setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  function applyFailure(result: Extract<ReviewActionResult, { ok: false }>) {
    if (result.fieldErrors) setFieldErrors(result.fieldErrors);
    setNotice({
      kind: "error",
      text: result.message,
      conflict: result.code === "version_conflict",
    });
  }

  async function execute(
    operation: () => Promise<ReviewActionResult>,
    onSuccess?: () => void,
  ) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setFieldErrors({});
    const result = await operation();
    if (result.ok) {
      setNotice({ kind: "success", text: result.message });
      onSuccess?.();
      await load("refresh");
    } else {
      applyFailure(result);
    }
    setBusy(false);
  }

  function openPublish(action: "publish" | "update") {
    if (!review) return;
    setPublishAction(action);
    setPublicBody(review.bodyPublished ?? review.bodyOriginal);
    setPublishOpen(true);
  }

  function openOverride() {
    setOverrideOperation(review?.published ? "unpublish" : "approve");
    setOverrideReason("");
    setOverrideBody(review?.bodyPublished ?? review?.bodyOriginal ?? "");
    setOverrideOpen(true);
  }

  if (loading)
    return (
      <>
        <Heading title="Review" />
        <Skeleton count={4} />
      </>
    );

  if (notFound)
    return (
      <Empty
        title="Record not found"
        body="This review may no longer be available."
      >
        <Link className="button" href="/admin/reviews">
          View All Reviews
        </Link>
      </Empty>
    );

  if (error || !review)
    return (
      <Empty title="Review is unavailable" body={error || undefined}>
        <button className="button" onClick={() => void load("initial")}>
          Try Again
        </button>
      </Empty>
    );

  const publishable = canPublish(review);

  return (
    <>
      <Link className="back-link" href="/admin/reviews">
        ← Reviews
      </Link>
      <Heading title={review.customerName || "Review"}>
        <span className={`badge ${review.moderationStatus}`}>
          {STATUS_LABELS[review.moderationStatus]}
        </span>
        {review.published && (
          <span className="badge">Published v{review.publishedVersion ?? 1}</span>
        )}
      </Heading>
      {notice && (
        <Notice error={notice.kind === "error"} success={notice.kind === "success"}>
          {notice.text}
          {notice.conflict && (
            <button
              className="text-link"
              onClick={() => {
                setNotice(null);
                void load("refresh");
              }}
            >
              Reload latest details
            </button>
          )}
        </Notice>
      )}
      <div className="admin-columns">
        <div className="stack">
          <section className="panel">
            <h2>Original submission</h2>
            <dl className="review-list">
              <div>
                <dt>Original review (read-only)</dt>
                <dd>{review.bodyOriginal}</dd>
              </div>
              <div>
                <dt>Rating</dt>
                <dd>{review.rating ? `${review.rating} / 5` : "Not given"}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{review.branch || "Not given"}</dd>
              </div>
              <div>
                <dt>Publication permission</dt>
                <dd>
                  {review.consent
                    ? `Recorded (notice ${review.consentVersion})`
                    : "Not recorded — this review cannot be published"}
                </dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{formatInstant(review.createdAt)}</dd>
              </div>
              {review.moderatedAt && (
                <div>
                  <dt>Decided</dt>
                  <dd>{formatInstant(review.moderatedAt)}</dd>
                </div>
              )}
            </dl>
            {review.moderationNote && (
              <p className="internal-note">{review.moderationNote}</p>
            )}
          </section>
          <section className="panel form-stack" aria-busy={busy}>
            <h2>Reply</h2>
            {review.replyStatus === "published" && review.replyBody ? (
              <dl className="review-list">
                <div>
                  <dt>Published reply</dt>
                  <dd>{review.replyBody}</dd>
                </div>
                <div>
                  <dt>Reply published</dt>
                  <dd>{formatInstant(review.replyPublishedAt)}</dd>
                </div>
              </dl>
            ) : review.replyStatus === "draft" ? (
              <p>A reply draft is saved and is not visible publicly.</p>
            ) : (
              <p>No reply has been drafted yet.</p>
            )}
            <Field
              id="reply-body"
              label={
                review.replyStatus === "published"
                  ? "New reply draft"
                  : "Reply draft"
              }
              error={fieldErrors.body}
              help="Plain text. A reply is public only after it is published under an approved, published review."
            >
              <textarea
                id="reply-body"
                value={replyDraft}
                maxLength={4000}
                rows={5}
                aria-invalid={!!fieldErrors.body}
                aria-describedby={
                  fieldErrors.body ? "reply-body-error" : "reply-body-help"
                }
                onChange={(e) => setReplyDraft(e.target.value)}
              />
            </Field>
            <div className="actions">
              <button
                type="button"
                className="button secondary"
                disabled={
                  busy ||
                  !replyDraft.trim() ||
                  replyDraft === (review.replyBody ?? "")
                }
                onClick={() =>
                  void execute(() =>
                    draftReplyAction({
                      reviewId: review.id,
                      body: replyDraft,
                      expectedVersion: review.version,
                    }),
                  )
                }
              >
                Save Draft
              </button>
              <button
                type="button"
                className="button"
                disabled={
                  busy ||
                  review.replyStatus !== "draft" ||
                  !review.replyBody ||
                  replyDraft !== review.replyBody ||
                  review.moderationStatus !== "approved" ||
                  !review.published
                }
                onClick={() =>
                  void execute(() =>
                    publishReplyAction({
                      reviewId: review.id,
                      expectedVersion: review.version,
                    }),
                  )
                }
              >
                Publish Saved Draft
              </button>
            </div>
            {review.replyStatus === "draft" &&
              (review.moderationStatus !== "approved" || !review.published) && (
                <p className="muted">
                  The review must be approved and published before its reply can
                  be published.
                </p>
              )}
            {review.replyStatus === "published" && (
              <p className="demo-caption">
                Replacing a published reply creates a draft and retains the
                previous published text.
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Public version</h2>
            {review.published && review.bodyPublished ? (
              <>
                <dl className="review-list">
                  <div>
                    <dt>Published text (version {review.publishedVersion ?? 1})</dt>
                    <dd>{review.bodyPublished}</dd>
                  </div>
                  <div>
                    <dt>Published</dt>
                    <dd>{formatInstant(review.publishedAt)}</dd>
                  </div>
                </dl>
                <p className="demo-caption">
                  The original customer text above is retained unchanged.
                </p>
              </>
            ) : (
              <p>
                This review is not published. Publishing uses editable public text
                and never changes the original submission.
              </p>
            )}
            {review.audit.length > 0 && (
              <>
                <h3>History</h3>
                <ol className="history">
                  {review.audit.map((entry) => (
                    <li key={entry.id || `${entry.action}-${entry.at}`}>
                      <strong>{auditActionLabel(entry.action)}</strong>
                      <time>{formatInstant(entry.at)}</time>
                      {entry.reason && <p>{entry.reason}</p>}
                      <small>{auditSummary(entry)}</small>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {review.audit.length === 0 && (
              <p className="muted">No history is visible for this review.</p>
            )}
          </section>
        </div>
        <div className="stack">
          <section className="panel form-stack" aria-busy={busy}>
            <h2>Moderation</h2>
            {canModerate(review.moderationStatus) ? (
              <>
                <p>
                  Approve to allow publication, or reject with a recorded reason.
                  Decisions are final for this role; a Full Admin can re-open a
                  rejection or override a decision.
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void execute(() =>
                        moderateReviewAction({
                          reviewId: review.id,
                          decision: "approved",
                          note: null,
                          expectedVersion: review.version,
                        }),
                      )
                    }
                  >
                    Approve Review
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setRejectNote("");
                      setFieldErrors({});
                      setRejectOpen(true);
                    }}
                  >
                    Reject Review
                  </button>
                </div>
              </>
            ) : (
              <p>
                This review is {STATUS_LABELS[review.moderationStatus].toLowerCase()}.
                {review.moderationNote
                  ? ` Recorded reason: ${review.moderationNote}`
                  : ""}
              </p>
            )}
          </section>
          <section className="panel form-stack" aria-busy={busy}>
            <h2>Publication</h2>
            {review.published ? (
              <>
                <p>
                  Published version {review.publishedVersion ?? 1}. Editing the
                  public text creates a new version; the original stays intact.
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="button"
                    disabled={busy || !publishable}
                    onClick={() => openPublish("update")}
                  >
                    Edit Public Version
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setUnpublishOpen(true)}
                  >
                    Unpublish
                  </button>
                </div>
              </>
            ) : publishable ? (
              <>
                <p>
                  The customer consented and the review is approved. Publish an
                  editable public version of the text.
                </p>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => openPublish("publish")}
                >
                  Publish Review
                </button>
              </>
            ) : (
              <p>
                {review.moderationStatus === "approved"
                  ? "Publication permission was not recorded, so this review cannot be published."
                  : "Approve the review before publishing it."}
              </p>
            )}
          </section>
          {canOverride && (
            <section className="panel form-stack" aria-busy={busy}>
              <h2>Full Admin controls</h2>
              {canReopen(review.moderationStatus) && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    setReopenReason("");
                    setFieldErrors({});
                    setReopenOpen(true);
                  }}
                >
                  Re-open for Moderation
                </button>
              )}
              <Notice>
                Emergency override reverses a decision or publication. It requires
                a recorded reason and is logged as an override in the review
                history.
              </Notice>
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={openOverride}
              >
                Override Review
              </button>
            </section>
          )}
        </div>
      </div>

      <Dialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject Review"
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void execute(
              () =>
                moderateReviewAction({
                  reviewId: review.id,
                  decision: "rejected",
                  note: rejectNote,
                  expectedVersion: review.version,
                }),
              () => setRejectOpen(false),
            );
          }}
        >
          <p>A recorded reason is required before a review can be rejected.</p>
          <Field id="reject-note" label="Reason for rejection" error={fieldErrors.note}>
            <textarea
              id="reject-note"
              value={rejectNote}
              maxLength={500}
              rows={3}
              aria-invalid={!!fieldErrors.note}
              aria-describedby={
                fieldErrors.note ? "reject-note-error" : undefined
              }
              onChange={(e) => setRejectNote(e.target.value)}
            />
          </Field>
          <div className="actions">
            <button
              type="submit"
              className="button danger"
              disabled={busy || !rejectNote.trim()}
            >
              Reject Review
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setRejectOpen(false)}
            >
              Keep Review
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title={publishAction === "publish" ? "Publish Review" : "Edit Public Version"}
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void execute(
              () =>
                publishReviewAction({
                  reviewId: review.id,
                  action: publishAction,
                  body: publicBody,
                  expectedVersion: review.version,
                }),
              () => setPublishOpen(false),
            );
          }}
        >
          <Field
            id="public-body"
            label="Public text"
            error={fieldErrors.body}
            help="Rendered as plain text. The original submission is not changed."
          >
            <textarea
              id="public-body"
              value={publicBody}
              maxLength={4000}
              rows={6}
              aria-invalid={!!fieldErrors.body}
              aria-describedby={
                fieldErrors.body ? "public-body-error" : "public-body-help"
              }
              onChange={(e) => setPublicBody(e.target.value)}
            />
          </Field>
          <div className="form-stack">
            <h3>Original submission</h3>
            <p className="muted">{review.bodyOriginal}</p>
          </div>
          <div className="actions">
            <button
              type="submit"
              className="button"
              disabled={busy || !publicBody.trim()}
            >
              {publishAction === "publish" ? "Publish Review" : "Save New Version"}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setPublishOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={unpublishOpen}
        onClose={() => setUnpublishOpen(false)}
        title="Unpublish Review"
      >
        <p>
          The review will be removed from the public site immediately. The original
          submission and its history are retained.
        </p>
        <div className="actions">
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() =>
              void execute(
                () =>
                  publishReviewAction({
                    reviewId: review.id,
                    action: "unpublish",
                    body: null,
                    expectedVersion: review.version,
                  }),
                () => setUnpublishOpen(false),
              )
            }
          >
            Unpublish Review
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => setUnpublishOpen(false)}
          >
            Keep Published
          </button>
        </div>
      </Dialog>

      <Dialog
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        title="Re-open Review"
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void execute(
              () =>
                reopenReviewAction({
                  reviewId: review.id,
                  reason: reopenReason,
                  expectedVersion: review.version,
                }),
              () => setReopenOpen(false),
            );
          }}
        >
          <p>
            The review returns to the pending queue and its decision is cleared. A
            reason is required and is recorded in the history.
          </p>
          <Field
            id="reopen-reason"
            label="Reason for re-opening"
            error={fieldErrors.reason}
          >
            <textarea
              id="reopen-reason"
              value={reopenReason}
              maxLength={500}
              rows={3}
              aria-invalid={!!fieldErrors.reason}
              aria-describedby={
                fieldErrors.reason ? "reopen-reason-error" : undefined
              }
              onChange={(e) => setReopenReason(e.target.value)}
            />
          </Field>
          <button
            type="submit"
            className="button"
            disabled={busy || !reopenReason.trim()}
          >
            Re-open Review
          </button>
        </form>
      </Dialog>

      <Dialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Emergency Override"
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void execute(
              () =>
                overrideReviewAction({
                  reviewId: review.id,
                  operation: overrideOperation,
                  reason: overrideReason,
                  body:
                    overrideOperation === "publish" ? overrideBody : null,
                  expectedVersion: review.version,
                }),
              () => setOverrideOpen(false),
            );
          }}
        >
          <Notice error>
            Overrides are reserved for emergencies. The action, your account and the
            reason are written to the immutable audit history.
          </Notice>
          <Field
            id="override-operation"
            label="Override operation"
            error={fieldErrors.operation}
          >
            <select
              id="override-operation"
              value={overrideOperation}
              aria-invalid={!!fieldErrors.operation}
              aria-describedby={
                fieldErrors.operation ? "override-operation-error" : undefined
              }
              onChange={(e) =>
                setOverrideOperation(e.target.value as ReviewOverrideOperation)
              }
            >
              <option value="approve">Force approval</option>
              <option value="reject">Force rejection (unpublishes)</option>
              <option value="publish">Force publication</option>
              <option value="unpublish">Force unpublish</option>
            </select>
          </Field>
          {overrideOperation === "publish" && (
            <Field
              id="override-body"
              label="Public text"
              error={fieldErrors.body}
            >
              <textarea
                id="override-body"
                value={overrideBody}
                maxLength={4000}
                rows={5}
                aria-invalid={!!fieldErrors.body}
                aria-describedby={
                  fieldErrors.body ? "override-body-error" : undefined
                }
                onChange={(e) => setOverrideBody(e.target.value)}
              />
            </Field>
          )}
          <Field
            id="override-reason"
            label="Reason for override"
            error={fieldErrors.reason}
          >
            <textarea
              id="override-reason"
              value={overrideReason}
              maxLength={500}
              rows={3}
              aria-invalid={!!fieldErrors.reason}
              aria-describedby={
                fieldErrors.reason ? "override-reason-error" : undefined
              }
              onChange={(e) => setOverrideReason(e.target.value)}
            />
          </Field>
          <button
            type="submit"
            className="button danger"
            disabled={busy || !overrideReason.trim()}
          >
            Apply Override
          </button>
        </form>
      </Dialog>
    </>
  );
}
