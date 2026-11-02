/**
 * Generates the SEO asset set from the brand palette.
 *
 * Run with: node scripts/generate-seo-assets.mjs
 *
 * The full logo wordmark is illegible at 48px, so the icon is the permitted
 * simplified wave mark: the brand blue tile with a white wave and sparkle, no
 * text. No new logo artwork is introduced beyond that simplification.
 *
 * Outputs:
 * - src/app/icon.png           (512, Next metadata icon)
 * - src/app/apple-icon.png     (180)
 * - src/app/favicon.ico        (48 + 96, PNG-compressed)
 * - public/icon-192.png        (manifest + schema logo)
 * - public/icon-512.png        (manifest + schema logo)
 * - public/og-image.png        (1200x630 social card)
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();

const markSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#00609a"/>
  <path d="M92 312 C 148 244, 208 244, 256 312 S 364 380, 420 312"
        fill="none" stroke="#ffffff" stroke-width="44" stroke-linecap="round"/>
  <path d="M132 380 C 178 330, 222 330, 256 380 S 334 430, 380 380"
        fill="none" stroke="#8ecbf3" stroke-width="26" stroke-linecap="round"/>
  <path d="M352 128 l11 27 27 11 -27 11 -11 27 -11 -27 -27 -11 27 -11z" fill="#bfe6ff"/>
</svg>`;

const ogSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f6fbff"/>
      <stop offset="1" stop-color="#e3f0fb"/>
    </linearGradient>
    <linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#00609a"/>
      <stop offset="1" stop-color="#59a9dd"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="76" y="300" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="700" fill="#0b2a4a">2nd Wave Laundry Services</text>
  <text x="76" y="368" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#00609a">A Redefined Laundry Experience.</text>
  <text x="76" y="438" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="#3d566e">Laundry, ironing &amp; fold · Stain treatment · Shoe care</text>
  <text x="76" y="482" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="#3d566e">Three branches in Ashaiman and Katamanso</text>
  <text x="76" y="548" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#0b2a4a">www.2ndwavelaundry.com</text>
  <path d="M0 590 C 150 545, 300 625, 450 590 S 750 555, 900 590 S 1120 625, 1200 590"
        fill="none" stroke="url(#wave)" stroke-width="12" stroke-linecap="round"/>
</svg>`;

/** ICO container with PNG payloads (supported by all current browsers). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, buffer } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += buffer.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buffer)]);
}

async function main() {
  const mark = await sharp(Buffer.from(markSvg)).png().toBuffer();
  const appDir = path.join(root, "src/app");
  const publicDir = path.join(root, "public");

  const icon512 = await sharp(mark).resize(512, 512).png().toBuffer();
  const icon192 = await sharp(mark).resize(192, 192).png().toBuffer();
  const apple180 = await sharp(mark).resize(180, 180).png().toBuffer();

  fs.writeFileSync(path.join(appDir, "icon.png"), icon512);
  fs.writeFileSync(path.join(appDir, "apple-icon.png"), apple180);
  fs.writeFileSync(path.join(publicDir, "icon-512.png"), icon512);
  fs.writeFileSync(path.join(publicDir, "icon-192.png"), icon192);

  const ico48 = await sharp(mark).resize(48, 48).png().toBuffer();
  const ico96 = await sharp(mark).resize(96, 96).png().toBuffer();
  fs.writeFileSync(
    path.join(appDir, "favicon.ico"),
    ico([
      { size: 48, buffer: ico48 },
      { size: 96, buffer: ico96 },
    ]),
  );

  const ogBase = await sharp(Buffer.from(ogSvg)).png().toBuffer();
  const ogLogo = await sharp(mark)
    .resize({ width: 132, height: 132, fit: "contain" })
    .png()
    .toBuffer();
  await sharp(ogBase)
    .composite([{ input: ogLogo, left: 76, top: 76 }])
    .png()
    .toFile(path.join(publicDir, "og-image.png"));

  console.log("SEO assets generated");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
