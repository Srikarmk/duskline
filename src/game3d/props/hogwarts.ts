import * as THREE from "three";

// --- Hogwarts / Harry-Potter easter-egg props ------------------------------
// Procedural, faceted low-poly landmarks for the castle realm, built to match
// the style of makeTree / makeTower / makeRamp elsewhere in the engine: seeded
// rand(), MeshStandardMaterial + flatShading, emissive glow (the scene runs
// UnrealBloom), every group's base sitting on y = 0. Each builder returns a
// THREE.Group and applies its own random rotation.y where orientation matters.

// palette ------------------------------------------------------------------
const STONE = 0x8a8f99;       // weathered grey castle stone
const STONE_DARK = 0x6f747e;  // darker weathered stone
const STONE_DEEP = 0x4c505a;  // deep shadowed stone
const SLATE = 0x3b3a5c;       // slate-blue/purple roof
const SLATE_DARK = 0x2c2b47;  // darker slate roof
const ROCK = 0x565a63;        // rocky castle base
const GOLD = 0xe6c458;        // heraldic / Snitch gold
const WIN_WARM = 0xffcf8a;    // warm lit window / stained glass
const FLAME = 0xff7a1a;       // emissive candle flame
const SCARLET = 0x8f1d1d;     // Hogwarts Express deep scarlet
const SCARLET_BRIGHT = 0xb02a2a;
const CREAM = 0xe8dcc4;       // carriage cream trim
const BLACK = 0x15151b;       // funnel / wheels / ironwork
const BRASS = 0xc9a24a;       // boiler bands / domes
const BARK = 0x3a2c1e;        // willow bark
const BARK_DARK = 0x2a2016;   // darker willow bark tips
const LEAF = 0x2f4a2a;        // sparse dark willow leaves
const SILVER = 0xd8dde6;      // Snitch wings

// shared materials (faceted low-poly, safe to reuse across every instance) ---
const matStone = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.9, flatShading: true });
const matStoneDark = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.9, flatShading: true });
const matStoneDeep = new THREE.MeshStandardMaterial({ color: STONE_DEEP, roughness: 0.9, flatShading: true });
const matSlate = new THREE.MeshStandardMaterial({ color: SLATE, roughness: 0.8, flatShading: true });
const matSlateDark = new THREE.MeshStandardMaterial({ color: SLATE_DARK, roughness: 0.8, flatShading: true });
const matRock = new THREE.MeshStandardMaterial({ color: ROCK, roughness: 1, flatShading: true });
const matGold = new THREE.MeshStandardMaterial({ color: GOLD, emissive: 0x6e5410, emissiveIntensity: 0.45, metalness: 0.6, roughness: 0.35, flatShading: true });
const matGoldGlow = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: GOLD, emissiveIntensity: 1.5, metalness: 0.4, roughness: 0.3, flatShading: true });
const matWinLit = new THREE.MeshStandardMaterial({ color: WIN_WARM, emissive: WIN_WARM, emissiveIntensity: 1.15, roughness: 0.6, flatShading: true });
const matStainPurple = new THREE.MeshStandardMaterial({ color: 0xc9a6ff, emissive: 0x8b5cf6, emissiveIntensity: 1.1, roughness: 0.6, flatShading: true });
const matStainRed = new THREE.MeshStandardMaterial({ color: 0xff9a9a, emissive: SCARLET_BRIGHT, emissiveIntensity: 1.0, roughness: 0.6, flatShading: true });
const matFlame = new THREE.MeshStandardMaterial({ color: 0xffd08a, emissive: FLAME, emissiveIntensity: 1.7, roughness: 0.5, flatShading: true });
const matFlameCore = new THREE.MeshStandardMaterial({ color: 0xffedb0, emissive: 0xffb04a, emissiveIntensity: 2.1, flatShading: true });
const matScarlet = new THREE.MeshStandardMaterial({ color: SCARLET, roughness: 0.6, metalness: 0.1, flatShading: true });
const matScarletBright = new THREE.MeshStandardMaterial({ color: SCARLET_BRIGHT, roughness: 0.55, metalness: 0.1, flatShading: true });
const matCream = new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.7, flatShading: true });
const matBlack = new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.7, metalness: 0.2, flatShading: true });
const matBrass = new THREE.MeshStandardMaterial({ color: BRASS, metalness: 0.7, roughness: 0.35, flatShading: true });
const matBark = new THREE.MeshStandardMaterial({ color: BARK, roughness: 1, flatShading: true });
const matBarkDark = new THREE.MeshStandardMaterial({ color: BARK_DARK, roughness: 1, flatShading: true });
const matLeaf = new THREE.MeshStandardMaterial({ color: LEAF, roughness: 1, flatShading: true });
const matSilver = new THREE.MeshStandardMaterial({ color: SILVER, metalness: 0.4, roughness: 0.4, transparent: true, opacity: 0.5, side: THREE.DoubleSide, flatShading: true });
const matWax = new THREE.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.6, flatShading: true });
const matPole = new THREE.MeshStandardMaterial({ color: 0x5a4a30, roughness: 0.9, flatShading: true });
const matDoorWood = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9, flatShading: true });
const matSteam = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, emissive: 0xcdd0d6, emissiveIntensity: 0.55, roughness: 1, flatShading: true, transparent: true, opacity: 0.9 });

