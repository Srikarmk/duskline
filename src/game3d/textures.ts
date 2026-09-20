import * as THREE from "three";
import { groundTextureFor } from "./realms";

export { groundTextureFor };

/** Anisotropic filtering level. The road and ground run to the horizon at a
 *  grazing angle, which is exactly where bilinear/trilinear smears into mush —
 *  anisotropy is the biggest single sharpness win available. Raised 8 -> 16:
 *  this frame is draw-call bound, not texture-bandwidth bound, so it is close to
 *  free. three.js clamps this to the GPU's max anisotropy on upload, so a
 *  device that only supports 8 quietly gets 8. */
export const ANISO = 16;

// ---------------------------------------------------------------------------
// real CC0 PBR textures (Poly Haven) — loaded from /public/textures
// ---------------------------------------------------------------------------

/** `arm` is Poly Haven's packed AO(R) / Roughness(G) / Metalness(B) map — the
 *  glTF convention, which three.js reads straight into roughnessMap (.g). Real
 *  per-texel roughness is the single biggest realism upgrade over a flat
 *  constant: wet patches, worn asphalt and damp bark all catch light
 *  differently. Optional so a missing file degrades instead of breaking. */
export interface TexSet { diff: THREE.Texture; nor: THREE.Texture; arm?: THREE.Texture; }
export interface PBRLib {
  ground: TexSet; road: TexSet; rock: TexSet; metal: TexSet; bark: TexSet; foliage: TexSet;
}

let PBR: PBRLib | null = null;
export function pbr(): PBRLib | null { return PBR; }

const setCache = new Map<string, TexSet>();

async function loadSet(name: string): Promise<TexSet> {
  const cached = setCache.get(name);
  if (cached) return cached;
  const loader = new THREE.TextureLoader();
  // WebP, not JPEG. These are the single heaviest thing a first visit
  // downloads, and recompressing them per map type took the set from 17.6 MB
  // to 1.3 MB — see scripts/optimize-textures.mjs, which is also where the
  // per-type quality reasoning lives. The source JPEGs are kept in
  // assets/textures (out of public/, so they are not deployed).
  const [diff, nor, arm] = await Promise.all([
    loader.loadAsync(`/textures/${name}_diff.webp`),
    loader.loadAsync(`/textures/${name}_nor.webp`),
    loader.loadAsync(`/textures/${name}_arm.webp`).catch(() => null),
  ]);
  diff.colorSpace = THREE.SRGBColorSpace;
  nor.colorSpace = THREE.NoColorSpace;
  const all = arm ? [diff, nor, arm] : [diff, nor];
  if (arm) arm.colorSpace = THREE.NoColorSpace; // data map, never sRGB-decoded
  for (const t of all) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = ANISO;
  }
  const set: TexSet = { diff, nor, arm: arm ?? undefined };
  setCache.set(name, set);
  return set;
}


/** Every PBR set a race loads, for warming. `ground` varies by realm. */
export const SHARED_SETS = ["road", "rock", "metal", "bark", "foliage"] as const;

/** Load the PBR sets a realm needs (its ground + shared road/rock/metal). */
export async function loadPBR(groundName: string): Promise<PBRLib> {
  // a realm may point at a ground texture we don't ship — fall back rather than
  // reject (which would hang the race on "SUMMONING REALM…")
  const groundSafe = loadSet(groundName).catch(() => loadSet("ground_forest"));
  const [ground, road, rock, metal, bark, foliage] = await Promise.all([
    groundSafe, loadSet("road"), loadSet("rock"), loadSet("metal"),
    loadSet("bark"), loadSet("foliage"),
  ]);
  PBR = { ground, road, rock, metal, bark, foliage };
  return PBR;
}

/** A repeat-adjusted clone of a texture set (so one image can tile at different
 *  scales on different surfaces without fighting over `.repeat`). */
export function tileSet(set: TexSet, ru: number, rv = ru): TexSet {
  const diff = set.diff.clone();
  const nor = set.nor.clone();
  const arm = set.arm ? set.arm.clone() : undefined;
  diff.repeat.set(ru, rv);
  nor.repeat.set(ru, rv);
  diff.anisotropy = ANISO; // crisp at grazing angles (road/ground into the distance)
  nor.anisotropy = ANISO;
  diff.needsUpdate = true;
  nor.needsUpdate = true;
  if (arm) {
    arm.repeat.set(ru, rv);
    arm.anisotropy = ANISO;
    arm.needsUpdate = true;
  }
  return { diff, nor, arm };
}

