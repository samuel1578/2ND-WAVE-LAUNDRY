import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { ContentItem } from "../src/lib/contracts";
import { hasPermission } from "../src/lib/auth/permissions";
import {
  blogDeletionTarget,
  serviceDeletionTarget,
  serviceReferenceDeletionError,
} from "../src/lib/website/content-deletion";
import {
  mapBlogPostRow,
  summariseBlogRow,
  type BlogListRow,
} from "../src/lib/website/public-queries";

/**
 * Permanent deletion of Blog articles and Services.
 *
 * The refusal rules live in `src/lib/website/content-deletion.ts` and are
 * exercised directly below. The database half of the contract is checked
 * against a PGlite database built from the real migrations: deleting content
 * removes only that content row (the Media Library survives), a service any
 * booking still references is refused before anything is removed, the
 * `booking_services` foreign key can never damage a historical booking, and
 * archiving a referenced service keeps working.
 *
 * `src/lib/website/repository.ts` imports `server-only`, so its statements are
 * asserted from source instead of being executed here; the SQL below mirrors
 * them statement for statement.
 */

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

/* -------------------------------------------------------------------------- */
/* Pure deletion rules                                                        */
/* -------------------------------------------------------------------------- */

const contentItem = (patch: Partial<ContentItem> = {}): ContentItem => ({
  id: randomUUID(),
  module: "Blog",
  title: "Laundry Care Notes",
  slug: "laundry-care-notes",
  summary: "How to keep fabrics fresh.",
  body: "Body copy.",
  image: "/images/care.jpg",
  alt: "Folded laundry",
  status: "Published",
  sort: 1,
  version: 1,
  extra: {},
  ...patch,
});

test("a blog article is deleted by its record slug and nothing else", () => {
  assert.deepEqual(blogDeletionTarget(contentItem()), {
    ok: true,
    key: "laundry-care-notes",
  });
  // Whitespace around a pasted slug never changes the target row.
  assert.deepEqual(blogDeletionTarget(contentItem({ slug: "  care-notes  " })), {
    ok: true,
    key: "care-notes",
  });

  const missing = blogDeletionTarget(null);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /cannot be deleted/);

  assert.equal(blogDeletionTarget(contentItem({ module: "Services" })).ok, false);

  const noSlug = blogDeletionTarget(contentItem({ slug: "   " }));
  assert.equal(noSlug.ok, false);
  if (!noSlug.ok) assert.match(noSlug.error, /could not be identified/);

  assert.equal(blogDeletionTarget(contentItem({ slug: "x".repeat(181) })).ok, false);
});

test("a service is deleted by its stored row id so a slug edit cannot move it", () => {
  const recordId = randomUUID();
  assert.deepEqual(
    serviceDeletionTarget(contentItem({ module: "Services" }), recordId),
    { ok: true, key: recordId },
  );

  const noId = serviceDeletionTarget(contentItem({ module: "Services" }), null);
  assert.equal(noId.ok, false);
  if (!noId.ok) assert.match(noId.error, /could not be identified/);

  const blankId = serviceDeletionTarget(contentItem({ module: "Services" }), "");
  assert.equal(blankId.ok, false);
  if (!blankId.ok) assert.match(blankId.error, /could not be identified/);

  assert.equal(serviceDeletionTarget(contentItem(), recordId).ok, false);
  assert.equal(serviceDeletionTarget(undefined, recordId).ok, false);

  const wrongModule = serviceDeletionTarget(contentItem(), "");
  assert.equal(wrongModule.ok, false);
  if (!wrongModule.ok) assert.match(wrongModule.error, /cannot be deleted/);
});

test("a service used by bookings is refused with an archive-instead message", () => {
  assert.equal(serviceReferenceDeletionError(0), "");
  assert.equal(serviceReferenceDeletionError(-1), "");
  assert.equal(serviceReferenceDeletionError(Number.NaN), "");

  const message = serviceReferenceDeletionError(1);
  assert.ok(message);
  assert.match(message, /cannot be permanently deleted/);
  assert.match(message, /Archive the service instead/);
  // The administrator is told why history is safe, and no booking is implied
  // to be edited by the delete.
  assert.match(message, /booking history keeps the service name and slug/);
  assert.equal(serviceReferenceDeletionError(12), message);
});

