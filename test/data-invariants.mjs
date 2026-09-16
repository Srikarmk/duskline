/**
 * Invariants over the realm data and the files it points at.
 *
 * Every bug this guards against has actually shipped here:
 *
 *  - Six realms were added without a ground-texture mapping and silently fell
 *    through to `ground_forest`, a dark green woodland floor. `groundTint` is a
 *    multiply, so it can only darken — which is why the snow pass rendered
 *    olive and the deserts rendered mossy, and why it took a screenshot to
 *    notice.
 *  - Realms were added without preview art, so the picker showed flat colour
 *    swatches where every other card had a render.
 *  - The textures moved from .jpg to .webp; a missed file is an untextured
 *    white surface, discovered mid-race.
 *
 * None of these break the build or the types. They are data pointing at files,
 * which is exactly the kind of mistake a compiler cannot see — so it gets a
 * test that reads the actual directory.
 *
 * Run: npm run test:data   (Node 22+, --experimental-strip-types)
 */
import { existsSync } from "node:fs";
import path from "node:path";

const { REALMS, REALM_LORE, groundTextureFor } = await import("../src/game3d/realms.ts");

const ROOT = process.cwd();
const MAPS = ["diff", "nor", "arm"];
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  return ok;
};

const ids = Object.keys(REALMS);
const offered = ids.filter((id) => !REALMS[id].hidden);

console.log(`${ids.length} realms defined, ${offered.length} offered on the picker\n`);

// --- every offered realm needs card art, in both formats ---------------------
// .webp is what the picker loads; .jpg is the source the dev capture route
// writes and what social scrapers want for the OG image.
for (const id of offered) {
  for (const ext of ["webp", "jpg"]) {
    check(
      existsSync(path.join(ROOT, "public", "previews", `realm-${id}.${ext}`)),
      `realm "${id}" (${REALMS[id].name}) has no preview art: public/previews/realm-${id}.${ext}`,
    );
  }
}

// --- every realm needs a ground albedo, and it has to exist on disk ----------
for (const id of ids) {
  const ground = groundTextureFor(id);
  check(ground, `realm "${id}" resolves to no ground texture`);
  for (const map of MAPS) {
    check(
      existsSync(path.join(ROOT, "public", "textures", `${ground}_${map}.webp`)),
      `realm "${id}" wants ground "${ground}" but public/textures/${ground}_${map}.webp is missing`,
    );
  }
}

// A realm that is not in the map falls back to ground_forest. That fallback
// exists so a typo degrades instead of crashing — but an OFFERED realm relying
// on it is the exact bug described above, so say so.
const FOREST_BY_DESIGN = new Set(["forest", "castle", "circuit"]);
for (const id of offered) {
  if (groundTextureFor(id) === "ground_forest" && !FOREST_BY_DESIGN.has(id)) {
    failures.push(
      `realm "${id}" is using the ground_forest fallback — add it to GROUND in realms.ts ` +
        `(a green albedo cannot be tinted to snow or sand: the tint is a multiply)`,
    );
  }
}

// --- the shared texture sets every race loads -------------------------------
for (const set of ["road", "rock", "metal", "bark", "foliage"]) {
  for (const map of MAPS) {
    check(
      existsSync(path.join(ROOT, "public", "textures", `${set}_${map}.webp`)),
      `shared texture set "${set}" is missing public/textures/${set}_${map}.webp`,
    );
  }
}

// --- palettes and copy ------------------------------------------------------
for (const id of ids) {
  const r = REALMS[id];
  check(Array.isArray(r.palette?.sky) && r.palette.sky.length >= 4,
    `realm "${id}" needs at least 4 sky stops (the dome gradient reads 4)`);
  check(typeof r.name === "string" && r.name.length > 0, `realm "${id}" has no name`);
  if (!r.hidden) {
    check(typeof r.blurb === "string" && r.blurb.length > 0,
      `realm "${id}" is on the picker with no blurb — the card would show a title and empty space`);
    check(typeof REALM_LORE[id] === "string" && REALM_LORE[id].length > 0,
      `realm "${id}" is on the picker with no lore — step 4 would show an empty panel`);
  }
}

if (failures.length) {
  console.error(`✖ ${failures.length} problem${failures.length > 1 ? "s" : ""}:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ all realm data invariants hold (${ids.length} realms, ${offered.length} with art)`);
