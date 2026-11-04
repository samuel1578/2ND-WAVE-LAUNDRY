"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Empty, Picture } from "@/components/ui";
import { Field, TextField } from "@/components/forms/controls";
import { Dialog } from "@/components/dialog";
import { UnsavedGuard } from "../unsaved";
import { deleteContent, saveContent, useDemoStore } from "@/lib/mock-store";
import type { BlogAuthor, BlogContentBlock, ContentItem, MediaAsset } from "@/lib/contracts";
import { ModuleShell } from "./shared/module-shell";
import { MediaLibraryPicker } from "./shared/media-library-picker";
import { demoMode } from "@/lib/demo-mode";
import { useAdminWebsiteData } from "@/lib/website/use-admin-data";
import { saveLiveContent } from "@/lib/website/actions";
import { slugify } from "@/lib/content";
import { BlogBody } from "@/components/blog-body";
import { BlogEditor, type BlogEditorHandle } from "./blog-editor";
import { blogBodyFromBlocks } from "@/lib/website/blog-blocks";

function editorBlocks(item?: ContentItem): BlogContentBlock[] {
  if (item?.contentBlocks?.length) {
    return [...item.contentBlocks]
      .sort((a, b) => a.order - b.order)
      .map((block, index) => ({ ...block, order: index + 1 }));
  }
  return [{ type: "text", text: item?.body ?? "", order: 1 }];
}

function normalizeItem(item?: ContentItem): ContentItem {
  if (!item) {
    return {
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
      contentBlocks: [{ type: "text", text: "", order: 1 }],
      extra: {},
    };
  }
  return { ...structuredClone(item), contentBlocks: editorBlocks(item) };
}

function orderBlocks(blocks: BlogContentBlock[]): BlogContentBlock[] {
  return blocks.map((block, index) => ({ ...block, order: index + 1 }));
}

