/**
 * Size budgets, checked against a real build.
 *
 * Two of this project's hardest-won wins are the kind that regress silently,
 * from a one-line change nobody would think twice about:
 *
 *  - **First-load JavaScript.** It was 405 kB because `GameApp` imported
 *    `GameCanvas` statically, so all of three.js shipped to display a menu
 *    that renders no triangles. A `dynamic()` import took it to 126 kB. Adding
 *    one ordinary top-level import of anything engine-adjacent puts it
 *    straight back, and nothing in the build output complains.
 *  - **Texture weight.** A first visit downloaded 12.1 MB; recompressing to
 *    WebP took it to 916 kB. Dropping a new full-resolution PNG into
 *    public/textures undoes that quietly.
 *
 * A draw-call budget would be better still, but that needs a GPU and this runs
 * on a CI box that has none. These two are pure file arithmetic, so they run
 * anywhere.
 *
 * Run: npm run test:budget   (after `next build`)
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const ROOT = process.cwd();
const NEXT = path.join(ROOT, ".next");

// Ceilings, not targets. Set with headroom over the current real numbers so
// this fails on a regression rather than on noise — and when it does fail, the
// question to ask is "what did I just import?", not "can I raise the limit?".
// These are THIS SCRIPT'S numbers, not the ones `next build` prints or the
// ones a browser reports. It sums the deduped /page + /layout chunk sets at
// gzip level 9, where the CDN serves brotli and the browser only loads what
// the HTML references — so this reads ~195 kB where the deployed site measures
// ~166 kB. That is fine: a regression detector only has to be consistent with
// itself, and pinning it to its own measure is what makes it reliable.
//
// Headroom is sized so that the failure this exists to catch — the Three.js
// engine getting pulled back into the initial chunk, which is +250 kB or more —
// trips it, while ordinary UI work does not.
const BUDGETS = {
  firstLoadJsKB: 230,      // currently ~195 by this script's measure
  texturesKB: 1600,        // currently ~1338
  previewsKB: 600,         // currently ~389
};

if (!existsSync(NEXT)) {
  console.error("✖ no .next build found — run `npm run build` first");
  process.exit(1);
}

const failures = [];
const report = [];

// --- first-load JavaScript --------------------------------------------------
// The scripts the document itself pulls in, which is what stands between a
// visitor and an interactive menu. Chunks fetched later on demand (the engine)
// are deliberately not counted — moving weight there is the entire point.
const manifest = JSON.parse(await readFile(path.join(NEXT, "app-build-manifest.json"), "utf8"));
const pageFiles = new Set([...(manifest.pages?.["/page"] ?? []), ...(manifest.pages?.["/layout"] ?? [])]);

// A dev server writes to the same .next/, and its chunks are unminified and
// unhashed — measuring those reports ~3 MB and means nothing. Refuse rather
// than report a number that looks like a catastrophic regression.
if ([...pageFiles].some((f) => /chunks\/(app\/)?(page|layout|main-app)\.js$/.test(f))) {
  console.error("✖ .next holds a DEV build (unhashed chunk names).");
  console.error("  Stop the dev server, then: rm -rf .next && npm run build && npm run test:budget");
  process.exit(1);
}
let firstLoad = 0;
for (const rel of pageFiles) {
  if (!rel.endsWith(".js")) continue;
  const file = path.join(NEXT, rel);
  if (!existsSync(file)) continue;
  firstLoad += gzipSync(await readFile(file)).length;
}
const firstLoadKB = Math.round(firstLoad / 1024);
report.push(["first-load JS (gzipped)", firstLoadKB, BUDGETS.firstLoadJsKB]);
if (firstLoadKB > BUDGETS.firstLoadJsKB) {
  failures.push(
    `first-load JS is ${firstLoadKB} kB, over the ${BUDGETS.firstLoadJsKB} kB budget. ` +
      `The usual cause is a new top-level import that drags the Three.js engine back into ` +
      `the initial chunk — check what app/components/GameApp.tsx reaches at module scope.`,
  );
}

// --- shipped art ------------------------------------------------------------
async function dirKB(dir, exts) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const f of await readdir(dir)) {
    if (!exts.some((e) => f.endsWith(e))) continue;
    total += (await stat(path.join(dir, f))).size;
  }
  return Math.round(total / 1024);
}

const texKB = await dirKB(path.join(ROOT, "public", "textures"), [".webp", ".jpg", ".png"]);
report.push(["public/textures", texKB, BUDGETS.texturesKB]);
if (texKB > BUDGETS.texturesKB) {
  failures.push(
    `public/textures is ${texKB} kB, over the ${BUDGETS.texturesKB} kB budget. ` +
      `Sources belong in assets/textures; run \`npm run textures\` to regenerate the shipped WebP.`,
  );
}

const prevKB = await dirKB(path.join(ROOT, "public", "previews"), [".webp"]);
report.push(["public/previews (webp)", prevKB, BUDGETS.previewsKB]);
if (prevKB > BUDGETS.previewsKB) {
  failures.push(`public/previews is ${prevKB} kB, over the ${BUDGETS.previewsKB} kB budget.`);
}

for (const [what, actual, budget] of report) {
  const slack = budget - actual;
  console.log(`  ${actual > budget ? "✖" : "ok"}  ${what.padEnd(26)} ${String(actual).padStart(5)} kB / ${budget} kB  (${slack >= 0 ? slack + " kB spare" : -slack + " kB OVER"})`);
}

if (failures.length) {
  console.error(`\n✖ ${failures.length} budget${failures.length > 1 ? "s" : ""} exceeded:\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log("\n✓ all size budgets hold");