const UP = new THREE.Vector3(0, 1, 0);

// --- shared low-poly helpers ----------------------------------------------

/** A ring of merlons (crenellations) with gaps around a circular tower top. */
function addMerlonRing(
  g: THREE.Group, cx: number, cz: number, y: number, radius: number, count: number, mat: THREE.Material
): void {
  const geo = new THREE.BoxGeometry(radius * 0.5, 0.6, 0.4);
  for (let i = 0; i < count; i += 2) {
    const a = (i / count) * Math.PI * 2;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius);
    m.rotation.y = -a;
    g.add(m);
  }
}

/** Crenellations spaced around the square top of a tower/hall block. */
function addSquareMerlons(
  g: THREE.Group, cx: number, cz: number, y: number, half: number, mat: THREE.Material
): void {
  const geo = new THREE.BoxGeometry(0.42, 0.55, 0.42);
  const per = 3;
  const pts: [number, number][] = [];
  for (let i = 0; i < per; i++) {
    const t = -half + 2 * half * (i / (per - 1));
    pts.push([t, -half], [t, half], [-half, t], [half, t]);
  }
  pts.forEach((p, idx) => {
    if (idx % 2 !== 0) return;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx + p[0], y, cz + p[1]);
    g.add(m);
  });
}

/** Scatter small warm-lit windows around a round tower shaft. */
function addTowerWindows(
  g: THREE.Group, cx: number, cz: number, baseY: number, top: number, radius: number, rand: () => number
): void {
  const geo = new THREE.BoxGeometry(0.26, 0.48, 0.16);
  const rows = 2 + Math.floor(rand() * 2);
  const cols = 5;
  for (let r = 0; r < rows; r++) {
    const wy = baseY + (top - baseY) * (0.32 + r * 0.24);
    for (let c = 0; c < cols; c++) {
      if (rand() < 0.4) continue; // some windows stay dark
      const a = (c / cols) * Math.PI * 2 + rand() * 0.2;
      const m = new THREE.Mesh(geo, matWinLit);
      m.position.set(cx + Math.cos(a) * radius * 0.99, wy, cz + Math.sin(a) * radius * 0.99);
      m.rotation.y = Math.PI / 2 - a;
      g.add(m);
    }
  }
}

/** A round stone tower: tapered shaft, corbel ring, crenellations, tall pointed
 *  conical slate roof, warm-lit windows and (optionally) a thin spire finial.
 *  Returns the apex height. */
function addRoundTower(
  g: THREE.Group, cx: number, cz: number, baseY: number, height: number, radius: number,
  rand: () => number, spire: boolean
): number {
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.9, radius, height, 8), matStone);
  shaft.position.set(cx, baseY + height / 2, cz);
  g.add(shaft);

  const top = baseY + height;
  const corbel = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.04, radius * 0.92, 0.5, 8), matStoneDark);
  corbel.position.set(cx, top - 0.1, cz);
  g.add(corbel);
  addMerlonRing(g, cx, cz, top + 0.35, radius * 0.95, 8, matStoneDark);

  const roofH = radius * 2.7;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.98, roofH, 8), rand() < 0.5 ? matSlate : matSlateDark);
  roof.position.set(cx, top + 0.2 + roofH / 2, cz);
  g.add(roof);
  let apex = top + 0.2 + roofH;

  addTowerWindows(g, cx, cz, baseY, top, radius, rand);

  if (spire) {
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, radius * 1.8, 6), matSlateDark);
    sp.position.set(cx, apex + radius * 0.9, cz);
    g.add(sp);
    apex += radius * 1.8;
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), matGoldGlow);
    ball.position.set(cx, apex, cz);
    g.add(ball);
  }
  return apex;
}

