import * as THREE from "three";

// --- Harry-Potter-style medieval castle props ------------------------------
// Procedural, faceted low-poly roadside props built to match the style of
// makeTree / makeCrystalCluster / makeRamp in ../objects.ts. Each builder takes
// a seeded rand() and returns a THREE.Group whose base sits on y = 0.

// palette ------------------------------------------------------------------
const STONE = 0x8a8f99;      // weathered grey stone
const STONE_DARK = 0x6f747e; // darker weathered stone
const DARK = 0x4c505a;       // deep shadowed stone / gate
const SLATE = 0x3b3a5c;      // slate-blue/purple roof
const RED = 0xa01f2e;        // heraldic deep red
const PURPLE = 0x6d28d9;     // royal purple
const WOOD = 0x5a3a22;       // torch post timber
const GOLD = 0xe9c46a;       // heraldic emblem accent
const WINDOW = 0x14121c;     // dark window slit
const FLAME = 0xff7a1a;      // emissive torch flame

// shared stone materials — cloned by varyTint when scattered, so sharing is safe
const matStone = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.85, flatShading: true });
const matStoneDark = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.85, flatShading: true });
const matDark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.85, flatShading: true });
const matSlate = new THREE.MeshStandardMaterial({ color: SLATE, roughness: 0.8, flatShading: true });
const matWood = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.9, flatShading: true });
const matWindow = new THREE.MeshStandardMaterial({ color: WINDOW, roughness: 0.9, flatShading: true });

/** Add a row of crenellation merlons (boxes with gaps) along the local X axis,
 *  centred on x = 0, at height `topY` and depth `z`. Reuses one geometry. */
function addBattlements(g: THREE.Group, length: number, topY: number, z: number, mat: THREE.Material) {
  const teeth = Math.max(3, Math.round(length));
  const step = length / teeth;
  const geo = new THREE.BoxGeometry(step * 0.7, 0.7, 0.5);
  for (let i = 0; i < teeth; i += 2) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(-length / 2 + step * (i + 0.5), topY, z);
    g.add(m);
  }
}

/** The landmark: a tall round stone tower with a crenellated parapet, a pointed
 *  slate-purple conical roof, dark windows and a tiny pennant flag. ~12-16 tall. */
export function makeTower(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 12 + rand() * 4;              // 12-16 units tall
  const r = 1.6 + rand() * 0.5;

  // shaft (slightly tapered) on a wider stone foot
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, h, 8), matStone);
  shaft.position.y = h / 2;
  g.add(shaft);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.18, h * 0.09, 8), matStoneDark);
  foot.position.y = h * 0.045;
  g.add(foot);

  const topY = h;
  const battR = r * 0.95;

  // parapet ring the merlons stand on
  const parapet = new THREE.Mesh(new THREE.CylinderGeometry(battR + 0.15, battR + 0.15, 0.5, 8), matStone);
  parapet.position.y = topY - 0.1;
  g.add(parapet);

  // crenellations: a ring of small boxes with gaps
  const merlonGeo = new THREE.BoxGeometry(0.5, 0.7, 0.5);
  const merlons = 8;
  for (let i = 0; i < merlons; i++) {
    const a = (i / merlons) * Math.PI * 2;
    const m = new THREE.Mesh(merlonGeo, matStoneDark);
    m.position.set(Math.cos(a) * battR, topY + 0.35, Math.sin(a) * battR);
    m.rotation.y = -a;
    g.add(m);
  }

  // pointed conical roof rising from inside the crenellated ring
  const roofH = 2.6 + rand() * 1.2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(battR - 0.15, roofH, 8), matSlate);
  const roofBase = topY + 0.15;
  roof.position.y = roofBase + roofH / 2;
  g.add(roof);

  // a couple of dark windows set into the shaft, facing outward
  const winGeo = new THREE.BoxGeometry(0.4, 0.9, 0.25);
  const winCount = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < winCount; i++) {
    const a = rand() * Math.PI * 2;
    const wy = h * (0.35 + rand() * 0.4);
    const rr = r * 0.92;
    const win = new THREE.Mesh(winGeo, matWindow);
    win.position.set(Math.cos(a) * rr, wy, Math.sin(a) * rr);
    win.rotation.y = Math.PI / 2 - a;
    g.add(win);
  }

  // tiny pennant flag on top: a thin pole + a small triangular cloth
  const apexY = roofBase + roofH;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5), matDark);
  pole.position.y = apexY + 0.8;
  g.add(pole);
  const penShape = new THREE.Shape();
  penShape.moveTo(0, 0);
  penShape.lineTo(1.0, -0.22);
  penShape.lineTo(0, -0.44);
  penShape.closePath();
  const penMat = new THREE.MeshStandardMaterial({
    color: rand() < 0.5 ? RED : PURPLE, roughness: 0.8, side: THREE.DoubleSide, flatShading: true,
  });
  const pennant = new THREE.Mesh(new THREE.ShapeGeometry(penShape), penMat);
  pennant.position.set(0.05, apexY + 1.35, 0);
  g.add(pennant);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

/** A squat fortified gatehouse: a wide stone block with two round flanking
 *  turrets (conical caps), a battlemented top and a dark arched gate. ~6-8. */
