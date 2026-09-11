import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ROAD_HALF_WIDTH } from "./constants";
import { terrainBump, stoneMaps, pbr, tileSet } from "./textures";
import type { RealmPalette } from "./realms";
import type { RealmId } from "../game/engine";
import type { CarId } from "./cars";
import { CAR_SPECS } from "./carData";

/** Shared wind clock driving the foliage sway (the engine advances .value). */
export const windTime = { value: 0 };

/** Inject a gentle world-space wind sway into a foliage material's vertex stage:
 *  leaves higher up sway more, phase varies by world position so trees don't
 *  move in lockstep. Kept small so it reads as a breeze, not jelly. */
function applyFoliageWind(mat: THREE.Material) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = windTime;
    shader.vertexShader =
      "uniform float windTime;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         // The sway PHASE comes from world position so neighbouring trees move
         // out of step. For an InstancedMesh modelMatrix is shared by every
         // instance, so without folding in instanceMatrix the whole forest sways
         // in perfect unison — which reads as one giant object breathing.
         #ifdef USE_INSTANCING
           vec3 wpos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
         #else
           vec3 wpos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         #endif
         float sway = sin(windTime * 1.3 + wpos.x * 0.14 + wpos.z * 0.1);
         float gust = sin(windTime * 0.7 + wpos.z * 0.08) * 0.5 + 0.5;
         float amt = max(transformed.y, 0.0) * 0.045 * (0.6 + gust);
         transformed.x += sway * amt;
         transformed.z += cos(windTime * 1.1 + wpos.z * 0.12) * amt * 0.7;`
      );
  };
}

// --- sky ------------------------------------------------------------------

type Rgb = [number, number, number];

/** sRGB byte triple from a "#rrggbb" string or a 0xrrggbb number. The sky canvas
 *  is tagged sRGB, so all of its mixing is done in plain byte space. */
function rgb255(c: string | number): Rgb {
  const h = typeof c === "number" ? c : parseInt(c.slice(1), 16);
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}
function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function rgbaCss(c: Rgb, a: number): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a.toFixed(3)})`;
}

/** A 64x64 wrapping value-noise lattice (power of two so the wrap is a mask).
 *  One deterministic table shared by every octave — no dependencies, and the
 *  wrap means cloud shapes tile seamlessly all the way around the dome. */
const NOISE_N = 64;
let _noiseLattice: Float32Array | null = null;
function noiseLattice(): Float32Array {
  if (_noiseLattice) return _noiseLattice;
  const t = new Float32Array(NOISE_N * NOISE_N);
  let s = 20250101;
  for (let i = 0; i < t.length; i++) {
    s = (s * 16807) % 2147483647;
    t[i] = s / 2147483647;
  }
  return (_noiseLattice = t);
}

/** Smoothstep-interpolated value noise sampled off the shared lattice. */
function valueNoise(t: Float32Array, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const M = NOISE_N - 1;
  const x0 = xi & M, x1 = (xi + 1) & M;
  const r0 = (yi & M) * NOISE_N, r1 = ((yi + 1) & M) * NOISE_N;
  const top = t[r0 + x0] + (t[r0 + x1] - t[r0 + x0]) * sx;
  const bot = t[r1 + x0] + (t[r1 + x1] - t[r1 + x0]) * sx;
  return top + (bot - top) * sy;
}

/**
 * A procedural cloud deck for the sky dome, returned as a transparent overlay.
 *
 * The clouds are fBm noise living on a FLAT PLANE floating above the camera,
 * projected into the dome's equirectangular canvas: a pixel at elevation `el`
 * looks through the plane at ground distance `r = 1/tan(el)`, so the same cloud
 * shapes stretch overhead and compress/converge as they near the horizon. That
 * is real cloud perspective for the price of one sin/cos per pixel, and it is
 * what makes the sky read as a ceiling with depth rather than a painted band.
 *
 * Two details that matter:
 *  - Octaves are faded out as the projected footprint of an output row grows,
 *    so the far deck dissolves into smooth haze instead of hash-noise speckle
 *    (the same reason mipmaps exist).
 *  - Drawn at a QUARTER of the dome resolution and bilinearly upscaled. Cloud
 *    edges are soft anyway, and it cuts the one-time build cost 16x. `putImage`
 *    premultiplies, so the upscale can't produce dark edge fringes.
 *
 * Colours come from the realm palette (lit tops from the horizon glow, shaded
 * bases from the mid sky), so a green forest sky gets green clouds and a desert
 * sky cream ones — the per-realm identity survives.
 */
/**
 * Poster clouds: flat lozenges in three hard tones, drawn as VECTORS.
 *
 * The noise deck below is the wrong tool for this art direction and no amount
 * of resolution fixes it. fBm gives you a soft probability field; smoothstep
 * the alpha and you get a gradient, which upscaled onto the biggest surface on
 * screen is the "blurry, lifeless" sky. The reference paints clouds as cut
 * shapes — a flat lit top, a flat mid band, a flat shaded underside, hard edge
 * all the way round, arranged in rows that compress toward the horizon. Canvas
 * ellipse fills give exactly that at any resolution, for a fraction of the
 * cost of per-pixel noise.
 */
function posterClouds(pal: RealmPalette, W: number, H: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const HZ = H / 2;
  let sd = 20260911;
  const rand = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };

  const sky1 = rgb255(pal.sky[1]), sky2 = rgb255(pal.sky[2]), sky3 = rgb255(pal.sky[3]);
  const lit = mixRgb(sky3, [255, 255, 255], 0.74);
  const mid = mixRgb(sky2, [255, 255, 255], 0.46);
  const shade = mixRgb(sky1, sky2, 0.5);

  /**
   * One cumulus: a FLAT BASE with a row of circular lobes on top. That flat
   * bottom is the whole silhouette — a cloud built from a row of ellipses (what
   * this used to do) is lumpy on both sides and reads as a smudge, because a
   * real cloud's base is where the air hits its condensation level and is
   * dead level across the whole thing.
   */
  const cumulus = (x: number, y: number, w: number, h: number, lobes: number, fill: string, lift: number) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    for (let i = 0; i < lobes; i++) {
      const t = (i + 0.5) / lobes;
      // tallest lobes in the middle of the cloud, smaller at the shoulders
      const r = (w / lobes) * (0.95 + 1.15 * Math.sin(Math.PI * t)) * lift;
      const cx = x - w + 2 * w * t;
      ctx.arc(cx, y - Math.min(h, r) * 0.22, Math.min(r, h * 1.5), Math.PI, 0);
    }
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
  };

  // Rows all the way from just off the horizon to overhead. Previously these
  // stopped at 53 degrees, which put every cloud in one band hugging the
  // horizon where they merged into mush, and left the zenith completely bare.
  const ROWS = 15;
  for (let r = 0; r < ROWS; r++) {
    const f = r / (ROWS - 1);
    const el = 0.05 + Math.pow(f, 1.35) * 1.42;            // radians above horizon
    const y = HZ - (el / (Math.PI / 2)) * HZ;
    // Density peaks at mid elevation. Packing the horizon rows is what made the
    // haze band: at 2 degrees up you are looking through 30 km of cloud deck,
    // so they overlap into a solid smear rather than reading as clouds.
    const dens = Math.sin(Math.PI * Math.min(1, 0.12 + f * 0.88));
    // Small and many. At the old scale one cloud filled a quarter of the
    // screen from the chase camera — the dome is only 880 m out, so texture
    // space maps to a LOT of screen. Reference skies put dozens of small crisp
    // cumulus across the frame, not three billboards.
    const count = Math.max(6, Math.round(30 * dens));
    const hBase = H * 0.0125 * (0.35 + el * 0.8);
    const wBase = W * 0.0125 * (1.5 - el * 0.42);
    for (let i = 0; i < count; i++) {
      const x = (i / count) * W + rand() * (W / count);
      const k = rand() < 0.45 ? 0.4 + rand() * 0.3 : 0.75 + rand() * 0.6;
      // higher rows must be NARROWER on the canvas: the equirect wraps W texels
      // around a circle that shrinks toward the pole, so a puff of fixed canvas
      // width covers more and more azimuth as it climbs
      const w = wBase * k * (1 - 0.5 * f);
      const h = hBase * (0.7 + rand() * 0.7);
      const lobes = 2 + Math.floor(rand() * 3);
      const yj = (rand() - 0.5) * (HZ / ROWS) * 0.9;
      const yy = y + yj;
      // shaded underside: the same flat base, sitting a little proud below
      cumulus(x, yy + h * 0.1, w, h * 0.55, lobes, rgbaCss(shade, 0.92), 0.8);
      // main body
      cumulus(x, yy, w, h, lobes, rgbaCss(mid, 0.97), 1);
      // sunlit crown, inset and raised so it catches only the tops
      cumulus(x + w * 0.06, yy - h * 0.2, w * 0.78, h * 0.85, lobes, rgbaCss(lit, 1), 1);
    }
  }
  return c;
}

function cloudDeck(pal: RealmPalette, W: number, H: number): HTMLCanvasElement {
  // HALF the dome resolution, not a quarter. At a quarter the deck was 512x256
  // upscaled 4x with smoothing onto the biggest surface on screen, which is
  // precisely why the sky read as blurry — every cloud edge was 4 px of
  // interpolation. Half costs 4x the noise work once, at build time.
  const CW = W >> 1, CH = H >> 1;
  const cc = document.createElement("canvas");
  cc.width = CW;
  cc.height = CH;
  const cx = cc.getContext("2d")!;
  const img = cx.createImageData(CW, CH);
  const d = img.data;
  const lat = noiseLattice();

  // Starry realms are the night/space ones: thin, sparse wisps that let the
  // starfield through. Daylit realms get a proper covered deck.
  const night = pal.stars;
  const poster = !!pal.posterSun;
  const lit = mixRgb(rgb255(pal.sky[3]), [255, 255, 255], night ? 0.26 : 0.55);
  const shade = mixRgb(rgb255(pal.sky[1]), rgb255(pal.sky[2]), 0.55);
  const cover = night ? 0.54 : 0.46;   // noise level above which there IS cloud
  const peak = night ? 0.50 : 0.92;    // opacity of a fully thick core
  // fBm of value noise clusters tightly around 0.5, so the 0..1 opacity ramp is
  // spread over a narrow SPAN above `cover` rather than over (1 - cover) — with
  // the full range the deck never got past a translucent smear.
  const SPAN = 0.16;
  const R_FADE = 40;                   // deck distance at which cloud gives way to haze

  // 2.6 cycles per deck height: fine enough that even the near-zenith pixels
  // (which look through only a tiny patch of the deck) see real structure
  // instead of one flat noise value.
  const F0 = 2.6, OCT = 4;
  for (let y = 0; y < CH; y++) {
    const v = (y + 0.5) / CH;                 // 0 = zenith, 0.5 = horizon
    const el = (0.5 - v) * Math.PI;           // elevation above the horizon
    if (el <= 0.012) continue;                // at/below the horizon the haze takes over
    const sinEl = Math.sin(el);
    const r = Math.cos(el) / sinEl;           // 1/tan(el): distance out to the deck
    if (r > R_FADE) continue;
    // how much of the deck one output row covers here — the anti-alias budget
    const foot = Math.PI / (sinEl * sinEl * CH);
    // Thins to a 32% veil directly overhead and builds to a full deck by r=3
    // (~18 degrees up), then eases away into the haze band: "denser near the
    // horizon, thinning over your head". The floor is deliberately not 0 — a
    // hard-clear zenith looked like the clouds had been cropped off.
    const dens = (0.32 + 0.68 * Math.min(1, r / 3)) * Math.min(1, (R_FADE - r) / 14);
    for (let x = 0; x < CW; x++) {
      const az = (x / CW) * Math.PI * 2;
      // deck coordinates; azimuth is squashed so shapes stretch into cloud streets
      const px = r * Math.cos(az) * 0.6, py = r * Math.sin(az);
      let n = 0, norm = 0, amp = 0.5, f = F0;
      for (let o = 0; o < OCT; o++) {
        const w = Math.min(1, 1 / (f * 2 * foot)); // drop octaves finer than a row
        if (w > 0.02) {
          n += valueNoise(lat, px * f, py * f) * amp * w;
          norm += amp * w;
        }
        amp *= 0.5;
        f *= 2.1;
      }
      if (norm <= 0) continue;
      n /= norm;
      // one slow sine gathers the fBm into stratus BANDING instead of even mush
      n = n * 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(py * 0.5 + n * 5));
      let a = (n - cover) / SPAN;
      if (a <= 0) continue;
      a = Math.min(1, a);
      // Poster realms get HARD edges: the 80s city-pop reference paints clouds
      // as flat cut shapes with two or three tone steps, so the alpha ramp is
      // quantised instead of smoothstepped. A soft gradient is what makes a
      // stylised sky look like a low-res photograph of nothing.
      a = poster
        ? Math.ceil(Math.min(1, a * 1.25) * 3) / 3 * peak * dens
        : a * a * (3 - 2 * a) * peak * dens;
      let t = Math.min(1, a / (peak * 0.7)); // thick cores catch the light
      if (poster) t = Math.round(t * 2) / 2;  // two flat tones: lit top, shaded base
      const o4 = (y * CW + x) * 4;
      d[o4] = shade[0] + (lit[0] - shade[0]) * t;
      d[o4 + 1] = shade[1] + (lit[1] - shade[1]) * t;
      d[o4 + 2] = shade[2] + (lit[2] - shade[2]) * t;
      d[o4 + 3] = a * 255;
    }
  }
  cx.putImageData(img, 0, 0);
  return cc;
}

/**
 * The realm's sky as a single equirectangular texture on a BackSide dome:
 * palette gradient, starfield, moons, a sun-side glow, a perspective cloud deck
 * and a horizon haze band. Everything is baked ONCE here at world-build time —
 * nothing about the sky is regenerated per frame.
 */
