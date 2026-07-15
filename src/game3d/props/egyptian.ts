import * as THREE from "three";

// Procedural low-poly roadside props for the Egyptian desert realm. Every
// builder returns a Group whose base sits on y=0, in the crisp faceted style of
// objects.ts (makeTree / makeRamp): MeshStandardMaterial + flatShading, sharp
// creases, low vertex counts, geometries/materials reused within a builder.
//
// Palette: sandstone #d9b47a / #c79a5c, shadow #a9793f, gold accent #e6c458.

const SAND = 0xd9b47a;
const SAND2 = 0xc79a5c;
const SHADOW = 0xa9793f;
const GOLD = 0xe6c458;

function stoneMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0 });
}

/** The landmark: a big classic 4-sided pyramid (~12-16 tall) in sandstone,
 *  with a darker capstone and faint horizontal course lines. */
export function makePyramid(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 12 + rand() * 4; // 12–16 tall
  const R = h * 1.05; // corner radius of the square base
  const sand = stoneMat(SAND);
  const shadow = stoneMat(SHADOW);
  const face = Math.cos(Math.PI / 4); // 0.707 — face-plane distance / corner radius

  // main mass — cone with 4 radial segments, rotated so flat faces front the axes
  const body = new THREE.Mesh(new THREE.ConeGeometry(R, h, 4), sand);
  body.position.y = h / 2;
  body.rotation.y = Math.PI / 4;
  g.add(body);

  // darker capstone: continues the pyramid line but in shadow tone
  const capH = h * 0.14;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(R * (capH / h), capH, 4), shadow);
  cap.position.y = h - capH / 2;
  cap.rotation.y = Math.PI / 4;
  g.add(cap);

  // faint horizontal course lines — thin square belts that hug the taper
  for (let i = 1; i <= 4; i++) {
    const f = i / 5.5; // fraction up the pyramid
    const w = 2 * R * face * (1 - f) + 0.08; // just proud of the faces
    const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, w), shadow);
    line.position.y = f * h;
    line.rotation.y = Math.PI / 4;
    g.add(line);
  }

  return g;
}

/** A tall tapered 4-sided obelisk (~7-10 tall) on a low plinth, capped by a
 *  gilded pyramidion. */
export function makeObelisk(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const shaftH = 6.4 + rand() * 2.6; // shaft only
  const baseR = shaftH * 0.075; // corner radius at the foot
  const topR = baseR * 0.62; // corner radius under the cap
  const sand = stoneMat(SAND);
  const sand2 = stoneMat(SAND2);
  const gold = stoneMat(GOLD);

  // low plinth so the shaft reads as seated, not stabbed into the sand
  const plinthH = shaftH * 0.06;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(baseR * 3, plinthH, baseR * 3), sand2);
  plinth.position.y = plinthH / 2;
  plinth.rotation.y = Math.PI / 4;
  g.add(plinth);

  // tapered 4-sided shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(topR, baseR, shaftH, 4), sand);
  shaft.position.y = plinthH + shaftH / 2;
  shaft.rotation.y = Math.PI / 4;
  g.add(shaft);

  // gilded pyramidion cap — its base matches the shaft top so the edges align
  const capH = topR * 2.4;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(topR, capH, 4), gold);
  cap.position.y = plinthH + shaftH + capH / 2;
  cap.rotation.y = Math.PI / 4;
  g.add(cap);

  return g;
}

/** A recumbent sphinx (~3-4 tall): a long low body with front paws and a raised
 *  head wearing a striped nemes headdress. Sits lengthwise; randomly oriented. */