// Procedural material maps — colour + bump — so surfaces read as textured
// (metal panels, asphalt grain, terrain, stone) and catch light with relief,
// instead of flat solid colours. Bump maps are grayscale height (white = high);
// MeshStandard/Phong perturb the shading from them.

function makeCanvas(w: number, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d")! };
}

function rng(seed: number) {
  let s = seed || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

function toTex(c: HTMLCanvasElement, repeat = 1, srgb = false) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = ANISO;
  return t;
}

// ---------------------------------------------------------------------------
// brushed-metal panels for the cars (grayscale → multiplies the livery colour)
// ---------------------------------------------------------------------------
let metalCache: { map: THREE.Texture; bump: THREE.Texture } | null = null;

export function metalDetail(): { map: THREE.Texture; bump: THREE.Texture } {
  if (metalCache) return metalCache;
  const S = 256;
  const rnd = rng(4711);

  // colour map: light grey base + brushed streaks + faint panel seams + rivets
  const { c, ctx } = makeCanvas(S);
  ctx.fillStyle = "#e9e9ef";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2200; i++) {
    const x = rnd() * S, y = rnd() * S, w = 8 + rnd() * 46;
    const light = rnd() < 0.5;
    ctx.strokeStyle = light ? `rgba(255,255,255,${rnd() * 0.09})` : `rgba(40,40,60,${rnd() * 0.09})`;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(30,30,45,0.35)";
  ctx.lineWidth = 2;
  for (let g = 0; g <= S; g += 64) {
    ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(S, g); ctx.stroke();
  }
  ctx.fillStyle = "rgba(20,20,35,0.5)";
  for (let gx = 0; gx <= S; gx += 64) for (let gy = 0; gy <= S; gy += 64) {
    ctx.beginPath(); ctx.arc(gx, gy, 2.2, 0, Math.PI * 2); ctx.fill();
  }

  // bump: recessed seams + raised rivets on a mid-grey field
  const { c: cb, ctx: bx } = makeCanvas(S);
  bx.fillStyle = "#8a8a8a"; bx.fillRect(0, 0, S, S);
  bx.strokeStyle = "#454545"; bx.lineWidth = 4;
  for (let g = 0; g <= S; g += 64) {
    bx.beginPath(); bx.moveTo(g, 0); bx.lineTo(g, S); bx.stroke();
    bx.beginPath(); bx.moveTo(0, g); bx.lineTo(S, g); bx.stroke();
  }
  bx.fillStyle = "#dcdcdc";
  for (let gx = 0; gx <= S; gx += 64) for (let gy = 0; gy <= S; gy += 64) {
    bx.beginPath(); bx.arc(gx, gy, 3.2, 0, Math.PI * 2); bx.fill();
  }

  metalCache = { map: toTex(c, 1, true), bump: toTex(cb, 1, false) };
  return metalCache;
}

// ---------------------------------------------------------------------------
// grayscale bump helpers for large surfaces
// ---------------------------------------------------------------------------

/** Speckled aggregate bump for asphalt. */
export function asphaltBump(): THREE.Texture {
  const S = 512;
  const { c, ctx } = makeCanvas(S);
  const rnd = rng(99);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const g = rnd() < 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${g},${g},${g},${rnd() * 0.5})`;
    const r = 1 + rnd() * 2.4;
    ctx.fillRect(rnd() * S, rnd() * S, r, r);
  }
  return toTex(c, 1, false);
}

/** Lumpy terrain bump (grass/dirt clumps). */
export function terrainBump(tile: number): THREE.Texture {
  const S = 256;
  const { c, ctx } = makeCanvas(S);
  const rnd = rng(3163);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rnd() < 0.5;
    g.addColorStop(0, light ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)");
    g.addColorStop(1, "rgba(128,128,128,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 3000; i++) {
    const v = rnd() < 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${rnd() * 0.3})`;
    ctx.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  return toTex(c, tile, false);
}

