import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_TAGS,
  PUBLIC_WRITE_TAGS,
  type PublicWrite,
} from "../src/lib/website/revalidation-tags";
import { writeAndRevalidate } from "../src/lib/website/revalidation";

test("every public write invalidates exactly its own tag family", () => {
  const expected: Record<PublicWrite, string[]> = {
    faqs: ["site-faq"],
    gallery: ["site-gallery"],
    media: ["site-gallery"],
    content: ["site-blog"],
    promotion: ["site-promotions"],
    service: ["site-services"],
    location: ["site-branches"],
    settings: ["site-settings"],
  };

  for (const [write, tags] of Object.entries(expected) as [PublicWrite, string[]][]) {
    assert.deepEqual([...PUBLIC_WRITE_TAGS[write]], tags, write);
  }
});

test("tag names match the cached loaders' tags", () => {
  assert.deepEqual(
    Object.values(PUBLIC_TAGS).sort(),
    [
      "site-blog",
      "site-branches",
      "site-faq",
      "site-gallery",
      "site-promotions",
      "site-services",
      "site-settings",
    ],
  );
});

test("services and locations are invalidated, not silently skipped", () => {
  assert.ok(PUBLIC_WRITE_TAGS.service.length > 0);
  assert.ok(PUBLIC_WRITE_TAGS.location.length > 0);
  assert.notDeepEqual(PUBLIC_WRITE_TAGS.service, PUBLIC_WRITE_TAGS.location);
});

test("a settings save expires the site-settings tag immediately", async () => {
  const paths: Array<string | [string, string]> = [];
  const tags: string[] = [];
  await writeAndRevalidate(
    async () => "saved",
    [["/", "layout"]],
    (path, type) => {
      paths.push(type ? [path, type] : path);
    },
    PUBLIC_WRITE_TAGS.settings,
    (tag) => {
      tags.push(tag);
    },
  );
  assert.deepEqual(paths, [["/", "layout"]]);
  assert.deepEqual(tags, ["site-settings"]);
});

test("a failed save expires nothing", async () => {
  const tags: string[] = [];
  await assert.rejects(
    writeAndRevalidate(
      async () => {
        throw new Error("CONTENT_CONFLICT");
      },
      [],
      () => {},
      PUBLIC_WRITE_TAGS.settings,
      (tag) => {
        tags.push(tag);
      },
    ),
    /CONTENT_CONFLICT/,
  );
  assert.deepEqual(tags, []);
});
