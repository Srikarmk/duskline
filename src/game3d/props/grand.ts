import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { pbr, tileSet, stoneMaps } from "../textures";
import { ROAD_HALF_WIDTH } from "../constants";
import type { RealmPalette } from "../realms";

// Monumental procedural set-pieces — the "look at THAT" landmarks, as opposed
// to the roadside dressing in water.ts / objects.ts:
//
//   makeGrandWaterfall(rand, pal)      — a 47-67 m cliff amphitheatre with a
//                                        multi-sheet fall into a plunge pool.
//   makeStoneBridge(rand, pal, span)   — a Roman-aqueduct viaduct the ROAD
//                                        CROSSES OVER (deck top at y=0).
//   makeBatFlock(rand, count)          — a flapping cave-bat flock.
//
// Conventions shared with the rest of game3d: every builder returns a Group
// centred on the origin with local +Z pointing down the road and the piece
// sitting on y = 0, so the engine can place it with track.pointAt and yaw it to
// the tangent. Style is the house faceted low-poly: MeshStandardMaterial +
// flatShading, baked vertex-colour tonal shading / AO, emissive used sparingly
// (UnrealBloom is on, so emissiveIntensity stays <= ~1).
//
// PERFORMANCE. This frame is draw-call bound (~15.3 ms against a 16.6 ms
// budget), and transparent meshes are the most expensive kind, so each builder
// deliberately collapses everything that shares a material into ONE merged
// geometry rather than adding dozens of small meshes:
//
//   makeGrandWaterfall  7 meshes (5 transparent: 3 water sheets + 2 mist)
//   makeStoneBridge     1 mesh   (0 transparent)
//   makeBatFlock        1 mesh   (0 transparent)
//
// The animated builders mark a child `userData.noMerge`, which makes the
// engine's own prop-merge pass leave the whole prop alone. That pass rebuilds a
// prop into fresh meshes, which would silently orphan the mesh/texture handles
// the update functions write to — the animation would just stop. Since these
// props arrive pre-merged, nothing is lost by opting out.

// --- shared helpers ---------------------------------------------------------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => v * v * (3 - 2 * v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic 0..1 hash of a position. Hashing by POSITION (not by index)
 *  means the duplicated corner vertices of a box move together, so a perturbed
 *  block stays watertight — same trick as water.ts's cliffMesh. */
function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** Re-project UVs as a box/triplanar map at a fixed metres-per-tile.
 *
 *  Primitive UVs are normalised 0..1 per face, so a 60 m cliff block and a 3 m
 *  boulder built from the same BoxGeometry would show wildly different texel
 *  densities — the single ugliest artefact on set-pieces this large. Projecting
 *  in world metres instead gives every surface the same grain. The dominant
 *  axis is picked per TRIANGLE (from its face normal) rather than per vertex, so
 *  the projection never switches mid-facet and smears. */