/** A square stone tower: boxy shaft, crenellated top, 4-sided pyramidal slate
 *  roof and warm-lit windows on each face. Returns the apex height. */
function addSquareTower(
  g: THREE.Group, cx: number, cz: number, baseY: number, height: number, w: number, rand: () => number
): number {
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(w, height, w), matStone);
  shaft.position.set(cx, baseY + height / 2, cz);
  g.add(shaft);

  const top = baseY + height;
  addSquareMerlons(g, cx, cz, top + 0.3, w / 2 - 0.2, matStoneDark);

  const roofH = w * 1.5;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.8, roofH, 4), matSlate);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(cx, top + 0.2 + roofH / 2, cz);
  g.add(roof);

  const geo = new THREE.BoxGeometry(0.3, 0.5, 0.16);
  const faces: [number, number, number][] = [
    [0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2],
  ];
  for (let r = 0; r < 3; r++) {
    const wy = baseY + height * (0.3 + r * 0.22);
    for (const [dx, dz, ry] of faces) {
      if (rand() < 0.45) continue;
      const m = new THREE.Mesh(geo, matWinLit);
      m.position.set(cx + dx * (w / 2), wy, cz + dz * (w / 2));
      m.rotation.y = ry;
      g.add(m);
    }
  }
  return top + 0.2 + roofH;
}

/** Build an arch-topped flat shape (rectangle capped with a semicircle). */
function archShape(width: number, height: number): THREE.Shape {
  const r = width / 2;
  const s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.lineTo(-r, height - r);
  s.absarc(0, height - r, r, Math.PI, 0, true);
  s.lineTo(r, 0);
  s.closePath();
  return s;
}

/**
 * THE landmark: Hogwarts Castle. A grand cluster of round and square stone
 * towers of varying heights with tall pointed slate-blue/purple conical roofs
 * and thin spires, a central Great-Hall block with a steep gabled roof and a
 * huge glowing arched stained-glass window (plus a rose window and great door),
 * a clock tower, battlements, rows of tiny warm-lit windows and a rocky base.
 * Reads as the Hogwarts silhouette from a distance. ~24 units tall.
 */
