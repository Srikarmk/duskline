import * as THREE from "three";
import { ROAD_HALF_WIDTH } from "./constants";
import { terrainBump, stoneMaps } from "./textures";
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
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 280; i++) {
      const x = rand() * 1024;
      const y = rand() * 300;
      const r = rand() * 1.8 + 0.4;
      ctx.globalAlpha = 0.25 + rand() * 0.7;
      ctx.fillRect(x, y, r, r);
    }
    ctx.globalAlpha = 1;
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

export function makeGround(groundTex: THREE.Texture): THREE.Mesh {
  const geo = new THREE.CircleGeometry(1400, 64);
  const mat = new THREE.MeshStandardMaterial({
    map: groundTex, bumpMap: terrainBump(120), bumpScale: 0.6,
    metalness: 0, roughness: 1,
  });
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

export function makeRockField(pal: RealmPalette, pts: Placement[]): THREE.InstancedMesh {
  const geo = new THREE.DodecahedronGeometry(0.4, 0);
  const stone = stoneMaps(pal.mountainDark);
  const mat = new THREE.MeshStandardMaterial({
    color: pal.mountainDark, map: stone.map, bumpMap: stone.bump, bumpScale: 0.15,
    metalness: 0.1, roughness: 0.95,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  pts.forEach((pt, i) => {
    p.set(pt.x, pt.y + 0.1, pt.z);
    q.setFromEuler(new THREE.Euler(pt.r, pt.r * 2, pt.r * 0.5));
    s.setScalar(pt.s);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
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

export function makeMountainRing(pal: RealmPalette, cx: number, cz: number, radius: number): THREE.Group {
  const group = new THREE.Group();
  const rand = (() => { let s = 99; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const rings = [
    { r: radius, color: pal.mountainDark, count: 26, h: [40, 90], fog: true },
    { r: radius * 0.82, color: pal.mountain, count: 20, h: [30, 70], fog: true },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2 + rand() * 0.2;
      const h = ring.h[0] + rand() * (ring.h[1] - ring.h[0]);
      const rad = h * (0.7 + rand() * 0.5);
      const geo = new THREE.ConeGeometry(rad, h, 5);
      const mat = new THREE.MeshLambertMaterial({ color: ring.color });
      const peak = new THREE.Mesh(geo, mat);
      peak.position.set(cx + Math.cos(a) * ring.r, h / 2 - 6, cz + Math.sin(a) * ring.r);
      peak.rotation.y = rand() * Math.PI;
      group.add(peak);
    }
  }
  return group;
}

// --- pickups & obstacles ---------------------------------------------------

export function makeGem(color: number, air: boolean): THREE.Mesh {
  const geo = new THREE.OctahedronGeometry(0.45);
  geo.scale(0.7, 1, 0.7);
  const mat = new THREE.MeshStandardMaterial({
    color: air ? 0xfbbf24 : color,
    emissive: air ? 0xb45309 : color,
    emissiveIntensity: 1.3,
    metalness: 0.3,
    roughness: 0.2,
  });
  return new THREE.Mesh(geo, mat);
}

export function makeNitroCan(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 1, 12),
    new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0e7490, emissiveIntensity: 0.8 })
  );
  body.position.y = 0.5;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.2, 0.25, 12),
    new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x67e8f9, emissiveIntensity: 1 })
  );
  cap.position.y = 1.1;
  group.add(body, cap);
  return group;
}

export function makeOrb(): THREE.Group {
  const inner = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 20, 16),
    new THREE.MeshStandardMaterial({
      color: 0xd946ef, emissive: 0xd946ef, emissiveIntensity: 1.6,
      transparent: true, opacity: 0.9,
    })
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.06, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1.2 })
  );
  ring.rotation.x = Math.PI / 2.4;
  inner.add(core, ring);
  inner.position.y = 1.1;
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  return wrapper;
}

export function makeItemBox(): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 1.1),
    new THREE.MeshStandardMaterial({
      color: 0xf0abfc, emissive: 0xd946ef, emissiveIntensity: 1.1,
      transparent: true, opacity: 0.5, metalness: 0.3, roughness: 0.2,
    })
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.15, 1.15, 1.15)),
    new THREE.LineBasicMaterial({ color: 0xfef3c7 })
  );
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.32),
    new THREE.MeshStandardMaterial({ color: 0xfde68a, emissive: 0xfbbf24, emissiveIntensity: 1.6 })
  );
  g.add(shell, edges, core);
  g.position.y = 1.1;
  const wrapper = new THREE.Group();
  wrapper.add(g);
  return wrapper;
}