function boxUV(input: THREE.BufferGeometry, metersPerTile: number): THREE.BufferGeometry {
  const geo = input.index ? input.toNonIndexed() : input;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  const inv = 1 / metersPerTile;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const ux = pos.getX(i + 1) - ax, uy = pos.getY(i + 1) - ay, uz = pos.getZ(i + 1) - az;
    const vx = pos.getX(i + 2) - ax, vy = pos.getY(i + 2) - ay, vz = pos.getZ(i + 2) - az;
    const nx = Math.abs(uy * vz - uz * vy);
    const ny = Math.abs(uz * vx - ux * vz);
    const nz = Math.abs(ux * vy - uy * vx);
    const up = ny >= nx && ny >= nz;
    const sideX = !up && nx >= nz;
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k), y = pos.getY(i + k), z = pos.getZ(i + k);
      uv[(i + k) * 2] = (up ? x : sideX ? z : x) * inv;
      uv[(i + k) * 2 + 1] = (up ? z : y) * inv;
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Bake a per-vertex colour (a MULTIPLIER over the material colour, as in
 *  objects.ts's paintByHeight) via a callback, so tonal shading / AO / wetness
 *  live in the geometry and the material stays shared and mergeable. */
function paintVerts(
  geo: THREE.BufferGeometry,
  fn: (x: number, y: number, z: number, out: THREE.Color) => void
): THREE.BufferGeometry {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Add one merged mesh for a batch of same-material geometries — the whole
 *  point of these builders being cheap. Any merge failure (mismatched attribute
 *  sets) degrades to individual meshes rather than dropping the geometry: a few
 *  extra draw calls beats a missing landmark. */
function addMerged(
  parent: THREE.Group, geos: THREE.BufferGeometry[], mat: THREE.Material
): THREE.Mesh | null {
  if (geos.length === 0) return null;
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (!merged) {
    for (const geo of geos) parent.add(new THREE.Mesh(geo, mat));
    return null;
  }
  const mesh = new THREE.Mesh(merged, mat);
  parent.add(mesh);
  return mesh;
}

/** A perturbed rock block: a box with hash-jittered vertices, non-indexed and
 *  box-UV'd, ready to be transformed and merged into a cliff mass. */
function rockBlock(w: number, h: number, d: number, jitter: number, seed: number): THREE.BufferGeometry {
  // 3x4x3 segments rather than 1x1x1: the jitter below only has somewhere to go
  // if the box has interior vertices, and tris are not what this frame is short
  // of — draw calls are.
  const geo = new THREE.BoxGeometry(w, h, d, 3, 4, 3);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = hash3(x + seed, y, z), b = hash3(y + seed, z, x), c = hash3(z + seed, x, y);
    pos.setXYZ(i, x + (a - 0.5) * jitter, y + (b - 0.5) * jitter * 0.6, z + (c - 0.5) * jitter);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return boxUV(geo, 3.2);
}

/** Faceted rock, real CC0 rock albedo/normal when the PBR library has loaded
 *  and a procedural stone fallback when it hasn't. vertexColors carries the
 *  tonal gradient + wetness, so callers must always paint a `color` attribute.
 *
 *  No aoMap on purpose: the vertex-colour pass already bakes contact darkening,
 *  and stacking texture AO on top of it crushed the trees to near-black
 *  (see makeTreeMaterials) — the same trap applies to a big dark cliff. */
function rockMaterial(pal: RealmPalette, tileMeters: number): THREE.MeshStandardMaterial {
  const lib = pbr();
  if (lib) {
    // boxUV already works in metres, so the texture itself repeats 1:1
    const t = tileSet(lib.rock, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: t.diff, normalMap: t.nor, normalScale: new THREE.Vector2(1.3, 1.3),
      color: 0x8f8c86, metalness: 0.08, roughness: 0.94,
      flatShading: true, vertexColors: true,
    });
    if (t.arm) { mat.roughnessMap = t.arm; mat.roughness = 1; }
    return mat;
  }
  const stone = stoneMaps(pal.mountainDark);
  stone.map.repeat.set(tileMeters, tileMeters);
  stone.bump.repeat.set(tileMeters, tileMeters);
  return new THREE.MeshStandardMaterial({
    color: pal.mountainDark, map: stone.map, bumpMap: stone.bump, bumpScale: 0.25,
    metalness: 0.08, roughness: 0.95, flatShading: true, vertexColors: true,
  });
}

// --- procedural water / mist textures --------------------------------------

let sheetTexBase: THREE.Texture | null = null;

/** Vertical foam-streak texture for the falling sheets. Alpha varies along the
 *  streaks so layered sheets show through each other (that is what sells volume)
 *  and fades out at u=0/u=1 so a sheet has soft edges instead of a hard cut. */
function sheetTexture(): THREE.Texture {
  if (!sheetTexBase) {
    const W = 128, H = 256;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    // streaks run along v (down the fall), so they tile seamlessly in v
    for (let i = 0; i < 150; i++) {
      const x = hash3(i, 3, 7) * W;
      const w = 1 + hash3(i, 11, 5) * 7;
      const a = 0.12 + hash3(i, 17, 2) * 0.55;
      ctx.fillStyle = "rgba(255,255,255," + a.toFixed(3) + ")";
      ctx.fillRect(x, 0, w, H);
    }
    // horizontal chop: clumps of foam so the sheet is not just a comb
    for (let i = 0; i < 260; i++) {
      const x = hash3(i, 23, 1) * W;
      const y = hash3(i, 29, 4) * H;
      const r = 2 + hash3(i, 31, 6) * 9;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.6)");
      g.addColorStop(1, "rgba(235,248,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // feather both vertical edges to nothing
    const edge = ctx.createLinearGradient(0, 0, W, 0);
    edge.addColorStop(0, "rgba(0,0,0,1)");
    edge.addColorStop(0.12, "rgba(0,0,0,0)");
    edge.addColorStop(0.88, "rgba(0,0,0,0)");
    edge.addColorStop(1, "rgba(0,0,0,1)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping; // scrolled every frame to make it fall
    sheetTexBase = tex;
  }
  // each sheet scrolls at its own speed, and offset lives on the Texture, so
  // every sheet needs its own (tiny, image-sharing) clone
  const t = sheetTexBase.clone();
  t.needsUpdate = true;
  return t;
}

let mistTex: THREE.Texture | null = null;

/** Soft puff-cluster alpha for spray/mist quads. Clamped (never scrolled), so
 *  the blob can safely fade to zero at the quad border. */
function mistTexture(): THREE.Texture {
  if (mistTex) return mistTex;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const x = S * (0.5 + (hash3(i, 5, 9) - 0.5) * 0.66);
    const y = S * (0.62 + (hash3(i, 7, 3) - 0.5) * 0.6);
    const r = S * (0.1 + hash3(i, 13, 8) * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  mistTex = tex;
  return tex;
}

// ---------------------------------------------------------------------------
// 1) makeGrandWaterfall — monumental cliff amphitheatre + multi-sheet fall
// ---------------------------------------------------------------------------
//
// Layout (local space, the fall faces -Z so a driver approaching along the road
// sees the water, matching makeWaterfall in water.ts):
//
//   |x| > 9        flanking cliff walls, front faces at z = +2, up to H tall
//   |x| < 9        a recessed chute: its lip is the brink at z = +5
//   z in [2, -18]  the open plunge amphitheatre, wrapped by angled buttresses
//   pool           a disc centred on the impact point (0, 0, -6)
//
// H is 46-66 m with the brink at ~0.84 H, so the drop itself is 38-55 m.

const GW_NOTCH = 9; // half-width of the chute the water pours through
const GW_BRINK_Z = 5; // z of the lip (recessed behind the cliff faces at z=2)
const GW_IMPACT_Z = -6; // z where the sheets land

interface GrandFallAnim {
  n: number;
  /** one scrolled texture per sheet, plus its scroll rate in tiles/second */
  tex: THREE.Texture[];
  speed: Float32Array;
  mists: THREE.Mesh[];
  mistY: Float32Array;
  mistRate: Float32Array;
  mistPhase: Float32Array;
}

export function makeGrandWaterfall(rand: () => number, pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();
  const H = 46 + rand() * 20;
  const brinkY = H * 0.84;

  // --- (a) the rock mass: cliff + buttresses + ledges + talus + boulders ---
  // All one merged geometry. Wetness and tonal depth are baked per-vertex, so
  // a single material covers 60 m of cliff and a 3 m boulder in one draw call.
  const rock: THREE.BufferGeometry[] = [];
  const place = (
    geo: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, tilt = 0
  ) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0)),
      new THREE.Vector3(1, 1, 1)
    ));
    rock.push(geo);
  };

  // flanking walls (their inner faces form the chute), heights deliberately
  // unequal so the skyline is not a symmetrical gate
  place(rockBlock(18, H, 16, 3.4, 11), -18, H / 2, 10);
  place(rockBlock(18, H * 0.93, 16, 3.4, 23), 18, (H * 0.93) / 2, 10.6, 0.06);
  // the chute floor: lower than the walls, so the silhouette has a V-notch and
  // the water has somewhere to come FROM
  place(rockBlock(GW_NOTCH * 2, brinkY, 14, 2.8, 37), 0, brinkY / 2, GW_BRINK_Z + 7);
  // outer shoulders, to break the wall tops into a ridge rather than a slab
  place(rockBlock(13, H * 0.55, 13, 3.0, 51), -28, H * 0.3, 4, 0.35);
  place(rockBlock(12, H * 0.62, 13, 3.0, 67), 29, H * 0.34, 6, -0.3);
  // buttresses wrapping forward around the pool — this is what turns a flat
  // cliff into an amphitheatre and gives the piece its scale from the road
  place(rockBlock(12, H * 0.72, 26, 3.6, 83), -21, H * 0.36, -4, 0.34);
  place(rockBlock(12, H * 0.66, 26, 3.6, 97), 21, H * 0.33, -3, -0.31);
  // Ledges breaking up the back of the chute. Their front faces stop at z ~ 3.5,
  // which is just BEHIND where the sheets have leaned to by this height — the
  // bright inner sheets fall clear of them and only the faint outer veil grazes
  // one. Rock protruding through a 0.78-opacity jet reads as a modelling error.
  place(rockBlock(11, 3.2, 6, 1.6, 113), -3.5, H * 0.54, GW_BRINK_Z + 1.5, 0.12, 0.06);
  place(rockBlock(9, 2.8, 5, 1.6, 129), 4.2, H * 0.33, GW_BRINK_Z + 1.0, -0.15, -0.05);
  // brink aprons: a lighter shelf either side of the lip
  place(rockBlock(7, 2.4, 9, 1.4, 141), -11, brinkY - 1, GW_BRINK_Z + 1);
  place(rockBlock(7, 2.4, 9, 1.4, 157), 11, brinkY - 1.4, GW_BRINK_Z + 1);
  // Talus wedge banking the back of the pool. Deliberately low (top ~6 m) and
  // set back to z >= 0: the sheets have leaned well forward of z = 0 by the time
  // they are down at talus height, so the water still lands in open water
  // instead of disappearing into the bank.
  place(rockBlock(40, 7, 12, 4.2, 173), 0, 2.6, GW_BRINK_Z + 1, 0, 0.12);

  // large boulders around the pool rim — the human-scale reference that makes
  // the cliff read as 60 m rather than 6
  const boulders: [number, number, number][] = [
    [-13.5, -9.5, 4.4], [11.8, -12.5, 3.6], [-6.5, -17.5, 2.9],
    [7.2, -18.5, 2.4], [16.5, -4.5, 3.2],
  ];
  for (let i = 0; i < boulders.length; i++) {
    const [bx, bz, br] = boulders[i];
    const geo = new THREE.IcosahedronGeometry(br, 1);
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
      const len = Math.hypot(x, y, z) || 1;
      const nx = x / len, ny = y / len, nz = z / len;
      const rr = len * (0.78 + 0.44 * hash3(nx + i, ny, nz));
      p.setXYZ(v, nx * rr, ny * rr * 0.78, nz * rr);
    }
    geo.computeVertexNormals();
    place(boxUV(geo, 2.2), bx, br * 0.45, bz, rand() * Math.PI, 0);
  }

  // wetness + tonal shading. Rock is soaked in a band around the fall axis (the
  // sheet and its spray plume run the full height there) and everywhere low
  // down; sunlit crests stay pale. Wet rock is DARKER and slightly blue, which
  // is the cheapest possible "this is a waterfall" cue on the stone itself.
  const dry = new THREE.Color(0.55, 0.55, 0.57);
  const crest = new THREE.Color(1.1, 1.07, 1.0);
  const wetSlate = new THREE.Color(0.3, 0.34, 0.42);
  for (const geo of rock) {
    paintVerts(geo, (x, y, z, out) => {
      out.copy(dry).lerp(crest, smooth(clamp01(y / H)));
      const band = clamp01(1 - Math.abs(x) / 15);        // the fall corridor
      const low = clamp01(1 - (y - 3) / 18);             // splash zone
      const front = clamp01(1 - (z - 2) / 16);           // not the dry backside
      const wet = clamp01(Math.max(band * 0.8, low) * front);
      out.lerp(wetSlate, wet * 0.85);
      const mottle = 0.9 + 0.2 * hash3(x * 0.3, y * 0.3, z * 0.3);
      out.multiplyScalar(mottle);
    });
  }
  addMerged(g, rock, rockMaterial(pal, 6));

  // --- (b) plunge pool ----------------------------------------------------
  // Kept OPAQUE: a transparent pool this large is one of the most expensive
  // things we could add, and a churned plunge basin is not see-through anyway.
  const poolGeo = new THREE.CircleGeometry(13, 26);
  const pp = poolGeo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), y = pp.getY(i);
    const r = Math.hypot(x, y);
    if (r < 0.001) continue;
    const j = 1 + (hash3(x, y, 5) - 0.5) * 0.22; // irregular shoreline
    pp.setXY(i, x * j, y * j);
  }
  poolGeo.computeVertexNormals();
  poolGeo.rotateX(-Math.PI / 2);
  poolGeo.translate(0, 0.06, GW_IMPACT_Z);
  const foam = new THREE.Color(1.5, 1.55, 1.6);
  const deep = new THREE.Color(0.5, 0.62, 0.7);
  paintVerts(poolGeo, (x, _y, z, out) => {
    const d = clamp01(Math.hypot(x, z - GW_IMPACT_Z) / 13);
    out.copy(foam).lerp(deep, smooth(d));
  });
  const pool = new THREE.Mesh(poolGeo, new THREE.MeshStandardMaterial({
    color: 0x27596e, roughness: 0.22, metalness: 0.12,
    vertexColors: true, flatShading: true, side: THREE.DoubleSide,
  }));
  g.add(pool);

  // --- (c) the falling water: three layered sheets ------------------------
  // Widths, opacities and scroll speeds all differ. That mismatch is the whole
  // trick: three identical planes read as one flat card, three offset ones read
  // as a body of water with depth. Three is also the budget — transparent
  // meshes are the most expensive thing in this frame.
  const sheetSpecs = [
    // topHalf, botHalf, zTop,           zBot, opacity, tiles, speed, tint
    // the slow outer veil hugs the rock; the fast narrow jet is launched hardest
    // and so lands furthest out, which is what gives the fall front-to-back depth
    { tw: 6.5, bw: 9.5, z0: GW_BRINK_Z - 0.2, z1: GW_IMPACT_Z + 2.0, op: 0.34, tiles: 5, spd: 0.5, tint: 0xa8cdea },
    { tw: 4.6, bw: 7.2, z0: GW_BRINK_Z - 1.2, z1: GW_IMPACT_Z - 1.0, op: 0.6, tiles: 7, spd: 0.9, tint: 0xd6ecfb },
    { tw: 2.6, bw: 4.4, z0: GW_BRINK_Z - 2.2, z1: GW_IMPACT_Z - 3.5, op: 0.78, tiles: 9, spd: 1.45, tint: 0xffffff },
  ];
  const anim: GrandFallAnim = {
    n: sheetSpecs.length,
    tex: [], speed: new Float32Array(sheetSpecs.length),
    mists: [], mistY: new Float32Array(2), mistRate: new Float32Array(2), mistPhase: new Float32Array(2),
  };
  for (let i = 0; i < sheetSpecs.length; i++) {
    const s = sheetSpecs[i];
    const tex = sheetTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: s.tint, emissive: new THREE.Color(s.tint), emissiveIntensity: 0.22,
      transparent: true, opacity: s.op, depthWrite: false, side: THREE.DoubleSide,
      roughness: 0.25, metalness: 0, flatShading: true,
    });
    const mesh = new THREE.Mesh(
      fallingSheetGeometry(s.tw, s.bw, brinkY + 0.6, 1.2, s.z0, s.z1, s.tiles), mat
    );
    // depthWrite is off, so draw order decides what layers over what: force
    // back-to-front explicitly instead of trusting per-frame distance sorting
    // of three big overlapping planes.
    mesh.renderOrder = 2 + i;
    mesh.userData.noShadow = true; // a translucent sheet would cast a solid black slab
    mesh.userData.noMerge = true;  // keeps the engine from orphaning our texture handles
    g.add(mesh);
    anim.tex.push(tex);
    anim.speed[i] = s.spd;
  }

  // --- (d) spray / mist: two merged quad clusters --------------------------
  // One churning cluster at the base, one thinner veil where the fall clips the
  // upper ledge. Each cluster is several yawed quads merged into ONE mesh, so
  // the mist reads from off-axis without costing a mesh per card.
  const mistMat = new THREE.MeshStandardMaterial({
    map: mistTexture(), color: 0xffffff, emissive: 0xcfe6f7, emissiveIntensity: 0.3,
    transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide,
    roughness: 0.6, metalness: 0, vertexColors: true,
  });
  const clusters: { quads: [number, number, number, number, number, number][]; rate: number }[] = [
    {
      // base: wide and low, straddling the impact point
      quads: [
        [0, 5.2, GW_IMPACT_Z + 1.5, 30, 13, 0],
        [-9, 3.4, GW_IMPACT_Z - 2, 20, 10, 0.6],
        [9.5, 3.6, GW_IMPACT_Z - 2.5, 20, 10, -0.55],
        [0, 2.2, GW_IMPACT_Z - 8, 26, 8, 0.12],
      ],
      rate: 0.55,
    },
    {
      // mid-height veil at the ledge strike
      quads: [
        [-2.5, H * 0.55, GW_BRINK_Z - 4, 16, 12, 0.18],
        [3.5, H * 0.36, GW_BRINK_Z - 5, 14, 11, -0.3],
      ],
      rate: 0.33,
    },
  ];
  for (let ci = 0; ci < clusters.length; ci++) {
    const cl = clusters[ci];
    const geos: THREE.BufferGeometry[] = [];
    for (const [qx, qy, qz, qw, qh, yaw] of cl.quads) {
      const q = new THREE.PlaneGeometry(qw, qh).toNonIndexed();
      q.rotateY(yaw);
      q.translate(qx, qy, qz);
      // mist is dense where it is born and thins as it rises
      paintVerts(q, (_x, y, _z, out) => {
        const f = clamp01((y - qy + qh / 2) / qh);
        out.setScalar(lerp(1.25, 0.42, smooth(f)));
      });
      geos.push(q);
    }
    const mesh = addMerged(g, geos, mistMat);
    if (!mesh) continue;
    mesh.renderOrder = 6 + ci;
    mesh.userData.noShadow = true;
    mesh.userData.noMerge = true;
    anim.mists.push(mesh);
    anim.mistY[ci] = mesh.position.y;
    anim.mistRate[ci] = cl.rate;
    anim.mistPhase[ci] = ci * 2.2;
  }

  g.userData.grandFall = anim;
  return g;
}