export function makeHogwartsCastle(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const platformY = 1.6;

  // --- rocky base the castle is perched on ---
  const rockN = 8;
  for (let i = 0; i < rockN; i++) {
    const rr = 2.0 + rand() * 2.2;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rr, 0), matRock);
    const a = (i / rockN) * Math.PI * 2 + rand() * 0.6;
    const rad = 3.5 + rand() * 3.5;
    rock.position.set(Math.cos(a) * rad, rr * 0.35 + rand() * 0.5, Math.sin(a) * rad);
    rock.scale.set(1, 0.55 + rand() * 0.3, 1);
    rock.rotation.y = rand() * Math.PI * 2;
    g.add(rock);
  }
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(8.0, 9.0, platformY + 0.6, 9), matStoneDeep);
  plinth.position.y = (platformY + 0.6) / 2;
  g.add(plinth);

  // --- central Great Hall ---
  const hallW = 5.5, hallH = 7, hallD = 8;
  const hall = new THREE.Mesh(new THREE.BoxGeometry(hallW, hallH, hallD), matStone);
  hall.position.set(0, platformY + hallH / 2, 0);
  g.add(hall);

  // steep gabled slate roof (extruded triangle running the hall's length)
  const gable = new THREE.Shape();
  gable.moveTo(-hallW / 2 - 0.3, 0);
  gable.lineTo(hallW / 2 + 0.3, 0);
  gable.lineTo(0, hallH * 0.5);
  gable.closePath();
  const hallRoof = new THREE.Mesh(
    new THREE.ExtrudeGeometry(gable, { depth: hallD + 0.6, bevelEnabled: false }),
    matSlate
  );
  hallRoof.position.set(0, platformY + hallH, -(hallD + 0.6) / 2);
  g.add(hallRoof);

  // huge glowing arched stained-glass window on the front (+z) face
  const winW = 2.8, winH = 3.4, winBaseY = platformY + 2.6, winZ = hallD / 2 + 0.05;
  const hallWindow = new THREE.Mesh(new THREE.ShapeGeometry(archShape(winW, winH)), matWinLit);
  hallWindow.position.set(0, winBaseY, winZ);
  g.add(hallWindow);
  // stone recess behind the glass
  const recess = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.5, winH + 0.4, 0.4), matStoneDeep);
  recess.position.set(0, winBaseY + winH * 0.45, winZ - 0.3);
  g.add(recess);
  // coloured stained-glass accents
  const accentA = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.06), matStainPurple);
  accentA.position.set(0, winBaseY + winH * 0.55, winZ + 0.04);
  accentA.rotation.z = Math.PI / 4;
  g.add(accentA);
  for (const sx of [-0.85, 0.85]) {
    const accentB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.05), matStainRed);
    accentB.position.set(sx, winBaseY + winH * 0.35, winZ + 0.03);
    g.add(accentB);
  }
  // dark mullion grid over the glass
  for (const sx of [-0.55, 0.55]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, winH, 0.1), matStoneDeep);
    bar.position.set(sx, winBaseY + winH / 2, winZ + 0.06);
    g.add(bar);
  }
  for (const t of [0.35, 0.7]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(winW, 0.08, 0.1), matStoneDeep);
    bar.position.set(0, winBaseY + winH * t, winZ + 0.06);
    g.add(bar);
  }

  // great arched door below the window
  const doorW = 1.6, doorH = 2.4;
  const door = new THREE.Mesh(new THREE.ShapeGeometry(archShape(doorW, doorH)), matDoorWood);
  door.position.set(0, platformY + 0.02, hallD / 2 + 0.04);
  g.add(door);
  for (const sx of [-0.35, 0.35]) {
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 6), matGold);
    stud.rotation.x = Math.PI / 2;
    stud.position.set(sx, platformY + 1.0, hallD / 2 + 0.09);
    g.add(stud);
  }

  // rose window in the gable
  const roseY = platformY + hallH + hallH * 0.24;
  const rose = new THREE.Mesh(new THREE.CircleGeometry(0.7, 14), matStainPurple);
  rose.position.set(0, roseY, hallD / 2 - 0.15);
  g.add(rose);
  const roseFrame = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 6, 16), matGold);
  roseFrame.position.set(0, roseY, hallD / 2 - 0.15);
  g.add(roseFrame);

  // --- the tower cluster around the hall (varying heights, round + square) ---
  addRoundTower(g, -4.5, -2.0, platformY, 16, 1.5, rand, true);  // tall astronomy tower
  addSquareTower(g, 4.2, -3.0, platformY, 11, 3.0, rand);        // clock tower (clock added below)
  addRoundTower(g, 5.6, 3.2, platformY, 9, 1.7, rand, false);
  addRoundTower(g, -5.8, 3.8, platformY, 7.5, 1.4, rand, true);
  addRoundTower(g, 3.4, 5.0, platformY, 8, 1.1, rand, true);     // front-right turret
  addRoundTower(g, -3.4, 5.0, platformY, 8, 1.1, rand, true);    // front-left turret
  addSquareTower(g, -1.0, -6.2, platformY, 12.5, 2.4, rand);     // rear keep

  // clock face on the clock tower (front +z face)
  const clockZ = -3.0 + 1.5 + 0.04;
  const clockY = platformY + 11 * 0.72;
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.85, 16), matWinLit);
  clock.position.set(4.2, clockY, clockZ);
  g.add(clock);
  const clockFrame = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.1, 6, 18), matGold);
  clockFrame.position.set(4.2, clockY, clockZ + 0.02);
  g.add(clockFrame);
  const handMin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.05), matStoneDeep);
  handMin.position.set(4.2, clockY + 0.18, clockZ + 0.06);
  g.add(handMin);
  const handHr = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.05), matStoneDeep);
  handHr.position.set(4.34, clockY, clockZ + 0.06);
  handHr.rotation.z = -Math.PI / 2.4;
  g.add(handHr);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