export function makeSphinx(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const sand = stoneMat(SAND);
  const sand2 = stoneMat(SAND2);
  const gold = stoneMat(GOLD);
  const shadow = stoneMat(SHADOW);

  const box = (w: number, h: number, d: number, mat: THREE.MeshStandardMaterial, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  // body block, lying along Z (front faces +Z)
  box(1.5, 1.2, 3.6, sand, 0, 0.6, -0.2);
  // haunch, a touch taller at the rear
  box(1.55, 1.45, 1.1, sand2, 0, 0.72, -1.6);
  // outstretched front paws
  for (const sx of [-1, 1]) {
    box(0.42, 0.45, 1.9, sand2, sx * 0.5, 0.225, 1.75);
  }
  // chest / neck rising to carry the head
  box(1.0, 1.2, 0.75, sand, 0, 1.2, 1.35);
  // head
  box(0.8, 0.8, 0.75, sand, 0, 2.15, 1.5);
  // brow band + muzzle
  box(0.82, 0.16, 0.12, gold, 0, 2.42, 1.9);
  box(0.34, 0.34, 0.28, sand2, 0, 1.95, 1.98);

  // nemes headdress crown over the head
  box(1.18, 0.5, 1.0, gold, 0, 2.62, 1.4);

  // striped side flaps of the nemes framing the face
  for (const sx of [-1, 1]) {
    for (let j = 0; j < 4; j++) {
      const stripe = j % 2 ? gold : shadow;
      box(0.2, 0.22, 0.72, stripe, sx * 0.54, 2.4 - j * 0.22, 1.55);
    }
  }

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

/** A date palm (~4-6 tall): a slightly leaning segmented trunk crowned by 7-8
 *  flat drooping fronds and a small cluster of dates. Randomly oriented. */
export function makePalm(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunkMat = stoneMat(SHADOW);
  const trunkTopMat = stoneMat(SAND2);
  const frondMat = stoneMat(0x74833f); // dusty desert green
  const dateMat = stoneMat(GOLD);

  const trunkH = 3.2 + rand() * 1.3; // 3.2–4.5
  const trunkR = 0.16 + rand() * 0.05;
  const leanX = (rand() - 0.5) * 0.5; // total sideways lean at the crown
  const segN = 5;
  const segH = trunkH / segN;

  // segmented, faceted, gently curving trunk
  for (let i = 0; i < segN; i++) {
    const t0 = i / segN;
    const t1 = (i + 1) / segN;
    const rBot = trunkR * (1 - t0 * 0.35);
    const rTop = trunkR * (1 - t1 * 0.35);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, segH * 1.04, 6), trunkMat);
    seg.position.set(leanX * t0 * t0, segH * i + segH / 2, 0);
    seg.rotation.y = rand() * Math.PI;
    g.add(seg);
  }

  // crown sits at the leaned trunk top
  const crown = new THREE.Group();
  crown.position.set(leanX, trunkH, 0);
  g.add(crown);

  // knot of frond bases
  const knot = new THREE.Mesh(new THREE.IcosahedronGeometry(trunkR * 1.6, 0), trunkTopMat);
  crown.add(knot);

  // radiating flat fronds — a 3-sided cone squashed into a blade, tilted down
  const fronds = 7 + Math.floor(rand() * 2); // 7–8
  const frondGeo = new THREE.ConeGeometry(0.22, 1.9 + rand() * 0.4, 3);
  frondGeo.translate(0, frondGeo.parameters.height / 2, 0); // base at the crown
  for (let i = 0; i < fronds; i++) {
    const spin = new THREE.Group();
    spin.rotation.y = (i / fronds) * Math.PI * 2 + rand() * 0.15;
    const arm = new THREE.Group();
    arm.rotation.z = -(Math.PI / 2) - (0.2 + rand() * 0.35); // outward and drooping
    const blade = new THREE.Mesh(frondGeo, frondMat);
    blade.scale.z = 0.16; // flatten the triangle into a leaf
    arm.add(blade);
    spin.add(arm);
    crown.add(spin);
  }

  // a small hanging cluster of dates
  for (let i = 0; i < 3; i++) {
    const date = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), dateMat);
    date.position.set((rand() - 0.5) * 0.35, -0.25 - rand() * 0.25, (rand() - 0.5) * 0.35);
    crown.add(date);
  }

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

/** A weathered desert boulder / mesa (~2-4 tall): a couple of stacked faceted
 *  rock chunks in sandy-brown tones. Randomly oriented. */
export function makeSandRock(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1, 0); // reused, scaled per chunk
  const matA = stoneMat(SAND2);
  const matB = stoneMat(SHADOW);

  const chunks = 2 + Math.floor(rand() * 2); // 2–3
  let topY = 0;
  for (let i = 0; i < chunks; i++) {
    const rr = (1.35 - i * 0.4) * (0.8 + rand() * 0.5);
    const sx = 0.9 + rand() * 0.35;
    const sy = 0.65 + rand() * 0.25;
    const sz = 0.9 + rand() * 0.35;
    const chunk = new THREE.Mesh(geo, i % 2 ? matB : matA);
    chunk.scale.set(rr * sx, rr * sy, rr * sz);
    chunk.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    // safe vertical half-extent under arbitrary rotation = rr * max(scale)
    const half = rr * Math.max(sx, sy, sz);
    const cy = i === 0 ? half : topY - half * 0.4; // first sits on the ground, rest sink in
    chunk.position.set((rand() - 0.5) * rr * 0.5, cy, (rand() - 0.5) * rr * 0.5);
    g.add(chunk);
    topY = cy + half;
  }

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}