export function makeSkyDome(pal: RealmPalette): THREE.Mesh {
  // 2048x1024. The dome is the single largest thing on screen and 1024x512 was
  // showing gradient banding + mushy stars; the cloud deck is generated at a
  // quarter of this and upscaled, so the extra detail is nearly free to build.
  const W = 2048, H = 1024;
  const S = W / 1024;   // the palette's moon/star coords are authored for 1024px
  const HZ = H / 2;     // the horizon: on a full sphere it is the canvas' MIDDLE row
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  const sky3 = rgb255(pal.sky[3]);
  const fog = rgb255(pal.fog);

  // --- base gradient --------------------------------------------------------
  // The dome is a whole sphere, so the canvas' bottom half points at the GROUND
  // and only the top half is sky. The palettes author sky[3] as the bright
  // horizon glow, so it is placed at HZ where it can actually be seen (it used
  // to land on the bottom pole, straight down, permanently hidden under the
  // terrain, which is why the visible sky was only ever a two-stop wash).
  // Below the horizon the dome fades into the realm's own fog colour, so the
  // sky and the fogged-out distance meet without a seam.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.00, pal.sky[0]);
  grad.addColorStop(0.30, pal.sky[1]);
  grad.addColorStop(0.44, pal.sky[2]);
  grad.addColorStop(0.50, pal.sky[3]);
  grad.addColorStop(0.60, rgbaCss(mixRgb(sky3, fog, 0.7), 1));
  grad.addColorStop(1.00, rgbaCss(mixRgb(fog, [0, 0, 0], 0.45), 1));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // POSTER REALMS: step the sky above the horizon into flat bands.
  // A continuous gradient has no edges in it, and a surface with no edges
  // reads as out of focus however many pixels you give it — which is why
  // bumping the dome resolution didn't fix "the sky is blurry". Screen-printed
  // sunset art works in discrete bands, so this quantises the same palette
  // into 16 of them, packed tighter toward the horizon where the colour is
  // changing fastest.
  if (pal.posterSun) {
    // Bands are EVEN IN ELEVATION ANGLE, which for an equirect means even in v.
    // The previous pow(t, 0.68) made them widest at the zenith, where the
    // equirect's latitude circles converge — so they came out as concentric
    // rings around the pole, like a target. And banding stops before the top
    // 18%: nothing hides pole convergence except not drawing an edge there.
    const BANDS = 26, TOP = 0.18;
    const img = ctx.getImageData(0, 0, 1, H).data;   // sample the gradient we just laid
    for (let b = 0; b < BANDS; b++) {
      const t0 = b / BANDS, t1 = (b + 1) / BANDS;
      if (t1 <= TOP) continue;
      const y0 = Math.round(Math.max(t0, TOP) * HZ), y1 = Math.round(t1 * HZ);
      if (y1 <= y0) continue;
      const sy = Math.min(H - 1, Math.round((y0 + y1) / 2)) * 4;
      ctx.fillStyle = `rgb(${img[sy]},${img[sy + 1]},${img[sy + 2]})`;
      ctx.fillRect(0, y0, W, y1 - y0);
    }
  }

  // faint upper-atmosphere deepening at the zenith so the dome doesn't read as
  // a flat wall of colour overhead (Rayleigh-ish: thinnest air is darkest)
  const zen = ctx.createLinearGradient(0, 0, 0, HZ * 0.8);
  zen.addColorStop(0, "rgba(0,0,0,0.16)");
  zen.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = zen;
  ctx.fillRect(0, 0, W, HZ * 0.8);

  // --- starfield (drawn early so clouds and haze pass in FRONT of it) -------
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  if (pal.stars) {
    // soft round stars — small, mostly dim, a few brighter. Radii scale with the
    // canvas so they keep the same ANGULAR size as before the resolution bump.
    for (let i = 0; i < 340; i++) {
      const x = rand() * W;
      const y = rand() * HZ * 0.96;   // kept above the horizon
      const bright = rand();
      const r = (bright > 0.92 ? 1.4 + rand() * 1.2 : 0.5 + rand() * 0.9) * S;
      const a = 0.18 + bright * 0.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
      g.addColorStop(0, `rgba(255,255,255,${a.toFixed(2)})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      // the handful of brightest stars get a small cross flare, which is what
      // separates "starfield" from "grey speckle" at a glance
      if (bright > 0.975) {
        const fl = r * 7;
        const cg = ctx.createLinearGradient(x - fl, y, x + fl, y);
        cg.addColorStop(0, "rgba(255,255,255,0)");
        cg.addColorStop(0.5, `rgba(255,255,255,${(a * 0.7).toFixed(2)})`);
        cg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = cg;
        ctx.fillRect(x - fl, y - r * 0.35, fl * 2, r * 0.7);
        ctx.fillRect(x - r * 0.35, y - fl, r * 0.7, fl * 2);
      }
    }
  }

  for (const m of pal.moons) {
    const mx = m.x * S, my = m.y * S, mr = m.r * S;
    const halo = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 2.4);
    halo.addColorStop(0, "rgba(255,255,255,0.3)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(mx, my, mr * 2.4, 0, Math.PI * 2);
    ctx.fill();
    const face = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.2, mx, my, mr);
    face.addColorStop(0, "#ffffff");
    face.addColorStop(1, m.tint);
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- the sun ---------------------------------------------------------------
  // Placed at the SAME direction the HDR probe puts its sun (makeEnvMap's
  // sunU/sunV), so the bright side of the sky agrees with where reflections and
  // shadows say the light comes from.
  //
  // Realms flagged `posterSun` get a big HARD-EDGED disc sitting just above the
  // horizon. That single flat circle is the signature of the 80s city-pop poster
  // look — the sun is a shape, not a glare — so it deliberately breaks the
  // "disc-less" rule the glow below follows for the naturalistic realms.
  const sun = rgb255(pal.sun);
  if (pal.posterSun) {
    const sx = 0.62 * W, sy = HZ - H * 0.075, sr = W * 0.052;
    // NO broad bloom. A 6.5-radius soft halo is a blur the width of the sky.
    // the disc itself: flat, hard-edged, near-white at the core
    const face = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    face.addColorStop(0, rgbaCss(mixRgb(sun, [255, 255, 255], 0.75), 1));
    face.addColorStop(0.82, rgbaCss(mixRgb(sun, [255, 255, 255], 0.35), 1));
    face.addColorStop(1, rgbaCss(sun, 1));
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // These two are the actual reason the poster sky kept coming back "blurry".
  // They are radial gradients 0.62 and 0.95 of the dome HEIGHT across, painted
  // over the whole upper sky at 0.30 and 0.22 alpha — i.e. a soft white bloom
  // covering everything, applied AFTER the band quantisation, which erased it.
  // Naturalistic realms want them. A screen-printed sunset does not: there the
  // sun is a shape with a tight ring, and the sky around it is flat colour.
  if (pal.posterSun) {
    // A TIGHT falloff, not stacked hard rings. Three flat discs at 1.55x, 2.2x
    // and 3.1x the sun's radius drew three visible circular edges in the sky —
    // on Mirage Mile it read as a giant ring hanging over the desert. Crispness
    // has to come from the sun's own edge and from the band steps; the glow
    // immediately around it is the one place a gradient belongs.
    const sx = 0.62 * W, sy = HZ - H * 0.075, sr = W * 0.052;
    const halo = ctx.createRadialGradient(sx, sy, sr * 0.95, sx, sy, sr * 2.6);
    halo.addColorStop(0, rgbaCss(sun, 0.34));
    halo.addColorStop(0.45, rgbaCss(sun, 0.12));
    halo.addColorStop(1, rgbaCss(sun, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 2.6, 0, Math.PI * 2);
    ctx.fill();
  } else for (const [gx, gy, gr, ga] of [
    [0.62 * W, 0.18 * H, HZ * 0.62, pal.stars ? 0.16 : 0.30],  // the sun itself
    [0.62 * W, HZ, HZ * 0.95, pal.stars ? 0.10 : 0.22],        // its haze on the horizon
  ] as const) {
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, rgbaCss(mixRgb(sun, [255, 255, 255], 0.4), ga));
    g.addColorStop(0.45, rgbaCss(sun, ga * 0.35));
    g.addColorStop(1, rgbaCss(sun, 0));
    ctx.fillStyle = g;
    ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
  }

  // NOTE: the cloud deck is NOT baked in here any more — see makeCloudLayer.
  // Baked into the same texture as the sun and the gradient, the clouds could
  // never move, and a sky that never moves is a painted backdrop. They now
  // live on their own dome that rotates.

  // --- horizon haze ---------------------------------------------------------
  // The depth cue that makes the world feel like it has atmosphere: a wide glow
  // rising off the horizon plus a tight bright core right on it, drawn LAST so
  // it sits in front of the clouds, moons and stars the way real haze does.
  // Night realms get a softer version so the starfield still reads.
  // Scaled by how bright the realm's horizon colour already is: a near-white
  // horizon (circuit, sands) has no headroom left, and pushing haze onto it
  // just clipped the whole band to flat white and erased the cloud bases.
  // Dark realms get the full glow, which is where it reads as depth.
  // Poster realms get a much weaker haze band: it is a soft vertical gradient
  // laid over the horizon, i.e. exactly the thing that was smearing the hard
  // band edges back out again.
  const hazeK = pal.posterSun ? 0.25 : 1;
  const lum3 = (0.299 * sky3[0] + 0.587 * sky3[1] + 0.114 * sky3[2]) / 255;
  const hazeCol = mixRgb(sky3, [255, 255, 255], (pal.stars ? 0.22 : 0.42) * (1 - lum3));
  const hA = (pal.stars ? 0.42 : 0.62) * (1 - 0.72 * lum3) * hazeK;
  const y0 = HZ - H * 0.22, y1 = HZ + H * 0.18;
  const hg = ctx.createLinearGradient(0, y0, 0, y1);
  hg.addColorStop(0.00, rgbaCss(hazeCol, 0));
  hg.addColorStop(0.45, rgbaCss(hazeCol, hA * 0.32));
  hg.addColorStop(0.55, rgbaCss(hazeCol, hA));         // the horizon line itself
  hg.addColorStop(0.70, rgbaCss(hazeCol, hA * 0.7));
  hg.addColorStop(1.00, rgbaCss(hazeCol, 0));
  ctx.fillStyle = hg;
  ctx.fillRect(0, y0, W, y1 - y0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // 48x24 (was 32x16): still a rounding error in tri count, but it keeps the
  // equirect UVs from visibly kinking the new horizon band near the poles.
  const geo = new THREE.SphereGeometry(900, 48, 24);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.noShadow = true; // the sky must never cast or receive shadows
  return mesh;
}

/**
 * The cloud deck, on its own slightly smaller BackSide dome so the engine can
 * rotate it. Separating it from the sky is the whole point: rotating the sky
 * dome would drag the sun and the horizon haze round with it, and baking the
 * clouds into the sky texture meant they could never move at all.
 */
export function makeCloudLayer(pal: RealmPalette): THREE.Mesh {
  // Poster realms get 3072 wide and vector clouds drawn straight onto it at
  // full size — no generate-small-then-upscale step at all, which is where the
  // softness came from.
  const W = pal.posterSun ? 3072 : 2048, H = W / 2;
  let c: HTMLCanvasElement;
  if (pal.posterSun) {
    c = posterClouds(pal, W, H);
  } else {
    c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cloudDeck(pal, W, H), 0, 0, W, H);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  // depthTest MUST stay on. A transparent mesh is drawn in the transparent
  // pass, i.e. after every opaque object, and renderOrder only sorts it within
  // that pass — so with depthTest off this dome painted its blurry cloud
  // texture straight over the cars, the palms and the gantry. That is what
  // "why is the sky so blurry" actually was: the sky was on top of everything.
  const mat = new THREE.MeshBasicMaterial({
    map: tex, side: THREE.BackSide, fog: false,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(880, 48, 24), mat);
  mesh.userData.noShadow = true;
  mesh.renderOrder = -9;      // straight after the sky dome, before the world
  return mesh;
}

/**
 * An equirectangular sky→ground gradient for the realm, to be PMREM-processed
 * into the scene's environment map. It gives every standard material subtle
 * image-based lighting (a coloured sky bounce) and lets the wet road + props
 * catch real reflections — the same lift the cars got from their studio env.
 */
export function makeEnvMap(pal: RealmPalette): THREE.Texture {
  // A real HDR environment probe rather than a 256x128 sRGB canvas. Two things
  // matter for believable reflections: RESOLUTION (so PMREM has detail to blur
  // down per roughness) and genuine values ABOVE 1.0. An LDR canvas clamps at
  // white, so nothing could ever produce a hot specular glint — car paint, metal
  // and wet tarmac all looked like flat plastic. Here the sun is written at ~30x
  // white into a float buffer, which is what gives a crisp highlight that tracks
  // across the bodywork as you drive.
  const W = 512, H = 256;
  const data = new Float32Array(W * H * 4);
  const lin = (c: string | number) => new THREE.Color(c).convertSRGBToLinear();
  const stops: { at: number; c: THREE.Color }[] = [
    { at: 0.00, c: lin(pal.sky[0]) },
    { at: 0.32, c: lin(pal.sky[1]) },
    { at: 0.50, c: lin(pal.sky[2]) },   // horizon band
    { at: 0.54, c: lin(pal.sky[3]) },
    { at: 1.00, c: lin(pal.fog) },      // ground bounce
  ];
  const sample = (v: number, out: THREE.Color) => {
    let i = 0;
    while (i < stops.length - 2 && v > stops[i + 1].at) i++;
    const a = stops[i], b = stops[i + 1];
    const t = Math.max(0, Math.min(1, (v - a.at) / (b.at - a.at || 1)));
    out.copy(a.c).lerp(b.c, t);
  };

  // Sun placed to match the scene's key light elevation, so reflected highlights
  // agree with the direction things are actually lit + shadowed from.
  const sunU = 0.62, sunV = 0.18, sunR = 0.018, SUN = 30;
  const col = new THREE.Color();
  for (let y = 0; y < H; y++) {
    // `v` is measured from the ZENITH down (v=0 = straight up), matching the
    // stop table above. Rows are therefore filled bottom-up: a DataTexture
    // forces flipY=false (UNPACK_FLIP_Y_WEBGL is ignored for typed-array
    // uploads) and three's equirect sampler puts v_texture=1 at +Y, so row 0 is
    // straight DOWN. Indexing rows top-down here silently inverted the whole
    // probe — the sky lit surfaces from below, the ground bounce came from
    // above, and the sun's specular highlight sat UNDER the cars instead of
    // tracking across their bodywork.
    const v = 1 - y / (H - 1);
    sample(v, col);
    for (let x = 0; x < W; x++) {
      let r = col.r, g = col.g, b = col.b;
      // horizon sheen — a soft bright band for grazing specular on wet surfaces
      const band = Math.exp(-Math.pow((v - 0.5) / 0.035, 2)) * 0.5;
      r += band; g += band; b += band;
      // sun disc + wide falloff glow
      const du = Math.min(Math.abs(x / W - sunU), 1 - Math.abs(x / W - sunU));
      const dv = v - sunV;
      const d = Math.sqrt(du * du + dv * dv);
      if (d < sunR) {
        r += SUN; g += SUN * 0.97; b += SUN * 0.9;
      } else {
        const glow = Math.exp(-Math.pow(d / 0.11, 2)) * 1.6;
        r += glow; g += glow * 0.95; b += glow * 0.85;
      }
      const o = (y * W + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.NoColorSpace; // already linear HDR — must not be decoded
  tex.needsUpdate = true;
  return tex;
}


function hexStr(h: number): string {
  return "#" + (h & 0xffffff).toString(16).padStart(6, "0");
}

/** Soft light-shaft texture: a bright vertical beam that fades at its side edges
 *  and softly down its length (brightest near the sky). */
function shaftTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const hg = ctx.createLinearGradient(0, 0, 64, 0);
  hg.addColorStop(0, "rgba(255,255,255,0)");
  hg.addColorStop(0.5, "rgba(255,255,255,1)");
  hg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, 64, 256);
  ctx.globalCompositeOperation = "destination-in";
  const vg = ctx.createLinearGradient(0, 0, 0, 256);
  vg.addColorStop(0, "rgba(0,0,0,0.95)");
  vg.addColorStop(0.7, "rgba(0,0,0,0.45)");
  vg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, 64, 256);
  ctx.globalCompositeOperation = "source-over";
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Faint god-ray light shafts angled down from the sky, tinted to the realm sun.
 * Additive + very low opacity so they read as atmosphere/volumetric light, not
 * solid beams. Two crossed billboards per shaft so they hold up from any angle.
 */
export function makeLightShafts(pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();
  const color = new THREE.Color(pal.sun);
  const tex = shaftTexture();
  let seed = 90210;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 9; i++) {
    const h = 150 + rand() * 110;
    const w = 26 + rand() * 34;
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color, transparent: true, opacity: 0.1 + rand() * 0.09,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const a = new THREE.Mesh(geo, mat);
    const b = new THREE.Mesh(geo, mat);
    b.rotation.y = Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(a, b);
    // spread over and around the track so beams descend near the action
    holder.position.set((rand() * 2 - 1) * 470, h * 0.4 + 14, (rand() * 2 - 1) * 470);
    holder.rotation.z = (rand() * 2 - 1) * 0.22; // slight sun-angle lean
    holder.userData.noShadow = true;
    g.add(holder);
  }
  return g;
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
    // real per-texel roughness (ARM .g); base stays 1 so the map defines it
    if (t.arm) { mat.roughnessMap = t.arm; mat.roughness = 1; mat.aoMap = t.arm; mat.aoMapIntensity = 0.85; }
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

/** A tuft of real grass BLADES.
 *
 *  The old grass was `ConeGeometry(0.16, 0.7, 4)` — a four-sided cone, i.e. a
 *  literal little green pyramid, thousands of them. That's the "childish
 *  pyramids" look. Actual grass reads as a cluster of thin blades that taper and
 *  lean, so that's what this builds: three blades splayed around the base, each
 *  a tapered strip curving over. Unit height, so the per-instance scale decides
 *  how tall each tuft stands. 18 triangles a tuft, and the whole field is still
 *  ONE instanced draw call. */
function bladeTuft(): THREE.BufferGeometry {
  const pos: number[] = [];
  const SEG = 2, BLADES = 5;
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + 0.4;
    const ca = Math.cos(a), sa = Math.sin(a);
    const lean = 0.16 + b * 0.05;          // each blade flops a little differently
    const pt = (x: number, y: number, w: number) => [x * ca - w * sa, y, x * sa + w * ca];
    for (let sg = 0; sg < SEG; sg++) {
      const t0 = sg / SEG, t1 = (sg + 1) / SEG;
      const w0 = 0.075 * (1 - t0) + 0.005;  // wide at the root, a point at the tip
      const w1 = 0.075 * (1 - t1) + 0.005;
      const x0 = lean * t0 * t0, x1 = lean * t1 * t1; // quadratic curve = a natural droop
      const A = pt(x0, t0, -w0), B = pt(x0, t0, w0), C = pt(x1, t1, w1), D = pt(x1, t1, -w1);
      pos.push(...A, ...B, ...C, ...A, ...C, ...D);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function makeGrassField(pal: RealmPalette, pts: Placement[]): THREE.InstancedMesh {
  const geo = bladeTuft();
  // blades are thin strips, so they must be lit from both faces
  const mat = new THREE.MeshLambertMaterial({ color: pal.clutter, side: THREE.DoubleSide });
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
    // Unit-height geometry, so this is where a tuft's real size is decided.
    // Grass is ankle-to-knee high: anything approaching a metre reads as an
    // alien plant. Width is pulled in too so a tuft is a clump, not a fan.
    s.set(pt.s * 0.5, pt.s * (0.30 + Math.random() * 0.28), pt.s * 0.5);
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
      map: t.diff, normalMap: t.nor, normalScale: new THREE.Vector2(1.4, 1.4),
      color: 0x8a8a8a, metalness: 0.12, roughness: 0.82,
      flatShading: true, vertexColors: true, envMapIntensity: 0.55,
    });
    if (t.arm) { mat.roughnessMap = t.arm; mat.roughness = 1; mat.aoMap = t.arm; mat.aoMapIntensity = 0.85; }
  } else {
    const stone = stoneMaps(pal.mountainDark);
    mat = new THREE.MeshStandardMaterial({
      color: pal.mountainDark, map: stone.map, bumpMap: stone.bump, bumpScale: 0.28,
      metalness: 0.12, roughness: 0.82, flatShading: true, vertexColors: true, envMapIntensity: 0.55,
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

/** A low-poly "brilliant cut" jewel silhouette: a hexagonal pavilion tapering
 *  to a point, a girdle, and a short crown rising to a flat table facet —
 *  merged into one non-indexed buffer (same trick as boulderGeometry) so a
 *  single flat-shaded material reads as an actual cut gem instead of a
 *  stretched octahedron. */
function gemGeometry(girdleR: number, pavH: number, crownH: number, tableR: number): THREE.BufferGeometry {
  const seg = 6;
  const pav = new THREE.CylinderGeometry(girdleR, 0, pavH, seg, 1, true).toNonIndexed();
  pav.translate(0, -pavH / 2, 0); // apex below the girdle, girdle at y=0
  const crown = new THREE.CylinderGeometry(tableR, girdleR, crownH, seg, 1, true).toNonIndexed();
  crown.translate(0, crownH / 2, 0); // girdle at y=0, table at y=crownH
  const table = new THREE.CircleGeometry(tableR, seg).toNonIndexed();
  table.rotateX(-Math.PI / 2); // face +Y
  table.translate(0, crownH, 0);
  const geo = mergePosUV([pav, crown, table]);
  geo.computeVertexNormals();
  return geo;
}

export function makeGem(color: number, air: boolean): THREE.Mesh {
  // Not a diamond. The old pickup was a brilliant-cut jewel with an emissive
  // shell at ~1.0 AND a white core at 2.1 behind it, so every facet blew out to
  // the same cream white — all that cut geometry, and it read as a pale blob.
  // Emissive is not the same thing as expensive.
  //
  // This is a spinning chrome CHIP instead: a dark octagonal body, a polished
  // mirror rim that catches the sky probe as a hard moving glint, and a neon
  // face inset with a chevron. Standing vertical and spinning about Y it goes
  // edge-on and back like a flipped coin, which is what makes it catch the eye
  // at 160 mph without needing to glow at the sky.
  const base = new THREE.Color(air ? 0xffc857 : color);
  const R = air ? 0.46 : 0.36;
  const T = R * 0.26;

  // body: axis along local Y, then laid over so the face points along Z. Every
  // child below is authored in this local frame.
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.9, R * 0.9, T, 8),
    new THREE.MeshStandardMaterial({ color: 0x16131d, metalness: 0.85, roughness: 0.3, flatShading: true })
  );
  body.rotation.x = Math.PI / 2;

  const chrome = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, metalness: 1, roughness: 0.08, flatShading: true });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.92, T * 0.44, 4, 8), chrome);
  rim.rotation.x = Math.PI / 2;
  body.add(rim);

  const faceMat = new THREE.MeshStandardMaterial({
    color: base, emissive: base, emissiveIntensity: air ? 1.5 : 1.1,
    metalness: 0.2, roughness: 0.35, flatShading: true,
  });
  const glyphMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: base.clone().offsetHSL(0, -0.45, 0.4),
    emissiveIntensity: air ? 2.2 : 1.7, flatShading: true,
  });
  for (const sy of [-1, 1]) {
    const face = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.68, R * 0.68, T * 0.18, 8), faceMat);
    face.position.y = sy * (T * 0.52);
    body.add(face);
    // chevron glyph: two short bars meeting at a point, pointing "up" the chip
    for (const sx of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(R * 0.5, T * 0.22, R * 0.14), glyphMat);
      bar.position.set(sx * R * 0.17, sy * (T * 0.62), -R * 0.1);
      bar.rotation.y = sx * 0.62;
      body.add(bar);
    }
  }

  if (air) {
    // mid-air bonus: an orbiting ring so it reads as the high-value pickup
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(R * 1.7, 0.045, 3, 14),
      new THREE.MeshStandardMaterial({
        color: base, emissive: base.clone().offsetHSL(0, 0, 0.2), emissiveIntensity: 1.6, flatShading: true,
      })
    );
    halo.rotation.set(Math.PI / 2.6, 0, 0.4);
    body.add(halo);
  }
  return body;
}

export function makeNitroCan(): THREE.Group {
  // A sleek energy canister: dark metal sleeves top and bottom leave a glowing
  // cyan core exposed as an energy window, framed by machined bands, set on a
  // flanged foot, and topped with a nozzle.
  const group = new THREE.Group();
  const cyan = new THREE.Color(0x22d3ee);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.3, flatShading: true });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xd7dee9, metalness: 0.9, roughness: 0.24, flatShading: true });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: cyan, emissiveIntensity: 2.0, flatShading: true });

  const R = 0.32;

  // glowing energy core running the full height (exposed in the gap between sleeves)
  const core = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.94, R * 0.94, 1.0, 12), coreMat);
  core.position.y = 0.55;
  group.add(core);

  // metal sleeves, leaving a bright band exposed in the middle
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.44, 10), shellMat);
  lower.position.y = 0.27;
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.34, 10), shellMat);
  upper.position.y = 0.9;
  group.add(lower, upper);

  // flanged foot ring — a proper machined base instead of a bare cylinder edge
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.1, R * 0.96, 0.07, 10), bandMat);
  foot.position.y = 0.085;
  group.add(foot);

  // machined bands framing the energy window
  for (const y of [0.5, 0.76]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(R + 0.015, 0.04, 4, 18), bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    group.add(band);
  }

  // nozzle + glowing tip
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.18, 10), bandMat);
  neck.position.y = 1.16;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.14, 10), coreMat);
  tip.position.y = 1.31;
  group.add(neck, tip);

  return group;
}

export function makeOrb(): THREE.Group {
  // A contained energy sphere: a hot faceted core inside a translucent,
  // gem-cut shell (sparkle rim tracing its facet edges), wrapped by two
  // crossed faceted rings that read as an orbiting gyroscope as the engine
  // spins the whole thing.
  const inner = new THREE.Group();
  const violet = new THREE.Color(0xd946ef);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 1),
    new THREE.MeshStandardMaterial({
      color: 0xf5d0fe, emissive: violet, emissiveIntensity: 1.9,
      flatShading: true, transparent: true, opacity: 0.95,
    })
  );
  inner.add(core);

  const shellGeo = new THREE.IcosahedronGeometry(0.82, 1);
  const shell = new THREE.Mesh(
    shellGeo,
    new THREE.MeshStandardMaterial({
      color: violet.clone().offsetHSL(0.03, -0.1, 0.12),
      emissive: violet, emissiveIntensity: 0.65,
      metalness: 0.2, roughness: 0.1, flatShading: true,
      transparent: true, opacity: 0.26, side: THREE.DoubleSide,
    })
  );
  inner.add(shell);

  // thin bright rim tracing the shell's cut facets — same sparkle trick as
  // the gem pickup, so the orb reads as a lit jewel rather than a smooth ball
  const shellRim = new THREE.LineSegments(
    new THREE.EdgesGeometry(shellGeo),
    new THREE.LineBasicMaterial({ color: 0xf5d0fe, transparent: true, opacity: 0.7 })
  );
  inner.add(shellRim);

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1.4, flatShading: true,
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

export type RampKind = "standard" | "mega" | "kicker" | "wide" | "twist";

// each kind: size (half-width, half-length, height), body/glow colours, and
// the launch-power multiplier the engine reads. Widths stay within the ramp
// collision window so you always launch when you drive onto one.
export const RAMP_SPECS: Record<RampKind, {
  w: number; l: number; h: number; body: number; glow: number; chev: number; power: number;
}> = {
  // GENUINELY single-lane now. These used to be w:3.2-3.4 half-width = 6.4-6.8 m
  // on a 10 m road, i.e. two thirds of the track — you could not avoid them and
  // they pitched you off the map. A lane is ~3.3 m, so half-width 1.5 leaves a
  // clear line either side. Heights are down too: these are take-offs you ride
  // over, not launch pads.
  // One consistent RED + YELLOW metallic identity across every kind, so a ramp
  // always reads instantly as "ramp" instead of each realm inventing its own
  // colour. `metal` drives a polished metallic finish in makeRamp.
  standard: { w: 1.5, l: 5.0, h: 1.35, body: 0xb91c1c, glow: 0xf59e0b, chev: 0xfde047, power: 0.85 },
  mega:     { w: 1.6, l: 6.2, h: 1.9, body: 0xdc2626, glow: 0xf59e0b, chev: 0xfde047, power: 1.1 },
  kicker:   { w: 1.45, l: 3.6, h: 0.95, body: 0xb91c1c, glow: 0xfbbf24, chev: 0xfde047, power: 0.6 },
  wide:     { w: 1.55, l: 4.4, h: 1.2, body: 0xdc2626, glow: 0xfbbf24, chev: 0xfde047, power: 0.9 },
  // twist: an Asphalt-style corkscrew take-off — the engine reads this kind and
  // seeds a barrel roll off the lip, landing you level for a stunt bonus.
  twist:    { w: 1.5, l: 5.6, h: 1.5, body: 0xdc2626, glow: 0xf59e0b, chev: 0xfde047, power: 0.95 },
};

// curved slope profiles (t: 0 at entry → 1 at lip). All start flat at 0 and
// rise to 1, but with different curvature so the ramps read as genuinely curved.
const RAMP_PROFILE: Record<RampKind, (t: number) => number> = {
  standard: (t) => t * t * (3 - 2 * t),        // smooth S-curve
  mega:     (t) => Math.pow(t, 1.5),           // concave, kicks up hard at the lip
  kicker:   (t) => Math.pow(t, 2.4),           // flat then a sharp late kick
  wide:     (t) => 1 - Math.cos((t * Math.PI) / 2), // quarter-pipe (flat start, steep end)
  twist:    (t) => t * t * (3 - 2 * t),        // same gentle face; the roll is imparted in the air
};

export function makeRamp(kind: RampKind = "standard", neon = false): THREE.Group {
  const group = new THREE.Group();
  // Ramps used to self-illuminate everywhere: glowing rails, glowing lip, glowing
  // chevrons. Under a sunset sky that reads as plastic tat lit from inside — the
  // only things in the world emitting their own light. Outside the neon realms
  // they're now painted steel: the yellow still reads at speed because it's a
  // bright colour catching the sun, not because it's a lamp.
  const EM = neon ? 1 : 0.06;
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
      // Polished metal, not painted plastic: high metalness with a low roughness
      // lets the HDR environment probe actually reflect off the ramp, which is
      // what sells the red/yellow bodywork as machined steel.
      color: spec.body, emissive: spec.glow, emissiveIntensity: 0.12 * EM,
      metalness: 0.92, roughness: 0.22, envMapIntensity: 1.5,
      flatShading: true, side: THREE.DoubleSide,
    })
  );
  group.add(body);

  const glow = new THREE.MeshStandardMaterial({ color: neon ? 0xfde68a : spec.glow, emissive: spec.glow, emissiveIntensity: 1.0 * EM, metalness: neon ? 0 : 0.8, roughness: neon ? 1 : 0.3 });
  const chevMat = new THREE.MeshStandardMaterial({ color: 0xfffbeb, emissive: spec.chev, emissiveIntensity: 1.5 * EM, flatShading: true, side: THREE.DoubleSide });

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

/** Procedural bark fallback: vertical woody grain streaks (wobbly, varying
 *  width/tone) plus a couple of knot rings on a warm brown base, so trunks
 *  read as real wood even without the CC0 PBR bark set. Follows the file's
 *  other canvas-texture helpers (small, seeded, repeat-wrapped). */
function barkTexture(): THREE.Texture {
  const res = 128;
  const c = document.createElement("canvas");
  c.width = res;
  c.height = res;
  const ctx = c.getContext("2d")!;
  const rand = seeded(505);

  ctx.fillStyle = "#5a3a22";
  ctx.fillRect(0, 0, res, res);
  // vertical grain streaks, each a wobbly line of varying width/tone
  for (let i = 0; i < 90; i++) {
    const dark = rand() < 0.55;
    ctx.strokeStyle = dark
      ? `rgba(32,18,10,${(0.12 + rand() * 0.2).toFixed(2)})`
      : `rgba(150,112,72,${(0.10 + rand() * 0.18).toFixed(2)})`;
    ctx.lineWidth = 1 + rand() * 2.6;
    let x = rand() * res;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 8; y <= res; y += 8) {
      x += (rand() - 0.5) * 5;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // a couple of knot rings
  for (let i = 0; i < 3; i++) {
    const kx = rand() * res, ky = rand() * res, kr = 4 + rand() * 7;
    for (let ring = 0; ring < 3; ring++) {
      ctx.strokeStyle = `rgba(28,16,9,${(0.32 - ring * 0.09).toFixed(2)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr - ring * 2, (kr - ring * 2) * 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Procedural leaf fallback: mottled green dapple (soft lighter/darker leaf
 *  clumps) plus fine dark speckles, so foliage reads as leaves rather than
 *  flat plastic without the CC0 PBR foliage set. Multiplies with the
 *  material's `color` (pal.clutter), matching how the PBR foliage diffuse
 *  map is tinted per realm. */
function leafTexture(): THREE.Texture {
  const res = 128;
  const c = document.createElement("canvas");
  c.width = res;
  c.height = res;
  const ctx = c.getContext("2d")!;
  const rand = seeded(707);

  ctx.fillStyle = "#4f7a3d";
  ctx.fillRect(0, 0, res, res);
  // soft mottled leaf clumps, lighter and darker
  for (let i = 0; i < 70; i++) {
    const x = rand() * res, y = rand() * res, r = 6 + rand() * 14;
    const light = rand() < 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, light ? "rgba(158,196,116,0.4)" : "rgba(28,58,24,0.38)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // fine dappled speckle (sun-through-leaves texture)
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rand() < 0.5 ? "rgba(18,38,14,0.35)" : "rgba(184,214,142,0.25)";
    const s = 1 + rand() * 2;
    ctx.fillRect(rand() * res, rand() * res, s, s);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Shared trunk (bark) + foliage (leaf) materials for a realm, from the CC0
 *  bark/foliage PBR sets (falls back to procedural canvas bark/leaf
 *  textures). Reused across every tree so hundreds of trees don't each
 *  allocate materials. */
export function makeTreeMaterials(pal: RealmPalette): TreeMats {
  // foliage uses vertexColors so each tree can bake its own tonal shading + AO +
  // per-instance hue into geometry while the material stays shared. flatShading
  // gives the faceted low-poly leaf/bark read.
  // slightly glossy foliage (damp leaves catch the sky bounce) + deeper bark
  // relief, so trees pick up the scene's image-based lighting like the cars do
  const lib = pbr();
  if (lib) {
    const bark = tileSet(lib.bark, 1, 2.2);
    const fol = tileSet(lib.foliage, 2.2, 2.2);
    const foliage = new THREE.MeshStandardMaterial({
      color: pal.clutter, map: fol.diff, normalMap: fol.nor, roughness: 0.78, metalness: 0,
      flatShading: true, vertexColors: true, envMapIntensity: 0.6,
    });
    // NO strong aoMap on foliage. The canopy is already shaded four ways over:
    // the palette tint, the leaf albedo, and a baked dark-to-light vertex
    // gradient (paintByHeight). Stacking texture AO on top at 0.7 crushed it to
    // near-black, which is why the trees read as rocky blobs rather than leaves.
    if (fol.arm) { foliage.roughnessMap = fol.arm; foliage.roughness = 1; foliage.aoMap = fol.arm; foliage.aoMapIntensity = 0.22; }
    applyFoliageWind(foliage);
    return {
      trunk: Object.assign(new THREE.MeshStandardMaterial({
        map: bark.diff, normalMap: bark.nor, normalScale: new THREE.Vector2(1.3, 1.3),
        roughness: 0.92, metalness: 0, flatShading: true, envMapIntensity: 0.5,
      }), bark.arm ? { roughnessMap: bark.arm, roughness: 1, aoMap: bark.arm, aoMapIntensity: 0.8 } : {}),
      foliage,
    };
  }
  // procedural fallback — canvas bark/leaf maps so the trunk looks like wood
  // and the canopy looks leafy even without the CC0 PBR sets. Trunk stays
  // unmultiplied (true wood browns); only the leaves take the realm tint.
  const foliage = new THREE.MeshStandardMaterial({
    color: pal.clutter, map: leafTexture(), roughness: 0.78, flatShading: true, vertexColors: true, envMapIntensity: 0.6,
  });
  applyFoliageWind(foliage);
  return {
    trunk: new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.92, flatShading: true, envMapIntensity: 0.5 }),
    foliage,
  };
}

/** A ConeGeometry with every vertex nudged outward by a small deterministic
 *  hash of its own position (shared seam vertices hash identically, so the
 *  tier stays watertight) and the base rim sagging down unevenly — reads as
 *  one irregular, slightly drooping tier of foliage rather than a perfect
 *  cone. */
function lumpyCone(r: number, h: number, seg: number, jitter: number, droop: number, rand: () => number): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(r, h, seg, 1);
  const sx = rand() * 60, sy = rand() * 60, sz = rand() * 60; // per-call hash offset
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const hash = dirHash(x + sx, y + sy, z + sz);
    const rf = 1 + (hash - 0.5) * jitter;
    let ny = y;
    if (y < -h / 2 + 1e-3) ny -= hash * droop; // base rim sags, irregularly
    p.setXYZ(i, x * rf, ny, z * rf);
  }
  geo.computeVertexNormals();
  return geo;
}

/** An icosahedron/dodecahedron with every vertex pushed outward by a small
 *  deterministic hash and flattened vertically — an irregular, lumpy blob of
 *  leaves instead of a smooth ball (same displace-along-normal trick as
 *  boulderGeometry). */
function lumpyBlob(r: number, detail: number, dodeca: boolean, jitter: number, flat: number, rand: () => number): THREE.BufferGeometry {
  const geo = dodeca ? new THREE.DodecahedronGeometry(r, detail) : new THREE.IcosahedronGeometry(r, detail);
  const sx = rand() * 60, sy = rand() * 60, sz = rand() * 60;
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len, ny = y / len, nz = z / len;
    const rf = 1 + (dirHash(nx + sx, ny + sy, nz + sz) - 0.5) * jitter;
    p.setXYZ(i, x * rf, y * rf * flat, z * rf);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A low-poly tree with a bark trunk and textured foliage — pine/tall build a
 *  bushy conifer from several stacked, drooping, jittered tiers; round builds
 *  a broadleaf crown from a cluster of overlapping lumpy blobs. Meshes only;
 *  the shared materials come from makeTreeMaterials. */
export function makeTree(rand: () => number, mats: TreeMats, kind: TreeKind): THREE.Group {
  const g = new THREE.Group();
  const h = kind === "tall" ? 4.0 + rand() * 2.2 : 2.6 + rand() * 2.4;

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
  // was 0.40/0.50/0.46 — the canopy underside went essentially black once the
  // texture and AO multiplied in. Lifted so it stays readable as foliage.
  const shadeLow = new THREE.Color((0.62 - warm) * tj, 0.76 * tj, (0.66 + warm) * tj);
  const shadeHigh = new THREE.Color((1.10 + warm) * tj, 1.12 * tj, (0.94 - warm) * tj);

  const foliage: THREE.BufferGeometry[] = [];
  const addLeaf = (
    geo: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number,
    tiltX = 0, tiltZ = 0
  ) => {
    if (tiltX) geo.rotateX(tiltX);
    if (tiltZ) geo.rotateZ(tiltZ);
    geo.rotateY(yaw);
    geo.translate(x, y, z);
    g.add(new THREE.Mesh(geo, mats.foliage));
    foliage.push(geo);
  };

  if (kind === "round") {
    // broadleaf: a full leafy crown built from a cluster of 4-8 overlapping
    // irregular lobes (icosahedron/dodecahedron, jittered + flattened) —
    // not a single smooth ball — over a short tapered trunk.
    const cBase = trunkH + h * 0.12;
    const R = h * 0.32;
    const lobes = 4 + Math.floor(rand() * 5); // 4..8 blobs total, incl. centre
    addLeaf(
      lumpyBlob(R * 1.05, 1, false, 0.3, 0.82 + rand() * 0.14, rand),
      0, cBase + R * 0.55, 0, rand() * Math.PI
    );
    for (let i = 1; i < lobes; i++) {
      const a = (i / (lobes - 1)) * Math.PI * 2 + rand() * 0.6;
      const rr = R * (0.45 + rand() * 0.32);
      const rad = R * (0.5 + rand() * 0.35);
      const dodeca = rand() < 0.4;
      addLeaf(
        lumpyBlob(rr, rand() < 0.5 ? 0 : 1, dodeca, 0.36, 0.66 + rand() * 0.3, rand),
        Math.cos(a) * rad, cBase + R * (0.42 + rand() * 0.62), Math.sin(a) * rad,
        rand() * Math.PI
      );
    }
  } else {
    // conifer: 4-5 irregular, slightly drooping tiers stacked on a tapered
    // leader, flaring wide at the base and narrowing toward the tip — reads
    // as a bushy pine rather than one sharp cone. "tall" is the slim variant.
    const tall = kind === "tall";
    const L = tall ? 5 : 4;
    // 0.26 made a 4-8 m tree with a canopy barely 1.5 m across — a dark spire
    // that reads as an odd little pillar rather than a tree. Still slimmer than
    // the bushy variant, but now unmistakably a tree.
    const spread = h * (tall ? 0.40 : 0.44);
    const cBase = trunkH * 0.6;
    const canopyH = h * (tall ? 0.82 : 0.7);
    let topApex = cBase;
    for (let i = 0; i < L; i++) {
      const t = i / (L - 1);
      const r = spread * (1 - t * 0.78) * (0.86 + rand() * 0.3) + 0.08;
      const ch = (canopyH / L) * (1.5 + rand() * 0.6); // tall + overlaps the tier below
      const seg = 6 + (i % 2); // alternate hexagonal/heptagonal tiers
      const cy = cBase + t * canopyH * 0.92 + ch * 0.3;
      const jx = (rand() - 0.5) * r * 0.3, jz = (rand() - 0.5) * r * 0.3;
      addLeaf(
        lumpyCone(r, ch, seg, 0.4, ch * 0.24, rand),
        jx, cy, jz, rand() * Math.PI,
        (rand() - 0.5) * 0.16, (rand() - 0.5) * 0.16
      );
      topApex = Math.max(topApex, cy + ch / 2);
    }
    // pointed leader tip poking above the topmost tier
    const tipH = canopyH * 0.22;
    addLeaf(new THREE.ConeGeometry(spread * 0.1 + 0.05, tipH, 6), 0, topApex + tipH * 0.32, 0, 0);
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

/** Realms scatter this by the hundreds as roadside clutter (some weight it as
 *  the dominant scenery kind), so it keeps the exact mesh-per-shard budget of
 *  the original (no extra draw calls) — the upgrade is all in the geometry and
 *  material: a hexagonal cut (was a crude 5-gon cone) that tapers to a small
 *  blunt facet instead of a sharp point, plus a baked dim-root -> hot-tip
 *  vertex-colour gradient (paintByHeight) so each shard reads as glowing from
 *  within rather than flat-lit, with a brighter, varied emissive kick. */
export function makeCrystalCluster(rand: () => number, colors: number[]): THREE.Group {
  const group = new THREE.Group();
  const shards = 2 + Math.floor(rand() * 3);
  const facet = stoneMaps(0xbfc8ff).bump;
  const seg = 6;
  for (let i = 0; i < shards; i++) {
    const height = 1.2 + rand() * 2.9;
    const baseR = (0.24 + rand() * 0.22) * (0.75 + height * 0.1);
    const tipR = baseR * 0.2; // blunt faceted tip, not a sharp cone point
    const geo = new THREE.CylinderGeometry(tipR, baseR, height, seg);
    const shade = new THREE.Color(colors[Math.floor(rand() * colors.length)]);
    paintByHeight(
      geo, 0, -height / 2, height / 2,
      shade.clone().multiplyScalar(0.5),          // shaded root
      shade.clone().offsetHSL(0, -0.12, 0.45)      // hot, near-white tip
    );
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: shade, emissiveIntensity: 0.8 + rand() * 0.5,
      roughness: 0.22, metalness: 0.18, flatShading: true, vertexColors: true,
      bumpMap: facet, bumpScale: 0.035,
      transparent: true, opacity: 0.92,
    });
    const shard = new THREE.Mesh(geo, mat);
    shard.position.set((rand() - 0.5) * 1.4, height / 2, (rand() - 0.5) * 1.4);
    shard.rotation.z = (rand() - 0.5) * 0.36;
    shard.rotation.x = (rand() - 0.5) * 0.2;
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

// Each car folds up into its OWN battle-mech. Every variant still exposes the
// same rig (group / wings / core / armR / sword), so the engine animates them
// identically — armR.rotation.x swings the weapon, wings.visible toggles flight,
// core.material.emissiveIntensity pulses — but the silhouette, palette and
// weapon/wings change per car.
type MechWeapon = "sword" | "rapier" | "hammer" | "daggers" | "saber" | "wrecker" | "scythe" | "drill" | "machete" | "lance";
type MechWings = "delta" | "streamer" | "stub" | "dragonfly" | "jet" | "industrial" | "ghost" | "header" | "rollbar" | "rocket";
type MechHead = "visor" | "crest" | "sunk" | "insect" | "canopy" | "dome" | "stack";

interface MechSpec {
  scale: number;      // overall size (goliath towers, wisp is small)
  torsoW: number;     // torso width
  torsoH: number;     // torso height
  legStyle: "walker" | "hover" | "tank";
  legH: number;       // leg length
  build: number;      // limb / plate chunkiness
  shoulder: number;   // pauldron scale
  head: MechHead;
  weapon: MechWeapon;
  wings: MechWings;
  lean?: number;      // forward cant of the torso (jet / speed forms)
  exhaust?: boolean;  // exhaust stacks instead of tidy thrusters
}

// One identity per car — proportions + weapon + wings that echo its character
// (goliath = brute tank, wisp = nimble flyer, apex = jet-mech, baron-heavy, …).
const MECH_SPECS: Record<CarId, MechSpec> = {
  f40:      { scale: 1.00, torsoW: 1.50, torsoH: 1.40, legStyle: "walker", legH: 1.20, build: 1.00, shoulder: 1.00, head: "visor",  weapon: "sword",   wings: "delta" },
  meridian: { scale: 0.98, torsoW: 1.28, torsoH: 1.40, legStyle: "walker", legH: 1.28, build: 0.84, shoulder: 0.95, head: "canopy", weapon: "saber",   wings: "jet", lean: 0.18 },
  veloce:   { scale: 1.12, torsoW: 1.95, torsoH: 1.35, legStyle: "walker", legH: 0.95, build: 1.45, shoulder: 1.60, head: "sunk",   weapon: "hammer",  wings: "stub", exhaust: true },
  tauro:    { scale: 1.02, torsoW: 1.16, torsoH: 1.55, legStyle: "walker", legH: 1.55, build: 0.82, shoulder: 0.85, head: "crest",  weapon: "rapier",  wings: "streamer", lean: 0.12 },
  testa:    { scale: 1.03, torsoW: 1.24, torsoH: 1.45, legStyle: "walker", legH: 1.32, build: 0.85, shoulder: 1.00, head: "canopy", weapon: "lance",   wings: "rocket", lean: 0.14 },
  zanza:    { scale: 0.96, torsoW: 1.20, torsoH: 1.38, legStyle: "hover",  legH: 1.15, build: 0.80, shoulder: 0.95, head: "dome",   weapon: "scythe",  wings: "ghost" },
  imprez:   { scale: 1.00, torsoW: 1.54, torsoH: 1.34, legStyle: "walker", legH: 1.14, build: 1.16, shoulder: 1.12, head: "visor",  weapon: "machete", wings: "rollbar" },
  firehawk: { scale: 1.08, torsoW: 1.62, torsoH: 1.28, legStyle: "walker", legH: 1.00, build: 1.28, shoulder: 1.22, head: "stack",  weapon: "drill",   wings: "header", exhaust: true },
  iroc:     { scale: 1.10, torsoW: 1.90, torsoH: 1.36, legStyle: "tank",   legH: 0.92, build: 1.55, shoulder: 1.70, head: "dome",   weapon: "wrecker", wings: "industrial", exhaust: true },
  fairlady: { scale: 0.86, torsoW: 1.05, torsoH: 1.10, legStyle: "hover",  legH: 0.95, build: 0.62, shoulder: 0.70, head: "insect", weapon: "daggers", wings: "dragonfly" },
};

interface MechMats {
  body: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  blade: THREE.MeshStandardMaterial;
  accent: THREE.Color;
}

function mBox(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Livery-derived faceted armour palette for a car's mech: a painted body tone,
 *  dark structural steel, a bright emissive accent (trim) and a glowing energy
 *  blade — all pulled from the car's livery colour. */
function mechMaterials(carId: CarId): MechMats {
  const src = new THREE.Color(CAR_SPECS[carId].color);
  const hsl = { h: 0, s: 0, l: 0 };
  src.getHSL(hsl);
  const bodyCol = src.clone();
  if (hsl.l > 0.6) bodyCol.offsetHSL(0, 0, -0.14);            // keep pale liveries reading as armour
  const steelCol = src.clone().offsetHSL(0, -0.16, hsl.l > 0.5 ? -0.34 : -0.22);
  const accent = src.clone().offsetHSL(0, 0.08, hsl.l > 0.6 ? 0.04 : 0.2);
  const body = new THREE.MeshStandardMaterial({ color: bodyCol, metalness: 0.8, roughness: 0.34, flatShading: true });
  const steel = new THREE.MeshStandardMaterial({ color: steelCol, metalness: 0.82, roughness: 0.44, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.3, flatShading: true });
  const blade = new THREE.MeshStandardMaterial({
    color: accent.clone().offsetHSL(0, -0.3, 0.4), emissive: accent, emissiveIntensity: 1.8,
    transparent: true, opacity: 0.92, flatShading: true,
  });
  return { body, steel, trim, blade, accent };
}

/** The mech's head — a distinct crown per car (open visor, speed crest, sunk
 *  brute skull, insect eyes, jet nose-cone, armoured dome, dragster stacks). */
function mechHead(style: MechHead, m: MechMats, y: number): THREE.Group {
  const g = new THREE.Group();
  g.position.y = y;
  const eye = new THREE.MeshStandardMaterial({ color: m.accent, emissive: m.accent, emissiveIntensity: 2 });
  switch (style) {
    case "visor": {
      g.add(mBox(0.7, 0.6, 0.65, m.steel, 0, 0, 0));
      g.add(mBox(0.55, 0.16, 0.12, eye, 0, 0.05, 0.34));
      g.add(mBox(0.08, 0.4, 0.08, m.trim, 0.28, 0.45, 0));
      g.add(mBox(0.08, 0.3, 0.08, m.trim, -0.28, 0.4, 0));
      break;
    }
    case "crest": {
      g.add(mBox(0.5, 0.56, 0.6, m.steel, 0, 0, 0));
      g.add(mBox(0.48, 0.12, 0.1, eye, 0, 0.06, 0.3));
      const fin = mBox(0.08, 0.55, 0.5, m.trim, 0, 0.42, -0.05);
      fin.rotation.x = -0.3;
      g.add(fin);
      break;
    }
    case "sunk": {
      g.add(mBox(0.56, 0.46, 0.56, m.steel, 0, -0.14, 0));
      g.add(mBox(0.42, 0.12, 0.1, eye, 0, -0.1, 0.28));
      break;
    }
    case "insect": {
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), m.steel));
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), eye);
        e.position.set(sx * 0.15, 0.02, 0.2);
        g.add(e);
        const ant = mBox(0.04, 0.42, 0.04, m.trim, sx * 0.12, 0.34, -0.04);
        ant.rotation.z = sx * 0.35;
        g.add(ant);
      }
      break;
    }
    case "canopy": {
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.82, 6), m.body);
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.12;
      g.add(nose);
      g.add(mBox(0.42, 0.14, 0.32, eye, 0, 0.02, 0.16));
      break;
    }
    case "dome": {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.steel));
      g.add(mBox(0.5, 0.16, 0.12, eye, 0, -0.04, 0.3));
      break;
    }
    case "stack": {
      g.add(mBox(0.62, 0.5, 0.6, m.steel, 0, 0, 0));
      g.add(mBox(0.5, 0.14, 0.1, eye, 0, 0.05, 0.3));
      for (const sx of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.36, 6), m.trim);
        horn.position.set(sx * 0.2, 0.4, -0.04);
        g.add(horn);
      }
      break;
    }
  }
  return g;
}