/** Big wheels + hubs under a chassis: pairs of black discs (axis along z). */
function addWheels(
  g: THREE.Group, cx: number, count: number, spacing: number, halfZ: number, r: number
): void {
  const geo = new THREE.CylinderGeometry(r, r, 0.18, 10);
  for (let i = 0; i < count; i++) {
    const x = cx + (i - (count - 1) / 2) * spacing;
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(geo, matBlack);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, r, sz * halfZ);
      g.add(w);
    }
  }
}

/** One red-and-cream passenger carriage centred at cx, with a rounded roof,
 *  a row of warm-lit windows, a gold trim line and wheels. */
function addCarriage(g: THREE.Group, cx: number): void {
  const L = 3.4, Hc = 1.8, W = 1.8, yb = 1.5;
  const lower = new THREE.Mesh(new THREE.BoxGeometry(L, Hc * 0.62, W), matScarlet);
  lower.position.set(cx, yb - Hc * 0.19, 0);
  g.add(lower);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(L, Hc * 0.38, W * 0.98), matCream);
  upper.position.set(cx, yb + Hc * 0.31, 0);
  g.add(upper);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(L + 0.02, 0.1, W * 1.01), matGold);
  trim.position.set(cx, yb + Hc * 0.11, 0);
  g.add(trim);
  // rounded clerestory roof (round in the y-z plane, running along x)
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, L * 0.98, 12), matCream);
  roof.rotation.z = Math.PI / 2;
  roof.position.set(cx, yb + Hc * 0.45, 0);
  g.add(roof);
  // warm windows
  const winGeo = new THREE.BoxGeometry(0.5, 0.6, 0.08);
  const nWin = 3;
  for (let i = 0; i < nWin; i++) {
    const wx = cx - L / 2 + L * ((i + 0.5) / nWin);
    for (const sz of [-1, 1]) {
      const win = new THREE.Mesh(winGeo, matWinLit);
      win.position.set(wx, yb + 0.05, sz * (W / 2));
      g.add(win);
    }
  }
  addWheels(g, cx, 2, 1.6, 0.75, 0.4);
}

/**
 * The Hogwarts Express: a scarlet steam locomotive (boiler + cab with brass
 * bands and domes, a black funnel, a warm headlamp, buffers and driving wheels)
 * pulling two red-and-cream carriages, sitting on a length of rail with
 * sleepers, with an emissive pale steam puff billowing from the funnel.
 * ~4.5 units tall, reads instantly as the Hogwarts Express.
 */
