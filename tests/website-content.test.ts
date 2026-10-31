import test from "node:test";
import assert from "node:assert/strict";
import {
  activePromotion,
  getBlogPosts,
  getDemoSnapshot,
  getFaqs,
  getGallery,
  getLocations,
  getPromotions,
  getServices,
  moderateReview,
  repository,
  saveFaqs,
  saveGallery,
  saveLocation,
  saveMedia,
  savePromotion,
  transitionPromotion,
  visibleGalleryPlacements,
} from "../src/lib/mock-store";
import {
  faqErrors,
  galleryError,
  locationError,
  promotionBadge,
  promotionCtaError,
  promotionError,
  safeHttpUrl,
  telHref,
} from "../src/lib/rules";
import {
  codeManagedModules,
  contentModules,
  resolveContentRoute,
} from "../src/components/admin/content/content-config";
import { adminNav, branches, publicNav, services } from "../src/lib/content";
import type { FaqItem } from "../src/lib/contracts";
import { toGallery, toPromotion } from "../src/lib/website/types";
import { buildPromotionView, formatPromotionEndDate } from "../src/lib/website/promotion-view";
import { validatePromotionServiceSlug } from "../src/lib/website/promotion-service-validation";
import {
  detectPromotionImageMime,
  promotionImageError,
  promotionImageUploadError,
} from "../src/lib/website/promotion-image";
import { promotionLinkSelection } from "../src/lib/website/promotion-form";
import { splitBranded } from "../src/lib/brand-highlight";
import { readFileSync } from "node:fs";
import { writeAndRevalidate } from "../src/lib/website/revalidation";

function promotionFromPayload(payload: Record<string, unknown>) {
  return toPromotion({
    id: "promotion-test",
    key: "promotion-test",
    module: "promotion",
    payload,
    published: true,
    sort_order: 1,
    version: 1,
  });
}

