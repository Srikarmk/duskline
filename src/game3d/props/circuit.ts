import * as THREE from "three";

// Procedural low-poly roadside props for the F1-style Grand Prix stadium
// circuit realm. Everything is crisply faceted (flatShading) to match
// makeStartGantry / makeRamp in ../objects.ts. Each builder returns a Group
// whose base sits on y=0; the engine places + rotates them toward the track.

// --- shared palette --------------------------------------------------------

const GREY_L = 0xc7ccd4; // modern concrete / cladding
const GREY = 0x9aa1ab;   // darker concrete
const STEEL = 0x5a6270;  // structural steel
const ASPHALT = 0x2e3238; // rubber / tarmac
const RED = 0xe23b3b;    // racing accent
const CYAN = 0x22d3ee;   // racing accent
const WHITE = 0xffffff;
const LAMP = 0xfffbe6;   // warm floodlight white
const FLAG = 0xfbbf24;   // marshal flag yellow

// assorted bright shirts for the crowd
const CROWD = [
  0xe23b3b, 0x22d3ee, 0xffffff, 0xfbbf24, 0x4ade80, 0xf472b6, 0x60a5fa, 0xf97316,
];

// --- helpers ---------------------------------------------------------------

/** A faceted standard material with sensible defaults for stadium props. */
function std(color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, flatShading: true, roughness: 0.85, metalness: 0.1, ...opts,
  });
}