export function makeHogwartsExpress(rand: () => number): THREE.Group {
  const g = new THREE.Group();

  // --- track ---
  const railLen = 15.5;
  for (const sz of [-0.7, 0.7]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(railLen, 0.12, 0.12), matBlack);
    rail.position.set(0, 0.12, sz);
    g.add(rail);
  }
  for (let x = -railLen / 2 + 0.5; x < railLen / 2; x += 1.25) {
    const sleeper = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 2.0), matDoorWood);
    sleeper.position.set(x, 0.05, 0);
    g.add(sleeper);
  }

  // --- locomotive (front at +x) ---
  const locoFront = 6.2;
  const footplate = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.24, 1.7), matBlack);
  footplate.position.set(3.3, 0.82, 0);
  g.add(footplate);

  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 3.4, 12), matScarlet);
  boiler.rotation.z = Math.PI / 2;
  boiler.position.set(4.2, 1.5, 0);
  g.add(boiler);
  for (const bx of [3.0, 4.2, 5.4]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.77, 0.05, 4, 12), matBrass);
    band.rotation.y = Math.PI / 2;
    band.position.set(bx, 1.5, 0);
    g.add(band);
  }
  // smokebox front + buffer beam + buffers
  const smokebox = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.3, 12), matBlack);
  smokebox.rotation.z = Math.PI / 2;
  smokebox.position.set(locoFront - 0.25, 1.5, 0);
  g.add(smokebox);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.5, 1.9), matScarletBright);
  beam.position.set(locoFront, 0.95, 0);
  g.add(beam);
  for (const sz of [-0.6, 0.6]) {
    const buffer = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8), matBlack);
    buffer.rotation.z = Math.PI / 2;
    buffer.position.set(locoFront + 0.15, 0.85, sz);
    g.add(buffer);
  }
  // brass domes on the boiler top
  for (const dx of [3.3, 4.4]) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), matBrass);
    dome.position.set(dx, 2.05, 0);
    g.add(dome);
  }
  // black funnel/chimney
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.7, 10), matBlack);
  funnel.position.set(5.4, 2.25, 0);
  g.add(funnel);
  const funnelRim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.14, 10), matBlack);
  funnelRim.position.set(5.4, 2.6, 0);
  g.add(funnelRim);
  // warm headlamps
  const lampTop = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.28), matWinLit);
  lampTop.position.set(locoFront - 0.05, 2.0, 0);
  g.add(lampTop);
  const lampFront = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 8), matWinLit);
  lampFront.rotation.z = Math.PI / 2;
  lampFront.position.set(locoFront - 0.05, 1.25, 0);
  g.add(lampFront);

  // cab with cream band, black roof and warm windows
  const cabX = 1.7;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.0, 2.0), matScarlet);
  cab.position.set(cabX, 2.0, 0);
  g.add(cab);
  const cabTrim = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.4, 2.04), matCream);
  cabTrim.position.set(cabX, 2.72, 0);
  g.add(cabTrim);
  const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.2, 2.3), matBlack);
  cabRoof.position.set(cabX, 3.02, 0);
  g.add(cabRoof);
  for (const sz of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.7, 0.1), matWinLit);
    win.position.set(cabX, 2.35, sz * 1.0);
    g.add(win);
  }

  // wheels
  addWheels(g, 4.0, 3, 1.15, 0.85, 0.6);  // big drivers
  addWheels(g, 5.7, 1, 0, 0.85, 0.4);     // leading truck
  addWheels(g, cabX, 1, 0, 0.85, 0.45);   // cab

  // --- carriages ---
  addCarriage(g, -1.5);
  addCarriage(g, -5.1);

  // --- steam puff billowing up and back from the funnel ---
  for (let i = 0; i < 4; i++) {
    const s = 0.34 + i * 0.17;
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), matSteam);
    puff.position.set(5.4 - i * 0.4, 2.9 + i * 0.42, (rand() - 0.5) * 0.4);
    g.add(puff);
  }

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

/**
 * A Quidditch goal: a very tall thin tapered pole topped with a glowing golden
 * ring, on a small mound, with a little pennant. ~13-15 units tall so a trio
 * placed together reads as the three goal hoops.
 */
export function makeQuidditchHoop(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 10.5 + rand() * 3;  // pole height

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.28, h, 8), matPole);
  pole.position.y = h / 2;
  g.add(pole);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 0.5, 8), matStoneDark);
  base.position.y = 0.25;
  g.add(base);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 8), matGold);
  collar.position.y = h + 0.1;
  g.add(collar);

  const ringR = 1.15;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.14, 8, 22), matGoldGlow);
  ring.position.y = h + ringR + 0.25;
  g.add(ring);

  // little pennant just below the ring
  const pen = new THREE.Shape();
  pen.moveTo(0, 0);
  pen.lineTo(0.7, -0.16);
  pen.lineTo(0, -0.32);
  pen.closePath();
  const pennant = new THREE.Mesh(
    new THREE.ShapeGeometry(pen),
    new THREE.MeshStandardMaterial({ color: SCARLET_BRIGHT, roughness: 0.8, side: THREE.DoubleSide, flatShading: true })
  );
  pennant.position.set(0.16, h * 0.86, 0);
  g.add(pennant);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

/**
 * A Great-Hall floating candle: a thin pale taper with a bright emissive flame,
 * hovering ~2.5-4 units above the ground. Tiny.
 */
export function makeFloatingCandle(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const floatY = 2.6 + rand() * 1.2;
  const bodyH = 0.7 + rand() * 0.3;

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, bodyH, 7), matWax);
  body.position.y = floatY + bodyH / 2;
  g.add(body);
  // a soft melted lip at the top
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.1, 7), matWax);
  lip.position.y = floatY + bodyH;
  g.add(lip);

  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 4), matBlack);
  wick.position.y = floatY + bodyH + 0.05;
  g.add(wick);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 6), matFlame);
  flame.position.y = floatY + bodyH + 0.24;
  g.add(flame);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), matFlameCore);
  core.position.y = floatY + bodyH + 0.15;
  g.add(core);

  return g;
}

