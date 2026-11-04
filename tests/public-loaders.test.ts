import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOG_LIST_COLUMNS,
  buildGalleryPhotos,
  dedupeGalleryPhotos,
  mapBlogPostRow,
  mapGalleryCollectionRows,
  mapPublicSiteSettings,
  mapServiceRow,
  referencedMediaIds,
  SERVICES_COLUMNS,
  summariseBlogRow,
  type GalleryPlacementRow,
  type ServiceRow,
} from "../src/lib/website/public-queries";

const serviceRow = (patch: Partial<ServiceRow> = {}): ServiceRow => ({
  slug: "suit-cleaning",
  title: "Suit Cleaning (database)",
  summary: "Database summary.",
  public_image: "",
  public_alt: "",
  bookable: true,
  sort_order: 8,
  ...patch,
});

test("cached display settings map pickup times from booking settings", () => {
  const settings = mapPublicSiteSettings(
    {
      business_email: "business@example.test",
      phone: "059 522 4280",
      whatsapp: "233595224280",
      instagram: "",
      tiktok: "",
      facebook: "",
      newsletter_visible: true,
    },
    { pickup_start: "07:30:00", pickup_end: "17:45:00" },
  );

  assert.equal(settings.pickupStart, "07:30");
  assert.equal(settings.pickupEnd, "17:45");
  assert.equal(settings.email, "business@example.test");

  const defaults = mapPublicSiteSettings(
    {
      business_email: null,
      phone: "",
      whatsapp: "",
      instagram: "",
      tiktok: "",
      facebook: "",
      newsletter_visible: false,
    },
    null,
  );
  assert.equal(defaults.pickupStart, "07:00");
  assert.equal(defaults.pickupEnd, "17:00");
});

test("services select never asks for section or public_body", () => {
  assert.equal(SERVICES_COLUMNS.includes("section"), false);
  assert.equal(SERVICES_COLUMNS.includes("public_body"), false);
  assert.ok(SERVICES_COLUMNS.includes("public_image"));
});

test("blog list select projects public metadata without transferring the post body", () => {
  assert.equal(BLOG_LIST_COLUMNS.includes("payload->>body"), false);
  assert.equal(BLOG_LIST_COLUMNS.includes("payload.body"), false);
  assert.ok(BLOG_LIST_COLUMNS.includes("summary:payload->>summary"));
  assert.ok(BLOG_LIST_COLUMNS.includes("author:payload->author"));
  assert.ok(BLOG_LIST_COLUMNS.includes("publishedAt:payload->>publishedAt"));
});

test("blog list summary has no body property", () => {
  const summary = summariseBlogRow({
    id: "row-id",
    record_key: "laundry-care",
    published: true,
    sort_order: 2,
    version: 3,
    title: "Laundry care",
    slug: "laundry-care",
    summary: "Care notes.",
    image: "https://example.test/image.jpg",
    alt: "Folded laundry",
  });
  assert.deepEqual(Object.keys(summary).sort(), [
    "alt",
    "id",
    "image",
    "order",
    "slug",
    "summary",
    "title",
    "version",
  ]);
  assert.equal("body" in summary, false);
});

test("blog list projects author and publication date while remaining body-free", () => {
  const summary = summariseBlogRow({
    id: "row-id",
    record_key: "author-notes",
    published: true,
    sort_order: 1,
    version: 7,
    title: "Author notes",
    slug: "author-notes",
    summary: "A short summary",
    image: "https://example.test/featured.jpg",
    alt: "Featured image",
    author: { name: "Sam", bio: "Writer", image: "https://example.test/profile.jpg" },
    publishedAt: "2026-10-01T09:00:00.000Z",
  });
  assert.equal(summary.author?.name, "Sam");
  assert.equal(summary.publishedAt, "2026-10-01T09:00:00.000Z");
  assert.equal("body" in summary, false);
});

