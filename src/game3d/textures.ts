import * as THREE from "three";

// ---------------------------------------------------------------------------
// real CC0 PBR textures (Poly Haven) — loaded from /public/textures
// ---------------------------------------------------------------------------

export interface TexSet { diff: THREE.Texture; nor: THREE.Texture; }
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
  const [diff, nor] = await Promise.all([
    loader.loadAsync(`/textures/${name}_diff.jpg`),
    loader.loadAsync(`/textures/${name}_nor.jpg`),
  ]);
  diff.colorSpace = THREE.SRGBColorSpace;
  nor.colorSpace = THREE.NoColorSpace;
  for (const t of [diff, nor]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  const set: TexSet = { diff, nor };
  setCache.set(name, set);
  return set;
}

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
  diff.repeat.set(ru, rv);
  nor.repeat.set(ru, rv);
  diff.anisotropy = 8;   // crisp at grazing angles (road/ground into the distance)
  nor.anisotropy = 8;
  diff.needsUpdate = true;
  nor.needsUpdate = true;
  return { diff, nor };
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
  t.anisotropy = 8;
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