test("both delete actions are gated by content.manage, a Full Admin permission", () => {
  const actions = readFileSync("src/lib/website/actions.ts", "utf8");
  for (const name of ["deleteLiveBlog", "deleteLiveService"]) {
    const body = functionBody(actions, name);
    assert.match(
      body,
      /await actor\("content\.manage"\)/,
      `${name} must require content.manage`,
    );
    assert.match(body, /await assertWebsiteWritesEnabled\(\)/);
    assert.match(body, /consumeWebsiteWrite\(admin\.userId\)/);
  }

  // Only the Full Admin role holds the permission, so an Operational Admin can
  // never reach either server action.
  assert.equal(hasPermission("full_admin", "content.manage"), true);
  assert.equal(hasPermission("operational_admin", "content.manage"), false);
  assert.equal(hasPermission(null, "content.manage"), false);
});

test("the repository deletes content rows only and checks booking usage first", () => {
  const repository = readFileSync("src/lib/website/repository.ts", "utf8");

  const blog = functionBody(repository, "deleteBlog");
  assert.match(blog, /\.eq\("module", "blog"\)/);
  assert.match(blog, /\.eq\("record_key", target\.key\)/);
  // Media assets are shared between records and stay in the Media Library.
  assert.equal(/website_gallery_media/.test(blog), false);
  assert.equal(/removeMarketingStorageObject/.test(blog), false);

  const service = functionBody(repository, "deleteService");
  const usage = service.indexOf('.from("booking_services")');
  const removal = service.indexOf('.from("services")');
  assert.ok(usage > -1, "service deletion must read booking usage");
  assert.ok(removal > -1, "service deletion must remove the catalogue row");
  assert.ok(
    usage < removal,
    "booking usage must be checked before the catalogue row is removed",
  );
  assert.match(service, /serviceReferenceDeletionError\(/);
});

/** The body of one exported async function, up to the next export. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `${name} must be exported from the module`);
  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport (?:async )?function/);
  return next === -1 ? rest : rest.slice(0, next);
}

/* -------------------------------------------------------------------------- */
/* Database contract                                                          */
/* -------------------------------------------------------------------------- */

let db: PGlite;
let actor: string;

before(async () => {
  db = new PGlite();
  await db.exec(PRELUDE);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`migration failed: ${file}: ${(error as Error).message}`);
    }
  }
  actor = randomUUID();
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'content-delete@example.test')", [
    actor,
  ]);
  await db.query(
    "INSERT INTO public.admin_profiles(user_id,role,display_name) VALUES($1,'full_admin','Content Deletion Test Admin')",
    [actor],
  );
});

after(async () => {
  await db.close();
});

async function createMedia(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.website_gallery_media
      (id,storage_path,public_url,name,alt,source,permission)
     VALUES ($1,$2,$3,'care.jpg','Folded laundry','Test fixture','Test permission')`,
    [id, `media/${id}.webp`, `https://example.test/${id}.webp`],
  );
  return id;
}

async function createBlog(slug: string, mediaId: string): Promise<void> {
  await db.query(
    `INSERT INTO public.website_content (module,record_key,payload,published,sort_order,version,updated_by)
     VALUES ('blog',$1,$2,true,1,1,$3)`,
    [
      slug,
      JSON.stringify({
        title: "Laundry Care Notes",
        slug,
        summary: "How to keep fabrics fresh.",
        body: "Body copy.",
        image: `https://example.test/${mediaId}.webp`,
        alt: "Folded laundry",
        publishedAt: "2026-10-01T09:00:00.000Z",
      }),
      actor,
    ],
  );
}

/** Mirrors `deleteBlog`: delete one blog row and return what was removed. */
async function deleteBlogRow(slug: string) {
  const { rows } = await db.query<{ id: string; record_key: string }>(
    "DELETE FROM public.website_content WHERE module='blog' AND record_key=$1 RETURNING id, record_key",
    [slug],
  );
  return rows;
}

