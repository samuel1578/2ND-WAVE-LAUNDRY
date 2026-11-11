import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { ContentItem } from "../src/lib/contracts";
import { buildBlogPayload } from "../src/lib/website/blog-content";
import { mapBlogPostRow } from "../src/lib/website/public-queries";
import { articleSchema } from "../src/lib/seo/schema";
import { toContent, type WebsiteRow } from "../src/lib/website/types";
import { sortBlogItems } from "../src/lib/website/blog-order";

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

type RpcResult = {
    id: string;
    key: string;
    payload: Record<string, unknown>;
    published: boolean;
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
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'blog-admin@example.test')", [actor]);
    await db.query("INSERT INTO public.admin_profiles(user_id,role,display_name) VALUES($1,'full_admin','Blog Test Admin')", [actor]);
});

after(async () => {
    await db.close();
});

async function save(item: ContentItem, action: "draft" | "publish" | "archive" | "unpublish", now: string): Promise<RpcResult> {
    const built = buildBlogPayload(item, action, now);
    const { rows } = await db.query<{ result: RpcResult }>(
        "SELECT public.website_content_upsert($1::uuid,'blog',$2,$3::jsonb,$4,$5,$6::integer) AS result",
        [actor, item.slug, JSON.stringify(built.payload), built.published, item.sort, item.version || null],
    );
    return rows[0].result;
}

function adminItem(row: RpcResult): ContentItem {
    const websiteRow: WebsiteRow = {
        id: row.id,
        key: row.key,
        module: "blog",
        payload: row.payload,
        published: row.published,
        sort_order: row.sort_order,
        version: row.version,
    };
    return toContent(websiteRow);
}

async function stored(slug: string): Promise<RpcResult | undefined> {
    const { rows } = await db.query<RpcResult>(
        "SELECT id,record_key AS key,payload,published,sort_order,version FROM public.website_content WHERE module='blog' AND record_key=$1",
        [slug],
    );
    return rows[0];
}

const date1 = "2026-10-01T09:00:00.000Z";
const date2 = "2026-11-03T12:30:00.000Z";

test("Blog reorder RPC persists compact order, advances versions and excludes stale sets", async () => {
    const createItem = (slug: string, sort: number): ContentItem => ({
        id: "",
        module: "Blog",
        title: `${slug} title`,
        slug,
        summary: `${slug} summary`,
        body: `${slug} body`,
        image: "",
        alt: "",
        status: "Draft",
        sort,
        version: 0,
        extra: {},
    });
    const first = await save(createItem("order-first", 1), "publish", date1);
    const second = await save(createItem("order-second", 2), "publish", date2);
    const ordered = [
        { key: second.key, version: second.version },
        { key: first.key, version: first.version },
    ];
    const result = await db.query<{ result: RpcResult[] }>(
        "SELECT public.website_blog_reorder($1::uuid,$2::jsonb) AS result",
        [actor, JSON.stringify(ordered)],
    );
    assert.deepEqual(result.rows[0].result.map((row) => [row.key, row.sort_order]), [
        [second.key, 1],
        [first.key, 2],
    ]);
    assert.ok(result.rows[0].result.every((row) => row.version === 2));
    const adminOrder = sortBlogItems(result.rows[0].result.map(adminItem), (item) => ({ order: item.sort, id: item.id }));
    const publicOrder = sortBlogItems(result.rows[0].result.filter((row) => row.published).map((row) => ({ id: row.key, order: row.sort_order })), (item) => item);
    assert.deepEqual(adminOrder.map((item) => item.id), publicOrder.map((item) => item.id));
    const refreshed = await db.query<RpcResult>(
        "SELECT id,record_key AS key,payload,published,sort_order,version FROM public.website_content WHERE module='blog' ORDER BY sort_order,record_key",
    );
    assert.deepEqual(refreshed.rows.map((row) => row.key), [second.key, first.key]);
    await assert.rejects(
        db.query("SELECT public.website_blog_reorder($1::uuid,$2::jsonb)", [actor, JSON.stringify(ordered)]),
        (error: unknown) => (error as { code?: string }).code === "40001",
    );
});

test("Blog structured data includes author and only known publication dates", () => {
    const authored = articleSchema({
        slug: "care-notes",
        title: "Care Notes",
        summary: "A laundry care article",
        image: "https://example.test/featured.jpg",
        body: "Article body",
        author: { name: "Sam", image: "https://example.test/profile.jpg" },
        datePublished: date1,
        dateModified: date2,
    });
    assert.deepEqual(authored.author, {
        "@type": "Person",
        name: "Sam",
        image: "https://example.test/profile.jpg",
    });
    assert.equal(authored.datePublished, date1);
    assert.equal(authored.dateModified, date2);

    const legacy = articleSchema({
        slug: "legacy-article",
        title: "Legacy Article",
        summary: "Legacy summary",
        image: "",
        body: "Legacy body",
    });
    assert.equal(typeof (legacy.author as { "@id": string })["@id"], "string");
    assert.equal("datePublished" in legacy, false);
});