/** The weapon on the mech's right (swinging) arm. Every weapon has its grip at
 *  the origin and reaches up along +y, so the engine's armR.rotation.x arc swings
 *  it exactly the way the original energy sword swung. */
function mechWeapon(kind: MechWeapon, m: MechMats): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case "sword": {
      g.add(mBox(0.16, 0.5, 0.16, m.steel, 0, 0, 0));
      g.add(mBox(0.5, 0.12, 0.16, m.trim, 0, 0.28, 0));
      g.add(mBox(0.22, 2.6, 0.08, m.blade, 0, 1.6, 0));
      break;
    }
    case "rapier": {
      g.add(mBox(0.12, 0.44, 0.12, m.steel, 0, 0, 0));
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.04, 6, 10), m.trim);
      guard.rotation.x = Math.PI / 2;
      guard.position.y = 0.24;
      g.add(guard);
      g.add(mBox(0.08, 3.2, 0.05, m.blade, 0, 1.85, 0)); // long slender blade
      break;
    }
    case "hammer": {
      g.add(mBox(0.2, 2.0, 0.2, m.steel, 0, 0.9, 0));    // haft
      g.add(mBox(0.82, 0.72, 0.98, m.steel, 0, 1.95, 0)); // head
      g.add(mBox(0.86, 0.22, 1.02, m.blade, 0, 1.95, 0)); // glowing band
      break;
    }
    case "daggers": {
      for (const sx of [-1, 1]) {
        const b = mBox(0.1, 1.3, 0.05, m.blade, sx * 0.14, 0.75, 0);
        b.rotation.z = sx * 0.16;
        g.add(b);
      }
      g.add(mBox(0.34, 0.16, 0.16, m.trim, 0, 0, 0)); // knuckle guard
      break;
    }
    case "saber": {
      g.add(mBox(0.14, 0.5, 0.14, m.steel, 0, 0, 0)); // emitter
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.5, 8), m.blade);
      beam.position.y = 1.55;
      g.add(beam);
      break;
    }
    case "wrecker": {
      g.add(mBox(0.2, 1.4, 0.2, m.steel, 0, 0.65, 0)); // shaft
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), m.steel);
      ball.position.y = 1.7;
      g.add(ball);
      const up = new THREE.Vector3(0, 1, 0);
      const dirs: [number, number, number][] = [[0, 1, 0], [1, 0.3, 0], [-1, 0.3, 0], [0, 0.3, 1], [0, 0.3, -1]];
      for (const d of dirs) {
        const v = new THREE.Vector3(d[0], d[1], d[2]).normalize();
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 5), m.trim);
        spike.quaternion.setFromUnitVectors(up, v);
        spike.position.copy(v).multiplyScalar(0.62).add(new THREE.Vector3(0, 1.7, 0));
        g.add(spike);
      }
      break;
    }
    case "scythe": {
      g.add(mBox(0.14, 2.8, 0.14, m.steel, 0, 1.1, 0)); // long haft
      const blade = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.06, 4, 16, Math.PI * 0.85), m.blade);
      blade.position.set(0.1, 2.5, 0);
      blade.rotation.z = -Math.PI * 0.18;
      g.add(blade);
      break;
    }
    case "drill": {
      g.add(mBox(0.22, 0.6, 0.22, m.steel, 0, 0, 0)); // mount
      const drill = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.9, 8), m.steel);
      drill.position.y = 1.35;
      g.add(drill);
      for (const yy of [0.95, 1.4, 1.8]) { // spiralling emissive bands
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.26 * (1 - (yy - 0.9) / 2.2), 0.04, 4, 10), m.trim);
        r.rotation.x = Math.PI / 2;
        r.position.y = yy;
        g.add(r);
      }
      break;
    }
    case "machete": {
      g.add(mBox(0.16, 0.42, 0.14, m.steel, 0, 0, 0));   // grip
      g.add(mBox(0.14, 0.14, 0.5, m.steel, 0, 0.24, 0.1)); // knuckle
      g.add(mBox(0.42, 1.5, 0.08, m.blade, 0, 1.05, 0.06)); // broad short blade
      break;
    }
    case "lance": {
      g.add(mBox(0.14, 0.5, 0.14, m.steel, 0, 0, 0));
      g.add(mBox(0.1, 2.4, 0.1, m.steel, 0, 1.45, 0)); // shaft
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.85, 6), m.blade);
      tip.position.y = 3.0;
      g.add(tip);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.04, 6, 10), m.trim);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 2.5;
      g.add(ring);
      break;
    }
  }
  return g;
}