/** Mirrors the public blog index query in `src/lib/website/public.ts`. */
async function publicBlogList(): Promise<string[]> {
  const { rows } = await db.query<BlogListRow>(
    `SELECT id, record_key, published, sort_order, version,
            payload->>'title' AS title,
            payload->>'slug' AS slug,
            payload->>'summary' AS summary,
            payload->>'image' AS image,
            payload->>'alt' AS alt,
            payload->'author' AS author,
            payload->>'publishedAt' AS "publishedAt"
       FROM public.website_content
      WHERE module='blog' AND published = true
      ORDER BY sort_order`,
  );
  return rows.map((row) => summariseBlogRow(row).slug);
}

/** Mirrors the public article page query in `src/lib/website/public.ts`. */
async function publicBlogPost(slug: string) {
  const { rows } = await db.query<{
    id: string;
    record_key: string;
    payload: Record<string, unknown>;
    sort_order: number;
    version: number;
    published: boolean;
  }>(
    `SELECT id, record_key, payload, sort_order, version, published
       FROM public.website_content
      WHERE module='blog' AND record_key=$1`,
    [slug],
  );
  return rows[0] ? mapBlogPostRow(rows[0]) : null;
}

async function createService(slug: string) {
  const { rows } = await db.query<{
    result: { id: string; slug: string; version: number };
  }>(
    `SELECT public.website_service_upsert(
       $1::uuid,NULL::uuid,$2,NULL::integer,$3,$4,$5,$6,$7,20::integer,true
     ) AS result`,
    [actor, slug, "Service title", "Service summary", "Service body", "", ""],
  );
  return rows[0].result;
}

async function archiveService(id: string, slug: string, version: number) {
  const { rows } = await db.query<{ result: { active: boolean } }>(
    `SELECT public.website_service_upsert(
       $1::uuid,$2::uuid,$3,$4::integer,$5,$6,$7,$8,$9,20::integer,false
     ) AS result`,
    [actor, id, slug, version, "Service title", "Service summary", "Service body", "", ""],
  );
  return rows[0].result;
}

