import * as THREE from "three";
import type { WeatherKind, RealmPalette } from "./realms";

/**
 * Camera-following weather / atmosphere for the kart racer.
 *
 * Every field is a cloud of soft sprites (THREE.Points) that lives in a volume
 * ±{@link HALF} on X/Z centred on the camera and 0..{@link Y_TOP} in world Y.
 * `update()` integrates each mote by its velocity and wraps anything that
 * leaves the box back to the far side, so the effect surrounds the car forever
 * no matter how far it drives. X/Z ride the camera; Y is world-space so falling
 * snow/rain cover a fixed column and ground fog truly hugs the terrain.
 *
 * The engine adds `object` to the scene once, calls `update(time, camPos)` each
 * frame, and `dispose()` on teardown.
 */
export interface WeatherSystem {
  object: THREE.Object3D;
  update(t: number, camPos: THREE.Vector3): void;
  dispose(): void;
}

// half-extent of the follow box on X and Z (centred on the camera each frame)
const HALF = 180;
// the volume rises from the ground to ~90 units up
const Y_TOP = 90;

// --- deterministic RNG (same LCG the rest of the engine seeds with) ---------

function makeRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// --- colour helpers ---------------------------------------------------------

function col(x: THREE.ColorRepresentation): THREE.Color {
  return new THREE.Color(x);
}
function mix(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return a.clone().lerp(b, t);
}

// --- sprite textures --------------------------------------------------------

