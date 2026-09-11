import * as THREE from "three";
import type { CarId } from "../game/engine";
import { metalDetail, pbr } from "./textures";

// A car type is a distinct hull silhouette + a set of driving stats. The livery
// color is supplied at build time (the player's pick, or an opponent's team
// color), so every type can appear in any color. Stats/metadata live in
// carData.ts (no three.js); this file only builds the meshes.
//
// Design brief: SEGA arcade-racer / Hot Shot Racing look — cars must read
// INSTANTLY as cars. That means crisp faceted low-poly bodywork with clearly
// defined features: a stepped hood + grille + bumper up front, flared wheel
// arches over every tyre, a proper greenhouse (slanted windshield, side glass,
// roof, visible A/C pillars) with a driver (helmet + shoulders) inside, sharp
// side character lines, and a clear rear (taillights, diffuser, spoiler). No
// smooth blobs — sharp edges read as "car".
export { CAR_SPECS, CAR_IDS } from "./carData";
export type { CarStat, CarStars, CarSpec } from "./carData";
export type { CarId } from "../game/engine";

// ---------------------------------------------------------------------------
// low-poly building blocks
// ---------------------------------------------------------------------------

function paint(
  color: number,
  o: { metal?: number; rough?: number; emissive?: number; ei?: number; flat?: boolean } = {}
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: o.metal ?? 0.5,
    roughness: o.rough ?? 0.4,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.ei ?? 0,
    flatShading: o.flat ?? false,
  });
}

/** The realm's sky colour, or null for a neutral finish. Read at material
 *  BUILD time by carPaint (the engine sets it before building a race's grid). */
let _envTint: number | null = null;

/**
 * Real two-layer automotive body paint: a coloured base coat under a separate,
 * near-mirror CLEARCOAT lacquer. The clearcoat is what makes paint read as
 * *paint* rather than coloured plastic — it adds a second, much tighter
 * specular lobe and a second environment reflection on top of the base, so a
 * panel simultaneously shows its livery colour, a hard moving highlight from
 * the key light, and a soft reflection of the sky.
 *
 * Deliberately NO `envMap`: the engine installs a PMREM-filtered HDR sky probe
 * as `scene.environment`, and three feeds that to any standard/physical
 * material whose own `envMap` is null. That matters because the physical IBL
 * path only handles CubeUV (PMREM) maps — a raw equirectangular canvas assigned
 * to `envMap` contributes *literally nothing* to a MeshPhysicalMaterial while
 * still suppressing the scene probe, which is why the bodywork used to read as
 * flat plastic. Letting the scene probe through also means reflections are
 * roughness-prefiltered (blurry on satin, sharp on the clearcoat) and already
 * carry the realm's colours.
 */
/** Poster mode: realms built from the 80s city-pop art deliberately run a very
 *  low ambient so scenery falls into silhouette. A physically-correct car under
 *  that light goes dark and grey — but in the reference art the car is the one
 *  BOLD, saturated shape in the frame. So in poster realms the paint gets an
 *  emissive floor of its own colour: it holds its livery no matter how little
 *  light reaches it, which is what makes it read as a poster car rather than an
 *  unlit object. */
let _poster = false;
export function setCarPosterMode(on: boolean): void { _poster = on; }

function carPaint(
  color: number,
  o: { metal?: number; rough?: number; flat?: boolean } = {}
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    // Paint is a DIELECTRIC with metal flake suspended in it, not bare metal.
    // Low metalness keeps the livery colour saturated and leaves the gloss to
    // the clearcoat; the old 0.4-0.55 made every car look chrome-dipped and
    // washed the colour out (a metal's diffuse albedo is black).
    metalness: o.metal ?? 0.18,
    roughness: o.rough ?? 0.34,
    clearcoat: 0.95,
    clearcoatRoughness: 0.07,   // freshly polished lacquer — tight, not a mirror
    // While scene.environment is set, three overwrites this uniform with the
    // scene's environmentIntensity, so it only bites if the probe is missing.
    // 1.0 = catch the sky at full strength but no reflectivity boost (>1 is
    // what tips clearcoat over into looking like chrome).
    envMapIntensity: 1.0,
    flatShading: o.flat ?? false,
  });
  if (_poster) {
    // hold the livery under near-zero ambient, and flatten the lacquer so the
    // body reads as one clean colour block instead of a gradient of highlights
    mat.emissive = new THREE.Color(color);
    mat.emissiveIntensity = 0.34;
    mat.clearcoat = 0.55;
    mat.roughness = Math.max(mat.roughness, 0.42);
    mat.metalness = 0.05;
  }
  // No clearcoatNormalMap on purpose: the panel/flake normal map (applied in
  // carMaterials) perturbs only the BASE coat, so the lacquer stays a perfectly
  // smooth layer floating over textured paint. That mismatch between the two
  // layers' normals IS the depth cue of a real finish — and it costs nothing.
  if (_envTint !== null) {
    // Realm reflection tint. The bulk of it is already free (the scene probe is
    // built from this same palette); this only nudges the base coat's specular
    // F0 colour toward the realm sky. Kept at 0.3 — a full tint reads as
    // coloured chrome instead of tinted lacquer.
    mat.specularColor.lerp(new THREE.Color(_envTint), 0.3);
  }
  return mat;
}

/** Tint newly built cars' reflections toward a realm's sky colour (or null for
 *  a neutral finish). Call BEFORE building the cars for a race — the paint
 *  materials read the tint at construction time. Chrome, glass and the alloys
 *  need no tint of their own: they reflect `scene.environment`, which the engine
 *  builds from the same realm palette. */
export function setCarEnvTint(hex: number | null): void {
  _envTint = hex;
}

/**
 * A procedural racing livery painted into the loft's 0..1 UV space: a two-tone
 * lower body (a crisp beltline feature-line where it meets the base), a bold
 * centre racing stripe down the top centreline, shut-lines, and a numbered race
 * roundel on each flank. Reads as real painted bodywork with panel detail rather
 * than flat colour. Cached per colour set so a full grid is cheap.
 *
 * UV layout (from loftBody): u wraps the section — u≈0 / u≈1 = bottom, u≈0.2 /
 * u≈0.8 = beltline, u≈0.5 = top centre; v runs nose→tail.
 */
