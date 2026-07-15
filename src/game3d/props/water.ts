import * as THREE from "three";
import { ROAD_HALF_WIDTH } from "../constants";
import type { RealmPalette } from "../realms";

// Procedural water set-pieces for the kart racer, in the faceted low-poly style
// of objects.ts (makeStartGantry / makeRamp): MeshStandardMaterial + flatShading,
// sharp creases, emissive for glow, geometries/materials reused within a builder,
// every structure referencing y=0 (road / ground level).
//
//   makeWaterfall(rand)  — a standalone scenic cliff + cascading water + pool.
//   makeRiverBridge(pal) — decorative railing/pylon dressing that wraps the road
//                          where it crosses a river (the car drives the real road).

// deterministic 0..1 hash — identical inputs give identical output, so shared /
// duplicated vertices of a box move together and the mesh stays watertight.
function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** A short box beam connecting two points in space (used for the bridge arch). */
function beam(a: THREE.Vector3, b: THREE.Vector3, thick: number, mat: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 0.001;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, len), mat);
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.multiplyScalar(1 / len));
  return mesh;
}

// ---------------------------------------------------------------------------
// 1) Waterfall — a grey stone cliff with a cascading sheet of water and a
//    churning foam pool at its foot.
// ---------------------------------------------------------------------------

/** A tall faceted grey-stone cliff. A perturbed box, hashed by position so the
 *  facets stay watertight, with a flat base sitting on y=0. */
function cliffMesh(w: number, h: number, d: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d, 2, 4, 2);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = hash3(x, y, z), b = hash3(y, z, x), c = hash3(z, x, y);
    pos.setXYZ(i, x + (a - 0.5) * 1.5, y + (b - 0.5) * 0.9, z + (c - 0.5) * 1.5);
  }
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox!.min.y, 0); // sit the base on the ground
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x6f7378, roughness: 0.95, metalness: 0.02, flatShading: true,
  });
  return new THREE.Mesh(geo, mat);
}

