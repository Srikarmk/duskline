/**
 * Recompress the Poly Haven textures to WebP.
 *
 * A first visit downloaded 12.1 MB across 18 texture files — measured on the
 * live site, and by far the biggest thing standing between someone clicking a
 * link and driving a car. They were full-resolution JPEGs, and the normal maps
 * were the worst of it (foliage_nor alone was 1.37 MB).
 *
 * Two levers, applied per map TYPE rather than uniformly, because the three
 * kinds of map tolerate compression very differently:
 *
 *   _diff  albedo, seen directly      -> half size, q78. Lossy is fine; this
 *                                        is tiled over a whole hillside and
 *                                        never seen at 1:1.
 *   _nor   a VECTOR per texel         -> half size, q92. Compression error in
 *                                        a normal map is not a soft edge, it
 *                                        is lighting that points the wrong
 *                                        way, so it gets the quality budget.
 *   _arm   AO/rough/metal, data       -> quarter size, q80. The lowest
 *                                        frequency information in the set;
 *                                        roughness varies slowly.
 *
 * Run: npm run textures
 * Sources live in assets/textures (in git, NOT in public/, so 18 MB of
 * originals are not uploaded to the CDN on every deploy); output lands in
 * public/textures. Reproducible, never destructive.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC = path.join(process.cwd(), "assets", "textures");
const OUT = path.join(process.cwd(), "public", "textures");

const RECIPES = {
  _diff: { scale: 0.5, quality: 78 },
  _nor: { scale: 0.5, quality: 92 },
  _arm: { scale: 0.25, quality: 80 },
};

function recipeFor(file) {
  for (const [suffix, r] of Object.entries(RECIPES)) {
    if (file.includes(suffix)) return r;
  }
  return { scale: 0.5, quality: 80 };
}

const files = (await readdir(SRC)).filter((f) => f.endsWith(".jpg"));
let before = 0;
let after = 0;

for (const file of files) {
  const src = path.join(SRC, file);
  const out = path.join(OUT, file.replace(/\.jpg$/, ".webp"));
  const { scale, quality } = recipeFor(file);

  const img = sharp(src);
  const meta = await img.metadata();
  const width = Math.max(256, Math.round(meta.width * scale));

  await img.resize({ width, withoutEnlargement: true }).webp({ quality, effort: 6 }).toFile(out);

  const [a, b] = await Promise.all([stat(src), stat(out)]);
  before += a.size;
  after += b.size;
  const pct = Math.round((1 - b.size / a.size) * 100);
  console.log(
    `${file.padEnd(28)} ${String(meta.width).padStart(5)}px ${(a.size / 1024).toFixed(0).padStart(5)} KB` +
      ` ->  ${String(width).padStart(5)}px ${(b.size / 1024).toFixed(0).padStart(5)} KB  (-${pct}%)`,
  );
}

console.log(
  `\n${files.length} files: ${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB ` +
    `(-${Math.round((1 - after / before) * 100)}%)`,
);

/**
 * The realm preview cards, too.
 *
 * Step 1 of setup shows twelve of these at once, and because they are card
 * art rather than tiled surfaces they all load together — 660 KB in one go.
 * The .jpg originals stay: they are what the dev capture route writes, and
 * social scrapers want a JPEG for the OG image.
 */
const PREV = path.join(process.cwd(), "public", "previews");
const previews = (await readdir(PREV)).filter((f) => f.endsWith(".jpg"));
let pBefore = 0;
let pAfter = 0;
for (const file of previews) {
  const src = path.join(PREV, file);
  const out = src.replace(/\.jpg$/, ".webp");
  await sharp(src).webp({ quality: 74, effort: 6 }).toFile(out);
  const [a, b] = await Promise.all([stat(src), stat(out)]);
  pBefore += a.size;
  pAfter += b.size;
}
console.log(
  `${previews.length} previews: ${(pBefore / 1024).toFixed(0)} KB -> ${(pAfter / 1024).toFixed(0)} KB ` +
    `(-${Math.round((1 - pAfter / pBefore) * 100)}%)`,
);