test("Blog draft, publish and archive lifecycle keeps the published snapshot isolated", async () => {
    const original: ContentItem = {
        id: "",
        module: "Blog",
        title: "First published title",
        slug: "care-notes",
        summary: "First summary",
        body: "First body",
        image: "https://example.test/legacy-featured.jpg",
        alt: "Legacy featured image",
        author: { name: "Original Author", bio: "Original bio" },
        contentBlocks: [
            { type: "text", text: "First paragraph", order: 1 },
            { type: "image", mediaId: "", src: "https://example.test/legacy-inline.jpg", alt: "Legacy inline", caption: "Original caption", order: 2 },
        ],
        status: "Draft",
        sort: 1,
        version: 0,
        extra: {},
    };

    const first = await save(original, "publish", date1);
    assert.equal(first.published, true);
    assert.equal(first.version, 1);
    const publishedItem = adminItem(first);
    assert.equal(publishedItem.publishedAt, date1);
    assert.equal(publishedItem.published?.author?.name, "Original Author");

    const edited: ContentItem = {
        ...publishedItem,
        title: "Private edited title",
        summary: "Private edited summary",
        body: "Private edited body",
        image: "https://example.test/new-featured.jpg",
        alt: "New featured image",
        author: { name: "Draft Author", bio: "Draft biography" },
        contentBlocks: [
            { type: "text", text: "Draft text", order: 1 },
            { type: "image", mediaId: "", src: "https://example.test/draft-inline.jpg", alt: "Draft inline", caption: "Draft caption", order: 2 },
        ],
    };
    const draftSave = await save(edited, "draft", date2);
    assert.equal(draftSave.published, true);
    assert.equal(draftSave.payload.title, "First published title");
    assert.equal(draftSave.payload.body, "First paragraph");
    assert.equal((draftSave.payload.author as { name: string }).name, "Original Author");
    assert.equal((draftSave.payload.draft as { title: string }).title, "Private edited title");

    const publicDraft = mapBlogPostRow({
        id: draftSave.id,
        record_key: draftSave.key,
        payload: draftSave.payload,
        published: draftSave.published,
        sort_order: draftSave.sort_order,
        version: draftSave.version,
    });
    assert.equal(publicDraft.title, "First published title");
    assert.equal(publicDraft.body, "First paragraph");
    assert.equal(publicDraft.author?.name, "Original Author");
    assert.equal(publicDraft.contentBlocks?.[0]?.type === "text" && publicDraft.contentBlocks[0].text, "First paragraph");

    const reloadedDraft = adminItem(draftSave);
    assert.equal(reloadedDraft.title, "Private edited title");
    assert.equal(reloadedDraft.status, "Draft");
    assert.equal(reloadedDraft.published?.title, "First published title");
    assert.equal(reloadedDraft.version, 2);

    const publishedAgain = await save(reloadedDraft, "publish", date2);
    assert.equal(publishedAgain.published, true);
    assert.equal(publishedAgain.version, 3);
    assert.equal(publishedAgain.payload.title, "Private edited title");
    assert.equal("draft" in publishedAgain.payload, false);
    assert.equal(publishedAgain.payload.publishedAt, date1);
    assert.equal(publishedAgain.payload.modifiedAt, date2);
    const publicUpdated = mapBlogPostRow({
        id: publishedAgain.id,
        record_key: publishedAgain.key,
        payload: publishedAgain.payload,
        published: true,
        sort_order: 1,
        version: publishedAgain.version,
    });
    assert.equal(publicUpdated.title, "Private edited title");
    assert.equal(publicUpdated.author?.name, "Draft Author");
    assert.deepEqual(publicUpdated.contentBlocks?.map((block) => block.type), ["text", "image"]);

    await assert.rejects(
        db.query(
            "SELECT public.website_content_upsert($1::uuid,'blog',$2,$3::jsonb,true,1,1::integer)",
            [actor, publishedAgain.key, JSON.stringify(publishedAgain.payload)],
        ),
        (error: unknown) => (error as { code?: string }).code === "PT409",
    );

    const unpublished = await save(adminItem(publishedAgain), "unpublish", date2);
    assert.equal(unpublished.published, false);
    assert.equal(adminItem(unpublished).status, "Draft");
    assert.equal((await stored("care-notes"))?.published, false);

    const republished = await save(adminItem(unpublished), "publish", "2026-11-03T14:00:00.000Z");
    assert.equal(republished.published, true);
    assert.equal(republished.payload.publishedAt, date1);

    const archived = await save(adminItem(republished), "archive", date2);
    assert.equal(archived.published, false);
    assert.equal(adminItem(archived).status, "Archived");
    assert.equal((await stored("care-notes"))?.published, false);
});