/**
 * The Golden Snitch: a tiny faceted emissive-gold sphere with an engraved
 * equator band and two translucent silver wings, hovering ~2 units up. Small
 * and magical (blooms).
 */
export function makeGoldenSnitch(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const y = 2.0;

  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), matGoldGlow);
  body.position.y = y;
  g.add(body);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 4, 16), matGold);
  band.rotation.x = Math.PI / 2;
  band.position.y = y;
  g.add(band);

  // a feathered wing outline, mirrored to each side
  const wing = new THREE.Shape();
  wing.moveTo(0, 0);
  wing.quadraticCurveTo(0.35, 0.28, 0.9, 0.16);
  wing.quadraticCurveTo(0.6, 0.02, 0.9, -0.06);
  wing.quadraticCurveTo(0.5, -0.12, 0.28, -0.02);
  wing.quadraticCurveTo(0.14, -0.05, 0, 0);
  wing.closePath();
  const wingGeo = new THREE.ShapeGeometry(wing);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, matSilver);
    w.position.set(s * 0.18, y + 0.05, 0);
    w.scale.x = s;
    w.rotation.z = s * 0.3;
    w.rotation.y = -0.4;
    g.add(w);
  }

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

/** Grow a bare, sharply-angled twisting branch, recursing with hard direction
 *  changes and sprouting a sparse dark-green leaf clump at the tips. */
function growBranch(
  g: THREE.Group, start: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number,
  rand: () => number, depth: number
): void {
  const d = dir.clone().normalize();
  const r1 = r0 * 0.55;
  const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 5), depth > 0 ? matBark : matBarkDark);
  seg.quaternion.setFromUnitVectors(UP, d);
  seg.position.copy(start).add(d.clone().multiplyScalar(len / 2));
  g.add(seg);

  const end = start.clone().add(d.clone().multiplyScalar(len));
  if (depth > 0) {
    const n = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const nd = d.clone();
      nd.x += (rand() - 0.5) * 1.5;   // sharp angular twist
      nd.z += (rand() - 0.5) * 1.5;
      nd.y += (rand() - 0.35) * 0.6;
      growBranch(g, end, nd, len * (0.6 + rand() * 0.15), r1, rand, depth - 1);
    }
  } else if (rand() < 0.6) {
    const clump = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + rand() * 0.4, 0), matLeaf);
    clump.position.copy(end);
    clump.scale.set(1, 0.7, 1);
    g.add(clump);
  }
}

/**
 * The Whomping Willow: a large, gnarled, angry tree. A thick twisted tapered
 * trunk of stacked leaning segments, several bare sharply-angled twisting
 * branches reaching out, dark weathered bark and a few sparse dark-green leaf
 * clumps. ~7-10 units tall, clearly a menacing willow.
 */
export function makeWhompingWillow(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const H = 7 + rand() * 3;

  // twisting trunk
  let base = new THREE.Vector3(0, 0, 0);
  let dir = new THREE.Vector3((rand() - 0.5) * 0.25, 1, (rand() - 0.5) * 0.25).normalize();
  let r = 0.9 + rand() * 0.3;
  const segs = 3;
  const trunkLen = H * 0.5;
  for (let i = 0; i < segs; i++) {
    const len = trunkLen / segs;
    const r1 = r * 0.72;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r, len * 1.05, 6), matBark);
    seg.quaternion.setFromUnitVectors(UP, dir);
    seg.position.copy(base).add(dir.clone().multiplyScalar(len / 2));
    g.add(seg);
    base = base.clone().add(dir.clone().multiplyScalar(len));
    dir = dir.clone().add(new THREE.Vector3((rand() - 0.5) * 0.5, 0.15, (rand() - 0.5) * 0.5)).normalize();
    r = r1;
  }
  // a knotted base flare
  const flare = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.5, 1.2, 6), matBark);
  flare.position.y = 0.5;
  g.add(flare);

  // main limbs reaching out and up from the crown
  const nb = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + rand() * 0.5;
    const out = 0.75 + rand() * 0.5;
    const bdir = new THREE.Vector3(Math.cos(a) * out, 0.5 + rand() * 0.5, Math.sin(a) * out);
    growBranch(g, base.clone(), bdir, H * 0.42, r * 0.95, rand, 2);
  }

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}
