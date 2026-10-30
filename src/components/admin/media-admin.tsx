"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { deleteMedia, saveMedia, useDemoStore } from "@/lib/mock-store";
import type { MediaAsset } from "@/lib/contracts";
import { uploadError } from "@/lib/rules";
import { Empty, Heading, Picture } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import {
  DemoFailure,
  Field,
  Notice,
  Submit,
  TextField,
} from "@/components/forms/controls";
import { demoMode } from "@/lib/demo-mode";
import { deleteLiveMedia, saveLiveMedia } from "@/lib/website/actions";
import { useAdminWebsiteData } from "@/lib/website/use-admin-data";
import { optimizeImage } from "@/lib/images/optimize";

export function MediaAdmin({ id, state }: { id?: string; state?: string }) {
  const store = useDemoStore();
  const live = useAdminWebsiteData<MediaAsset>("media", []);
  const [query, setQuery] = useState("");
  if (id === "upload") return <MediaEditor />;
  if (id) {
    const asset = (demoMode ? store.media : live.items).find((media) => media.id === id);
    if (!demoMode && live.loading && !asset) {
      return <div className="panel" role="status">Loading Media Library…</div>;
    }
    if (!demoMode && live.error) return <Notice error>{live.error}</Notice>;
    return asset ? <MediaEditor key={asset.id} asset={asset} /> : <Empty title="Record not found" />;
  }
  const assets = (demoMode ? store.media : live.items).filter(
    state === "empty"
      ? () => false
      : (media) =>
        !media.archived &&
        `${media.name} ${media.alt}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Heading title="Media Library">
        <Link className="button" href="/admin/media/upload">
          <Upload size={18} />
          Upload Media
        </Link>
      </Heading>
      <Notice>
        Marketing assets only. Customer booking photos remain strictly private
        and are never displayed in the marketing library.
      </Notice>
      {!demoMode && live.loading && <div className="panel" role="status">Loading Media Library…</div>}
      {!demoMode && live.error && <Notice error>{live.error}</Notice>}
      <TextField
        id="media-search"
        label="Search media"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {!demoMode && (live.loading || live.error) ? null : assets.length ? (
        <div className="grid three media-grid">
          {assets.map((media) => (
            <Link className="service-card" href={`/admin/media/${media.id}`} key={media.id}>
              <Picture
                photo={{ src: media.src, alt: media.alt }}
                sizes="(max-width: 700px) 100vw, (max-width: 1100px) 33vw, 360px"
              />
              <div className="card-body">
                <h3>{media.name}</h3>
                <p>{media.alt}</p>
                <span className="badge">{media.uses.length ? "In use" : "Available"}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="No marketing media uploaded yet.">
          <Link className="button" href="/admin/media/upload">
            Upload Media
          </Link>
          <small>WebP, JPEG, PNG · Maximum file size: 5MB per file</small>
        </Empty>
      )}
    </>
  );
}

function MediaEditor({ asset }: { asset?: MediaAsset }) {
  const router = useRouter();
  const [form, setForm] = useState<MediaAsset>(
    asset
      ? { ...asset }
      : {
        id: "",
        src: "",
        name: "",
        alt: "",
        caption: "",
        source: "",
        permission: "",
        uses: [],
        archived: false,
      },
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const staged = useRef("");
  const selectedFile = useRef<File | null>(null);
  const committed = useRef(false);
  const generatedAlt = useRef("");

  useEffect(
    () => () => {
      abort.current?.abort();
      if (staged.current && !committed.current) URL.revokeObjectURL(staged.current);
    },
    [],
  );

  function select(file?: File) {
    if (!file) return;
    const validationError = uploadError([file], 1);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (staged.current && !committed.current) URL.revokeObjectURL(staged.current);
    const src = URL.createObjectURL(file);
    staged.current = src;
    selectedFile.current = file;
    committed.current = false;
    const suggestedAlt = file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    generatedAlt.current = suggestedAlt;
    setForm((current) => ({
      ...current,
      src,
      name: file.name,
      alt: current.alt || suggestedAlt,
    }));
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!form.src || !form.alt.trim()) {
      setError("Complete the required fields before uploading.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    const task = new AbortController();
    abort.current = task;
    try {
      let next = { ...form, id: form.id || crypto.randomUUID() };
      if (demoMode) {
        setStatus("Saving…");
        await saveMedia(next, task.signal);
      } else {
        const file = selectedFile.current;
        if (file) {
          setStatus("Optimizing…");
          const optimized = await optimizeImage(file);
          if (task.signal.aborted) return;
          setStatus("Uploading…");
          const upload = new FormData();
          upload.set("file", optimized);
          const response = await fetch("/api/admin/website-media", {
            method: "POST",
            body: upload,
            signal: task.signal,
          });
          let body: { publicUrl?: string; message?: string };
          try {
            body = (await response.json()) as { publicUrl?: string; message?: string };
          } catch {
            throw new Error("The image could not be uploaded.");
          }
          if (!response.ok || !body.publicUrl) {
            throw new Error(body.message || "The image could not be uploaded.");
          }
          next = { ...next, src: body.publicUrl };
        } else {
          setStatus("Saving changes…");
        }
        next = await saveLiveMedia(next, form.id ? form.version : undefined);
      }
      if (task.signal.aborted) return;
      setForm(next);
      committed.current = true;
      selectedFile.current = null;
      setSuccess("Changes saved.");
    } catch (cause) {
      if (!task.signal.aborted) setError((cause as Error).message);
    } finally {
      if (abort.current === task) {
        abort.current = null;
        setBusy(false);
        setStatus("");
      }
    }
  }

  return (
    <>
      <Link href="/admin/media" className="back-link">← Media Library</Link>
      <Heading title={asset ? "Media Details" : "Media Upload"} />
      {error && <Notice error>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      <form onSubmit={submit} className="admin-columns">
        <section className="panel form-stack">
          {form.src ? (
            <Picture
              photo={{ src: form.src, alt: form.alt || "Selected media preview" }}
              sizes="(max-width: 700px) 100vw, 50vw"
            />
          ) : (
            <div className="upload-placeholder"><Upload size={36} /></div>
          )}
          <Field id="upload-media" label={asset ? "Replace Media" : "Select file"}>
            <input
              id="upload-media"
              type="file"
              accept="image/webp,image/jpeg,image/png"
              disabled={busy}
              onChange={(event) => select(event.target.files?.[0])}
            />
          </Field>
          <small>Supported formats: WebP, JPEG, PNG · Maximum file size: 5MB per file</small>
          {form.name && <p>{form.name}</p>}
          {busy && (
            <>
              <p role="status" aria-live="polite">{status}</p>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  abort.current?.abort();
                  setStatus("Cancelling…");
                }}
              >
                Cancel Upload
              </button>
            </>
          )}
          {asset?.uses.length ? (
            <div>
              <h3>Used on</h3>
              {asset.uses.map((usage) => <p key={usage}>{usage}</p>)}
            </div>
          ) : null}
        </section>
        <section className="panel form-stack">
          {(["caption", "alt"] as const).map((key) => (
            <TextField
              key={key}
              id={`media-${key}`}
              label={key === "caption" ? "Caption" : "Alt text *"}
              value={form[key]}
              disabled={busy}
              maxLength={1000}
              onChange={(event) => {
                const value = event.target.value;
                setForm((current) => ({
                  ...current,
                  [key]: value,
                  ...(key === "caption" && (!current.alt.trim() || current.alt === generatedAlt.current)
                    ? { alt: value }
                    : {}),
                }));
                if (key === "caption") generatedAlt.current = value;
              }}
            />
          ))}
          <Submit
            busy={busy}
            label={asset ? "Save Changes" : "Upload Media"}
            busyLabel={status || "Saving…"}
          />
          {asset && (
            <>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    if (demoMode) await saveMedia({ ...form, archived: true });
                    else await saveLiveMedia({ ...form, archived: true }, asset.version);
                    router.push("/admin/media");
                  } catch (cause) {
                    setError((cause as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Archive Media
              </button>
              <button type="button" className="button danger" disabled={busy} onClick={() => setConfirm(true)}>
                Delete Media
              </button>
            </>
          )}
          <Link href="/admin/media" className="button secondary">Cancel</Link>
          <DemoFailure />
        </section>
      </form>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Delete Media">
        <p>Permanently remove this asset from the library?</p>
        <div className="actions">
          <button className="button secondary" onClick={() => setConfirm(false)}>Cancel</button>
          <button
            className="button danger"
            disabled={busy}
            onClick={async () => {
              if (!asset) return;
              setBusy(true);
              setError("");
              try {
                if (demoMode) await deleteMedia(asset.id);
                else await deleteLiveMedia(asset.id, asset.uses);
                router.push("/admin/media");
              } catch (cause) {
                setError((cause as Error).message);
                setConfirm(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete Media
          </button>
        </div>
      </Dialog>
    </>
  );
}
