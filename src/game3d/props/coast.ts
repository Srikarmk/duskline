import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RealmPalette } from "../realms";

/** Shared canvas helper — these are all texture-driven flat shapes. */
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { c, ctx: c.getContext("2d")! };
}

/**
 * The sea, city-pop style.
 *
 * In the reference art the water is never a simulated surface — it's flat
 * colour cut by HORIZONTAL BANDS that compress toward the horizon, with one
 * bright column of glitter running back to the sun. So this is a single plane
 * with a painted texture rather than anything reflective: no normal map, no
 * env sampling, nothing that could go grey or "ghostly" at a distance. The
 * banding does all the work of reading as water.
 */
export function makeOceanPlane(pal: RealmPalette, size = 4200, sea?: [string, string]): THREE.Mesh {
  const W = 512, H = 512;
  const { c, ctx } = canvas(W, H);
  // Water mirrors the sky, so deriving its colour from the sky palette is the
  // right default — for a hot sunset, where the sky IS the brightest thing
  // around. It fails on a pale sky: Cape Road's grey-blue afternoon and Port
  // Azur's hazy noon both gave a sea the exact value of the fog behind it, so
  // the Pacific and the Med read as more haze rather than as water. Those
  // realms name their own [near, far] instead.
  const near = sea ? sea[0] : pal.sky[2];
  const far = sea ? sea[1] : pal.sky[3];

  // base: sky colour at the horizon fading to a deeper tone close in, because
  // water mirrors the sky above it
  const g = ctx.createLinearGradient(0, 0, 0, H);
  // NOTE: this plane is ~12 km across and centred on the circuit, so everything
  // you actually see from the car sits in a narrow band around v = 0.5. Running
  // the gradient all the way to the zenith colour therefore painted the water
  // beside the road solid magenta. The middle has to HOLD the near-water tone
  // and only the outer edges climb to the horizon.
  g.addColorStop(0.00, far);
  g.addColorStop(0.22, near);
  g.addColorStop(0.44, near);
  g.addColorStop(0.56, near);
  g.addColorStop(0.78, near);
  g.addColorStop(1.00, far);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // glitter column: a wedge of light running from the horizon toward the viewer,
  // widening as it approaches — the single most recognisable feature of the look
  const colX = W * 0.5;
  for (let y = 0; y < H; y++) {
    const v = y / H;                       // 0 horizon -> 1 near
    const wid = W * (0.012 + v * 0.16);
    const a = (1 - v) * 0.85 + 0.1;
    ctx.fillStyle = `rgba(255,236,196,${(a * 0.5).toFixed(3)})`;
    ctx.fillRect(colX - wid / 2, y, wid, 1);
  }

  // horizontal bands, compressed near the horizon so the plane reads as
  // receding distance rather than a flat sheet of colour
  let seed = 7321;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 2; y < H; y++) {
    const v = y / H;
    if (rnd() > 0.08 + v * 0.42) continue;
    const len = W * (0.05 + rnd() * (0.1 + v * 0.5));
    const x = rnd() * W;
    const inCol = Math.abs(x - colX) < W * (0.02 + v * 0.18);
    ctx.fillStyle = inCol
      ? `rgba(255,245,214,${(0.5 + rnd() * 0.4).toFixed(3)})`
      : `rgba(255,255,255,${(0.05 + v * 0.12).toFixed(3)})`;
    ctx.fillRect(x, y, len, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  // Unlit on purpose: the sea must stay exactly the colour it was painted. Any
  // lighting term would drag it grey once the ambient drops for silhouettes.
  const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.userData.noShadow = true;
  mesh.renderOrder = -1;      // behind everything standing on the shore
  return mesh;
}

/**
 * A distant city as a flat silhouette band.
 *
 * Deliberately ONE merged geometry with an unlit near-black material: in the
 * reference art the skyline carries no detail at all, it's a cut-out shape, and
 * keeping it unlit stops it picking up the warm key light and turning muddy.
 */
export function makeSkyline(rand: () => number, pal: RealmPalette, width = 1500): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  let x = -width / 2;
  while (x < width / 2) {
    const w = 16 + rand() * 46;
    const h = 40 + rand() * 170;
    const d = 18 + rand() * 30;
    const b = new THREE.BoxGeometry(w, h, d);
    b.translate(x + w / 2, h / 2, (rand() - 0.5) * 70);
    parts.push(b.toNonIndexed());
    // the occasional spire, so the skyline has landmarks rather than a flat comb
    if (rand() < 0.1) {
      const sh = h * (0.5 + rand() * 0.7);
      const sp = new THREE.ConeGeometry(w * 0.12, sh, 4);
      sp.translate(x + w / 2, h + sh / 2, 0);
      parts.push(sp.toNonIndexed());
    }
    x += w + 6 + rand() * 26;
  }
  const geo = mergeGeometries(parts, false) ?? parts[0];
  const dark = new THREE.Color(pal.fog).lerp(new THREE.Color(0x000000), 0.72);
  const mat = new THREE.MeshBasicMaterial({ color: dark, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.noShadow = true;
  return mesh;
}

/**
 * A silhouette palm: bare curved trunk with a splayed frond crown. Unlit and
 * near-black, because in this art style roadside planting is a shape against the
 * sky, not a lit object.
 */
/**
 * Beach cross-section texture. The apron's U runs 0..1 straight ACROSS the
 * shore, so one column of pixels can describe the whole strip: dry sand at the
 * kerb, a darker wet band right at the waterline, then seabed. That's why the
 * beach reads as a beach instead of a tiled field.
 */
export function makeSandTexture(pal: RealmPalette): THREE.Texture {
  const W = 96, H = 256;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0.00, "#c2a184");   // dry sand against the kerb
  g.addColorStop(0.30, "#bb9878");
  g.addColorStop(0.42, "#a8805f");
  g.addColorStop(0.49, "#7c5a45");   // wet band at the water's edge
  g.addColorStop(0.53, "#4a3a3c");
  g.addColorStop(0.70, "#2a2130");   // seabed, under the water anyway
  g.addColorStop(1.00, "#1d1826");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  let sd = 77;
  const rand = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  for (let i = 0; i < 2600; i++) {
    const x = rand() * W, y = rand() * H;
    const light = rand() < 0.5;
    ctx.fillStyle = light ? `rgba(255,232,200,${(0.05 + rand() * 0.10).toFixed(2)})`
                          : `rgba(60,38,30,${(0.05 + rand() * 0.10).toFixed(2)})`;
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
  // foam: a broken white line exactly at the waterline (u = 0.5), which is what
  // actually tells you where the land stops and the sea starts
  for (let i = 0; i < 900; i++) {
    const x = W * (0.478 + rand() * 0.05);
    const y = rand() * H;
    ctx.fillStyle = `rgba(255,246,236,${(0.18 + rand() * 0.5).toFixed(2)})`;
    ctx.fillRect(x, y, 1 + rand() * 3, 1 + rand() * 2);
  }
  // tide lines: faint darker streaks running ALONG the shore near the water
  for (let i = 0; i < 14; i++) {
    const x = W * (0.34 + rand() * 0.14);
    ctx.strokeStyle = `rgba(70,46,38,${(0.08 + rand() * 0.10).toFixed(2)})`;
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 12; y <= H; y += 12) ctx.lineTo(x + (rand() - 0.5) * 3, y);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;   // U spans the strip once, never tiles
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  void pal;
  return t;
}

/**
 * One palm frond, built as a central rachis with leaflets combed off both
 * sides. The old version was a 4-sided cone per frond, which in silhouette is
 * a spike — a ring of them reads as a broken umbrella, not a tree. A frond's
 * whole character is that it arcs up then falls away, and that its edge is
 * feathered; both are geometry, so both have to be built.
 */
function frondGeometry(rand: () => number, len: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const quad = (a: number[], b: number[], c: number[], d: number[]) => { tri(a, b, c); tri(a, c, d); };
  const M = 26;   // leaflet stations: few + long reads as a sawtooth, not a frond
  const lift = len * 0.30, droop = len * 1.20;
  const at = (t: number): [number, number] => [len * t, lift * t - droop * t * t * t];

  for (let i = 0; i < M; i++) {
    const t0 = i / M, t1 = (i + 1) / M;
    const [x0, y0] = at(t0), [x1, y1] = at(t1);
    const w0 = 0.06 * (1 - t0 * 0.8), w1 = 0.06 * (1 - t1 * 0.8);
    quad([x0, y0, -w0], [x0, y0, w0], [x1, y1, w1], [x1, y1, -w1]);
  }
  for (let i = 1; i < M; i++) {
    const t = i / M;
    const [x, y] = at(t);
    const [x2, y2] = at(Math.min(1, t + 1 / M));
    // leaflets are longest around the middle of the frond and shrink to the tip
    const ll = 0.21 * len * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02)), 0.5) * (0.85 + rand() * 0.3);
    const back = 0.9 * ll;                  // combed back sharply toward the trunk
    const drop = 0.5 * ll * (0.3 + t);      // and hanging more toward the tip
    for (const s of [-1, 1]) tri([x, y, 0], [x - back, y - drop, s * ll], [x2, y2, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A single palm's merged geometry, with a vertical vertex tint. */
function palmVariantGeometry(rand: () => number, lit: boolean): THREE.BufferGeometry {
  const h = 6.0 + rand() * 3.4;   // 6-9.4 m: a palm, not a radio mast
  const lean = (rand() - 0.5) * 0.62;
  const parts: THREE.BufferGeometry[] = [];

  const seg = 7;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const r0 = 0.30 * (1 - t0 * 0.5), r1 = 0.30 * (1 - t1 * 0.5);
    const s = new THREE.CylinderGeometry(r1, r0, h / seg, 7);
    s.translate(lean * t0 * t0 * h, (h * (t0 + t1)) / 2, 0);
    // fronds carry no UVs (they're vertex-coloured, not mapped), and
    // mergeGeometries refuses a mixed attribute set
    const sn = s.toNonIndexed(); sn.deleteAttribute("uv");
    parts.push(sn);
  }
  // ring of old frond scars where the crown meets the trunk
  const crown = new THREE.SphereGeometry(0.42, 7, 5);
  crown.translate(lean * h, h, 0);
  const cn = crown.toNonIndexed(); cn.deleteAttribute("uv");
  parts.push(cn);

  const n = 9 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.35;
    const len = 3.1 + rand() * 2.2;
    const f = frondGeometry(rand, len);
    // outer fronds sit lower, inner ones stand up — a crown, not a wheel
    f.rotateZ(0.42 - (i / n) * 0.1 - rand() * 0.55);
    f.rotateY(a);
    f.translate(lean * h, h - 0.1, 0);
    parts.push(f);
  }
  // a couple of dead fronds hanging straight down under the crown
  for (let i = 0; i < 2; i++) {
    const f = frondGeometry(rand, 2.0 + rand() * 1.1);
    f.rotateZ(-1.25 - rand() * 0.3);
    f.rotateY(rand() * Math.PI * 2);
    f.translate(lean * h, h - 0.2, 0);
    parts.push(f);
  }

  const merged = mergeGeometries(parts, false)!;
  // Vertical tint: warm plum at the base lifting off the sand, near-black in the
  // crown against the sky. Pure black everywhere is what made these read as
  // cut-out spiders rather than trees.
  const p = merged.getAttribute("position");
  const col = new Float32Array(p.count * 3);
  // Two tint sets, because the same numbers cannot serve both. Under the
  // near-black ambient of a sunset realm anything above ~0.15 comes back as
  // salmon pink instead of as a backlit silhouette; under a bright daylight
  // hemisphere those same values read as a dead grey-purple stick. So a lit
  // realm gets an actual brown trunk and green crown.
  const base = lit ? [0.30, 0.23, 0.13] : [0.135, 0.100, 0.150];
  const tip = lit ? [0.10, 0.20, 0.09] : [0.035, 0.025, 0.045];
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, p.getY(i) / h));
    const e = t * t;
    for (let k = 0; k < 3; k++) col[i * 3 + k] = base[k] + (tip[k] - base[k]) * e;
  }
  merged.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return merged;
}