/** Soft round mote — a radial-gradient sprite (same idea as objects' dotSprite). */
function softDot(): THREE.Texture {
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

/** A thin tall streak on a SQUARE canvas — Points render square sprites, so a
 *  non-square texture would be squished into a dot. Square keeps it a streak. */
function streakSprite(): THREE.Texture {
  const S = 48;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  // a narrow bright vertical bar down the middle, soft left/right falloff
  const h = ctx.createLinearGradient(S / 2 - 5, 0, S / 2 + 5, 0);
  h.addColorStop(0, "rgba(255,255,255,0)");
  h.addColorStop(0.5, "rgba(255,255,255,1)");
  h.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = h;
  ctx.fillRect(S / 2 - 5, 2, 10, S - 4);
  // fade the top and bottom of the streak
  ctx.globalCompositeOperation = "destination-in";
  const v = ctx.createLinearGradient(0, 0, 0, S);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(0.12, "rgba(0,0,0,1)");
  v.addColorStop(0.88, "rgba(0,0,0,1)");
  v.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "source-over";
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- a single particle layer ------------------------------------------------

interface LayerOpts {
  count: number;
  color: THREE.Color;
  size: number;
  opacity: number;
  blending: THREE.Blending;
  texture: THREE.Texture;
  yMin: number;
  yMax: number;
  // constant drift velocity, units/second
  vx: number;
  vy: number;
  vz: number;
  // per-particle multiplier spread applied to the drift (0 = uniform)
  vjitter: number;
  // sinusoidal wobble amplitudes layered on top of the drift
  swayX: number;
  swayY: number;
  swayZ: number;
  swayFreq: number;
  // >0 oscillates per-particle brightness (twinkle / flicker / fade in-out)
  twinkle: number;
  twinkleFreq: number;
  // let a subset of particles pop brighter than base (embers)
  pulse?: boolean;
  seed: number;
}

interface Layer {
  points: THREE.Points;
  step(t: number, dt: number, camPos: THREE.Vector3): void;
  dispose(): void;
}

function wrap(v: number, lo: number, hi: number): number {
  const span = hi - lo;
  while (v < lo) v += span;
  while (v >= hi) v -= span;
  return v;
}

function makeLayer(o: LayerOpts): Layer {
  const rand = makeRand(o.seed);
  const n = o.count;

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);   // world position handed to the GPU
  const off = new Float32Array(n * 3);   // offset from the camera (X/Z) + world Y
  const spd = new Float32Array(n);       // per-particle velocity multiplier
  const phase = new Float32Array(n);     // 0..1 sway / twinkle phase
  const pulse = new Float32Array(n);     // 1 = this particle pops brighter

  for (let i = 0; i < n; i++) {
    off[i * 3] = (rand() * 2 - 1) * HALF;
    off[i * 3 + 1] = o.yMin + rand() * (o.yMax - o.yMin);
    off[i * 3 + 2] = (rand() * 2 - 1) * HALF;
    spd[i] = 1 + (rand() - 0.5) * o.vjitter;
    phase[i] = rand();
    pulse[i] = o.pulse && rand() < 0.25 ? 1 : 0;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

  const base = o.color;
  const twinkles = o.twinkle > 0;
  let colAttr: THREE.BufferAttribute | null = null;
  if (twinkles) {
    // per-point RGB carries the tint * brightness so each mote twinkles alone
    const carr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      carr[i * 3] = base.r;
      carr[i * 3 + 1] = base.g;
      carr[i * 3 + 2] = base.b;
    }
    colAttr = new THREE.BufferAttribute(carr, 3);
    geo.setAttribute("color", colAttr);
  }

  const mat = new THREE.PointsMaterial({
    color: twinkles ? 0xffffff : base,
    map: o.texture,
    size: o.size,
    sizeAttenuation: true,
    transparent: true,
    opacity: o.opacity,
    depthWrite: false,
    blending: o.blending,
    vertexColors: twinkles,
    fog: false,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // wrapping puts motes anywhere in the box
  points.renderOrder = 2;

  const step = (t: number, dt: number, camPos: THREE.Vector3) => {
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      const s = spd[i];
      // integrate drift, then wrap back to the far side of the box
      let ox = wrap(off[i * 3] + o.vx * s * dt, -HALF, HALF);
      let oy = wrap(off[i * 3 + 1] + o.vy * s * dt, o.yMin, o.yMax);
      let oz = wrap(off[i * 3 + 2] + o.vz * s * dt, -HALF, HALF);
      off[i * 3] = ox;
      off[i * 3 + 1] = oy;
      off[i * 3 + 2] = oz;

      const ph = phase[i] * Math.PI * 2;
      const sx = o.swayX * Math.sin(t * o.swayFreq + ph);
      const sy = o.swayY * Math.sin(t * o.swayFreq * 1.2 + ph * 0.7);
      const sz = o.swayZ * Math.cos(t * o.swayFreq * 0.83 + ph * 1.3);
      // X/Z follow the camera; Y stays in world space
      p.setXYZ(i, camPos.x + ox + sx, oy + sy, camPos.z + oz + sz);

      if (colAttr) {
        const tw = 0.5 + 0.5 * Math.sin(t * o.twinkleFreq + ph);
        let f = 1 - o.twinkle + o.twinkle * tw;
        if (pulse[i]) f += 0.6 * Math.max(0, Math.sin(t * o.twinkleFreq * 0.5 + ph * 1.7));
        colAttr.setXYZ(i, base.r * f, base.g * f, base.b * f);
      }
    }
    p.needsUpdate = true;
    if (colAttr) colAttr.needsUpdate = true;
  };

  const dispose = () => {
    geo.dispose();
    mat.dispose();
  };

  return { points, step, dispose };
}

// --- the factory ------------------------------------------------------------

/**
 * Build the atmosphere for a realm's {@link WeatherKind}. Colours are derived
 * from the realm palette so each system reads as part of its world.
 */
export function makeWeather(kind: WeatherKind, pal: RealmPalette): WeatherSystem {
  const group = new THREE.Group();

  if (kind === "none") {
    return { object: group, update: () => {}, dispose: () => {} };
  }

  const textures: THREE.Texture[] = [];
  const dot = softDot();
  textures.push(dot);

  const layers: Layer[] = [];
  const add = (o: LayerOpts) => {
    const layer = makeLayer(o);
    layers.push(layer);
    group.add(layer.points);
  };

  switch (kind) {
    // Crystal Peaks — calm, dense snowfall. Two sizes of soft white flakes
    // drift straight down with a gentle sideways sway.
    case "snow": {
      const white = mix(col(pal.laneLine), col(0xffffff), 0.5);
      add({
        count: 250, color: white, size: 0.9, opacity: 0.55,
        blending: THREE.NormalBlending, texture: dot, yMin: 0, yMax: Y_TOP - 5,
        vx: 0, vy: -8, vz: 0, vjitter: 0.5,
        swayX: 7, swayY: 2, swayZ: 7, swayFreq: 0.5,
        twinkle: 0, twinkleFreq: 0, seed: 1001,
      });
      add({
        // smaller + fewer big flakes: sizeAttenuation was ballooning near-camera
        // flakes into big white blobs that blotted out the road
        count: 110, color: white, size: 1.4, opacity: 0.5,
        blending: THREE.NormalBlending, texture: dot, yMin: 0, yMax: Y_TOP - 5,
        vx: 0, vy: -6.5, vz: 0, vjitter: 0.5,
        swayX: 9, swayY: 2, swayZ: 9, swayFreq: 0.45,
        twinkle: 0, twinkleFreq: 0, seed: 1002,
      });
      // blowing-snow / avalanche-dust: a broad low drift driven hard sideways by
      // wind, filling the mid-distance for a blizzardy mountain feel. Sizes and
      // opacity kept small — sizeAttenuation is what ballooned near-camera
      // flakes into blobs before, so this layer stays fine and faint.
      add({
        count: 300, color: white, size: 1.3, opacity: 0.4,
        blending: THREE.NormalBlending, texture: dot, yMin: 0, yMax: 32,
        vx: 24, vy: -3, vz: 6, vjitter: 0.7,
        swayX: 14, swayY: 3, swayZ: 10, swayFreq: 0.7,
        twinkle: 0.2, twinkleFreq: 1.2, seed: 1003,
      });
      break;
    }

    // Ember Wastes — a live volcanic sky. Glowing embers rise and flicker
    // (some pulsing brighter) while dark ash sifts down.
    case "ember": {
      const emberCol = mix(col(pal.gem), col(0xff7a18), 0.35);
      add({
        count: 160, color: emberCol, size: 1.7, opacity: 0.8,
        blending: THREE.AdditiveBlending, texture: dot, yMin: 0, yMax: 80,
        vx: 0, vy: 9, vz: 0, vjitter: 0.6,
        swayX: 4, swayY: 2, swayZ: 4, swayFreq: 0.7,
        twinkle: 0.6, twinkleFreq: 6, pulse: true, seed: 2001,
      });
      add({
        count: 120, color: col(0x33322f), size: 1.4, opacity: 0.55,
        blending: THREE.NormalBlending, texture: dot, yMin: 0, yMax: 70,
        vx: 0, vy: -5, vz: 0, vjitter: 0.5,
        swayX: 6, swayY: 1.5, swayZ: 6, swayFreq: 0.5,
        twinkle: 0, twinkleFreq: 0, seed: 2002,
      });
      // firebugs — tiny bright ember-orange fireflies that rise slowly near the
      // ground and pulse hard, distinct from the big lazy embers above.
      add({
        count: 50, color: mix(col(0xff5b1f), col(0xffe08a), 0.35), size: 1.1, opacity: 0.9,
        blending: THREE.AdditiveBlending, texture: dot, yMin: 0, yMax: 30,
        vx: 0, vy: 3, vz: 0, vjitter: 0.7,
        swayX: 3, swayY: 1.5, swayZ: 3, swayFreq: 1.1,
        twinkle: 0.85, twinkleFreq: 9, pulse: true, seed: 2003,
      });
      // meteors — rare bright orange->white streaks falling steeply out of a
      // high sky, with a diagonal wind slant.
      {
        const streak = streakSprite();
        textures.push(streak);
        add({
          count: 10, color: mix(col(0xff8a00), col(0xffffff), 0.45), size: 7, opacity: 0.85,
          blending: THREE.AdditiveBlending, texture: streak, yMin: 0, yMax: Y_TOP,
          vx: -14, vy: -78, vz: -6, vjitter: 0.4,
          swayX: 0, swayY: 0, swayZ: 0, swayFreq: 0,
          twinkle: 0, twinkleFreq: 0, seed: 2004,
        });
      }
      break;
    }

    // Sunspire Sands — a gusty, hot sandstorm. Tan motes streak hard along +X
    // with turbulence, under a faint drifting haze.
    case "sand": {
      const sandCol = mix(col(pal.groundBase), col(0xe8caa0), 0.4); // brighter, dustier
      add({
        count: 440, color: sandCol, size: 2.6, opacity: 0.5,
        blending: THREE.NormalBlending, texture: dot, yMin: 0, yMax: 46,
        vx: 32, vy: -1, vz: 5, vjitter: 0.9,
        swayX: 4, swayY: 4, swayZ: 8, swayFreq: 1.4,
        twinkle: 0.35, twinkleFreq: 1.8, seed: 3001,
      });
      // big soft dust curtains blowing through — the storm haze
      add({
        count: 34, color: mix(sandCol, col(0xffffff), 0.4), size: 46, opacity: 0.16,
        blending: THREE.NormalBlending, texture: dot, yMin: 2, yMax: 52,
        vx: 15, vy: 0, vz: 3, vjitter: 0.5,
        swayX: 6, swayY: 2, swayZ: 8, swayFreq: 0.35,
        twinkle: 0.4, twinkleFreq: 0.6, seed: 3002,
      });
      break;
    }

    // Enchanted Forest — magical fireflies / pollen. Warm gold motes rise and
    // drift slowly while twinkling in and out.
    case "spores": {
      const sporeCol = col(0xffd98a);
      add({
        count: 160, color: sporeCol, size: 1.1, opacity: 0.6,
        blending: THREE.AdditiveBlending, texture: dot, yMin: 2, yMax: 55,
        vx: 0, vy: 3, vz: 0, vjitter: 0.6,
        swayX: 6, swayY: 4, swayZ: 6, swayFreq: 0.4,
        twinkle: 0.7, twinkleFreq: 2.2, seed: 4001,
      });
      // butterflies — small colourful motes fluttering low through the
      // foliage; fixed hues per layer fake the colour variety across the
      // flock (soft pink / amber / teal).
      add({
        count: 10, color: col(0xff9ecf), size: 1.4, opacity: 0.85,
        blending: THREE.NormalBlending, texture: dot, yMin: 1, yMax: 9,
        vx: 1.5, vy: 0.4, vz: 1, vjitter: 0.8,
        swayX: 5, swayY: 2.5, swayZ: 5, swayFreq: 1.6,
        twinkle: 0.5, twinkleFreq: 3.2, seed: 4002,
      });
      add({
        count: 9, color: col(0xffcf8a), size: 1.4, opacity: 0.85,
        blending: THREE.NormalBlending, texture: dot, yMin: 1, yMax: 9,
        vx: -1.2, vy: 0.5, vz: 1.4, vjitter: 0.8,
        swayX: 5, swayY: 2.5, swayZ: 5, swayFreq: 1.7,
        twinkle: 0.5, twinkleFreq: 3.0, seed: 4003,
      });
      add({
        count: 7, color: col(0x5eead4), size: 1.4, opacity: 0.85,
        blending: THREE.NormalBlending, texture: dot, yMin: 1, yMax: 9,
        vx: 1, vy: 0.4, vz: -1.3, vjitter: 0.8,
        swayX: 5, swayY: 2.5, swayZ: 5, swayFreq: 1.5,
        twinkle: 0.5, twinkleFreq: 3.4, seed: 4004,
      });
      break;
    }

    // Ravenspire Keep — spooky low fog. A few large translucent whitish-grey
    // puffs hug the ground, slide sideways and fade in and out.
    case "mist": {
      const mistCol = mix(col(pal.edgeLine), col(0x9aa2ae), 0.6);
      add({
        count: 40, color: mistCol, size: 24, opacity: 0.22,
        blending: THREE.NormalBlending, texture: dot, yMin: 0, yMax: 12,
        vx: 6, vy: 0, vz: 2, vjitter: 0.5,
        swayX: 3, swayY: 1, swayZ: 3, swayFreq: 0.25,
        twinkle: 0.7, twinkleFreq: 0.5, seed: 5001,
      });
      break;
    }

    // Neon Metro — wet-city night rain. Cool thin streaks fall fast and steep
    // with a slight wind slant.
    case "rain": {
      const streak = streakSprite();
      textures.push(streak);
      const rainCol = mix(col(pal.edgeLine), col(0xbcd4ff), 0.7);
      add({
        count: 520, color: rainCol, size: 4.0, opacity: 0.4,
        blending: THREE.NormalBlending, texture: streak, yMin: 0, yMax: Y_TOP,
        vx: -12, vy: -90, vz: 0, vjitter: 0.3,
        swayX: 0, swayY: 0, swayZ: 0, swayFreq: 0,
        twinkle: 0, twinkleFreq: 0, seed: 6001,
      });
      break;
    }
  }

  let lastT = -1;
  const update = (t: number, camPos: THREE.Vector3) => {
    const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    for (const layer of layers) layer.step(t, dt, camPos);
  };

  const dispose = () => {
    for (const layer of layers) layer.dispose();
    for (const tex of textures) tex.dispose();
  };

  return { object: group, update, dispose };
}