test("gallery only keeps referenced, supplied (non-archived) media in placement order", () => {
  const placements: GalleryPlacementRow[] = [
    { id: "1", record_key: "p1", payload: { media_id: "b", alt: "Second", collection_key: "pressing" }, sort_order: 1 },
    { id: "2", record_key: "p2", payload: { media_id: "a", alt: "" }, sort_order: 2 },
    { id: "3", record_key: "p3", payload: { media_id: "archived", alt: "Gone" }, sort_order: 3 },
    { id: "4", record_key: "p4", payload: { media_id: "a", alt: "Duplicate", collection_key: "folding" }, sort_order: 4 },
  ];
  assert.deepEqual(referencedMediaIds(placements), ["b", "a", "archived"]);

  const tiles = buildGalleryPhotos(placements, [
    { id: "a", public_url: "https://example.test/a.jpg", alt: "Asset A" },
    { id: "b", public_url: "https://example.test/b.jpg", alt: "Asset B" },
  ]);

  // Collection membership comes from the stored collection_key, never alt text.
  assert.deepEqual(tiles, [
    { src: "https://example.test/b.jpg", alt: "Second", mediaId: "b", collections: ["pressing"] },
    { src: "https://example.test/a.jpg", alt: "Asset A", mediaId: "a", collections: [] },
    { src: "https://example.test/a.jpg", alt: "Duplicate", mediaId: "a", collections: ["folding"] },
  ]);

  // The same asset placed in two collections must appear once in the All view.
  assert.deepEqual(
    dedupeGalleryPhotos(tiles).map((tile) => tile.mediaId),
    ["b", "a"],
  );
});

test("public collections keep configured order and ignore unnamed rows", () => {
  const collections = mapGalleryCollectionRows([
    { id: "1", record_key: "laundry", payload: { name: "Laundry", description: "Everyday wash" }, sort_order: 1, version: 1, published: true },
    { id: "2", record_key: "blank", payload: { name: "   " }, sort_order: 2, version: 1, published: true },
    { id: "3", record_key: "shoe-care", payload: { name: "Shoe Care" }, sort_order: 3, version: 1, published: true },
  ]);
  assert.deepEqual(collections, [
    { id: "laundry", name: "Laundry", description: "Everyday wash" },
    { id: "shoe-care", name: "Shoe Care", description: "" },
  ]);
});

test("service mapping keeps built-in title and summary until the editor is wired", () => {
  const moved = mapServiceRow(serviceRow({ public_image: "https://example.test/db.jpg", public_alt: "DB alt" }), {
    slug: "suit-cleaning",
    section: "04.07",
    title: "Suit Cleaning",
    summary: "Arrange cleaning for your suits.",
    image: { src: "/images/suits.jpg", alt: "Suits" },
    focal: "left center",
    bookable: true,
  });

  assert.equal(moved.title, "Suit Cleaning");
  assert.equal(moved.summary, "Arrange cleaning for your suits.");
  assert.equal(moved.section, "04.07");
  assert.deepEqual(moved.image, {
    src: "https://example.test/db.jpg",
    alt: "DB alt",
  });

  const noBaseline = mapServiceRow(serviceRow({ slug: "new-service" }));
  assert.equal(noBaseline.section, "new-service");
  assert.equal(noBaseline.title, "Suit Cleaning (database)");
});

test("blog post mapping keeps the body for the article page", () => {
  const post = mapBlogPostRow({
    id: "row-id",
    record_key: "laundry-care",
    payload: { title: "Laundry care", summary: "Care notes.", body: "Full body." },
    sort_order: 1,
    version: 4,
    published: true,
  });
  assert.equal(post.body, "Full body.");
  assert.equal(post.slug, "laundry-care");
});

test("public Blog detail maps top-level published metadata, not a nested draft", () => {
  const post = mapBlogPostRow({
    id: "row-id",
    record_key: "published-post",
    payload: {
      title: "Published title",
      summary: "Published summary",
      body: "Published body",
      image: "https://example.test/featured.jpg",
      alt: "Featured",
      author: { name: "Published Author", bio: "Author biography", image: "https://example.test/profile.jpg" },
      publishedAt: "2026-10-01T09:00:00.000Z",
      modifiedAt: "2026-11-01T09:00:00.000Z",
      contentBlocks: [
        { type: "text", text: "First paragraph", order: 1 },
        { type: "image", mediaId: "media-1", src: "https://example.test/inline.jpg", alt: "Inline image", caption: "Caption", order: 2 },
      ],
      draft: { title: "Private draft title", body: "Private draft body" },
    },
    sort_order: 1,
    version: 8,
    published: true,
  });
  assert.equal(post.title, "Published title");
  assert.equal(post.body, "Published body");
  assert.equal(post.author?.name, "Published Author");
  assert.equal(post.publishedAt, "2026-10-01T09:00:00.000Z");
  assert.equal(post.modifiedAt, "2026-11-01T09:00:00.000Z");
  assert.deepEqual(post.contentBlocks?.map((block) => block.type), ["text", "image"]);
});
