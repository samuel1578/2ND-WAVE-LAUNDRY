"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Empty, Picture } from "@/components/ui";
import { DemoFailure, Field, Notice, TextField } from "@/components/forms/controls";
import { Dialog } from "@/components/dialog";
import { UnsavedGuard } from "../unsaved";
import { deleteContent, saveContent, useDemoStore } from "@/lib/mock-store";
import type { BlogAuthor, BlogContentBlock, ContentItem, MediaAsset } from "@/lib/contracts";
import { MediaLibraryPicker } from "./shared/media-library-picker";
import { ModuleShell } from "./shared/module-shell";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Eye,
  FileText,
  Image as ImageIcon,
  Link2,
  Save,
  Send,
  UserRound,
} from "lucide-react";
import styles from "./blog-manager.module.css";
import { demoMode } from "@/lib/demo-mode";
import { useAdminWebsiteData } from "@/lib/website/use-admin-data";
import { deleteLiveBlog, saveLiveContent } from "@/lib/website/actions";
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
  return (
    <BlogIndex
      records={records}
      state={state}
      loading={!demoMode && live.loading}
      loadError={demoMode ? "" : live.error}
      refresh={() => live.refetch()}
    />
  );
}

/**
 * Article index with a permanent delete action on every card.
 *
 * The listing itself owns the confirmation dialog and the notices so a delete
 * updates the grid in place: the record disappears, the refreshed list is
 * fetched again and the outcome is reported at the top of the module.
 */