export function makeWaterfall(rand: () => number): THREE.Group {
  const g = new THREE.Group();

  const H = 12 + rand() * 4;   // 12–16 tall cliff
  const W = 7;
  const D = 5;

  // --- the cliff -----------------------------------------------------------
  const cliff = cliffMesh(W, H, D);
  g.add(cliff);

  // a smaller shoulder rock beside the cliff for a less regular silhouette
  const shoulder = cliffMesh(W * 0.55, H * 0.5, D * 0.7);
  shoulder.position.set(-W * 0.55, 0, D * 0.15);
  shoulder.rotation.y = 0.4;
  g.add(shoulder);

  // --- the cascading water sheet ------------------------------------------
  // A stack of thin translucent boxes running down the cliff face (-Z side),
  // coloured with a subtle blue (top) -> white (bottom) gradient via material
  // colour, leaning slightly forward as it falls.
  const front = -D / 2 - 0.15;
  const fallTop = H - 0.6;
  const fallBot = 0.5;
  const bands = 6;
  const blue = new THREE.Color(0x8fc0ea);
  const white = new THREE.Color(0xffffff);
  for (let i = 0; i < bands; i++) {
    const t = i / bands;              // 0 at the crest, ~1 at the pool
    const yA = fallTop - t * (fallTop - fallBot);
    const yB = fallTop - ((i + 1) / bands) * (fallTop - fallBot);
    const segH = yA - yB;
    const bw = W * 0.42 * (1 + t * 0.55); // the sheet fans out toward the base
    const col = blue.clone().lerp(white, t);
    const mat = new THREE.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: 0.25,
      transparent: true, opacity: 0.8, roughness: 0.25, metalness: 0,
      flatShading: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(bw, segH * 1.04, 0.28), mat);
    box.position.set(0, (yA + yB) / 2, front - t * 0.5);
    g.add(box);
  }

  // a couple of brighter foam streaks in front of the sheet for texture
  const streakMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xdff0ff, emissiveIntensity: 0.4,
    transparent: true, opacity: 0.7, roughness: 0.3, flatShading: true,
    side: THREE.DoubleSide, depthWrite: false,
  });
  for (const sx of [-1, 1]) {
    const streak = new THREE.Mesh(new THREE.BoxGeometry(0.5, fallTop - fallBot - 1, 0.12), streakMat);
    streak.position.set(sx * W * 0.14, (fallTop + fallBot) / 2, front - 0.55);
    g.add(streak);
  }

  // --- churning foam / mist pool at the base ------------------------------
  const poolMat = new THREE.MeshStandardMaterial({
    color: 0xf2f8ff, emissive: 0xbcd8f0, emissiveIntensity: 0.2,
    transparent: true, opacity: 0.6, roughness: 0.35, metalness: 0,
    flatShading: true, depthWrite: false,
  });
  const discs: [number, number, number][] = [
    [0, front - 1.6, 2.4], [1.6, front - 0.7, 1.7], [-1.7, front - 1.1, 1.9],
    [0.4, front - 3.0, 1.4],
  ];
  for (const [dx, dz, r] of discs) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.06, 0.14, 12), poolMat);
    disc.position.set(dx, 0.08 + rand() * 0.06, dz);
    g.add(disc);
  }
  // faint raised mist discs so the foot of the fall glows softly
  const mistMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xcfe6f7, emissiveIntensity: 0.25,
    transparent: true, opacity: 0.22, roughness: 0.5, depthWrite: false,
  });
  for (let i = 0; i < 2; i++) {
    const mist = new THREE.Mesh(new THREE.CylinderGeometry(2.4 + i, 2.8 + i, 0.1, 10), mistMat);
    mist.position.set((rand() - 0.5) * 1.5, 0.7 + i * 0.6, front - 1.4);
    g.add(mist);
  }

  // --- a couple of wet rocks at the foot ----------------------------------
  const wetMat = new THREE.MeshStandardMaterial({
    color: 0x565b63, roughness: 0.4, metalness: 0.1, flatShading: true,
  });
  const rockGeo = new THREE.IcosahedronGeometry(0.7, 0);
  for (const [rx, rz, rs] of [[-2.3, front - 0.6, 1.0], [2.1, front - 1.8, 0.8], [0.2, front - 3.6, 0.6]] as const) {
    const rock = new THREE.Mesh(rockGeo, wetMat);
    rock.position.set(rx, 0.15, rz);
    rock.rotation.set(rand() * 0.5, rand() * Math.PI, rand() * 0.5);
    rock.scale.set(rs, rs * 0.7, rs);
    g.add(rock);
  }

  g.rotation.y = rand() * Math.PI * 2; // random facing
  return g;
}

// ---------------------------------------------------------------------------
// 2) River bridge dressing — railings, pylons and an arch wrapping the road
//    where it crosses a river. Local axes match the track: road runs along +Z,
//    centred on x=0. The car drives the REAL road, so the driving corridor
//    (|x| < 6, and all headroom above the road) is kept completely clear — every
//    solid piece sits at |x| >= ~6.1, and the water is far below at y = -2.5.
// ---------------------------------------------------------------------------

const WATER_Y = -2.5;

