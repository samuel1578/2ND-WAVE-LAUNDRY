"use client";
import Link from "next/link";
import { useState } from "react";
import { Empty, Picture } from "@/components/ui";
import { Field, TextField } from "@/components/forms/controls";
import { Dialog } from "@/components/dialog";
import { UnsavedGuard } from "../unsaved";
import { deleteContent, saveContent, useDemoStore } from "@/lib/mock-store";
import type { ContentItem } from "@/lib/contracts";
import { ModuleShell } from "./shared/module-shell";
import { MediaPicker } from "./shared/media-picker";
export function BlogManager({
  id,
  state,
}: {
  id?: string;
  state?: string;
}) {
  const store = useDemoStore();
  if (id) {
    const item =
      id === "new"
        ? undefined
        : store.content.find((c) => c.id === id && c.module === "Blog");
    if (id !== "new" && !item)
      return (
        <Empty
          title="Record not found"
          body="This article is not available in the demo store."
        />
      );
    return <ArticleEditor key={item?.id || "new"} item={item} />;
  }
  const articles =
    state === "empty" ? [] : store.content.filter((c) => c.module === "Blog");
  return (
    <>
      <ModuleShell
        title="Blog"
        description="Articles keep a separate unpublished draft while a published version stays live."
        backHref="/admin/content"
        backLabel="Website Content"
        badge={
          <Link className="button" href="/admin/content/blog/new">
            New Article
          </Link>
        }
      />
      {articles.length ? (
        <div className="grid two">
          {articles.map((article) => (
            <Link
              className="module-card"
              key={article.id}
              href={`/admin/content/blog/${article.id}`}
            >
              <div>
                <span className="badge">
                  {article.published
                    ? "Published"
                    : article.status === "Archived"
                      ? "Archived"
                      : "Draft"}
                </span>
                <h2>{article.title || "Untitled draft"}</h2>
                <p>{article.summary}</p>
                {article.published && article.status === "Draft" && (
                  <small>Published version retained</small>
                )}
              </div>
              <span className="text-link">Edit Article</span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title="No articles yet. Create a draft to get started."
          body="Published articles appear on the public blog in this demo session."
        />
      )}
    </>
  );
}
function ArticleEditor({ item }: { item?: ContentItem }) {
  const store = useDemoStore();
  const empty: ContentItem = {
    id: "",
    module: "Blog",
    title: "",
    slug: "",
    summary: "",
    body: "",
    image: "",
    alt: "",
    status: "Draft",
    sort: 0,
    version: 0,
    extra: {},
  };
  const [form, setForm] = useState<ContentItem>(() =>
    item ? structuredClone(item) : empty,
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(item ?? empty),
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState<
    "publish" | "archive" | "delete" | null
  >(null);
  const [deleted, setDeleted] = useState(false);
  const dirty = JSON.stringify(form) !== baseline;
  const published = !!form.published;
  const archived = form.status === "Archived";
  const showPublish = published ? dirty : true;
  const canSaveDraft = dirty || !form.id;
  function change(key: keyof ContentItem, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
    setSuccess("");
  }
  async function save(action: "draft" | "publish" | "archive" | "unpublish") {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const next = await saveContent(form, action);
      setForm(next);
      setBaseline(JSON.stringify(next));
      setSuccess(
        action === "publish"
          ? "Article published."
          : action === "unpublish"
            ? "Article unpublished. The draft is retained."
            : action === "archive"
              ? "Article archived."
              : "Draft saved.",
      );
      setConfirm(null);
    } catch (err) {
      setError((err as Error).message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }
  async function confirmAction() {
    if (confirm === "publish") return void (await save("publish"));
    if (confirm === "archive") return void (await save("archive"));
    setBusy(true);
    setError("");
    try {
      await deleteContent(form.id);
      setConfirm(null);
      setDeleted(true);
    } catch (err) {
      setError((err as Error).message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }
  if (deleted)
    return (
      <Empty title="Draft deleted">
        <Link className="button" href="/admin/content/blog">
          Return to Blog
        </Link>
      </Empty>
    );
  const field = (
    key: "title" | "slug" | "summary" | "alt",
    label: string,
  ) => (
    <TextField
      id={`article-${key}`}
      label={label}
      value={form[key]}
      maxLength={key === "summary" ? 2000 : 254}
      onChange={(e) => change(key, e.target.value)}
    />
  );
  return (
    <>
      <UnsavedGuard dirty={dirty} />
      <ModuleShell
        title={item ? "Edit Article" : "New Article"}
        description={form.title || undefined}
        backHref="/admin/content/blog"
        backLabel="Blog"
        badge={
          <span className="badge">
            {dirty
              ? "Unsaved changes"
              : published
                ? "Published"
                : form.status}
          </span>
        }
        error={error}
        success={success}
      />
      <form
        className="admin-columns"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save("draft");
        }}
      >
        <div className="panel form-stack">
          {field("title", "Title *")}
          {field("slug", "Slug *")}
          {field("summary", "Summary *")}
          <Field id="article-body" label="Body *">
            <textarea
              id="article-body"
              value={form.body}
              onChange={(e) => change("body", e.target.value)}
              rows={14}
              maxLength={50000}
            />
          </Field>
          <small>Plain text with paragraph breaks. HTML is not executed.</small>
          <TextField
            id="article-sort"
            label="Sort order"
            type="number"
            min={0}
            step={1}
            value={form.sort}
            onChange={(e) => change("sort", Number(e.target.value))}
          />
        </div>
        <div className="stack">
          <section className="panel form-stack">
            <h2>Featured Media</h2>
            {form.image && (
              <Picture photo={{ src: form.image, alt: form.alt }} />
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() => setMedia(true)}
            >
              {form.image ? "Replace Media" : "Select Media"}
            </button>
            {field("alt", "Alt text *")}
          </section>
          <section className="panel form-stack">
            {showPublish ? (
              <>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setConfirm("publish")}
                >
                  Publish
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !canSaveDraft}
                  onClick={() => void save("draft")}
                >
                  Save Draft
                </button>
              </>
            ) : (
              <button
                type="submit"
                className="button"
                disabled={busy || !canSaveDraft}
              >
                Save Draft
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() => setPreview(true)}
            >
              Preview
            </button>
            {published && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void save("unpublish")}
              >
                Unpublish
              </button>
            )}
            {form.id && !archived && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setConfirm("archive")}
              >
                Archive
              </button>
            )}
            {form.id && !published && (
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={() => setConfirm("delete")}
              >
                Delete Draft
              </button>
            )}
            <Link
              className="button secondary"
              href="/admin/content/blog"
            >
              Cancel
            </Link>
          </section>
        </div>
      </form>
      <MediaPicker
        open={media}
        title="Select Media"
        assets={store.media.filter((m) => !m.archived)}
        onPick={(asset) => {
          setForm((f) => ({ ...f, image: asset.src, alt: asset.alt }));
          setMedia(false);
          setSuccess("");
        }}
        onClose={() => setMedia(false)}
      />
      <Dialog
        open={preview}
        onClose={() => setPreview(false)}
        title="Article preview"
      >
        <h2>{form.title || "Untitled draft"}</h2>
        <p>{form.summary}</p>
        {form.image && <Picture photo={{ src: form.image, alt: form.alt }} />}
        <div className="prose">{form.body}</div>
      </Dialog>
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={
          confirm === "publish"
            ? "Publish this article?"
            : confirm === "archive"
              ? "Archive this article?"
              : "Delete this draft?"
        }
      >
        <p>
          {confirm === "publish"
            ? "It will become visible on the website."
            : confirm === "archive"
              ? "It will be removed from the website."
              : "This removes the unpublished draft from the demo workspace."}
        </p>
        <div className="actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => setConfirm(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className={confirm === "delete" ? "button danger" : "button"}
            disabled={busy}
            onClick={() => void confirmAction()}
          >
            {confirm === "publish"
              ? "Publish"
              : confirm === "archive"
                ? "Archive"
                : "Delete Draft"}
          </button>
        </div>
      </Dialog>
    </>
  );
}