/**
 * A single palm as a scenery prop, sharing the same frond geometry as the
 * grove. Exported because the desert palm this replaces built its crown from
 * flat trapezoids in dusty green — under a sunset palette that comes back as
 * an orange starfish on a stick, and there is no reason for the game to have
 * two different ideas of what a palm looks like.
 */
export function makePalmProp(rand: () => number, pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(palmVariantGeometry(rand, pal.hemiInt >= 0.6), mat));
  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

/**
 * Instanced palm grove. These line both sides of the causeway for the whole
 * lap, so one mesh each would be hundreds of draw calls on the one realm that
 * can least afford them.
 */
export function makePalmField(
  rand: () => number,
  spots: { x: number; y: number; z: number; s: number; r: number }[],
  pal: RealmPalette,
  variants = 8
): THREE.Group {
  const out = new THREE.Group();
  if (!spots.length) return out;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const geos = [];
  const lit = pal.hemiInt >= 0.6;   // daylight realm vs a backlit sunset one
  for (let v = 0; v < variants; v++) geos.push(palmVariantGeometry(rand, lit));
  const buckets: (typeof spots)[] = geos.map(() => []);
  spots.forEach((sp, i) => buckets[i % geos.length].push(sp));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  geos.forEach((geo, vi) => {
    const list = buckets[vi];
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((sp, i) => {
      q.setFromAxisAngle(up, sp.r);
      pos.set(sp.x, sp.y, sp.z);
      scl.set(sp.s, sp.s, sp.s);
      inst.setMatrixAt(i, m.compose(pos, q, scl));
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    out.add(inst);
  });
  return out;
}
