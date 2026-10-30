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

type GalleryRow = {
    key: string;
    payload: { media_id: string; alt: string; caption: string };
    published: boolean;
    sort_order: number;
};
type RpcGalleryRow = GalleryRow & { id: string; version: number };

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
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'gallery-admin@example.test')", [actor]);
    await db.query("INSERT INTO public.admin_profiles(user_id,role,display_name) VALUES($1,'full_admin','Gallery Test Admin')", [actor]);
});

after(async () => {
    await db.close();
});

async function createMedia(archived = false): Promise<string> {
    const id = randomUUID();
    await db.query(
        `INSERT INTO public.website_gallery_media
      (id,storage_path,public_url,name,alt,source,permission,archived)
     VALUES ($1,$2,$3,$4,'Gallery test image','Test fixture','Test permission',$5)`,
        [id, `media/${id}.webp`, `https://example.test/${id}.webp`, `${id}.webp`, archived],
    );
    return id;
}

async function replaceGallery(items: GalleryRow[], expectedVersions: Record<string, number>): Promise<RpcGalleryRow[]> {
    const { rows } = await db.query<{ result: RpcGalleryRow[] }>(
        "SELECT public.website_content_replace($1::uuid,'gallery',$2::jsonb,$3::jsonb) AS result",
        [actor, JSON.stringify(items), JSON.stringify(expectedVersions)],
    );
    return rows[0].result;
}

function row(key: string, mediaId: string, published = true, sortOrder = 1): GalleryRow {
    return {
        key,
        payload: { media_id: mediaId, alt: `Alt ${key}`, caption: "" },
        published,
        sort_order: sortOrder,
    };
}

test("gallery RPC supports reorder, hide, canonical versions, archived placements and removal", async () => {
    await db.query("DELETE FROM public.website_content WHERE module='gallery'");
    const mediaA = await createMedia();
    const mediaB = await createMedia();
    const placementA = "gallery-placement-a";
    const placementB = "gallery-placement-b";

    let saved = await replaceGallery(
        [row(placementA, mediaA, true, 1), row(placementB, mediaB, true, 2)],
        {},
    );
    assert.deepEqual(saved.map((item) => item.version), [1, 1]);

    // Reproduce the prior mapper bug: the table UUID is not record_key, so the
    // RPC treats both placements as deleted without their baseline versions.
    const { rows: databaseIds } = await db.query<{ record_key: string; id: string; version: number }>(
        "SELECT record_key,id,version FROM public.website_content WHERE module='gallery' AND record_key = ANY($1::text[])",
        [[placementA, placementB]],
    );
    const idByKey = new Map(databaseIds.map((item) => [item.record_key, item]));
    const incorrectlyKeyedRows = saved.map((item) => {
        const oldRow = idByKey.get(item.key)!;
        return row(oldRow.id, item.payload.media_id, item.published, item.sort_order);
    });
    await assert.rejects(
        replaceGallery(
            incorrectlyKeyedRows,
            Object.fromEntries(databaseIds.map((item) => [item.id, item.version])),
        ),
        (error: unknown) => {
            assert.match((error as Error).message, /CONTENT_CONFLICT/);
            assert.equal((error as { code?: string }).code, "PT409");
            return true;
        },
    );

    saved = await replaceGallery(
        [row(placementB, mediaB, true, 1), row(placementA, mediaA, true, 2)],
        Object.fromEntries(saved.map((item) => [item.key, item.version])),
    );
    assert.deepEqual(saved.map((item) => item.key), [placementB, placementA]);
    assert.deepEqual(saved.map((item) => item.version), [2, 2]);

    saved = await replaceGallery(
        [row(placementB, mediaB, true, 1), row(placementA, mediaA, false, 2)],
        Object.fromEntries(saved.map((item) => [item.key, item.version])),
    );
    assert.equal(saved.find((item) => item.key === placementA)?.published, false);
    assert.equal(saved.find((item) => item.key === placementA)?.version, 3);

    // The canonical versions returned from one save must be valid for the next save.
    saved = await replaceGallery(
        saved.map((item) => ({ ...item, sort_order: item.sort_order })),
        Object.fromEntries(saved.map((item) => [item.key, item.version])),
    );
    assert.deepEqual(saved.map((item) => item.version), [4, 4]);

    await db.query("UPDATE public.website_gallery_media SET archived = true WHERE id = $1", [mediaA]);
    saved = await replaceGallery(
        [row(placementB, mediaB, true, 1), row(placementA, mediaA, false, 2)],
        Object.fromEntries(saved.map((item) => [item.key, item.version])),
    );
    assert.equal(saved.find((item) => item.key === placementA)?.version, 5);
    assert.equal(saved.find((item) => item.key === placementA)?.published, false);

    const newArchivedMedia = await createMedia(true);
    await assert.rejects(
        replaceGallery(
            [row(placementB, mediaB, true, 1), row(placementA, mediaA, false, 2), row("new-archived", newArchivedMedia, true, 3)],
            { ...Object.fromEntries(saved.map((item) => [item.key, item.version])), "new-archived": 0 },
        ),
        (error: unknown) => {
            assert.match((error as Error).message, /CONTENT_INVALID/);
            assert.equal((error as { code?: string }).code, "22023");
            return true;
        },
    );

    // Deleted placements need their baseline version in the expected-version map.
    const remaining = await replaceGallery(
        [row(placementB, mediaB, true, 1)],
        Object.fromEntries(saved.map((item) => [item.key, item.version])),
    );
    assert.deepEqual(remaining.map((item) => item.key), [placementB]);
    const { rows: deletedRows } = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.website_content WHERE module='gallery' AND record_key=$1",
        [placementA],
    );
    assert.equal(deletedRows[0].count, 0);
});