export function makeRiverBridge(pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();

  // stone tones tinted from the realm (road = lighter parapet stone, mountain =
  // darker piers / arch)
  const stone = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.road).lerp(new THREE.Color(0xffffff), 0.12),
    roughness: 0.85, metalness: 0.03, flatShading: true,
  });
  const darkStone = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.mountain).lerp(new THREE.Color(0xffffff), 0.06),
    roughness: 0.9, metalness: 0.03, flatShading: true,
  });

  // --- (a) the river ------------------------------------------------------
  // a wide translucent blue sheet passing under the road, far out on both sides.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 26),
    new THREE.MeshStandardMaterial({
      color: 0x2a6bb0, emissive: 0x0d2c50, emissiveIntensity: 0.12,
      roughness: 0.15, metalness: 0.15, transparent: true, opacity: 0.72,
      side: THREE.DoubleSide,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  g.add(water);

  // an opaque darker bed just below so you never see through the river to nothing
  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(96, 30),
    new THREE.MeshStandardMaterial({ color: 0x123a63, roughness: 0.95, side: THREE.DoubleSide })
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = WATER_Y - 0.9;
  g.add(bed);

  // a few pale ripple streaks across the surface for a wet sheen
  const rippleMat = new THREE.MeshStandardMaterial({
    color: 0x7fb0dc, emissive: 0x8fc0ea, emissiveIntensity: 0.18,
    transparent: true, opacity: 0.5, roughness: 0.2, side: THREE.DoubleSide,
  });
  const rippleGeo = new THREE.PlaneGeometry(78, 1.1);
  for (const rz of [-8, -1, 6]) {
    const rip = new THREE.Mesh(rippleGeo, rippleMat);
    rip.rotation.x = -Math.PI / 2;
    rip.position.set(0, WATER_Y + 0.05, rz);
    g.add(rip);
  }

  // --- geometry shared across both road sides -----------------------------
  const railX = ROAD_HALF_WIDTH + 1.4;  // 6.4 — just outside the road edge,
                                        // keeping the |x| < 6 corridor clear
  const zEnd = 11;                      // parapets/arch run ~24 units in Z
  const railTop = 1.2;

  const balusterGeo = new THREE.BoxGeometry(0.35, 0.72, 0.35);
  const newelGeo = new THREE.BoxGeometry(0.62, railTop + 0.35, 0.62);
  const pylonGeo = new THREE.BoxGeometry(0.6, Math.abs(WATER_Y) + 0.4, 0.6);
  const abutGeo = new THREE.BoxGeometry(1.2, 3.4, 1.7);

  for (const sx of [-1, 1]) {
    const x = sx * railX;

    // --- (b) parapet: curb + top rail cap + balusters + end newels --------
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, zEnd * 2), stone);
    curb.position.set(x, 0.16, 0);
    g.add(curb);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, zEnd * 2), stone);
    cap.position.set(x, railTop - 0.11, 0);
    g.add(cap);

    const posts = 9;
    for (let i = 0; i < posts; i++) {
      const z = -zEnd + 1.2 + (i / (posts - 1)) * (zEnd * 2 - 2.4);
      const b = new THREE.Mesh(balusterGeo, stone);
      b.position.set(x, 0.32 + 0.36, z);
      g.add(b);
    }
    for (const sz of [-1, 1]) {
      const newel = new THREE.Mesh(newelGeo, stone);
      newel.position.set(x, (railTop + 0.35) / 2, sz * (zEnd - 0.3));
      g.add(newel);
    }

    // --- (c) support pylons + a shallow arch under the deck ---------------
    for (const pz of [-6.5, 6.5]) {
      const pylon = new THREE.Mesh(pylonGeo, darkStone);
      pylon.position.set(x, -(Math.abs(WATER_Y) + 0.4) / 2 + 0.05, pz);
      g.add(pylon);
    }

    // parabolic arch: crown just below the deck at z=0, springs down to the
    // water at the Z ends. Stays at y <= 0 so nothing rises above the road.
    const segs = 10;
    const yAt = (z: number) => -0.2 - (Math.abs(WATER_Y) - 0.2) * (z / zEnd) ** 2;
    let prev = new THREE.Vector3(x, yAt(-zEnd), -zEnd);
    for (let i = 1; i <= segs; i++) {
      const z = -zEnd + (2 * zEnd) * (i / segs);
      const next = new THREE.Vector3(x, yAt(z), z);
      g.add(beam(prev, next, 0.45, darkStone));
      prev = next;
    }

    // --- (d) stone abutments at the Z ends --------------------------------
    for (const sz of [-1, 1]) {
      const abut = new THREE.Mesh(abutGeo, darkStone);
      // pushed further out (centre x=7.0) so the corridor stays clear
      abut.position.set(sx * 7.0, -1.1, sz * zEnd);
      g.add(abut);
    }
  }

  return g;
}