/** A positioned box mesh — the workhorse for structural pieces. */
function box(
  w: number, h: number, d: number, mat: THREE.Material,
  x = 0, y = 0, z = 0
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// --- grandstand (hero prop) ------------------------------------------------

/** A packed spectator grandstand: a raked stepped seating wedge (open face
 *  toward +Z / the track) with a speckled multi-colour crowd instanced across
 *  every tier, under a bright cantilevered roof canopy on steel posts. */
export function makeGrandstand(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const W = 8;
  const nTiers = 6;
  const stepH = 0.7;
  const stepD = 0.72;
  const TD = nTiers * stepD; // total seating depth

  const concrete = std(GREY, { roughness: 0.95, metalness: 0 });
  const concreteDark = std(0x7c828d, { roughness: 0.95, metalness: 0 });
  const steel = std(STEEL, { metalness: 0.5, roughness: 0.5 });

  // ground pad
  g.add(box(W + 0.8, 0.3, TD + 0.9, concreteDark, 0, 0.15, 0));

  // raked seating: a stepped wedge — front (track side, +Z) low, back tall
  for (let i = 0; i < nTiers; i++) {
    const topY = (i + 1) * stepH;
    const zc = TD / 2 - stepD / 2 - i * stepD;
    g.add(box(W, topY, stepD, i % 2 ? concrete : concreteDark, 0, topY / 2, zc));
  }

  // crowd: rows of tiny multi-coloured people, instanced cheaply, one row per
  // tier sitting just behind that step's front lip
  const ppr = 16;
  const total = nTiers * ppr;
  const personGeo = new THREE.BoxGeometry(0.26, 0.5, 0.26);
  const personMat = std(WHITE, { roughness: 0.9, metalness: 0 });
  const crowd = new THREE.InstancedMesh(personGeo, personMat, total);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let idx = 0;
  for (let i = 0; i < nTiers; i++) {
    const topY = (i + 1) * stepH;
    const frontZ = TD / 2 - i * stepD;
    for (let p = 0; p < ppr; p++) {
      const sy = 0.85 + rand() * 0.6;
      const x = -W / 2 + 0.5 + (p / (ppr - 1)) * (W - 1) + (rand() - 0.5) * 0.12;
      const z = frontZ - 0.24 + (rand() - 0.5) * 0.1;
      dummy.position.set(x, topY + 0.25 * sy, z);
      dummy.scale.set(1, sy, 1);
      dummy.rotation.y = (rand() - 0.5) * 0.4;
      dummy.updateMatrix();
      crowd.setMatrixAt(idx, dummy.matrix);
      col.setHex(CROWD[Math.floor(rand() * CROWD.length)]);
      crowd.setColorAt(idx, col);
      idx++;
    }
  }
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  g.add(crowd);

  // roof: back support posts + a bright canopy that tilts down over the seats
  const roofY = nTiers * stepH + 1.4;
  for (const sx of [-1, 1]) {
    g.add(box(0.25, roofY, 0.25, steel, sx * (W / 2 - 0.3), roofY / 2, -TD / 2 + 0.2));
  }
  const canopy = new THREE.Group();
  canopy.add(box(W + 0.6, 0.18, TD + 0.9, std(GREY_L, { roughness: 0.6 }), 0, 0, 0));
  canopy.add(box(W + 0.6, 0.32, 0.2, std(RED, { roughness: 0.6 }), 0, -0.05, (TD + 0.9) / 2)); // front fascia
  canopy.position.set(0, roofY, -0.1);
  canopy.rotation.x = 0.16; // dip the front (+Z) edge toward the track
  g.add(canopy);

  return g;
}

// --- tyre barrier ----------------------------------------------------------

/** A classic run-off tyre wall: black rubber tyres stacked into a small
 *  pyramid, a few with a red/white painted top face. */
export function makeTyreStack(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const tyreGeo = new THREE.TorusGeometry(0.32, 0.13, 8, 12); // faceted ring, hole faces +Z
  const rubber = std(ASPHALT, { roughness: 0.9, metalness: 0.05 });
  const paints = [std(RED, { roughness: 0.7 }), std(WHITE, { roughness: 0.7 })];

  const D = 0.9;        // horizontal spacing between tyres
  const rowH = D * 0.85; // vertical stacking step
  const rows = 4;
  let y = 0.45;         // outer radius, so the base row rests on the ground
  for (let r = 0; r < rows; r++) {
    const count = rows - r; // 4, 3, 2, 1
    const rowW = (count - 1) * D;
    for (let c = 0; c < count; c++) {
      const painted = r === rows - 1 || rand() < 0.18;
      const mat = painted ? paints[Math.floor(rand() * paints.length)] : rubber;
      const t = new THREE.Mesh(tyreGeo, mat);
      t.position.set(-rowW / 2 + c * D, y, 0);
      t.rotation.z = rand() * Math.PI; // spin each ring for an organic stack
      g.add(t);
    }
    y += rowH;
  }

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

// --- stadium floodlight (landmark height) ----------------------------------

/** A tall stadium floodlight mast: a slim steel pole topped by an angled head
 *  of emissive warm-white lamp panels aimed down at the circuit. */
export function makeFloodlight(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const steel = std(STEEL, { metalness: 0.6, roughness: 0.4 });
  const dark = std(0x3a4049, { metalness: 0.5, roughness: 0.5 });

  const poleH = 11;
  g.add(box(1.3, 0.5, 1.3, dark, 0, 0.25, 0)); // foot
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, poleH, 8), steel);
  pole.position.y = 0.5 + poleH / 2;
  g.add(pole);

  // head: a housing panel carrying a grid of glowing lamps, tilted downward
  const head = new THREE.Group();
  head.add(box(2.4, 1.3, 0.35, dark, 0, 0, 0));
  const lampMat = new THREE.MeshStandardMaterial({
    color: LAMP, emissive: LAMP, emissiveIntensity: 0.9, flatShading: true, roughness: 0.4,
  });
  const lampGeo = new THREE.BoxGeometry(0.5, 0.5, 0.12);
  const cols = 4, rowsL = 2;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rowsL; j++) {
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(-0.85 + i * 0.57, 0.32 - j * 0.62, 0.2);
      head.add(lamp);
    }
  }
  head.position.set(0, 0.5 + poleH, 0);
  head.rotation.x = 0.35; // aim the lamps forward and down onto the track
  g.add(head);

  return g;
}

// --- pit / paddock building ------------------------------------------------

/** A low modern pit building: a long flat-roofed glass-and-steel block with a
 *  red/white striped fascia and a row of dark garage-door openings facing +Z. */