/** A swept faceted wing panel in the XY plane (root at origin, reaching +x/+y),
 *  reused for most of the flight-wing styles. */
function mechWingPanel(reach: number, rise: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(reach, rise * 0.62);
  s.lineTo(reach * 0.85, rise);
  s.lineTo(0, rise * 0.46);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** The flight wings, hidden until the engine toggles them on when airborne. Each
 *  style reads as a different flyer: delta, speed streamers, brute boosters,
 *  insect gossamer, jet delta+tails, industrial packs, spectral shards, dragster
 *  wing, off-road light-bar or rocket nacelles. */
function mechWings(kind: MechWings, m: MechMats, backY: number): THREE.Group {
  const g = new THREE.Group();
  const bz = -0.55;
  const solid = new THREE.MeshStandardMaterial({ color: m.accent.clone().offsetHSL(0, 0, -0.1), emissive: m.accent, emissiveIntensity: 1.0, side: THREE.DoubleSide, flatShading: true });
  const filmy = new THREE.MeshStandardMaterial({ color: m.accent, emissive: m.accent, emissiveIntensity: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.34, flatShading: true });

  const pair = (geo: THREE.ShapeGeometry, mat: THREE.Material, x: number, y: number, z: number, yaw: number) => {
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(geo, mat);
      w.scale.x = sx;
      w.position.set(sx * x, y, z);
      w.rotation.y = sx * yaw;
      g.add(w);
    }
  };

  switch (kind) {
    case "delta": {
      pair(mechWingPanel(2.6, 1.3), solid, 0.4, backY, bz, Math.PI * 0.12);
      break;
    }
    case "streamer": {
      pair(mechWingPanel(3.3, 0.55), solid, 0.35, backY + 0.1, bz - 0.1, Math.PI * 0.22);
      for (const sx of [-1, 1]) {
        const streak = mBox(0.06, 0.06, 2.4, m.trim, sx * 1.5, backY + 0.25, bz - 1.1);
        streak.rotation.y = sx * Math.PI * 0.1;
        g.add(streak);
      }
      break;
    }
    case "stub": {
      pair(mechWingPanel(1.1, 0.9), solid, 0.5, backY, bz, Math.PI * 0.05);
      for (const sx of [-1, 1]) {
        g.add(mBox(0.44, 0.7, 0.5, m.steel, sx * 0.72, backY, bz - 0.2));
        g.add(mBox(0.32, 0.32, 0.1, m.trim, sx * 0.72, backY - 0.02, bz - 0.46));
      }
      break;
    }
    case "dragonfly": {
      pair(mechWingPanel(2.5, 0.5), filmy, 0.3, backY + 0.35, bz, Math.PI * 0.08);
      pair(mechWingPanel(2.1, 0.44), filmy, 0.3, backY - 0.15, bz - 0.1, Math.PI * 0.16);
      break;
    }
    case "jet": {
      pair(mechWingPanel(2.3, 1.0), solid, 0.45, backY, bz, Math.PI * 0.2);
      for (const sx of [-1, 1]) {
        const fin = mBox(0.05, 0.75, 0.55, solid, sx * 0.5, backY + 0.3, bz - 0.3);
        fin.rotation.x = 0.2;
        g.add(fin);
      }
      break;
    }
    case "industrial": {
      for (const sx of [-1, 1]) {
        g.add(mBox(0.55, 1.15, 0.7, m.steel, sx * 0.78, backY, bz - 0.2));
        for (const vy of [-0.3, 0, 0.3]) g.add(mBox(0.4, 0.12, 0.1, m.trim, sx * 0.78, backY + vy, bz - 0.56));
        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 8), m.trim);
        nozzle.position.set(sx * 0.78, backY - 0.62, bz - 0.2);
        g.add(nozzle);
      }
      pair(mechWingPanel(1.0, 0.8), solid, 1.0, backY + 0.2, bz - 0.1, Math.PI * 0.05);
      break;
    }
    case "ghost": {
      for (const sx of [-1, 1]) {
        for (const [i, rr] of [[0, 1.8], [1, 1.5], [2, 1.2]] as const) {
          const shard = new THREE.Mesh(mechWingPanel(rr, 0.7 + i * 0.2), filmy);
          shard.scale.x = sx;
          shard.position.set(sx * 0.25, backY + 0.3 - i * 0.35, bz - i * 0.1);
          shard.rotation.y = sx * (0.2 + i * 0.14);
          shard.rotation.z = -i * 0.12;
          g.add(shard);
        }
      }
      break;
    }
    case "header": {
      for (const sx of [-1, 1]) g.add(mBox(0.08, 0.75, 0.1, m.steel, sx * 0.62, backY + 0.35, bz)); // pylons
      g.add(mBox(2.4, 0.08, 0.72, solid, 0, backY + 0.75, bz - 0.05));                               // wide rear wing
      for (const sx of [-1, 1]) g.add(mBox(0.05, 0.42, 0.62, solid, sx * 1.2, backY + 0.58, bz - 0.05)); // endplates
      break;
    }
    case "rollbar": {
      pair(mechWingPanel(1.8, 1.0), solid, 0.45, backY, bz, Math.PI * 0.1);
      g.add(mBox(1.7, 0.14, 0.16, m.steel, 0, backY + 0.7, bz));                                     // light bar
      for (const lx of [-0.55, 0, 0.55]) g.add(mBox(0.22, 0.16, 0.1, m.trim, lx, backY + 0.7, bz + 0.09)); // lamps
      break;
    }
    case "rocket": {
      pair(mechWingPanel(2.4, 0.9), solid, 0.45, backY, bz, Math.PI * 0.15);
      for (const sx of [-1, 1]) {
        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.55, 8), m.trim);
        nozzle.rotation.x = Math.PI / 2;
        nozzle.position.set(sx * 2.05, backY + 0.2, bz - 0.25);
        g.add(nozzle);
      }
      break;
    }
  }
  return g;
}