/** One falling sheet: a quad strip that fans out and leans forward as it
 *  descends. Both use t^2 rather than t because falling water ACCELERATES — a
 *  linear fan reads as a solid ramp. `v` runs 0 at the pool to `vTiles` at the
 *  brink, so a single texture offset.y scrolls the whole sheet downward. */
function fallingSheetGeometry(
  topHalf: number, botHalf: number, yTop: number, yBot: number,
  zTop: number, zBot: number, vTiles: number, rows = 7
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i < rows; i++) {
    const t0 = i / rows, t1 = (i + 1) / rows;
    const e0 = t0 * t0, e1 = t1 * t1;
    const y0 = lerp(yTop, yBot, t0), y1 = lerp(yTop, yBot, t1);
    const z0 = lerp(zTop, zBot, e0), z1 = lerp(zTop, zBot, e1);
    const w0 = lerp(topHalf, botHalf, e0), w1 = lerp(topHalf, botHalf, e1);
    const v0 = (1 - t0) * vTiles, v1 = (1 - t1) * vTiles;
    pos.push(-w0, y0, z0, w0, y0, z0, w1, y1, z1);
    uv.push(0, v0, 1, v0, 1, v1);
    pos.push(-w0, y0, z0, w1, y1, z1, -w1, y1, z1);
    uv.push(0, v0, 1, v1, 0, v1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Animate a group from makeGrandWaterfall: scroll each sheet's texture at its
 * own rate and bob/pulse the mist. Allocation-free — it only writes numbers
 * into existing Vector2/Vector3 fields. Offsets are kept in 0..1 with a modulo
 * so a long session never drifts into float-precision mush.
 */
export function updateGrandWaterfall(g: THREE.Group, t: number): void {
  const a = g.userData.grandFall as GrandFallAnim | undefined;
  if (!a) return;
  for (let i = 0; i < a.n; i++) {
    const tex = a.tex[i];
    tex.offset.y = (t * a.speed[i]) % 1;
    // a hair of lateral drift so the streaks never look pinned to the rock
    tex.offset.x = Math.sin(t * 0.23 + i) * 0.012;
  }
  for (let i = 0; i < a.mists.length; i++) {
    const m = a.mists[i];
    const ph = t * a.mistRate[i] + a.mistPhase[i];
    m.position.y = a.mistY[i] + Math.sin(ph) * 0.9;
    const s = 1 + Math.sin(ph * 0.73) * 0.07;
    m.scale.set(s, 1 + Math.sin(ph * 1.31) * 0.05, s);
  }
}

// ---------------------------------------------------------------------------
// 2) makeStoneBridge — a Roman-aqueduct viaduct the road drives ACROSS
// ---------------------------------------------------------------------------
//
// Local axes match the track: the road runs along +Z down the middle of the
// deck, x spans across it. The deck TOP is y = 0 (the road ribbon lays straight
// onto it) and everything structural hangs BELOW into the gorge. The only thing
// above the road surface is a 0.9 m parapet at the deck edges — deliberately
// under the 1.2 m limit, and outboard of |x| = 6.6, so it can never eat into
// the driver's view or the 10 m driving corridor.
//
// The whole viaduct is ONE mesh. The arcade needs to read darker and damper
// than the sun-bleached deck, and that difference is carried entirely in vertex
// colours rather than a second material — which is what keeps a 120 m
// monument at a single draw call.

const SB_DECK_HALF = ROAD_HALF_WIDTH + 3; // 8 → 16 m deck, 3 m shoulder each side
const SB_PARAPET_TOP = 0.9; // < 1.2 m: never blocks the view
/** The road ribbon is drawn at y = 0, and a deck exactly coplanar with it
 *  z-fights along the entire span, so the stone is recessed 4 cm and the road
 *  always wins the depth test. Effectively "deck top at y = 0". */
const SB_DECK_TOP = -0.04;

export function makeStoneBridge(rand: () => number, pal: RealmPalette, span: number): THREE.Group {
  const g = new THREE.Group();
  const L = Math.min(160, Math.max(30, span));
  const half = L / 2;

  const deckT = 1.25;
  const corniceT = 0.5;
  const deckUnder = SB_DECK_TOP - deckT - corniceT;
  // arch count from the span, so a 40 m bridge gets 2 fat arches and a 120 m one
  // gets 5 — bays stay in the 20-27 m range where semicircles look Roman
  const arches = Math.max(2, Math.min(6, Math.round(L / 26)));
  const bay = L / arches;
  const pierW = Math.min(4.6, bay * 0.26);
  const r = (bay - pierW) / 2; // semicircular: rise == radius
  const spandrel = 1.1; // solid stone between the arch crown and the deck
  const springY = deckUnder - spandrel - r;
  const legH = Math.max(5, Math.min(18, L * 0.16)); // straight pier legs
  const floorY = springY - legH; // where the arch openings stop
  // A Shape hole must lie STRICTLY inside its contour — a hole that reaches the
  // contour edge makes ShapeUtils.triangulateShape emit degenerate triangles at
  // every pier foot. So the arcade continues below the openings as a foundation
  // course, which is how a real viaduct meets the ground anyway.
  const sill = 0.7;
  const baseY = floorY - sill;
  const arcadeHalf = SB_DECK_HALF * 0.86; // the deck overhangs, giving a cornice line

  const parts: THREE.BufferGeometry[] = [];

  // --- (a) the arcade, as one extruded elevation --------------------------
  // Piers, arch heads and spandrels are all "the solid part of the side
  // elevation", so they are built as a single filled outline with one
  // arched-doorway HOLE per bay and extruded across the bridge. Far simpler and
  // more watertight than assembling voussoirs, and it is one geometry.
  const outline = new THREE.Shape();
  outline.moveTo(-half, baseY);
  outline.lineTo(half, baseY);
  outline.lineTo(half, deckUnder);
  outline.lineTo(-half, deckUnder);
  outline.closePath();

  const batter = legH * 0.07; // piers widen toward the base (a battered pier)
  for (let i = 0; i < arches; i++) {
    const cx = -half + bay * (i + 0.5);
    const hole = new THREE.Path();
    hole.moveTo(cx - (r - batter), floorY);
    hole.lineTo(cx - r, springY);
    hole.absarc(cx, springY, r, Math.PI, 0, true); // semicircular head
    hole.lineTo(cx + (r - batter), floorY);
    hole.closePath();
    outline.holes.push(hole);
  }

  let arcade: THREE.BufferGeometry = new THREE.ExtrudeGeometry(outline, {
    depth: arcadeHalf * 2, bevelEnabled: false, curveSegments: 7, steps: 1,
  });
  arcade.translate(0, 0, -arcadeHalf);
  // the elevation is built in the shape's XY plane; rotate it so the shape's X
  // (along the bridge) becomes world Z (down the road) and the extrusion
  // becomes the bridge width. The arcade is symmetric both ways, so the sign of
  // this rotation does not matter.
  arcade.rotateY(Math.PI / 2);
  arcade = boxUV(arcade, 3.4);
  parts.push(arcade);

  // spread footings, wider than the arcade, where each pier meets the sill
  for (let i = 0; i <= arches; i++) {
    const z = -half + bay * i;
    const foot = new THREE.BoxGeometry(arcadeHalf * 2 + 1.8, 2.4, pierW + 2.6);
    foot.translate(0, baseY + 1.2, z);
    parts.push(boxUV(foot, 3.4));
  }

  // buried abutment blocks at each end, anchoring the deck into the gorge sides
  for (const sz of [-1, 1]) {
    const abH = Math.abs(baseY) * 0.55;
    const ab = new THREE.BoxGeometry(SB_DECK_HALF * 2 + 2.4, abH, 5.5);
    ab.translate(0, SB_DECK_TOP - abH / 2, sz * (half + 2.2));
    parts.push(boxUV(ab, 3.4));
  }

  const arcadeCount = parts.length; // everything so far is arcade (damp, shaded)

  // --- (b) deck, cornice, parapet -----------------------------------------
  const deck = new THREE.BoxGeometry(SB_DECK_HALF * 2, deckT, L);
  deck.translate(0, SB_DECK_TOP - deckT / 2, 0);
  parts.push(boxUV(deck, 3.4));

  const cornice = new THREE.BoxGeometry(SB_DECK_HALF * 2 + 1.3, corniceT, L);
  cornice.translate(0, SB_DECK_TOP - deckT - corniceT / 2, 0);
  parts.push(boxUV(cornice, 3.4));

  const parapetInner = ROAD_HALF_WIDTH + 1.6; // 6.6 — clear of the driving corridor
  const parapetW = SB_DECK_HALF - parapetInner; // 1.4
  const parapetMid = parapetInner + parapetW / 2;
  const balusters = Math.max(4, Math.floor(L / 1.9));
  for (const sx of [-1, 1]) {
    const x = sx * parapetMid;

    const plinth = new THREE.BoxGeometry(parapetW, 0.32, L);
    plinth.translate(x, SB_DECK_TOP + 0.16, 0);
    parts.push(boxUV(plinth, 2.0));

    const cap = new THREE.BoxGeometry(parapetW + 0.16, 0.22, L);
    cap.translate(x, SB_PARAPET_TOP - 0.11, 0);
    parts.push(boxUV(cap, 2.0));

    // A balustrade is dozens of tiny boxes — exactly the pattern that murders
    // this frame when each one is its own mesh, and exactly the pattern merging
    // makes free. ~60 per side cost nothing once they are one buffer.
    // derive the baluster extent from the plinth top and the cap underside, so
    // they can never end up floating in the gap between the two
    const balBot = SB_DECK_TOP + 0.32;
    const balTop = SB_PARAPET_TOP - 0.22;
    for (let i = 0; i < balusters; i++) {
      const z = -half + 0.95 + (i / (balusters - 1)) * (L - 1.9);
      const b = new THREE.BoxGeometry(parapetW * 0.62, balTop - balBot, parapetW * 0.62);
      b.translate(x, (balBot + balTop) / 2, z);
      parts.push(boxUV(b, 1.2));
    }

    // heavier pilaster posts over each pier, so the arcade rhythm reads from
    // the road as well as from the side. These stand 0.1 m proud of the cap —
    // the tallest thing on the bridge at 1.0 m, still well under the 1.2 m
    // sight-line limit.
    const postH = SB_PARAPET_TOP + 0.1;
    for (let i = 0; i <= arches; i++) {
      const post = new THREE.BoxGeometry(parapetW + 0.3, postH, 1.7);
      post.translate(x, postH / 2, -half + bay * i);
      parts.push(boxUV(post, 1.6));
    }
  }

  // --- (c) weathering, baked per vertex -----------------------------------
  // The arcade is painted damp/dark/mossy from the gorge floor upward; the deck
  // and parapet are painted pale and sun-bleached. Same material, different
  // vertex colours — one draw call for the whole monument.
  const wetBase = new THREE.Color(0.36, 0.4, 0.36);
  const shade = new THREE.Color(0.62, 0.61, 0.58);
  const sunlit = new THREE.Color(1.12, 1.09, 1.02);
  // ONE seed, drawn once: mottling must be a pure function of position, or the
  // duplicated corner vertices of a non-indexed triangle disagree and the stone
  // reads as per-triangle speckle instead of blotchy weathering.
  const wseed = rand() * 31;
  const mottle = (x: number, y: number, z: number) =>
    0.9 + 0.2 * hash3(x * 0.4 + wseed, y * 0.35, z * 0.4);
  for (let i = 0; i < parts.length; i++) {
    const isArcade = i < arcadeCount;
    paintVerts(parts[i], (x, y, z, out) => {
      if (isArcade) {
        const f = smooth(clamp01((y - baseY) / (deckUnder - baseY)));
        out.copy(wetBase).lerp(shade, f);
        // damp streaking down the piers: strongest right above the footings
        out.lerp(wetBase, clamp01(1 - (y - baseY) / 9) * 0.5);
      } else {
        out.copy(shade).lerp(sunlit, smooth(clamp01((y + 0.6) / 1.6)));
      }
      out.multiplyScalar(mottle(x, y, z));
    });
  }

  addMerged(g, parts, rockMaterial(pal, 4));
  return g;
}

// ---------------------------------------------------------------------------
// 3) makeBatFlock — a cave-bat flock as a SINGLE vertex-animated mesh
// ---------------------------------------------------------------------------
//
// The obvious build (a Group per bat holding a body and two wing meshes) is
// 3 x count draw calls, which for 16 bats is more than the entire rest of a
// set-piece. Instead every bat is baked into one merged buffer and the update
// writes transformed vertices straight into the position attribute: ~580
// vertices of pure float math per frame, one draw call, zero allocation.
//
// Stale vertex NORMALS are fine here because the material is flatShading —
// three derives facet normals in the fragment shader from screen-space position
// derivatives, so the animation never needs computeVertexNormals().

const BAT_HALF_SPAN = 0.95;

/** Template bat, flying toward +Z, wings spread along x. Body is an elongated
 *  octahedron (8 tris); each wing is 2 tris of membrane. 36 vertices total. */
function batTemplate(): number[] {
  const N = [0, 0.02, 0.46], T = [0, 0, -0.52];
  const L = [-0.11, 0, -0.04], R = [0.11, 0, -0.04];
  const U = [0, 0.11, -0.02], D = [0, -0.09, -0.02];
  const v: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => v.push(...a, ...b, ...c);
  tri(N, R, U); tri(N, U, L); tri(N, L, D); tri(N, D, R);
  tri(T, U, R); tri(T, L, U); tri(T, D, L); tri(T, R, D);
  for (const s of [1, -1]) {
    const rf = [0.1 * s, 0.02, 0.2];
    const rb = [0.1 * s, 0.01, -0.3];
    const mk = [0.5 * s, 0, 0.1];
    const tp = [BAT_HALF_SPAN * s, -0.02, -0.3];
    tri(rf, mk, rb);
    tri(mk, tp, rb);
  }
  return v;
}

interface BatFlockAnim {
  n: number;
  perBat: number;
  /** rest-pose vertices, per-bat scale already baked in */
  base: Float32Array;
  /** how much of the wing-flap rotation each vertex takes (0 = rigid body) */
  wgt: Float32Array;
  attr: THREE.BufferAttribute;
  arr: Float32Array;
  cx: Float32Array; cy: Float32Array; cz: Float32Array;
  rx: Float32Array; ry: Float32Array; rz: Float32Array;
  wx: Float32Array; wy: Float32Array; wz: Float32Array;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  flapRate: Float32Array; flapPhase: Float32Array; flapAmp: Float32Array;
}

export function makeBatFlock(rand: () => number, count = 14): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(1, Math.min(24, Math.round(count)));
  const tmpl = batTemplate();
  const perBat = tmpl.length / 3;

  const base = new Float32Array(n * tmpl.length);
  const wgt = new Float32Array(n * perBat);
  const a: BatFlockAnim = {
    n, perBat, base, wgt,
    attr: null as unknown as THREE.BufferAttribute,
    arr: new Float32Array(n * tmpl.length),
    cx: new Float32Array(n), cy: new Float32Array(n), cz: new Float32Array(n),
    rx: new Float32Array(n), ry: new Float32Array(n), rz: new Float32Array(n),
    wx: new Float32Array(n), wy: new Float32Array(n), wz: new Float32Array(n),
    px: new Float32Array(n), py: new Float32Array(n), pz: new Float32Array(n),
    flapRate: new Float32Array(n), flapPhase: new Float32Array(n), flapAmp: new Float32Array(n),
  };

  for (let b = 0; b < n; b++) {
    const scale = 0.7 + rand() * 0.45;
    for (let v = 0; v < perBat; v++) {
      const i = b * perBat + v;
      const x = tmpl[v * 3], y = tmpl[v * 3 + 1], z = tmpl[v * 3 + 2];
      base[i * 3] = x * scale;
      base[i * 3 + 1] = y * scale;
      base[i * 3 + 2] = z * scale;
      // weight from the UNSCALED span, so every bat flaps the same shape
      wgt[i] = smooth(clamp01(Math.abs(x) / BAT_HALF_SPAN));
    }
    // Lissajous loops: z at ~2x the x rate traces a lazy figure-eight, which
    // reads as purposeful circling instead of drifting. Kept inside roughly
    // 12 x 6 x 12 m so the flock fits a cave interior.
    a.cx[b] = (rand() - 0.5) * 6.4;
    a.cz[b] = (rand() - 0.5) * 6.4;
    // the band is lifted clear of windscreen height: a bat clipping through the
    // car at 1 m altitude reads as a bug, not as atmosphere
    a.cy[b] = 2.8 + rand() * 1.8;
    a.rx[b] = 1.4 + rand() * 1.4;
    a.rz[b] = 1.4 + rand() * 1.4;
    a.ry[b] = 0.4 + rand() * 0.8;
    a.wx[b] = 0.28 + rand() * 0.3;
    a.wz[b] = a.wx[b] * (1.8 + rand() * 0.5);
    a.wy[b] = 0.7 + rand() * 0.9;
    a.px[b] = rand() * Math.PI * 2;
    a.py[b] = rand() * Math.PI * 2;
    a.pz[b] = rand() * Math.PI * 2;
    a.flapRate[b] = 18 + rand() * 12; // ~3-5 Hz: real bats are faster, but this
    a.flapPhase[b] = rand() * Math.PI * 2; // is where it stops strobing on screen
    a.flapAmp[b] = 0.7 + rand() * 0.35;
  }

  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(a.arr, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", attr);
  a.attr = attr;
  // Bounds must be set by hand and left alone: the vertices move every frame,
  // so an auto-computed sphere from the rest pose would go stale and the whole
  // flock would pop out of view at the edge of the frustum.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 11);

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x17141c, roughness: 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide,
  }));
  // Decorative, and vertex-animated: shadow-casting would re-upload and
  // re-rasterise the flock into the shadow map every frame for a silhouette
  // nobody sees in a dark cave.
  mesh.userData.noShadow = true;
  mesh.userData.noMerge = true;
  mesh.frustumCulled = true;
  g.add(mesh);

  g.userData.batFlock = a;
  updateBatFlock(g, 0); // pose them before the first frame, not at the origin
  return g;
}