test("six modules, code-managed routes and review relocation", () => {
  assert.deepEqual(
    contentModules.map((m) => m.slug),
    ["services", "locations", "gallery", "blog", "faqs", "promotions"],
  );
  assert.deepEqual(
    contentModules.map((m) => m.action),
    [
      "Manage Services",
      "Manage Locations",
      "Manage Gallery",
      "Manage Articles",
      "Manage FAQs",
      "Manage Promotions",
    ],
  );
  assert.deepEqual(
    contentModules.filter((m) => m.publicationStates).map((m) => m.slug),
    ["services", "blog", "promotions"],
  );
  assert.deepEqual(
    contentModules.filter((m) => m.createLabel).map((m) => m.createLabel),
    ["New Service", "New Article", "New Promotion"],
  );
  assert.deepEqual(
    codeManagedModules.map((m) => m.slug),
    ["homepage", "about", "policy-pages"],
  );
  assert.deepEqual(resolveContentRoute([]), { kind: "dashboard" });
  const branch = resolveContentRoute(["locations", "katamanso-no-1"]);
  assert.equal(branch.kind, "module");
  if (branch.kind === "module") {
    assert.equal(branch.module.slug, "locations");
    assert.equal(branch.id, "katamanso-no-1");
  }
  assert.equal(resolveContentRoute(["reviews"]).kind, "reviews-moved");
  const serviceRoute = resolveContentRoute(["services"]);
  assert.equal(serviceRoute.kind, "module");
  if (serviceRoute.kind === "module") {
    assert.equal(serviceRoute.module.slug, "services");
  }
  assert.equal(resolveContentRoute(["homepage"]).kind, "code-managed");
  assert.equal(resolveContentRoute(["unknown"]).kind, "not-found");
});
test("admin navigation separates reviews from website content", () => {
  assert.ok(
    adminNav.some(
      ([label, href]) => label === "Reviews" && href === "/admin/reviews",
    ),
  );
  assert.ok(
    adminNav.some(
      ([label, href]) =>
        label === "Website Content" && href === "/admin/content",
    ),
  );
  assert.ok(
    !adminNav.some(([label]) =>
      ["Homepage", "About", "Services", "Policy Pages"].includes(label),
    ),
  );
  assert.equal(publicNav.length, 10);
  assert.equal(branches.length, 3);
});
test("branch records seed ordered and structured", () => {
  const locations = getLocations();
  assert.equal(locations.length, 3);
  assert.deepEqual(
    locations.map((l) => l.order),
    [1, 2, 3],
  );
  assert.ok(locations.every((l) => l.hours.length > 0));
  assert.ok(locations.every((l) => l.slug === l.id));
});
test("service records seed from the approved catalogue", () => {
  const records = getServices();
  assert.equal(records.length, services.length);
  assert.deepEqual(
    records.map((r) => r.id),
    services.map((s) => s.slug),
  );
  assert.ok(records.every((r) => r.status === "Published" && r.published));
  services.forEach((service, i) => {
    assert.equal(records[i].title, service.title);
    assert.equal(records[i].summary, service.summary);
    assert.equal(records[i].image, service.image?.src ?? "");
    assert.ok(records[i].published?.body, `${service.slug} has no body`);
    assert.equal(records[i].sort, i + 1);
  });
});
test("branch validation rejects incomplete records", () => {
  const branch = structuredClone(getLocations()[0]);
  assert.equal(locationError(branch), "");
  assert.match(locationError({ ...branch, name: " " }), /branch name/);
  assert.match(locationError({ ...branch, phone: "123" }), /valid phone/);
  assert.match(
    locationError({ ...branch, map: "https://example.com" }),
    /Google or Apple Maps/,
  );
  assert.match(
    locationError({ ...branch, hours: [["", "7am–8pm"]] }),
    /label for every/,
  );
  assert.match(
    locationError({ ...branch, hours: [["Mon", "closed"]] }),
    /7am–8pm/,
  );
});
test("branch saves commit once and reject stale versions", async () => {
  const branch = structuredClone(getLocations()[0]);
  const saved = await saveLocation({ ...branch, label: "Primary branch" });
  assert.equal(saved.version, branch.version + 1);
  assert.equal(getLocations()[0].label, "Primary branch");
  await assert.rejects(saveLocation(branch), /changed while/);
  await assert.rejects(
    saveLocation({ ...saved, name: "" }),
    /branch name/,
  );
});
test("gallery mapper uses record_key as the placement identity", () => {
  const placement = toGallery(
    {
      id: "table-row-uuid",
      key: "gallery-record-key",
      module: "gallery",
      payload: { media_id: "media-uuid", alt: "Image", caption: "Caption" },
      published: true,
      sort_order: 1,
      version: 7,
    },
    {},
  );
  assert.equal(placement.id, "gallery-record-key");
  assert.equal(placement.version, 7);
});
test("gallery placements reference available media", () => {
  const rows = getGallery();
  assert.ok(rows.length >= 5);
  assert.ok(rows.every((r) => r.available));
  assert.ok(rows.every((r) => r.asset && r.asset.id === r.placement.mediaId));
  assert.ok(rows.every((r) => r.placement.visible));
});
test("gallery validation rejects missing alt text and bad order", () => {
  assert.match(
    galleryError([{ mediaId: "media-gallery-1", alt: "", order: 1 }]),
    /alt text/,
  );
  assert.match(
    galleryError([{ mediaId: "", alt: "Described", order: 1 }]),
    /media asset/,
  );
  assert.match(
    galleryError([{ mediaId: "media-gallery-1", alt: "Described", order: 0 }]),
    /display orders/,
  );
});
test("gallery saves normalise order and reject unavailable assets", async () => {
  const rows = getGallery();
  const reordered = rows
    .map((r) => ({ ...r.placement, order: r.placement.order + 10 }))
    .reverse();
  const saved = await saveGallery(reordered);
  assert.equal(saved.length, rows.length);
  assert.deepEqual(
    saved.map((s) => s.order),
    saved.map((_, i) => i + 1),
  );
  await assert.rejects(
    saveGallery([
      {
        id: "ghost-placement",
        mediaId: "missing-media",
        alt: "Ghost",
        caption: "",
        order: 1,
        visible: true,
        version: 0,
      },
    ]),
    /unavailable/,
  );
  await assert.rejects(
    saveGallery([{ ...saved[0], version: 0 }]),
    /changed while/,
  );
});
test("hidden placements leave the visible gallery", async () => {
  const before = visibleGalleryPlacements().length;
  const rows = getGallery();
  const saved = await saveGallery(
    rows.map((r, i) => ({ ...r.placement, visible: i !== 0 })),
  );
  assert.equal(visibleGalleryPlacements().length, before - 1);
  await saveGallery(saved.map((s) => ({ ...s, visible: true })));
  assert.equal(visibleGalleryPlacements().length, before);
});
test("FAQ seeds are enabled, unique and ordered", () => {
  const faqs = getFaqs();
  assert.ok(faqs.length >= 5);
  assert.deepEqual(
    faqs.map((f) => f.order),
    faqs.map((_, i) => i + 1),
  );
  assert.ok(faqs.every((f) => f.enabled));
  assert.ok(faqs.every((f) => f.question.trim() && f.answer.trim()));
});
test("FAQ validation rejects blanks and duplicate questions", () => {
  const blank: FaqItem = {
    id: "x",
    question: "",
    answer: "Answer",
    order: 1,
    enabled: true,
    version: 1,
  };
  const noAnswer: FaqItem = {
    id: "y",
    question: "Unique question?",
    answer: " ",
    order: 2,
    enabled: true,
    version: 1,
  };
  const dupA: FaqItem = {
    id: "d1",
    question: "What is 2nd Wave?",
    answer: "A",
    order: 1,
    enabled: true,
    version: 1,
  };
  const dupB: FaqItem = {
    id: "d2",
    question: "what is 2nd wave",
    answer: "B",
    order: 2,
    enabled: true,
    version: 1,
  };
  assert.match(faqErrors([blank]), /question/);
  assert.match(faqErrors([noAnswer]), /answer/);
  assert.match(faqErrors([dupA, dupB]), /unique/);
  assert.equal(faqErrors([dupA]), "");
});
test("FAQ saves commit reorders and reject stale versions", async () => {
  const faqs = getFaqs();
  const reversed = [...faqs]
    .reverse()
    .map((f, i) => ({ ...f, order: i + 1 }));
  const saved = await saveFaqs(reversed);
  assert.equal(saved[0].id, faqs[faqs.length - 1].id);
  assert.ok(saved.every((f, i) => f.order === i + 1));
  await assert.rejects(
    saveFaqs([{ ...saved[0], version: 0 }]),
    /changed while/,
  );
});
test("loaded FAQ saves its record key and version", () => {
  const source = readFileSync(
    "src/components/admin/content/faq-manager.tsx",
    "utf8",
  );
  assert.match(source, /record_key: string/);
  assert.match(
    source,
    /id: row\.record_key,[\s\S]*order: row\.sort_order, version: row\.version/,
  );
  const loaded = {
    id: "database-uuid",
    record_key: "04.00-02",
    payload: { question: "Multiple services?", answer: "Yes." },
    sort_order: 2,
    version: 1,
  };
  const savedInput = {
    id: loaded.record_key,
    question: loaded.payload.question,
    answer: loaded.payload.answer,
    order: loaded.sort_order,
    enabled: true,
    version: loaded.version,
  };
  assert.equal(savedInput.id, "04.00-02");
  assert.equal(savedInput.version, 1);
});
test("public revalidation runs after a successful save", async () => {
  const paths: string[] = [];
  const saved = await writeAndRevalidate(
    async () => "saved",
    ["/", "/blog", "/blog/article-slug"],
    path => paths.push(path),
  );
  assert.equal(saved, "saved");
  assert.deepEqual(paths, ["/", "/blog", "/blog/article-slug"]);
});
test("public revalidation does not run when the save fails", async () => {
  const paths: string[] = [];
  await assert.rejects(
    writeAndRevalidate(
      async () => {
        throw new Error("CONTENT_CONFLICT");
      },
      ["/", "/faq"],
      path => paths.push(path),
    ),
    /CONTENT_CONFLICT/,
  );
  assert.deepEqual(paths, []);
});
test("public revalidation failures cannot fail a successful save", () => {
  assert.doesNotThrow(() =>
    writeAndRevalidate(
      async () => "saved",
      ["/"],
      () => {
        throw new Error("revalidation failed");
      },
    ),
  );
});
test("promotion validation guards dates, links and confirmation", () => {
  assert.match(
    promotionError({ start: "2026-12-01", end: "2026-11-01" }),
    /valid start/,
  );
  assert.match(
    promotionError({ start: "not-a-date", end: "also-bad" }),
    /valid start/,
  );
  assert.match(
    promotionError({ start: "2026-11-01", end: "2026-12-01" }, "activate"),
    /Confirm the offer dates/,
  );
  assert.equal(
    promotionError(
      { start: "2026-11-01", end: "2026-12-01", yearConfirmed: true },
      "activate",
    ),
    "",
  );
  assert.equal(safeHttpUrl("javascript:alert(1)"), false);
  assert.equal(safeHttpUrl("https://example.com/offer"), true);
  assert.equal(telHref("059 522 4280"), "tel:+233595224280");
});
test("promotions preserve optional images while legacy records remain unchanged", () => {
  const legacy = toPromotion({
    id: "promotion-legacy",
    key: "promotion-legacy",
    module: "promotion",
    payload: { heading: "Legacy offer" },
    published: true,
    sort_order: 1,
    version: 1,
  });
  assert.equal(legacy.imageUrl, undefined);
  assert.equal(legacy.imageAlt, undefined);
  assert.equal(legacy.serviceSlug, undefined);
  const live = toPromotion({
    id: "promotion-image",
    key: "promotion-image",
    module: "promotion",
    payload: {
      heading: "Image offer",
      imageUrl: "https://project.supabase.co/storage/v1/object/public/marketing-assets/promotions/offer.jpg",
      imageAlt: "Folded laundry",
      serviceSlug: "wash-ironing-fold",
    },
    published: true,
    sort_order: 1,
    version: 2,
  });
  assert.equal(live.imageAlt, "Folded laundry");
  assert.equal(live.serviceSlug, "wash-ironing-fold");
  assert.match(readFileSync("src/components/published-content.tsx", "utf8"), /promotion-image/);
});
test("promotion card view omits empty live service, terms, exclusions and CTA", () => {
  const view = buildPromotionView(
    promotionFromPayload({
      heading: "Offer headline",
      body: "Offer body",
      terms: "",
      exclusions: "",
      serviceSlug: "",
      ctaLabel: "",
      ctaHref: "",
    }),
    [],
    false,
  );
  assert.equal(view.eyebrow, undefined);
  assert.equal(view.terms, "");
  assert.equal(view.exclusions, "");
  assert.equal(view.showDetails, false);
  assert.equal(view.cta, undefined);
  assert.doesNotMatch(
    [view.heading, view.body, view.terms, view.exclusions, view.eyebrow ?? ""].join("\n"),
    /Wash, Ironing & Fold|Large items, bedding|Offer exclusions|40%|The team confirms whether/,
  );
  const source = readFileSync("src/components/published-content.tsx", "utf8");
  assert.match(source, /view\.showDetails &&/);
  assert.match(source, /title=\{view\.heading\}/);
  assert.equal((source.match(/view\.cta &&/g) ?? []).length, 2);
});
test("promotion view resolves bookable services, custom CTAs and safe fallbacks", () => {
  const service = { slug: "duvet-and-bedding-cleaning", name: "Duvet Care", bookable: true };
  const base = {
    heading: "Bedding offer",
    body: "Clean bedding,\nfresh start.",
    serviceSlug: service.slug,
    ctaLabel: "",
    ctaHref: "",
    terms: "",
    exclusions: "",
  };
  const attached = buildPromotionView(promotionFromPayload(base), [service], false);
  assert.equal(attached.eyebrow, "Duvet Care");
  assert.deepEqual(attached.cta, {
    label: "Book Duvet Care",
    href: "/book?service=duvet-and-bedding-cleaning",
  });
  assert.equal(attached.body, base.body);

  const custom = buildPromotionView(
    promotionFromPayload({ ...base, ctaLabel: "Claim offer", ctaHref: "/contact" }),
    [service],
    false,
  );
  assert.deepEqual(custom.cta, { label: "Claim offer", href: "/contact" });

  const unavailable = buildPromotionView(promotionFromPayload(base), [], false);
  assert.equal(unavailable.eyebrow, undefined);
  assert.equal(unavailable.cta, undefined);
  const unbookable = buildPromotionView(
    promotionFromPayload(base),
    [{ ...service, bookable: false }],
    false,
  );
  assert.equal(unbookable.eyebrow, undefined);
  assert.equal(unbookable.cta, undefined);
});
test("promotion dialog view uses the record's date, terms and exclusions", () => {
  const record = promotionFromPayload({
    heading: "Record-owned title",
    body: "First line\nSecond line",
    terms: "Terms from this offer",
    exclusions: "Exclusions from this offer",
    end: "2027-01-31T23:59",
  });
  const view = buildPromotionView(record, [], false);
  assert.equal(view.heading, "Record-owned title");
  assert.equal(view.body, "First line\nSecond line");
  assert.equal(view.terms, "Terms from this offer");
  assert.equal(view.exclusions, "Exclusions from this offer");
  assert.equal(view.endDate, "31 January 2027");
  assert.equal(view.showDetails, true);
  assert.equal(formatPromotionEndDate(""), "");
  const source = readFileSync("src/components/published-content.tsx", "utf8");
  assert.match(source, /<h2>\{view\.heading\}<\/h2>/);
  assert.match(source, /title=\{view\.heading\}/);
});
test("promotion service validation accepts empty, rejects unavailable and fails closed", async () => {
  let lookups = 0;
  assert.equal(await validatePromotionServiceSlug("", async () => {
    lookups += 1;
    return false;
  }), undefined);
  assert.equal(lookups, 0);
  assert.equal(await validatePromotionServiceSlug(" bookable ", async (slug) => {
    lookups += 1;
    return slug === "bookable";
  }), "bookable");
  await assert.rejects(
    validatePromotionServiceSlug("missing-service", async () => false),
    /The attached service is no longer available\./,
  );
  await assert.rejects(
    validatePromotionServiceSlug("lookup-error", async () => {
      throw new Error("database unavailable");
    }),
    /The attached service is no longer available\./,
  );
  assert.match(
    readFileSync("src/lib/website/actions.ts", "utf8"),
    /validatePromotionServiceSlug\(item\.serviceSlug/,
  );
});
test("promotion image save validation requires the project asset URL and alt text", () => {
  const base = {
    imageUrl: "https://project.supabase.co/storage/v1/object/public/marketing-assets/promotions/offer.jpg",
    imageAlt: "Folded laundry",
  };
  assert.match(
    promotionImageError({ ...base, imageUrl: "https://example.com/offer.jpg" }, "https://project.supabase.co"),
    /marketing-assets/,
  );
  assert.match(
    promotionImageError({ ...base, imageAlt: " " }, "https://project.supabase.co"),
    /alt text/,
  );
  assert.equal(promotionImageError(base, "https://project.supabase.co"), "");
});
test("promotion upload validation checks bytes, MIME and size", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
  assert.equal(detectPromotionImageMime(jpeg), "image/jpeg");
  assert.match(
    promotionImageUploadError(
      { name: "offer.jpeg", type: "image/jpeg", size: 4 },
      detectPromotionImageMime(jpeg),
    ),
    /^$/,
  );
  assert.match(
    promotionImageUploadError(
      { name: "offer.jpg", type: "image/jpeg", size: 4 },
      null,
    ),
    /valid JPEG/,
  );
  assert.match(
    promotionImageUploadError(
      { name: "offer.png", type: "image/jpeg", size: 4 },
      detectPromotionImageMime(jpeg),
    ),
    /extension/,
  );
  assert.match(
    promotionImageUploadError(
      { name: "offer.jpg", type: "image/jpeg", size: 2 * 1024 * 1024 + 1 },
      detectPromotionImageMime(jpeg),
    ),
    /2 MB/,
  );
});
test("promotion form preserves legacy placement and maps supported links", () => {
  const legacy = toPromotion({
    id: "legacy-top",
    key: "legacy-top",
    module: "promotion",
    payload: { placement: "TOP", heading: "Legacy" },
    published: false,
    sort_order: 1,
    version: 1,
  });
  assert.equal(legacy.placement, "TOP");
  assert.equal(promotionLinkSelection("/book"), "/book");
  assert.equal(promotionLinkSelection("https://example.com/offer"), "custom");
  assert.equal(promotionLinkSelection(""), "");
});
test("promotion buttons may be empty but must be complete when used", () => {
  assert.equal(promotionCtaError({ ctaLabel: "", ctaHref: "" }), "");
  assert.match(
    promotionCtaError({ ctaLabel: "Book now", ctaHref: "" }),
    /both a button label and a link/,
  );
  assert.match(
    promotionCtaError({ ctaLabel: "", ctaHref: "/book" }),
    /both a button label and a link/,
  );
  assert.equal(
    promotionCtaError({ ctaLabel: "Book now", ctaHref: "/book" }),
    "",
  );
});
test("FAQ branded button tokens render as branded text and preserve legacy glow", () => {
  assert.deepEqual(splitBranded("Start [[brand]]today[[/brand]]"), [
    { text: "Start ", match: false },
    { text: "today", match: true },
  ]);
  assert.ok(
    splitBranded("Contact 2nd Wave Laundry", "Contact").some(
      (part) => part.text === "Contact" && part.match,
    ),
  );
});
test("promotion badge derives display state from status and window", () => {
  assert.equal(
    promotionBadge({ status: "draft", start: "", end: "" }),
    "Draft",
  );
  assert.equal(
    promotionBadge({ status: "paused", start: "2020-01-01", end: "2020-02-01" }),
    "Paused",
  );
  assert.equal(
    promotionBadge({ status: "ended", start: "2020-01-01", end: "2020-02-01" }),
    "Ended",
  );
  assert.equal(
    promotionBadge({
      status: "active",
      start: "2099-01-01T00:00",
      end: "2099-02-01T00:00",
    }),
    "Scheduled",
  );
  assert.equal(
    promotionBadge({
      status: "active",
      start: "2020-01-01T00:00",
      end: "2099-12-31T00:00",
    }),
    "Active",
  );
  assert.equal(
    promotionBadge({
      status: "active",
      start: "2020-01-01T00:00",
      end: "2020-02-01T00:00",
    }),
    "Ended",
  );
});
test("promotion drafts stay in the website content namespace", async () => {
  assert.equal(getPromotions().length, 0);
  const draft = await savePromotion({
    id: "",
    internalTitle: "Launch offer",
    heading: "Half price wash",
    body: "Demo campaign body.",
    terms: "One use per customer.",
    exclusions: "Not with other offers.",
    start: "2099-01-01T09:00",
    end: "2099-01-31T09:00",
    placement: "Homepage",
    priority: 1,
    ctaLabel: "Book now",
    ctaHref: "https://example.com/book",
    enabled: false,
    yearConfirmed: false,
    status: "draft",
    version: 0,
  });
  assert.ok(draft.id);
  assert.equal(draft.version, 1);
  assert.equal(draft.status, "draft");
  assert.equal(getPromotions().length, 1);
  assert.ok(
    getDemoSnapshot().content.every((c) => c.module === "Services"),
  );
});
test("promotion transitions enforce lifecycle and confirmation", async () => {
  const draft = getPromotions()[0];
  await assert.rejects(
    transitionPromotion(draft.id, draft.version, "resume"),
    /paused/,
  );
  await assert.rejects(
    transitionPromotion(draft.id, draft.version, "activate"),
    /Confirm the offer dates/,
  );
  const confirmed = await savePromotion({ ...draft, yearConfirmed: true });
  await assert.rejects(
    transitionPromotion(draft.id, draft.version, "activate"),
    /changed while/,
  );
  const activated = await transitionPromotion(
    confirmed.id,
    confirmed.version,
    "activate",
  );
  assert.equal(activated.status, "scheduled");
  const paused = await transitionPromotion(
    activated.id,
    activated.version,
    "pause",
  );
  assert.equal(paused.status, "paused");
  const resumed = await transitionPromotion(
    paused.id,
    paused.version,
    "resume",
  );
  assert.equal(resumed.status, "scheduled");
  const ended = await transitionPromotion(
    resumed.id,
    resumed.version,
    "end",
  );
  assert.equal(ended.status, "ended");
  await assert.rejects(
    transitionPromotion(ended.id, ended.version, "resume"),
    /paused/,
  );
  await assert.rejects(
    transitionPromotion(ended.id, ended.version, "delete-draft"),
    /Only draft/,
  );
});
test("only draft promotions can be deleted", async () => {
  const second = await savePromotion({
    id: "",
    internalTitle: "Scratch campaign",
    heading: "Scratch",
    body: "Draft body.",
    terms: "",
    exclusions: "",
    start: "2099-03-01T09:00",
    end: "2099-03-15T09:00",
    placement: "",
    priority: 0,
    ctaLabel: "",
    ctaHref: "",
    enabled: false,
    yearConfirmed: false,
    status: "draft",
    version: 0,
  });
  const removed = await transitionPromotion(
    second.id,
    second.version,
    "delete-draft",
  );
  assert.equal(removed.id, second.id);
  assert.ok(!getPromotions().some((p) => p.id === second.id));
});
test("active promotion selector respects the enabled flag", async () => {
  const record = await savePromotion({
    id: "",
    internalTitle: "Live campaign",
    heading: "Live",
    body: "Body.",
    terms: "",
    exclusions: "",
    start: "2020-01-01T00:00",
    end: "2099-12-31T00:00",
    placement: "",
    priority: 0,
    ctaLabel: "",
    ctaHref: "",
    enabled: false,
    yearConfirmed: true,
    status: "draft",
    version: 0,
  });
  const live = await transitionPromotion(record.id, record.version, "activate");
  assert.equal(live.status, "active");
  assert.equal(activePromotion(), undefined);
  const enabled = await savePromotion({ ...live, enabled: true });
  assert.equal(activePromotion()?.id, enabled.id);
});
test("media still placed in the gallery cannot be archived", async () => {
  const placement = getGallery()[0].placement;
  const asset = getDemoSnapshot().media.find(
    (m) => m.id === placement.mediaId,
  )!;
  await assert.rejects(saveMedia({ ...asset, archived: true }), /still in use/);
  assert.equal(
    getDemoSnapshot().media.find((m) => m.id === asset.id)?.archived,
    false,
  );
});
test("review moderation keeps the leads flow and consent rule", async () => {
  const blocked = await repository.createLead(
    "review",
    { name: "Sample reviewer", review: "Lovely service.", consent: "no" },
    crypto.randomUUID(),
  );
  await assert.rejects(
    moderateReview(blocked.id, "approved"),
    /Publication permission/,
  );
  await moderateReview(blocked.id, "rejected");
  assert.equal(
    getDemoSnapshot().leads.find((l) => l.id === blocked.id)?.status,
    "rejected",
  );
  const allowed = await repository.createLead(
    "review",
    { name: "Second reviewer", review: "Fast turnaround.", consent: "yes" },
    crypto.randomUUID(),
  );
  await moderateReview(allowed.id, "approved");
  assert.equal(
    getDemoSnapshot().leads.find((l) => l.id === allowed.id)?.status,
    "approved",
  );
  await assert.rejects(
    moderateReview("missing-record", "approved"),
    /unavailable/,
  );
});
test("website content never publishes into public demo content", () => {
  const snapshot = getDemoSnapshot();
  assert.ok(snapshot.content.every((c) => c.module === "Services"));
  assert.deepEqual(getBlogPosts(), []);
  assert.equal(snapshot.websiteContent.locations.length, 3);
  assert.ok(snapshot.websiteContent.gallery.length > 0);
  assert.ok(snapshot.websiteContent.faqs.length > 0);
  assert.equal(branches.length, 3);
  assert.equal(publicNav.length, 10);
});