export function makeMech(carId: CarId): MechRig {
  const spec = MECH_SPECS[carId];
  const m = mechMaterials(carId);
  const group = new THREE.Group();
  const B = spec.build;
  const legTop = spec.legH;

  // ---- lower body: walking legs, a tank chassis or a hover skirt ----------
  if (spec.legStyle === "walker") {
    for (const sx of [-1, 1]) {
      group.add(mBox(0.5 * B, legTop, 0.55 * B, m.steel, sx * 0.42 * B, legTop * 0.5 + 0.15, 0));
      group.add(mBox(0.52 * B, 0.13, 0.57 * B, m.trim, sx * 0.42 * B, legTop * 0.62, 0.03)); // knee band
      group.add(mBox(0.6 * B, 0.3, 0.9 * B, m.body, sx * 0.42 * B, 0.15, 0.1));               // foot
    }
    group.add(mBox(1.1 * B, 0.5, 0.7 * B, m.steel, 0, legTop + 0.25, 0));                      // pelvis
  } else if (spec.legStyle === "tank") {
    for (const sx of [-1, 1]) {
      group.add(mBox(0.9 * B, legTop, 1.0 * B, m.steel, sx * 0.58 * B, legTop * 0.5 + 0.2, 0));
      group.add(mBox(0.5 * B, 0.16, 0.55 * B, m.trim, sx * 0.58 * B, legTop * 0.55, 0.5 * B)); // hip vent
      group.add(mBox(1.05 * B, 0.38, 1.35 * B, m.steel, sx * 0.58 * B, 0.19, 0.16));           // huge foot
      const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, legTop * 0.7, 6), m.trim);
      piston.position.set(sx * 0.58 * B, legTop * 0.55, -0.2);
      group.add(piston);
    }
    group.add(mBox(1.7 * B, 0.6, 1.0 * B, m.steel, 0, legTop + 0.32, 0));                      // massive waist
    group.add(mBox(1.9 * B, 0.28, 1.1 * B, m.body, 0, legTop + 0.04, 0.1));                    // armour skirt
  } else {
    // hover: no ground contact. zanza = a spectral tapered tail; fairlady = a
    // small pod on thin dangling legs. Both ride a glowing under-thruster.
    if (carId === "zanza") {
      const skirtH = legTop + 1.3;
      const skirtMat = m.body.clone();
      skirtMat.transparent = true;
      skirtMat.opacity = 0.55;
      const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.82, skirtH, 6), skirtMat);
      skirt.rotation.x = Math.PI;               // apex down (a drifting tail)
      skirt.position.y = skirtH * 0.5 + 0.1;
      group.add(skirt);
      for (const sx of [-1, 1]) {
        const wispBar = mBox(0.1, legTop, 0.1, m.trim, sx * 0.32, legTop * 0.6, -0.08);
        wispBar.rotation.z = sx * 0.22;
        group.add(wispBar);
      }
    } else {
      for (const sx of [-1, 1]) {
        const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, legTop, 6), m.steel);
        thigh.position.set(sx * 0.3, legTop * 0.5 + 0.18, 0);
        thigh.rotation.z = sx * 0.16;
        group.add(thigh);
        group.add(mBox(0.28, 0.14, 0.5, m.body, sx * 0.34, 0.12, 0.06)); // dainty foot
      }
      group.add(mBox(0.85, 0.42, 0.62, m.steel, 0, legTop + 0.18, 0));   // hover pod
    }
    const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.12, 0.4, 8), m.trim);
    thruster.position.y = 0.42;
    group.add(thruster);
  }

  // ---- upper body (torso, head, arms, core), canted forward by `lean` -----
  const upper = new THREE.Group();
  const pelvisY = legTop + 0.25;
  const torsoCY = pelvisY + 0.3 + spec.torsoH * 0.5;
  const tW = spec.torsoW, tH = spec.torsoH;

  upper.add(mBox(tW, tH, 0.85 * B, m.body, 0, torsoCY, 0));                        // torso
  upper.add(mBox(tW * 0.8, 0.5, 0.9 * B, m.trim, 0, torsoCY + tH * 0.5, 0.05));    // collar
  upper.add(mBox(tW * 0.6, tH * 0.5, 0.12, m.steel, 0, torsoCY + tH * 0.08, 0.44 * B)); // chest plate

  // faceted emissive core on the chest — the engine pulses its emissiveIntensity
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.28, 1),
    new THREE.MeshStandardMaterial({ color: m.accent.clone().offsetHSL(0, -0.2, 0.35), emissive: m.accent, emissiveIntensity: 2.4, flatShading: true })
  );
  core.position.set(0, torsoCY + tH * 0.04, 0.5 * B);
  upper.add(core);

  upper.add(mechHead(spec.head, m, torsoCY + tH * 0.5 + 0.55));

  // shoulders + arms
  const shX = tW * 0.5 + 0.25 * spec.shoulder;
  const shoulderY = torsoCY + tH * 0.3;
  for (const sx of [-1, 1])
    upper.add(mBox(0.75 * spec.shoulder, 0.6 * spec.shoulder, 0.95 * B, m.steel, sx * shX, shoulderY, 0));

  const armPivotY = torsoCY + tH * 0.15;
  const armLen = 1.3 * (0.85 + B * 0.15);
  const arm = (side: number): THREE.Group => {
    const a = new THREE.Group();
    a.position.set(side * shX, armPivotY, 0);
    a.add(mBox(0.4 * B, armLen, 0.45 * B, m.body, 0, -armLen * 0.5, 0));
    a.add(mBox(0.45 * B, 0.4, 0.5 * B, m.trim, 0, -armLen - 0.05, 0)); // fist
    return a;
  };
  upper.add(arm(-1));                       // left (static)
  const armR = arm(1);                      // right (swings)
  const weapon = mechWeapon(spec.weapon, m);
  weapon.position.set(0, -armLen - 0.15, 0.2); // hang from the fist, reach up
  armR.add(weapon);
  armR.rotation.x = -0.5;                    // rest pose (engine overrides while transformed)
  upper.add(armR);

  // back thrusters / exhaust stacks
  if (spec.exhaust) {
    for (const sx of [-1, 1]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.95, 8), m.steel);
      stack.position.set(sx * tW * 0.32, torsoCY + tH * 0.35, -0.5 * B);
      upper.add(stack);
      const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.14, 8), m.trim);
      mouth.position.set(sx * tW * 0.32, torsoCY + tH * 0.35 + 0.5, -0.5 * B);
      upper.add(mouth);
    }
  } else {
    for (const sx of [-1, 1])
      upper.add(mBox(0.3, 0.7, 0.3, m.steel, sx * 0.45, torsoCY - tH * 0.05, -0.5 * B));
  }

  upper.rotation.x = spec.lean ?? 0;
  group.add(upper);

  // ---- flight wings (hidden until airborne) -------------------------------
  const wings = mechWings(spec.wings, m, torsoCY + tH * 0.3);
  wings.visible = false;
  group.add(wings);

  group.scale.setScalar(spec.scale);
  return { group, wings, core, armR, sword: weapon };
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