export function makeMissile(): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.3, 1.2, 8);
  geo.rotateX(Math.PI / 2); // point along +z (travel direction)
  const mat = new THREE.MeshStandardMaterial({
    color: 0xfca5a5, emissive: 0xef4444, emissiveIntensity: 1.8,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.9;
  return m;
}

export function makeMine(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x1e1b2e, metalness: 0.6, roughness: 0.4 })
  );
  const spikeMat = new THREE.MeshStandardMaterial({
    color: 0xf87171, emissive: 0xdc2626, emissiveIntensity: 1.4,
  });
  for (const dir of [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1],
  ]) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 5), spikeMat);
    spike.position.set(dir[0] * 0.55, dir[1] * 0.55 + 0.2, dir[2] * 0.55);
    if (dir[0]) spike.rotation.z = -Math.sign(dir[0]) * Math.PI / 2;
    if (dir[2]) spike.rotation.x = Math.sign(dir[2]) * Math.PI / 2;
    g.add(spike);
  }
  body.position.y = 0.2;
  g.add(body);
  return g;
}

export type RampKind = "standard" | "mega" | "kicker" | "wide";

// each kind: size (half-width, half-length, height), body/glow colours, and
// the launch-power multiplier the engine reads. Widths stay within the ramp
// collision window so you always launch when you drive onto one.
export const RAMP_SPECS: Record<RampKind, {
  w: number; l: number; h: number; body: number; glow: number; chev: number; power: number;
}> = {
  standard: { w: 2.5, l: 3.0, h: 2.0, body: 0x5a2c0e, glow: 0xf59e0b, chev: 0xfbbf24, power: 1.0 },
  mega:     { w: 2.7, l: 4.2, h: 3.2, body: 0x0e3a4a, glow: 0x22d3ee, chev: 0x67e8f9, power: 1.55 },
  kicker:   { w: 2.3, l: 1.9, h: 1.15, body: 0x143a20, glow: 0x4ade80, chev: 0xa7f3d0, power: 0.7 },
  wide:     { w: 2.8, l: 2.5, h: 1.7, body: 0x3b1046, glow: 0xd946ef, chev: 0xf5d0fe, power: 1.05 },
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
    new THREE.MeshStandardMaterial({ color: spec.body, metalness: 0.45, roughness: 0.55, side: THREE.DoubleSide })
  );
  group.add(body);

  const glow = new THREE.MeshStandardMaterial({ color: 0xfde68a, emissive: spec.glow, emissiveIntensity: 1.3 });
  const chevMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: spec.chev, emissiveIntensity: 1.6 });

  // glowing rails + centre strip as tubes that follow the curve
  const railPts = (x: number) => {
    const p: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) { const t = i / N; p.push(new THREE.Vector3(x, yAt(t) + 0.12, zAt(t))); }
    return new THREE.CatmullRomCurve3(p);
  };
  for (const sx of [-1, 1]) {
    group.add(new THREE.Mesh(new THREE.TubeGeometry(railPts(sx * w), N * 2, 0.13, 6, false), glow));
  }
  group.add(new THREE.Mesh(new THREE.TubeGeometry(railPts(0), N * 2, 0.16, 6, false), glow));

  // glowing chevrons lying on the curved surface, pointing up-ramp
  const chevN = kind === "kicker" ? 2 : 3;
  for (let i = 0; i < chevN; i++) {
    const t = 0.32 + i * 0.2;
    const chev = new THREE.Mesh(new THREE.ConeGeometry(w * 0.4, 0.5, 3), chevMat);
    chev.position.set(0, yAt(t) + 0.24, zAt(t));
    chev.rotation.x = -slopeAt(t);
    group.add(chev);
  }

  return group;
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
      color: shade, emissive: shade, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.2,
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
  const geo = new THREE.TorusGeometry(1.4, 0.14, 6, 20, Math.PI * 1.1);
  const mat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  return mesh;
}

// --- effects ---------------------------------------------------------------

export function makeFlame(): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.22, 1.2, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.85 });
  const flame = new THREE.Mesh(geo, mat);
  flame.rotation.x = Math.PI / 2;
  return flame;
}

export function makeUnderGlow(): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, "rgba(103,232,249,0.8)");
  grad.addColorStop(1, "rgba(103,232,249,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(3.4, 3.4);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export function makeShieldBubble(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(2.7, 20, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x67e8f9, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 1.2;
  m.visible = false;
  return m;
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
