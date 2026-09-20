/**
 * A tripwire on the render settings that decide whether this game holds 60.
 *
 * WHY THIS EXISTS. The expensive knobs here are not the ones you would guess
 * from reading the code, and every one of them has been turned back on at
 * least once after being measured and turned off:
 *
 *  - GTAO cost a measured ~5.6 ms on a view already sitting at ~11 ms. That
 *    lands the frame exactly on the 16.6 ms line with zero margin, which is
 *    how you get stutter on anything slower than the machine it was measured
 *    on. It is a user toggle now, and it must DEFAULT OFF.
 *  - MSAA at 4x on a retina HDR target was a huge bandwidth cost for edges the
 *    post chain then resolves anyway. The composer target runs `samples: 0`.
 *  - The shadow map is the other big one, and it is per-tier.
 *
 * None of these break the build, the types or the lint. They are numbers that
 * look harmless in a diff and cost a third of the frame, so they get a test
 * that reads the actual values. If you are here because this test failed:
 * that is the point. Change the expectation deliberately, in the same commit,
 * with a measurement in the message — do not just make it pass.
 *
 * This is NOT a frame-time test. Frame time needs a GPU and real hardware, and
 * is still on the open list. This guards the inputs to it.
 *
 * Run: npm run test:render   (Node 22+, --experimental-strip-types)
 */
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * The QUALITY table, parsed out of the source rather than imported.
 *
 * settings.ts imports `./storage` extensionless, which is valid TypeScript and
 * not resolvable by Node's ESM loader — and adding a resolver hook to a
 * tripwire test is more machinery than the thing being tested. Reading the
 * literal is also closer to what this test is actually for: catching a changed
 * NUMBER in a diff, not exercising a module.
 */
function parseQuality() {
  const src = read("../src/ui/settings.ts");
  const body = src.slice(src.indexOf("export const QUALITY"));
  const out = {};
  for (const [, tier, fields] of body.matchAll(/(high|medium|low):\s*\{([^}]*)\}/g)) {
    out[tier] = {};
    for (const [, k, v] of fields.matchAll(/(\w+):\s*([\d.]+|true|false)/g)) {
      out[tier][k] = v === "true" ? true : v === "false" ? false : Number(v);
    }
  }
  return out;
}
const QUALITY = parseQuality();

let failed = 0;
const ok = (name, detail) => console.log(`  ok    ${name}${detail ? `  (${detail})` : ""}`);
const bad = (name, detail) => { failed++; console.log(`  FAIL  ${name}\n        ${detail}`); };

function eq(name, actual, expected) {
  if (actual === expected) ok(name, String(actual));
  else bad(name, `expected ${expected}, got ${actual}`);
}

function has(name, source, needle, why) {
  if (source.includes(needle)) ok(name);
  else bad(name, `could not find \`${needle}\` — ${why}`);
}

console.log("\nrender budget\n");

// --- quality tiers -------------------------------------------------------
// Locked as a table rather than as bounds, because the interesting failure is
// "someone bumped one number", not "someone set it to a thousand".
const TIERS = {
  high: { dprCap: 2, shadow: 4096, post: true, scenery: 1 },
  medium: { dprCap: 1.5, shadow: 2048, post: true, scenery: 0.6 },
  low: { dprCap: 1, shadow: 0, post: false, scenery: 0.35 },
};
for (const [tier, want] of Object.entries(TIERS)) {
  const got = QUALITY[tier];
  if (!got) { bad(`quality.${tier}`, "tier is missing entirely"); continue; }
  for (const [k, v] of Object.entries(want)) eq(`quality.${tier}.${k}`, got[k], v);
}

// `low` is the escape hatch for a machine that cannot hold 60. If it ever
// grows a shadow map or a post chain it stops being one.
if (QUALITY.low.shadow === 0 && QUALITY.low.post === false) {
  ok("low tier is still a real escape hatch");
} else {
  bad("low tier is still a real escape hatch",
    "low must keep shadows and post OFF — it is the fallback for slow hardware");
}

// --- the post chain ------------------------------------------------------
const engine = read("../src/game3d/engine.ts");

has("GTAO defaults OFF", engine, 'gtao.enabled = loadSetting("ao", false)',
  "GTAO measured ~5.6 ms on an ~11 ms frame; it must be opt-in");
has("composer target has MSAA off", engine, "samples: 0",
  "4x MSAA on a retina HDR target was a large bandwidth cost for nothing");

// A stray `samples: 4` on the composer target is the exact regression; GTAO's
// own sample counts are fine, so only flag it next to the render target.
const targetBlock = engine.slice(
  Math.max(0, engine.indexOf("type: THREE.HalfFloatType")),
  engine.indexOf("type: THREE.HalfFloatType") + 200,
);
if (/samples:\s*[1-9]/.test(targetBlock)) {
  bad("composer target has MSAA off", `MSAA re-enabled: ${targetBlock.match(/samples:\s*\d+/)[0]}`);
}

// Bloom is cheap at this strength and expensive if someone "turns it up".
const bloom = engine.match(/new UnrealBloomPass\(new THREE\.Vector2\([^)]*\),\s*([\d.]+)/);
if (!bloom) bad("bloom strength", "could not find the UnrealBloomPass construction");
else {
  const strength = Number(bloom[1]);
  if (strength <= 0.2) ok("bloom strength", String(strength));
  else bad("bloom strength", `${strength} — above 0.2 the whole image goes soft and the cost climbs`);
}

// Bloom runs at half resolution. Full-res bloom is a silent 4x on that pass.
has("bloom is half-resolution", engine, "this.bloomPass.setSize((w * dpr) / 2, (h * dpr) / 2)",
  "full-resolution bloom is four times the pixels for an effect nobody can see the difference in");

console.log(
  failed
    ? `\n✗ ${failed} render-budget check${failed === 1 ? "" : "s"} failed\n`
    : "\n✓ render budget holds\n",
);
process.exit(failed ? 1 : 0);
