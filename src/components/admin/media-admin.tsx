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
export function MediaAdmin({ id, state }: { id?: string; state?: string }) {
  const store = useDemoStore();
  const [query, setQuery] = useState("");
  if (id === "upload") return <MediaEditor />;
  if (id) {
    const asset = store.media.find((m) => m.id === id);
    return asset ? (
      <MediaEditor key={asset.id} asset={asset} />
    ) : (
      <Empty title="Record not found" />
    );
  }
  const assets =
    state === "empty"
      ? []
      : store.media.filter(
          (m) =>
            !m.archived &&
            `${m.name} ${m.alt}`.toLowerCase().includes(query.toLowerCase()),
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
      <TextField
        id="media-search"
        label="Search media"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {assets.length ? (
        <div className="grid three media-grid">
          {assets.map((m) => (
            <Link
              className="service-card"
              href={`/admin/media/${m.id}`}
              key={m.id}
            >
              <Picture photo={{ src: m.src, alt: m.alt }} />
              <div className="card-body">
                <h3>{m.name}</h3>
                <p>{m.alt}</p>
                <span className="badge">
                  {m.uses.length ? "In use" : "Available"}
                </span>
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
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const staged = useRef("");
  const committed = useRef(false);
  useEffect(
    () => () => {
      abort.current?.abort();
      if (staged.current && !committed.current)
        URL.revokeObjectURL(staged.current);
    },
    [],
  );
  function select(file?: File) {
    if (!file) return;
    const error = uploadError([file], 1);
    if (error) {
      setError(error);
      return;
    }
    if (staged.current && !committed.current)
      URL.revokeObjectURL(staged.current);
    const src = URL.createObjectURL(file);
    staged.current = src;
    committed.current = false;
    setForm((f) => ({ ...f, src, name: file.name }));
    setError("");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (
      !form.src ||
      !form.alt.trim() ||
      !form.source.trim() ||
      !form.permission.trim()
    ) {
      setError("Complete the required fields before uploading.");
      return;
    }
    setBusy(true);
    setError("");
    const task = new AbortController();
    abort.current = task;
    try {
      for (let p = 20; p <= 80; p += 20) {
        await new Promise((r) => setTimeout(r, 120));
        if (task.signal.aborted) return;
        setProgress(p);
      }
      const next = { ...form, id: form.id || crypto.randomUUID() };
      await saveMedia(next, task.signal);
      if (task.signal.aborted) return;
      setForm(next);
      committed.current = true;
      setProgress(100);
      setSuccess("Changes saved.");
    } catch (e) {
      if (!task.signal.aborted) setError((e as Error).message);
    } finally {
      if (abort.current === task) setBusy(false);
    }
  }
  return (
    <>
      <Link href="/admin/media" className="back-link">
        ← Media Library
      </Link>
      <Heading title={asset ? "Media Details" : "Media Upload"} />
      {error && <Notice error>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      <form onSubmit={submit} className="admin-columns">
        <section className="panel form-stack">
          {form.src ? (
            <Picture
              photo={{
                src: form.src,
                alt: form.alt || "Selected media preview",
              }}
            />
          ) : (
            <div className="upload-placeholder">
              <Upload size={36} />
            </div>
          )}
          <Field
            id="upload-media"
            label={asset ? "Replace Media" : "Select file"}
          >
            <input
              id="upload-media"
              type="file"
              accept="image/webp,image/jpeg,image/png"
              disabled={busy}
              onChange={(e) => select(e.target.files?.[0])}
            />
          </Field>
          <small>
            Supported formats: WebP, JPEG, PNG · Maximum file size: 5MB per file
          </small>
          {form.name && <p>{form.name}</p>}
          {busy && (
            <>
              <label htmlFor="upload-progress">Preparing local preview…</label>
              <progress id="upload-progress" max="100" value={progress} />
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  abort.current?.abort();
                  setBusy(false);
                  setProgress(0);
                }}
              >
                Cancel Upload
              </button>
            </>
          )}
          {asset?.uses.length ? (
            <div>
              <h3>Used on</h3>
              {asset.uses.map((u) => (
                <p key={u}>{u}</p>
              ))}
            </div>
          ) : null}
        </section>
        <section className="panel form-stack">
          {(["alt", "caption", "source", "permission"] as const).map((key) => (
            <TextField
              key={key}
              id={`media-${key}`}
              label={
                {
                  alt: "Alt text *",
                  caption: "Caption",
                  source: "Source *",
                  permission: "Usage permission *",
                }[key]
              }
              value={form[key]}
              disabled={busy}
              maxLength={1000}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          ))}
          <Submit
            busy={busy}
            label={asset ? "Save Changes" : "Upload Media"}
            busyLabel="Uploading…"
          />
          {asset && (
            <>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  try {
                    await saveMedia({ ...form, archived: true });
                    router.push("/admin/media");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Archive Media
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => setConfirm(true)}
              >
                Delete Media
              </button>
            </>
          )}
          <Link href="/admin/media" className="button secondary">
            Cancel
          </Link>
          <DemoFailure />
        </section>
      </form>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete Media"
      >
        <p>Permanently remove this asset from the library?</p>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() => setConfirm(false)}
          >
            Cancel
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={async () => {
              if (!asset) return;
              setBusy(true);
              try {
                await deleteMedia(asset.id);
                router.push("/admin/media");
              } catch (e) {
                setError((e as Error).message);
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