// --- winter / volcanic / cave landmark props --------------------------------

/** A low-poly irregular disc lying flat (XZ plane, thin Y jitter) — a fan of
 *  triangles from the centre with per-edge radius + height noise, so it reads
 *  as a blobby puddle rather than a perfect circle. Shared by the lava pool
 *  and the volcano's crater floor. */
function irregularBlobGeometry(rBase: number, jag: number, segs: number, seed: number, riseJitter: number): THREE.BufferGeometry {
  const rand = seeded(seed);
  const radii: number[] = [];
  const heights: number[] = [];
  for (let i = 0; i < segs; i++) {
    radii.push(rBase * (1 - jag * 0.5 + rand() * jag));
    heights.push((rand() - 0.5) * riseJitter);
  }
  const pos: number[] = [];
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = (j / segs) * Math.PI * 2;
    const x0 = Math.cos(a0) * radii[i], z0 = Math.sin(a0) * radii[i];
    const x1 = Math.cos(a1) * radii[j], z1 = Math.sin(a1) * radii[j];
    pos.push(0, (heights[i] + heights[j]) * 0.25, 0, x0, heights[i], z0, x1, heights[j], z1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A flat irregular ring (annulus) between a noisy inner and outer radius —
 *  the cooled-basalt crust rim around a lava pool. */
function irregularRingGeometry(rInner: number, rOuter: number, jag: number, segs: number, seed: number, riseJitter: number): THREE.BufferGeometry {
  const rand = seeded(seed);
  const inner: number[] = [];
  const outer: number[] = [];
  const heights: number[] = [];
  for (let i = 0; i < segs; i++) {
    inner.push(rInner * (1 - jag * 0.3 + rand() * jag * 0.6));
    outer.push(rOuter * (1 - jag * 0.5 + rand() * jag));
    heights.push((rand() - 0.5) * riseJitter);
  }
  const pos: number[] = [];
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    const a0 = (i / segs) * Math.PI * 2, a1 = (j / segs) * Math.PI * 2;
    const xi0 = Math.cos(a0) * inner[i], zi0 = Math.sin(a0) * inner[i];
    const xo0 = Math.cos(a0) * outer[i], zo0 = Math.sin(a0) * outer[i];
    const xi1 = Math.cos(a1) * inner[j], zi1 = Math.sin(a1) * inner[j];
    const xo1 = Math.cos(a1) * outer[j], zo1 = Math.sin(a1) * outer[j];
    const hi0 = heights[i] * 0.4, ho0 = heights[i];
    const hi1 = heights[j] * 0.4, ho1 = heights[j];
    pos.push(xi0, hi0, zi0, xo0, ho0, zo0, xo1, ho1, zo1);
    pos.push(xi0, hi0, zi0, xo1, ho1, zo1, xi1, hi1, zi1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A faceted, weathered truncated cone: topR at local y=+height/2, bottomR at
 *  y=-height/2, open-ended (no caps), with per-vertex craggy radius jitter.
 *  The shared shape behind the volcano's outer flanks and its crater bowl. */
function faceCone(topR: number, bottomR: number, height: number, seed: number, jag: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(topR, bottomR, height, 12, 5, true);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const yf = (y + height / 2) / height;
    const h = dirHash(Math.cos(ang) * 3, yf * 6 + seed * 0.001, Math.sin(ang) * 3);
    const bulge = 1 + (h - 0.5) * jag * (1 - yf * 0.35);
    pos.setXYZ(i, x * bulge, y, z * bulge);
  }
  const ng = geo.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

// --- snowman -----------------------------------------------------------

/** A classic low-poly snowman: two stacked faceted icosahedron snowballs,
 *  coal eyes + buttons, a carrot cone nose, thin twig arms and a tiny scarf.
 *  ~2.2m tall. */
export function makeSnowman(): THREE.Group {
  const g = new THREE.Group();
  const snow = new THREE.MeshStandardMaterial({ color: 0xf3f7fb, roughness: 0.85, metalness: 0, flatShading: true });
  const coal = new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.6, flatShading: true });
  const carrot = new THREE.MeshStandardMaterial({ color: 0xf3720d, roughness: 0.6, flatShading: true });
  const twig = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.9, flatShading: true });
  const scarfMat = new THREE.MeshStandardMaterial({ color: 0xb4231f, roughness: 0.8, flatShading: true });

  // base + head, faceted icosahedra, nestled together
  const baseR = 0.75, headR = 0.5, overlap = 0.25;
  const baseY = baseR;
  const headY = baseY + baseR - overlap + headR;
  const base = new THREE.Mesh(new THREE.IcosahedronGeometry(baseR, 1), snow);
  base.position.y = baseY;
  g.add(base);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(headR, 1), snow);
  head.position.y = headY;
  g.add(head);

  // coal eyes
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), coal);
    eye.position.set(sx * 0.16, headY + 0.1, headR * 0.88);
    g.add(eye);
  }
  // carrot nose, tip pointing forward (+z)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 6), carrot);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, headY, headR * 0.9 + 0.05);
  g.add(nose);
  // three coal buttons down the base
  for (let i = 0; i < 3; i++) {
    const button = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), coal);
    button.position.set(0, baseY + 0.38 - i * 0.3, baseR * 0.9 - i * 0.06);
    g.add(button);
  }
  // twig arms, thin and angled up-and-out, with a little forked tip
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.95, 5), twig);
    arm.position.set(sx * (baseR * 0.85), headY - 0.35, 0);
    arm.rotation.z = sx * -1.0;
    arm.rotation.x = 0.2;
    g.add(arm);
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.3, 4), twig);
    fork.position.set(sx * (baseR * 0.85 + 0.72), headY - 0.05, 0.08);
    fork.rotation.z = sx * -0.4;
    g.add(fork);
  }
  // tiny scarf at the neck: a squat torus + a hanging tail
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(headR * 0.72, 0.14, 5, 10), scarfMat);
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = headY - headR * 0.62;
  g.add(scarf);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.05), scarfMat);
  tail.position.set(headR * 0.5, headY - headR * 0.62 - 0.32, headR * 0.4);
  tail.rotation.z = 0.2;
  g.add(tail);

  return g;
}

