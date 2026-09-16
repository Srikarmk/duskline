import * as THREE from "three";
import { mergeStaticParts } from "./merge";
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
    // FLAT SHADING. Smooth vertex normals across a lofted body average every
    // crease away, so the car arrives on screen as a rounded lump of colour —
    // the "smoothened 3D effect". Flat shading gives each quad of the loft its
    // own facet normal, so the shoulder line, the haunch and the tail cut all
    // come back as hard edges with a visible tone step across them.
    mat.flatShading = true;
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

/** Vented brake disc, and the caliper clamped over it. Shared across the whole
 *  grid: four wheels on ten cars is eighty of each, and the colour never
 *  varies. */
let _discMat: THREE.MeshStandardMaterial | null = null;
function discMat(): THREE.MeshStandardMaterial {
  return (_discMat ??= new THREE.MeshStandardMaterial({ color: 0x2a2c31, metalness: 0.85, roughness: 0.42 }));
}
let _calMat: THREE.MeshStandardMaterial | null = null;
function caliperMat(): THREE.MeshStandardMaterial {
  return (_calMat ??= new THREE.MeshStandardMaterial({ color: 0xb2231d, metalness: 0.4, roughness: 0.5 }));
}
let _chromeShared: THREE.MeshStandardMaterial | null = null;
function chromeShared(): THREE.MeshStandardMaterial {
  return (_chromeShared ??= new THREE.MeshStandardMaterial({ color: 0xc8cdd6, metalness: 0.95, roughness: 0.22 }));
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
    // 2.1 blew the lamps out to peach-white; 1.4 keeps them unmistakably RED
    // while still separating from red bodywork
    tailMat: paint(0x4a0303, { emissive: 0xff2a20, ei: 1.4 }),
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
  // lug nuts around the hub — tiny, but they are the thing that reads as a
  // wheel rather than a disc with lines on it
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6), chromeShared());
    nut.rotation.z = Math.PI / 2;
    nut.position.set(0.028, Math.cos(a) * radius * 0.15, Math.sin(a) * radius * 0.15);
    face.add(nut);
  }
  face.position.x = outSign * (treadW / 2 + 0.01);
  g.add(face);

  // BRAKES, seen through the spokes. A wheel with nothing behind it reads as a
  // sticker; a disc and a caliper give the arch depth, and on a car this size
  // they are the most visible mechanical detail there is.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.035, 16), discMat());
  disc.rotation.z = Math.PI / 2;
  disc.position.x = outSign * treadW * 0.18;
  g.add(disc);
  const cal = new THREE.Mesh(new THREE.BoxGeometry(0.07, radius * 0.46, radius * 0.2), caliperMat());
  cal.position.set(outSign * treadW * 0.18, radius * 0.42, -radius * 0.24);
  g.add(cal);
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
  // ALLOY, not livery. Painting the wheel face in the car's accent colour is a
  // kart convention: on a red car it renders four bright red discs where the
  // wheels should be. Road cars wear machined alloy; the livery reaches them
  // through the environment reflection, which is enough.
  // metalness 0.95 makes the wheel face a MIRROR, and a mirror inside a red
  // sunset is a red wheel — which is what it still looked like after dropping
  // the livery tint. A machined alloy is only semi-specular; at 0.7/0.34 the
  // base grey wins and the sky just glints off it.
  const rimMat = paint(0x9ba2ad, { metal: 0.7, rough: 0.34 });
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

// ---------------------------------------------------------------------------
// APEX — open-wheel formula car
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GOLIATH — monster truck
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WRAITH — anti-grav hover speeder
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// NITRO — top-fuel dragster
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DUNE — off-road buggy
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// BLAZE — jet-powered rocket car
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// the roster (mesh builder)
// ---------------------------------------------------------------------------

