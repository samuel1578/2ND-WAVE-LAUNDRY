"use client";
import { useState } from "react";
import { moderateReview, useDemoStore } from "@/lib/mock-store";
import { statusLabel } from "@/lib/rules";
import { Empty, Heading } from "@/components/ui";
import { DemoFailure, Notice } from "@/components/forms/controls";
export function ReviewsAdmin({ state }: { state?: string }) {
  const store = useDemoStore();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const reviews =
    state === "empty"
      ? []
      : store.leads.filter((l) => l.kind === "review" && l.status === "new");
  async function moderate(
    id: string,
    status: "approved" | "rejected",
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await moderateReview(id, status);
      setSuccess(
        status === "approved"
          ? "Review approved."
          : "Review rejected.",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Reviews"
        description="Customer review submissions awaiting moderation."
      />
      {error && <Notice error>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      <Notice>
        Approved reviews become public with the permitted display name.
      </Notice>
      {reviews.length ? (
        reviews.map((review) => (
          <article className="panel form-stack" key={review.id}>
            <div>
              <span className="badge">{statusLabel(review.status)}</span>
              <h3>{review.fields.name}</h3>
            </div>
            <p>{review.fields.review}</p>
            {review.fields.consent !== "yes" && (
              <p>Publication permission is not recorded for this submission.</p>
            )}
            <div className="actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void moderate(review.id, "approved")}
              >
                Approve Review
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void moderate(review.id, "rejected")}
              >
                Reject Review
              </button>
            </div>
          </article>
        ))
      ) : (
        <Empty title="No reviews awaiting approval." />
      )}
      <DemoFailure />
    </>
  );
}
