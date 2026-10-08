import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const root = path.resolve(
  "../review/reimport/source/2ND_WAVE_FRONTEND_HANDOFF",
);
const out = path.resolve(".");
for (const dir of ["public/images", "src/data", "docs/source"])
  fs.mkdirSync(path.join(out, dir), { recursive: true });
for (const file of fs.readdirSync(path.join(root, "TECHNICAL DOCS")))
  fs.copyFileSync(
    path.join(root, "TECHNICAL DOCS", file),
    path.join(out, "docs/source", file),
  );
fs.copyFileSync(
  path.join(root, "00_REFERENCE/2nd Wave logo.png"),
  path.join(out, "public/images/logo.png"),
);
const text = fs.readFileSync(
  path.join(root, "TECHNICAL DOCS/CONTENT LIGHTMODE.md"),
  "utf8",
);
const sections = {};
let id = "";
let pendingQ = "";
for (const line of text.split("\n")) {
  const heading = line.match(/^#{2,3} (\d{2}(?:\.\d{2})?)\.?(?:\s)(.*)/);
  if (heading) {
    id = heading[1];
    sections[id] = { heading: heading[2], fields: {}, faq: [] };
  }
  if (!id) continue;
  const item = line.match(/^- ([^:]+): (.*)$/);
  if (item) {
    const [, key, value] = item;
    if (key === "Q") pendingQ = value;
    else if (key === "A") sections[id].faq.push({ q: pendingQ, a: value });
    else sections[id].fields[key] = value;
  }
}
fs.writeFileSync(
  path.join(out, "src/data/content.json"),
  JSON.stringify(sections, null, 2),
);
const walk = (d) =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
    );
const cache = new Map();
for (const file of fs.readdirSync("../review/reimport/cache")) {
  try {
    const v = JSON.parse(
      fs.readFileSync("../review/reimport/cache/" + file, "utf8"),
    );
    cache.set(v.url, v);
  } catch {}
}
const decode = (s) =>
  s.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
const assets = {};
const report = [];
const written = new Map();
for (const file of walk(root).filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(file, "utf8");
  const list = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const attrs = Object.fromEntries(
      [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]),
    );
    if (
      !attrs.src ||
      /logo|brand|official/i.test(attrs.alt || attrs["data-alt"] || "")
    )
      continue;
    let v = cache.get(attrs.src);
    if (!v || !v.headers?.["content-type"]?.startsWith("image/")) continue;
    const hash = crypto
      .createHash("sha256")
      .update(attrs.src)
      .digest("hex")
      .slice(0, 16);
    const ext = v.headers["content-type"].includes("png")
      ? "png"
      : v.headers["content-type"].includes("webp")
        ? "webp"
        : "jpg";
    const local = "/images/" + hash + "." + ext;
    if (!written.has(local)) {
      fs.writeFileSync(
        path.join(out, "public", local),
        Buffer.from(v.body, "base64"),
      );
      written.set(local, true);
      report.push({
        local,
        source: attrs.src,
        reference: path.relative(root, file),
        status:
          "Design-reference photography; verify rights and approval before launch",
      });
    }
    list.push({
      src: local,
      alt: attrs.alt || attrs["data-alt"] || "Garment care detail",
    });
  }
  assets[
    path.basename(path.dirname(file)) +
      (path.basename(file) === "code.html" ? "" : "/" + path.basename(file))
  ] = list;
}
fs.writeFileSync(
  path.join(out, "src/data/assets.json"),
  JSON.stringify(assets, null, 2),
);
fs.writeFileSync(
  path.join(out, "docs/asset-provenance.json"),
  JSON.stringify(report, null, 2),
);
// Use the clean, complete reference mark recovered from the approved handoff.
// The original standalone logo export contains rendering artefacts.
const cleanLogo = path.join(out, "public/images/5d437e594444af24.png");
if (fs.existsSync(cleanLogo))
  fs.copyFileSync(cleanLogo, path.join(out, "public/images/logo.png"));
for (const v of cache.values())
  if (
    v.url?.includes("fonts.googleapis.com") &&
    Buffer.from(v.body, "base64").toString().includes("Plus Jakarta Sans")
  ) {
    const css = Buffer.from(v.body, "base64").toString();
    const latin = css.split("/* latin */").at(-1);
    const u = latin?.match(/url\(([^)]+)\)/)?.[1];
    const font = cache.get(u);
    if (font) {
      fs.writeFileSync(
        path.join(out, "public/plus-jakarta-sans.woff2"),
        Buffer.from(font.body, "base64"),
      );
      break;
    }
  }
console.log({
  sections: Object.keys(sections).length,
  images: written.size,
  font: fs.existsSync("public/plus-jakarta-sans.woff2"),
  sources: Object.entries(assets)
    .filter(([, v]) => v.length)
    .map(([k, v]) => [k, v.length]),
});