export function makePitBuilding(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const L = 9, D = 4, H = 4.4;
  const wall = std(GREY_L, { roughness: 0.7, metalness: 0.15 });
  const steel = std(STEEL, { metalness: 0.5, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x1b2a33, emissive: CYAN, emissiveIntensity: 0.12,
    metalness: 0.4, roughness: 0.2, flatShading: true,
  });
  const doorMat = std(ASPHALT, { roughness: 0.6, metalness: 0.2 });

  // main body + overhanging flat roof
  g.add(box(L, H, D, wall, 0, H / 2, 0));
  g.add(box(L + 0.6, 0.3, D + 0.6, steel, 0, H + 0.15, 0));

  // upper glass band on the front face
  g.add(box(L - 0.4, 1.1, 0.12, glass, 0, H - 1.0, D / 2 + 0.02));

  // striped fascia along the top-front edge (shared geo + two shared mats)
  const stripeN = 18;
  const sw = L / stripeN;
  const stripeGeo = new THREE.BoxGeometry(sw, 0.3, 0.12);
  const redStripe = std(RED, { roughness: 0.6 });
  const whiteStripe = std(WHITE, { roughness: 0.6 });
  for (let i = 0; i < stripeN; i++) {
    const s = new THREE.Mesh(stripeGeo, i % 2 ? redStripe : whiteStripe);
    s.position.set(-L / 2 + sw / 2 + i * sw, H + 0.35, D / 2 + 0.05);
    g.add(s);
  }

  // row of dark garage doors with a steel lintel each
  const doors = 5;
  const dw = 1.25, dh = 2.2;
  const gap = (L - doors * dw) / (doors + 1);
  for (let i = 0; i < doors; i++) {
    const x = -L / 2 + gap + dw / 2 + i * (dw + gap);
    g.add(box(dw, dh, 0.14, doorMat, x, dh / 2, D / 2 + 0.03));
    g.add(box(dw + 0.1, 0.12, 0.16, steel, x, dh + 0.1, D / 2 + 0.04));
  }

  return g;
}

// --- marshal post / advertising hoarding -----------------------------------

/** A trackside marshal board: an angled advertising panel on steel legs in a
 *  bright racing colour with white stripe graphics, plus a small yellow flag. */
export function makeMarshalBoard(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const steel = std(STEEL, { metalness: 0.6, roughness: 0.4 });
  const bright = rand() < 0.5 ? RED : CYAN;
  const panelMat = std(bright, { roughness: 0.6, metalness: 0.15 });
  const stripeMat = std(WHITE, { roughness: 0.6 });

  // legs + feet
  const legH = 1.5;
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, legH, 6), steel);
    leg.position.set(sx * 1.25, legH / 2, 0);
    leg.rotation.z = sx * 0.08;
    g.add(leg);
    g.add(box(0.35, 0.2, 0.35, steel, sx * 1.3, 0.1, 0));
  }

  // angled billboard panel with stripe graphics + a steel frame
  const panel = new THREE.Group();
  const PW = 3, PH = 1.6;
  panel.add(box(PW, PH, 0.14, panelMat, 0, 0, 0));
  panel.add(box(PW, 0.22, 0.03, stripeMat, 0, 0.45, 0.09));
  panel.add(box(PW, 0.22, 0.03, stripeMat, 0, -0.1, 0.09));
  panel.add(box(PW + 0.16, 0.12, 0.16, steel, 0, PH / 2 + 0.02, 0));
  panel.add(box(PW + 0.16, 0.12, 0.16, steel, 0, -PH / 2 - 0.02, 0));
  panel.position.set(0, legH + PH / 2, 0.15);
  panel.rotation.x = -0.22; // tilt the face up toward drivers
  g.add(panel);

  // small yellow flag on a slim pole at a top corner
  const flag = new THREE.Group();
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 5), steel);
  flagPole.position.y = 0.4;
  flag.add(flagPole);
  flag.add(box(0.55, 0.4, 0.04, std(FLAG, { roughness: 0.7, metalness: 0.05 }), 0.3, 0.7, 0));
  flag.position.set(PW / 2 - 0.1, legH + PH + 0.1, 0.1);
  g.add(flag);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}
