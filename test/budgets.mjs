/**
 * Size budgets, checked against a real build.
 *
 * Two of this project's hardest-won wins are the kind that regress silently,
 * from a one-line change nobody would think twice about:
 *
 *  - **First-load JavaScript.** Measured from the PRERENDERED DOCUMENT, not
 *    from a build manifest. That distinction is the whole history of this
 *    check: it used to sum `app-build-manifest.json`'s chunk set for /page and
 *    /layout, which reported ~195 kB and passed happily while the emitted HTML
 *    referenced the three.js chunk as an `async <script>` the browser fetched
 *    on first paint. The manifest and the document disagreed, and the document
 *    is what the browser obeys. Next 16 then stopped emitting that manifest
 *    entirely and this test crashed — silently, because `npm test` never ran
 *    it and only CI did, so it sat red for seven commits.
 *
 *    Scripts marked `nomodule` are skipped, because a modern browser skips
 *    them; counting the legacy polyfill bundle would inflate the number by
 *    ~38 kB that nobody downloads.
 *
 *    It also fails outright if any of those scripts IS three.js. For a month
 *    the engine shipped on first paint and was written off as unavoidable;
 *    the cause was one static import (src/ui/warm.ts → game3d/textures.ts)
 *    reaching three from the home screen, which no `dynamic()` can undo.
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
  // Currently ~159 kB, with three.js OUT (it was ~234 with it in — see the
  // __THREE__ check below, which is the real guard for that). Headroom for
  // ordinary UI work, not enough to hide another library.
  firstLoadJsKB: 185,      // currently ~159 by this script's measure
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
const DOC = path.join(NEXT, "server", "app", "index.html");
if (!existsSync(DOC)) {
  console.error("✖ no prerendered document at .next/server/app/index.html");
  console.error("  Stop the dev server, then: rm -rf .next && npm run build && npm run test:budget");
  process.exit(1);
}
const html = await readFile(DOC, "utf8");
let firstLoad = 0;
const seen = new Set();
const threeIn = [];
for (const [, pre, src, post] of html.matchAll(/<script([^>]*)src="([^"]+)"([^>]*)>/g)) {
  if (!src.startsWith("/_next/") || !src.endsWith(".js")) continue;
  if (/nomodule/i.test(pre + post)) continue;      // a modern browser will not fetch it
  if (seen.has(src)) continue;
  seen.add(src);
  const file = path.join(NEXT, src.slice("/_next".length));
  if (!existsSync(file)) continue;
  const body = await readFile(file);
  firstLoad += gzipSync(body, { level: 9 }).length;
  // three.js registers itself on `window.__THREE__`; the string survives
  // minification and appears only in the library's core chunk.
  if (body.includes("__THREE__")) threeIn.push(src);
}
if (seen.size < 3) {
  console.error(`✖ only ${seen.size} first-load scripts found — the document parse is wrong`);
  process.exit(1);
}
if (threeIn.length) {
  failures.push(
    `three.js is on first paint (${threeIn.join(", ")}). Something the home screen ` +
      `imports at module scope reaches "three" — find it before the player has even ` +
      `picked a car. Last time it was src/ui/warm.ts importing game3d/textures.ts.`,
  );
}
const firstLoadKB = Math.round(firstLoad / 1024);
report.push(["first-load JS (gzipped)", firstLoadKB, BUDGETS.firstLoadJsKB]);
if (firstLoadKB > BUDGETS.firstLoadJsKB) {
  failures.push(
    `first-load JS is ${firstLoadKB} kB, over the ${BUDGETS.firstLoadJsKB} kB budget. ` +
      `The usual cause is a new top-level import pulling another library into the ` +
      `initial chunk — check what app/page.tsx reaches at module scope, and remember ` +
      `that a dynamic() import is not on its own enough to keep something out.`,
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