/**
 * Animate a group from makeBatFlock: flap the wings and drift each bat along
 * its looping path, writing straight into the shared position buffer.
 * Allocation-free — no Vector3/Matrix4, no closures, one needsUpdate per frame.
 */
export function updateBatFlock(g: THREE.Group, t: number): void {
  const a = g.userData.batFlock as BatFlockAnim | undefined;
  if (!a) return;
  const base = a.base, wgt = a.wgt, arr = a.arr, perBat = a.perBat;

  for (let b = 0; b < a.n; b++) {
    const ax = a.wx[b] * t + a.px[b];
    const az = a.wz[b] * t + a.pz[b];
    const bx = a.cx[b] + a.rx[b] * Math.sin(ax);
    const bz = a.cz[b] + a.rz[b] * Math.sin(az);
    const by = a.cy[b] + a.ry[b] * Math.sin(a.wy[b] * t + a.py[b]);
    // heading from the analytic path derivative, so the bat always faces the
    // way it is actually moving through the figure-eight
    const dx = a.rx[b] * a.wx[b] * Math.cos(ax);
    const dz = a.rz[b] * a.wz[b] * Math.cos(az);
    const yaw = Math.atan2(dx, dz);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);

    const flap = a.flapAmp[b] * Math.sin(a.flapRate[b] * t + a.flapPhase[b]);
    const sf = Math.sin(flap), cf = Math.cos(flap);

    const v0 = b * perBat;
    for (let v = v0; v < v0 + perBat; v++) {
      const w = wgt[v];
      const px = base[v * 3], py = base[v * 3 + 1], pz = base[v * 3 + 2];
      // rotate about the bat's own fore-aft axis, blended in by weight: the
      // membrane swings through the full angle, the body stays rigid
      const s = sf * w, c = 1 - (1 - cf) * w;
      const x1 = px * c - py * s;
      const y1 = px * s + py * c;
      arr[v * 3] = bx + x1 * cy + pz * sy;
      arr[v * 3 + 1] = by + y1;
      arr[v * 3 + 2] = bz - x1 * sy + pz * cy;
    }
  }
  a.attr.needsUpdate = true;
}
