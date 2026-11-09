"use client";
import Link from "next/link";
import { useState } from "react";
import { Empty, Picture } from "@/components/ui";
import { Field, TextField } from "@/components/forms/controls";
import { Dialog } from "@/components/dialog";
import { UnsavedGuard } from "../unsaved";
import { deleteContent, saveContent, useDemoStore } from "@/lib/mock-store";
import type { ContentItem, MediaAsset } from "@/lib/contracts";
import { ModuleShell } from "./shared/module-shell";
import { MediaLibraryPicker } from "./shared/media-library-picker";
import { demoMode } from "@/lib/demo-mode";
import { useAdminWebsiteData } from "@/lib/website/use-admin-data";
import { saveLiveService } from "@/lib/website/actions";
import { seededServices } from "@/lib/website/types";
import { slugify } from "@/lib/content";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function ServicesManager({
  id,
  state,
}: {
  id?: string;
  state?: string;
}) {
  const store = useDemoStore();
  const live = useAdminWebsiteData<ContentItem>("services", seededServices);
  const records = demoMode ? store.content.filter(c=>c.module==="Services") : live.items;
  if (id) {
    const item =
      id === "new"
        ? undefined
        : records.find((c) => c.id === id && c.module === "Services");
    if (id !== "new" && !item)
      return (
        <Empty
          title={!demoMode && live.loading ? "Loading service…" : "Record not found"}
          body={
            live.error ||
            (live.loading
              ? "Retrieving the saved service."
              : "This service is not available.")
          }
        />
      );
    return <ServiceEditor key={item?.id || "new"} item={item} />;
  }
  const services =
    state === "empty" ? [] : records;
  return (
    <>
      <ModuleShell
        title="Services"
        description="Catalogue records for each public service. Published services appear on the public website."
        backHref="/admin/content"
        backLabel="Website Content"
        badge={
          <Link className="button" href="/admin/content/services/new">
            New Service
          </Link>
        }
      />
      {!demoMode && live.loading ? (
        <Empty title="Loading services…" body="Retrieving saved services." />
      ) : !demoMode && live.error ? (
        <Empty title="Services could not be loaded" body={live.error} />
      ) : services.length ? (
        <div className="grid two">
          {services.map((service) => (
            <Link
              className="module-card"
              key={service.id}
              href={`/admin/content/services/${service.id}`}
            >
              <div>
                <span className={`badge status-${service.published ? "published" : service.status === "Archived" ? "archived" : "draft"}`}>
                  {service.published
                    ? "Published"
                    : service.status === "Archived"
                      ? "Archived"
                      : "Draft"}
                </span>
                <h2>{service.title || "Untitled draft"}</h2>
                <p>{service.summary}</p>
              </div>
              <span className="text-link">Edit Service</span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title="No services yet. Create a draft to get started."
          body="Published services appear on the public website and in the booking catalogue."
        />
      )}
    </>
  );
}
function ServiceEditor({ item }: { item?: ContentItem }) {
  const store = useDemoStore();
  const mediaData = useAdminWebsiteData<MediaAsset>("media", [], {
    enabled: !demoMode,
  });
  const empty: ContentItem = {
    id: "",
    module: "Services",
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
  const [uploadedMedia, setUploadedMedia] = useState<MediaAsset[]>([]);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState<
    "publish" | "archive" | "delete" | null
  >(null);
  const [deleted, setDeleted] = useState(false);
  const dirty = JSON.stringify(form) !== baseline;
  const published = !!form.published;
  const archived = form.status === "Archived";
  const canSave = dirty || !form.id;
  const libraryMedia = demoMode ? store.media : mediaData.items;
  const mediaAssets = [
    ...uploadedMedia,
    ...libraryMedia.filter(
      (asset) => !uploadedMedia.some((extra) => extra.id === asset.id),
    ),
  ].filter((asset) => !asset.archived);

  function change(key: keyof ContentItem, value: unknown) {
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === "title" && !item ? { slug: slugify(String(value)) } : {}),
    }));
    setSuccess("");
  }

  function pickMedia(asset: MediaAsset) {
    setForm((f) => ({ ...f, image: asset.src, alt: asset.alt }));
    setMedia(false);
    setSuccess("");
  }

  function handleUploadedMedia(asset: MediaAsset) {
    setUploadedMedia((current) => [
      asset,
      ...current.filter((entry) => entry.id !== asset.id),
    ]);
    setForm((f) => ({ ...f, image: asset.src, alt: asset.alt }));
    setSuccess("");
    if (!demoMode) void mediaData.refetch();
  }

  function validationMessage(
    action: "draft" | "publish" | "archive" | "unpublish",
  ): string {
    if (!form.title.trim()) return "Enter a title for this service.";
    if (!form.slug.trim()) return "Enter a slug for this service.";
    if (!SLUG_PATTERN.test(form.slug))
      return "Use lowercase letters, numbers and hyphens for the slug.";
    if (action === "publish" && !form.summary.trim())
      return "Add a summary before publishing this service.";
    if (action === "publish" && form.image && !form.alt.trim())
      return "Add alt text to the featured image before publishing.";
    return "";
  }

  async function save(action: "draft" | "publish" | "archive" | "unpublish") {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    const validation = validationMessage(action);
    if (validation) {
      setError(validation);
      setConfirm(null);
      setBusy(false);
      return;
    }
    try {
      const next = demoMode ? await saveContent(form, action) : await saveLiveService(form, action);
      setForm(next);
      setBaseline(JSON.stringify(next));
      setSuccess(
        action === "publish"
          ? "Service published."
          : action === "unpublish"
            ? "Service unpublished. The record is retained."
            : action === "archive"
              ? "Service archived."
              : published
                ? "Changes saved. The published service is up to date."
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
      if (!demoMode) throw new Error("Existing operational services cannot be deleted here.");
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
        <Link className="button" href="/admin/content/services">
          Return to Services
        </Link>
      </Empty>
    );
  const field = (
    key: "title" | "slug" | "summary" | "alt",
    label: string,
  ) => (
    <TextField
      id={`service-${key}`}
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
        title={item ? "Edit Service" : "New Service"}
        description={form.title || undefined}
        backHref="/admin/content/services"
        backLabel="Services"
        badge={
          <span className="badge">
            {dirty ? "Unsaved changes" : published ? "Published" : form.status}
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
          {!item && (
            <small>
              Website link: /services/{form.slug || "your-service-name"}
            </small>
          )}
          {field("summary", "Summary *")}
          <Field id="service-body" label="Body">
            <textarea
              id="service-body"
              value={form.body}
              onChange={(e) => change("body", e.target.value)}
              rows={14}
              maxLength={50000}
            />
          </Field>
          <small>
            Plain text with paragraph breaks. HTML is not executed. New services
            display this body on their public page.
          </small>
          <TextField
            id="service-sort"
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
              {form.image ? "Replace from Media Library" : "Select from Media Library"}
            </button>
            {form.image && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setForm((f) => ({ ...f, image: "", alt: "" }));
                  setSuccess("");
                }}
              >
                Remove featured image
              </button>
            )}
            {field("alt", form.image ? "Alt text *" : "Alt text")}
          </section>
          <section className="panel form-stack">
            {published ? (
              <>
                <button
                  type="button"
                  className="button"
                  disabled={busy || !canSave}
                  onClick={() => void save("draft")}
                >
                  Save changes
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void save("unpublish")}
                >
                  Unpublish
                </button>
              </>
            ) : (
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
                  disabled={busy || !canSave}
                  onClick={() => void save("draft")}
                >
                  Save Draft
                </button>
              </>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() => setPreview(true)}
            >
              Preview
            </button>
            {demoMode && form.id && !archived && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setConfirm("archive")}
              >
                Archive
              </button>
            )}
            {demoMode && form.id && !published && (
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
              href="/admin/content/services"
            >
              Cancel
            </Link>
          </section>
        </div>
      </form>
      <MediaLibraryPicker
        open={media}
        title="Select Featured Image"
        selectLabel="Use as featured image"
        assets={mediaAssets}
        loading={!demoMode && mediaData.loading}
        error={!demoMode ? mediaData.error : ""}
        onRetry={() => void mediaData.refetch()}
        onSelect={pickMedia}
        onUploaded={handleUploadedMedia}
        onClose={() => setMedia(false)}
      />
      <Dialog
        open={preview}
        onClose={() => setPreview(false)}
        title="Service preview"
      >
        <h2>{form.title || "Untitled draft"}</h2>
        <p>{form.summary}</p>
        {form.image && <Picture photo={{ src: form.image, alt: form.alt }} />}
        <div className="prose">{form.body}</div>
        <p className="demo-caption">
          Preview only. Save to update the public website.
        </p>
      </Dialog>
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={
          confirm === "publish"
            ? "Publish this service?"
            : confirm === "archive"
              ? "Archive this service?"
              : "Delete this draft?"
        }
      >
        <p>
          {confirm === "publish"
            ? "The service will become visible on the public website."
            : confirm === "archive"
              ? "The service will be marked archived in this demo workspace."
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