// --- volcano & lava ----------------------------------------------------

/** A big landmark volcano: a craggy dark-basalt cone, faceted and flat-
 *  shaded, truncated into a crater whose heat-darkened bowl walls fall to a
 *  bright emissive lava pool at the floor, rimmed with a glowing lip and
 *  capped with a few faint drifting smoke puffs. ~56m tall. */
export function makeVolcano(pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();
  const height = 56;
  const baseR = 30;
  const rimR = 8.5;
  const craterDepth = 11;
  const lavaR = 4.6;

  // outer flanks: dark craggy basalt, hazier grey toward the summit
  const coneGeo = faceCone(rimR, baseR, height, 900, 0.32);
  coneGeo.translate(0, height / 2, 0);
  paintByHeight(coneGeo, 0, 0, height,
    new THREE.Color(0x120f0d),
    new THREE.Color(0x4a4038).lerp(new THREE.Color(pal.mountain), 0.25));
  const cone = new THREE.Mesh(coneGeo, new THREE.MeshStandardMaterial({
    color: 0x33291f, roughness: 1, metalness: 0.05, flatShading: true, vertexColors: true, side: THREE.DoubleSide,
  }));
  g.add(cone);

  // crater bowl: same craggy shape, tapering down to the lava floor, heat-darkened
  const bowlGeo = faceCone(rimR, lavaR, craterDepth, 901, 0.18);
  bowlGeo.translate(0, craterDepth / 2, 0);
  paintByHeight(bowlGeo, 0, 0, craterDepth,
    new THREE.Color(0x2a0a04),
    new THREE.Color(0x2c2620));
  const bowl = new THREE.Mesh(bowlGeo, new THREE.MeshStandardMaterial({
    color: 0x2c2216, roughness: 1, metalness: 0.05, flatShading: true, vertexColors: true, side: THREE.DoubleSide,
  }));
  bowl.position.y = height - craterDepth;
  g.add(bowl);

  // glowing lava pool + cooled crust ring at the crater floor
  const lava = new THREE.Mesh(
    irregularBlobGeometry(lavaR * 0.92, 0.3, 11, 902, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0xff5a1f, emissive: 0xff3300, emissiveIntensity: 4.2, roughness: 0.6, flatShading: true,
    })
  );
  lava.position.y = height - craterDepth + 0.2;
  g.add(lava);
  const crust = new THREE.Mesh(
    irregularRingGeometry(lavaR * 0.85, lavaR * 1.05, 0.28, 12, 903, 0.25),
    new THREE.MeshStandardMaterial({ color: 0x1c1613, roughness: 1, flatShading: true })
  );
  crust.position.y = height - craterDepth + 0.05;
  g.add(crust);

  // glowing rim lip tracing the crater edge
  const rimGlow = new THREE.Mesh(
    new THREE.TorusGeometry(rimR, 0.4, 4, 16),
    new THREE.MeshStandardMaterial({ color: 0xffb37a, emissive: 0xff5a1f, emissiveIntensity: 1.6, flatShading: true })
  );
  rimGlow.rotation.x = Math.PI / 2;
  rimGlow.position.y = height;
  g.add(rimGlow);

  // faint smoke puffs drifting above the summit
  const smokeMat = new THREE.MeshStandardMaterial({
    color: 0x2e2b28, roughness: 1, transparent: true, opacity: 0.28, flatShading: true,
  });
  let py = height + 5;
  for (let i = 0; i < 4; i++) {
    const s = 3 + i * 2.1;
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), smokeMat);
    puff.scale.y = 0.65;
    puff.position.set((i % 2 ? 1 : -1) * i * 1.4, py, (i % 2 ? -1 : 1) * i * 1.0);
    g.add(puff);
    py += s * 1.2;
  }

  return g;
}

/** A flat, irregular molten lava pool (~13m across): a bright emissive blob
 *  with a couple of hotter facets breaking through, ringed by a darker
 *  cooled-basalt crust. Sits flush with the ground (y≈0). */
export function makeLavaPool(): THREE.Group {
  const g = new THREE.Group();
  const R = 6.2;

  const lava = new THREE.Mesh(
    irregularBlobGeometry(R, 0.32, 12, 4110, 0.35),
    new THREE.MeshStandardMaterial({
      color: 0xff5a1f, emissive: 0xff3300, emissiveIntensity: 3.6, roughness: 0.6, flatShading: true,
    })
  );
  lava.position.y = 0.08;
  g.add(lava);

  const hotMat = new THREE.MeshStandardMaterial({
    color: 0xffcf8a, emissive: 0xffb020, emissiveIntensity: 5.5, flatShading: true,
  });
  for (const [x, z, s] of [[-1.6, 0.8, 1.1], [2.0, -1.4, 0.85]] as const) {
    const hot = new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), hotMat);
    hot.scale.y = 0.12;
    hot.position.set(x, 0.12, z);
    g.add(hot);
  }

  const crust = new THREE.Mesh(
    irregularRingGeometry(R * 0.9, R * 1.35, 0.3, 13, 4111, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x1c1613, roughness: 1, flatShading: true })
  );
  crust.position.y = 0.03;
  g.add(crust);

  return g;
}

// --- cave mouth ----------------------------------------------------------

/** A chunky, mossy forest rock outcrop with a dark arched cave opening at its
 *  base (~16m across). Faceted rock chunks (styled like makeRockField's
 *  boulders) cluster around a central gap; a near-black recessed arch + short
 *  tunnel reads as the cave interior. The opening faces local +z. */
export function makeCaveMouth(pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();

  // the rock mound: clustered faceted chunks around a central gap
  const chunkSpecs: { x: number; y: number; z: number; r: number; detail: 0 | 1 }[] = [
    { x: -5.4, y: 0, z: 0.4, r: 3.0, detail: 1 },
    { x: 5.4, y: 0, z: 0.3, r: 3.0, detail: 1 },
    { x: -2.6, y: 3.1, z: -1.7, r: 2.6, detail: 1 },
    { x: 2.7, y: 3.3, z: -1.8, r: 2.7, detail: 0 },
    { x: -4.2, y: 4.4, z: -0.9, r: 1.9, detail: 0 },
    { x: 4.4, y: 4.7, z: -1.1, r: 1.8, detail: 0 },
    { x: 0.1, y: 5.6, z: -2.5, r: 2.7, detail: 0 },
  ];
  const parts: THREE.BufferGeometry[] = [];
  for (const c of chunkSpecs) {
    const cg = new THREE.IcosahedronGeometry(c.r, c.detail);
    const p = cg.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const len = Math.hypot(x, y, z) || 1;
      const nx = x / len, ny = y / len, nz = z / len;
      const rr = len * (0.78 + 0.42 * dirHash(nx + c.x * 0.07, ny + c.y * 0.07, nz + c.z * 0.07));
      let yy = ny * rr;
      if (yy < 0) yy *= 0.35; // bury the underside
      p.setXYZ(i, nx * rr, yy, nz * rr);
    }
    const ng = cg.toNonIndexed();
    ng.translate(c.x, c.y, c.z);
    parts.push(ng);
  }
  const moundGeo = mergePosUV(parts);
  moundGeo.computeVertexNormals();
  moundGeo.computeBoundingBox();
  const bb = moundGeo.boundingBox!;
  moundGeo.translate(0, -bb.min.y, 0);
  const mossLow = new THREE.Color(pal.clutter).offsetHSL(0, 0, -0.3);
  paintByHeight(moundGeo, 0, 0, bb.max.y - bb.min.y, mossLow, new THREE.Color(1.05, 1.02, 0.95));

  const lib = pbr();
  let rockMat: THREE.MeshStandardMaterial;
  if (lib) {
    const t = tileSet(lib.rock, 1);
    rockMat = new THREE.MeshStandardMaterial({
      map: t.diff, normalMap: t.nor, color: 0x8a8a8a, metalness: 0.1, roughness: 0.96, flatShading: true, vertexColors: true,
    });
    if (t.arm) { rockMat.roughnessMap = t.arm; rockMat.roughness = 1; rockMat.aoMap = t.arm; rockMat.aoMapIntensity = 0.85; }
  } else {
    const stone = stoneMaps(pal.mountainDark);
    rockMat = new THREE.MeshStandardMaterial({
      color: pal.mountainDark, map: stone.map, bumpMap: stone.bump, bumpScale: 0.2,
      metalness: 0.1, roughness: 0.96, flatShading: true, vertexColors: true,
    });
  }
  g.add(new THREE.Mesh(moundGeo, rockMat));

  // the dark cave interior: a near-black arch filling the gap, plus a
  // recessed tunnel + back cap so it still reads dark from an angle
  const archMat = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 1, metalness: 0 });
  const archW = 4.2, archH = 5.2;
  const shape = new THREE.Shape();
  shape.moveTo(-archW / 2, 0);
  shape.lineTo(-archW / 2, archH * 0.5);
  shape.quadraticCurveTo(-archW / 2, archH, 0, archH);
  shape.quadraticCurveTo(archW / 2, archH, archW / 2, archH * 0.5);
  shape.lineTo(archW / 2, 0);
  shape.closePath();
  const archFace = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), archMat);
  archFace.position.set(0, 0, -0.3);
  g.add(archFace);

  const throatDepth = 4.5;
  const throatR = archW * 0.42;
  const throat = new THREE.Mesh(
    new THREE.CylinderGeometry(throatR, throatR * 0.75, throatDepth, 8, 1, true),
    archMat
  );
  throat.rotation.x = Math.PI / 2;
  throat.position.set(0, archH * 0.4, -0.3 - throatDepth / 2);
  g.add(throat);
  const cap = new THREE.Mesh(new THREE.CircleGeometry(throatR * 0.76, 8), archMat);
  cap.position.set(0, archH * 0.4, -0.3 - throatDepth);
  g.add(cap);

  // moss tufts and loose rubble at the base for an earthy forest read
  const mossPatchMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.clutter).offsetHSL(0, 0.05, -0.02), roughness: 1, flatShading: true,
  });
  const rand = seeded(2026);
  for (let i = 0; i < 8; i++) {
    const a = rand() * Math.PI * 2;
    const rr = 3 + rand() * 6.5;
    const patch = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4 + rand() * 0.35, 0), mossPatchMat);
    patch.scale.y = 0.35;
    patch.position.set(Math.cos(a) * rr, 0.1 + rand() * 3.5, Math.sin(a) * rr * 0.6 - 0.5);
    g.add(patch);
  }
  const rubbleGeo = boulderGeometry();
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2;
    const rr = 6 + rand() * 3;
    const rock = new THREE.Mesh(rubbleGeo, rockMat);
    rock.scale.setScalar(0.7 + rand() * 0.9);
    rock.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr * 0.7 + 1.5);
    rock.rotation.y = rand() * Math.PI * 2;
    g.add(rock);
  }

  return g;
}

