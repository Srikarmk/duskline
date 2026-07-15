import * as THREE from "three";
import { ROAD_HALF_WIDTH } from "./constants";
import { terrainBump, stoneMaps, pbr, tileSet } from "./textures";
import type { RealmPalette } from "./realms";
import type { RealmId } from "../game/engine";

// --- sky ------------------------------------------------------------------

export function makeSkyDome(pal: RealmPalette): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, pal.sky[0]);
  grad.addColorStop(0.45, pal.sky[1]);
  grad.addColorStop(0.75, pal.sky[2]);
  grad.addColorStop(1, pal.sky[3]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);

  if (pal.stars) {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // soft round stars (was hard squares) — small, mostly dim, a few brighter
    for (let i = 0; i < 220; i++) {
      const x = rand() * 1024;
      const y = rand() * 300;
      const bright = rand();
      const r = bright > 0.92 ? 1.4 + rand() * 1.2 : 0.5 + rand() * 0.9;
      const a = 0.18 + bright * 0.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
      g.addColorStop(0, `rgba(255,255,255,${a.toFixed(2)})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const m of pal.moons) {
    const halo = ctx.createRadialGradient(m.x, m.y, m.r * 0.5, m.x, m.y, m.r * 2.4);
    halo.addColorStop(0, "rgba(255,255,255,0.3)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    const face = ctx.createRadialGradient(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.2, m.x, m.y, m.r);
    face.addColorStop(0, "#ffffff");
    face.addColorStop(1, m.tint);
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(geo, mat);
}

// --- deep-space backdrop (void realm): a ringed gas giant + a nebula --------

export function makeSpaceBackdrop(): THREE.Group {
  const g = new THREE.Group();

  // banded gas-giant texture
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  let seed = 424242;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const bands = ["#6d5ac7", "#8b6fd8", "#5a4bb0", "#a98ae0", "#7159bd", "#9b7fe0"];
  let y = 0;
  while (y < 256) {
    const h = 6 + rand() * 26;
    ctx.fillStyle = bands[Math.floor(rand() * bands.length)];
    ctx.fillRect(0, y, 512, h + 2);
    y += h;
  }
  // swirl mottling
  for (let i = 0; i < 500; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.12;
    ctx.fillStyle = rand() < 0.5 ? "#3a2f7a" : "#c4b0f5";
    const w = 20 + rand() * 90;
    ctx.beginPath();
    ctx.ellipse(rand() * 512, rand() * 256, w, 4 + rand() * 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const R = 150;
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(R, 48, 32),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, emissive: 0x1a1440, emissiveIntensity: 0.25, fog: false })
  );
  g.add(planet);

  // soft atmosphere rim
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.06, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0x8f7ff0, transparent: true, opacity: 0.12, side: THREE.BackSide, fog: false })
  );
  g.add(atmo);

  // tilted ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(R * 1.4, R * 2.2, 64),
    new THREE.MeshBasicMaterial({ color: 0xb9a7ef, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false })
  );
  ring.rotation.x = Math.PI / 2.3;
  ring.rotation.z = 0.3;
  g.add(ring);

  g.position.set(620, 240, -680);
  return g;
}

// --- ground / grass -------------------------------------------------------

/** A soft radial blob, drawn with its wrapped copies so the tile stays seamless. */
function softBlob(
  ctx: CanvasRenderingContext2D, res: number,
  x: number, y: number, r: number, color: string, alpha: number
) {
  for (const ox of [-res, 0, res]) {
    for (const oy of [-res, 0, res]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Organic terrain texture: a base tone mottled with soft patches of a lighter
 * and darker shade (large + medium scale), then fine grain on top. Reads as
 * real ground rather than flat color with random specks.
 */
function noiseTexture(base: string, speck: string, dark: string, tile: number): THREE.Texture {
  const res = 256;
  const c = document.createElement("canvas");
  c.width = res;
  c.height = res;
  const ctx = c.getContext("2d")!;
  let seed = 1337;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, res, res);

  // large soft patches — the terrain's big color variation
  for (let i = 0; i < 60; i++) {
    softBlob(ctx, res, rand() * res, rand() * res, 34 + rand() * 46,
      rand() < 0.5 ? speck : dark, 0.18 + rand() * 0.22);
  }
  // medium mottling
  for (let i = 0; i < 160; i++) {
    softBlob(ctx, res, rand() * res, rand() * res, 8 + rand() * 20,
      rand() < 0.5 ? speck : dark, 0.14 + rand() * 0.22);
  }
  // fine grain flecks
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rand() < 0.5 ? speck : dark;
    ctx.globalAlpha = 0.2 + rand() * 0.4;
    const s = 1 + rand() * 2;
    ctx.fillRect(rand() * res, rand() * res, s, s);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(tile, tile);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function makeGroundTexture(pal: RealmPalette): THREE.Texture {
  return noiseTexture(pal.groundBase, pal.groundSpeck, pal.groundDark, 120);
}

export function makeGrassTexture(pal: RealmPalette): THREE.Texture {
  return noiseTexture(pal.groundBase, pal.groundSpeck, pal.groundDark, 40);
}

export function makeGround(pal: RealmPalette): THREE.Mesh {
  const geo = new THREE.CircleGeometry(1400, 64);
  const lib = pbr();
  let mat: THREE.MeshStandardMaterial;
  if (lib) {
    // real CC0 ground albedo + normal, tiled across the terrain. Realms that
    // borrow another realm's albedo set `groundTint` to recolour it to theirs.
    const t = tileSet(lib.ground, 220);
    mat = new THREE.MeshStandardMaterial({
      map: t.diff, normalMap: t.nor, normalScale: new THREE.Vector2(1, 1),
      metalness: 0, roughness: 1,
      color: pal.groundTint !== undefined ? new THREE.Color(pal.groundTint) : 0xffffff,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      map: makeGroundTexture(pal), bumpMap: terrainBump(120), bumpScale: 0.6, metalness: 0, roughness: 1,
    });
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.05;
  return mesh;
}

export interface Placement { x: number; z: number; y: number; s: number; r: number; }

export function makeGrassField(pal: RealmPalette, pts: Placement[]): THREE.InstancedMesh {
  const geo = new THREE.ConeGeometry(0.16, 0.7, 4);
  geo.translate(0, 0.35, 0);
  const mat = new THREE.MeshLambertMaterial({ color: pal.clutter });
  const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  const base = new THREE.Color(pal.clutter);
  pts.forEach((pt, i) => {
    p.set(pt.x, pt.y, pt.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pt.r);
    s.set(pt.s, pt.s * (0.7 + Math.random() * 0.9), pt.s);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    col.copy(base).offsetHSL(0, 0, (Math.random() - 0.5) * 0.18);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// --- shared low-poly helpers (weathered stone, terrain shading) ------------

/** Tiny deterministic seeded rng, matching the file's inline pattern. */
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** Deterministic 0..1 hash from a direction, so shared vertices of a mesh get
 *  the same displacement — keeps a perturbed boulder watertight (no split
 *  facets). */
function dirHash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Concatenate non-indexed geometries (position + uv) into one buffer. */
function mergePosUV(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of geos) n += (g.getAttribute("position") as THREE.BufferAttribute).count;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let op = 0, ou = 0;
  for (const g of geos) {
    const pa = g.getAttribute("position") as THREE.BufferAttribute;
    pos.set(pa.array as Float32Array, op);
    op += pa.array.length;
    const ua = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
    if (ua) uv.set(ua.array as Float32Array, ou);
    ou += pa.count * 2;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return out;
}

/** Paint a smooth base-shaded → top-lit vertex-colour gradient onto a mesh:
 *  cheap ambient-occlusion + tonal depth baked in (multiplies the material
 *  colour where vertexColors is enabled). */
function paintByHeight(
  geo: THREE.BufferGeometry, offsetY: number,
  yLow: number, yHigh: number, low: THREE.Color, high: THREE.Color
) {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const span = yHigh - yLow || 1;
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let f = (pos.getY(i) + offsetY - yLow) / span;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    f = f * f * (3 - 2 * f); // smoothstep
    c.copy(low).lerp(high, f);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

/** A clustered, weathered boulder: a big irregular mass plus a smaller chunk,
 *  faceted, with a flattened grounded base and baked AO. Built once and shared
 *  by the whole instanced field, so hundreds of rocks stay cheap. */
function boulderGeometry(): THREE.BufferGeometry {
  const chunks = [
    { r: 0.44, x: 0, y: 0, z: 0, sy: 0.82, detail: 1, yaw: 0.0 },
    { r: 0.27, x: 0.34, y: -0.05, z: 0.12, sy: 0.72, detail: 0, yaw: 1.1 },
  ];
  const parts: THREE.BufferGeometry[] = [];
  for (const ch of chunks) {
    const g = new THREE.IcosahedronGeometry(ch.r, ch.detail);
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const len = Math.hypot(x, y, z) || 1;
      const nx = x / len, ny = y / len, nz = z / len;
      const rr = len * (0.80 + 0.44 * dirHash(nx, ny, nz)); // weathered lumpiness
      let yy = ny * rr;
      if (yy < 0) yy *= 0.4; // flatten the buried underside
      p.setXYZ(i, nx * rr, yy, nz * rr);
    }
    const ng = g.toNonIndexed();
    ng.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(ch.x, ch.y, ch.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ch.yaw),
      new THREE.Vector3(1, ch.sy, 1)
    ));
    parts.push(ng);
  }
  const geo = mergePosUV(parts);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(0, -bb.min.y, 0); // sit the base on the ground
  paintByHeight(geo, 0, 0, bb.max.y - bb.min.y,
    new THREE.Color(0.52, 0.53, 0.57), new THREE.Color(1.08, 1.05, 0.99));
  return geo;
}

export function makeRockField(pal: RealmPalette, pts: Placement[]): THREE.InstancedMesh {
  const geo = boulderGeometry();
  const lib = pbr();
  let mat: THREE.MeshStandardMaterial;
  if (lib) {
    const t = tileSet(lib.rock, 1);
    mat = new THREE.MeshStandardMaterial({
      map: t.diff, normalMap: t.nor, color: 0x8a8a8a, metalness: 0.1, roughness: 0.96,
      flatShading: true, vertexColors: true,
    });
  } else {
    const stone = stoneMaps(pal.mountainDark);
    mat = new THREE.MeshStandardMaterial({
      color: pal.mountainDark, map: stone.map, bumpMap: stone.bump, bumpScale: 0.2,
      metalness: 0.1, roughness: 0.96, flatShading: true, vertexColors: true,
    });
  }
  const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  pts.forEach((pt, i) => {
    // grounded: full yaw but only a slight tilt, so the flat base stays down
    e.set(Math.sin(pt.r * 1.7) * 0.13, pt.r, Math.cos(pt.r * 1.3) * 0.13);
    q.setFromEuler(e);
    const raw = Math.sin(i * 12.9898) * 43758.5453;
    const jit = raw - Math.floor(raw); // 0..1 per-instance
    s.set(pt.s * (0.92 + jit * 0.2), pt.s * (0.78 + jit * 0.34), pt.s * (0.92 + (1 - jit) * 0.2));
    p.set(pt.x, pt.y - 0.03 * pt.s, pt.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    const v = 0.84 + jit * 0.22; // subtle per-boulder tonal variation
    col.setRGB(v, v * 0.99, v * 0.96);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// --- ambient particles (fireflies / embers / snow / stardust) --------------

export interface ParticleField {
  points: THREE.Points;
  update: (time: number, center: THREE.Vector3) => void;
}

function dotSprite(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A cloud of drifting motes that follows the camera so it always fills view.
 * Motion is a pure function of time (no dt needed): embers rise, snow falls,
 * fireflies/stardust bob. Colours + size come from the realm.
 */
export function makeParticleField(
  pal: RealmPalette, _bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  realmId: RealmId
): ParticleField {
  const kind =
    realmId === "ember" ? "ember" :
    realmId === "peaks" ? "snow" :
    realmId === "void" ? "stardust" : "firefly";

  const conf = {
    firefly:  { count: 130, color: 0xfde68a, size: 1.7, R: 150, HY: 24 },
    ember:    { count: 190, color: 0xf97316, size: 1.6, R: 160, HY: 52 },
    snow:     { count: 320, color: 0xeaf4ff, size: 1.8, R: 170, HY: 70 },
    stardust: { count: 240, color: 0xa5b4fc, size: 2.0, R: 240, HY: 90 },
  }[kind];

  const { count, R, HY } = conf;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const base = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  let seed = 20260715;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < count; i++) {
    base[i * 3] = (rand() * 2 - 1) * R;
    base[i * 3 + 1] = rand() * HY;
    base[i * 3 + 2] = (rand() * 2 - 1) * R;
    phase[i] = rand() * Math.PI * 2;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.PointsMaterial({
    color: conf.color,
    map: dotSprite(),
    size: conf.size,
    sizeAttenuation: true,
    transparent: true,
    opacity: kind === "snow" ? 0.75 : 0.6,
    depthWrite: false,
    blending: kind === "snow" ? THREE.NormalBlending : THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 2;

  const update = (time: number, center: THREE.Vector3) => {
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      const ph = phase[i];
      let ly: number;
      let sway = 6;
      if (kind === "ember") {
        ly = (by + time * 12) % HY;
        sway = 5;
      } else if (kind === "snow") {
        ly = ((by - time * 9) % HY + HY) % HY;
        sway = 9;
      } else {
        ly = by + Math.sin(time * 0.5 + ph) * 8;
        sway = kind === "stardust" ? 12 : 9;
      }
      const lx = bx + Math.sin(time * 0.4 + ph) * sway;
      const lz = bz + Math.cos(time * 0.33 + ph * 1.3) * sway;
      attr.setXYZ(i, center.x + lx, ly + 2, center.z + lz);
    }
    attr.needsUpdate = true;
  };

  return { points, update };
}

// --- start / finish gantry -------------------------------------------------

/** An arch straddling the start line, built spanning local X (across the road)
 *  with local +Z as the track's forward direction. */
export function makeStartGantry(pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();
  const span = ROAD_HALF_WIDTH * 1.35;
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2438, metalness: 0.7, roughness: 0.4 });
  const trimMat = new THREE.MeshStandardMaterial({
    color: pal.rumbleB, emissive: pal.rumbleB, emissiveIntensity: 1.0, metalness: 0.5, roughness: 0.3,
  });

  const height = 8.5;
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, height, 10), postMat);
    post.position.set(sx * span, height / 2, 0);
    g.add(post);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4), postMat);
    foot.position.set(sx * span, 0.25, 0);
    g.add(foot);
    const glowRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 16), trimMat);
    glowRing.rotation.x = Math.PI / 2;
    glowRing.position.set(sx * span, height - 0.6, 0);
    g.add(glowRing);
  }

  // top beam
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1, 1.4, 1.2), postMat);
  beam.position.set(0, height + 0.2, 0);
  g.add(beam);
  const beamGlow = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1.1, 0.18, 1.3), trimMat);
  beamGlow.position.set(0, height - 0.5, 0);
  g.add(beamGlow);

  // banner with START / FINISH text, facing back down the track (-Z)
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#11101f";
  ctx.fillRect(0, 0, 512, 128);
  // checker trim top + bottom
  for (let x = 0; x < 512; x += 32) {
    ctx.fillStyle = (x / 32) % 2 ? "#e8e0ff" : "#1e1b2e";
    ctx.fillRect(x, 0, 32, 16);
    ctx.fillStyle = (x / 32) % 2 ? "#1e1b2e" : "#e8e0ff";
    ctx.fillRect(x, 112, 32, 16);
  }
  ctx.fillStyle = pal.edgeLine;
  ctx.font = "bold 54px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("START · FINISH", 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 2, span * 0.5),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
  );
  // face the banner back down the track so drivers approaching the line read it
  banner.position.set(0, height - 1.7, -0.62);
  banner.rotation.y = Math.PI;
  g.add(banner);

  return g;
}

/** One closed jagged ridge wall around (cx,cz): a noisy top profile (broad
 *  ranges with sharp uneven peaks overlaid) rising from a base, vertex-shaded
 *  dark at the foot and hazed toward the sky at the crests for atmospheric
 *  depth. */
function ridgeMesh(
  cx: number, cz: number, R: number, base: THREE.Color, fog: THREE.Color,
  haze: number, hLo: number, hHi: number, jag: number, rand: () => number
): THREE.Mesh {
  const steps = 220;
  const y0 = -10;
  // broad harmonics form the mountain "ranges"; two ridged high-freq terms add
  // the sharp uneven peaks (so no two segments look alike).
  const harms = [
    { k: 2, amp: 0.6 + rand() * 0.5, ph: rand() * Math.PI * 2 },
    { k: 3, amp: 0.4 + rand() * 0.4, ph: rand() * Math.PI * 2 },
    { k: 5, amp: 0.25 + rand() * 0.3, ph: rand() * Math.PI * 2 },
  ];
  let wsum = 0;
  for (const h of harms) wsum += h.amp;
  const jk = jag + Math.floor(rand() * 4);
  const jph = rand() * Math.PI * 2;
  const jk2 = jk * 1.7 + 2;
  const jph2 = rand() * Math.PI * 2;
  const wobK = 2 + Math.floor(rand() * 3);
  const wobPh = rand() * Math.PI * 2;
  const heightAt = (a: number) => {
    let s = 0;
    for (const h of harms) s += h.amp * (0.5 + 0.5 * Math.sin(h.k * a + h.ph));
    const env = 0.32 + 0.68 * (s / wsum); // where ranges rise tall vs low saddles
    const r1 = Math.pow(Math.abs(Math.sin(jk * 0.5 * a + jph)), 0.55);
    const r2 = Math.pow(Math.abs(Math.sin(jk2 * 0.5 * a + jph2)), 0.7) * 0.6;
    const v = env * (0.5 + 0.5 * Math.max(r1, r2));
    return hLo + Math.min(1, v) * (hHi - hLo);
  };
  const radAt = (a: number) => R * (1 + 0.045 * Math.sin(wobK * a + wobPh));
  const cLow = base.clone().multiplyScalar(0.5); // shaded foot
  const cHi = base.clone().lerp(fog, haze);      // hazed crest
  const positions: number[] = [];
  const colors: number[] = [];
  const add = (x: number, y: number, z: number, c: THREE.Color) => {
    positions.push(x, y, z);
    colors.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * Math.PI * 2;
    const a1 = ((i + 1) / steps) * Math.PI * 2;
    const r0 = radAt(a0), r1 = radAt(a1);
    const x0 = cx + Math.cos(a0) * r0, z0 = cz + Math.sin(a0) * r0;
    const x1 = cx + Math.cos(a1) * r1, z1 = cz + Math.sin(a1) * r1;
    const t0 = heightAt(a0), t1 = heightAt(a1);
    // the wall segment as two triangles, base shaded / crest hazed
    add(x0, y0, z0, cLow); add(x1, y0, z1, cLow); add(x1, t1, z1, cHi);
    add(x0, y0, z0, cLow); add(x1, t1, z1, cHi); add(x0, t0, z0, cHi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, flatShading: true, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

export function makeMountainRing(pal: RealmPalette, cx: number, cz: number, radius: number): THREE.Group {
  const group = new THREE.Group();
  const rand = seeded(99);
  const fog = new THREE.Color(pal.fog);
  const near = new THREE.Color(pal.mountain);
  const far = new THREE.Color(pal.mountainDark);
  // three concentric ridgelines, far → near: increasing radius, height and haze
  // with distance give layered depth and atmospheric perspective.
  const layers = [
    { r: radius * 1.05, base: far, hLo: 55, hHi: 120, haze: 0.6, jag: 7 },
    { r: radius * 0.9, base: far.clone().lerp(near, 0.5), hLo: 40, hHi: 92, haze: 0.4, jag: 9 },
    { r: radius * 0.74, base: near, hLo: 24, hHi: 66, haze: 0.22, jag: 12 },
  ];
  for (const L of layers) {
    group.add(ridgeMesh(cx, cz, L.r, L.base, fog, L.haze, L.hLo, L.hHi, L.jag, rand));
  }
  return group;
}

// --- pickups & obstacles ---------------------------------------------------

export function makeGem(color: number, air: boolean): THREE.Mesh {
  // A sharp, cheap cut crystal: an elongated octahedron (bipyramid) with a
  // bright emissive interior, a hotter core that blooms through the facets, and
  // a thin rim tracing every edge. Air (mid-air bonus) gems are bigger, glow
  // harder and carry a faceted halo ring so they read as high-value.
  const base = new THREE.Color(air ? 0xfbbf24 : color);
  const r = air ? 0.58 : 0.46;

  const geo = new THREE.OctahedronGeometry(r, 0);
  geo.scale(0.7, 1.3, 0.7); // stretch into a tall gem
  const shell = new THREE.MeshStandardMaterial({
    color: base,
    emissive: base.clone().offsetHSL(0, 0.06, -0.04),
    emissiveIntensity: air ? 1.15 : 0.85,
    metalness: 0.2,
    roughness: 0.12,
    flatShading: true,
    transparent: true,
    opacity: 0.86,
  });
  const gem = new THREE.Mesh(geo, shell);

  // hotter inner core visible through the translucent shell
  const coreGeo = new THREE.OctahedronGeometry(r * 0.52, 0);
  coreGeo.scale(0.7, 1.3, 0.7);
  const core = new THREE.Mesh(
    coreGeo,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: base.clone().offsetHSL(0, -0.2, 0.35),
      emissiveIntensity: air ? 2.4 : 1.9,
      flatShading: true,
    })
  );
  gem.add(core);

  // thin bright rim along every facet edge
  const rim = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({
      color: base.clone().offsetHSL(0, -0.35, 0.42),
      transparent: true,
      opacity: 0.9,
    })
  );
  gem.add(rim);

  if (air) {
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(r * 1.55, 0.05, 3, 12),
      new THREE.MeshStandardMaterial({
        color: base.clone().offsetHSL(0, -0.1, 0.2),
        emissive: base.clone().offsetHSL(0, 0, 0.15),
        emissiveIntensity: 1.7,
        flatShading: true,
      })
    );
    halo.rotation.x = Math.PI / 2.6; // tilt so the spin reads as an orbit
    gem.add(halo);
  }

  return gem;
}

export function makeNitroCan(): THREE.Group {
  // A sleek energy canister: dark metal sleeves top and bottom leave a glowing
  // cyan core exposed as an energy window, framed by machined bands and topped
  // with a nozzle.
  const group = new THREE.Group();
  const cyan = new THREE.Color(0x22d3ee);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.3, flatShading: true });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xd7dee9, metalness: 0.9, roughness: 0.24, flatShading: true });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: cyan, emissiveIntensity: 1.7, flatShading: true });

  const R = 0.32;

  // glowing energy core running the full height (exposed in the gap between sleeves)
  const core = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.94, R * 0.94, 1.0, 10), coreMat);
  core.position.y = 0.55;
  group.add(core);

  // metal sleeves, leaving a bright band exposed in the middle
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.44, 8), shellMat);
  lower.position.y = 0.27;
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.34, 8), shellMat);
  upper.position.y = 0.9;
  group.add(lower, upper);

  // machined bands framing the energy window
  for (const y of [0.5, 0.76]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(R + 0.015, 0.04, 4, 14), bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    group.add(band);
  }

  // nozzle + glowing tip
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.18, 8), bandMat);
  neck.position.y = 1.16;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.14, 8), coreMat);
  tip.position.y = 1.31;
  group.add(neck, tip);

  return group;
}

export function makeOrb(): THREE.Group {
  // A contained energy sphere: a hot faceted core inside a translucent shell,
  // wrapped by two crossed faceted rings that read as an orbiting gyroscope as
  // the engine spins the whole thing.
  const inner = new THREE.Group();
  const violet = new THREE.Color(0xd946ef);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 1),
    new THREE.MeshStandardMaterial({
      color: 0xf5d0fe, emissive: violet, emissiveIntensity: 1.7,
      flatShading: true, transparent: true, opacity: 0.95,
    })
  );
  inner.add(core);

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.82, 0),
    new THREE.MeshStandardMaterial({
      color: violet.clone().offsetHSL(0.03, -0.1, 0.12),
      emissive: violet, emissiveIntensity: 0.55,
      metalness: 0.2, roughness: 0.1, flatShading: true,
      transparent: true, opacity: 0.26, side: THREE.DoubleSide,
    })
  );
  inner.add(shell);

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1.3, flatShading: true,
  });
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.05, 3, 20), ringMat);
  ringA.rotation.x = Math.PI / 2.2;
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.05, 3, 20), ringMat);
  ringB.rotation.set(Math.PI / 2.2, Math.PI / 2, 0);
  inner.add(ringA, ringB);

  inner.position.y = 1.1;
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  return wrapper;
}

export function makeItemBox(): THREE.Group {
  // A floating holographic power-cell: a faceted gold crystal core suspended in
  // a translucent cyan frame with bright emissive edges and a rotating accent
  // ring. Reads instantly as a power-up, distinct from the magenta orb.
  const g = new THREE.Group();
  const cyan = new THREE.Color(0x22d3ee);
  const S = 1.05;

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(S, S, S),
    new THREE.MeshStandardMaterial({
      color: 0x0e7490, emissive: cyan, emissiveIntensity: 0.4,
      transparent: true, opacity: 0.16, metalness: 0.3, roughness: 0.15,
      flatShading: true, side: THREE.DoubleSide,
    })
  );
  g.add(frame);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(S, S, S)),
    new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.95 })
  );
  g.add(edges);

  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.4, 0),
    new THREE.MeshStandardMaterial({
      color: 0xfffbeb, emissive: 0xfbbf24, emissiveIntensity: 1.9,
      metalness: 0.1, roughness: 0.1, flatShading: true,
    })
  );
  g.add(core);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.045, 3, 18),
    new THREE.MeshStandardMaterial({
      color: 0xa5f3fc, emissive: cyan, emissiveIntensity: 1.4, flatShading: true,
    })
  );
  ring.rotation.x = Math.PI / 2.4;
  g.add(ring);

  g.position.y = 1.1;
  const wrapper = new THREE.Group();
  wrapper.add(g);
  return wrapper;
}

/** A flat glowing boost pad — three forward-pointing chevrons on the road.
 *  Drive over it for a speed surge. Sits just above the road surface. */
/** A flat "travelator" boost strip flush with the road: a ribbed metal deck with
 *  glowing side rails and forward chevrons — drive onto it for a speed surge. */
export function makeBoostPad(): THREE.Group {
  const g = new THREE.Group();
  const W = ROAD_HALF_WIDTH * 1.7;
  const L = 13;
  // dark ribbed deck, sitting flush with the road
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(W, 0.1, L),
    new THREE.MeshStandardMaterial({
      color: 0x13233a, metalness: 0.6, roughness: 0.4,
      emissive: 0x0891b2, emissiveIntensity: 0.2,
    })
  );
  deck.position.y = 0.05;
  g.add(deck);
  // tread rollers across the width (the escalator/travelator ribs)
  const treadMat = new THREE.MeshStandardMaterial({ color: 0x2c4c6a, metalness: 0.75, roughness: 0.35 });
  const treadGeo = new THREE.BoxGeometry(W * 0.92, 0.06, 0.16);
  for (let z = -L / 2 + 0.6; z < L / 2; z += 0.72) {
    const t = new THREE.Mesh(treadGeo, treadMat);
    t.position.set(0, 0.11, z);
    g.add(t);
  }
  // glowing edge rails (moving-walkway handrail glow)
  const railMat = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1.1 });
  const railGeo = new THREE.BoxGeometry(0.22, 0.14, L);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(sx * (W / 2 - 0.11), 0.13, 0);
    g.add(rail);
  }
  // forward direction chevrons glowing on the deck
  const arrowMat = new THREE.MeshStandardMaterial({ color: 0x9df0ff, emissive: 0x22d3ee, emissiveIntensity: 1.3 });
  const arrowGeo = new THREE.ConeGeometry(W * 0.26, 1.3, 3);
  for (let i = 0; i < 4; i++) {
    const a = new THREE.Mesh(arrowGeo, arrowMat);
    a.rotation.x = -Math.PI / 2;
    a.scale.z = 0.5;
    a.position.set(0, 0.12, -L / 2 + 1.6 + i * 2.7);
    g.add(a);
  }
  return g;
}

export function makeMissile(): THREE.Mesh {
  // A sleek homing rocket. Root mesh = the metal fuselage (long axis +z, the
  // travel direction); a pointed nose cone, four swept fins and a bright plasma
  // exhaust hang off it as children.
  const bodyGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.9, 10);
  bodyGeo.rotateX(Math.PI / 2); // long axis -> +z
  const body = new THREE.Mesh(
    bodyGeo,
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.7, roughness: 0.3, flatShading: true })
  );
  body.position.y = 0.9;

  // pointed nose cone
  const noseGeo = new THREE.ConeGeometry(0.16, 0.5, 10);
  noseGeo.rotateX(Math.PI / 2);
  const nose = new THREE.Mesh(
    noseGeo,
    new THREE.MeshStandardMaterial({ color: 0xf87171, emissive: 0xdc2626, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.3, flatShading: true })
  );
  nose.position.z = 0.66;
  body.add(nose);

  // four swept fins (flat triangles lying along the tail, radiating outward)
  const finPts = new Float32Array([
    0, 0.16, 0.06,
    0, 0.16, -0.4,
    0, 0.5, -0.4,
  ]);
  const finGeo = new THREE.BufferGeometry();
  finGeo.setAttribute("position", new THREE.BufferAttribute(finPts, 3));
  finGeo.computeVertexNormals();
  const finMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, metalness: 0.6, roughness: 0.35, flatShading: true, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.rotation.z = (i * Math.PI) / 2;
    body.add(fin);
  }

  // bright plasma exhaust trailing behind (-z)
  const exhaust = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.55, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff7ed, emissive: 0xf97316, emissiveIntensity: 2.4, flatShading: true, transparent: true, opacity: 0.9 })
  );
  exhaust.rotation.x = -Math.PI / 2; // apex points -z
  exhaust.position.z = -0.62;
  body.add(exhaust);

  return body;
}

export function makeMine(): THREE.Group {
  // A menacing spiked sea-mine: a dark faceted iron shell with a warning band
  // and spikes radiating in every direction, each tipped with a glowing red
  // warning node.
  const g = new THREE.Group();
  const cy = 0.3; // vertical centre of the mine within the group
  const R = 0.48;

  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(R, 0),
    new THREE.MeshStandardMaterial({ color: 0x0b0f1a, metalness: 0.7, roughness: 0.35, flatShading: true })
  );
  body.position.y = cy;
  g.add(body);

  // hazard warning band around the equator
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(R * 0.99, 0.07, 4, 12),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xb45309, emissiveIntensity: 0.9, flatShading: true })
  );
  band.rotation.x = Math.PI / 2;
  band.position.y = cy;
  g.add(band);

  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.4, flatShading: true });
  const nodeMat = new THREE.MeshStandardMaterial({ color: 0xfecaca, emissive: 0xdc2626, emissiveIntensity: 1.9, flatShading: true });

  const dirs: [number, number, number][] = [
    [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7],
    [0.7, -0.5, 0.5], [-0.7, -0.5, -0.5],
  ];
  const up = new THREE.Vector3(0, 1, 0);
  for (const d of dirs) {
    const v = new THREE.Vector3(d[0], d[1], d[2]).normalize();
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 5), spikeMat);
    spike.quaternion.setFromUnitVectors(up, v);
    spike.position.copy(v).multiplyScalar(R + 0.2).add(new THREE.Vector3(0, cy, 0));
    g.add(spike);

    const node = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), nodeMat);
    node.position.copy(v).multiplyScalar(R + 0.42).add(new THREE.Vector3(0, cy, 0));
    g.add(node);
  }

  return g;
}

export type RampKind = "standard" | "mega" | "kicker" | "wide";

// each kind: size (half-width, half-length, height), body/glow colours, and
// the launch-power multiplier the engine reads. Widths stay within the ramp
// collision window so you always launch when you drive onto one.
export const RAMP_SPECS: Record<RampKind, {
  w: number; l: number; h: number; body: number; glow: number; chev: number; power: number;
}> = {
  // single-lane ramps — each occupies ONE lane so you choose to take it (or a
  // clear lane past it); lengths/heights read as bold take-offs you drive up
  standard: { w: 3.2, l: 4.6, h: 2.4, body: 0x5a2c0e, glow: 0xf59e0b, chev: 0xfbbf24, power: 1.0 },
  mega:     { w: 3.4, l: 6.0, h: 3.6, body: 0x0e3a4a, glow: 0x22d3ee, chev: 0x67e8f9, power: 1.5 },
  kicker:   { w: 3.0, l: 3.0, h: 1.55, body: 0x143a20, glow: 0x4ade80, chev: 0xa7f3d0, power: 0.7 },
  wide:     { w: 4.2, l: 4.0, h: 2.1, body: 0x3b1046, glow: 0xd946ef, chev: 0xf5d0fe, power: 1.05 },
};

// curved slope profiles (t: 0 at entry → 1 at lip). All start flat at 0 and
// rise to 1, but with different curvature so the ramps read as genuinely curved.
const RAMP_PROFILE: Record<RampKind, (t: number) => number> = {
  standard: (t) => t * t * (3 - 2 * t),        // smooth S-curve
  mega:     (t) => Math.pow(t, 1.5),           // concave, kicks up hard at the lip
  kicker:   (t) => Math.pow(t, 2.4),           // flat then a sharp late kick
  wide:     (t) => 1 - Math.cos((t * Math.PI) / 2), // quarter-pipe (flat start, steep end)
};

export function makeRamp(kind: RampKind = "standard"): THREE.Group {
  const group = new THREE.Group();
  const spec = RAMP_SPECS[kind];
  const { w, l, h } = spec;
  const profile = RAMP_PROFILE[kind];
  const N = 20;
  const yAt = (t: number) => h * profile(Math.max(0, Math.min(1, t)));
  const zAt = (t: number) => -l + 2 * l * t;
  const slopeAt = (t: number) => Math.atan2(yAt(t + 0.02) - yAt(t - 0.02), 0.04 * 2 * l);

  // --- curved solid body -------------------------------------------------
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const quad = (a: number[], b: number[], c: number[], d: number[]) => { tri(a, b, c); tri(a, c, d); };
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const y0 = yAt(t0), y1 = yAt(t1), z0 = zAt(t0), z1 = zAt(t1);
    quad([-w, y0, z0], [w, y0, z0], [w, y1, z1], [-w, y1, z1]);        // top (drive) surface
    quad([-w, 0, z0], [-w, y0, z0], [-w, y1, z1], [-w, 0, z1]);        // left wall
    quad([w, 0, z0], [w, 0, z1], [w, y1, z1], [w, y0, z0]);            // right wall
  }
  quad([-w, 0, -l], [-w, 0, l], [w, 0, l], [w, 0, -l]);                // bottom
  quad([-w, 0, l], [-w, h, l], [w, h, l], [w, 0, l]);                  // back wall
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const body = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: spec.body, emissive: spec.glow, emissiveIntensity: 0.08,
      metalness: 0.45, roughness: 0.55, flatShading: true, side: THREE.DoubleSide,
    })
  );
  group.add(body);

  const glow = new THREE.MeshStandardMaterial({ color: 0xfde68a, emissive: spec.glow, emissiveIntensity: 1.0 });
  const chevMat = new THREE.MeshStandardMaterial({ color: 0xfffbeb, emissive: spec.chev, emissiveIntensity: 1.5, flatShading: true, side: THREE.DoubleSide });

  // glowing edge rails as tubes that follow the curve
  const railPts = (x: number) => {
    const p: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) { const t = i / N; p.push(new THREE.Vector3(x, yAt(t) + 0.12, zAt(t))); }
    return new THREE.CatmullRomCurve3(p);
  };
  for (const sx of [-1, 1]) {
    group.add(new THREE.Mesh(new THREE.TubeGeometry(railPts(sx * w), N * 2, 0.15, 6, false), glow));
  }

  // bright take-off lip bar across the top edge
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, w * 2, 8), glow);
  lip.rotation.z = Math.PI / 2;
  lip.position.set(0, yAt(1) + 0.16, zAt(1));
  group.add(lip);

  // bold chevron arrow strip climbing the ramp face, each arrow pointing up-ramp
  const cw = w * 0.42;
  const cl = 0.72;
  const arrowGeo = new THREE.BufferGeometry();
  arrowGeo.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, cl,      // tip (up-ramp, +z)
    -cw, 0, -cl,   // back-left
    cw, 0, -cl,    // back-right
  ], 3));
  arrowGeo.computeVertexNormals();
  const chevN = kind === "kicker" ? 3 : 4;
  for (let i = 0; i < chevN; i++) {
    const t = 0.22 + i * (0.58 / (chevN - 1));
    const chev = new THREE.Mesh(arrowGeo, chevMat);
    chev.position.set(0, yAt(t) + 0.14, zAt(t));
    chev.rotation.x = -slopeAt(t); // lie flat on the sloped face
    group.add(chev);
  }

  return group;
}

// --- textured trees --------------------------------------------------------

export interface TreeMats { trunk: THREE.Material; foliage: THREE.Material; }
export type TreeKind = "pine" | "round" | "tall";

/** Shared trunk (bark) + foliage (leaf) materials for a realm, from the CC0
 *  bark/foliage PBR sets (falls back to flat colours). Reused across every tree
 *  so hundreds of trees don't each allocate materials. */
export function makeTreeMaterials(pal: RealmPalette): TreeMats {
  // foliage uses vertexColors so each tree can bake its own tonal shading + AO +
  // per-instance hue into geometry while the material stays shared. flatShading
  // gives the faceted low-poly leaf/bark read.
  const lib = pbr();
  if (lib) {
    const bark = tileSet(lib.bark, 1, 2.2);
    const fol = tileSet(lib.foliage, 2.2, 2.2);
    return {
      trunk: new THREE.MeshStandardMaterial({ map: bark.diff, normalMap: bark.nor, roughness: 1, metalness: 0, flatShading: true }),
      foliage: new THREE.MeshStandardMaterial({
        color: pal.clutter, map: fol.diff, normalMap: fol.nor, roughness: 1, metalness: 0,
        flatShading: true, vertexColors: true,
      }),
    };
  }
  return {
    trunk: new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1, flatShading: true }),
    foliage: new THREE.MeshStandardMaterial({ color: pal.clutter, roughness: 1, flatShading: true, vertexColors: true }),
  };
}

/** A low-poly tree with a bark trunk and textured foliage — pine (stacked
 *  cones), round (leafy blobs) or tall (slim conifer). Meshes only; the shared
 *  materials come from makeTreeMaterials. */
export function makeTree(rand: () => number, mats: TreeMats, kind: TreeKind): THREE.Group {
  const g = new THREE.Group();
  const h = kind === "tall" ? 4.4 + rand() * 3.4 : 2.6 + rand() * 2.4;

  // --- trunk: tapered with a slight root flare and a gentle lean -----------
  const trunkH = h * (kind === "round" ? 0.4 : 0.28);
  const trunkR = 0.1 + h * 0.036;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(trunkR * 0.55, trunkR * 1.25, trunkH, 6, 1),
    mats.trunk
  );
  trunk.position.y = trunkH / 2;
  trunk.rotation.z = (rand() - 0.5) * 0.08;
  g.add(trunk);

  // per-tree foliage tint (baked into vertex colours; the shared material is
  // reused). Low = shaded, cool under-canopy; High = sunlit, warmer crown.
  const tj = 0.86 + rand() * 0.26;      // per-tree lightness
  const warm = (rand() - 0.5) * 0.10;   // per-tree hue skew (warm/cool)
  const shadeLow = new THREE.Color((0.40 - warm) * tj, 0.50 * tj, (0.46 + warm) * tj);
  const shadeHigh = new THREE.Color((1.10 + warm) * tj, 1.12 * tj, (0.94 - warm) * tj);

  const foliage: THREE.BufferGeometry[] = [];
  const addLeaf = (geo: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, sy = 1) => {
    geo.scale(1, sy, 1);
    geo.rotateY(yaw);
    geo.translate(x, y, z);
    g.add(new THREE.Mesh(geo, mats.foliage));
    foliage.push(geo);
  };

  if (kind === "round") {
    // deciduous: a full canopy of clustered lobes over a broad low mass
    const cBase = trunkH + h * 0.14;
    const R = h * 0.32;
    addLeaf(new THREE.IcosahedronGeometry(R * 1.02, 1), 0, cBase + R * 0.55, 0, rand() * Math.PI);
    const lobes = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + rand() * 0.6;
      const rr = R * (0.5 + rand() * 0.28);
      const rad = R * (0.55 + rand() * 0.3);
      addLeaf(
        new THREE.IcosahedronGeometry(rr, i % 2 ? 0 : 1),
        Math.cos(a) * rad, cBase + R * (0.5 + rand() * 0.6), Math.sin(a) * rad,
        rand() * Math.PI, 0.92
      );
    }
  } else {
    // conifer: tiered cones flaring wide at the base, narrowing to a leader tip.
    // "tall" is the slim variant (narrower spread, more layers).
    const tall = kind === "tall";
    const L = tall ? 6 : 5;
    const spread = h * (tall ? 0.24 : 0.42);
    const cBase = trunkH * 0.72;
    const canopyH = h * (tall ? 0.78 : 0.66);
    const ch = canopyH * (tall ? 0.3 : 0.34);
    for (let i = 0; i < L; i++) {
      const t = i / (L - 1);
      const r = spread * (1 - t * 0.85) * (0.9 + rand() * 0.2) + 0.05;
      addLeaf(
        new THREE.ConeGeometry(r, ch, 7),
        (rand() - 0.5) * r * 0.14, cBase + t * canopyH + ch * 0.34, (rand() - 0.5) * r * 0.14,
        rand() * Math.PI
      );
    }
    addLeaf(new THREE.ConeGeometry(spread * 0.12 + 0.05, canopyH * 0.3, 6), 0, cBase + canopyH * 1.06, 0, 0);
  }

  // bake the canopy gradient once the masses are placed (shaded base of canopy
  // → sunlit crown), so the foliage reads with depth instead of flat.
  let yLo = Infinity, yHi = -Infinity;
  for (const geo of foliage) {
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    if (bb.min.y < yLo) yLo = bb.min.y;
    if (bb.max.y > yHi) yHi = bb.max.y;
  }
  for (const geo of foliage) paintByHeight(geo, 0, yLo, yHi, shadeLow, shadeHigh);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

export function makeCrystalCluster(rand: () => number, colors: number[]): THREE.Group {
  const group = new THREE.Group();
  const shards = 2 + Math.floor(rand() * 3);
  const facet = stoneMaps(0xbfc8ff).bump;
  for (let i = 0; i < shards; i++) {
    const height = 1.2 + rand() * 3;
    const geo = new THREE.ConeGeometry(0.35 + rand() * 0.3, height, 5);
    const shade = colors[Math.floor(rand() * colors.length)];
    const mat = new THREE.MeshStandardMaterial({
      color: shade, emissive: shade, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.2,
      bumpMap: facet, bumpScale: 0.05,
    });
    const shard = new THREE.Mesh(geo, mat);
    shard.position.set((rand() - 0.5) * 1.6, height / 2, (rand() - 0.5) * 1.6);
    shard.rotation.z = (rand() - 0.5) * 0.4;
    group.add(shard);
  }
  return group;
}

// --- monsters (transformer combat) -----------------------------------------

export function makeMonster(rand: () => number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b0764, roughness: 0.8, metalness: 0.1 });
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x1e1b2e, roughness: 0.7 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2 });

  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), bodyMat);
  body.scale.set(1, 0.85, 1);
  body.position.y = 1.1;

  // horns
  for (const sx of [-0.5, 0.5]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 6), spikeMat);
    horn.position.set(sx, 2, 0.2);
    horn.rotation.z = sx * -0.3;
    group.add(horn);
  }
  // back spikes
  for (let i = 0; i < 4; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 5), spikeMat);
    spike.position.set((rand() - 0.5) * 1, 1.6, -0.5 - i * 0.2);
    group.add(spike);
  }
  // eyes
  for (const sx of [-0.35, 0.35]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), eyeMat);
    eye.position.set(sx, 1.25, 0.85);
    group.add(eye);
  }
  // stubby legs
  for (const sx of [-0.5, 0.5]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 6), bodyMat);
    leg.position.set(sx, 0.3, 0);
    group.add(leg);
  }
  group.add(body);
  return group;
}

// --- the transformer mech --------------------------------------------------

export interface MechRig {
  group: THREE.Group;
  wings: THREE.Group;
  core: THREE.Mesh;
  armR: THREE.Group;
  sword: THREE.Group;
}

export function makeMech(): MechRig {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x1f6f8b, metalness: 0.8, roughness: 0.3 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x0d3b4a, metalness: 0.8, roughness: 0.4 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 });

  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };

  // legs
  group.add(box(0.55, 1.2, 0.6, steelDark, -0.42, 0.6, 0));
  group.add(box(0.55, 1.2, 0.6, steelDark, 0.42, 0.6, 0));
  group.add(box(0.65, 0.3, 0.9, steel, -0.42, 0.15, 0.1)); // feet
  group.add(box(0.65, 0.3, 0.9, steel, 0.42, 0.15, 0.1));
  group.add(box(1.1, 0.5, 0.7, steelDark, 0, 1.35, 0)); // pelvis

  // torso
  const torso = box(1.5, 1.4, 0.85, steel, 0, 2.25, 0);
  group.add(torso);
  group.add(box(1.2, 0.5, 0.9, trim, 0, 2.9, 0.05)); // collar
  group.add(box(0.9, 0.6, 0.1, steelDark, 0, 2.2, 0.45)); // chest plate

  // head
  group.add(box(0.7, 0.6, 0.65, steelDark, 0, 3.5, 0));
  const visor = box(0.55, 0.16, 0.12, new THREE.MeshStandardMaterial({ color: 0xf0abfc, emissive: 0xf0abfc, emissiveIntensity: 2 }), 0, 3.55, 0.34);
  group.add(visor);
  group.add(box(0.08, 0.4, 0.08, trim, 0.28, 3.95, 0)); // antenna
  group.add(box(0.08, 0.3, 0.08, trim, -0.28, 3.9, 0));

  // shoulders (pauldrons)
  group.add(box(0.7, 0.55, 0.9, steelDark, -1.15, 2.75, 0));
  group.add(box(0.7, 0.55, 0.9, steelDark, 1.15, 2.75, 0));

  // left arm (static)
  const armL = new THREE.Group();
  armL.position.set(-1.15, 2.5, 0);
  armL.add(box(0.4, 1.3, 0.45, steel, 0, -0.65, 0));
  armL.add(box(0.45, 0.4, 0.5, trim, 0, -1.35, 0));
  group.add(armL);

  // right arm (swings) with energy sword
  const armR = new THREE.Group();
  armR.position.set(1.15, 2.5, 0);
  armR.add(box(0.4, 1.3, 0.45, steel, 0, -0.65, 0));
  armR.add(box(0.45, 0.4, 0.5, trim, 0, -1.35, 0)); // fist

  const sword = new THREE.Group();
  sword.position.set(0, -1.5, 0.2);
  const hilt = box(0.16, 0.5, 0.16, steelDark, 0, 0, 0);
  const guard = box(0.5, 0.12, 0.16, trim, 0, 0.28, 0);
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 2.6, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xe0f7ff, emissive: 0x22d3ee, emissiveIntensity: 1.8, transparent: true, opacity: 0.92 })
  );
  blade.position.y = 1.6;
  sword.add(hilt, guard, blade);
  armR.add(sword);
  armR.rotation.x = -0.5; // rest: sword raised
  group.add(armR);

  // core
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xf0abfc, emissive: 0xf0abfc, emissiveIntensity: 2.4 })
  );
  core.position.set(0, 2.3, 0.5);
  group.add(core);

  // back thrusters
  group.add(box(0.3, 0.7, 0.3, steelDark, -0.45, 2.2, -0.5));
  group.add(box(0.3, 0.7, 0.3, steelDark, 0.45, 2.2, -0.5));

  // wings (flight)
  const wings = new THREE.Group();
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0e7490, emissiveIntensity: 1, side: THREE.DoubleSide });
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(2.6, 0.8);
  wingShape.lineTo(2.2, 1.3);
  wingShape.lineTo(0, 0.6);
  wingShape.closePath();
  const wingGeo = new THREE.ShapeGeometry(wingShape);
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  wingL.position.set(0.4, 2.6, -0.55);
  wingL.rotation.y = Math.PI * 0.12;
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.scale.x = -1;
  wingR.position.set(-0.4, 2.6, -0.55);
  wingR.rotation.y = -Math.PI * 0.12;
  wings.add(wingL, wingR);
  wings.visible = false;
  group.add(wings);

  return { group, wings, core, armR, sword };
}

export function makeSlash(): THREE.Mesh {
  // A bright crescent blade-arc. The engine scales, spins and fades it on each
  // sword swing; additive blending + near-white cyan make it bloom hard.
  const geo = new THREE.TorusGeometry(1.5, 0.18, 8, 28, Math.PI * 1.25);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xd8fbff, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  return mesh;
}

// --- effects ---------------------------------------------------------------

export function makeFlame(): THREE.Mesh {
  // A sharp exhaust plume. The engine recolours it (orange / cyan) and flickers
  // its scale; additive blending makes it read as hot boost thrust.
  const geo = new THREE.ConeGeometry(0.24, 1.5, 8);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfb923c, transparent: true, opacity: 0.92,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flame = new THREE.Mesh(geo, mat);
  flame.rotation.x = Math.PI / 2;
  return flame;
}

export function makeUnderGlow(): THREE.Mesh {
  // A bright pool of light cast under the car. A hot white centre falling off to
  // cyan, plus a crisp bright ring, additively blended so it pops on the road.
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(220,250,255,0.85)");
  grad.addColorStop(0.35, "rgba(103,232,249,0.55)");
  grad.addColorStop(1, "rgba(103,232,249,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  // crisp bright rim
  ctx.strokeStyle = "rgba(165,243,252,0.7)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 64, 40, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(3.8, 3.8);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export function makeShieldBubble(): THREE.Mesh {
  // A faceted energy dome. Root mesh = the translucent shell whose opacity the
  // engine pulses; a hex energy lattice and a bright emissive equator rim ride
  // along as children, so the car stays visible through the low-opacity dome.
  const geo = new THREE.IcosahedronGeometry(2.7, 1); // faceted -> hex energy read
  const mat = new THREE.MeshBasicMaterial({
    color: 0x67e8f9, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 1.2;
  m.visible = false;

  // hex energy lattice tracing the facets
  const lattice = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.73, 1),
    new THREE.MeshBasicMaterial({
      color: 0xa5f3fc, wireframe: true, transparent: true, opacity: 0.35,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  m.add(lattice);

  // bright fresnel-like rim at the equator
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(2.7, 0.07, 6, 40),
    new THREE.MeshStandardMaterial({
      color: 0xa5f3fc, emissive: 0x22d3ee, emissiveIntensity: 2.2,
      transparent: true, opacity: 0.9, depthWrite: false, flatShading: true,
    })
  );
  rim.rotation.x = Math.PI / 2;
  m.add(rim);

  return m;
}

/** Nudge a cloned prop's colours by a small random hue/lightness so a forest of
 *  identical models reads as varied. Clones materials so instances differ. */
export function varyTint(obj: THREE.Object3D, rand: () => number) {
  const dh = (rand() - 0.5) * 0.07;
  const dl = (rand() - 0.5) * 0.24;
  const ds = (rand() - 0.5) * 0.12;
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
    if (mat && mat.color && !Array.isArray(mesh.material)) {
      const c = mat.clone();
      c.color = mat.color.clone().offsetHSL(dh, ds, dl);
      mesh.material = c;
    }
  });
}

/** Uniformly tint every mesh in a cloned model, for opponent team colors. */
export function tintModel(obj: THREE.Object3D, hex: number) {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      (o as THREE.Mesh).material = new THREE.MeshStandardMaterial({
        color: hex, metalness: 0.4, roughness: 0.5,
      });
    }
  });
}