/** Cracked-stone colour + bump for rocks/crystals. */
export function stoneMaps(hex: number): { map: THREE.Texture; bump: THREE.Texture } {
  const S = 128;
  const base = new THREE.Color(hex);
  const rnd = rng(hex || 17);

  const { c, ctx } = makeCanvas(S);
  ctx.fillStyle = "#" + base.getHexString();
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 500; i++) {
    const shade = base.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.3);
    ctx.fillStyle = "#" + shade.getHexString();
    ctx.globalAlpha = 0.25 + rnd() * 0.4;
    const r = 2 + rnd() * 8;
    ctx.beginPath(); ctx.arc(rnd() * S, rnd() * S, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  const { c: cb, ctx: bx } = makeCanvas(S);
  bx.fillStyle = "#8a8a8a"; bx.fillRect(0, 0, S, S);
  for (let i = 0; i < 400; i++) {
    const v = rnd() < 0.5 ? 210 : 50;
    bx.fillStyle = `rgba(${v},${v},${v},${rnd() * 0.5})`;
    bx.beginPath(); bx.arc(rnd() * S, rnd() * S, 2 + rnd() * 6, 0, Math.PI * 2); bx.fill();
  }
  // a few dark cracks
  bx.strokeStyle = "rgba(20,20,20,0.7)";
  bx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    let x = rnd() * S, y = rnd() * S;
    bx.beginPath(); bx.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.5) * 30; bx.lineTo(x, y); }
    bx.stroke();
  }
  return { map: toTex(c, 1, true), bump: toTex(cb, 1, false) };
}

/**
 * Recolour a photographic albedo through a three-stop ramp, keeping its detail.
 *
 * Ten of the seventeen realms borrow another realm's ground photo and recolour
 * it with `color: groundTint` — which is a MULTIPLY, and a multiply can only
 * darken. It cannot move a hue. The code already admitted this in a comment:
 * the coast road could not use the forest albedo because "forest tinted straw
 * stays GREEN". So every realm that is not Enchanted Forest or Ember Wastes
 * ends up standing on the same pale rock: snow, sand, red desert, dusty
 * waterfront and a night city, all one photograph with the brightness turned
 * down.
 *
 * This maps the source's LUMINANCE through the realm's own dark → base →
 * speck ramp, which every realm already carries (they were written for the
 * procedural fallback and never used on the PBR path). Grain, cracks and
 * variation all survive because they live in the luminance; the colour is
 * replaced outright, so snow can be white with cool shadows and the desert
 * can be genuinely red.
 *
 * The source's own luminance range is measured and stretched first. A rock
 * photo occupies maybe 0.25-0.75 of the range, and feeding that straight into
 * a ramp would use only the middle of it and come out flat.
 */
export function recolourAlbedo(
  src: THREE.Texture, dark: THREE.Color, base: THREE.Color, speck: THREE.Color,
): THREE.Texture | null {
  const img = src.image as (HTMLImageElement | ImageBitmap | null);
  if (!img || !(img as HTMLImageElement).width) return null;
  const w = (img as HTMLImageElement).width, h = (img as HTMLImageElement).height;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img as CanvasImageSource, 0, 0);
  let px: ImageData;
  try {
    px = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;                 // tainted canvas — leave the original alone
  }
  const d = px.data;

  // luminance histogram, so the ramp uses the photo's actual range
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  }
  const total = w * h;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.02) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.02) { hi = i; break; } }
  const span = Math.max(1, hi - lo);

  // THE RAMP HAS TO BE IN sRGB BYTES.
  //
  // `new THREE.Color(0xd9b47e)` does not store 0xd9b47e: with colour management
  // on, the constructor converts that sRGB hex into the LINEAR working space,
  // so `.r/.g/.b` come out around 0.71/0.46/0.22 rather than 0.85/0.71/0.49.
  // Writing those straight into an 8-bit canvas treats linear values as sRGB
  // ones, which darkens and over-saturates everything. Measured: Mirage Mile
  // asked for #d9b47e and the ground came out #bf8540. `getHex(SRGBColorSpace)`
  // asks for the number back in the space it was written in.
  const bytes = (c: THREE.Color) => {
    const hex = c.getHex(THREE.SRGBColorSpace);
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  };
  const [dr, dg, db] = bytes(dark);
  const [br, bg, bb] = bytes(base);
  const [sr, sg, sb] = bytes(speck);

  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const t = Math.max(0, Math.min(1, (lum - lo) / span));
    // dark → base over the lower half, base → speck over the upper
    if (t < 0.5) {
      const k = t * 2;
      d[i] = dr + (br - dr) * k;
      d[i + 1] = dg + (bg - dg) * k;
      d[i + 2] = db + (bb - db) * k;
    } else {
      const k = (t - 0.5) * 2;
      d[i] = br + (sr - br) * k;
      d[i + 1] = bg + (sg - bg) * k;
      d[i + 2] = bb + (sb - bb) * k;
    }
  }
  ctx.putImageData(px, 0, 0);

  const out = new THREE.CanvasTexture(c);
  out.wrapS = out.wrapT = THREE.RepeatWrapping;
  out.colorSpace = THREE.SRGBColorSpace;
  out.anisotropy = ANISO;
  out.needsUpdate = true;
  return out;
}