const _livery = new Map<string, THREE.Texture>();
function liveryTexture(baseHex: number, darkHex: number, accentHex: number, stripeHex: number, num: number): THREE.Texture {
  const key = `${baseHex}|${darkHex}|${accentHex}|${stripeHex}|${num}`;
  const hit = _livery.get(key);
  if (hit) return hit;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  const hex = (h: number) => "#" + (h & 0xffffff).toString(16).padStart(6, "0");

  ctx.fillStyle = hex(baseHex);
  ctx.fillRect(0, 0, S, S);
  // two-tone lower body (wraps the bottom centre up to the beltline) + a bright
  // beltline accent line where the two tones meet
  ctx.fillStyle = hex(darkHex);
  ctx.fillRect(0, 0, 0.28 * S, S);
  ctx.fillRect(0.72 * S, 0, 0.28 * S, S);
  ctx.fillStyle = hex(accentHex);
  ctx.fillRect(0.268 * S, 0, 0.014 * S, S);
  ctx.fillRect(0.718 * S, 0, 0.014 * S, S);
  // bold centre racing stripe down the top centreline, with accent edges
  ctx.fillStyle = hex(stripeHex);
  ctx.fillRect(0.46 * S, 0, 0.08 * S, S);
  ctx.fillStyle = hex(accentHex);
  ctx.fillRect(0.443 * S, 0, 0.017 * S, S);
  ctx.fillRect(0.54 * S, 0, 0.017 * S, S);
  // forward-pointing hood chevrons
  ctx.strokeStyle = hex(accentHex);
  ctx.lineWidth = 0.028 * S;
  ctx.lineCap = "round";
  for (const cy of [0.1, 0.17]) {
    ctx.beginPath();
    ctx.moveTo(0.41 * S, (cy + 0.06) * S);
    ctx.lineTo(0.5 * S, cy * S);
    ctx.lineTo(0.59 * S, (cy + 0.06) * S);
    ctx.stroke();
  }
  // panel shut-lines across the body (hood / doors / trunk seams)
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  for (const y of [0.28, 0.52, 0.76]) ctx.fillRect(0, y * S, S, 2);
  // numbered race roundels on each flank. The loft UVs stretch far more along
  // the length (v) than around the section (u), so squash in v to keep the
  // roundel round on the bodywork.
  for (const x of [0.35, 0.65]) {
    ctx.save();
    ctx.translate(x * S, 0.5 * S);
    ctx.scale(1, 0.5);
    ctx.beginPath();
    ctx.fillStyle = "#eef2f8";
    ctx.arc(0, 0, 0.088 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.02 * S;
    ctx.strokeStyle = hex(accentHex);
    ctx.stroke();
    ctx.fillStyle = hex(darkHex);
    ctx.font = `bold ${0.12 * S}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(num), 0, 0.006 * S);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _livery.set(key, tex);
  return tex;
}

function box(
  w: number, h: number, d: number, mat: THREE.Material,
  x = 0, y = 0, z = 0
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Shared dark hub/lug material sitting behind the alloy spokes. One instance
 *  for every car — the colour is constant, so sharing keeps setup cheap. */
let _hubMat: THREE.MeshStandardMaterial | null = null;
function hubMat(): THREE.MeshStandardMaterial {
  return (_hubMat ??= new THREE.MeshStandardMaterial({ color: 0x0d0d13, metalness: 0.8, roughness: 0.35 }));
}

/** The car materials whose colour does NOT depend on the livery. */
interface NeutralMats {
  glass: THREE.MeshStandardMaterial;
  tireMat: THREE.MeshStandardMaterial;
  chromeMat: THREE.MeshStandardMaterial;
  grilleMat: THREE.MeshStandardMaterial;
  headMat: THREE.MeshStandardMaterial;
  lensMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshStandardMaterial;
}

/**
 * Glass, rubber, chrome, grille mesh and lamp lenses are the same on every car,
 * so they are built ONCE and shared by the whole grid instead of re-created per
 * car: seven fewer material instances on each of ten cars (~70 fewer), which
 * means seven uniform blocks instead of seventy and no duplicate shader
 * variants. None of them is tinted per realm — they all reflect
 * `scene.environment`, so the realm's colour arrives for free.
 *
 * NONE of these gets a clearcoat. Glass is a single surface (a second lacquer
 * layer would only buy a double highlight), and rubber/grille/lens are matte or
 * self-lit — clearcoat there would be pure cost for a wrong look.
 */
let _neutral: NeutralMats | null = null;
function neutralMats(): NeutralMats {
  if (_neutral) return _neutral;
  return (_neutral = {
    // dark, very smooth dielectric glazing: the low roughness lets the sky
    // probe mirror across the screen so windows read as glass, not grey panels
    glass: new THREE.MeshStandardMaterial({
      color: 0x0a1622, metalness: 0.35, roughness: 0.05,
      emissive: 0x0a1420, emissiveIntensity: 0.22, transparent: true, opacity: 0.6,
    }),
    // Tyres: the LEAST reflective thing on the car by a wide margin. Near-black
    // and very rough so the environment reflection is crushed to nothing —
    // that contrast against the lacquered panels is what sells the paint.
    tireMat: new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.92, metalness: 0.04, envMapIntensity: 0.35 }),
    chromeMat: paint(0x30333d, { metal: 0.95, rough: 0.2 }),
    grilleMat: paint(0x14141a, { metal: 0.7, rough: 0.5 }),
    headMat: paint(0xfff6d5, { emissive: 0xffe6a0, ei: 0.7 }),
    lensMat: paint(0xcdeeff, { emissive: 0x9fdcff, ei: 0.5, metal: 0.4, rough: 0.12 }),
    tailMat: paint(0x2a0000, { emissive: 0xff2626, ei: 0.65 }),
  });
}

/**
 * A wheel with real rim detail: a dark low-poly tyre, a dished rim barrel, and —
 * on the OUTBOARD face (toward `outSign`) — a multi-spoke alloy face (dark hub +
 * five crossed spokes + a bright lip ring) in the livery accent. Axle along X;
 * the group is positioned so the tyre rests on y=0. Detailing only the shown
 * face keeps four alloy wheels cheap enough for a full eight-car grid.
 */
function makeWheel(
  x: number, z: number, radius: number, treadW: number,
  tireMat: THREE.Material, rimMat: THREE.Material, outSign = 1
): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, treadW, 16), tireMat);
  tire.rotation.z = Math.PI / 2;
  g.add(tire);
  // dished rim barrel just inside the tyre
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.64, radius * 0.64, treadW * 1.02, 8), rimMat);
  barrel.rotation.z = Math.PI / 2;
  g.add(barrel);
  // alloy face (hub + crossed spokes + lip ring) on the visible outboard side
  const face = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.26, radius * 0.24, 0.05, 12), hubMat());
  hub.rotation.z = Math.PI / 2;
  face.add(hub);
  const spokeGeo = new THREE.BoxGeometry(0.035, radius * 1.26, radius * 0.13);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(spokeGeo, rimMat);
    s.rotation.x = (i / 5) * Math.PI; // five crossed bars → a ten-arm alloy
    face.add(s);
  }
  const lip = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.86, radius * 0.09, 4, 18), rimMat);
  lip.rotation.y = Math.PI / 2;
  face.add(lip);
  face.position.x = outSign * (treadW / 2 + 0.01);
  g.add(face);
  g.position.set(x, radius, z);
  // tag so the engine can spin (X) and steer (Y) it; YXZ = steer then spin
  g.rotation.order = "YXZ";
  g.userData.wheel = true;
  g.userData.wheelR = radius;
  return g;
}

/**
 * Loft a smooth, faceted car body from a spine of cross-section ribs. Each rib
 * gives the RIGHT half of the section as [x,y] points ordered bottom-centre →
 * out and up → top-centre (x >= 0); it is mirrored to the left to close the
 * loop, so the body is symmetric. Every rib must have the same point count.
 * Consecutive ribs are skinned with quads and the end ribs are capped, giving
 * one continuous shell with real thickness (nose taper, fender swells, cabin,
 * haunches, tail) rather than separate blocks. flatShading reads the facets.
 *
 * Ribs are supplied front (nose, high +z) → back (tail, -z). Winding is set so
 * face normals point outward with normal backface culling.
 */
interface Rib { z: number; half: [number, number][]; }

/** Catmull-Rom interpolation of four scalars (smooth spine through the ribs). */
function catmull(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

/**
 * Loft a car body from a spine of cross-section ribs. `subdiv` Catmull-Rom
 * resamples the spine for a SMOOTH lengthwise surface; the result is an indexed,
 * UV-mapped, smooth-normal shell (so panel/metal normal maps show and shading
 * flows). Set the material's `flatShading` to taste — off = smooth car-paint,
 * on = faceted. Ribs are supplied front (nose, +z) → back (tail, -z); winding
 * gives outward normals under normal backface culling.
 */
function loftBody(ribs: Rib[], mat: THREE.Material, subdiv = 1): THREE.Mesh {
  const M = ribs[0].half.length;

  // resample the rib spine (each half-point x,y and z splined over rib index)
  let out = ribs;
  if (subdiv > 1) {
    const K = ribs.length;
    out = [];
    const steps = (K - 1) * subdiv;
    for (let s = 0; s <= steps; s++) {
      const u = (s / steps) * (K - 1);
      const i = Math.min(K - 2, Math.floor(u));
      const t = u - i;
      const r0 = ribs[Math.max(0, i - 1)], r1 = ribs[i], r2 = ribs[i + 1], r3 = ribs[Math.min(K - 1, i + 2)];
      const half: [number, number][] = [];
      for (let k = 0; k < M; k++) {
        half.push([
          catmull(r0.half[k][0], r1.half[k][0], r2.half[k][0], r3.half[k][0], t),
          catmull(r0.half[k][1], r1.half[k][1], r2.half[k][1], r3.half[k][1], t),
        ]);
      }
      out.push({ z: catmull(r0.z, r1.z, r2.z, r3.z, t), half });
    }
  }

  const loopOf = (r: Rib): number[][] => {
    const pts: number[][] = [];
    for (let i = 0; i < M; i++) pts.push([r.half[i][0], r.half[i][1], r.z]);       // right, bottom→top
    for (let i = M - 2; i >= 1; i--) pts.push([-r.half[i][0], r.half[i][1], r.z]);  // left, top→bottom
    return pts;
  };
  const loops = out.map(loopOf);
  const R = loops.length;
  const N = loops[0].length; // = 2M - 2

  const positions: number[] = [];
  const uvs: number[] = [];
  for (let s = 0; s < R; s++)
    for (let i = 0; i < N; i++) {
      const p = loops[s][i];
      positions.push(p[0], p[1], p[2]);
      // 0..1 UVs: u wraps the cross-section (0.5 = top centreline), v runs the
      // length. The livery map spans this once; the panel normal tiles via its
      // own texture.repeat.
      uvs.push(i / N, s / (R - 1));
    }
  const index: number[] = [];
  for (let s = 0; s < R - 1; s++)
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const aI = s * N + i, bI = (s + 1) * N + i, aJ = s * N + j, bJ = (s + 1) * N + j;
      index.push(aI, bI, aJ, aJ, bI, bJ);
    }
  const addCap = (s: number, front: boolean) => {
    const loop = loops[s];
    let cx = 0, cy = 0;
    for (const p of loop) { cx += p[0]; cy += p[1]; }
    const ci = positions.length / 3;
    positions.push(cx / N, cy / N, loop[0][2]);
    uvs.push(0.5, front ? 0 : 1);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = s * N + i, b = s * N + j;
      if (front) index.push(ci, a, b); else index.push(ci, b, a);
    }
  };
  addCap(0, true);
  addCap(R - 1, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  // crisp toon ink edge on opaque shells (skip transparent glass canopies)
  if (!(mat as THREE.Material).transparent) mesh.add(makeOutline(geo));
  return mesh;
}

/** A toon "ink" outline for a lofted shell: a copy of the geometry pushed out
 *  along its normals and drawn as dark back-faces, so it reads as a crisp
 *  silhouette line around the smooth bodywork (the Hotshot cel-shaded edge). */
let _outlineMat: THREE.MeshBasicMaterial | null = null;
function makeOutline(geo: THREE.BufferGeometry, thickness = 0.02): THREE.Mesh {
  const g2 = geo.clone();
  const pos = g2.getAttribute("position") as THREE.BufferAttribute;
  const nor = g2.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++)
    pos.setXYZ(i, pos.getX(i) + nor.getX(i) * thickness, pos.getY(i) + nor.getY(i) * thickness, pos.getZ(i) + nor.getZ(i) * thickness);
  pos.needsUpdate = true;
  _outlineMat ??= new THREE.MeshBasicMaterial({ color: 0x0a0c12, side: THREE.BackSide });
  return new THREE.Mesh(g2, _outlineMat);
}

/**
 * A flat panel (windshield, backlight, pillar) bridging two points in the
 * side (z,y) plane at a given x. `width` is the panel's extent across X; the
 * plate is rotated so its long axis runs from (z0,y0) to (z1,y1).
 */
function panelBetween(
  x: number, z0: number, y0: number, z1: number, y1: number,
  width: number, thick: number, mat: THREE.Material
): THREE.Mesh {
  const dz = z1 - z0, dy = y1 - y0;
  const len = Math.hypot(dz, dy);
  const m = box(width, thick, len, mat, x, (y0 + y1) / 2, (z0 + z1) / 2);
  m.rotation.x = -Math.atan2(dy, dz); // +z end lands on (z1,y1)
  return m;
}

let _helmetMat: THREE.MeshStandardMaterial | null = null;
let _visorMat: THREE.MeshStandardMaterial | null = null;

/** A seated racing driver: faceted helmet + dark visor + shoulders. Origin at
 *  the seat base; helmet sits ~0.5 above it. `suit` tints the shoulders. */
function makeDriver(suit: number, open = true): THREE.Group {
  const grp = new THREE.Group();
  // Closed-roof cars get NO helmet. A 0.16 m white sphere seated 0.5 m up
  // pokes through the roofline of anything with a low cabin and reads as a
  // golf ball floating over the car — you never see a head in a road car from
  // behind anyway, the glass is tinted. Shoulders stay so the cabin isn't
  // hollow when you look through the screen.
  // helmet + visor are the same on every driver, so they are shared across the
  // whole grid; only the suit carries the team colour
  _helmetMat ??= new THREE.MeshStandardMaterial({ color: 0xededf2, metalness: 0.3, roughness: 0.45, flatShading: true });
  _visorMat ??= new THREE.MeshStandardMaterial({ color: 0x0b0f16, metalness: 0.9, roughness: 0.12, emissive: 0x0a0e14, emissiveIntensity: 0.15 });
  const helmetMat = _helmetMat, visorMat = _visorMat;
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, metalness: 0.3, roughness: 0.6 });
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.36), suitMat);
  shoulders.position.set(0, 0.24, -0.02);
  grp.add(shoulders);
  if (open) {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), helmetMat);
    helmet.position.set(0, 0.5, 0);
    grp.add(helmet, box(0.2, 0.07, 0.03, visorMat, 0, 0.5, 0.14));
  }
  return grp;
}

type Wing = "duck" | "swan" | "low" | "kart";

interface KartParams {
  length: number;
  width: number;
  ride: number;     // solid lower-body (beltline) height above the ground
  wheelR: number;
  wing: Wing;
  cabin?: number;   // greenhouse height as a fraction of the ride height
  open?: boolean;   // open cockpit (kart / formula) — no roof, driver exposed
  cage?: boolean;   // chrome roll cage over the cabin (stock car)
  scoop?: boolean;  // hood scoop (muscle car)
  bulky?: boolean;  // side pods + twin exhausts (the bruiser)
  mirrors?: boolean;
  num?: number;     // racing number painted in the door roundel
}

/**
 * Build a stylised faceted arcade race car facing +Z. The lower body is a crisp
 * stepped hull (low nose → low hood → sharp cowl → flat deck → tail drop),
 * flared fenders arch over each wheel, a narrower greenhouse carries a driver
 * under slanted glass (or open to the air), and the rear is clearly defined
 * with taillights, a diffuser and a type-appropriate spoiler. `color` is the
 * livery; darker/accent shades come from it so the machine reads as one piece.
 */
function buildKart(color: number, p: KartParams): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color, p.num);
  const { dark } = m;
  const { bodyMat, bodyPlain, darkMat, trimMat, glass, tireMat, rimMat, chromeMat, grilleMat, lensMat, tailMat } = m;

  const { length: L, width: W, wheelR: R } = p;
  const hl = L / 2;
  const hw = W / 2;
  // heights derived from the (small) wheel so the car reads long-and-low: the
  // fender crown sits just above the tyre, the hood dips below it, the cabin
  // rides on the beltline.
  const clr = R * 0.34;              // ground clearance under the floor
  const hoodY = R * 1.62;            // hood / bonnet height (below the fenders)
  const crownY = R * 2.18;           // fender crown — just above the tyre top
  const beltY = R * 2.2;             // beltline: where the glasshouse sits
  const cabH = p.cabin ?? 0.34;      // canopy height above the beltline
  const roofY = beltY + cabH;
  const rf = R, rr = R * 1.06;       // front / rear tyre radius
  const wx = hw * 0.72;              // wheel centreline (tucked under the fenders)
  const wzF = hl * 0.62, wzR = hl * 0.5; // wheel stations (align with the fender ribs)

  // === body: one lofted flowing shell =======================================
  // A half cross-section (x>=0), bottom-centre → out to the widest crown → in to
  // the deck centre. Varying it along the length gives a real car surface: a low
  // tapered nose, fenders that swell out of the body over each wheel, a dipped
  // hood, a rising cowl, muscular rear haunches and a tapered kammback tail.
  const hs = (
    floorY: number, wFloor: number, wMax: number, shoulderY: number, wDeck: number, deckY: number
  ): [number, number][] => [
    [0, floorY],
    [hw * wFloor, floorY],
    [hw * wMax, (floorY + shoulderY) / 2],
    [hw * wMax, shoulderY],
    [hw * wDeck, deckY],
    [0, deckY],
  ];
  const ribs: Rib[] = [
    { z: hl,        half: hs(hoodY * 0.5, 0.08, 0.18, hoodY * 0.66, 0.1,  hoodY * 0.78) }, // nose point
    { z: hl * 0.9,  half: hs(clr,        0.46, 0.7,  hoodY * 0.98, 0.5,  hoodY) },          // front overhang
    { z: hl * 0.62, half: hs(clr,        0.6,  0.99, crownY,       0.6,  hoodY) },          // front fender / arch
    { z: hl * 0.3,  half: hs(clr,        0.7,  0.96, crownY * 0.9, 0.62, beltY) },          // cowl (rises to belt)
    { z: -hl * 0.06,half: hs(clr,        0.72, 0.96, crownY * 0.88,0.64, beltY) },          // mid (cabin base)
    { z: -hl * 0.5, half: hs(clr,        0.64, 1.0,  crownY * 1.02,0.64, beltY * 0.98) },   // rear haunch (widest)
    { z: -hl * 0.82,half: hs(clr + 0.02, 0.56, 0.84, crownY * 0.82,0.54, beltY * 0.82) },   // tail taper
    { z: -hl,       half: hs(clr + 0.05, 0.38, 0.6,  crownY * 0.7, 0.38, beltY * 0.74) },   // kammback cap
  ];
  g.add(loftBody(ribs, bodyMat, 5));

  // sharp side character crease along the shoulder for a defined flank
  for (const sx of [-1, 1])
    g.add(box(0.04, 0.05, L * 0.7, darkMat, sx * hw * 0.95, crownY * 0.78, -L * 0.03));

  // === front end: splitter + grille + headlight clusters =====================
  g.add(box(W * 0.6, 0.05, L * 0.05, darkMat, 0, clr - 0.01, hl * 0.86));             // splitter lip
  g.add(box(W * 0.4, hoodY * 0.34, 0.06, grilleMat, 0, hoodY * 0.5, hl * 0.9));        // grille
  for (const sx of [-1, 1]) {
    g.add(box(W * 0.2, 0.11, 0.06, chromeMat, sx * hw * 0.6, crownY * 0.9, hl * 0.72));       // lamp housing
    const lens = new THREE.Mesh(new THREE.BoxGeometry(W * 0.15, 0.08, 0.05), lensMat);
    lens.position.set(sx * hw * 0.6, crownY * 0.9, hl * 0.75);
    g.add(lens);
  }
  if (p.scoop) {
    // muscle-car hood scoop: a raised block with a dark forward intake mouth
    g.add(box(W * 0.32, hoodY * 0.34, L * 0.16, bodyPlain, 0, hoodY + 0.08, hl * 0.36));
    g.add(box(W * 0.26, hoodY * 0.2, 0.05, grilleMat, 0, hoodY + 0.08, hl * 0.44));
  }

  // === rear end: diffuser + brake-light bar ==================================
  if (!p.bulky) { // diffuser (the bruiser's twin exhausts fill this space)
    g.add(box(W * 0.6, hoodY * 0.3, L * 0.05, grilleMat, 0, clr + 0.06, -hl * 0.9));
    for (const sx of [-1, 0, 1])
      g.add(box(0.04, hoodY * 0.3, L * 0.08, chromeMat, sx * W * 0.2, clr + 0.06, -hl * 0.91));
  }
  g.add(box(W * 0.62, 0.1, 0.05, tailMat, 0, crownY * 0.82, -hl * 0.92));              // brake-light bar
  for (const sx of [-1, 1])
    g.add(box(W * 0.15, 0.12, 0.05, tailMat, sx * W * 0.3, crownY * 0.72, -hl * 0.92)); // outboard brake blocks

  // === glass canopy ==========================================================
  const cw = hw * 0.6;                       // cabin base half-width
  // canopy half-section: a rounded arch with tumblehome, from the beltline up
  const canopyHalf = (w: number, yBase: number, yTop: number): [number, number][] => [
    [0, yBase],
    [w, yBase],
    [w * 0.97, (yBase + yTop) / 2],
    [w * 0.58, yTop],
    [0, yTop],
  ];
  const drv = makeDriver(dark.getHex(), !!p.open);

  if (p.open) {
    // open cockpit: a low wraparound windscreen + a roll hoop + exposed driver
    g.add(panelBetween(0, hl * 0.28, beltY, hl * 0.28 - L * 0.08, beltY + cabH * 0.7, cw * 1.5, 0.03, glass));
    for (const sx of [-1, 1])
      g.add(box(0.03, cabH * 0.4, L * 0.09, glass, sx * cw * 0.7, beltY + cabH * 0.28, hl * 0.24));
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 5, 10, Math.PI), chromeMat);
    hoop.scale.set(cw * 0.8, cabH * 1.05, 1);
    hoop.position.set(0, beltY, -hl * 0.32);
    g.add(hoop);
    drv.position.set(0, beltY - 0.02, 0);
    g.add(drv);
  } else {
    // closed glasshouse lofted on the beltline: a raked windshield rising to the
    // roof, then a fastback backlight. Body-colour A-/C-pillars frame the glass.
    const canopy: Rib[] = [
      { z: hl * 0.3,   half: canopyHalf(cw * 0.72, beltY, beltY + cabH * 0.12) }, // windshield foot (low)
      { z: hl * 0.04,  half: canopyHalf(cw,        beltY - 0.02, roofY) },        // roof front
      { z: -hl * 0.3,  half: canopyHalf(cw,        beltY - 0.02, roofY) },        // roof back
      { z: -hl * 0.52, half: canopyHalf(cw * 0.8,  beltY, beltY + cabH * 0.16) }, // backlight foot (low)
    ];
    g.add(loftBody(canopy, glass, 5));
    // pillars framing the glass
    for (const sx of [-1, 1]) {
      g.add(panelBetween(sx * cw * 0.66, hl * 0.3, beltY, hl * 0.04, roofY, 0.06, 0.05, bodyPlain));   // A-pillar
      g.add(panelBetween(sx * cw * 0.7, -hl * 0.52, beltY, -hl * 0.3, roofY, 0.06, 0.05, bodyPlain));  // C-pillar
    }
    // roof cap in body colour for a defined roofline
    g.add(box(cw * 1.1, 0.04, L * 0.34, bodyPlain, 0, roofY + 0.01, -hl * 0.13));
    drv.position.set(0, beltY - 0.34, hl * 0.06);
    g.add(drv);
  }

  // chrome roll cage over the cabin (stock car) — two hoops + side rails
  if (p.cage) {
    const cageGeo = new THREE.TorusGeometry(1, 0.045, 5, 10, Math.PI);
    for (const hz of [hl * 0.06, -hl * 0.3]) {
      const hoop = new THREE.Mesh(cageGeo, chromeMat);
      hoop.scale.set(cw * 0.95, cabH * 1.05, 1);
      hoop.position.set(0, beltY, hz);
      g.add(hoop);
    }
    for (const sx of [-1, 1])
      g.add(box(0.05, 0.05, hl * 0.36, chromeMat, sx * cw * 0.82, roofY - 0.02, -hl * 0.12));
  }

  // side mirrors on stalks
  if (p.mirrors) {
    for (const sx of [-1, 1]) {
      g.add(box(0.04, 0.04, 0.1, chromeMat, sx * (cw + 0.1), beltY + cabH * 0.3, hl * 0.18));  // stalk
      g.add(box(0.1, 0.06, 0.06, bodyPlain, sx * (cw + 0.17), beltY + cabH * 0.32, hl * 0.18));  // housing
    }
  }

  // === type-specific spoiler ================================================
  if (p.wing === "duck") {
    // tidy ducktail lip on the rear deck (balanced GT)
    g.add(box(hw * 1.2, 0.06, L * 0.1, darkMat, 0, beltY * 0.94 + 0.05, -hl * 0.82));
    g.add(box(hw * 1.2, 0.03, L * 0.04, trimMat, 0, beltY * 0.94 + 0.09, -hl * 0.85)); // accent lip
  } else if (p.wing === "low") {
    // wide, low bruiser wing on stubby end plates (stock car)
    const wy = beltY + 0.24;
    g.add(box(W * 1.02, 0.08, L * 0.15, darkMat, 0, wy, -hl * 0.9));
    for (const sx of [-1, 1])
      g.add(box(0.09, 0.3, L * 0.14, darkMat, sx * W * 0.48, wy - 0.14, -hl * 0.9));
  } else if (p.wing === "swan") {
    // tall swan-neck GT wing for the top-speed car
    const wy = roofY + 0.24;
    g.add(box(W * 0.98, 0.05, L * 0.14, darkMat, 0, wy, -hl * 0.88));
    g.add(box(W * 0.98, 0.03, L * 0.05, trimMat, 0, wy + 0.05, -hl * 0.92)); // Gurney flap
    for (const sx of [-1, 1]) {
      const stalk = box(0.07, wy - beltY, 0.13, chromeMat, sx * hw * 0.6, (beltY + wy) / 2, -hl * 0.82);
      stalk.rotation.x = -0.14;
      g.add(stalk);
    }
  } else if (p.wing === "kart") {
    // compact rear wing on twin low pylons (nimble kart)
    const wy = beltY + 0.34;
    g.add(box(W * 0.86, 0.05, L * 0.11, darkMat, 0, wy, -hl * 0.84));
    for (const sx of [-1, 1])
      g.add(box(0.05, wy - beltY, 0.09, chromeMat, sx * hw * 0.5, (beltY + wy) / 2, -hl * 0.8));
  }

  // === bruiser side pods + twin exhausts, else twin thruster nozzles ========
  if (p.bulky) {
    const exGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.36, 10);
    for (const sx of [-1, 1]) {
      const ex = new THREE.Mesh(exGeo, chromeMat);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(sx * W * 0.34, clr + 0.16, -hl * 0.93);
      g.add(ex);
    }
  } else {
    const nozzleGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.18, 12);
    for (const sx of [-1, 1]) {
      const n = new THREE.Mesh(nozzleGeo, trimMat);
      n.rotation.x = Math.PI / 2;
      n.position.set(sx * W * 0.2, hoodY * 0.6, -hl * 0.93);
      g.add(n);
    }
  }

  // === wheels (small, tucked into the arches; alloy on the outboard face) ====
  g.add(
    makeWheel(-wx, wzF, rf, rf * 0.7, tireMat, rimMat, -1),
    makeWheel(wx, wzF, rf, rf * 0.7, tireMat, rimMat, 1),
    makeWheel(-wx, -wzR, rr, rr * 0.74, tireMat, rimMat, -1),
    makeWheel(wx, -wzR, rr, rr * 0.74, tireMat, rimMat, 1)
  );

  return g;
}

// ---------------------------------------------------------------------------
// shared building blocks for the dedicated silhouette builders below
// ---------------------------------------------------------------------------

interface CarMaterials extends NeutralMats {
  base: THREE.Color;
  accent: THREE.Color;
  dark: THREE.Color;
  accentHex: number;
  /** the lofted shell — clearcoated paint carrying the livery map */
  bodyMat: THREE.MeshPhysicalMaterial;
  /** body-colour panels with no livery map (scoop, pillars, roof cap, wings) */
  bodyPlain: THREE.MeshPhysicalMaterial;
  darkMat: THREE.MeshStandardMaterial;
  trimMat: THREE.MeshStandardMaterial;
  rimMat: THREE.MeshStandardMaterial;
}

/**
 * The livery-derived material palette.
 *
 * Only the PAINTED PANELS are clearcoat physical materials: `bodyMat` (the
 * lofted shell) and `bodyPlain` (body-colour panels that can't carry the livery
 * map). That is two MeshPhysicalMaterials per car — 20 across a full grid,
 * sharing just two shader programs — instead of one per mesh. Everything else
 * is MeshStandardMaterial:
 *   - `darkMat` is satin, not lacquered: it dresses splitters, diffusers, wing
 *     blades, endplates, chassis rails and engine blocks, which on a real car
 *     are bare carbon/plastic. Clearcoating them would have doubled the
 *     physical-material count for a finish that would look *wrong*.
 *   - `trimMat`/`rimMat` are the emissive accent and the bright alloy.
 *   - glass / tyre / chrome / grille / lamps come from the shared neutral set.
 * All of them carry the CC0 metal-plate normal for panel/flake relief (visible
 * thanks to the lofts' UVs), and all read `scene.environment` for reflections.
 */
function carMaterials(color: number, raceNum?: number): CarMaterials {
  const base = new THREE.Color(color);
  // richen very light liveries (e.g. COMET's pale cyan) so the smooth glossy
  // paint doesn't wash out to near-white under the environment reflection
  const bl = { h: 0, s: 0, l: 0 };
  base.getHSL(bl);
  if (bl.l > 0.6) base.offsetHSL(0, 0.06, -0.18);
  const accent = base.clone().offsetHSL(0, 0.05, 0.26);
  const dark = base.clone().offsetHSL(0, -0.05, -0.24);
  const accentHex = accent.getHex();

  // clearcoat paint, PAINT PANELS ONLY (see the doc comment above)
  const bodyMat = carPaint(base.getHex(), { rough: 0.3 });    // main shell (liveried)
  const bodyPlain = carPaint(base.getHex(), { rough: 0.33 }); // body-colour panels (no livery map)
  // satin dark for aero/structure — no clearcoat
  const darkMat = paint(dark.getHex(), { metal: 0.3, rough: 0.55 });
  const trimMat = paint(accentHex, { emissive: accentHex, ei: 0.45, metal: 0.6, rough: 0.28 });
  // painted racing livery (two-tone + centre stripe + roundel + panel lines);
  // the map carries the colours, so the shell material stays white and untinted.
  // Stripe contrasts with the base (dark stripe on light liveries, light on dark)
  // so it reads on every car rather than washing out.
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const stripe = (hsl.l > 0.52
    ? base.clone().offsetHSL(0, -0.1, -0.5)
    : base.clone().offsetHSL(0, -0.3, 0.45)
  ).getHex();
  const num = ((base.getHex() >> 3) % 8) + 1;
  bodyMat.map = liveryTexture(base.getHex(), dark.getHex(), accentHex, stripe, raceNum ?? num);
  bodyMat.color.set(0xffffff);
  // CC0 metal-plate normal (panel/scratch relief) adds surface texture without
  // tinting; the loft's UVs tile it across the bodywork. Procedural fallback.
  const lib = pbr();
  if (lib) {
    lib.metal.nor.repeat.set(2, 2);
    for (const mat of [bodyMat, bodyPlain, darkMat, trimMat]) {
      mat.normalMap = lib.metal.nor;
      mat.normalScale = new THREE.Vector2(0.75, 0.75);
    }
  } else {
    const { map: metalMap, bump: metalBump } = metalDetail();
    for (const mat of [bodyMat, bodyPlain, darkMat]) {
      mat.bumpMap = metalBump;
      mat.bumpScale = 0.04;
      void metalMap;
    }
  }
  // bright alloy wheel face in the livery accent (per-car colour, so not shared)
  const rimMat = paint(accentHex, { metal: 0.95, rough: 0.22 });
  // The accent metals want a slightly hotter reflection than the paint. NOTE:
  // three overwrites envMapIntensity with scene.environmentIntensity while the
  // scene probe is installed, so this is the probe-less fallback — the values
  // are kept honest so the look survives if the engine ever hands cars their
  // own envMap.
  for (const mm of [trimMat, rimMat]) mm.envMapIntensity = 1.15;

  return {
    base, accent, dark, accentHex,
    bodyMat, bodyPlain, darkMat, trimMat, rimMat,
    ...neutralMats(),
  };
}

/** A standard faceted road tyre with an alloy face (axle along X, bottom resting
 *  on y=0). `wide` scales the tread width as a fraction of the radius; the alloy
 *  is built on the outboard face inferred from the sign of `x`. */
function tyre(
  x: number, z: number, radius: number,
  tireMat: THREE.Material, rimMat: THREE.Material, wide = 0.72
): THREE.Group {
  return makeWheel(x, z, radius, radius * wide, tireMat, rimMat, x < 0 ? -1 : 1);
}

/** An enormous knobbly monster-truck tyre: chunky faceted carcass + a raised
 *  tread band + a small hub. Bottom rests on y=0. */
function monsterWheel(
  x: number, z: number, radius: number,
  tireMat: THREE.Material, rimMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  const w = radius * 0.8;
  const carcass = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, w, 10), tireMat);
  carcass.rotation.z = Math.PI / 2;
  const tread = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.94, radius * 0.16, 5, 10), tireMat);
  tread.rotation.y = Math.PI / 2;           // ring plane faces X (the axle)
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.4, radius * 0.4, w * 1.04, 8), rimMat);
  hub.rotation.z = Math.PI / 2;
  g.add(carcass, tread, hub);
  // spoked bead-lock face on the outboard side (dark centre cap + crossed spokes)
  const outSign = x < 0 ? -1 : 1;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.18, radius * 0.16, 0.06, 10), hubMat());
  cap.rotation.z = Math.PI / 2;
  cap.position.x = outSign * (w / 2 + 0.02);
  g.add(cap);
  const spokeGeo = new THREE.BoxGeometry(0.05, radius * 0.78, radius * 0.12);
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(spokeGeo, rimMat);
    s.rotation.x = (i / 4) * Math.PI;
    s.position.x = outSign * (w / 2 + 0.01);
    g.add(s);
  }
  g.position.set(x, radius, z);
  g.rotation.order = "YXZ";
  g.userData.wheel = true;
  g.userData.wheelR = radius;
  return g;
}

/** A straight suspension link / wishbone bar running out along X toward a hub. */
function suspensionArm(x0: number, x1: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
  return box(Math.abs(x1 - x0), 0.05, 0.09, mat, (x0 + x1) / 2, y, z);
}

// ---------------------------------------------------------------------------
// APEX — open-wheel formula car
// ---------------------------------------------------------------------------

/** A long pointed nose, exposed slick tyres on visible wishbones, wide front &
 *  rear wings, sidepods, an airbox and a haloed open cockpit. Reads instantly
 *  as an F1 machine — no fenders anywhere, that's the signature. */
function buildFormula(color: number, num?: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color, num);
  const { bodyMat, bodyPlain, darkMat, trimMat, chromeMat, tireMat, rimMat, tailMat } = m;

  const L = 4.8, R = 0.42;
  const hl = L / 2;                     // 2.4
  const floor = 0.08;                   // ultra-low monocoque

  // --- lofted monocoque: a smooth slim fuselage from a pointed nose up to the
  // cockpit coaming and engine-cover hump, tapering to the gearbox ---
  const hf = (fy: number, wb: number, wm: number, my: number, wt: number, ty: number): [number, number][] =>
    [[0, fy], [wb, fy], [wm, my], [wt, ty], [0, ty]];
  const tub: Rib[] = [
    { z: 2.0,  half: hf(0.2, 0.03, 0.06, 0.22, 0.03, 0.24) }, // nose tip
    { z: 1.4,  half: hf(0.09, 0.1, 0.17, 0.18, 0.09, 0.28) }, // nose
    { z: 0.7,  half: hf(0.06, 0.17, 0.28, 0.18, 0.15, 0.36) }, // front bulkhead
    { z: 0.1,  half: hf(0.05, 0.22, 0.36, 0.22, 0.19, 0.5) }, // cockpit coaming
    { z: -0.5, half: hf(0.05, 0.24, 0.38, 0.24, 0.17, 0.46) }, // behind cockpit
    { z: -1.1, half: hf(0.07, 0.17, 0.3, 0.28, 0.11, 0.54) }, // engine cover hump
    { z: -1.9, half: hf(0.09, 0.08, 0.15, 0.3, 0.05, 0.36) }, // gearbox / tail
  ];
  g.add(loftBody(tub, bodyMat, 5));
  for (const sx of [-1, 1]) // sharp floor-edge crease
    g.add(box(0.05, 0.06, L * 0.55, darkMat, sx * 0.36, floor + 0.03, -0.1));

  // --- wide low front wing across the nose tip + endplates ---
  const fwZ = hl * 0.94;
  g.add(box(1.9, 0.04, 0.42, darkMat, 0, floor + 0.05, fwZ));
  g.add(box(1.7, 0.03, 0.26, trimMat, 0, floor + 0.12, fwZ + 0.05));      // upper flap (accent)
  for (const sx of [-1, 1])
    g.add(box(0.05, 0.34, 0.5, darkMat, sx * 0.95, floor + 0.18, fwZ));   // endplates

  // --- tall wide rear wing on twin pylons ---
  const rwY = floor + 0.9, rwZ = -hl * 0.92;
  g.add(box(1.7, 0.05, 0.5, darkMat, 0, rwY, rwZ));
  g.add(box(1.7, 0.04, 0.14, trimMat, 0, rwY + 0.12, rwZ - 0.18));        // Gurney flap (accent)
  for (const sx of [-1, 1]) {
    g.add(box(0.07, rwY - floor - 0.2, 0.16, chromeMat, sx * 0.34, (floor + 0.34 + rwY) / 2, rwZ)); // pylon
    g.add(box(0.05, 0.52, 0.5, darkMat, sx * 0.84, rwY - 0.24, rwZ));     // endplates
  }

  // --- sidepods flanking the cockpit ---
  for (const sx of [-1, 1]) {
    g.add(box(0.42, 0.34, 1.5, bodyPlain, sx * 0.62, floor + 0.2, -0.3));
    g.add(box(0.16, 0.2, 0.06, tailMat, sx * 0.72, floor + 0.24, 0.42));  // pod intake mouth (glow)
  }

  // --- airbox / intake scoop rising behind the driver's head + engine-cover fin ---
  g.add(box(0.34, 0.42, 0.6, bodyPlain, 0, floor + 0.48, -0.78));
  g.add(box(0.2, 0.16, 0.05, chromeMat, 0, floor + 0.6, -0.5));           // scoop mouth
  g.add(box(0.06, 0.32, 0.95, darkMat, 0, floor + 0.4, -1.2));            // shark fin

  // --- open cockpit: exposed driver + halo hoop + central strut ---
  const drv = makeDriver(m.dark.getHex());
  drv.position.set(0, floor + 0.14, -0.12);
  g.add(drv);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 5, 12, Math.PI), chromeMat);
  halo.scale.set(0.36, 0.44, 1);
  halo.position.set(0, floor + 0.4, -0.1);
  g.add(halo);
  const strut = box(0.06, 0.42, 0.06, chromeMat, 0, floor + 0.62, 0.22);
  strut.rotation.x = 0.5;
  g.add(strut);

  // --- exposed wheels on visible wishbones (front wider & further forward) ---
  const wxF = 1.0, wzF = hl * 0.72, wxR = 0.94, wzR = -hl * 0.66;
  const inner = 0.32;
  for (const sx of [-1, 1])
    for (const [wx, wz] of [[wxF, wzF], [wxR, wzR]] as const) {
      g.add(suspensionArm(sx * inner, sx * wx, floor + 0.12, wz + 0.12, chromeMat));
      g.add(suspensionArm(sx * inner, sx * wx, floor + 0.3, wz - 0.12, chromeMat));
    }
  g.add(
    tyre(-wxF, wzF, R, tireMat, rimMat, 1.0),
    tyre(wxF, wzF, R, tireMat, rimMat, 1.0),
    tyre(-wxR, wzR, R, tireMat, rimMat, 1.05),
    tyre(wxR, wzR, R, tireMat, rimMat, 1.05),
  );
  return g;
}

// ---------------------------------------------------------------------------
// GOLIATH — monster truck
// ---------------------------------------------------------------------------

/** A boxy pickup cab-and-bed lifted sky-high on four enormous knobbly tyres,
 *  with visible shocks, a roll cage, a roof light bar and big round headlights.
 *  Towers over everything else on the grid. */
function buildMonsterTruck(color: number, num?: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color, num);
  const { bodyMat, darkMat, trimMat, glass, chromeMat, tireMat, rimMat, grilleMat, headMat, tailMat } = m;

  const L = 4.2, W = 1.8, R = 1.1;      // wheels far bigger than the ground clearance
  const hl = L / 2;                     // 2.1
  const lift = 1.15;                    // body floor lifted well up the huge tyres

  // --- ladder chassis rails + axle beams under the raised body ---
  for (const sx of [-1, 1])
    g.add(box(0.16, 0.2, L * 0.94, darkMat, sx * 0.5, lift - 0.16, 0));
  g.add(box(1.0, 0.14, 0.3, darkMat, 0, lift - 0.16, hl * 0.7));
  g.add(box(1.0, 0.14, 0.3, darkMat, 0, lift - 0.16, -hl * 0.66));

  // --- lofted pickup body: rounded low hood → tall open cab → short bed ---
  const hw = W / 2;
  const beltY = lift + 0.66, roofY = lift + 1.2;
  const hst = (
    floorY: number, wFloor: number, wMax: number, shoulderY: number, wDeck: number, deckY: number
  ): [number, number][] => [
    [0, floorY], [hw * wFloor, floorY], [hw * wMax, (floorY + shoulderY) / 2],
    [hw * wMax, shoulderY], [hw * wDeck, deckY], [0, deckY],
  ];
  const truck: Rib[] = [
    { z: hl,        half: hst(lift,       0.66, 0.84, lift + 0.26, 0.64, lift + 0.46) }, // hood front
    { z: hl * 0.55, half: hst(lift,       0.72, 0.9,  lift + 0.32, 0.7,  lift + 0.5) },  // hood
    { z: hl * 0.24, half: hst(lift,       0.74, 0.9,  lift + 0.5,  0.72, beltY) },       // cowl → cab sill
    { z: -hl * 0.05,half: hst(lift,       0.76, 0.92, lift + 0.55, 0.74, beltY) },       // cab
    { z: -hl * 0.34,half: hst(lift,       0.76, 0.92, lift + 0.52, 0.72, beltY) },       // cab back
    { z: -hl * 0.52,half: hst(lift + 0.02,0.7,  0.94, lift + 0.42, 0.66, lift + 0.6) },  // bed front
    { z: -hl,       half: hst(lift + 0.04,0.58, 0.82, lift + 0.36, 0.54, lift + 0.52) }, // tailgate
  ];
  g.add(loftBody(truck, bodyMat, 4));
  for (const sx of [-1, 1]) // bed side walls
    g.add(box(0.08, 0.24, L * 0.42, darkMat, sx * W * 0.48, lift + 0.72, -hl * 0.6));

  // --- open cab glass (near-upright windshield + side windows) ---
  g.add(panelBetween(0, hl * 0.24, beltY, hl * 0.24, roofY, W * 0.82, 0.04, glass));
  for (const sx of [-1, 1])
    g.add(box(0.03, 0.44, L * 0.3, glass, sx * W * 0.42, beltY + 0.26, -hl * 0.02));

  // --- roll cage over the cab: two hoops + side rails ---
  const cageGeo = new THREE.TorusGeometry(1, 0.05, 5, 10, Math.PI);
  for (const hz of [hl * 0.2, -hl * 0.14]) {
    const hoop = new THREE.Mesh(cageGeo, chromeMat);
    hoop.scale.set(W * 0.46, 0.62, 1);
    hoop.position.set(0, roofY - 0.02, hz);
    g.add(hoop);
  }
  for (const sx of [-1, 1])
    g.add(box(0.05, 0.05, hl * 0.34, chromeMat, sx * W * 0.4, roofY - 0.02, hl * 0.03));

  // --- upright grille, big round headlights, roof light bar, rear lights ---
  g.add(box(W * 0.5, 0.34, 0.06, grilleMat, 0, lift + 0.28, hl * 1.0));
  const lampGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.1, 12);
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(lampGeo, headMat);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(sx * W * 0.3, lift + 0.42, hl * 0.99);
    g.add(lamp);
  }
  g.add(box(W * 0.6, 0.09, 0.05, tailMat, 0, lift + 0.9, -hl * 0.98));    // taillight bar
  g.add(box(W * 0.72, 0.12, 0.16, darkMat, 0, roofY + 0.08, hl * 0.12));  // light-bar housing
  for (const sx of [-1, 0, 1]) {
    const rl = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10), headMat);
    rl.rotation.x = Math.PI / 2;
    rl.position.set(sx * W * 0.22, roofY + 0.1, hl * 0.19);
    g.add(rl);
  }

  // --- driver in the cab ---
  const drv = makeDriver(m.dark.getHex(), false);
  drv.position.set(0, beltY - 0.16, hl * 0.02);
  g.add(drv);

  // --- huge tyres on visible shocks (splayed shock body + a track link per hub) ---
  const wx = 1.25, wzF = hl * 0.7, wzR = -hl * 0.66;
  for (const sx of [-1, 1])
    for (const wz of [wzF, wzR]) {
      const shock = box(0.12, 0.9, 0.16, trimMat, sx * (0.5 + (wx - 0.5) / 2), lift - 0.4, wz);
      shock.rotation.z = sx * 0.5;
      g.add(shock);
      g.add(suspensionArm(sx * 0.4, sx * wx, R, wz, chromeMat));
    }
  g.add(
    monsterWheel(-wx, wzF, R, tireMat, rimMat),
    monsterWheel(wx, wzF, R, tireMat, rimMat),
    monsterWheel(-wx, wzR, R, tireMat, rimMat),
    monsterWheel(wx, wzR, R, tireMat, rimMat),
  );
  return g;
}

// ---------------------------------------------------------------------------
// WRAITH — anti-grav hover speeder
// ---------------------------------------------------------------------------

/** A sleek wheel-less pod that floats: a smooth teardrop hull, a glass bubble
 *  canopy, swept tail fins and four glowing anti-grav nacelles underneath (the
 *  engine's under-glow reads as its hover cushion). */
function buildHover(color: number, num?: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color, num);
  const { dark, bodyMat, bodyPlain, darkMat, trimMat, glass } = m;

  const L = 4.6, W = 1.9;
  const hl = L / 2, hw = W / 2;
  const floor = 0.34;                 // hovers this high; no wheels
  const topY = floor + 0.6;

  const hs = (fy: number, wf: number, wm: number, sy: number, wd: number, dy: number): [number, number][] =>
    [[0, fy], [hw * wf, fy], [hw * wm, (fy + sy) / 2], [hw * wm, sy], [hw * wd, dy], [0, dy]];
  const ribs: Rib[] = [
    { z: hl,       half: hs(floor + 0.16, 0.05, 0.13, floor + 0.26, 0.05, floor + 0.32) }, // nose point
    { z: hl * 0.6, half: hs(floor + 0.02, 0.4, 0.72, floor + 0.34, 0.5, floor + 0.5) },    // front
    { z: hl * 0.08,half: hs(floor,        0.56, 1.0, floor + 0.42, 0.6, floor + 0.58) },   // cockpit (widest)
    { z: -hl * 0.42,half: hs(floor,       0.5, 0.94, floor + 0.42, 0.52, floor + 0.56) },  // aft
    { z: -hl * 0.8,half: hs(floor + 0.06, 0.34, 0.62, floor + 0.34, 0.32, floor + 0.5) },  // tail
    { z: -hl,      half: hs(floor + 0.12, 0.14, 0.32, floor + 0.26, 0.12, floor + 0.4) },  // tail cap
  ];
  g.add(loftBody(ribs, bodyMat, 6));

  // glass bubble canopy
  const cw = hw * 0.5;
  const canopyHalf = (w: number, yb: number, yt: number): [number, number][] =>
    [[0, yb], [w, yb], [w * 0.9, (yb + yt) / 2], [w * 0.5, yt], [0, yt]];
  g.add(loftBody([
    { z: hl * 0.3,  half: canopyHalf(cw * 0.7, topY, topY + 0.03) },
    { z: hl * 0.04, half: canopyHalf(cw, topY - 0.02, topY + 0.3) },
    { z: -hl * 0.24,half: canopyHalf(cw, topY - 0.02, topY + 0.28) },
    { z: -hl * 0.4, half: canopyHalf(cw * 0.7, topY, topY + 0.05) },
  ], glass, 5));

  const drv = makeDriver(dark.getHex());
  drv.position.set(0, topY - 0.36, hl * 0.06);
  g.add(drv);

  // swept tail fins + central fin
  for (const sx of [-1, 1]) {
    const fin = box(0.05, 0.36, 0.6, bodyPlain, sx * hw * 0.52, topY + 0.06, -hl * 0.72);
    fin.rotation.x = 0.2;
    g.add(fin);
  }
  g.add(box(0.06, 0.42, 0.55, darkMat, 0, topY + 0.12, -hl * 0.8));

  // glowing anti-grav nacelles underneath (dark pod + emissive pad)
  const nacelle = (x: number, z: number) => {
    g.add(box(0.34, 0.16, 0.55, darkMat, x, floor - 0.04, z));
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.06, 14), trimMat);
    pad.position.set(x, floor - 0.14, z);
    g.add(pad);
  };
  for (const sx of [-1, 1]) { nacelle(sx * hw * 0.62, hl * 0.48); nacelle(sx * hw * 0.62, -hl * 0.5); }

  // rear thruster glow
  const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.22, 16), trimMat);
  eng.rotation.x = Math.PI / 2;
  eng.position.set(0, floor + 0.32, -hl * 0.98);
  g.add(eng);
  return g;
}

// ---------------------------------------------------------------------------
// NITRO — top-fuel dragster
// ---------------------------------------------------------------------------

/** A long, skeletal rail: a needle nose out to tiny front wheels, an exposed
 *  blown engine with a supercharger and velocity stacks amidships, the driver
 *  set way back under a roll hoop, a tall wing, a parachute pack and enormous
 *  fat rear slicks. */
function buildDragster(color: number, num?: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color, num);
  const { dark, bodyMat, darkMat, trimMat, chromeMat, tireMat, rimMat, grilleMat, tailMat } = m;

  const L = 6.2, hl = L / 2;
  const Rf = 0.24, Rr = 0.62;         // tiny front / huge rear
  const bw = 0.36;                    // narrow chassis half-width

  const hs = (fy: number, wf: number, wm: number, sy: number, wd: number, dy: number): [number, number][] =>
    [[0, fy], [bw * wf, fy], [bw * wm, (fy + sy) / 2], [bw * wm, sy], [bw * wd, dy], [0, dy]];
  const ribs: Rib[] = [
    { z: hl,       half: hs(0.16, 0.2, 0.4, 0.22, 0.2, 0.26) },  // needle nose
    { z: hl * 0.5, half: hs(0.1, 0.55, 0.95, 0.26, 0.6, 0.32) }, // slim front rail
    { z: hl * 0.06,half: hs(0.1, 0.75, 1.05, 0.52, 0.75, 0.62) },// engine bay
    { z: -hl * 0.42,half: hs(0.1, 0.85, 1.15, 0.62, 0.85, 0.72) },// driver tub (widest)
    { z: -hl * 0.8,half: hs(0.12, 0.7, 1.0, 0.56, 0.7, 0.66) },  // rear
    { z: -hl,      half: hs(0.14, 0.5, 0.7, 0.46, 0.5, 0.56) },  // tail
  ];
  g.add(loftBody(ribs, bodyMat, 5));

  // exposed blown engine amidships: block + supercharger + velocity stacks
  const ez = hl * 0.16;
  g.add(box(0.52, 0.4, 0.66, darkMat, 0, 0.52, ez));       // block
  g.add(box(0.44, 0.3, 0.48, chromeMat, 0, 0.82, ez));     // supercharger
  for (const sx of [-1, 1])
    for (const sz of [-0.16, 0, 0.16]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.14, 8), chromeMat);
      stack.position.set(sx * 0.13, 1.0, ez + sz);
      g.add(stack);
    }
  // zoomie exhaust headers fanning off each side
  for (const sx of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), chromeMat);
      p.rotation.z = sx * 0.7;
      p.position.set(sx * 0.34, 0.5, ez - 0.12 - i * 0.16);
      g.add(p);
    }

  // driver set way back, small roll hoop
  const drv = makeDriver(dark.getHex());
  drv.position.set(0, 0.52, -hl * 0.44);
  g.add(drv);
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(1, 0.04, 5, 10, Math.PI), chromeMat);
  hoop.scale.set(0.32, 0.4, 1);
  hoop.position.set(0, 0.6, -hl * 0.52);
  g.add(hoop);

  // tall rear wing on struts + parachute pack
  const wy = 1.15;
  g.add(box(1.6, 0.06, 0.5, darkMat, 0, wy, -hl * 0.92));
  g.add(box(1.6, 0.03, 0.14, trimMat, 0, wy + 0.05, -hl * 0.96));
  for (const sx of [-1, 1]) {
    const strut = box(0.06, wy - 0.62, 0.14, chromeMat, sx * 0.52, (0.62 + wy) / 2, -hl * 0.9);
    g.add(strut);
  }
  g.add(box(0.32, 0.3, 0.22, trimMat, 0, 0.72, -hl * 0.995)); // chute pack

  // front axle far out front on a thin beam, tiny wheels
  const fwz = hl * 0.9;
  g.add(box(0.05, 0.05, hl * 1.0, chromeMat, 0, 0.2, hl * 0.4)); // chassis rail forward
  g.add(box(0.95, 0.05, 0.06, chromeMat, 0, Rf, fwz));           // front axle
  g.add(makeWheel(-0.48, fwz, Rf, Rf * 0.5, tireMat, rimMat, -1));
  g.add(makeWheel(0.48, fwz, Rf, Rf * 0.5, tireMat, rimMat, 1));

  // huge rear slicks
  const rwx = 0.86, rwz = -hl * 0.68;
  g.add(makeWheel(-rwx, rwz, Rr, Rr * 1.15, tireMat, rimMat, -1));
  g.add(makeWheel(rwx, rwz, Rr, Rr * 1.15, tireMat, rimMat, 1));
  // rear tail panel
  g.add(box(1.0, 0.28, 0.05, tailMat, 0, 0.6, -hl * 0.99));
  void grilleMat;
  return g;
}

// ---------------------------------------------------------------------------
// DUNE — off-road buggy
// ---------------------------------------------------------------------------

/** A short, chunky offroader: a low body tub, an exposed driver inside a
 *  tubular chrome roll cage, a roof light bar, a rear engine, and four big
 *  knobbly tyres on a wide track. */
function buildBuggy(color: number, num?: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color, num);
  const { dark, bodyMat, darkMat, trimMat, chromeMat, tireMat, rimMat, grilleMat, headMat, tailMat } = m;

  const L = 3.9, W = 2.0, R = 0.5;
  const hl = L / 2, hw = W / 2;
  const floor = 0.32;
  const cageTop = floor + 1.0;

  const hs = (fy: number, wf: number, wm: number, sy: number, wd: number, dy: number): [number, number][] =>
    [[0, fy], [hw * wf, fy], [hw * wm, (fy + sy) / 2], [hw * wm, sy], [hw * wd, dy], [0, dy]];
  const ribs: Rib[] = [
    { z: hl,       half: hs(floor, 0.5, 0.72, floor + 0.22, 0.5, floor + 0.3) },   // nose
    { z: hl * 0.4, half: hs(floor, 0.62, 0.84, floor + 0.3, 0.6, floor + 0.34) },  // mid-front
    { z: -hl * 0.1,half: hs(floor, 0.64, 0.86, floor + 0.32, 0.62, floor + 0.36) },// cockpit floor
    { z: -hl * 0.55,half: hs(floor, 0.6, 0.88, floor + 0.42, 0.6, floor + 0.54) }, // engine bay rises
    { z: -hl,      half: hs(floor + 0.02, 0.5, 0.74, floor + 0.4, 0.5, floor + 0.5) }, // tail
  ];
  g.add(loftBody(ribs, bodyMat, 4));

  // exposed driver in the cockpit
  const drv = makeDriver(dark.getHex());
  drv.position.set(0, floor, -hl * 0.04);
  g.add(drv);

  // tubular chrome roll cage (cylinders between points)
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.05) => {
    const len = a.distanceTo(b);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), chromeMat);
    t.position.copy(a).lerp(b, 0.5);
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(t);
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (const sx of [-1, 1]) {
    tube(V(sx * hw * 0.5, floor + 0.3, hl * 0.24), V(sx * hw * 0.46, cageTop, -hl * 0.02));  // windshield frame
    tube(V(sx * hw * 0.5, floor + 0.3, -hl * 0.5), V(sx * hw * 0.46, cageTop, -hl * 0.22));  // rear hoop
    tube(V(sx * hw * 0.46, cageTop, -hl * 0.02), V(sx * hw * 0.46, cageTop, -hl * 0.22));    // roof side rail
  }
  tube(V(-hw * 0.46, cageTop, -hl * 0.02), V(hw * 0.46, cageTop, -hl * 0.02)); // front roof cross
  tube(V(-hw * 0.46, cageTop, -hl * 0.22), V(hw * 0.46, cageTop, -hl * 0.22)); // rear roof cross

  // roof light bar
  g.add(box(W * 0.5, 0.1, 0.12, darkMat, 0, cageTop + 0.06, -hl * 0.02));
  for (const sx of [-1, 0, 1]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10), headMat);
    l.rotation.x = Math.PI / 2;
    l.position.set(sx * W * 0.16, cageTop + 0.08, -hl * 0.02 + 0.07);
    g.add(l);
  }

  // front skid plate + grille + round headlights
  g.add(box(W * 0.72, 0.1, 0.06, darkMat, 0, floor + 0.04, hl * 0.98));
  g.add(box(W * 0.4, 0.18, 0.05, grilleMat, 0, floor + 0.2, hl * 0.99));
  for (const sx of [-1, 1]) {
    const hlamp = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), headMat);
    hlamp.rotation.x = Math.PI / 2;
    hlamp.position.set(sx * W * 0.28, floor + 0.28, hl * 0.98);
    g.add(hlamp);
  }

  // rear engine block + taillight
  g.add(box(W * 0.5, 0.3, 0.4, darkMat, 0, floor + 0.42, -hl * 0.82));
  g.add(box(W * 0.5, 0.08, 0.05, tailMat, 0, floor + 0.42, -hl * 0.99));

  // four big knobbly tyres on a wide track
  const wx = hw * 0.86, wzF = hl * 0.64, wzR = -hl * 0.62;
  g.add(
    monsterWheel(-wx, wzF, R, tireMat, rimMat), monsterWheel(wx, wzF, R, tireMat, rimMat),
    monsterWheel(-wx, wzR, R, tireMat, rimMat), monsterWheel(wx, wzR, R, tireMat, rimMat),
  );
  void trimMat;
  return g;
}

// ---------------------------------------------------------------------------
// BLAZE — jet-powered rocket car
// ---------------------------------------------------------------------------

/** A land-speed rocket: a rounded needle-nosed fuselage, a glass canopy, swept
 *  stub delta wings with winglets, a tail fin, and a big rear turbine with a
 *  glowing afterburner — riding on three small wheels. */
function buildJet(color: number, num?: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color, num);
  const { dark, bodyMat, bodyPlain, darkMat, trimMat, glass, tireMat, rimMat } = m;

  const L = 5.2, hl = L / 2;
  const R = 0.28, bw = 0.42, axis = 0.5; // fuselage centre height

  // rounded fuselage cross-section: bottom-centre → sides → top-centre
  const hs = (wm: number, h: number): [number, number][] =>
    [[0, axis - h], [wm * 0.7, axis - h * 0.7], [wm, axis], [wm * 0.7, axis + h * 0.7], [0, axis + h]];
  const ribs: Rib[] = [
    { z: hl,        half: hs(bw * 0.14, 0.12) }, // needle nose
    { z: hl * 0.55, half: hs(bw * 0.7, 0.3) },   // nose
    { z: hl * 0.08, half: hs(bw, 0.42) },        // cockpit fuselage (widest)
    { z: -hl * 0.42,half: hs(bw * 0.95, 0.4) },  // mid
    { z: -hl * 0.8, half: hs(bw * 0.82, 0.36) }, // toward engine
    { z: -hl,       half: hs(bw * 0.6, 0.28) },  // engine rim
  ];
  g.add(loftBody(ribs, bodyMat, 6));

  // glass canopy bubble
  const cw = bw * 0.66;
  const canopyHalf = (w: number, yb: number, yt: number): [number, number][] =>
    [[0, yb], [w, yb], [w * 0.9, (yb + yt) / 2], [w * 0.5, yt], [0, yt]];
  g.add(loftBody([
    { z: hl * 0.28, half: canopyHalf(cw * 0.7, axis + 0.36, axis + 0.4) },
    { z: hl * 0.04, half: canopyHalf(cw, axis + 0.34, axis + 0.6) },
    { z: -hl * 0.14,half: canopyHalf(cw, axis + 0.34, axis + 0.58) },
    { z: -hl * 0.3, half: canopyHalf(cw * 0.7, axis + 0.36, axis + 0.42) },
  ], glass, 5));
  const drv = makeDriver(dark.getHex());
  drv.position.set(0, axis - 0.02, hl * 0.06);
  g.add(drv);

  // swept stub delta wings + winglets
  for (const sx of [-1, 1]) {
    const wing = box(1.15, 0.06, 0.95, bodyPlain, sx * (bw + 0.55), axis - 0.12, -hl * 0.34);
    wing.rotation.y = sx * 0.22;
    g.add(wing);
    g.add(box(0.05, 0.24, 0.34, darkMat, sx * (bw + 1.05), axis, -hl * 0.42)); // winglet
  }
  // tail fin
  g.add(box(0.06, 0.5, 0.7, darkMat, 0, axis + 0.42, -hl * 0.82));

  // front intake under the nose
  g.add(box(bw * 1.2, 0.2, 0.34, darkMat, 0, axis - 0.3, hl * 0.5));

  // rear turbine: dark cowl ring + glowing afterburner
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.4, 0.42, 18), darkMat);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.set(0, axis, -hl * 0.95);
  g.add(cowl);
  const burn = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.36, 16), trimMat);
  burn.rotation.x = Math.PI / 2;
  burn.position.set(0, axis, -hl - 0.02);
  g.add(burn);

  // three small landing wheels (one front, two rear)
  g.add(makeWheel(0, hl * 0.5, R, R * 0.5, tireMat, rimMat, 1));
  for (const sx of [-1, 1]) g.add(makeWheel(sx * bw * 1.05, -hl * 0.58, R, R * 0.6, tireMat, rimMat, sx));
  return g;
}

// ---------------------------------------------------------------------------
// the roster (mesh builder)
// ---------------------------------------------------------------------------

/** Distinct racing number per car type, painted into the door roundel. */
const RACE_NUM: Record<CarId, number> = {
  comet: 3, bolt: 7, titan: 4, wisp: 9, apex: 1,
  goliath: 8, wraith: 5, nitro: 6, dune: 2, blaze: 0,
};

/** Build the drivable mesh for a car type in a given livery color. */
/**
 * A mid-engine SUPERCAR, authored for the one view that actually matters here:
 * dead astern, low camera, filling the centre of the screen.
 *
 * Everything about the section profile is chosen for that read. The reference
 * art (Veyron, McLaren F1, IROC-Z) shares a specific rear silhouette: a FLAT
 * deck, a hard horizontal shoulder line, haunches that are the widest thing on
 * the car, and a tail cut off vertically. The existing GT profile rounds its
 * shoulder into the deck, which is what made it read as a bathtub from behind —
 * so this rib set holds the body at full width right up to the shoulder, then
 * turns in sharply, giving a crisp edge instead of a curve.
 */
function buildSuper(color: number, num?: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color, num);
  const { bodyMat, bodyPlain, darkMat, glass, tireMat, rimMat, chromeMat, grilleMat, lensMat, tailMat } = m;

  const L = 4.75, W = 2.08, R = 0.34;
  const hl = L / 2, hw = W / 2;
  const clr = 0.13;                 // supercar ride height: almost on the deck
  const sillY = 0.42;               // low flank
  const shoulderY = 0.80;           // the hard horizontal crease
  const deckY = 0.92;               // flat rear deck
  const roofY = 1.19;               // low roofline

  // half-section, x >= 0, bottom-centre -> out -> shoulder -> deck centre.
  // `wMax` is held all the way to the shoulder so the flank is a FLAT wall that
  // ends in an edge, rather than tumbling home into a dome.
  const hs = (
    floorY: number, wFloor: number, wMax: number, shY: number, wDeck: number, dY: number
  ): [number, number][] => [
    [0, floorY],
    [hw * wFloor, floorY],
    [hw * wMax, sillY],
    [hw * wMax, shY],          // full width held right up to the crease
    [hw * wDeck, dY],          // then a sharp turn in across the deck
    [0, dY],
  ];

  const ribs: Rib[] = [
    { z: hl,          half: hs(clr + 0.06, 0.16, 0.40, 0.52, 0.30, 0.60) }, // nose blade
    { z: hl * 0.88,   half: hs(clr,        0.52, 0.74, 0.62, 0.56, 0.72) }, // splitter / intake mouth
    { z: hl * 0.60,   half: hs(clr,        0.66, 0.94, shoulderY * 0.92, 0.74, 0.86) }, // front arch
    { z: hl * 0.26,   half: hs(clr,        0.70, 0.90, shoulderY * 0.94, 0.66, 0.88) }, // low scuttle
    { z: -hl * 0.04,  half: hs(clr,        0.72, 0.93, shoulderY,        0.68, deckY) }, // cabin base
    { z: -hl * 0.40,  half: hs(clr,        0.74, 1.00, shoulderY,        0.76, deckY) }, // haunch — widest
    { z: -hl * 0.74,  half: hs(clr + 0.02, 0.70, 0.98, shoulderY,        0.82, deckY) }, // engine deck
    { z: -hl,         half: hs(clr + 0.04, 0.62, 0.94, shoulderY * 0.98, 0.88, deckY * 0.99) }, // kamm cut
  ];
  g.add(loftBody(ribs, bodyMat, 6));

  // the shoulder crease itself, run as a hard dark line the length of the flank
  for (const sx of [-1, 1])
    g.add(box(0.035, 0.035, L * 0.82, darkMat, sx * hw * 0.985, shoulderY, -L * 0.02));
  // deep side sill / rocker, which is what makes it sit low
  for (const sx of [-1, 1])
    g.add(box(0.09, 0.16, L * 0.5, darkMat, sx * hw * 0.97, sillY * 0.55, -L * 0.02));

  // --- front -----------------------------------------------------------------
  g.add(box(W * 0.78, 0.05, L * 0.06, darkMat, 0, clr - 0.02, hl * 0.9));
  g.add(box(W * 0.34, 0.16, 0.06, grilleMat, 0, 0.42, hl * 0.95));
  for (const sx of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.BoxGeometry(W * 0.2, 0.07, 0.05), lensMat);
    lens.position.set(sx * hw * 0.62, 0.70, hl * 0.86);
    g.add(lens);
  }

  // --- TAIL: the money shot --------------------------------------------------
  // A single full-width light bar is the signature of this art. Bright, clean,
  // and unbroken across the whole tail rather than a scatter of small lamps.
  g.add(box(W * 0.86, 0.085, 0.05, tailMat, 0, deckY * 0.82, -hl * 0.985));
  // a thin dark blade above it so the bar reads as inset into the panel
  g.add(box(W * 0.88, 0.03, 0.05, darkMat, 0, deckY * 0.9, -hl * 0.99));
  // diffuser + quad pipes
  g.add(box(W * 0.66, 0.2, L * 0.05, grilleMat, 0, clr + 0.1, -hl * 0.95));
  for (const sx of [-1.5, -0.5, 0.5, 1.5])
    g.add(box(0.075, 0.075, 0.1, chromeMat, sx * W * 0.1, clr + 0.22, -hl * 0.99));
  // low ducktail lip, not a wing — the references never have a big rear wing
  g.add(box(W * 0.9, 0.05, L * 0.07, bodyPlain, 0, deckY + 0.05, -hl * 0.86));

  // --- glass: a low, dark, cab-forward canopy --------------------------------
  const cw = hw * 0.68;
  const canopyHalf = (w: number, yB: number, yT: number): [number, number][] => [
    [0, yB], [w, yB], [w * 0.95, (yB + yT) / 2], [w * 0.5, yT], [0, yT],
  ];
  const canopy: Rib[] = [
    { z: hl * 0.30,  half: canopyHalf(cw * 0.80, deckY * 0.94, deckY * 0.99) },
    { z: hl * 0.06,  half: canopyHalf(cw * 0.95, deckY,        roofY * 0.96) },
    { z: -hl * 0.26, half: canopyHalf(cw,        deckY,        roofY) },
    { z: -hl * 0.52, half: canopyHalf(cw * 0.9,  deckY,        roofY * 0.93) },
    { z: -hl * 0.68, half: canopyHalf(cw * 0.72, deckY,        deckY * 1.02) },
  ];
  g.add(loftBody(canopy, glass, 5));
  const drv = makeDriver(0x14121c, false);
  drv.position.set(0, deckY - 0.16, hl * 0.02);
  drv.scale.setScalar(0.86);
  g.add(drv);

  // --- wheels: tucked well under the arches so only the lower half shows -----
  const wx = hw * 0.80, wzF = hl * 0.62, wzR = hl * 0.60;
  for (const [x, z, r] of [
    [-wx, wzF, R], [wx, wzF, R], [-wx, -wzR, R * 1.08], [wx, -wzR, R * 1.08],
  ] as const) {
    g.add(makeWheel(x, z, r, 0.30, tireMat, rimMat, Math.sign(x)));
  }
  return g;
}

export function makeKart(id: CarId, color: number): THREE.Group {
  const num = RACE_NUM[id];
  switch (id) {
    case "bolt":
      // long, low, sleek top-speed racer — laid-back cabin, tall swan-neck wing
      return buildKart(color, {
        length: 4.6, width: 1.92, ride: 0.82, wheelR: 0.34,
        wing: "swan", cabin: 0.3, mirrors: true, num,
      });
    case "titan":
      // wide muscle / stock car — chunky, hood scoop, roll cage, twin exhausts
      return buildKart(color, {
        length: 4.3, width: 2.16, ride: 1.05, wheelR: 0.42,
        wing: "low", cabin: 0.4, cage: true, scoop: true, bulky: true, num,
      });
    case "wisp":
      // tiny nimble kart — open cockpit, tall exposed driver, compact wing
      return buildKart(color, {
        length: 3.7, width: 1.78, ride: 0.78, wheelR: 0.36,
        wing: "kart", cabin: 0.34, open: true, num,
      });
    case "apex":
      // open-wheel F1 — pointed nose, exposed slicks, front/rear wings, halo
      return buildFormula(color, num);
    case "goliath":
      // monster truck — boxy cab lifted sky-high on enormous knobbly tyres
      return buildMonsterTruck(color, num);
    case "wraith":
      // anti-grav hover speeder — wheel-less pod, glowing nacelles, bubble canopy
      return buildHover(color, num);
    case "nitro":
      // top-fuel dragster — long rail, blown engine, huge rear slicks, tall wing
      return buildDragster(color, num);
    case "dune":
      // off-road buggy — tube roll cage, exposed driver, big knobbly tyres
      return buildBuggy(color, num);
    case "blaze":
      // jet rocket car — needle fuselage, delta wings, turbine afterburner
      return buildJet(color, num);
    case "comet":
    default:
      // purpose-built supercar silhouette (see buildSuper) rather than kart
      // proportions dressed up — the rear view is what fills the screen
      return buildSuper(color, num);
  }
}