function BlogIndex({
  records,
  state,
  loading,
  loadError,
  refresh,
}: {
  records: ContentItem[];
  state?: string;
  loading: boolean;
  loadError: string;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ContentItem | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const articles = state === "empty" ? [] : records;
  const pendingLabel = pending?.title?.trim() || "Untitled draft";

  async function confirmDelete() {
    if (busy || !pending) return;
    const target = pending;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (demoMode) await deleteContent(target.id);
      else await deleteLiveBlog(target);
      setPending(null);
      setSuccess(`"${pendingLabel}" was permanently deleted.`);
      await refresh();
    } catch (cause) {
      setPending(null);
      setError(
        (cause as Error).message || "The article could not be deleted. Reload and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ModuleShell
        title="Blog"
        description="Draft changes remain private until published."
        backHref="/admin/content"
        backLabel="Website Content"
        badge={<Link className="button" href="/admin/content/blog/new">New Article</Link>}
        error={error}
        success={success}
      />
      {loading ? (
        <Empty title="Loading articles…" body="Retrieving saved blog content." />
      ) : loadError ? (
        <Empty title="Articles could not be loaded" body={loadError} />
      ) : articles.length ? (
        <div className="grid two">
          {articles.map((article) => (
            <div className="module-card" key={article.id}>
              <Link className="module-card__link" href={`/admin/content/blog/${article.id}`}>
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
              <div className="module-card__actions">
                <button
                  type="button"
                  className="button danger"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setSuccess("");
                    setPending(article);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title="No articles yet. Create a draft to get started."
          body="Published articles appear on the public blog after publishing."
        />
      )}
      <Dialog
        open={!!pending}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        title="Delete this article?"
      >
        <p>
          Permanently delete &ldquo;{pendingLabel}&rdquo;? It is removed from the website
          and from this article list.
        </p>
        <p>
          Images used by this article stay in the Media Library, because other
          content may still use them.
        </p>
        <div className="actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() => void confirmDelete()}
          >
            {busy ? "Deleting…" : "Delete Article"}
          </button>
        </div>
      </Dialog>
    </>
  );
}

type MediaTarget = "featured" | "author" | "content";

function ArticleEditor({ item }: { item?: ContentItem }) {
  const router = useRouter();
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
    if (busy) return;
    if (confirm === "publish") return void (await save("publish"));
    if (confirm === "archive") return void (await save("archive"));
    setBusy(true);
    setError("");
    try {
      if (demoMode) {
        await deleteContent(form.id);
        setConfirm(null);
        setDeleted(true);
      } else {
        await deleteLiveBlog(form);
        setConfirm(null);
        router.push("/admin/content/blog?notice=blog-deleted");
      }
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
      <div className={styles.blogAdmin}>
      <UnsavedGuard dirty={dirty} />
      <header className={styles.pageHeader}>
        <div className={styles.breadcrumbs} aria-label="Breadcrumb">
          <Link href="/admin/content">Website Content</Link><ChevronRight aria-hidden="true" />
          <Link href="/admin/content/blog">Blog</Link><ChevronRight aria-hidden="true" />
          <span>{item ? "Edit Article" : "Create Article"}</span>
        </div>
        <div className={styles.headingRow}>
          <div className={styles.headingCopy}>
            <span className={styles.headingIcon}><FileText aria-hidden="true" /></span>
            <div>
              <h1>{item ? "Edit Blog Article" : "Create Blog Article"}</h1>
              <p>{item ? "Update and manage your article." : "Publish a new article to your website blog."}</p>
              <span className={styles.statusLine}>{dirty ? "Unsaved changes" : published ? form.status === "Draft" ? "Published · draft changes" : "Published" : form.status}</span>
            </div>
          </div>
          <nav className={styles.headerActions} aria-label="Article actions">
            <Link className={`${styles.actionButton} ${styles.secondaryAction}`} href="/admin/content/blog">Cancel</Link>
            <button type="button" className={`${styles.actionButton} ${styles.secondaryAction}`} disabled={busy || !canSaveDraft} onClick={() => void save("draft")}><Save aria-hidden="true" />Save Draft</button>
            <button type="button" className={`${styles.actionButton} ${styles.secondaryAction}`} onClick={() => setPreview(true)}><Eye aria-hidden="true" />Preview</button>
            {showPublish && <button type="button" className={`${styles.actionButton} ${styles.primaryAction}`} disabled={busy} onClick={() => setConfirm("publish")}><Send aria-hidden="true" />Publish</button>}
          </nav>
        </div>
      </header>
      {error && <Notice error>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      <form
        className={styles.editorLayout}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save("draft");
        }}
      >
        <section className={`${styles.card} ${styles.articleCard}`} aria-labelledby="article-details-heading">
          <h2 id="article-details-heading">Article Details</h2>
          {field("title", "Title *")}
          <TextField
            id="article-slug"
            label="Website URL / slug"
            value={form.slug}
            maxLength={254}
            onChange={(event) => change("slug", slugify(event.target.value))}
          />
          <small className={styles.slugHelp}><Link2 aria-hidden="true" /> Your article URL: /blog/{form.slug || "your-article-name"}</small>
          <Field id="article-summary" label="Summary *">
            <textarea
              id="article-summary"
              value={form.summary}
              onChange={(event) => change("summary", event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="A short summary that appears in the blog list and previews."
            />
            <span className={styles.characterCount}>{form.summary.length} / 2000</span>
          </Field>
          <div className={styles.articleBody}>
            <div className={styles.sectionDivider} />
            <h2>Article Body</h2>
            <BlogEditor
              ref={editorRef}
              blocks={form.contentBlocks ?? editorBlocks(form)}
              onChange={changeBlocks}
              onRequestImage={() => setMediaTarget("content")}
            />
            <small className={styles.editorHint}>
              The featured image is optional and separate from the body. Images inserted into the
              canvas appear only where you place them, and HTML is never executed.
            </small>
            <small className={styles.editorHint}>Newer articles appear first on the blog page after publishing.</small>
          </div>
        </section>
        <aside className={styles.sidebar} aria-label="Article settings">
          <section className={`${styles.card} ${styles.sidebarCard}`} aria-labelledby="publication-heading">
            <h2 id="publication-heading"><CalendarDays aria-hidden="true" />Publication</h2>
            <button type="button" className={`${styles.publishChoice} ${!published ? styles.choiceSelected : ""}`} disabled={busy} onClick={() => setConfirm("publish")}>
              <span className={styles.choiceRadio}>{!published && <span />}</span><span><strong>Publish now</strong><small>{published ? "Article is live" : "Make this article public"}</small></span><ArrowRight aria-hidden="true" />
            </button>
            <button type="button" className={`${styles.publishChoice} ${published ? styles.choiceSelected : ""}`} disabled={busy || !canSaveDraft} onClick={() => void save("draft")}>
              <span className={styles.choiceRadio}>{published && <span />}</span><span><strong>Save as draft</strong><small>Keep this article unpublished</small></span><Save aria-hidden="true" />
            </button>
            {published && <small className={styles.publishedAt}>First published {form.publishedAt ? new Date(form.publishedAt).toLocaleDateString("en-GH", { dateStyle: "long", timeZone: "UTC" }) : ""}</small>}
          </section>
          <section className={`${styles.card} ${styles.sidebarCard}`} aria-labelledby="featured-heading">
            <h2 id="featured-heading"><ImageIcon aria-hidden="true" />Featured Media</h2>
            {form.image ? (
              <div className={styles.featuredPreview}>
                <Picture photo={{ src: form.image, alt: form.alt }} sizes="(max-width: 700px) 100vw, 420px" />
                <button type="button" className={styles.replaceMedia} onClick={() => setMediaTarget("featured")}>Change image</button>
              </div>
            ) : (
              <button type="button" className={styles.mediaDropzone} onClick={() => setMediaTarget("featured")}>
                <ImageIcon aria-hidden="true" /><strong>Select from Media Library</strong><span>Choose an image for your article</span><small>Recommended: 1200 × 630</small>
              </button>
            )}
            {form.image && <button type="button" className={`${styles.actionButton} ${styles.secondaryAction} ${styles.fullButton}`} onClick={() => { setForm((current) => ({ ...current, image: "", alt: "", imageMediaId: undefined })); setSuccess(""); }}>Remove featured image</button>}
            {field("alt", form.image ? "Featured image alt text *" : "Featured image alt text")}
          </section>
          <section className={`${styles.card} ${styles.sidebarCard}`} aria-labelledby="author-heading">
            <h2 id="author-heading"><UserRound aria-hidden="true" />Author <span>(Optional)</span></h2>
            <TextField
              id="article-author-name"
              label="Author name"
              value={form.author?.name ?? ""}
              maxLength={160}
              onChange={(event) => changeAuthor("name", event.target.value)}
              placeholder="Enter author name"
            />
            <Field id="article-author-bio" label="Biography">
              <textarea
                id="article-author-bio"
                value={form.author?.bio ?? ""}
                onChange={(event) => changeAuthor("bio", event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="A short bio about the author"
              />
              <span className={styles.characterCount}>{(form.author?.bio ?? "").length} / 2000</span>
            </Field>
            {form.author?.image && <div className={styles.authorPreview}><Picture photo={{ src: form.author.image, alt: form.author.imageAlt || form.author.name }} sizes="96px" /></div>}
            <button type="button" className={`${styles.actionButton} ${styles.secondaryAction} ${styles.fullButton}`} onClick={() => setMediaTarget("author")}>
              <UserRound aria-hidden="true" />{form.author?.image ? "Replace profile image" : "Choose profile image"}
            </button>
          </section>
          <section className={`${styles.card} ${styles.sidebarCard} ${styles.moreActions}`} aria-label="More article actions">
            {published && <button type="button" className={`${styles.actionButton} ${styles.secondaryAction} ${styles.fullButton}`} disabled={busy} onClick={() => void save("unpublish")}>Unpublish</button>}
            {form.id && !archived && <button type="button" className={`${styles.actionButton} ${styles.secondaryAction} ${styles.fullButton}`} disabled={busy} onClick={() => setConfirm("archive")}>Archive</button>}
            {demoMode && form.id && !published && <button type="button" className={`${styles.actionButton} ${styles.dangerAction} ${styles.fullButton}`} disabled={busy} onClick={() => setConfirm("delete")}>Delete Draft</button>}
            {form.id && !demoMode && <button type="button" className={`${styles.actionButton} ${styles.dangerAction} ${styles.fullButton}`} disabled={busy} onClick={() => setConfirm("delete")}>Delete Article</button>}
          </section>
        </aside>
      </form>
      <DemoFailure />
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
        title={
          confirm === "publish"
            ? "Publish this article?"
            : confirm === "archive"
              ? "Archive this article?"
              : "Delete this article?"
        }
      >
        <p>
          {confirm === "publish"
            ? "It will become visible on the website."
            : confirm === "archive"
              ? "It will be removed from the website."
              : demoMode
                ? "This removes the unpublished draft from the demo workspace."
                : `Permanently remove "${form.title || "Untitled draft"}" from the website and the article list? Images stay in the Media Library.`}
        </p>
        <div className="actions">
          <button type="button" className="button secondary" onClick={() => setConfirm(null)}>Cancel</button>
          <button type="button" className={confirm === "delete" ? "button danger" : "button"} disabled={busy} onClick={() => void confirmAction()}>
            {confirm === "publish" ? "Publish" : confirm === "archive" ? "Archive" : demoMode ? "Delete Draft" : "Delete Article"}
          </button>
        </div>
      </Dialog>
      </div>
    </>
  );
}