export function BlogManager({
  id,
  state,
}: {
  id?: string;
  state?: string;
}) {
  const store = useDemoStore();
  const live = useAdminWebsiteData<ContentItem>("blog", []);
  const records = demoMode ? store.content.filter((c) => c.module === "Blog") : live.items;
  if (id) {
    const item = id === "new" ? undefined : records.find((c) => c.id === id && c.module === "Blog");
    if (id !== "new" && !item) {
      return (
        <Empty
          title={!demoMode && live.loading ? "Loading article…" : "Record not found"}
          body={live.error || (live.loading ? "Loading saved articles." : "This article is not available.")}
        />
      );
    }
    return <ArticleEditor key={item?.id || "new"} item={item} />;
  }
  const articles = state === "empty" ? [] : records;
  return (
    <>
      <ModuleShell
        title="Blog"
        description="Draft changes remain private until published."
        backHref="/admin/content"
        backLabel="Website Content"
        badge={<Link className="button" href="/admin/content/blog/new">New Article</Link>}
      />
      {!demoMode && live.loading ? (
        <Empty title="Loading articles…" body="Retrieving saved blog content." />
      ) : live.error && !demoMode ? (
        <Empty title="Articles could not be loaded" body={live.error} />
      ) : articles.length ? (
        <div className="grid two">
          {articles.map((article) => (
            <Link className="module-card" key={article.id} href={`/admin/content/blog/${article.id}`}>
              <div>
                <span className={`badge status-${article.published ? "published" : article.status === "Archived" ? "archived" : "draft"}`}>
                  {article.published
                    ? article.status === "Draft" ? "Published · draft changes" : "Published"
                    : article.status === "Archived" ? "Archived" : "Draft"}
                </span>
                <h2>{article.title || "Untitled draft"}</h2>
                <p>{article.summary}</p>
                {article.published && article.status === "Draft" && <small>Published version remains live</small>}
              </div>
              <span className="text-link">Edit Article</span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title="No articles yet. Create a draft to get started."
          body="Published articles appear on the public blog after publishing."
        />
      )}
    </>
  );
}

type MediaTarget = "featured" | "author" | "content";

function ArticleEditor({ item }: { item?: ContentItem }) {
  const store = useDemoStore();
  const mediaData = useAdminWebsiteData<MediaAsset>("media", [], { enabled: !demoMode });
  const [form, setForm] = useState<ContentItem>(() => normalizeItem(item));
  const [baseline, setBaseline] = useState(() => JSON.stringify(normalizeItem(item)));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [mediaTarget, setMediaTarget] = useState<MediaTarget | null>(null);
  const [uploadedMedia, setUploadedMedia] = useState<MediaAsset[]>([]);
  const editorRef = useRef<BlogEditorHandle | null>(null);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "archive" | "delete" | null>(null);
  const [deleted, setDeleted] = useState(false);
  const dirty = JSON.stringify(form) !== baseline;
  const published = !!form.published;
  const archived = form.status === "Archived";
  const showPublish = !published || dirty || form.status === "Draft";
  const canSaveDraft = dirty || !form.id;
  const libraryMedia = demoMode ? store.media : mediaData.items;
  const media = [
    ...uploadedMedia,
    ...libraryMedia.filter(
      (asset) => !uploadedMedia.some((extra) => extra.id === asset.id),
    ),
  ].filter((asset) => !asset.archived);

  function change(key: keyof ContentItem, value: unknown) {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "title" && !item ? { slug: slugify(String(value)) } : {}),
    }));
    setSuccess("");
  }

  function changeAuthor(key: keyof BlogAuthor, value: string) {
    setForm((current) => ({
      ...current,
      author: { ...(current.author ?? { name: "" }), [key]: value },
    }));
    setSuccess("");
  }

  function changeBlocks(nextBlocks: BlogContentBlock[]) {
    const contentBlocks = orderBlocks(nextBlocks);
    setForm((current) => ({
      ...current,
      contentBlocks,
      body: blogBodyFromBlocks(contentBlocks),
    }));
    setSuccess("");
  }

  function pickMedia(asset: MediaAsset, keepOpen = false) {
    if (mediaTarget === "featured") {
      setForm((current) => ({ ...current, image: asset.src, alt: asset.alt, imageMediaId: asset.id }));
    } else if (mediaTarget === "author") {
      setForm((current) => ({
        ...current,
        author: {
          ...(current.author ?? { name: "" }),
          image: asset.src,
          imageAlt: asset.alt,
          imageMediaId: asset.id,
        },
      }));
    } else {
      editorRef.current?.insertImage(asset);
    }
    if (!keepOpen) setMediaTarget(null);
    setSuccess("");
  }

  function handleUploadedMedia(asset: MediaAsset) {
    setUploadedMedia((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
    pickMedia(asset, true);
    if (!demoMode) void mediaData.refetch();
  }

  async function save(action: "draft" | "publish" | "archive" | "unpublish") {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const next = demoMode ? await saveContent(form, action) : await saveLiveContent(form, action);
      const normalized = normalizeItem(next);
      setForm(normalized);
      setBaseline(JSON.stringify(normalized));
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
    } catch (cause) {
      setError((cause as Error).message);
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
      if (!demoMode) throw new Error("Delete draft requires a separate confirmed action. Unpublish or archive the article instead.");
      await deleteContent(form.id);
      setConfirm(null);
      setDeleted(true);
    } catch (cause) {
      setError((cause as Error).message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  if (deleted) {
    return (
      <Empty title="Draft deleted">
        <Link className="button" href="/admin/content/blog">Return to Blog</Link>
      </Empty>
    );
  }

  const field = (key: "title" | "slug" | "summary" | "alt", label: string) => (
    <TextField
      id={`article-${key}`}
      label={label}
      value={form[key]}
      maxLength={key === "summary" ? 2000 : 254}
      onChange={(event) => change(key, event.target.value)}
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
        badge={<span className="badge">{dirty ? "Unsaved changes" : published ? form.status === "Draft" ? "Published · draft changes" : "Published" : form.status}</span>}
        error={error}
        success={success}
      />
      <form
        className="admin-columns"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save("draft");
        }}
      >
        <div className="panel form-stack">
          {field("title", "Title *")}
          {!item && <small>Website link: /blog/{form.slug || "your-article-name"} (created from the title)</small>}
          {field("summary", "Summary *")}
          <section className="form-stack">
            <h2>Article body</h2>
            <BlogEditor
              ref={editorRef}
              blocks={form.contentBlocks ?? editorBlocks(form)}
              onChange={changeBlocks}
              onRequestImage={() => setMediaTarget("content")}
            />
            <small>
              The featured image is optional and separate from the body. Images inserted into the
              canvas appear only where you place them, and HTML is never executed.
            </small>
          </section>
          <small>Newer articles appear first on the blog page after publishing.</small>
        </div>
        <div className="stack">
          <section className="panel form-stack">
            <h2>Featured Media</h2>
            {form.image && <Picture photo={{ src: form.image, alt: form.alt }} sizes="(max-width: 700px) 100vw, 420px" />}
            <button type="button" className="button secondary" onClick={() => setMediaTarget("featured")}>
              {form.image ? "Replace from Media Library" : "Select from Media Library"}
            </button>
            {form.image && <button type="button" className="button secondary" onClick={() => { setForm((current) => ({ ...current, image: "", alt: "", imageMediaId: undefined })); setSuccess(""); }}>Remove featured image</button>}
            {field("alt", form.image ? "Featured image alt text *" : "Featured image alt text")}
            {form.publishedAt && <small>First published {new Date(form.publishedAt).toLocaleDateString("en-GH", { dateStyle: "long", timeZone: "UTC" })}</small>}
          </section>
          <section className="panel form-stack">
            <h2>Author (optional)</h2>
            <TextField
              id="article-author-name"
              label="Author name"
              value={form.author?.name ?? ""}
              maxLength={160}
              onChange={(event) => changeAuthor("name", event.target.value)}
            />
            <Field id="article-author-bio" label="Biography (optional)">
              <textarea
                id="article-author-bio"
                value={form.author?.bio ?? ""}
                onChange={(event) => changeAuthor("bio", event.target.value)}
                rows={3}
                maxLength={2000}
              />
            </Field>
            {form.author?.image && <Picture photo={{ src: form.author.image, alt: form.author.imageAlt || form.author.name }} sizes="96px" />}
            <button type="button" className="button secondary" onClick={() => setMediaTarget("author")}>
              {form.author?.image ? "Replace profile image" : "Choose profile image"}
            </button>
          </section>
          <section className="panel form-stack">
            {showPublish ? (
              <>
                <button type="button" className="button" disabled={busy} onClick={() => setConfirm("publish")}>Publish</button>
                <button type="button" className="button secondary" disabled={busy || !canSaveDraft} onClick={() => void save("draft")}>Save Draft</button>
              </>
            ) : (
              <button type="submit" className="button" disabled={busy || !canSaveDraft}>Save Draft</button>
            )}
            <button type="button" className="button secondary" onClick={() => setPreview(true)}>Preview</button>
            {published && <button type="button" className="button secondary" disabled={busy} onClick={() => void save("unpublish")}>Unpublish</button>}
            {form.id && !archived && <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirm("archive")}>Archive</button>}
            {form.id && !published && <button type="button" className="button danger" disabled={busy} onClick={() => setConfirm("delete")}>Delete Draft</button>}
            <Link className="button secondary" href="/admin/content/blog">Cancel</Link>
          </section>
        </div>
      </form>
      <MediaLibraryPicker
        open={!!mediaTarget}
        title={mediaTarget === "author" ? "Select Author Profile Image" : mediaTarget === "content" ? "Insert Article Image" : "Select Featured Image"}
        selectLabel={mediaTarget === "author" ? "Use as profile image" : mediaTarget === "content" ? "Insert image" : "Use as featured image"}
        assets={media}
        loading={!demoMode && mediaData.loading}
        error={!demoMode ? mediaData.error : ""}
        onRetry={() => void mediaData.refetch()}
        onSelect={(asset) => pickMedia(asset)}
        onUploaded={handleUploadedMedia}
        onClose={() => setMediaTarget(null)}
        insertOnUpload={mediaTarget === "content"}
      />
      <Dialog open={preview} onClose={() => setPreview(false)} title="Article preview">
        <article className="article blog-preview">
          <h2>{form.title || "Untitled draft"}</h2>
          <p className="lead">{form.summary}</p>
          {form.author?.name && <p className="blog-preview__author">By {form.author.name}</p>}
          {form.image && <Picture photo={{ src: form.image, alt: form.alt }} sizes="(max-width: 700px) 100vw, 760px" />}
          <BlogBody body={form.body} contentBlocks={form.contentBlocks} />
        </article>
      </Dialog>
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === "publish" ? "Publish this article?" : confirm === "archive" ? "Archive this article?" : "Delete this draft?"}
      >
        <p>
          {confirm === "publish"
            ? "It will become visible on the website."
            : confirm === "archive"
              ? "It will be removed from the website."
              : "This removes the unpublished draft from the demo workspace."}
        </p>
        <div className="actions">
          <button type="button" className="button secondary" onClick={() => setConfirm(null)}>Cancel</button>
          <button type="button" className={confirm === "delete" ? "button danger" : "button"} disabled={busy} onClick={() => void confirmAction()}>
            {confirm === "publish" ? "Publish" : confirm === "archive" ? "Archive" : "Delete Draft"}
          </button>
        </div>
      </Dialog>
    </>
  );
}