export function makeGatehouse(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 6 + rand() * 2;   // 6-8 units
  const w = 6;
  const d = 3;

  // main block on a low plinth
  const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matStone);
  block.position.y = h / 2;
  g.add(block);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, h * 0.14, d + 0.4), matStoneDark);
  plinth.position.y = h * 0.07;
  g.add(plinth);

  // crenellations along the front and back top edges
  addBattlements(g, w, h + 0.35, d / 2 - 0.25, matStoneDark);
  addBattlements(g, w, h + 0.35, -(d / 2 - 0.25), matStoneDark);

  // flanking turrets with pointed slate caps
  const tR = 1.0;
  const tH = h + 1.4;
  const turretGeo = new THREE.CylinderGeometry(tR, tR * 1.1, tH, 8);
  const capGeo = new THREE.ConeGeometry(tR * 1.25, 1.7, 8);
  for (const sx of [-1, 1]) {
    const turret = new THREE.Mesh(turretGeo, matStone);
    turret.position.set(sx * (w / 2), tH / 2, 0);
    g.add(turret);
    const cap = new THREE.Mesh(capGeo, matSlate);
    cap.position.set(sx * (w / 2), tH + 0.85, 0);
    g.add(cap);
  }

  // dark arched gate opening on the front face (recessed box + rounded top)
  const gateW = 2.2;
  const gateH = h * 0.55;
  const gate = new THREE.Mesh(new THREE.BoxGeometry(gateW, gateH, 0.5), matDark);
  gate.position.set(0, gateH / 2, d / 2 - 0.05);
  g.add(gate);
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(gateW / 2, gateW / 2, 0.5, 8), matDark);
  arch.rotation.x = Math.PI / 2; // lay the cylinder front-to-back so the dome faces out
  arch.position.set(0, gateH, d / 2 - 0.05);
  g.add(arch);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

/** A section of battlemented curtain wall: a long low stone wall on a plinth
 *  with crenellations running along both top edges. ~3-4 tall, ~6 long. */
export function makeCastleWall(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 3 + rand();       // 3-4 units tall
  const len = 6;              // ~6 units long
  const thick = 1.2;

  const wall = new THREE.Mesh(new THREE.BoxGeometry(len, h, thick), matStone);
  wall.position.y = h / 2;
  g.add(wall);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(len + 0.3, h * 0.18, thick + 0.35), matStoneDark);
  plinth.position.y = h * 0.09;
  g.add(plinth);

  addBattlements(g, len, h + 0.35, thick / 2 - 0.25, matStoneDark);
  addBattlements(g, len, h + 0.35, -(thick / 2 - 0.25), matStoneDark);

  // small orientation jitter — wall sections read as roughly aligned but varied
  g.rotation.y = (rand() - 0.5) * 0.35;
  return g;
}

/** A heraldic banner: a thin pole and crossbar with a hanging rectangular cloth
 *  in a bright accent (deep red or royal purple) and a simple lozenge emblem. */
export function makeBanner(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const poleH = 4 + rand();   // 4-5 units
  const poleR = 0.08;

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(poleR, poleR, poleH, 6), matDark);
  pole.position.y = poleH / 2;
  g.add(pole);
  const finial = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), matStoneDark);
  finial.position.y = poleH + 0.12;
  g.add(finial);

  const accent = rand() < 0.5 ? RED : PURPLE;
  const clothW = 1.4;
  const clothH = 2.3;
  const clothTop = poleH - 0.3;

  // crossbar the cloth hangs from
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, clothW + 0.4, 5), matDark);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(clothW / 2, clothTop + 0.05, 0);
  g.add(bar);

  const clothMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(clothW, clothH, 0.06), clothMat);
  cloth.position.set(clothW / 2, clothTop - clothH / 2, 0);
  g.add(cloth);

  // simple emblem block, rotated to a heraldic lozenge, sat on the cloth
  const emblemMat = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.6, flatShading: true });
  const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.08), emblemMat);
  emblem.position.set(clothW / 2, clothTop - clothH * 0.45, 0.06);
  emblem.rotation.z = Math.PI / 4;
  g.add(emblem);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

/** A wall torch: a timber post on a stone base with a stone brazier cup and an
 *  emissive orange flame that glows. ~2-3 units tall. */
export function makeTorch(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const postH = 2 + rand();   // 2-3 units
  const postR = 0.14;

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.32, 6), matStoneDark);
  base.position.y = 0.16;
  g.add(base);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(postR * 0.8, postR, postH, 6), matWood);
  post.position.y = postH / 2 + 0.2;
  g.add(post);

  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.12, 0.26, 6), matStoneDark);
  cup.position.y = postH + 0.25;
  g.add(cup);

  // emissive flame so it visibly glows
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xffd08a, emissive: FLAME, emissiveIntensity: 1.2, roughness: 0.5, flatShading: true,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.62, 6), flameMat);
  flame.position.y = postH + 0.62;
  g.add(flame);
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.12, 0),
    new THREE.MeshStandardMaterial({ color: 0xffedb0, emissive: 0xffb04a, emissiveIntensity: 1.4, flatShading: true })
  );
  core.position.y = postH + 0.5;
  g.add(core);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}
