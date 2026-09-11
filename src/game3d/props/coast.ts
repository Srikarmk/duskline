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
export function makeOceanPlane(pal: RealmPalette, size = 4200): THREE.Mesh {
  const W = 512, H = 512;
  const { c, ctx } = canvas(W, H);
  const near = pal.sky[2], far = pal.sky[3];

  // base: sky colour at the horizon fading to a deeper tone close in, because
  // water mirrors the sky above it
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, far);
  g.addColorStop(0.45, near);
  g.addColorStop(1, pal.sky[1]);
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
export function makePalmSilhouette(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const dark = new THREE.MeshBasicMaterial({ color: 0x140d1c, fog: true });
  const h = 7 + rand() * 6;
  const lean = (rand() - 0.5) * 0.5;

  const seg = 6;
  const trunkParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const r0 = 0.32 * (1 - t0 * 0.55), r1 = 0.32 * (1 - t1 * 0.55);
    const s = new THREE.CylinderGeometry(r1, r0, h / seg, 6);
    // quadratic lean gives the classic palm curve instead of a straight pole
    s.translate(lean * t0 * t0 * h, h * (t0 + t1) / 2, 0);
    trunkParts.push(s.toNonIndexed());
  }
  const fronds: THREE.BufferGeometry[] = [];
  const n = 7 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.3;
    const len = 2.6 + rand() * 1.9;
    const f = new THREE.ConeGeometry(0.42, len, 4);
    f.rotateZ(Math.PI / 2);                      // lie it outward
    f.translate(len / 2, 0, 0);
    f.rotateZ(-0.5 - rand() * 0.5);              // droop
    f.rotateY(a);
    f.translate(lean * h, h, 0);
    fronds.push(f.toNonIndexed());
  }
  const all = mergeGeometries([...trunkParts, ...fronds], false);
  if (all) g.add(new THREE.Mesh(all, dark));
  return g;
}
