"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Heading } from "@/components/ui";
import { DemoFailure, Notice } from "@/components/forms/controls";
export function ModuleShell({
  title,
  description,
  backHref,
  backLabel,
  badge,
  error,
  success,
  children,
}: {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  badge?: ReactNode;
  error?: string;
  success?: string;
  children?: ReactNode;
}) {
  return (
    <>
      {backHref && (
        <Link className="back-link" href={backHref}>
          ← {backLabel}
        </Link>
      )}
      <Heading title={title} description={description}>
        {badge}
      </Heading>
      {error && <Notice error>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      {children}
      <DemoFailure />
    </>
  );
}
export function CodeManagedNotice({ name }: { name: string }) {
  return (
    <>
      <Link className="back-link" href="/admin/content">
        ← Website Content
      </Link>
      <Heading title={name} />
      <Notice>
        {name} content is managed in code. Its approved layout, copy and
        behaviour are controlled in the project source and cannot be edited
        from Website Content.
      </Notice>
      <div className="actions">
        <Link className="button" href="/admin/content">
          Back to Website Content
        </Link>
      </div>
    </>
  );
}
export function ReviewsMovedNotice() {
  return (
    <>
      <Link className="back-link" href="/admin/content">
        ← Website Content
      </Link>
      <Heading title="Reviews" />
      <Notice>
        Reviews are customer submissions, not editor-created content. Moderate
        them in the dedicated Reviews area.
      </Notice>
      <div className="actions">
        <Link className="button" href="/admin/reviews">
          Go to Reviews
        </Link>
        <Link className="button secondary" href="/admin/content">
          Back to Website Content
        </Link>
      </div>
    </>
  );
}
