import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = "supabase/migrations";
const PRELUDE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
`;

type SavedService = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  image: string;
  alt: string;
  active: boolean;
  sort_order: number;
  version: number;
};

let db: PGlite;
let actor: string;

before(async () => {
  db = new PGlite();
  await db.exec(PRELUDE);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`migration failed: ${file}: ${(error as Error).message}`);
    }
  }
  actor = randomUUID();
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'services-admin@example.test')", [actor]);
  await db.query("INSERT INTO public.admin_profiles(user_id,role,display_name) VALUES($1,'full_admin','Services Test Admin')", [actor]);
});

after(async () => {
  await db.close();
});

type UpsertInput = {
  id?: string | null;
  slug: string;
  expected?: number | null;
  title?: string;
  summary?: string;
  body?: string;
  image?: string;
  alt?: string;
  sort?: number;
  active?: boolean;
};

async function upsert(input: UpsertInput): Promise<SavedService> {
  const { rows } = await db.query<{ result: SavedService }>(
    `SELECT public.website_service_upsert(
      $1::uuid,$2::uuid,$3,$4::integer,$5,$6,$7,$8,$9,$10::integer,$11::boolean
    ) AS result`,
    [
      actor,
      input.id ?? null,
      input.slug,
      input.expected ?? null,
      input.title ?? "Service title",
      input.summary ?? "Service summary",
      input.body ?? "Service body",
      input.image ?? "",
      input.alt ?? "",
      input.sort ?? 20,
      input.active ?? true,
    ],
  );
  return rows[0].result;
}

async function serviceCount(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM public.services",
  );
  return rows[0].n;
}

test("migration copies approved copy and media into untouched service rows", async () => {
  const { rows } = await db.query<{
    title: string;
    summary: string;
    public_image: string;
    public_alt: string;
  }>(
    "SELECT title,summary,public_image,public_alt FROM public.services WHERE slug='wash-ironing-fold'",
  );
  assert.equal(rows[0].title, "Wash, Ironing & Fold");
  assert.match(rows[0].summary, /Arrange washing/);
  assert.equal(rows[0].public_image, "/images/wash-ironing-and-fold.jpg");
  assert.ok(rows[0].public_alt);
});

test("creating a service inserts one row with its media and publish state", async () => {
  const before = await serviceCount();
  const created = await upsert({
    slug: "admin-created-service",
    title: "Admin Created",
    summary: "Created in admin.",
    body: "Body from the admin editor.",
    image: "https://example.test/featured.webp",
    alt: "Featured image",
    active: true,
    sort: 11,
  });

  assert.equal(created.slug, "admin-created-service");
  assert.equal(created.title, "Admin Created");
  assert.equal(created.image, "https://example.test/featured.webp");
  assert.equal(created.alt, "Featured image");
  assert.equal(created.active, true);
  assert.equal(await serviceCount(), before + 1);
});

test("a duplicate slug is a conflict rather than overwriting another service", async () => {
  await assert.rejects(
    () => upsert({ slug: "admin-created-service", title: "Overwrite attempt" }),
    /CONTENT_CONFLICT/,
  );
});

test("editing and renaming updates the same service record", async () => {
  const { rows } = await db.query<{ id: string; version: number }>(
    "SELECT id,version FROM public.services WHERE slug='suit-cleaning'",
  );
  const updated = await upsert({
    id: rows[0].id,
    slug: "suit-care",
    expected: rows[0].version,
    title: "Suit Care",
    summary: "Updated suits copy.",
    body: "Care for suits.",
    image: "https://example.test/suit.webp",
    alt: "Suits",
    active: true,
    sort: 8,
  });

  assert.equal(updated.id, rows[0].id);
  assert.equal(updated.version, rows[0].version + 1);
  const renamed = await db.query<{ id: string }>(
    "SELECT id FROM public.services WHERE slug='suit-care'",
  );
  assert.equal(renamed.rows.length, 1);
  assert.equal(renamed.rows[0].id, rows[0].id);
  const oldSlug = await db.query("SELECT id FROM public.services WHERE slug='suit-cleaning'");
  assert.equal(oldSlug.rows.length, 0);
});

test("unpublishing clears only the active flag and retains the record", async () => {
  const { rows } = await db.query<{ id: string; version: number }>(
    "SELECT id,version FROM public.services WHERE slug='suit-care'",
  );
  const hidden = await upsert({
    id: rows[0].id,
    slug: "suit-care",
    expected: rows[0].version,
    title: "Suit Care",
    summary: "Updated suits copy.",
    image: "https://example.test/suit.webp",
    alt: "Suits",
    active: false,
    sort: 8,
  });

  assert.equal(hidden.active, false);
  const kept = await db.query<{ active: boolean }>(
    "SELECT active FROM public.services WHERE slug='suit-care'",
  );
  assert.equal(kept.rows.length, 1);
  assert.equal(kept.rows[0].active, false);
});

test("stale versions and invalid publish payloads are rejected", async () => {
  const { rows } = await db.query<{ id: string; version: number }>(
    "SELECT id,version FROM public.services WHERE slug='admin-created-service'",
  );
  await assert.rejects(
    () =>
      upsert({
        id: rows[0].id,
        slug: "admin-created-service",
        expected: rows[0].version - 1,
      }),
    /CONTENT_CONFLICT/,
  );
  await assert.rejects(
    () => upsert({ slug: "missing-summary", summary: "", active: true }),
    /CONTENT_INVALID/,
  );
});