// --- storybook mushroom & standalone rock props ----------------------------
// Faceted low-poly replacements for the old imported mushroom/rock GLTF
// models, built in the same style as the reworked trees: primitive shapes,
// flatShading, a seeded per-instance rand() for jitter — cheap enough (a
// handful of small meshes each) to scatter by the hundreds as roadside
// clutter.

const ROCK_PROP_COLOR = 0x847e76;

/**
 * A charming faceted toadstool: a flattened faceted half-sphere cap (NOT a
 * cone) in warm red/orange with a few raised lighter spots on the crown, a
 * pale ridged gill underside, and a creamy tapered stalk with a bulged base
 * and a thin skirt ring just below the cap. `tall` swaps in a taller,
 * slimmer body topped with a smaller cap. Every instance gets a gentle
 * rand()-driven jitter (hue, proportions, spot placement, lean) so a cluster
 * reads as a storybook family rather than stamped clones. ~1.2m normal,
 * ~1.8m tall.
 */
export function makeMushroom(rand: () => number, tall = false): THREE.Group {
  const g = new THREE.Group();

  const capColor = new THREE.Color(tall ? 0xcf3a1d : 0xd6301c)
    .offsetHSL((rand() - 0.5) * 0.04, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08);
  const capMat = new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.85, metalness: 0.02, flatShading: true });
  const spotMat = new THREE.MeshStandardMaterial({ color: 0xfff6e4, roughness: 0.7, flatShading: true });
  const gillMat = new THREE.MeshStandardMaterial({ color: 0xf2e4c4, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
  const stalkMat = new THREE.MeshStandardMaterial({ color: 0xf6ecd2, roughness: 0.85, flatShading: true });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xe6d7b4, roughness: 0.85, flatShading: true });

  // --- proportions: total height H spans ground -> cap apex ---------------
  const H = tall ? 1.7 + rand() * 0.2 : 1.1 + rand() * 0.2;
  const capR = tall ? H * 0.16 : H * 0.25;
  const capFlat = tall ? 0.5 : 0.62;
  const capApex = capR * capFlat;
  const stalkTop = H - capApex;               // height of the rim under the cap
  const stalkR = tall ? H * 0.05 : H * 0.1;
  const bulbH = stalkTop * 0.16;
  const shaftH = stalkTop - bulbH;

  // --- stalk: a squashed bulb base + a tapered shaft -----------------------
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(stalkR * 1.5, 8, 5), stalkMat);
  bulb.scale.y = 0.6;
  bulb.position.y = bulbH * 0.5;
  g.add(bulb);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(stalkR * 0.82, stalkR * 1.15, shaftH, 8), stalkMat);
  shaft.position.y = bulbH + shaftH / 2;
  g.add(shaft);

  // thin skirt ring, just under the cap
  const ring = new THREE.Mesh(new THREE.TorusGeometry(stalkR, stalkR * 0.3, 4, 12), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = stalkTop * 0.92;
  g.add(ring);

  // --- cap: a flattened faceted dome (half-sphere), never a cone ----------
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(capR, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2),
    capMat
  );
  cap.scale.y = capFlat;
  cap.position.y = stalkTop;
  g.add(cap);

  // pale gilled underside: a shallow open cone, wide at the cap rim and
  // narrowing toward the stalk — its low-segment facets read as radial gill
  // ridges rather than a flat disc
  const gillH = capR * 0.22;
  const gills = new THREE.Mesh(
    new THREE.CylinderGeometry(capR * 0.97, capR * 0.3, gillH, 14, 1, true),
    gillMat
  );
  gills.position.y = stalkTop - gillH / 2 - 0.01;
  g.add(gills);

  // a few raised lighter spots scattered over the crown of the cap, glued
  // flush against its curved surface (same radial-placement trick as the
  // mine's spikes)
  const spotCount = 3 + Math.floor(rand() * 3);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < spotCount; i++) {
    const phi = rand() * Math.PI * 0.4;       // stays near the crown, not the rim
    const theta = rand() * Math.PI * 2;
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);
    const dir = new THREE.Vector3(nx, ny * capFlat, nz).normalize();
    const spotR = capR * (0.1 + rand() * 0.06);
    const spot = new THREE.Mesh(
      new THREE.SphereGeometry(spotR, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      spotMat
    );
    spot.quaternion.setFromUnitVectors(up, dir);
    spot.position.set(nx * capR, stalkTop + ny * capR * capFlat, nz * capR).addScaledVector(dir, spotR * 0.1);
    g.add(spot);
  }

  // gentle per-instance jitter — lean, yaw, overall scale — so a patch of
  // mushrooms doesn't read as identical stamped clones
  g.rotation.y = rand() * Math.PI * 2;
  g.rotation.z = (rand() - 0.5) * 0.06;
  g.rotation.x = (rand() - 0.5) * 0.04;
  g.scale.setScalar(0.92 + rand() * 0.16);

  return g;
}

/**
 * A standalone believable boulder: 1-3 clustered lumpy chunks built with the
 * same displaced-icosahedron trick as boulderGeometry() (weathered per-vertex
 * bulge, flattened buried underside), merged into one buffer so it's a single
 * draw call, textured with the real rock PBR set via pbr()/tileSet(lib.rock)
 * when available (falling back to the procedural stoneMaps, exactly like
 * makeRockField), with a baked shaded-base -> lit-crest vertex-colour gradient
 * (subtle per-instance tonal jitter on top). Reads like one of makeRockField's
 * instanced boulders, just as its own standalone group. ~2-4m.
 */
export function makeRockProp(rand: () => number): THREE.Group {
  const group = new THREE.Group();

  const n = 1 + Math.floor(rand() * 3); // 1..3 chunks
  const mainR = 0.85 + rand() * 0.35;
  const chunks: { r: number; x: number; y: number; z: number; sy: number; detail: number; yaw: number }[] = [
    { r: mainR, x: 0, y: 0, z: 0, sy: 0.78 + rand() * 0.14, detail: 1, yaw: rand() * Math.PI },
  ];
  for (let i = 1; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const cr = mainR * (0.42 + rand() * 0.28);
    const dist = mainR * (0.5 + rand() * 0.4);
    chunks.push({
      r: cr,
      x: Math.cos(a) * dist, y: -mainR * 0.15 + rand() * 0.1, z: Math.sin(a) * dist,
      sy: 0.7 + rand() * 0.2, detail: rand() < 0.5 ? 0 : 1, yaw: rand() * Math.PI,
    });
  }

  const parts: THREE.BufferGeometry[] = [];
  for (const ch of chunks) {
    const cg = new THREE.IcosahedronGeometry(ch.r, ch.detail);
    const p = cg.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const len = Math.hypot(x, y, z) || 1;
      const nx = x / len, ny = y / len, nz = z / len;
      const rr = len * (0.8 + 0.44 * dirHash(nx + ch.x * 0.1, ny + ch.y * 0.1, nz + ch.z * 0.1));
      let yy = ny * rr;
      if (yy < 0) yy *= 0.4; // flatten the buried underside
      p.setXYZ(i, nx * rr, yy, nz * rr);
    }
    const ng = cg.toNonIndexed();
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

  // same shaded-base -> lit-crest gradient as boulderGeometry(), with a
  // subtle per-instance tonal jitter so a run of standalone rocks still
  // reads as a varied field rather than identical props
  const lowJ = 0.06 * (rand() - 0.5), hiJ = 0.1 * (rand() - 0.5);
  paintByHeight(
    geo, 0, 0, bb.max.y - bb.min.y,
    new THREE.Color(0.52 + lowJ, 0.53 + lowJ, 0.57 + lowJ),
    new THREE.Color(1.08 + hiJ, 1.05 + hiJ, 0.99 + hiJ)
  );

  const rawHeight = (bb.max.y - bb.min.y) || 1;
  const target = 2 + rand() * 2; // ~2-4m tall, whatever the raw chunk cluster came out to
  const scale = target / rawHeight;

  const lib = pbr();
  let mat: THREE.MeshStandardMaterial;
  if (lib) {
    const t = tileSet(lib.rock, 1);
    mat = new THREE.MeshStandardMaterial({
      map: t.diff, normalMap: t.nor, color: 0x8a8a8a, metalness: 0.1, roughness: 0.96,
      flatShading: true, vertexColors: true,
    });
    if (t.arm) { mat.roughnessMap = t.arm; mat.roughness = 1; mat.aoMap = t.arm; mat.aoMapIntensity = 0.85; }
  } else {
    const stone = stoneMaps(ROCK_PROP_COLOR);
    mat = new THREE.MeshStandardMaterial({
      color: ROCK_PROP_COLOR, map: stone.map, bumpMap: stone.bump, bumpScale: 0.2,
      metalness: 0.1, roughness: 0.96, flatShading: true, vertexColors: true,
    });
  }

  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(scale);
  mesh.rotation.y = rand() * Math.PI * 2;
  group.add(mesh);

  return group;
}

/** Collect a built tree's geometry into one merged geometry per material.
 *  Local transforms are baked, and the group's own random yaw is deliberately
 *  NOT baked — yaw is applied per instance instead, so a handful of variants
 *  still yields a forest where no two trees face the same way. */
function treeVariantGeometry(rand: () => number, mats: TreeMats, kind: TreeKind) {
  const g = makeTree(rand, mats, kind);
  g.rotation.y = 0;                    // per-instance yaw supplies the variety
  g.updateMatrixWorld(true);
  const inv = g.matrixWorld.clone().invert();
  const trunk: THREE.BufferGeometry[] = [];
  const leaf: THREE.BufferGeometry[] = [];
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m as unknown as { isMesh?: boolean }).isMesh) return;
    let geo = m.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    (m.material === mats.foliage ? leaf : trunk).push(geo);
  });
  // A bucket can only merge if every geometry carries the same attributes, and
  // paintByHeight adds `color` to the canopy only — so normalise per bucket.
  const norm = (list: THREE.BufferGeometry[], wantColor: boolean) => {
    for (const geo of list) {
      if (wantColor && !geo.attributes.color) {
        const n = geo.attributes.position.count;
        const c = new Float32Array(n * 3).fill(1);
        geo.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
      }
      if (!wantColor && geo.attributes.color) geo.deleteAttribute("color");
      if (!geo.attributes.uv) {
        const n = geo.attributes.position.count;
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      }
    }
    return list.length ? mergeGeometries(list, false) : null;
  };
  return { trunk: norm(trunk, false), leaf: norm(leaf, true) };
}

/** A whole forest as a handful of draw calls.
 *
 *  Trees were the single biggest cost in the scene: each one was its own Group of
 *  meshes, and because the renderer is DRAW-CALL bound the tree count converted
 *  almost linearly into frame time (10.5k meshes measured 24 ms). Grass has
 *  always been cheap for exactly one reason — it's instanced. This does the same
 *  for trees: build `variants` distinct trees, then draw every placement of each
 *  variant in ONE instanced call per material. Cost becomes variants x 2 draw
 *  calls no matter how many thousand trees are placed, so density is essentially
 *  free and can go far past what per-mesh placement could afford. */
export function makeTreeField(
  rand: () => number,
  mats: TreeMats,
  spots: { kind: TreeKind; x: number; y: number; z: number; s: number; r: number }[],
  variantsPerKind = 6
): THREE.Group {
  const out = new THREE.Group();
  const kinds: TreeKind[] = ["pine", "round", "tall"];
  for (const kind of kinds) {
    const mine = spots.filter((sp) => sp.kind === kind);
    if (!mine.length) continue;
    const variants = [];
    for (let v = 0; v < variantsPerKind; v++) variants.push(treeVariantGeometry(rand, mats, kind));
    // deal the placements round-robin so variants are evenly mixed along the road
    const buckets: typeof mine[] = variants.map(() => []);
    mine.forEach((sp, i) => buckets[i % variants.length].push(sp));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    variants.forEach((varGeo, vi) => {
      const list = buckets[vi];
      if (!list.length) return;
      for (const [geo, mat] of [[varGeo.trunk, mats.trunk], [varGeo.leaf, mats.foliage]] as const) {
        if (!geo) continue;
        const inst = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((sp, i) => {
          q.setFromAxisAngle(up, sp.r);
          pos.set(sp.x, sp.y, sp.z);
          scl.set(sp.s, sp.s, sp.s);
          m.compose(pos, q, scl);
          inst.setMatrixAt(i, m);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = true;
        inst.receiveShadow = true;
        out.add(inst);
      }
    });
  }
  return out;
}