async function bookingReferencing(serviceId: string) {
  const bookingId = randomUUID();
  await db.query(
    `INSERT INTO public.bookings (
        id, reference, idempotency_key, submission_hash, customer_name,
        customer_phone, customer_email, item_category, load_size,
        pickup_address, requested_date
     ) VALUES ($1,$2,$3,$4,'Booking Customer','+233595224280',
               'booking-customer@example.test','clothing','1 Standard Bag',
               '1 Test Street','2026-11-05')`,
    [
      bookingId,
      `2W-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
      randomUUID(),
      "a".repeat(32),
    ],
  );
  await db.query(
    `INSERT INTO public.booking_services (booking_id, service_id, service_slug, service_title)
     VALUES ($1,$2,'service-title','Service title')`,
    [bookingId, serviceId],
  );
  return bookingId;
}

/** Mirrors the reference check in `deleteService`. */
async function bookingUsage(serviceId: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM public.booking_services WHERE service_id = $1 LIMIT 1",
    [serviceId],
  );
  return rows.length;
}

test("deleting a blog article removes the row and leaves the Media Library intact", async () => {
  const mediaId = await createMedia();
  const slug = `delete-me-${randomUUID().slice(0, 8)}`;
  const keptSlug = `keep-me-${randomUUID().slice(0, 8)}`;
  await createBlog(slug, mediaId);
  await createBlog(keptSlug, mediaId);

  assert.ok((await publicBlogList()).includes(slug));
  assert.ok(await publicBlogPost(slug));

  const removed = await deleteBlogRow(slug);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].record_key, slug);

  // The article is gone from the admin list and from the public site, which
  // both read the same table.
  assert.equal(await publicBlogPost(slug), null);
  assert.equal((await publicBlogList()).includes(slug), false);

  // A second article that shares the same featured image is untouched...
  assert.ok((await publicBlogList()).includes(keptSlug));
  // ...and the image itself stays in the Media Library.
  const { rows: mediaRows } = await db.query<{ id: string }>(
    "SELECT id FROM public.website_gallery_media WHERE id = $1",
    [mediaId],
  );
  assert.equal(mediaRows.length, 1);
});

test("deleting an article that is already gone reports the missing record", async () => {
  const removed = await deleteBlogRow(`missing-${randomUUID().slice(0, 8)}`);
  assert.equal(removed.length, 0);
  // `deleteBlog` maps an empty result to this message.
  assert.match(
    readFileSync("src/lib/website/repository.ts", "utf8"),
    /This article no longer exists\. Reload the page to see the latest list\./,
  );
});

test("a service referenced by a booking is refused before any row is removed", async () => {
  const service = await createService(`referenced-${randomUUID().slice(0, 8)}`);
  const bookingId = await bookingReferencing(service.id);

  assert.equal(await bookingUsage(service.id), 1);
  const blocked = serviceReferenceDeletionError(await bookingUsage(service.id));
  assert.match(blocked, /Archive the service instead/);

  // Nothing is removed: the catalogue row, the booking and the snapshot stay.
  const { rows: serviceRows } = await db.query<{ id: string }>(
    "SELECT id FROM public.services WHERE id = $1",
    [service.id],
  );
  assert.equal(serviceRows.length, 1);
  const { rows: usage } = await db.query<{ service_slug: string; service_title: string }>(
    "SELECT service_slug, service_title FROM public.booking_services WHERE booking_id = $1",
    [bookingId],
  );
  assert.deepEqual(usage, [{ service_slug: "service-title", service_title: "Service title" }]);
});

test("the booking foreign key never damages historical booking records", async () => {
  const service = await createService(`history-${randomUUID().slice(0, 8)}`);
  const bookingId = await bookingReferencing(service.id);

  // Even if the catalogue row were removed, `ON DELETE SET NULL` keeps the
  // booking and the service name and slug captured when it was submitted.
  await db.query("DELETE FROM public.services WHERE id = $1", [service.id]);

  const { rows: bookings } = await db.query<{ id: string }>(
    "SELECT id FROM public.bookings WHERE id = $1",
    [bookingId],
  );
  assert.equal(bookings.length, 1);
  const { rows: usage } = await db.query<{
    service_id: string | null;
    service_slug: string;
    service_title: string;
  }>(
    "SELECT service_id, service_slug, service_title FROM public.booking_services WHERE booking_id = $1",
    [bookingId],
  );
  assert.equal(usage.length, 1);
  assert.equal(usage[0].service_id, null);
  assert.equal(usage[0].service_slug, "service-title");
  assert.equal(usage[0].service_title, "Service title");
});

test("an unreferenced service deletes cleanly and disappears from the catalogue", async () => {
  const service = await createService(`deletable-${randomUUID().slice(0, 8)}`);
  assert.equal(await bookingUsage(service.id), 0);
  assert.equal(serviceReferenceDeletionError(await bookingUsage(service.id)), "");

  const { rows: deleted } = await db.query<{ id: string }>(
    "DELETE FROM public.services WHERE id = $1 RETURNING id",
    [service.id],
  );
  assert.deepEqual(deleted.map((row) => row.id), [service.id]);

  const { rows: remaining } = await db.query<{ id: string }>(
    "SELECT id FROM public.services WHERE id = $1",
    [service.id],
  );
  assert.equal(remaining.length, 0);
});

test("a referenced service can still be archived without touching the booking", async () => {
  const service = await createService(`archivable-${randomUUID().slice(0, 8)}`);
  const bookingId = await bookingReferencing(service.id);

  const archived = await archiveService(service.id, service.slug, service.version);
  assert.equal(archived.active, false);

  const { rows: rows } = await db.query<{ active: boolean }>(
    "SELECT active FROM public.services WHERE id = $1",
    [service.id],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].active, false);
  const { rows: usage } = await db.query<{ service_id: string | null }>(
    "SELECT service_id FROM public.booking_services WHERE booking_id = $1",
    [bookingId],
  );
  assert.equal(usage[0].service_id, service.id);
});
