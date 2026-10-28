"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Empty } from "@/components/ui";
import { Submit, TextField } from "@/components/forms/controls";
import { UnsavedGuard } from "../unsaved";
import { getLocations, saveLocation, useDemoStore } from "@/lib/mock-store";
import { telHref } from "@/lib/rules";
import type { LocationRecord } from "@/lib/contracts";
import { ModuleShell } from "./shared/module-shell";
import styles from "./content.module.css";
import { demoMode } from "@/lib/demo-mode";
import { useAdminWebsiteData } from "@/lib/website/use-admin-data";
import { saveLiveLocation } from "@/lib/website/actions";
import { seededLocations } from "@/lib/website/types";
export function LocationsManager({
  id,
  state,
}: {
  id?: string;
  state?: string;
}) {
  const store = useDemoStore();
  const live = useAdminWebsiteData<LocationRecord>("locations", seededLocations);
  const records = demoMode ? store.websiteContent.locations : live.items;
  if (id) {
    const location = records.find(
      (l) => l.id === id,
    );
    if (!location)
      return (
        <Empty
          title="Record not found"
          body={live.error || "This branch is not available."}
        />
      );
    return <LocationEditor key={location.id} location={location} />;
  }
  const locations = state === "empty" ? [] : demoMode ? getLocations() : [...live.items].sort((a,b)=>a.order-b.order);
  return (
    <>
      <ModuleShell
        title="Locations"
        description="The three documented branches. Branches cannot be created or deleted here."
        backHref="/admin/content"
        backLabel="Website Content"
      />
      {locations.length ? (
        <div className="grid two">
          {locations.map((branch) => (
            <article className="panel form-stack" key={branch.id}>
              <div>
                {branch.label && <span className="badge">{branch.label}</span>}
                <h2>{branch.name}</h2>
              </div>
              <div className={styles.detailRows}>
                <div className={styles.detailRow}>
                  <span>Phone</span>
                  <a className="text-link" href={telHref(branch.phone)}>
                    {branch.phone}
                  </a>
                </div>
                {branch.hours.map(([day, hours]) => (
                  <div className={styles.detailRow} key={day}>
                    <span>{day}</span>
                    <strong>{hours}</strong>
                  </div>
                ))}
                <div className={styles.detailRow}>
                  <span>Map</span>
                  <strong>{branch.map ? "Map link" : "No map link"}</strong>
                </div>
              </div>
              <div className={styles.cardActions}>
                <Link
                  className="button"
                  href={`/admin/content/locations/${branch.id}`}
                >
                  Edit Branch
                </Link>
                <Link
                  className="button secondary"
                  href={`/locations/${branch.slug}`}
                >
                  View Public Page
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="No branches to show yet." />
      )}
    </>
  );
}
function LocationEditor({ location }: { location: LocationRecord }) {
  const [form, setForm] = useState<LocationRecord>(() =>
    structuredClone(location),
  );
  const [baseline, setBaseline] = useState(() => JSON.stringify(location));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== baseline;
  function change(patch: Partial<LocationRecord>) {
    setForm((f) => ({ ...f, ...patch }));
    setSuccess("");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const next = demoMode ? await saveLocation(form) : await saveLiveLocation(form);
      setForm(next);
      setBaseline(JSON.stringify(next));
      setSuccess("Changes saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <UnsavedGuard dirty={dirty} />
      <ModuleShell
        title="Edit Branch"
        description={form.name}
        backHref="/admin/content/locations"
        backLabel="Locations"
        badge={
          <span className="badge">
            {dirty ? "Unsaved changes" : "Branch record"}
          </span>
        }
        error={error}
        success={success}
      />
      <form className="admin-columns" noValidate onSubmit={save}>
        <div className="panel form-stack">
          <TextField
            id="branch-name"
            label="Branch name *"
            value={form.name}
            maxLength={120}
            onChange={(e) => change({ name: e.target.value })}
          />
          <TextField
            id="branch-label"
            label="Branch label"
            value={form.label}
            maxLength={120}
            help="Shown as a badge on the branch card when provided."
            onChange={(e) => change({ label: e.target.value })}
          />
          <TextField
            id="branch-phone"
            label="Phone number *"
            type="tel"
            value={form.phone}
            maxLength={40}
            onChange={(e) => change({ phone: e.target.value })}
          />
          <TextField
            id="branch-map"
            label="Map URL"
            type="url"
            value={form.map}
            maxLength={500}
            help="Leave empty when the branch has no map link."
            onChange={(e) => change({ map: e.target.value })}
          />
          <div className="form-stack">
            <h2>Opening hours</h2>
            <div className={styles.hoursGrid}>
              {form.hours.map(([day, hours], i) => (
                <div className={styles.hoursRow} key={i}>
                  <TextField
                    id={`hours-day-${i}`}
                    label={`Row ${i + 1} label`}
                    value={day}
                    maxLength={80}
                    onChange={(e) => {
                      const next = form.hours.map((row) => [...row]) as [
                        string,
                        string,
                      ][];
                      next[i] = [e.target.value, next[i][1]];
                      change({ hours: next });
                    }}
                  />
                  <TextField
                    id={`hours-range-${i}`}
                    label={`Row ${i + 1} hours`}
                    value={hours}
                    maxLength={80}
                    onChange={(e) => {
                      const next = form.hours.map((row) => [...row]) as [
                        string,
                        string,
                      ][];
                      next[i] = [next[i][0], e.target.value];
                      change({ hours: next });
                    }}
                  />
                  <button
                    type="button"
                    className="button secondary"
                    disabled={form.hours.length <= 1 || busy}
                    onClick={() =>
                      change({ hours: form.hours.filter((_, r) => r !== i) })
                    }
                  >
                    Remove
                    <span className="sr-only"> opening hours row {i + 1}</span>
                  </button>
                </div>
              ))}
            </div>
            <div>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => change({ hours: [...form.hours, ["", ""]] })}
              >
                Add Opening Hours Row
              </button>
            </div>
          </div>
          <TextField
            id="branch-order"
            label="Sort order"
            type="number"
            min={1}
            step={1}
            value={form.order}
            onChange={(e) => change({ order: Number(e.target.value) })}
          />
        </div>
        <div className="stack">
          <section className="panel form-stack">
            <Submit busy={busy} />
            <Link
              className="button secondary"
              href="/admin/content/locations"
            >
              Cancel
            </Link>
            <Link
              className="button secondary"
              href={`/locations/${form.slug}`}
            >
              View Public Page
            </Link>
          </section>
        </div>
      </form>
    </>
  );
}