/** Distinct racing number per car type, painted into the door roundel. */
const RACE_NUM: Record<CarId, number> = {
  f40: 40, meridian: 1, veloce: 16, tauro: 25, testa: 12,
  zanza: 30, imprez: 22, firehawk: 77, iroc: 8, fairlady: 240,
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

// ---------------------------------------------------------------------------
// THE ROAD-CAR CATALOGUE
// ---------------------------------------------------------------------------
//
// Every car on the grid is now built by one parameterised builder instead of
// ten hand-written ones. The reason is that all ten are the same *kind* of
// object — a lofted monocoque with wheels, glass, lamps and a tail — and what
// actually distinguishes an F40 from a 240Z is proportion plus five or six
// appendages. Sharing the body means a fix to the shoulder line or the tail
// bar lands on the whole grid at once, which is why the old per-car builders
// drifted apart in quality.
//
// A car is authored as: overall box (L/W/R), four height landmarks, a rib
// table for the section profile, a cabin footprint, and a set of flags for the
// bits you actually recognise a car by (a straked wing, side strakes, pop-up
// lamps, a shaker scoop, four round lamps, chrome bumpers).

type WingKind = "none" | "straked" | "basket" | "whale" | "duck" | "blade";
type LampKind = "popup" | "round4" | "round2" | "slim" | "wide";
type TailKind = "bar" | "quad" | "twin" | "slats";
type ScoopKind = "none" | "shaker" | "rally" | "bulge" | "roof";
/** Every car shared one canopy profile, so from behind the grid was ten
 *  identical greenhouses on ten different colours. This is the single biggest
 *  silhouette cue after the wing. */
type RoofKind = "canopy" | "fastback" | "notch" | "targa";

/** zFrac, floorLift, wFloor, wMax, shoulderFrac, wDeck, deckFrac — all the
 *  width terms are fractions of the half-width, the height terms fractions of
 *  the named landmark, so one table works at any size. */
type RibRow = [number, number, number, number, number, number, number];

interface RoadCarParams {
  L: number; W: number; R: number;
  rearR?: number;              // rear tyre radius multiplier (staggered fitment)
  clr?: number;                // ride height
  sillY: number; shoulderY: number; deckY: number; roofY: number;
  ribs: RibRow[];
  cabF: number; cabR: number; cabW: number;   // cabin footprint, z-fracs + width frac
  roof?: RoofKind;
  whF: number; whR: number;                   // wheel centres, z-fracs
  wing?: WingKind;
  lamps?: LampKind;
  tail?: TailKind;
  louvres?: number;            // engine-lid slats
  strakes?: number;            // flank fins
  naca?: boolean;              // flank intake scallops
  scoop?: ScoopKind;
  twoTone?: boolean;           // dark lower body
  chrome?: boolean;            // chrome bumpers (classics)
  fogLamps?: boolean;
  pipes?: number;
  /** wheel finish, when the car is known for one (rally gold, dark alloy) */
  rim?: number;              // exhaust tip count
}

// --- section profiles, one per car ------------------------------------------
// These used to be five tables shared ten ways, so F40 / TAURO / TESTA were
// literally the same body under different appendages, as were MERIDIAN /
// VELOCE / ZANZA and FIREHAWK / IROC. No amount of wing and lamp work
// separates cars that are the same shape; the section IS the silhouette.
//
// Row = [zFrac, floorLift, wFloor, wMax, shoulderFrac, wDeck, deckFrac].
// z runs 1 at the nose to -1 at the tail; widths are fractions of the
// half-width, heights fractions of the named landmark.

/** Blunt splitter nose, flat low bonnet, waist pinched at the door, enormous
 *  rear haunches, kamm tail tucked under. */
const RIBS_F40: RibRow[] = [
  [ 1.00, 0.05, 0.34, 0.56, 0.42, 0.46, 0.46],
  [ 0.86, 0.00, 0.54, 0.80, 0.50, 0.62, 0.54],
  [ 0.60, 0.00, 0.66, 0.97, 0.60, 0.86, 0.60],
  [ 0.30, 0.00, 0.70, 0.90, 0.72, 0.72, 0.74],
  [-0.04, 0.00, 0.72, 0.93, 1.00, 0.70, 1.00],
  [-0.42, 0.00, 0.76, 1.00, 1.00, 0.84, 1.00],
  [-0.76, 0.02, 0.72, 0.99, 1.00, 0.90, 1.00],
  [-1.00, 0.17, 0.50, 0.95, 0.98, 0.92, 0.99],
];
/** The extreme wedge: nose almost on the floor and a dead-straight climb to
 *  the roof, cab well forward, slab sides, very wide flat tail. */
const RIBS_TAURO: RibRow[] = [
  [ 1.00, 0.02, 0.40, 0.62, 0.34, 0.56, 0.34],
  [ 0.86, 0.00, 0.58, 0.84, 0.42, 0.74, 0.42],
  [ 0.62, 0.00, 0.70, 0.96, 0.52, 0.92, 0.52],
  [ 0.34, 0.00, 0.74, 0.96, 0.66, 0.88, 0.66],
  [ 0.02, 0.00, 0.76, 0.97, 0.88, 0.80, 0.88],
  [-0.36, 0.00, 0.80, 1.00, 1.00, 0.92, 1.00],
  [-0.72, 0.02, 0.80, 1.00, 1.00, 0.96, 1.00],
  [-1.00, 0.12, 0.62, 0.98, 1.00, 0.96, 1.00],
];
/** Narrow at the nose and widening hard down the flanks to the widest rear
 *  track here — the strakes are feeding those intakes. Full-width flat tail. */
const RIBS_TESTA: RibRow[] = [
  [ 1.00, 0.04, 0.30, 0.48, 0.40, 0.40, 0.42],
  [ 0.86, 0.00, 0.46, 0.68, 0.48, 0.58, 0.50],
  [ 0.60, 0.00, 0.56, 0.80, 0.56, 0.74, 0.56],
  [ 0.30, 0.00, 0.64, 0.86, 0.70, 0.76, 0.70],
  [-0.02, 0.00, 0.72, 0.94, 0.96, 0.80, 0.98],
  [-0.40, 0.00, 0.80, 1.00, 1.00, 0.92, 1.00],
  [-0.76, 0.02, 0.82, 1.00, 1.00, 0.98, 1.00],
  [-1.00, 0.14, 0.70, 1.00, 1.00, 1.00, 1.00],
];
/** A teardrop: narrow rounded nose, widest at the cabin, tapering away to a
 *  small tail. The only car here that gets NARROWER toward the back. */
const RIBS_MERIDIAN: RibRow[] = [
  [ 1.00, 0.06, 0.22, 0.40, 0.46, 0.30, 0.52],
  [ 0.86, 0.00, 0.48, 0.72, 0.56, 0.52, 0.64],
  [ 0.60, 0.00, 0.62, 0.90, 0.68, 0.62, 0.76],
  [ 0.30, 0.00, 0.68, 0.94, 0.82, 0.56, 0.88],
  [-0.02, 0.00, 0.72, 0.98, 0.98, 0.54, 1.00],
  [-0.38, 0.00, 0.70, 0.96, 1.00, 0.60, 1.00],
  [-0.72, 0.02, 0.62, 0.86, 0.94, 0.64, 0.94],
  [-1.00, 0.08, 0.48, 0.70, 0.84, 0.62, 0.86],
];
/** Heavy and rounded: a high blunt nose, an arched roofline and shoulders that
 *  roll home instead of creasing. Nothing on it is sharp. */
const RIBS_VELOCE: RibRow[] = [
  [ 1.00, 0.06, 0.36, 0.58, 0.56, 0.48, 0.64],
  [ 0.86, 0.00, 0.58, 0.84, 0.66, 0.72, 0.76],
  [ 0.60, 0.00, 0.70, 0.96, 0.76, 0.80, 0.86],
  [ 0.30, 0.00, 0.74, 0.98, 0.88, 0.72, 0.94],
  [-0.02, 0.00, 0.76, 1.00, 1.00, 0.68, 1.00],
  [-0.38, 0.00, 0.76, 1.00, 1.00, 0.76, 1.00],
  [-0.72, 0.02, 0.70, 0.94, 0.96, 0.80, 0.96],
  [-1.00, 0.10, 0.58, 0.82, 0.88, 0.80, 0.90],
];
/** Low, narrow and crisp — a shallow wedge with none of the F40's bulk. */
const RIBS_ZANZA: RibRow[] = [
  [ 1.00, 0.04, 0.30, 0.50, 0.40, 0.40, 0.46],
  [ 0.86, 0.00, 0.52, 0.76, 0.50, 0.60, 0.56],
  [ 0.60, 0.00, 0.64, 0.92, 0.60, 0.74, 0.64],
  [ 0.30, 0.00, 0.70, 0.92, 0.74, 0.68, 0.78],
  [-0.02, 0.00, 0.72, 0.95, 0.96, 0.64, 1.00],
  [-0.40, 0.00, 0.74, 0.99, 1.00, 0.76, 1.00],
  [-0.74, 0.02, 0.70, 0.94, 0.98, 0.84, 0.98],
  [-1.00, 0.14, 0.56, 0.86, 0.92, 0.86, 0.94],
];
/** Upright and narrow, flat-sided, with a tall cabin — a road saloon. */
const RIBS_IMPREZ: RibRow[] = [
  [ 1.00, 0.05, 0.32, 0.60, 0.54, 0.52, 0.62],
  [ 0.86, 0.00, 0.66, 0.90, 0.66, 0.86, 0.74],
  [ 0.58, 0.00, 0.76, 0.97, 0.76, 0.94, 0.82],
  [ 0.28, 0.00, 0.80, 0.99, 0.90, 0.92, 0.92],
  [-0.06, 0.00, 0.80, 1.00, 1.00, 0.90, 1.00],
  [-0.40, 0.00, 0.80, 1.00, 1.00, 0.94, 1.00],
  [-0.74, 0.02, 0.76, 0.98, 1.00, 0.96, 1.00],
  [-1.00, 0.06, 0.68, 0.92, 0.98, 0.94, 0.99],
];
/** An enormously long FLAT bonnet running most of the car before the screen
 *  even starts — the whole point of the shape. */
const RIBS_FIREHAWK: RibRow[] = [
  [ 1.00, 0.04, 0.30, 0.58, 0.44, 0.50, 0.48],
  [ 0.88, 0.00, 0.64, 0.88, 0.52, 0.84, 0.56],
  [ 0.64, 0.00, 0.74, 0.97, 0.60, 0.94, 0.62],
  [ 0.36, 0.00, 0.76, 0.98, 0.66, 0.96, 0.66],
  [ 0.06, 0.00, 0.78, 0.99, 0.90, 0.92, 0.94],
  [-0.34, 0.00, 0.78, 1.00, 1.00, 0.90, 1.00],
  [-0.72, 0.02, 0.76, 0.99, 1.00, 0.94, 1.00],
  [-1.00, 0.06, 0.70, 0.95, 0.98, 0.94, 0.99],
];
/** Squarer and blunter than the Firehawk: a near-vertical front face and a
 *  short deck, so it reads as stocky where the other reads as long. */
const RIBS_IROC: RibRow[] = [
  [ 1.00, 0.04, 0.44, 0.70, 0.56, 0.64, 0.60],
  [ 0.88, 0.00, 0.70, 0.92, 0.62, 0.90, 0.66],
  [ 0.62, 0.00, 0.78, 0.98, 0.68, 0.96, 0.70],
  [ 0.32, 0.00, 0.80, 0.99, 0.76, 0.96, 0.78],
  [ 0.00, 0.00, 0.80, 1.00, 0.96, 0.92, 0.98],
  [-0.38, 0.00, 0.80, 1.00, 1.00, 0.94, 1.00],
  [-0.74, 0.02, 0.78, 0.99, 1.00, 0.96, 1.00],
  [-1.00, 0.05, 0.72, 0.96, 0.99, 0.96, 1.00],
];
/** Long slim bonnet, high rounded rear hips, and a tail that falls away — the
 *  classic fastback. Narrowest car on the grid. */
const RIBS_FAIRLADY: RibRow[] = [
  [ 1.00, 0.06, 0.26, 0.46, 0.48, 0.36, 0.54],
  [ 0.86, 0.00, 0.54, 0.78, 0.58, 0.68, 0.64],
  [ 0.58, 0.00, 0.62, 0.88, 0.64, 0.80, 0.68],
  [ 0.26, 0.00, 0.66, 0.90, 0.72, 0.84, 0.74],
  [-0.08, 0.00, 0.70, 0.94, 0.92, 0.80, 0.96],
  [-0.44, 0.00, 0.74, 1.00, 1.00, 0.84, 1.00],
  [-0.78, 0.02, 0.68, 0.92, 0.98, 0.84, 0.98],
  [-1.00, 0.06, 0.56, 0.80, 0.90, 0.76, 0.90],
];

const ROAD_CARS: Record<CarId, RoadCarParams> = {
  f40: {
    L: 4.43, W: 1.98, R: 0.33, rearR: 1.08, clr: 0.12,
    sillY: 0.40, shoulderY: 0.78, deckY: 0.86, roofY: 1.24,
    ribs: RIBS_F40, cabF: 0.34, cabR: -0.50, roof: "canopy", cabW: 0.78, whF: 0.62, whR: 0.60,
    wing: "straked", lamps: "popup", tail: "quad", louvres: 6, naca: true, pipes: 3,
  },
  tauro: {
    L: 4.16, W: 2.02, R: 0.33, rearR: 1.12, clr: 0.11,
    sillY: 0.38, shoulderY: 0.74, deckY: 0.82, roofY: 1.16,
    ribs: RIBS_TAURO, cabF: 0.40, cabR: -0.36, roof: "canopy", cabW: 0.7, whF: 0.60, whR: 0.62,
    wing: "basket", lamps: "popup", tail: "quad", louvres: 5, naca: true, pipes: 4,
  },
  meridian: {
    L: 4.29, W: 1.84, R: 0.32, rearR: 1.06, clr: 0.12,
    sillY: 0.42, shoulderY: 0.80, deckY: 0.90, roofY: 1.26,
    ribs: RIBS_MERIDIAN, cabF: 0.36, cabR: -0.48, roof: "canopy", cabW: 0.8, whF: 0.62, whR: 0.60,
    wing: "duck", lamps: "slim", tail: "bar", louvres: 7, scoop: "roof", pipes: 2,
  },
  veloce: {
    L: 4.46, W: 2.00, R: 0.34, rearR: 1.04, clr: 0.13,
    sillY: 0.44, shoulderY: 0.84, deckY: 0.94, roofY: 1.32,
    ribs: RIBS_VELOCE, cabF: 0.30, cabR: -0.50, roof: "canopy", cabW: 0.82, whF: 0.62, whR: 0.60,
    wing: "duck", lamps: "round2", tail: "bar", twoTone: true, scoop: "roof", pipes: 2,
  },
  testa: {
    L: 4.49, W: 1.98, R: 0.33, rearR: 1.10, clr: 0.12,
    sillY: 0.40, shoulderY: 0.76, deckY: 0.84, roofY: 1.22,
    ribs: RIBS_TESTA, cabF: 0.34, cabR: -0.42, roof: "canopy", cabW: 0.76, whF: 0.62, whR: 0.60,
    wing: "none", lamps: "popup", tail: "slats", strakes: 5, pipes: 2,
  },
  zanza: {
    L: 4.43, W: 1.81, R: 0.32, rearR: 1.05, clr: 0.12,
    sillY: 0.40, shoulderY: 0.78, deckY: 0.86, roofY: 1.26,
    ribs: RIBS_ZANZA, cabF: 0.34, cabR: -0.50, roof: "canopy", cabW: 0.82, whF: 0.62, whR: 0.60,
    wing: "duck", lamps: "slim", tail: "bar", louvres: 4, pipes: 2,
  },
  imprez: {
    L: 4.34, W: 1.75, R: 0.32, clr: 0.20,
    sillY: 0.46, shoulderY: 0.88, deckY: 0.98, roofY: 1.46,
    ribs: RIBS_IMPREZ, cabF: 0.22, cabR: -0.46, roof: "notch", cabW: 0.86, whF: 0.64, whR: 0.62,
    wing: "blade", lamps: "slim", tail: "twin", scoop: "rally", fogLamps: true, pipes: 2,
    rim: 0xc9a44a,   // the gold wheels are half of why you recognise this car
  },
  firehawk: {
    L: 4.98, W: 1.86, R: 0.35, rearR: 1.06, clr: 0.17,
    sillY: 0.44, shoulderY: 0.84, deckY: 0.92, roofY: 1.40,
    ribs: RIBS_FIREHAWK, cabF: 0.12, cabR: -0.60, roof: "targa", cabW: 0.86, whF: 0.66, whR: 0.62,
    wing: "whale", lamps: "slim", tail: "twin", scoop: "shaker", pipes: 2, rim: 0x8a8e96,
  },
  iroc: {
    L: 4.87, W: 1.85, R: 0.34, rearR: 1.06, clr: 0.16,
    sillY: 0.42, shoulderY: 0.82, deckY: 0.90, roofY: 1.38,
    ribs: RIBS_IROC, cabF: 0.14, cabR: -0.58, roof: "notch", cabW: 0.86, whF: 0.66, whR: 0.62,
    wing: "duck", lamps: "round4", tail: "quad", twoTone: true, scoop: "bulge", pipes: 2, rim: 0x8a8e96,
  },
  fairlady: {
    L: 4.14, W: 1.63, R: 0.31, clr: 0.16,
    sillY: 0.40, shoulderY: 0.78, deckY: 0.86, roofY: 1.32,
    ribs: RIBS_FAIRLADY, cabF: 0.10, cabR: -0.64, roof: "fastback", cabW: 0.82, whF: 0.64, whR: 0.62,
    wing: "none", lamps: "round2", tail: "twin", chrome: true, pipes: 1,
  },
};

function buildRoadCar(color: number, p: RoadCarParams, num?: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color, num);
  const { bodyMat, bodyPlain, darkMat, glass, tireMat, rimMat, chromeMat, grilleMat, lensMat, tailMat } = m;

  if (p.rim !== undefined) m.rimMat.color.setHex(p.rim);
  const { L, W, R, sillY, shoulderY, deckY, roofY } = p;
  const hl = L / 2, hw = W / 2;
  const clr = p.clr ?? 0.13;
  const rearR = R * (p.rearR ?? 1);

  // --- body: lofted from the rib table --------------------------------------
  // wMax is held from the sill all the way to the shoulder so the flank is a
  // flat wall ending in an EDGE. Rounding it home there is what made the old
  // bodies read as bathtubs from the chase camera.
  const ribs: Rib[] = p.ribs.map(([zf, lift, wFloor, wMax, shF, wDeck, dF]) => ({
    z: hl * zf,
    half: [
      [0, clr + lift],
      [hw * wFloor, clr + lift],
      [hw * wMax, sillY],
      [hw * wMax, shoulderY * shF],
      [hw * wDeck, deckY * dF],
      [0, deckY * dF],
    ] as [number, number][],
  }));
  // subdiv 2, not 6. The rib table already describes the car; resampling it
  // six times per section splines the edges out of existence. Two keeps the
  // silhouette smooth enough to read as bodywork and leaves the creases in.
  g.add(loftBody(ribs, bodyMat, 2));

  // shoulder crease down the whole flank + a deep rocker so it sits low
  for (const sx of [-1, 1]) {
    g.add(box(0.035, 0.035, L * 0.8, darkMat, sx * hw * 0.985, shoulderY, -L * 0.02));
    g.add(box(0.09, 0.16, L * 0.5, darkMat, sx * hw * 0.97, sillY * 0.55, -L * 0.02));
  }
  if (p.twoTone) {
    // lower body in the dark colour: valances front and rear plus a flank band,
    // which is how the two-tone reads from behind without a second body shell
    g.add(box(W * 0.94, 0.22, L * 0.1, darkMat, 0, clr + 0.14, hl * 0.9));
    g.add(box(W * 0.94, 0.22, L * 0.1, darkMat, 0, clr + 0.14, -hl * 0.9));
    for (const sx of [-1, 1]) g.add(box(0.045, 0.3, L * 0.62, darkMat, sx * hw * 0.98, sillY * 0.72, -L * 0.02));
  }

  // --- front ----------------------------------------------------------------
  const noseY = deckY * p.ribs[2][6];       // bonnet height at the front arch
  g.add(box(W * 0.78, 0.05, L * 0.06, darkMat, 0, clr - 0.02, hl * 0.9));   // splitter
  g.add(box(W * (p.twoTone ? 0.42 : 0.34), 0.16, 0.06, grilleMat, 0, sillY, hl * 0.95));
  if (p.chrome) {
    g.add(box(W * 0.9, 0.09, 0.07, chromeMat, 0, sillY + 0.06, hl * 0.97));
    g.add(box(W * 0.9, 0.09, 0.07, chromeMat, 0, sillY + 0.06, -hl * 0.97));
  }
  // This was a comma-operator expression that added TWO meshes per side: the
  // fog lamp itself, and a cylinder positioned by `.translateX(0).translateY(0)`
  // — i.e. left at the car's origin, buried inside the body where it could
  // never be seen. Two invisible meshes riding along on every Imprez, drawn
  // every frame. The lamp is the box; the cylinder was an abandoned first go.
  if (p.fogLamps) {
    for (const sx of [-1, 1]) {
      g.add(box(0.14, 0.1, 0.05, lensMat, sx * hw * 0.52, clr + 0.16, hl * 0.96));
    }
  }

  const lamps = p.lamps ?? "slim";
  for (const sx of [-1, 1]) {
    if (lamps === "popup") {
      // closed pop-ups: a dark flush panel let into the bonnet, which is what
      // you actually see on one of these with the lights down
      g.add(box(W * 0.24, 0.03, L * 0.08, darkMat, sx * hw * 0.54, noseY + 0.015, hl * 0.62));
    } else if (lamps === "round4") {
      for (const d of [0.38, 0.6]) {
        const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.05, 12), lensMat);
        lg.rotation.x = Math.PI / 2;
        lg.position.set(sx * hw * d, noseY - 0.06, hl * 0.94);
        g.add(lg);
      }
    } else if (lamps === "round2") {
      const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 14), lensMat);
      lg.rotation.x = Math.PI / 2;
      lg.position.set(sx * hw * 0.58, noseY - 0.04, hl * 0.93);
      g.add(lg);
      if (p.chrome) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 5, 14), chromeMat);
        ring.position.set(sx * hw * 0.58, noseY - 0.04, hl * 0.94);
        g.add(ring);
      }
    } else if (lamps === "slim") {
      g.add(box(W * 0.24, 0.07, 0.05, lensMat, sx * hw * 0.6, noseY - 0.05, hl * 0.92));
    } else {
      g.add(box(W * 0.84, 0.07, 0.05, lensMat, 0, noseY - 0.05, hl * 0.92));
      break;
    }
  }

  // --- tail: the view that fills the screen ---------------------------------
  const tail = p.tail ?? "bar";
  // just PROUD of the kamm face. At 0.985 the lamps sat a few cm inside the
  // bodywork and were half-swallowed by it, which is why the tail read as an
  // unlit slab from the chase camera.
  const ty = deckY * 0.82, tz = -hl - 0.012;
  // Dark panel the lamps are let into. It must not be COPLANAR with the body's
  // own rear face — at -hl * 0.998 with a 0.03 depth it straddled it, leaving
  // two surfaces a hundredth of a metre apart, and that z-fight is the glitchy
  // flicker across the back of the car. Front face buried inside, rear face
  // clearly proud.
  // The recess has to FIT THE LAMPS. One 0.9-width, 0.27-tall black band on
  // every car made the whole grid read the same from behind — a black slab
  // with some colour around it — and on the cars whose lamps are small it was
  // most of the rear end. Only the slatted tail actually wants a full-width
  // panel; that one is a Testarossa and the panel IS the design.
  if (tail === "slats") {
    g.add(box(W * 0.9, 0.27, 0.06, grilleMat, 0, ty, -hl - 0.008));
  } else if (tail === "twin") {
    for (const sx of [-1, 1]) g.add(box(W * 0.36, 0.17, 0.06, grilleMat, sx * hw * 0.6, ty, -hl - 0.008));
  } else if (tail === "quad") {
    g.add(box(W * 0.74, 0.2, 0.06, grilleMat, 0, ty, -hl - 0.008));
  } else {
    g.add(box(W * 0.9, 0.13, 0.06, grilleMat, 0, ty, -hl - 0.008));
  }
  // body-colour lip above the recess, so the tail is BANDED (lip / recess /
  // undercut / diffuser) instead of one continuous painted face
  g.add(box(W * 0.95, 0.055, 0.08, bodyPlain, 0, ty + 0.13, -hl - 0.004));
  if (tail === "bar") {
    g.add(box(W * 0.86, 0.085, 0.05, tailMat, 0, ty, tz));
    g.add(box(W * 0.88, 0.03, 0.06, darkMat, 0, deckY * 0.9, -hl - 0.012));
  } else if (tail === "quad") {
    // Two PAIRS, inboard. At 0.21W spacing the outer lamps sat right on the
    // corners of the car and at 23 cm across they were the size of the wheels —
    // four wide lights spanning the whole tail. On the cars this is modelled on
    // they are small, and grouped either side of the centre.
    for (const sx of [-1.42, -0.62, 0.62, 1.42]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.06, 14), tailMat);
      l.rotation.x = Math.PI / 2;
      l.position.set(sx * W * 0.155, ty, tz - 0.01);
      g.add(l);
    }
  } else if (tail === "twin") {
    for (const sx of [-1, 1]) g.add(box(W * 0.3, 0.12, 0.05, tailMat, sx * hw * 0.6, ty, tz));
  } else {
    // slats: a full-width lamp panel behind horizontal body-colour fins
    g.add(box(W * 0.9, 0.2, 0.04, tailMat, 0, ty, tz));
    for (let i = 0; i < 5; i++)
      g.add(box(W * 0.92, 0.022, 0.05, bodyPlain, 0, ty - 0.08 + i * 0.04, -hl * 0.995));
  }
  // diffuser — depth chosen so its rear face clears the body rather than
  // landing half a millimetre off it
  g.add(box(W * 0.66, 0.2, L * 0.05, grilleMat, 0, clr + 0.1, -hl * 0.93));
  const np = p.pipes ?? 2;
  for (let i = 0; i < np; i++) {
    const off = np === 1 ? 0 : (i / (np - 1) - 0.5) * W * 0.34;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 10), chromeMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(off, clr + 0.2, -hl * 0.99);
    g.add(pipe);
  }

  // --- rear wing ------------------------------------------------------------
  const wing = p.wing ?? "none";
  if (wing === "duck") {
    g.add(box(W * 0.9, 0.05, L * 0.07, bodyPlain, 0, deckY + 0.05, -hl * 0.86));
  } else if (wing === "straked") {
    // The 80s straked wing: a thin plane carried clear of the deck on two
    // uprights. The endplates used to be 0.3 tall and a fifth of the car LONG,
    // which with the plane on top closed the whole thing into a box — it read
    // as a red packing crate strapped to the tail, not as an aerofoil. The
    // defining feature of a wing is that you can see the sky under it.
    const wy = deckY + 0.26, wz = -hl * 0.86;
    g.add(box(W * 0.94, 0.05, L * 0.085, bodyPlain, 0, wy, wz));              // plane
    for (const sx of [-1, 1]) {
      g.add(box(0.04, 0.19, L * 0.1, bodyPlain, sx * hw * 0.94, wy - 0.1, wz));  // endplate
      g.add(box(0.05, 0.23, 0.08, darkMat, sx * hw * 0.44, wy - 0.12, wz));      // upright
    }
  } else if (wing === "basket") {
    const wy = deckY + 0.44, wz = -hl * 0.7;
    g.add(box(W * 0.72, 0.05, L * 0.1, bodyPlain, 0, wy, wz));
    for (const sx of [-1, 1]) g.add(box(0.07, 0.44, 0.1, bodyPlain, sx * hw * 0.58, wy - 0.22, wz));
  } else if (wing === "whale") {
    g.add(box(W * 0.98, 0.06, L * 0.14, bodyPlain, 0, deckY + 0.06, -hl * 0.78));
    for (const sx of [-1, 1]) g.add(box(0.06, 0.13, L * 0.14, bodyPlain, sx * hw * 0.96, deckY + 0.12, -hl * 0.78));
  } else if (wing === "blade") {
    const wy = deckY + 0.28, wz = -hl * 0.82;
    g.add(box(W * 0.88, 0.05, L * 0.09, bodyPlain, 0, wy, wz));
    for (const sx of [-1, 1]) g.add(box(0.06, 0.28, 0.1, darkMat, sx * hw * 0.55, wy - 0.14, wz));
  }

  // --- engine lid, flanks, bonnet -------------------------------------------
  if (p.louvres) for (let i = 0; i < p.louvres; i++)
    g.add(box(W * 0.6, 0.022, 0.05, darkMat, 0, deckY + 0.015, -hl * (0.42 + i * 0.06)));
  if (p.strakes) for (const sx of [-1, 1]) for (let i = 0; i < p.strakes; i++)
    g.add(box(0.05, 0.04, L * 0.3, darkMat, sx * hw * 0.99, sillY + 0.08 + i * 0.075, -L * 0.04));
  if (p.naca) for (const sx of [-1, 1])
    g.add(box(0.04, 0.14, L * 0.16, darkMat, sx * hw * 0.995, sillY + 0.2, -L * 0.1));
  const scoop = p.scoop ?? "none";
  if (scoop === "shaker") g.add(box(W * 0.3, 0.11, L * 0.13, darkMat, 0, noseY + 0.05, hl * 0.5));
  else if (scoop === "rally") {
    g.add(box(W * 0.4, 0.07, L * 0.11, bodyPlain, 0, noseY + 0.03, hl * 0.52));
    g.add(box(W * 0.34, 0.05, 0.04, darkMat, 0, noseY + 0.05, hl * 0.58));
  } else if (scoop === "bulge") g.add(box(W * 0.44, 0.05, L * 0.24, bodyPlain, 0, noseY + 0.02, hl * 0.5));
  else if (scoop === "roof") g.add(box(W * 0.16, 0.1, L * 0.12, darkMat, 0, roofY - 0.02, -hl * 0.2));

  // --- glass ----------------------------------------------------------------
  const cw = hw * p.cabW;
  const canopyHalf = (w: number, yB: number, yT: number): [number, number][] => [
    [0, yB], [w, yB], [w * 0.95, (yB + yT) / 2], [w * 0.5, yT], [0, yT],
  ];
  /**
   * Deck height of the BODY at a given z-fraction, read back out of the rib
   * table. The canopy used to start at a constant deckY, but the bonnet is far
   * below the rear deck on a wedge — 0.64 against 0.86 on the F40 — so the
   * windscreen began 17 cm in the air above the bonnet it was supposed to be
   * growing out of, which is the gap between the glass and the body.
   */
  const deckAtZ = (zf: number): number => {
    const rows = p.ribs;
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      if (zf <= a[0] && zf >= b[0]) {
        const t = (a[0] - zf) / (a[0] - b[0] || 1);
        return deckY * (a[6] + (b[6] - a[6]) * t);
      }
    }
    return deckY * rows[rows.length - 1][6];
  };
  const span = p.cabF - p.cabR;
  const zf = (k: number) => p.cabF - span * k;
  const roof = p.roof ?? "canopy";
  // How far back the roof stays up, and how hard the backlight then falls.
  // A fastback carries the roof almost to the tail and drops it over a long
  // rake; a notchback holds a square cabin and drops vertically onto a boot.
  const roofEnd = roof === "fastback" ? 0.92 : roof === "notch" ? 0.66 : 0.8;
  const tailH = roof === "fastback" ? 0.55 : roof === "notch" ? 0.02 : 0.2;
  const canopy: Rib[] = [
    { z: hl * zf(0),        half: canopyHalf(cw * 0.8,  deckAtZ(zf(0)) - 0.03,    deckAtZ(zf(0))) },
    { z: hl * zf(0.22),     half: canopyHalf(cw * 0.95, deckAtZ(zf(0.22)) - 0.02, roofY * 0.96) },
    { z: hl * zf(0.52),     half: canopyHalf(cw,        deckAtZ(zf(0.52)) - 0.02, roofY) },
    { z: hl * zf(roofEnd),  half: canopyHalf(cw * 0.9,  deckAtZ(zf(roofEnd)) - 0.02,
        roofY * (roof === "notch" ? 0.97 : 0.93)) },
    { z: hl * zf(1),        half: canopyHalf(cw * 0.72, deckAtZ(zf(1)) - 0.02,
        deckAtZ(zf(1)) + 0.02 + (roofY - deckY) * tailH) },
  ];
  g.add(loftBody(canopy, glass, 2));
  // A/B pillars in body colour. Without them the canopy is one dark blob and
  // the eye never separates "cabin" from "bodywork" — you read the whole car
  // as a single moulded lump.
  for (const sx of [-1, 1]) {
    const aY = (deckAtZ(zf(0.22)) + roofY * 0.96) / 2;
    g.add(box(0.055, roofY * 0.96 - deckAtZ(zf(0.22)), 0.09, bodyPlain, sx * cw * 0.9, aY, hl * zf(0.2)));
    const bY = (deckAtZ(zf(0.82)) + roofY * 0.92) / 2;
    g.add(box(0.06, roofY * 0.92 - deckAtZ(zf(0.82)), 0.1, bodyPlain, sx * cw * 0.86, bY, hl * zf(0.84)));
  }
  // roof cap, so the top of the cabin is body and not more glass
  g.add(box(cw * 1.5, 0.045, Math.abs(hl * span) * 0.34, bodyPlain, 0, roofY, hl * zf(0.52)));
  if (roof === "notch") {
    // a real boot deck behind the cabin — the thing that makes a saloon or a
    // notchback coupe read as one rather than as another fastback
    const bz = (zf(roofEnd) + zf(1)) / 2;
    g.add(box(W * 0.86, 0.06, Math.abs(hl * span) * 0.42, bodyPlain, 0, deckY + 0.02, hl * bz));
  } else if (roof === "targa") {
    // T-top: a body-colour spine down the centre and a bar across, so the roof
    // reads as two removable panels either side
    g.add(box(0.1, 0.05, Math.abs(hl * span) * 0.62, bodyPlain, 0, roofY + 0.005, hl * zf(0.5)));
    g.add(box(cw * 1.9, 0.05, 0.1, bodyPlain, 0, roofY + 0.005, hl * zf(0.5)));
  }
  const drv = makeDriver(0x14121c, false);
  drv.position.set(0, deckY - 0.16, hl * (p.cabF - span * 0.45));
  drv.scale.setScalar(0.86);
  g.add(drv);

  // --- the details that make it read as a car rather than a shape -----------
  // Everything below is small. That is the point: a body with no shut-line, no
  // mirror, no window frame and no plate reads as a lofted solid however good
  // its section is, because those are the things the eye uses to size a car.
  const chrome2 = chromeShared();
  for (const sx of [-1, 1]) {
    // Wing mirror. The first version was a stick with a block on it, which at
    // speed reads as a red peg bolted to the door. A real one is a rounded
    // housing on a short arm that rakes up and out, with the glass set into
    // its trailing face — so: a tapered arm, a housing built from a scaled
    // sphere (round in plan, flattened in section, which is the actual shape),
    // and a glass panel angled back toward where the driver's eyes are.
    const mz = hl * zf(0.14);
    const my = deckAtZ(zf(0.14)) + 0.05;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, 0.1, 6), darkMat);
    arm.rotation.z = Math.PI / 2 - sx * 0.35;      // rakes outward and up
    arm.position.set(sx * (cw * 0.98 + 0.05), my + 0.01, mz);
    g.add(arm);
    const housing = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 7), bodyPlain);
    housing.scale.set(0.62, 0.78, 1.25);           // narrow, shallow, long
    housing.position.set(sx * (cw * 0.98 + 0.115), my + 0.035, mz - 0.01);
    g.add(housing);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.052, 12), glass);
    face.scale.set(1, 0.78, 1);
    face.rotation.y = -sx * (Math.PI / 2 - 0.28);  // angled back at the driver
    face.position.set(sx * (cw * 0.98 + 0.152), my + 0.035, mz - 0.02);
    g.add(face);

    // door shut-line and handle. The shut-line is a dark inset sliver, not a
    // painted stripe, so it catches shadow the way a panel gap does.
    const dz = hl * (p.cabF - span * 0.62);
    g.add(box(0.012, shoulderY - sillY * 0.7, 0.022, darkMat, sx * hw * 0.995, (shoulderY + sillY) / 2, dz));
    g.add(box(0.035, 0.045, 0.16, chrome2, sx * hw * 1.0, shoulderY - 0.11, dz + L * 0.07));

    // window surround: a thin frame following the glass along the belt line
    g.add(box(0.025, 0.03, Math.abs(hl * span) * 0.86, darkMat, sx * cw * 0.97,
      deckAtZ(zf(0.5)) - 0.01, hl * zf(0.5)));

    // side intake ahead of the rear arch — a recessed dark mouth with a body
    // lip over it, which is where a mid-engine car actually breathes
    if (p.louvres || p.naca || p.strakes) {
      const iz = -hl * 0.46;
      g.add(box(0.05, 0.17, L * 0.13, grilleMat, sx * hw * 0.99, sillY + 0.16, iz));
      g.add(box(0.06, 0.035, L * 0.14, bodyPlain, sx * hw * 0.985, sillY + 0.26, iz));
    }
  }

  // front bumper ducts either side of the grille, and a number plate recess
  for (const sx of [-1, 1]) {
    g.add(box(W * 0.16, 0.11, 0.05, grilleMat, sx * hw * 0.6, clr + 0.16, hl * 0.955));
  }
  g.add(box(W * 0.22, 0.1, 0.03, chrome2, 0, ty - 0.18, -hl - 0.02));       // plate
  g.add(box(0.11, 0.05, 0.03, chrome2, 0, ty + 0.13, -hl - 0.02));          // badge

  // rear diffuser fins — vertical strakes in the undertray. On a chase camera
  // this is dead centre of frame for the whole race.
  for (const sx of [-2, -1, 0, 1, 2]) {
    g.add(box(0.035, 0.19, L * 0.05, bodyPlain, sx * W * 0.13, clr + 0.1, -hl * 0.93));
  }

  // --- wheels + arches ------------------------------------------------------
  // 0.80 of the half-width buried the tyres INSIDE the bodywork: the flank is a
  // flat wall held at full width up to the shoulder, so a wheel whose outer
  // face sits inboard of that wall is simply invisible. The tyre has to stand
  // very slightly proud of the flank, the way a real wide-body car's does.
  const wx = hw * 0.9;
  for (const [x, z, r] of [
    [-wx, hl * p.whF, R], [wx, hl * p.whF, R],
    [-wx, -hl * p.whR, rearR], [wx, -hl * p.whR, rearR],
  ] as const) {
    g.add(makeWheel(x, z, r, 0.3, tireMat, rimMat, Math.sign(x)));
    // arch: just a dark liner set INBOARD of the tyre, so the flank reads as
    // cut away around the wheel. A body-colour torus eyebrow was the obvious
    // next step and it was wrong — at the tyre's own radius, sitting on its
    // outer face, it renders as a bright hoop stuck round the wheel rather
    // than as a lip in the bodywork.
    g.add(box(0.1, r * 1.5, r * 2.1, darkMat, x - Math.sign(x) * 0.16, clr + r * 0.7, z));
  }
  return g;
}

/** Build the drivable mesh for a car type in a given livery color. */
export function makeKart(id: CarId, color: number): THREE.Group {
  const g = buildRoadCar(color, ROAD_CARS[id], RACE_NUM[id]);
  mergeStaticParts(g);
  return g;
}
