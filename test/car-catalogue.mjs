/**
 * A tripwire on the car catalogue: fourteen cars of hand-authored numbers.
 *
 * WHY THIS EXISTS. A car is a rib table (eight rows of seven fractions), four
 * height landmarks, a cabin footprint and a handful of flags. None of it is
 * checked by the compiler beyond "these are numbers", and all of it is the
 * kind of thing that rots: a z-fraction out of order silently breaks the loft,
 * a cabin whose front is behind its rear produces a greenhouse inside out, a
 * width fraction over 1 pushes the body outside its own half-width.
 *
 * Every one of these has a real failure behind it. The bonnet creases went in
 * spanning a fixed fraction of the length and ran under the windscreen; the
 * loft has been broken before by ribs with different point counts. Numbers in
 * a table look harmless in a diff.
 *
 * Parsed out of the source rather than imported, the same way the render
 * budget is: cars.ts pulls in three.js and `three/examples/jsm/...`, and that
 * examples path is not in three's package exports, so plain Node cannot
 * resolve it. Reading the literals is also closer to what this is for —
 * catching a changed NUMBER, not exercising a module.
 *
 * Run: npm run test:cars
 */
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const cars = read("../src/game3d/cars.ts");
const data = read("../src/game3d/carData.ts");

let failed = 0;
const ok = (name, detail) => console.log(`  ok    ${name}${detail ? `  (${detail})` : ""}`);
const bad = (name, detail) => { failed++; console.log(`  FAIL  ${name}\n        ${detail}`); };

console.log("\ncar catalogue\n");

// --- the roster ----------------------------------------------------------
const ids = [...data.matchAll(/^  ([a-z0-9]+): \{$/gm)].map((m) => m[1]);
if (ids.length >= 10) ok("cars defined", String(ids.length));
else bad("cars defined", `only found ${ids.length} — the CAR_SPECS parse is wrong`);

// --- every car has a body, a rib table and a race number -----------------
const roadBlock = cars.slice(cars.indexOf("const ROAD_CARS"));
const raceNums = cars.slice(cars.indexOf("const RACE_NUM"), cars.indexOf("const RACE_NUM") + 400);
const missingBody = ids.filter((id) => !new RegExp(`^  ${id}: \\{`, "m").test(roadBlock));
const missingNum = ids.filter((id) => !new RegExp(`\\b${id}:\\s*\\d+`).test(raceNums));
if (!missingBody.length) ok("every car has a ROAD_CARS body");
else bad("every car has a ROAD_CARS body", `missing: ${missingBody.join(", ")}`);
if (!missingNum.length) ok("every car has a race number");
else bad("every car has a race number", `missing: ${missingNum.join(", ")}`);

// --- rib tables ----------------------------------------------------------
// Row = [zFrac, floorLift, wFloor, wMax, shoulderFrac, wDeck, deckFrac].
const tables = [...cars.matchAll(/const (RIBS_[A-Z0-9]+): RibRow\[\] = \[([\s\S]*?)\n\];/g)];
if (tables.length >= 10) ok("rib tables found", String(tables.length));
else bad("rib tables found", `only ${tables.length}`);

for (const [, name, body] of tables) {
  const rows = [...body.matchAll(/\[([^\]]+)\]/g)]
    .map((m) => m[1].split(",").map((v) => Number(v.trim())));

  if (rows.some((r) => r.length !== 7)) {
    bad(`${name} row width`, "every row must be exactly 7 numbers");
    continue;
  }
  if (rows.some((r) => r.some((v) => !Number.isFinite(v)))) {
    bad(`${name} numbers`, "a value is NaN");
    continue;
  }
  // The loft skins consecutive ribs, so the spine has to run nose to tail
  // without doubling back. Out-of-order z is the failure that produces a body
  // folded through itself, and it is invisible until you look from outside.
  const z = rows.map((r) => r[0]);
  const monotone = z.every((v, i) => i === 0 || v < z[i - 1]);
  if (!monotone) { bad(`${name} z order`, `not strictly nose-to-tail: ${z.join(", ")}`); continue; }
  if (z[0] !== 1 || z[z.length - 1] !== -1) {
    bad(`${name} z span`, `must run 1 to -1, got ${z[0]} to ${z[z.length - 1]}`);
    continue;
  }
  // width fractions are of the half-width: over 1 puts the body outside its
  // own bounding box and through the wheels
  const wide = rows.find((r) => r[2] > 1 || r[3] > 1 || r[5] > 1);
  if (wide) { bad(`${name} width fractions`, `a width exceeds 1: ${wide.join(", ")}`); continue; }
  ok(name, `${rows.length} ribs`);
}

// --- per-car landmarks ---------------------------------------------------
for (const id of ids) {
  const m = roadBlock.match(new RegExp(`^  ${id}: \\{([\\s\\S]*?)^  \\},`, "m"));
  if (!m) continue;
  const b = m[1];
  const num = (k) => {
    const g = b.match(new RegExp(`\\b${k}:\\s*(-?[\\d.]+)`));
    return g ? Number(g[1]) : NaN;
  };
  const sill = num("sillY"), shoulder = num("shoulderY"), deck = num("deckY"), roof = num("roofY");
  // A body is built between these four heights in this order. Swapping any
  // adjacent pair turns the section inside out.
  if (sill < shoulder && shoulder < deck && deck < roof) ok(`${id} landmarks ordered`);
  else bad(`${id} landmarks ordered`, `sill ${sill} < shoulder ${shoulder} < deck ${deck} < roof ${roof}`);

  // cabF is the cabin's FRONT z-fraction and cabR its rear; front must be
  // ahead of rear or the greenhouse is built backwards.
  const cabF = num("cabF"), cabR = num("cabR");
  if (cabF > cabR) ok(`${id} cabin front ahead of rear`);
  else bad(`${id} cabin front ahead of rear`, `cabF ${cabF} is not ahead of cabR ${cabR}`);
}

console.log(
  failed
    ? `\n✗ ${failed} car-catalogue check${failed === 1 ? "" : "s"} failed\n`
    : `\n✓ car catalogue holds (${ids.length} cars, ${tables.length} rib tables)\n`,
);
process.exit(failed ? 1 : 0);