test("legacy publication dates stay absent until a new publish event and media refs are protected", async () => {
    const legacyPayload = {
        title: "Legacy article",
        slug: "legacy-article",
        summary: "Old summary",
        body: "Old body",
        image: "https://example.test/old-image.jpg",
        alt: "Old image",
        status: "Published",
    };
    const { rows: legacyRows } = await db.query<{ result: RpcResult }>(
        "SELECT public.website_content_upsert($1::uuid,'blog','legacy-article',$2::jsonb,true,2,NULL::integer) AS result",
        [actor, JSON.stringify(legacyPayload)],
    );
    const legacy = adminItem(legacyRows[0].result);
    assert.equal(legacy.publishedAt, undefined);
    const legacyDraft = await save({ ...legacy, title: "Legacy draft" }, "draft", date2);
    assert.equal(legacyDraft.payload.publishedAt, undefined);
    assert.equal((legacyDraft.payload.draft as Record<string, unknown>).publishedAt, undefined);
    const legacyRepublished = await save(adminItem(legacyDraft), "publish", date2);
    assert.equal(legacyRepublished.payload.publishedAt, date2);
    assert.equal(legacyRepublished.payload.modifiedAt, date2);

    const mediaId = randomUUID();
    await db.query(
        `INSERT INTO public.website_gallery_media
      (id,storage_path,public_url,name,alt,source,permission,archived)
     VALUES ($1,$2,$3,$4,'Blog test media','Test fixture','Test permission',false)`,
        [mediaId, `media/${mediaId}.webp`, `https://example.test/${mediaId}.webp`, `${mediaId}.webp`],
    );
    const withMedia: ContentItem = {
        id: "",
        module: "Blog",
        title: "Media article",
        slug: "media-article",
        summary: "Media summary",
        body: "Text around a picture",
        image: `https://example.test/${mediaId}.webp`,
        alt: "Featured image",
        imageMediaId: mediaId,
        author: { name: "Media Author", image: `https://example.test/${mediaId}.webp`, imageMediaId: mediaId },
        contentBlocks: [
            { type: "text", text: "Before", order: 1 },
            { type: "image", mediaId, src: `https://example.test/${mediaId}.webp`, alt: "Inline media", caption: "A caption", order: 2 },
        ],
        status: "Draft",
        sort: 3,
        version: 0,
        extra: {},
    };
    const mediaPublished = await save(withMedia, "publish", date1);
    assert.equal(mediaPublished.published, true);

    const draftMediaId = randomUUID();
    await db.query(
        `INSERT INTO public.website_gallery_media
      (id,storage_path,public_url,name,alt,source,permission,archived)
     VALUES ($1,$2,$3,$4,'Draft media','Test fixture','Test permission',false)`,
        [draftMediaId, `media/${draftMediaId}.webp`, `https://example.test/${draftMediaId}.webp`, `${draftMediaId}.webp`],
    );
    const currentMediaArticle = adminItem(mediaPublished);
    const mediaDraft = await save({
        ...currentMediaArticle,
        image: `https://example.test/${draftMediaId}.webp`,
        imageMediaId: draftMediaId,
        author: { name: "Media Author", image: `https://example.test/${draftMediaId}.webp`, imageMediaId: draftMediaId },
        contentBlocks: [
            { type: "text", text: "Draft text", order: 1 },
            { type: "image", mediaId: draftMediaId, src: `https://example.test/${draftMediaId}.webp`, alt: "Draft inline media", caption: "Draft caption", order: 2 },
        ],
    }, "draft", date2);
    assert.equal(mediaDraft.payload.imageMediaId, mediaId);
    assert.equal((mediaDraft.payload.draft as Record<string, unknown>).imageMediaId, draftMediaId);

    await assert.rejects(
        db.query(
            "SELECT public.website_media_upsert($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,true,1)",
            [actor, mediaId, `media/${mediaId}.webp`, `https://example.test/${mediaId}.webp`, `${mediaId}.webp`, "Blog test media", "", "Test fixture", "Test permission"],
        ),
        (error: unknown) => (error as { code?: string }).code === "40001",
    );
    await assert.rejects(
        db.query(
            "SELECT public.website_media_upsert($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,true,1)",
            [actor, draftMediaId, `media/${draftMediaId}.webp`, `https://example.test/${draftMediaId}.webp`, `${draftMediaId}.webp`, "Draft media", "", "Test fixture", "Test permission"],
        ),
        (error: unknown) => (error as { code?: string }).code === "40001",
    );
    await assert.rejects(
        db.query(
            "SELECT public.website_media_upsert($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,false,1)",
            [actor, mediaId, `media/${mediaId}.webp`, "https://example.test/replaced.webp", `${mediaId}.webp`, "Blog test media", "", "Test fixture", "Test permission"],
        ),
        (error: unknown) => (error as { code?: string }).code === "40001",
    );

    const missingMedia = { ...withMedia, id: "", slug: "missing-media", imageMediaId: randomUUID(), version: 0 };
    await assert.rejects(
        save(missingMedia, "draft", date2),
        (error: unknown) => (error as { code?: string }).code === "22023",
    );
    const staleMediaUrl = {
        ...withMedia,
        image: "https://example.test/outdated-url.webp",
        slug: "stale-media-url",
        version: 0,
    };
    await assert.rejects(
        save(staleMediaUrl, "draft", date2),
        (error: unknown) => (error as { code?: string }).code === "22023",
    );
});
