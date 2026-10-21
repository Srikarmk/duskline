import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  WIDTH, HEIGHT, STEP,
  ROAD_HALF_WIDTH, LANE_CENTERS, CAR_LIFT,
  MAX_SPEED, ACCEL, DECEL, 
  STEER_RESPONSE, STEER_RETURN, 
  FREE_TURN_RATE, FREE_GRIP, CORNER_GRIP, FREE_STEER_ASSIST, 
  DRIFT_MIN_CHARGE, DRIFT_BOOST_FACTOR,
  OUT_OF_BOUNDS_X, OFFTRACK_GRACE,
  NITRO_MAX_CHARGES, NITRO_DURATION, NITRO_SPEED_FACTOR,
  GRAVITY, RAMP_LAUNCH, FLY_LIFT, MAX_ALT, AIR_GEM_ALT, AIR_GEM_TOLERANCE,
  TRANSFORM_DURATION, TRANSFORM_SPEED_FACTOR,
  SCORE_GEM, SCORE_AIR_GEM, SCORE_STUNT, SCORE_LANE_BONUS, SCORE_SMASH,
  SCORE_MONSTER, SCORE_FINISH, LANE_BONUS_SECONDS,
  OPPONENTS, OPPONENT_COUNT, CAMERA_PRESETS, SWING_DURATION,
  PAD_BOOST_DURATION,
  ITEM_BOOST_DURATION, ITEM_BOOST_FACTOR, ITEM_SHIELD_DURATION,
  MISSILE_SPEED, MISSILE_MAX_DIST, STUN_DURATION, ITEM_LATERAL_TOL,
  SCORE_HIT, OPPONENT_MINE_CHANCE,
} from "./constants";
import { Track, makeRoadTexture, makeCheckerTexture } from "./track";
import { loadModels, instantiate, type ModelLibrary } from "./assets";
import {
  makeSkyDome, makePosterSky, makeCloudLayer, makeEnvMap, windTime, makeGround, makeGrassTexture,
  makeGrassField, makeRockField, makeMountainRing,
  makeGem, makeNitroCan, makeOrb, makeRamp, RAMP_SPECS, type RampKind,
  makeBoostPad,
  makeCrystalCluster, makeMonster,
  makeMech, makeSlash, makeFlame, makeUnderGlow,
  makeItemBox, makeMissile, makeMine, makeShieldBubble,
  makeStartGantry, varyTint, makeSpaceBackdrop,
  makeTree, makeTreeMaterials, makeTreeField,
  makeSnowman, makeVolcano, makeLavaPool, makeCaveMouth, makeMushroom, makeRockProp,
  type MechRig, type Placement, type TreeMats,
} from "./objects";
import { makeWeather, type WeatherSystem } from "./weather";
import { makeTunnelArch, makeTunnelPortal } from "./setpieces";
import { makeGrandWaterfall, updateGrandWaterfall, makeBatFlock, updateBatFlock } from "./props/grand";
import { makeOceanPlane, makeSkyline, makePalmField, makePalmProp, makeSandTexture } from "./props/coast";
import { makeForkArrowSign, makeBlimp } from "./props/signage";
import { BranchPath } from "./branch";
import { FreeDrive } from "./freedrive";
import { loadPBR, pbr, groundTextureFor } from "./textures";
import { makeKart, setCarEnvTint, setCarPosterMode, CAR_SPECS, CAR_IDS, type CarStat } from "./cars";
import { REALMS, pickScenery, REALM_WEATHER, REALM_WEATHER_POOL, REALM_AMBIENCE, REALM_TUNNELS, REALM_RIVERS, REALM_SPLITS, type RealmSpec, type SceneryKind, type RealmPalette, type WeatherKind } from "./realms";
import { makePyramid, makeObelisk, makeSphinx, makeSandRock } from "./props/egyptian";
import { makeTower, makeGatehouse, makeCastleWall, makeBanner, makeTorch } from "./props/castle";
import { makeGrandstand, makeTyreStack, makeFloodlight, makePitBuilding, makeMarshalBoard } from "./props/circuit";
import { makeSkyscraper, makeBrownstone, makeStreetlight, makeBillboard, makeWaterTower, makeOverheadLight, makeNeonSign, makeNeoTower, makeLightWash, washMaterial } from "./props/metro";
import { makeHogwartsCastle, makeHogwartsExpress, makeQuidditchHoop, makeFloatingCandle, makeGoldenSnitch, makeWhompingWillow } from "./props/hogwarts";
import { makeWaterfall } from "./props/water";
import { Opponent } from "./ai";
import { Minimap } from "./minimap";
import { Sound } from "./sound";
import { loadSetting, loadSettings, type Settings, QUALITY, type Quality } from "../ui/settings";
import { Input } from "../game/input";
import { drawHud, drawToasts, drawCallout, drawCenterText, drawSpeedFx, drawFrameGrade, drawStartLights, drawReplayBar, type Toast,
} from "../game/render";
import type { GameMode, GameResult, GameOptions, RaceStanding, CarId } from "../game/engine";

type Phase = "loading" | "countdown" | "racing" | "finished";

type EntityType = "gem" | "airGem" | "nitro" | "orb" | "ramp" | "rock" | "monster" | "itembox" | "boostpad" | "boostgate";

/**
 * What each kind of weather does to grip.
 *
 * The weather already rolled over mid-race and already changed the sky; it just
 * had no consequence, which made it scenery. These are multipliers on lateral
 * traction only — NOT on top speed. Losing grip is the interesting lever: the
 * straights are unchanged, every corner has to be taken slower or sideways, and
 * because the drift threshold is a side-slip SPEED the car breaks loose earlier,
 * so a wet lap genuinely pays more style than a dry one. Cutting top speed
 * instead would only have made the race longer.
 *
 * Deliberately shallow. 0.78 in the rain is about a car's width of extra runoff
 * on a fast corner — enough to feel and to have to drive around, nowhere near
 * enough to make a realm unplayable for someone who cannot feel it.
 */
const WEATHER_GRIP: Record<WeatherKind, number> = {
  none: 1,
  mist: 0.95,      // damp air, barely anything — mist is a visibility effect
  spores: 0.97,
  ember: 0.92,     // grit and ash over the surface
  sand: 0.88,      // loose sand on tarmac is the classic low-grip surface
  snow: 0.82,
  rain: 0.78,      // standing water, the slipperiest thing here
};

/** How wet the road LOOKS at full effect, as a blend target for the ribbon's
 *  material. A grip change with no visual cue is just a car that has randomly
 *  stopped turning, so the surface has to show what it is doing. */
const WET_LOOK = { rough: 0.24, metal: 0.2, env: 2.6 };

/**
 * The speedometer is a DIAL, not a measurement.
 *
 * `speed` is metres per second and MAX_SPEED is 56, which is not a number
 * anybody wants on a racing HUD. The readout scales it into something that
 * reads like a car, and the scale is chosen so the numbers land where they
 * mean something.
 *
 * The dial used to stop at 150 and a measured lap sat between 57 and 123 with
 * a median of 89 — most of a race spent in the bottom half of a dial that
 * never reached its own ceiling. On the same lap this scale reads p05 125,
 * median 185 and 209 flat out, leaving the last 30 for nitro, a drift boost,
 * a pad or a tow. Stacking several of those can still exceed it, which is what
 * the clamp is for: 240 is the top of the dial.
 */
const SPEEDO_SCALE = 200;
const SPEEDO_MAX = 240;

/** What the HUD calls the thing taking your grip away. */
const WEATHER_LABEL: Record<WeatherKind, string> = {
  none: "DRY", mist: "DAMP", spores: "SPORES", ember: "ASH",
  sand: "SAND", snow: "SNOW", rain: "WET",
};

/** How far off a rival's line the tow still reaches, in metres. Half a car's
 *  width either side of dead astern — enough to be findable, tight enough that
 *  you have to aim for it. */
const TOW_WIDTH = 2.4;
/** Top speed gained at full tow. 12% is roughly a second a lap: worth chasing,
 *  not enough to make following better than leading. */
const TOW_GAIN = 0.12;

type ItemKind = "boost" | "shield" | "missile" | "mine";
const ITEM_LABEL: Record<ItemKind, string> = {
  boost: "BOOST", shield: "SHIELD", missile: "MISSILE", mine: "MINE",
};

interface Entity {
  type: EntityType;
  dist: number;
  lateral: number;
  collectedLap: number;
  obj: THREE.Object3D;
  baseY: number;
  phase: number;
  home: number; // spawn lateral, for monster patrol
  power: number; // launch-power multiplier for ramps (1 otherwise)
  /**
   * WHICH ROAD this sits on: -1 for the main circuit, otherwise an index into
   * `branches`.
   *
   * Entities were addressed in main-track (distance, lateral) coordinates and
   * nothing else, which is why an alternate route could never hold a pickup, a
   * pad or a ramp — "3.4 m from the centreline" means a different place on
   * every road. That made forks structurally unable to be worth taking, and it
   * is the reason the first attempt at one was deleted. A branch entity stores
   * its lateral relative to its OWN road, and only collides while the car is
   * on that road.
   */
  road: number;
}

interface Projectile {
  obj: THREE.Object3D;
  dist: number;
  lateral: number;
  travelled: number;
  fromPlayer: boolean;
}

interface ModeConfig {
  laps: number;
  opponents: boolean;
  orbs: boolean;
  monsters: boolean;
  startNitro: number;
  label: string;
  /** combat mode: start armed, weapon-dense item boxes, trigger-happy rivals */
  combat?: boolean;
  /** endless mode: no finish line — drive until you quit, chasing distance */
  endless?: boolean;
}

const MODE_CONFIG: Record<GameMode, ModeConfig> = {
  classic:   { laps: 3, opponents: true,  orbs: false, monsters: false, startNitro: 1, label: "CIRCUIT" },
  transform: { laps: 3, opponents: true,  orbs: true,  monsters: true,  startNitro: 1, label: "TRANSFORMER" },
  grandprix: { laps: 2, opponents: true,  orbs: false, monsters: false, startNitro: 1, label: "GRAND PRIX" },
  spacewars: { laps: 3, opponents: true,  orbs: false, monsters: false, startNitro: 1, label: "SPACE WARS", combat: true },
  // NEON RUN — endless. There is no finish line: `laps` is set absurdly high so
  // the lap counter never runs out, and the point is distance + score rather
  // than a result. Best on Neon Metro, which is the Akira-flavoured city.
  // NEON RUN — endless, and deliberately SOLO. No rivals, no finish line, no
  // pressure: just an ethereal cruise. Racing against nine cars is the opposite
  // of stress-free, so `opponents` is false here.
  endless:   { laps: 9999, opponents: false, orbs: false, monsters: false, startNitro: 2, label: "NEON RUN", endless: true },
};

/** Lateral half-width for a hit, in ROAD_HALF_WIDTH units (1.0 = 5 m). Pickups are
 *  deliberately GENEROUS — arcade racers reward driving near a gem, not pixel-perfect
 *  aim — while hazards (rock/monster) stay tight so you're never hit unfairly. */
const COLLIDE_WIDTH: Record<EntityType, number> = {
  gem: 0.5, airGem: 0.55, nitro: 0.5, orb: 0.58, ramp: 1.45, rock: 0.34, monster: 0.38, itembox: 0.7,
  // 0.36 = 1.8 m either side, matching the lane-width deck the corner-exit
  // chains are built from. It was 1.0 — a FIVE metre half-band, the whole road —
  // left over from when a pad spanned the circuit. At 1.0 a pad placed out by
  // the kerb still fires when you drive down the middle, which quietly undoes
  // the entire point of putting it off the racing line.
  boostpad: 0.36, boostgate: 0.5,
};

const BUCKET_METERS = 5;
/** longitudinal hit window (m). Must comfortably exceed the per-step travel at
 *  nitro speed (~78 m/s ÷ 60 Hz ≈ 1.3 m) so nothing is ever stepped over. */
const COLLIDE_DIST = 4.2;
/** how many power-ups you can bank at once (fire with E, oldest first) */
const MAX_ITEMS = 3;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tyre-mark / smoke tints: dark rubber + grey smoke on tarmac. */
const SMK_RUBBER = new THREE.Color(0x0a0810);
const SMK_GREY = new THREE.Color(0xd7d9e2);

/** Screen-space heat-haze: wobbles the image toward the horizon band, strongest
 *  low on screen and fading up — the rising-hot-air shimmer over the ember flats. */
/**
 * Radial blur, strength driven by speed.
 *
 * At 190 mph the roadside is a stroboscope: every post, rock and tree crosses
 * the frame in two or three frames, and because nothing smears, each one is a
 * separate hard-edged flash. That is what makes fast driving unreadable — not
 * that things move quickly, but that they TELEPORT. Smearing the periphery
 * along the direction of travel is what a camera does and what the eye
 * expects, and it has the useful side effect of leaving the centre of the
 * frame — the road you are aiming at — untouched and sharp.
 *
 * Cheap on purpose: 6 taps along the vector from the vanishing point, with the
 * strength falling to zero well before the middle of the screen.
 */
const RadialBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    amount: { value: 0 },      // 0..1, from speed
    centre: { value: new THREE.Vector2(0.5, 0.52) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform vec2 centre;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - centre;
      float r = length(d);
      // nothing at all within ~28% of the vanishing point, ramping up outward
      float k = smoothstep(0.16, 0.62, r) * amount;
      if (k <= 0.001) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 sum = vec4(0.0);
      for (int i = 0; i < 6; i++) {
        float t = float(i) / 5.0;
        sum += texture2D(tDiffuse, vUv - d * (t * 0.085 * k));
      }
      gl_FragColor = sum / 6.0;
    }
  `,
};

/** Final filmic grade. Runs AFTER OutputPass, i.e. on tone-mapped display-space
 *  colour, because grain and chromatic aberration are display effects — doing
 *  them in linear HDR gives the wrong response curve entirely.
 *  Deliberately restrained: a gentle S-curve, a cool-shadow/warm-highlight split
 *  tone, a whisper of grain to break up flat gradients, and a touch of radial
 *  chromatic aberration that only bites at the very edge of frame. */
const FilmGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    amount: { value: 1 },
    // --- illustration grade ------------------------------------------------
    // The reference look this is chasing (JDM anime/vapourwave car art) has
    // three properties a PBR frame does not: light falls in HARD BANDS rather
    // than a smooth ramp, the whole image sits in one hue family with only the
    // neons breaking out of it, and the shadows carry a print screen. All
    // three are a few lines here, in a pass that is already in the chain and
    // already paid for — no new render target.
    cel: { value: 0 },        // 0 = smooth falloff, 1 = fully banded
    duo: { value: 0 },        // 0 = full colour, 1 = the realm's own two-tone
    halftone: { value: 0 },   // 0 = clean, 1 = a full dot screen in the shadows
    dotPx: { value: 7 },      // dot pitch in DEVICE pixels; set from the dpr

    duoShadow: { value: new THREE.Color(0x2a2140) },
    duoLight: { value: new THREE.Color(0xffd9b0) },
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float amount;
    uniform float cel; uniform float duo; uniform float halftone; uniform float dotPx;
    uniform vec3 duoShadow; uniform vec3 duoLight;
    varying vec2 vUv;
    const vec3 W = vec3(0.2126, 0.7152, 0.0722);
    // Four steps, not five. Nearest-band quantising can only move a pixel by
    // half a band, so the band COUNT sets the size of the biggest visible step:
    // at five bands the step tops out around 10% brightness, which is a change
    // you have to be told about to notice. Four bands plus the spread below is
    // what turns it from a filter into a light model.
    const float BANDS = 4.0;
    // Quantising alone keeps the average brightness and just rounds it, so the
    // bands sit almost on top of each other. Pushing them apart around a pivot
    // near this game's typical luminance (frames average ~0.25) is what gives
    // the hard terminator the reference art is built on.
    const float CEL_GAIN = 1.2;
    const float CEL_PIVOT = 0.34;
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // chromatic aberration: zero in the middle, only noticeable at the corners
      vec2 off = c * r2 * 0.0075 * amount;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      vec3 raw = col;

      // filmic S-curve: lifts contrast without crushing either end
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22 * amount);

      // split tone — cool the shadows, warm the highlights
      float luma = dot(col, W);
      vec3 shadowTint = vec3(0.90, 0.97, 1.10);
      vec3 highTint   = vec3(1.06, 1.01, 0.94);
      col *= mix(shadowTint, highTint, smoothstep(0.15, 0.85, luma)) * amount + (1.0 - amount);

      // a little saturation so the realm palettes stay punchy after the S-curve
      col = mix(vec3(luma), col, 1.0 + 0.10 * amount);

      // --- CEL BANDING ------------------------------------------------------
      // Quantise the LUMINANCE, not the colour: posterising rgb independently
      // shifts hues at every step and turns a sunset into confetti. Scaling the
      // colour by the ratio of banded to actual luminance keeps the hue exactly
      // and steps only the brightness, which is what cel shading is.
      //
      // Band the LOW-FREQUENCY luminance, not this pixel's. Quantising the raw
      // value makes surface texture — gravel speckle, grass noise — wander
      // across band edges, which comes out as blotches rather than flat light.
      // Averaging a small cross first puts the steps where the LIGHT changes
      // and lets the texture ride on top of them, multiplicatively.
      //
      // NOT ON THE SKY. The dome carries its own 26-band posterisation, authored
      // in equirect space where the bands are even in elevation angle. Running a
      // second, screen-space luminance quantisation over the top of it made the
      // two beat against each other: a hard seam straight across the sky, a dark
      // wedge where a band edge crossed the dome's curvature, and — because band
      // zero sits at zero and the spread below pushes it negative — a black disc
      // punched out of the darkest part of the sky at the zenith. The sky is
      // already art-directed; the grade should only band the world.
      //
      // The mask rides in the ALPHA CHANNEL: the dome and its cloud deck write
      // zero alpha, every other material writes one, and the pass chain carries
      // it through untouched. (Bloom adds a little alpha where it glows, hence
      // the smoothstep rather than a straight read.) Depth would have been the
      // textbook route and it is a dead end here: the composer ping-pongs
      // between two targets with an odd number of swaps per frame, so which one
      // the scene lands in alternates, and a DepthTexture shared between both
      // sampled as zero everywhere.
      float world = smoothstep(0.35, 0.75, texture2D(tDiffuse, vUv).a);
      float celM = cel * world;
      if (celM > 0.001) {
        vec2 px = fwidth(vUv) * 2.2;
        float lo = dot(raw, W) * 2.0
          + dot(texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb, W)
          + dot(texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb, W)
          + dot(texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb, W)
          + dot(texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb, W);
        lo = max(lo / 6.0, 1e-4);
        // No band may land on ZERO. floor(lo*B + 0.5) rounds the darkest pixels
        // to band 0, the spread then takes that below zero, it clamps, and the
        // pixel is multiplied by nothing — which is how a smooth dark gradient
        // acquires a hard black hole with a razor edge around it.
        float q = max(floor(lo * BANDS + 0.5), 0.5) / BANDS;
        q = max((q - CEL_PIVOT) * CEL_GAIN + CEL_PIVOT, 0.0);
        // soften the step a touch so it is a painted edge, not an aliased one
        float w = fwidth(lo) * 2.0;
        q = mix(q, lo, clamp(w * BANDS, 0.0, 1.0));
        // ...and bound the multiplier. q/lo is a RATIO, so it runs away at both
        // ends: near black it crushes, near the band edge it blooms. Typical
        // mid-frame ratios measured 0.77-1.18, so this only binds at the tails.
        col *= mix(1.0, clamp(q / lo, 0.6, 1.6), celM);
      }

      // --- DUOTONE ----------------------------------------------------------
      // Pull the frame toward one hue ramp, but ONLY where it is unsaturated.
      // In the reference art the world sits in a single colour family and the
      // neon is the one thing that escapes it — tinting everything equally
      // would kill exactly the accents that make the look work.
      //
      // The ramp is renormalised to the pixel's own luminance, so this is a
      // RECOLOUR and never a dimmer. An earlier version scaled by the ramp
      // directly and quietly ate a fifth of the frame's brightness, which is
      // the kind of thing that turns a night realm to mud as the tint goes up.
      if (duo > 0.001) {
        float l2 = max(dot(col, W), 1e-4);
        float mx = max(col.r, max(col.g, col.b));
        float mn = min(col.r, min(col.g, col.b));
        float sat = (mx - mn) / max(mx, 1e-4);
        vec3 ramp = mix(duoShadow, duoLight, smoothstep(0.0, 1.0, l2));
        ramp *= l2 / max(dot(ramp, W), 1e-4);
        col = mix(col, ramp, duo * (1.0 - smoothstep(0.42, 0.85, sat)));
      }

      // --- HALFTONE ---------------------------------------------------------
      // A print dot screen, 45 degrees, in the shadows only — the dot grows as
      // the pixel darkens, exactly as ink coverage does. Keeping it out of the
      // highlights is what stops it reading as dirt on the lens. The pitch is
      // in device pixels and set from the dpr, so the dots are the same
      // physical size on a retina panel as on a 1x one.
      if (halftone > 0.001) {
        float s = sin(0.7854), cs = cos(0.7854);
        vec2 rp = vec2(gl_FragCoord.x * cs - gl_FragCoord.y * s,
                       gl_FragCoord.x * s + gl_FragCoord.y * cs) / dotPx;
        float d = length(fract(rp) - 0.5) * 2.0;
        float shade = 1.0 - smoothstep(0.04, 0.50, dot(col, W));
        float inside = 1.0 - smoothstep(shade * 0.95 - 0.22, shade * 0.95 + 0.22, d);
        col *= 1.0 - halftone * shade * 0.42 * inside;
      }

      // fine grain, animated so it never reads as a static pattern
      float g = fract(sin(dot(vUv * vec2(1.0, 1.0) + time * 0.35, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * 0.016 * amount;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

const HeatHazeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, time: { value: 0 }, amount: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float amount; varying vec2 vUv;
    void main(){
      float band = smoothstep(0.72, 0.30, vUv.y);            // 0 at top → 1 lower
      float w = sin(vUv.y * 42.0 + time * 3.2) * sin(vUv.x * 26.0 - time * 2.1);
      vec2 uv = vUv;
      uv.x += w * amount * band * 0.006;
      uv.y += w * amount * band * 0.004;
      gl_FragColor = texture2D(tDiffuse, uv);
    }`,
};

/** A spinnable/steerable wheel picked out of a built car model. */
interface WheelRef { obj: THREE.Object3D; front: boolean; r: number; }
/** One drifting-tyre smoke puff (world-space sprite, recycled from a pool). */
interface SmokePuff { spr: THREE.Sprite; life: number; max: number; vel: THREE.Vector3; }

/** Collect the wheel sub-groups tagged by cars.ts, flagging the front pair (by
 *  local +z) so they can steer. Shared by the player rig and the opponents. */
function collectWheels(root: THREE.Object3D): WheelRef[] {
  const out: WheelRef[] = [];
  root.traverse((o) => {
    if (o.userData && o.userData.wheel) {
      o.rotation.order = "YXZ";
      out.push({ obj: o, front: o.position.z > 0.2, r: (o.userData.wheelR as number) || 0.4 });
    }
  });
  return out;
}

export class Game {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private gtao!: GTAOPass;
  private heatHaze: ShaderPass | null = null;
  private radialBlur: ShaderPass | null = null;
  private filmGrade: ShaderPass | null = null;
  private lightShafts: THREE.Group | null = null;
  private hudCtx: CanvasRenderingContext2D;
  private hudCanvas: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private viewW = WIDTH;
  private viewH = HEIGHT;
  private resizeObs: ResizeObserver | null = null;
  private carId: CarId;
  private carStat: CarStat;
  private waterCurtains: THREE.Group[] = []; // road-spanning water sheets (scrolling)
  private grandFalls: THREE.Group[] = [];   // monumental waterfalls (scrolling water)
  private batFlocks: THREE.Group[] = [];    // cave bats (vertex-animated)
  private weather: WeatherSystem | null = null;
  private weatherKind: WeatherKind = "none";
  private weatherT = 0;   // seconds until the next roll of the weather dice
  /** Lateral-grip multiplier from the current weather, EASED rather than
   *  snapped: the sky takes a few seconds to turn, so the road has to as well,
   *  or the car's handling changes under you between one frame and the next. */
  private gripMul = 1;
  /** The road ribbon's material and the look it has when dry, so a shower can
   *  wet it and clearing can dry it back to whatever this realm's finish was. */
  private roadMat: THREE.MeshStandardMaterial | null = null;
  private dryLook = { rough: 0.5, metal: 0.12, env: 1.7 };
  private input = new Input();
  private sound = new Sound();
  private slashCooldown = 0;
  private bumpCd = 0;
  private postHitCd = 0; // throttles the "clipped a marker post" speed-hit
  private takedownCd = 0; // throttles Asphalt-style takedowns so one ram = one hit
  private obstacles: { x: number; z: number; r: number }[] = []; // solid scenery you can't drive through
  private obstacleGrid = new Map<string, number[]>(); // spatial buckets into `obstacles`
  private obstacleHitCd = 0; // throttles the impact spark/sound on a scrape
  private slotFullCd = 0;
  private lastBeep = 99;
  private realm: RealmSpec;
  private track: Track;
  private minimap: Minimap;
  private mode: GameMode;
  private cfg: ModeConfig;
  private onFinish: (result: GameResult) => void;
  /** Async world-build failures go here — see GameOptions.onError. */
  private onError?: (err: unknown) => void;
  private rafId = 0;
  private last = 0;
  private accumulator = 0;
  private time = 0;
  private stopped = false;
  private paused = false;

  // world objects
  private entities: Entity[] = [];
  private buckets = new Map<number, Entity[]>();
  private spinners: Entity[] = [];
  private monsters: Entity[] = [];
  /** `road`: -1 for the main circuit, or an index into `branches` — a ramp on
   *  an alternate route must only launch you while you are on that route. */
  private ramps: { dist: number; power: number; lane: number; len: number; height: number; twist: boolean; road: number }[] = [];
  /** fork zones as main-track ranges [d0,d1] — used to keep boost pads/gates from
   *  cluttering a fork mouth. */
  private splits: { d0: number; d1: number }[] = [];
  /** true alternate routes: a separate drivable road you can peel onto at a fork
   *  and rejoin later. `side` is which way it bows (used to decide entry). */
  private branches: { path: BranchPath; side: number }[] = [];
  /** branch centrelines in world XZ, for the minimap */
  private branchRoutes: { x: number; z: number }[][] = [];
  /** the branch you're currently driving (null = on the main track), and how far
   *  along it (arc-length metres). */
  private onBranch: BranchPath | null = null;
  private tmpSurface = new THREE.Vector3();
  private branchU = 0;
  /** free-roam driving body (world-space physics; the rail position/playerX are
   *  derived from it by projecting onto the track each frame). */
  private freeDrive = new FreeDrive();
  private lapProgress = 0;   // cumulative signed distance travelled this lap
  /** Where the backmost grid slot sits, in metres behind the start line. */
  private gridStart = 0;
  /** Scratch for the camera floor probe — this runs every frame. */
  private readonly tmpCamFloor = new THREE.Vector3();
  private lastFreeDist = 0;  // previous frame's projected distance (for lap wrap)
  private wasOnRamp = false;
  private lastRampPower = 1;
  private lastRampTwist = false;
  private spinRate = 0; // revolutions/sec while corkscrewing off a twist ramp
  private lastRampT = 0;
  private treeMats: TreeMats | null = null;
  private opponents: Opponent[] = [];
  private playerRoot = new THREE.Group();
  private playerBody = new THREE.Group();
  private carModel: THREE.Group | null = null;
  private mech: MechRig | null = null;
  private slash: THREE.Mesh | null = null;
  private flames: THREE.Mesh[] = [];
  private underGlow: THREE.Mesh | null = null;
  // car "feel": spinning/steering wheels, weight transfer, drift smoke, skids…
  private playerWheels: WheelRef[] = [];
  private wheelDist = 0;   // integrated ground distance → wheel spin angle
  private prevSpeed = 0;
  private bodyPitch = 0;   // dynamic squat (accel) / dive (brake) nod
  private smoke: SmokePuff[] = [];
  private smokeTimer = 0;
  private susp = 0;        // suspension compression (0 rest, + squashed)
  private suspV = 0;       // suspension spring velocity
  private skids: THREE.Mesh[] = []; // recycled dark tyre marks laid on the road
  private skidIdx = 0;
  private skidTimer = 0;
  private backfire: THREE.Sprite[] = []; // exhaust flash pops (children of the car)
  private backfireTimer = 0;
  private dustColor = new THREE.Color(0xbfa06a); // off-road dust tint (set per realm)
  private sparks: SmokePuff[] = []; // impact-spark pool (bumps/hits)
  private camPos = new THREE.Vector3();
  private camYaw = 0; // smoothed camera heading — eases toward the car so the view swings in behind you instead of snapping with every steer
  private coast: { x: number; z: number; r: number; far: number; band: number; drop: number; side: number } | null = null;
  private clouds: THREE.Mesh | null = null;
  private skyMesh: THREE.Mesh | null = null;
  /** Vertical g-load from the road's own shape: >0 pressed into a dip, <0 light
   *  over a crest. Smoothed, because the raw curvature steps between samples. */
  private gLoad = 0;
  /** Quality tier in force. Read once at build for the things that cannot
   *  change live (shadow map size, scenery density) and again on every
   *  settings change for the ones that can (resolution, post chain). */
  private quality: Quality = "high";
  /** Frame-time readout. Off by default; it exists so a real number can come
   *  back off hardware that is not the machine this was built on. */
  private showFps = false;
  private frameMs = 16.7;
  private skyMat: THREE.ShaderMaterial | null = null;
  private seaY = -11; // coastal realms: land inside r, sea beyond
  private reliefAmp = 0; // per-realm amplitude of the rolling hills the ground rises into away from the road
  private sun!: THREE.DirectionalLight; // shadow-casting key light; its frustum follows the car
  private offTrackT = 0; // seconds left before an off-track respawn (0 = on track / no warning)
  private offTrackExitDist = 0; // arc distance where you left the ribbon — respawn point
  private terrSamp?: { sx: Float64Array; sz: Float64Array; sy: Float64Array; sag: Float64Array }; // cached track polyline for ground-height queries
  private camSnap = true;

  // --- LAP REPLAY -----------------------------------------------------------
  // The car's path, sampled every physics step. Four numbers a frame — the
  // two ground coordinates, the heading and the jump height — because those
  // are the only things render() needs to put the car back where it was;
  // everything else (wheel spin, body pitch, the camera) is derived from them
  // and comes out the same on the way back.
  //
  // Two buffers, not one. `replayCur` fills as the current lap is driven and
  // moves to `replayLast` at the line, so what is offered afterwards is a
  // COMPLETE lap rather than however much of one the player happened to be
  // partway through. At 60 Hz a 47-second lap is about 2,800 samples, or
  // 45 kB — small enough to keep two of without thinking about it.
  private replayCur: number[] = [];
  private replayLast: number[] = [];
  /** when replaying, the sample index being shown; -1 = not replaying */
  private replayAt = -1;
  private replayData: number[] | null = null;
  /** handed in through GameOptions; started once the world is actually built */
  private pendingReplay: number[] | null = null;
  /** eased version of the camera's ground clamp — see the floor block in render() */
  private camFloor = 0;
  private cameraIndex = 0;
  /**
   * PHOTO MODE.
   *
   * The whole point of this game is how it looks — computed skies, sunset
   * palettes, ten cars modelled individually — and there was no way to look at
   * any of it. The chase camera sits behind the car at a fixed height and the
   * HUD covers the corners, so the one thing worth showing off was the one
   * thing you could not frame.
   *
   * Freezes the sim, hides the HUD, and puts the camera on an orbit around the
   * car that you steer. Not a cutscene system: it reuses the same render path,
   * so what you photograph is exactly what the game draws.
   */
  private photo = false;
  private photoOrbit = { yaw: 2.3, pitch: 0.22, dist: 9, fov: 42 };

  // race state
  private phase: Phase = "loading";
  private countdownT = 3.5;
  private finishT = 0;
  private lap = 1;
  private raceTime = 0;
  private finished = false;
  private finalPosition = 1;
  private finalStandings: RaceStanding[] = [];
  private finishSeq = 0;          // increments as each racer crosses the final line
  private playerFinishOrder = 0;  // the player's slot in that sequence (0 = not yet)

  // player state
  private position = 0;
  private playerX = 0;
  private playerVX = 0; // lateral velocity (playerX units/s)
  private speed = 0;
  private steer = 0;       // smoothed analog steer (-1..1), with inertia
  private steerInput = 0;
  private slipping = false; // tires past their grip limit (understeer/slide)
  private shake = 0;        // camera shake amount, decays over time
  /**
   * The OS-level "reduce motion" setting.
   *
   * The stylesheet has honoured this for the menus all along; the engine never
   * did, so the two effects most likely to cause trouble — the camera shake on
   * every impact and the radial speed smear — ran regardless. For someone with
   * vestibular sensitivity those are the whole problem, not the UI easing.
   * Read once: this is not something that changes mid-race.
   */
  private readonly reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  private carYaw = 0; // visual heading offset from the track tangent
  private drifting = false;
  private driftDir = 0;
  private driftCharge = 0;
  private driftBoostT = 0;
  private alt = 0;
  private vAlt = 0;
  private carPitch = 0; // smoothed nose pitch: ramp face / air arc / road slope
  private weightRoll = 0;  // body lean into corners (weight transfer)
  private weightPitch = 0; // body dive under braking / squat under throttle
  private stuntAir = false;
  private spin = 0; // barrel-roll revolutions
  private flip = 0; // pitch-flip revolutions
  private swingT = 0;
  // TRANSFORMER combo: consecutive smashes/slashes inside `comboT` escalate the
  // multiplier. Rampage scoring is what makes the mech feel like a power trip
  // rather than a slow lap with props in the way.
  private combo = 0;
  private comboT = 0;

  private nitroCharges = 1;
  private nitroT = 0;
  private nitroFill = 0;   // 0..1 toward the next charge; fills on its own
  private transformed = false;
  private transformT = 0;

  // power-ups
  private heldItems: ItemKind[] = [];
  private boostT = 0;
  private shieldT = 0;
  private missiles: Projectile[] = [];
  private mines: Projectile[] = [];
  private shieldBubble: THREE.Mesh | null = null;

  private lastLane = -1;
  private laneT = 0;

  private score = 0;
  private gems = 0;
  private stunts = 0;
  private laneBonuses = 0;
  private penalties = 0;

  private crashFlash = 0;
  private toasts: Toast[] = [];
  /** The live "+N" chip tally, so a gem run is one counting line not six. */
  private gemTick: Toast | null = null;
  private gemTickT = 0;
  private gemTickSum = 0;
  // big centre-screen race-drama callouts (overtakes, final lap) — distinct
  // from the small stacked toasts; one at a time, with a pop + fade
  private callout: { text: string; sub: string; color: string; t: number; life: number } | null = null;
  private lastPosition = 0;   // player's rank last frame, to detect overtakes
  private overtakeCd = 0;     // debounce so grid shuffles don't spam callouts

  /**
   * STYLE CHAIN.
   *
   * Drifting already granted a boost and ramps already granted a stunt bonus,
   * but nothing connected them — every flourish was a separate, immediately
   * banked little payout, so driving beautifully scored the same as driving
   * adequately plus one lucky ramp.
   *
   * The chain makes them compound. Every stylish act extends a short timer and
   * raises a multiplier; the points sit PENDING while the chain is alive. Let
   * the timer lapse and they bank. Crash, spin out, or leave the road and the
   * whole pending pot is lost.
   *
   * That last rule is the entire design. Without it a chain is just a slower
   * way to receive points you had already earned; with it, every extra link is
   * a decision to risk what you are holding.
   */
  private chainLinks = 0;
  private chainPending = 0;
  private chainT = 0;
  private chainBest = 0;      // longest chain this race, for the results screen
  private nearMissCd = 0;

  /**
   * GHOST — your own best lap, replayed beside you.
   *
   * Only in modes with laps and a fixed circuit. The recorder runs every lap
   * and the best one is kept; the player replays from the same start, so the
   * two are directly comparable at every point on the road.
   */
  // --- circuit gimmicks -------------------------------------------------
  /** 0..1 slipstream from sitting in a rival's dirty air. */
  private tow = 0;
  private towCallout = 0;

  constructor(container: HTMLElement, options: GameOptions) {
    this.container = container;
    this.mode = options.mode;
    this.onError = options.onError;
    this.cfg = { ...MODE_CONFIG[options.mode] };
    // per-match lap override (time trial keeps its own clean-lap rule)
    // The home screen's lap picker must NOT apply to endless — it would cap
    // "no finish line" at 3 laps, which is exactly what testing caught.
    if (options.laps && options.mode !== "grandprix" && !this.cfg.endless) {
      this.cfg.laps = options.laps;
    }
    // Space Wars is always fought in deep space — swap the realm pick for one of
    // the two battle tubes (the 2nd, "nebula", is otherwise hidden)
    if (options.mode === "spacewars") {
      this.realm = Math.random() < 0.5 ? REALMS.void : REALMS.nebula;
    } else if (options.mode === "endless") {
      // NEON RUN has its own world and ignores the realm pick, the same way
      // Space Wars does. Running it on a normal circuit was the problem: a
      // 3 km lap with corners is a RACE TRACK, and driving it forever with no
      // rivals just makes it an empty race track.
      this.realm = REALMS.neon;
    } else {
      this.realm = REALMS[options.realm ?? "forest"];
    }
    // banking OFF: the car sits at the flat centreline height, so a banked (tilted)
    // road surface would poke up through it on corners and look like the car sinks
    // BANKING IS ON for the road realms now. It was disabled because the car
    // was placed at the FLAT centreline height, so a tilted road surface rose
    // through it and the car looked sunk — see the placement below, which now
    // reads the banked surface at the car's actual lateral offset.
    this.track = new Track(
      this.realm.controlPoints,
      this.realm.banked ?? false,
      this.realm.hillScale ?? 1,
      this.realm.offCamber ?? 0
    );
    // how dramatically the land rolls away from the road, per realm — peaks/dunes
    // heave, the speedway + city stay near-flat, the space tubes get none
    this.reliefAmp = ({
      forest: 18, ember: 26, peaks: 32, void: 0, sands: 28,
      castle: 22, circuit: 7, metro: 10, nebula: 0, bay: 0,
      // The photo realms. On a one-sided coast this is what the INLAND side
      // becomes, so the cliff road has a hillside to have been cut into rather
      // than a flat shelf: 70 m of relief on the cape, 90 in the canyon.
      azur: 46, hokkai: 74, mirage: 12, basin: 40, cape: 70, hills: 90,
      neon: 4,   // a highway is graded flat; the city does the vertical
    } as Record<string, number>)[this.realm.id] ?? 18;
    this.minimap = new Minimap(this.track);
    this.onFinish = options.onFinish;
    this.lap = 1;
    this.finishSeq = 0;
    this.playerFinishOrder = 0;
    this.nitroCharges = this.cfg.startNitro;
    if (this.cfg.combat) this.heldItems = ["missile", "missile"]; // start armed
    this.carId = options.car ?? "f40";
    this.carStat = CAR_SPECS[this.carId].stat;
    // Not started here — there is no world yet. init() is async, and calling
    // startReplay before buildWorld would put the car on a track that does not
    // exist. Held until the build finishes.
    this.pendingReplay = options.replay ?? null;

    // fill the container at its true aspect ratio (full-width, no letterbox)
    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);
    this.viewW = w;
    this.viewH = h;

    // preserveDrawingBuffer left OFF: nothing reads the WebGL backbuffer (realm
    // thumbnails are static JPGs) and keeping it on blocks the browser's swap
    // optimizations — a free perf win.
    // Read BEFORE the renderer exists: dpr, shadow map size and the post chain
    // are all decided from this, and two of them cannot change afterwards.
    this.quality = loadSetting("quality", "high");
    this.showFps = loadSetting("showFps", false);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[this.quality].dprCap));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.className = "game-layer";
    this.renderer.setClearColor(this.realm.palette.fog);
    // filmic tone mapping → richer colors + smooth highlight roll-off
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    // real-time shadows — the single biggest "this is 3D, not flat" upgrade
    this.renderer.shadowMap.enabled = QUALITY[this.quality].shadow > 0;
    // NOT PCFSoftShadowMap: three deprecated it in r18x and silently falls back
    // to this, warning on every renderer we create. Worth naming because the
    // fallback is what makes `sun.shadow.radius` work at all — PCFSoft ignores
    // radius and uses a fixed kernel, PCF honours it. The soft edges on the
    // ground have been coming from radius all along.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const hudCanvas = document.createElement("canvas");
    hudCanvas.className = "game-layer game-hud";
    this.hudCanvas = hudCanvas;
    const hudCtx = hudCanvas.getContext("2d");
    if (!hudCtx) throw new Error("2d canvas context unavailable");
    this.hudCtx = hudCtx;

    container.appendChild(this.renderer.domElement);
    container.appendChild(hudCanvas);

    const pal = this.realm.palette;
    this.camera = new THREE.PerspectiveCamera(CAMERA_PRESETS[0].fov, w / h, 0.1, 1600);
    this.scene.fog = new THREE.Fog(pal.fog, pal.fogNear, pal.fogFar);

    // image-based lighting: a realm-tinted sky env bounces coloured light onto
    // every standard material and lets the wet road + props catch reflections
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const eq = makeEnvMap(pal);
    this.scene.environment = pmrem.fromEquirectangular(eq).texture;
    (this.scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity = 0.65;
    eq.dispose();
    pmrem.dispose();

    // HDR, multisampled composer target: 4x MSAA gives crisp edges (no jaggies
    // on the road/props) and HalfFloat keeps the bloom + tone-map smooth
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const hdrTarget = new THREE.WebGLRenderTarget(db.x, db.y, {
      type: THREE.HalfFloatType, samples: 0, // MSAA off — 4x on a retina HDR target was a huge bandwidth cost
    });
    this.composer = new EffectComposer(this.renderer, hdrTarget);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // ambient occlusion (GTAO): soft contact shadows in the creases where props
    // meet the ground and along the road edges — the biggest "grounded, not
    // floating cardboard" upgrade. Screen-space radius so it works at any scale.
    const gtao = new GTAOPass(this.scene, this.camera, w, h);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({
      radius: 0.4, distanceExponent: 1, thickness: 1, scale: 1,
      samples: 4, distanceFallOff: 1, screenSpaceRadius: true, // 16 -> 4: GTAO was the #1 lag source
    });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 4 });
    this.composer.addPass(gtao);
    this.gtao = gtao;
    // GTAO stays OFF BY DEFAULT, but is now a real user toggle rather than dead
    // code. Measured on the current build: it costs ~5.6 ms, and a loaded forest
    // view already sits at ~11 ms — so enabling it lands the frame at 16.6 ms,
    // exactly the 60 fps line with ZERO margin, which is how you get stutter on
    // anything slower than this machine. (An earlier 4.19 ms reading was taken
    // from a light view right after respawn and flattered it.)
    // The baked ARM ambient occlusion now covers most of what GTAO was for and
    // costs nothing per frame; GTAO only adds occlusion BETWEEN separate objects.
    // Available to anyone with GPU headroom via the pause menu.
    gtao.enabled = loadSetting("ao", false);

    // bloom runs at half resolution — it's a soft blur anyway, so it looks the
    // same but costs a quarter of the fill rate (keeps big retina buffers smooth)
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.11, 0.6, 0.95);
    this.composer.addPass(this.bloomPass);

    // heat-haze shimmer — only the ember realm turns it on
    const haze = new ShaderPass(HeatHazeShader);
    haze.uniforms.amount.value = this.realm.id === "ember" ? 1 : 0;
    haze.enabled = this.realm.id === "ember";
    this.composer.addPass(haze);

    // speed smear, between the haze and the output grade
    const rblur = new ShaderPass(RadialBlurShader);
    this.composer.addPass(rblur);
    this.radialBlur = rblur;
    this.heatHaze = haze;

    // final pass applies tone mapping + sRGB so the composed image is graded
    this.composer.addPass(new OutputPass());

    // …then the film grade on top, in display space (see FilmGradeShader).
    const grade = new ShaderPass(FilmGradeShader);
    // ILLUSTRATION GRADE, per realm. The game already aims at this look in
    // geometry — eight realms run `posterSun`, which flat-shades the terrain
    // and the car paint so bodies read as blocks of colour rather than
    // gradients. What was missing is the lighting and the palette: reference
    // art in this genre bands its light hard and sits the whole frame in one
    // hue family, letting only the neon escape.
    //
    // Poster realms take it further than the rest, because that is already
    // their declared intent. The two-tone ends come from the realm's own
    // ground ramp, so each world is graded toward itself rather than toward
    // one global filter.
    grade.uniforms.cel.value = pal.posterSun ? 0.9 : 0.55;
    grade.uniforms.duo.value = pal.posterSun ? 0.5 : 0.28;
    grade.uniforms.halftone.value = pal.posterSun ? 0.5 : 0.28;
    (grade.uniforms.duoShadow.value as THREE.Color).set(pal.groundDark);
    (grade.uniforms.duoLight.value as THREE.Color).set(pal.sky[2]);
    this.composer.addPass(grade);
    this.filmGrade = grade;
    this.bloomPass.enabled = loadSetting("bloom", true);
    this.cameraIndex = loadSetting("camera", 0) % CAMERA_PRESETS.length;
    this.camera.fov = CAMERA_PRESETS[this.cameraIndex].fov;
    this.resize();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __frGame?: Game }).__frGame = this;
    }
  }

  /** Match renderer, composer, camera and HUD canvas to the container size. */
  private resize() {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.viewW = w;
    this.viewH = h;
    // Resolution is the single biggest lever on a weak GPU: everything in the
    // post chain is per-pixel, so halving dpr is close to halving the cost.
    const dpr = Math.min(window.devicePixelRatio, QUALITY[this.quality].dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloomPass.setSize((w * dpr) / 2, (h * dpr) / 2);
    if (this.gtao) this.gtao.setSize(w * dpr, h * dpr);
    // Halftone pitch is in device pixels: scale it with the dpr so the dots
    // are the same size to the eye on a retina panel as on a 1x one.
    if (this.filmGrade) this.filmGrade.uniforms.dotPx.value = 3.5 * dpr;
    this.camera.aspect = w / h;
    this.camera.fov = CAMERA_PRESETS[this.cameraIndex].fov;
    this.camera.updateProjectionMatrix();
    // HUD canvas: backing store in device pixels, drawn in CSS pixels
    this.hudCanvas.width = Math.round(w * dpr);
    this.hudCanvas.height = Math.round(h * dpr);
    this.hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start() {
    this.input.attach();
    this.sound.unlock();
    this.sound.setAmbient(REALM_AMBIENCE[this.realm.id]); // per-realm ambient bed
    const s = loadSettings();
    this.sound.setVolumes(s.musicVolume, s.sfxVolume);
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
    // NOT `void this.init()`. init() is async and loads models and textures
    // over the network — the likeliest thing in the whole engine to fail on
    // someone else's machine — and an unhandled rejection is invisible to both
    // the React boundary and the window error listener.
    this.init().catch((err) => {
      if (this.stopped) return;   // we tore the race down mid-load; not a fault
      this.onError?.(err);
    });
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.input.detach();
    this.sound.dispose();
    this.weather?.dispose();
    this.composer.dispose();
    this.tow = 0;
    this.disposeScene();
    this.renderer.dispose();
    // renderer.dispose() releases three's own GL objects but leaves the
    // CONTEXT alive until the garbage collector gets around to the canvas, and
    // browsers cap live WebGL contexts at ~16 — at which point the oldest is
    // killed out from under whatever is using it. Every race builds a new
    // renderer, so this is the difference between "reclaimed when we say" and
    // "reclaimed eventually, hopefully before the sixteenth race".
    this.renderer.forceContextLoss();
    this.container.replaceChildren();
    if (process.env.NODE_ENV !== "production") {
      const w = window as unknown as { __frGame?: Game };
      if (w.__frGame === this) delete w.__frGame;
    }
  }

  /**
   * Free the GPU side of everything this race built.
   *
   * Dropping the last reference to a Game does eventually free all of this,
   * but only once the collector runs, and GPU memory is not part of what the
   * JS heap pressure model can see — so a machine can be out of VRAM while the
   * heap looks fine. Disposing explicitly makes it deterministic.
   *
   * Textures are deliberately NOT disposed here: the expensive ones are canvas
   * renders shared between races through the module-level caches in
   * textures.ts and cars.ts, and disposing those would force every realm and
   * livery to be re-uploaded on the next race for no gain.
   */
  private disposeScene() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((obj) => {
      const mesh = obj as Partial<THREE.Mesh>;
      if (mesh.geometry) geometries.add(mesh.geometry);
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
      else if (mat) materials.add(mat);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.scene.clear();
  }

  private async init() {
    // load the CC0 PBR textures for this realm alongside the models. New realms
    // reuse a close-matching shipped ground albedo (then tint it via palette).
    const groundName = groundTextureFor(this.realm.id) ?? "ground_forest";
    const [library] = await Promise.all([loadModels(), loadPBR(groundName)]);
    if (this.stopped) return;
    this.buildWorld(library);
    // Place the free-roam body on its GRID SLOT — behind the line with the
    // field — rather than on the line itself.
    //
    // lapProgress starts negative by the same amount, which is what keeps lap
    // counting honest: it reaches `len` exactly when the car returns to the
    // line, not `gridStart` metres early. Without this the first lap would tick
    // over before crossing the line, every race.
    this.freeDrive.reset(this.track, this.track.wrap(this.gridStart));
    this.lastFreeDist = this.track.wrap(this.gridStart);
    this.lapProgress = this.gridStart;
    this.combo = 0;
    this.comboT = 0;
    this.lastPosition = 0;
    this.overtakeCd = 0;
    this.callout = null;
    this.phase = "countdown";
    // The world exists now, so a recorded lap can finally be put on it. No
    // countdown: there is nothing to get set for.
    if (this.pendingReplay) {
      const data = this.pendingReplay;
      this.pendingReplay = null;
      this.startReplay(data);
    }
  }

  // --- world building ------------------------------------------------------

  private buildWorld(library: ModelLibrary) {
    // cleared HERE, not in the race reset: that runs after buildWorld and was
    // wiping the set-pieces placement had just registered (0 animated groups)
    this.grandFalls.length = 0;
    this.waterCurtains.length = 0;
    this.batFlocks.length = 0;
    // must precede the ground mesh / scenery / grass — they all sample
    // groundHeightAtXZ and need the coastline already in it
    this.coast = null;
    if (this.realm.coast) {
      const N = 160, len = this.track.length;
      let cx = 0, cz = 0;
      const pts: { x: number; z: number }[] = [];
      for (let i = 0; i < N; i++) {
        const p = this.track.pointAt((i / N) * len, 0, undefined, true);
        pts.push({ x: p.x, z: p.z });
        cx += p.x; cz += p.z;
      }
      cx /= N; cz /= N;
      let far = 0, minY = Infinity;
      for (let i = 0; i < N; i++) {
        const p = this.track.pointAt((i / N) * len, 0, undefined, true);
        if (p.y < minY) minY = p.y;
      }
      for (const p of pts) far = Math.max(far, Math.hypot(p.x - cx, p.z - cz));
      this.seaY = minY - 2.2;   // waterline just under the lowest part of the road
      // r  = how far LAND extends either side of the tarmac before the beach
      //      drops to the sea (this is what makes it a causeway)
      // far = the circuit's own radius, used to push the far-shore skyline out
      // These are different quantities and must not share a field: they did,
      // and the skyline ended up at 34*2.15 = 73 m from the centre — i.e. towers
      // standing ON the racing line, which is the giant flat wall on the road.
      const cs = this.realm.coast;
      this.coast = { x: cx, z: cz, r: cs.land, far, band: cs.band ?? 9, drop: cs.drop ?? 46, side: cs.side ?? 0 };
    }
    const { scene, track, realm } = this;
    const pal = realm.palette;

    const isVoid = realm.style === "void";
    // Poster realms get the analytic dome (see makePosterSky): a painted
    // equirect can never be sharp here, because 72 degrees of a 2048-wide
    // texture is 410 texels stretched over a 2560-pixel buffer. Realms with
    // stars or moons still need the canvas, which is where those are drawn.
    const analytic = pal.posterSun && !pal.stars && pal.moons.length === 0;
    const sky = analytic ? makePosterSky(pal) : makeSkyDome(pal);
    // The dome has to FOLLOW THE CAMERA. It is a radius-900 BackSide sphere
    // and it used to sit at the world origin, which is fine for a lap that
    // fits inside it — every realm until now did. The Neon Run stadium spans
    // 7 km, so you drive straight out through the wall, and from outside a
    // BackSide sphere is invisible: the sky vanishes and you are looking at
    // the clear colour, with the dome's rim cutting a dark arc across it.
    // That is the flat purple and the strange shape in the corner.
    this.skyMesh = sky;
    sky.userData.noShadow = true; // the sky must never cast/receive shadows
    scene.add(sky);
    // The analytic sky draws its own clouds, lit and drifting, so it needs no
    // dome — which also drops a 4096 texture and a draw call. Only the canvas
    // realms still get the separate cloud layer.
    this.skyMat = analytic ? (sky.material as THREE.ShaderMaterial) : null;
    // No cloud deck over the night city: an fbm overcast on a near-black sky
    // renders as grey smears with nothing lighting them, and it competes with
    // the one thing that should be legible up there, which is the glow coming
    // off the rooftops.
    if (!analytic && realm.id !== "neon") {
      this.clouds = makeCloudLayer(pal);
      scene.add(this.clouds);
    } else {
      this.clouds = null;
    }

    if (!isVoid) {
      // terrain that RISES with the road near the track (roads sit grounded in
      // hills instead of floating on a flat plane); we only want makeGround's
      // material, and build our own heightfield geometry in its place
      const flatGround = makeGround(pal);
      const groundMat = flatGround.material as THREE.MeshStandardMaterial;
      groundMat.normalMap = null; // terrain fills the screen — drop the per-pixel normal cost
      // FLAT SHADE THE TERRAIN on poster realms. Smooth vertex normals turn a
      // heightfield into a soft rolling wash — the hills have no edges, so they
      // read as blurred layers rather than as land. Faceting each triangle
      // gives every slope its own flat tone and a hard crease where slopes
      // meet, which is what makes a hill look like a hill in this art style.
      if (pal.posterSun) groundMat.flatShading = true;
      groundMat.needsUpdate = true;
      flatGround.geometry.dispose();
      scene.add(this.buildGroundTerrain(groundMat));
      // Horizon-filling mountain ring — but NOT for the night city. An 11 km
      // ring of 120 m peaks around a highway through Neo-Tokyo is a mountain
      // standing over the skyline, which is the big dark mass with cloud
      // smeared across it. A city's horizon is more city.
      const cx = (track.bounds.minX + track.bounds.maxX) / 2;
      const cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
      const radius = Math.max(track.bounds.maxX - track.bounds.minX, track.bounds.maxZ - track.bounds.minZ) * 0.75 + 260;
      if (realm.id !== "neon") {
        scene.add(makeMountainRing(pal, cx, cz, radius));
      } else {
        // a far-shore style cut-out skyline instead, ringing the whole lap so
        // the city never runs out whichever way you are pointed
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2;
          const R = radius * 0.72;
          const sk = makeSkyline(mulberry32(7700 + i), pal, 2600);
          sk.position.set(cx + Math.cos(ang) * R, 0, cz + Math.sin(ang) * R);
          sk.rotation.y = -ang + Math.PI / 2;
          scene.add(sk);
        }
      }
      // NO god rays. These are vertical bright columns standing on the horizon,
      // and at this scale they do not read as shafts of light through cloud —
      // they read as searchlight beams, or as something descending from the
      // sky. They were subtle against the old dark realms and are glaring
      // against a clear one. Gone from every map.
      this.lightShafts = null;
    }

    // lifted 1.45 -> 2.1: props were silhouetting to near-black, which is what
    // made ordinary trees and mushrooms read as unidentifiable dark pillars
    scene.add(new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiInt * 2.1));
    // gentle ambient so shadows aren't pure black — but light enough that the new
    // real-time shadows actually read (too much fill washed them flat)
    scene.add(new THREE.AmbientLight(pal.hemiSky, 0.62));
    // key light rakes across surfaces + casts the shadows; punchier now so the
    // shadowed side reads clearly darker than the lit side
    const sun = new THREE.DirectionalLight(pal.sun, pal.sunInt * 2.2);
    sun.position.set(60, 90, 50);
    scene.add(sun);
    // this key light also casts the shadows; its ortho frustum follows the car
    // (updated each frame) so props near you drop real, soft shadows on the road
    sun.castShadow = true;
    // 4096 is now essentially FREE (measured 6.49 -> 6.57 ms, +1%) because the
    // shadow pass is draw-call bound, not pixel bound, and the frustum below is
    // tight. The old note that 4096 cost 4x was measured against the WIDE +-95 m
    // frustum. Over +-58 m this is 2.8 cm per texel instead of 5.7 cm.
    const shadowPx = QUALITY[this.quality].shadow;
    sun.castShadow = shadowPx > 0;
    if (shadowPx > 0) sun.shadow.mapSize.set(shadowPx, shadowPx);
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.6;
    sun.shadow.radius = 7;               // soft PCF edges; scaled with mapSize (radius is in TEXELS, so 4096 needs more to stay as soft)
    const sc = sun.shadow.camera;
    // Tight ±58m frustum (was ±95): the shadow pass is draw-call bound, and this
    // culls the thousands of distant scenery casters that cost full price for a
    // shadow you can barely see — the single biggest smoothness win. Bonus: the
    // same 2048 map now covers a smaller area, so NEAR shadows are sharper. The
    // frustum is biased toward travel direction (see render) so the road ahead
    // stays shadowed.
    sc.near = 1; sc.far = 320; sc.left = -58; sc.right = 58; sc.top = 58; sc.bottom = -58;
    sc.updateProjectionMatrix();
    scene.add(sun.target);
    this.sun = sun;
    // cool fill from the opposite side so nothing reads as a black silhouette
    // (eased down so it doesn't fill in the shadows the key light now casts)
    const fill = new THREE.DirectionalLight(pal.hemiSky, 0.5);
    fill.position.set(-70, 45, -90);
    scene.add(fill);

    // On a causeway the verge mesh is wrong: it lays a FLAT apron out to 24 m
    // either side at y=0, which sits on top of the carved beach and is exactly
    // the wide brown plain hiding the water. Coastal realms get a shore apron
    // instead — same job, but it follows the ground down under the waterline.
    // The apron's texture was always the beach cross-section — dry sand, a foam
    // line, wet sand, seabed — which is right for a causeway and wrong for a
    // clifftop, where it painted a 50 m strip of beach along the top of a
    // 150 m cliff. A sided coast is a cliff; it wears the realm's own ground.
    if (this.coast) {
      const beach = this.coast.side === 0;
      scene.add(this.buildCoastApron(beach ? makeSandTexture(pal) : makeGrassTexture(pal), beach));
    }
    else if (!isVoid) scene.add(track.buildVergeMesh(makeGrassTexture(pal)));
    const roadMesh = track.buildRoadMesh(makeRoadTexture(pal), pal.roadFinish);
    scene.add(roadMesh);
    // Hold on to the ribbon's material and its dry values so the weather can
    // wet the surface and dry it again. Read back rather than looked up from a
    // table: buildRoadMesh owns the finish presets, and a second copy of those
    // numbers here would drift out of step the first time one is re-tuned.
    this.roadMat = roadMesh.material as THREE.MeshStandardMaterial;
    this.dryLook = {
      rough: this.roadMat.roughness,
      metal: this.roadMat.metalness,
      env: this.roadMat.envMapIntensity,
    };
    this.buildPuddles(pal); // reflective puddles on wet/icy tracks
    if (!isVoid) scene.add(track.buildEdgePosts(pal.rumbleB, pal.edgeLine));
    scene.add(track.buildStartLine(makeCheckerTexture()));
    if (isVoid) {
      scene.add(track.buildTube());
      scene.add(track.buildRails());
      scene.add(makeSpaceBackdrop()); // ringed planet + atmosphere in the distance
    }

    // tint every car's reflections toward this realm's sky before building them
    // poster realms light the world for silhouettes, so the car paint has to
    // hold its colour on its own (see setCarPosterMode)
    setCarPosterMode(!!pal.posterSun);
    setCarEnvTint(pal.hemiSky);
    // player rig — a procedural kart of the chosen type
    this.carModel = makeKart(this.carId, CAR_SPECS[this.carId].color);
    const mech = makeMech(this.carId);
    mech.group.visible = false;
    this.mech = mech;
    this.slash = makeSlash();
    this.slash.position.set(1.2, 2.2, 1.6);
    this.playerBody.add(this.slash);
    this.underGlow = makeUnderGlow();
    this.underGlow.position.y = 0.08;
    this.shieldBubble = makeShieldBubble();
    this.playerBody.add(this.shieldBubble);
    for (const x of [-0.8, 0.8]) {
      const flame = makeFlame();
      flame.position.set(x, 0.6, -2.2);
      flame.visible = false;
      this.flames.push(flame);
      this.playerBody.add(flame);
    }
    // underGlow removed: a glowing disc under the car reads as a UI marker
    // sitting on the road, not as part of the car
    this.playerBody.add(this.carModel, mech.group);
    this.playerRoot.add(this.playerBody);
    scene.add(this.playerRoot);
    this.playerWheels = collectWheels(this.carModel);
    this.dustColor.set(pal.groundSpeck);
    this.buildSmoke();
    this.buildSkids();
    this.buildBackfire();
    this.buildSparks();

    if (this.cfg.opponents) this.spawnOpponents();

    // start/finish gantry over the line + ambient particle field for life
    if (realm.style !== "void") {
      // On the line, not 2 m past it — the gantry marks the place laps tick.
      const gp = track.pointAt(0);
      const gtan = track.tangentAt(0);
      const gantry = makeStartGantry(pal);
      gantry.position.set(gp.x, gp.y, gp.z);
      gantry.rotation.y = Math.atan2(gtan.x, gtan.z);
      scene.add(gantry);
    }
    this.weatherKind = REALM_WEATHER[realm.id];
    this.weather = makeWeather(this.weatherKind, pal);
    scene.add(this.weather.object);
    this.weatherT = 22 + Math.random() * 20;

    this.decorate(library);
    this.buildObstacleGrid();
    this.wireAmbientOcclusion();
    this.enableShadows();
  }

  /** Roll the weather over to a different kind from this realm's pool. The
   *  particle systems are self-contained and disposable, so a change is just
   *  swap-and-replace — no need to pre-build every kind up front. */
  private rollWeather() {
    const pool = REALM_WEATHER_POOL[this.realm.id] ?? [];
    const options = pool.filter((k) => k !== this.weatherKind);
    if (!options.length) { this.weatherT = 999; return; } // realms with one fixed sky (void)
    const next = options[Math.floor(Math.random() * options.length)];
    if (this.weather) {
      this.scene.remove(this.weather.object);
      this.weather.dispose();
    }
    this.weatherKind = next;
    this.weather = makeWeather(next, this.realm.palette);
    this.scene.add(this.weather.object);
    // deliberately silent. A full-screen "MIST ROLLING IN" callout every 25-45 s
    // is pure interruption — you can SEE the weather change, it doesn't need
    // announcing over the racing.
  }

  /**
   * Ease the road's grip and its appearance toward whatever the weather is now.
   *
   * Eased over ~2.5 s rather than switched. A shower that took hold instantly
   * would change the car's handling between one frame and the next, mid-corner,
   * with no warning — which reads as a bug however well it is signposted. At
   * this rate the surface visibly darkens for a second or so before the grip
   * has fully gone, which is the order a driver can actually react to.
   */
  private updateSurface(dt: number) {
    const target = WEATHER_GRIP[this.weatherKind] ?? 1;
    this.gripMul += (target - this.gripMul) * Math.min(1, dt / 2.5);
    if (!this.roadMat) return;
    // 1 at full grip → 0 in the wet; used as the blend toward the wet look, so
    // a realm that is ALREADY wet or icy only gets wetter, never drier.
    const wet = clamp((1 - this.gripMul) / (1 - WEATHER_GRIP.rain), 0, 1);
    const m = this.roadMat;
    m.roughness = this.dryLook.rough + (WET_LOOK.rough - this.dryLook.rough) * wet;
    m.metalness = this.dryLook.metal + (WET_LOOK.metal - this.dryLook.metal) * wet;
    m.envMapIntensity = this.dryLook.env + (WET_LOOK.env - this.dryLook.env) * wet;
  }

  /** three.js reads `aoMap` from the SECOND uv channel (`uv1`), which none of
   *  our geometry has — so an aoMap assigned to a material renders as nothing at
   *  all until the channel exists. Rather than thread a second UV set through
   *  every builder, alias uv1 to uv wherever a material actually uses an aoMap.
   *  The AO is baked in the ARM texture we already load for roughness, so this
   *  buys real contact darkening in crevices for zero per-frame cost. */
  private wireAmbientOcclusion() {
    let wired = 0;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(m as unknown as { isMesh?: boolean }).isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const usesAo = mats.some((x) => (x as THREE.MeshStandardMaterial)?.aoMap);
      if (!usesAo) return;
      const geo = m.geometry as THREE.BufferGeometry;
      const uv = geo.attributes.uv;
      if (uv && !geo.attributes.uv1) { geo.setAttribute("uv1", uv); wired++; }
    });
    return wired;
  }

  /** Turn on shadow casting/receiving across the world's solid meshes (points,
   *  sprites and the sky are skipped) so props drop real shadows on the road. */
  private enableShadows() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(m as unknown as { isMesh?: boolean }).isMesh) return;
      if (o.userData.noShadow) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
  }

  // --- solid obstacles (trees/rocks/buildings you can't drive through) --------
  private static readonly OBS_CELL = 18;
  private obsKey(x: number, z: number) {
    return Math.floor(x / Game.OBS_CELL) + "," + Math.floor(z / Game.OBS_CELL);
  }
  /** A prop is a SOLID obstacle only if its whole body sits clear of the road —
   *  i.e. even its nearest edge is off the ribbon. Anything whose body reaches
   *  onto the racing line (usually a prop the track curves back toward) is left
   *  passable, so there are no invisible walls in your way. */
  private obstacleClear(x: number, z: number, r: number): boolean {
    if (Math.abs(this.track.project(x, z).lateral) - r <= ROAD_HALF_WIDTH + 0.5) return false;
    // A solid obstacle on a branch would be a wall you cannot see coming on a
    // road the game invited you onto.
    return !this.nearBranch(x, z, ROAD_HALF_WIDTH + 0.5 + r);
  }
  /** Bucket the recorded obstacles into a spatial grid for cheap per-frame lookup. */
  private buildObstacleGrid() {
    this.obstacleGrid.clear();
    this.obstacles.forEach((o, i) => {
      const key = this.obsKey(o.x, o.z);
      const b = this.obstacleGrid.get(key);
      if (b) b.push(i); else this.obstacleGrid.set(key, [i]);
    });
  }
  /** Keep the car OUT of solid scenery: on overlap, push it clear along the
   *  contact normal, kill the into-obstacle velocity (so it can't tunnel), scrub
   *  a little speed, and throw sparks. Makes the world feel physically real. */
  private resolveObstacles(dt: number) {
    this.obstacleHitCd = Math.max(0, this.obstacleHitCd - dt);
    if (!this.obstacles.length) return;
    const CAR_R = 1.4;
    const cx = this.freeDrive.x, cz = this.freeDrive.z;
    const gx = Math.floor(cx / Game.OBS_CELL), gz = Math.floor(cz / Game.OBS_CELL);
    let hit = false;
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      for (let iz = gz - 1; iz <= gz + 1; iz++) {
        const bucket = this.obstacleGrid.get(ix + "," + iz);
        if (!bucket) continue;
        for (const idx of bucket) {
          const o = this.obstacles[idx];
          const dx = cx - o.x, dz = cz - o.z;
          const min = CAR_R + o.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;               // contact normal (out of the obstacle)
          const push = min - d;
          this.freeDrive.x += nx * push;                 // shove the car clear
          this.freeDrive.z += nz * push;
          const into = this.freeDrive.vx * nx + this.freeDrive.vz * nz; // velocity component INTO it
          if (into < 0) { this.freeDrive.vx -= nx * into; this.freeDrive.vz -= nz * into; } // cancel it (no tunnel)
          this.freeDrive.vx *= 0.92; this.freeDrive.vz *= 0.92;         // impact scrub (gentle — a clip shouldn't stop you dead)
          hit = true;
        }
      }
    }
    if (hit && this.obstacleHitCd <= 0) {
      const pp = this.playerRoot.position;
      this.spawnSparks(pp.x, pp.y + 0.4, pp.z, 10);
      this.shake = Math.max(this.shake, 0.45);
      this.sound.play("bump");
      this.obstacleHitCd = 0.18;
      // Clipping scenery is the risk a near miss is played against — without
      // this, threading the gap would be free and there would be no decision
      // in it.
      this.breakChain();
    }
  }

  private spawnOpponents() {
    // F1-style standing grid: two staggered columns, cars lined up one behind
    // the other. The player starts at the BACK on the start line (dist 0), so
    // the whole field is arrayed ahead — a proper grid you launch from, not
    // karts that pop in mid-race. Slot 0 = pole (front, fastest qualifier);
    // higher slots sit further back; the player is the backmost slot. Each rival
    // drives a different kart type for real variety.
    // PAIRED ROWS, two cars abreast. This used to put one car every 5 m
    // alternating sides, which is a single-file zigzag — it reads as a queue
    // of traffic, not as a grid you are lined up on. A real standing grid is
    // rows of two, staggered so the car on the right of a row sits slightly
    // ahead of the one on its left, with a proper gap between rows.
    // BEHIND THE LINE, all of it.
    //
    // The grid used to start AT distance 0 with the field arrayed ahead, so
    // every race began with the whole pack already past the start/finish line
    // and the player sitting on it. That is backwards: a standing grid forms up
    // BEHIND the line and crosses it when the lights go out. It is the first
    // thing anyone sees, and it read as joining a race already in progress.
    //
    // Everything is negative now: pole's nose sits GRID_BACK behind the line,
    // each row a further rowStep back, and the player is the backmost slot. Lap
    // counting compensates — see lapProgress below.
    // Pole's nose sits this far behind the line — close enough that the line
    // fills the windscreen on the grid, far enough that nobody is on top of it.
    const GRID_BACK = 7;
    const rowStep = 8.0;    // metres between ROWS
    const stagger = 1.6;    // the right-hand slot of each row sits this far BACK
    const colLane = 0.38;   // the two columns, ± this in playerX units
    const gridN = Math.min(OPPONENT_COUNT, OPPONENTS.length);
    const playerSlot = gridN;                 // player is last (behind every rival)
    const rowOf = (slot: number) => Math.floor(slot / 2);
    // The odd slot of each row sits BACK from its partner, not forward. With
    // the stagger added rather than subtracted, slot 1 sat 1.6 m ahead of slot
    // 0 — so the car on pole was not actually on pole, every row was ordered
    // backwards, and the player (the odd slot of the last row) started 1.6 m
    // AHEAD of the ninth rival instead of behind it. Measured: rivals at -5.4
    // to -39, player at -37.4, ninth of ten on a grid that is supposed to put
    // them last. One sign fixes the row ordering and the back of the grid at once.
    const slotDist = (slot: number) =>
      -(GRID_BACK + rowOf(slot) * rowStep) - (slot % 2 === 1 ? stagger : 0);
    const slotLane = (slot: number) => (slot % 2 === 0 ? -colLane : colLane);
    this.gridStart = slotDist(playerSlot);   // the player's own slot, for init()

    // WHICH CAR EACH RIVAL DRIVES. `CAR_IDS[i % CAR_IDS.length]` looks like it
    // cycles the whole catalogue and does not: there are nine rivals and
    // fourteen cars, so it only ever reached indices 0-8. The four built from
    // the reference art and the Fairlady were unreachable on the grid — they
    // existed only if you scrolled the picker to the bottom and chose one.
    //
    // A stride coprime to the pool size walks the whole list instead of the
    // front of it, and dropping the player's own car means you are not racing
    // nine strangers and your own twin.
    const pool = CAR_IDS.filter((c) => c !== this.carId);
    for (let i = 0; i < gridN; i++) {
      const spec = OPPONENTS[i];
      const car = makeKart(pool[(i * 5) % pool.length], spec.color);
      // rear nitro flames (shown when the opponent boosts)
      const flames: THREE.Mesh[] = [];
      for (const fx of [-0.55, 0.55]) {
        const fl = makeFlame();
        fl.position.set(fx, 0.5, -2.1);
        fl.visible = false;
        (fl.material as THREE.MeshBasicMaterial).color.setHex(0xfb923c);
        car.add(fl);
        flames.push(fl);
      }
      car.userData.wheels = collectWheels(car);
      car.userData.wheelDist = 0;
      this.scene.add(car);
      const opp = new Opponent(car, spec.color, spec.name, spec.skill, slotDist(i));
      opp.lane = slotLane(i);
      opp.lap = 1;
      opp.flames = flames;
      // pole (1.0 = your top speed) down to tail (0.90): a real fight now — with
      // the strong catch-up rubber-band they stay right on you (competitive), but
      // slow when they get ahead so a clean lap still wins (no more lapping you)
      // Across a 10-car grid a 0.10 spread put the tail at 0.90 of your top
      // speed — from P10 the back half was easy pickings. 0.06 keeps the whole
      // field within 6% of each other, so passing all nine is a real climb.
      opp.pace = 1.0 - (i / Math.max(1, gridN - 1)) * 0.06;
      opp.place(this.track); // snap onto the grid now so the field lines up during the countdown
      this.opponents.push(opp);
    }
  }

  /** Scatter flat, near-mirror reflective patches on the road for wet/icy
   *  realms — they catch the sky/neon env like standing water or a glaze of ice. */
  private buildPuddles(pal: RealmPalette) {
    const finish = pal.roadFinish;
    if (finish !== "wet" && finish !== "ice") return;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: finish === "ice" ? 0xbfe4ff : 0x0a0e18,
      roughness: 0.05, metalness: 0.25, envMapIntensity: 2.4,
      transparent: true, opacity: 0.72, depthWrite: false,
    });
    const geo = new THREE.CircleGeometry(1, 14);
    const len = this.track.length;
    let seed = 4242;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 50; i++) {
      const p = this.track.pointAt(rand() * len, (rand() * 2 - 1) * ROAD_HALF_WIDTH * 0.72);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, p.y + 0.02, p.z);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rand() * Math.PI;
      m.scale.set(1.2 + rand() * 2.8, 0.9 + rand() * 2.0, 1);
      m.renderOrder = 1;
      m.userData.noShadow = true;
      g.add(m);
    }
    this.scene.add(g);
  }

  /** Build a recycled pool of world-space smoke sprites for drifting tyres. */
  private buildSmoke() {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.5, "rgba(228,230,240,0.5)");
    g.addColorStop(1, "rgba(228,230,240,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.smoke = [];
    for (let i = 0; i < 30; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0xd7d9e2, transparent: true, opacity: 0, depthWrite: false });
      const spr = new THREE.Sprite(mat);
      spr.visible = false;
      spr.renderOrder = 3;
      this.scene.add(spr);
      this.smoke.push({ spr, life: 0, max: 0.55, vel: new THREE.Vector3() });
    }
  }

  private spawnSmoke(x: number, y: number, z: number, tanx: number, tanz: number, color: THREE.Color) {
    const puff = this.smoke.find((s) => s.life <= 0);
    if (!puff) return;
    puff.max = 0.5 + Math.random() * 0.22;
    puff.life = puff.max;
    puff.spr.position.set(x + (Math.random() - 0.5) * 0.25, y, z + (Math.random() - 0.5) * 0.25);
    puff.spr.scale.setScalar(0.45 + Math.random() * 0.2);
    puff.spr.visible = true;
    (puff.spr.material as THREE.SpriteMaterial).color.copy(color);
    (puff.spr.material as THREE.SpriteMaterial).opacity = 0.6;
    // billow up and kick out behind the car (opposite its heading) with scatter
    puff.vel.set(-tanx * 1.3 + (Math.random() - 0.5) * 1.3, 0.9 + Math.random() * 0.5, -tanz * 1.3 + (Math.random() - 0.5) * 1.3);
  }

  private updateSmoke(dt: number) {
    for (const s of this.smoke) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.spr.visible = false; continue; }
      s.vel.y -= dt * 0.7;
      s.spr.position.addScaledVector(s.vel, dt);
      const t = 1 - s.life / s.max;          // 0 → 1 over its life
      s.spr.scale.setScalar(0.45 + t * 1.5);  // billow out
      (s.spr.material as THREE.SpriteMaterial).opacity = 0.6 * (1 - t);
    }
  }

  /** A recycled pool of bright additive sparks for impacts (bumps / hits). */
  private buildSparks() {
    const c = document.createElement("canvas");
    c.width = 32; c.height = 32;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,214,130,0.95)");
    g.addColorStop(1, "rgba(255,140,40,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    this.sparks = [];
    for (let i = 0; i < 48; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffd782, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const spr = new THREE.Sprite(mat);
      spr.visible = false; spr.renderOrder = 4;
      this.scene.add(spr);
      this.sparks.push({ spr, life: 0, max: 0.3, vel: new THREE.Vector3() });
    }
  }

  /** Burst `count` sparks outward from an impact point. */
  private spawnSparks(x: number, y: number, z: number, count = 10) {
    for (let n = 0; n < count; n++) {
      const s = this.sparks.find((s) => s.life <= 0);
      if (!s) break;
      s.max = 0.2 + Math.random() * 0.24; s.life = s.max;
      s.spr.position.set(x, y, z);
      s.spr.scale.setScalar(0.22 + Math.random() * 0.3);
      s.spr.visible = true;
      (s.spr.material as THREE.SpriteMaterial).opacity = 1;
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
      s.vel.set(Math.cos(a) * sp, 2 + Math.random() * 4.5, Math.sin(a) * sp);
    }
  }

  private updateSparks(dt: number) {
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.spr.visible = false; continue; }
      s.vel.y -= dt * 15;                    // gravity — sparks arc down
      s.spr.position.addScaledVector(s.vel, dt);
      const t = 1 - s.life / s.max;
      (s.spr.material as THREE.SpriteMaterial).opacity = 1 - t;
    }
  }

  /** A recycled ring of dark decals laid flat on the road as tyre marks. */
  private buildSkids() {
    const c = document.createElement("canvas");
    c.width = 32; c.height = 32;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,0.9)");   // white alpha mask — tinted per surface
    g.addColorStop(0.6, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(0.44, 0.44);
    this.skids = [];
    for (let i = 0; i < 150; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;   // lie flat on the road
      m.visible = false;
      m.renderOrder = 1;             // over the road, under the cars
      m.userData.noShadow = true;
      this.scene.add(m);
      this.skids.push(m);
    }
  }

  private spawnSkid(x: number, y: number, z: number, color: THREE.Color, alpha: number) {
    const m = this.skids[this.skidIdx];
    this.skidIdx = (this.skidIdx + 1) % this.skids.length;
    // 5 cm, not 3. The road is banked now, and a flat quad laid at exactly the
    // contact height sinks into a tilted surface along one edge.
    m.position.set(x, y + 0.05, z);
    m.visible = true;
    const s = 0.85 + Math.random() * 0.4;
    m.scale.set(s, s, 1);
    m.userData.life = m.userData.max = 3.0 + Math.random() * 1.0;
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.color.copy(color);
    mat.opacity = alpha;
    m.userData.alpha = alpha;
  }

  private updateSkids(dt: number) {
    for (const m of this.skids) {
      if (!m.visible) continue;
      m.userData.life -= dt;
      if (m.userData.life <= 0) { m.visible = false; continue; }
      (m.material as THREE.MeshBasicMaterial).opacity = (m.userData.alpha as number) * (m.userData.life / m.userData.max);
    }
  }

  /** Two additive flash sprites at the exhausts that pop while boosting. */
  private buildBackfire() {
    const c = document.createElement("canvas");
    c.width = 32; c.height = 32;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,190,110,0.9)");
    g.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    this.backfire = [];
    for (const x of [-0.5, 0.5]) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffcaa0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const spr = new THREE.Sprite(mat);
      spr.position.set(x, 0.55, -2.25);
      spr.scale.setScalar(0.22);
      spr.visible = false;
      spr.userData.pop = 0;
      this.playerBody.add(spr);
      this.backfire.push(spr);
    }
  }

  /** Spin + steer the wheels, nod the body under acceleration/braking, and puff
   *  tyre smoke while drifting/sliding — the moment-to-moment "feel" of the car. */
  private animateCar(dt: number) {
    // wheel spin from real ground distance (per-wheel radius), front pair steers
    this.wheelDist += this.speed * dt;
    const steerAngle = this.steer * 0.5;
    for (const w of this.playerWheels) {
      w.obj.rotation.x = this.wheelDist / w.r;
      if (w.front) w.obj.rotation.y = steerAngle;
    }

    // weight transfer: nose lifts under power, dips under braking
    const accel = (this.speed - this.prevSpeed) / Math.max(dt, 1e-3);
    this.prevSpeed = this.speed;
    const pitchTarget = clamp(-accel * 0.012, -0.05, 0.05);
    this.bodyPitch += (pitchTarget - this.bodyPitch) * Math.min(1, dt * 6);

    // suspension: a damped spring squash-and-stretch (kicked on landings/impacts)
    this.suspV += (-this.susp * 150 - this.suspV * 13) * dt;
    this.susp += this.suspV * dt;
    if (this.carModel) {
      this.carModel.rotation.x = this.bodyPitch;
      const s = clamp(this.susp, -0.16, 0.42);
      this.carModel.scale.set(1 + s * 0.28, 1 - s * 0.55, 1 + s * 0.28);
    }

    // drifting / sliding rear tyres throw smoke AND lay marks, coloured to the
    // surface: dark rubber + grey smoke on tarmac, kicked-up realm dust off-road
    const smoking = (this.drifting || this.slipping) && this.alt < 0.35 && this.speed > 6 && !this.transformed;
    if (smoking) {
      const offRoad = Math.abs(this.playerX) > 1;
      const skidCol = offRoad ? this.dustColor : SMK_RUBBER;
      const skidAlpha = offRoad ? 0.5 : 0.66;
      const smokeCol = offRoad ? this.dustColor : SMK_GREY;
      const wp = new THREE.Vector3();
      this.smokeTimer -= dt;
      const puff = this.smokeTimer <= 0;
      if (puff) this.smokeTimer = 0.025;
      this.skidTimer -= dt;
      const mark = this.skidTimer <= 0;
      if (mark) this.skidTimer = 0.02;
      if (puff || mark) {
        const tan = this.pathTangent(0);
        for (const w of this.playerWheels) {
          if (w.front) continue;
          w.obj.getWorldPosition(wp);
          if (puff) this.spawnSmoke(wp.x, wp.y - w.r * 0.4, wp.z, tan.x, tan.z, smokeCol);
          if (mark) this.spawnSkid(wp.x, wp.y - w.r, wp.z, skidCol, skidAlpha);
        }
      }
    }

    // exhaust backfire: rapid pops while boosting, plus a bang when you snap off
    // the throttle at speed
    const boost = this.nitroT > 0 || this.driftBoostT > 0 || this.boostT > 0;
    if (boost && !this.transformed) {
      this.backfireTimer -= dt;
      if (this.backfireTimer <= 0) {
        this.backfireTimer = 0.05 + Math.random() * 0.12;
        const spr = this.backfire[Math.floor(Math.random() * this.backfire.length)];
        if (spr) spr.userData.pop = 0.13;
      }
    }
    if (!this.transformed && this.speed > MAX_SPEED * 0.45 && accel < -9 && Math.random() < 0.5)
      for (const spr of this.backfire) spr.userData.pop = 0.12;
    for (const spr of this.backfire) {
      const p = spr.userData.pop as number;
      if (p > 0) {
        spr.userData.pop = p - dt;
        spr.visible = true;
        const k = Math.max(0, p / 0.13);
        spr.scale.setScalar(0.24 + (1 - k) * 0.55);
        const mat = spr.material as THREE.SpriteMaterial;
        mat.opacity = k;
        mat.color.setHex(this.transformed ? 0x9fe8ff : 0xffcaa0);
      } else if (spr.visible) spr.visible = false;
    }

    this.updateSmoke(dt);
    this.updateSkids(dt);
    this.updateSparks(dt);
  }

  /** Signature that dedups visually-identical materials, so a prop's sub-meshes
   *  built with separate-but-equal material instances still batch together. */
  private static matSig(mat: THREE.Material): string {
    const m = mat as unknown as {
      type: string; color?: THREE.Color; roughness?: number; metalness?: number;
      emissive?: THREE.Color; emissiveIntensity?: number; map?: { uuid: string } | null;
      transparent?: boolean; opacity?: number; side?: number; vertexColors?: boolean; flatShading?: boolean;
    };
    return [
      m.type, m.color ? m.color.getHexString() : "-", m.roughness ?? "-", m.metalness ?? "-",
      m.emissive ? m.emissive.getHexString() : "-", m.emissiveIntensity ?? "-",
      m.map ? m.map.uuid : "-", m.transparent ? 1 : 0, m.opacity ?? 1, m.side ?? 0,
      m.vertexColors ? 1 : 0, m.flatShading ? 1 : 0,
    ].join("|");
  }

  /** Collapse a freshly-built prop's sub-meshes into one mesh per material, in
   *  the prop's LOCAL space — so the caller's placement transform AND the wind
   *  sway (which keys its amount off local vertex height and its phase off world
   *  position) both keep working. Roughly 4x fewer draw calls across the world,
   *  which is the dominant per-frame cost. Props containing sprites / instanced /
   *  skinned / multi-material meshes are left untouched, and ANY failure returns
   *  the original — batching must never change how a prop looks or break one. */
  private mergeProp(root: THREE.Object3D): THREE.Object3D {
    try {
      let mergeable = true;
      const meshes: THREE.Mesh[] = [];
      root.traverse((o) => {
        if (!mergeable) return;
        const a = o as unknown as { isMesh?: boolean; isInstancedMesh?: boolean; isSkinnedMesh?: boolean; isSprite?: boolean; isLine?: boolean; isPoints?: boolean };
        if (a.isSprite || a.isLine || a.isPoints || a.isInstancedMesh || a.isSkinnedMesh) { mergeable = false; return; }
        if (a.isMesh) {
          const m = o as THREE.Mesh;
          if (Array.isArray(m.material) || o.userData.noMerge) { mergeable = false; return; }
          meshes.push(m);
        }
      });
      if (!mergeable || meshes.length < 2) return root;

      root.updateMatrixWorld(true);
      const invRoot = root.matrixWorld.clone().invert();
      const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[] }>();
      for (const m of meshes) {
        let g = m.geometry.clone();
        if (g.index) g = g.toNonIndexed();
        // bake the mesh's transform relative to the prop root (local space)
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld));
        // bucket by material AND exact attribute set, so a merge can never mismatch
        const key = Game.matSig(m.material as THREE.Material) + "#" + Object.keys(g.attributes).sort().join(",");
        let b = buckets.get(key);
        if (!b) { b = { mat: m.material as THREE.Material, cast: !!m.castShadow, recv: !!m.receiveShadow, geos: [] }; buckets.set(key, b); }
        b.geos.push(g);
      }

      const out = new THREE.Group();
      out.position.copy(root.position);
      out.quaternion.copy(root.quaternion);
      out.scale.copy(root.scale);
      out.userData = root.userData;
      for (const b of buckets.values()) {
        const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
        if (!merged) return root; // incompatible → keep the original, never break the look
        const mesh = new THREE.Mesh(merged, b.mat);
        mesh.castShadow = b.cast;
        mesh.receiveShadow = b.recv;
        out.add(mesh);
      }
      return out;
    } catch {
      return root; // any error → original prop, unchanged
    }
  }

  /** Densely-sampled centreline, cached — used to guarantee no prop overlaps the
   *  road ANYWHERE (a lateral offset only clears the road locally; on a winding
   *  circuit the track loops back and can run right into a monument placed
   *  "safely" 40 m off a different corner). */
  private roadSamples: { x: Float64Array; z: Float64Array } | null = null;
  private ensureRoadSamples() {
    if (this.roadSamples) return this.roadSamples;
    const step = 4;
    const n = Math.max(64, Math.ceil(this.track.length / step));
    // THE BRANCHES ARE ROAD. Everything that asks "is this spot clear of the
    // circuit" goes through here, so including the alternate routes in the same
    // sample set is what keeps a monument out of the middle of a fork — rather
    // than adding a second test at each of the half-dozen call sites and
    // forgetting one. Requires placeBranches() to have run first, which it has:
    // decorate() builds the forks before it places any scenery.
    const bn: number[] = [];
    const bx: number[] = [], bz: number[] = [];
    for (const br of this.branches) {
      const m = Math.max(8, Math.ceil(br.path.length / step));
      for (let i = 0; i <= m; i++) {
        const p = br.path.pointAt((br.path.length * i) / m, 0);
        bx.push(p.x); bz.push(p.z);
      }
      bn.push(m);
    }
    const x = new Float64Array(n + bx.length), z = new Float64Array(n + bz.length);
    for (let i = 0; i < n; i++) {
      const p = this.track.pointAt((this.track.length * i) / n, 0);
      x[i] = p.x; z[i] = p.z;
    }
    for (let i = 0; i < bx.length; i++) { x[n + i] = bx[i]; z[n + i] = bz[i]; }
    this.roadSamples = { x, z };
    return this.roadSamples;
  }

  /** How far a prop's own geometry reaches from its origin in X/Z (after scaling). */
  private footprintReach(obj: THREE.Object3D): number {
    return this.propMetrics(obj).reach;
  }

  /** A prop's XZ reach AND its height, plus the clearance it should keep from the
   *  road. Clearance scales with HEIGHT on purpose: a 2 m bush at the verge is
   *  scenery, but a 25 m pyramid the same distance away is a wall looming over
   *  the racing line (and something you slam into the moment you run wide).
   *  Tall monuments therefore stand well back and read as landscape. */
  private propMetrics(obj: THREE.Object3D): { reach: number; height: number; margin: number } {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return { reach: 0, height: 0, margin: 3 };
    const reach = Math.max(
      Math.abs(box.min.x), Math.abs(box.max.x),
      Math.abs(box.min.z), Math.abs(box.max.z),
    );
    const height = Math.max(0, box.max.y - box.min.y);
    // Scale the standoff by BULK (footprint), not height. A tall thin tree or
    // obelisk at the verge is good scenery; a 25 m-WIDE pyramid the same
    // distance away is a wall over the racing line. Keying on reach keeps the
    // forest lush right up to the road while pushing monuments back.
    const margin = 3 + Math.max(0, reach - 4) * 1.4;
    return { reach, height, margin };
  }

  /**
   * The height of the ground AS DRAWN, not as computed.
   *
   * This distinction is the whole bug. `groundHeightAtXZ` is the analytic
   * terrain function; the visible ground is a GRID MESH whose vertices sample
   * that function every 9 or 12 m, with flat triangles in between. On a ridge
   * the triangle chord cuts below the curve it interpolates, so a prop placed
   * at the analytic height stands above the surface a player can see — by the
   * chord error, which grows with the square of the cell size.
   *
   * That is why a waterfall measured as 0.4 m BURIED was rendering with clear
   * daylight underneath it, and why nearby rocks floated too. Props have to be
   * placed against the drawn surface.
   *
   * Reproduces the mesh exactly rather than raycasting it: same origin, same
   * cell size, same diagonal (a, d, b / b, d, e — so the split runs from the
   * cell's -x+z corner to its +x-z corner). O(1) per sample instead of a walk
   * over ~14k triangles.
   */
  private renderedGroundY(x: number, z: number): number {
    const b = this.track.bounds, margin = 470;
    const cell = this.realm.palette.posterSun ? 9 : 12;
    const minX = b.minX - margin, minZ = b.minZ - margin;
    const fc = (x - minX) / cell, fr = (z - minZ) / cell;
    const c = Math.floor(fc), r = Math.floor(fr);
    const tx = fc - c, tz = fr - r;                  // 0..1 within the cell
    const gx = (i: number) => minX + i * cell;
    const gz = (i: number) => minZ + i * cell;
    const h = (ci: number, ri: number) => this.groundHeightAtXZ(gx(ci), gz(ri));
    const h00 = h(c, r), h10 = h(c + 1, r), h01 = h(c, r + 1), h11 = h(c + 1, r + 1);
    // Which of the cell's two triangles the point falls in. The winding above
    // puts the shared edge between (c, r+1) and (c+1, r).
    return tx + tz <= 1
      ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
      : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  /** How much the ground varies under a footprint — 0 is level, 10 is a cliff. */
  /**
   * How much height a waterfall's footprint has to span before the ground
   * under it counts as a cliff rather than a slope.
   *
   * `groundSpreadUnder` samples a ring of radius min(reach, 12) m, so this is
   * a drop of 14 m across at most 24 m of ground — steep enough that the rock
   * face reads as a cliff the water is coming off. The level-ground search the
   * other landmarks use accepts a spread of 6 and under.
   */
  private static readonly CLIFF_SPREAD = 14;

  /**
   * The nearest spot to (`d`, `side`) whose ground is steep enough to stand a
   * waterfall on, or null if there is none nearby.
   *
   * Searches ALONG the lap as well as out from it. Walking straight out from
   * one fixed distance finds a cliff only if the map happens to put one on
   * that bearing, and it usually does not: sampling Enchanted Forest on a
   * 20 m x 12 m grid, 6.6% of spots clear the threshold and the steepest is
   * 26 m, so cliffs exist there — they were just never where the three
   * nominal distances pointed, and the realm shipped with none. Sliding
   * +/-120 m turns "is there a cliff exactly here" into "is there a cliff
   * near here", which is the question worth asking.
   */
  private findCliff(d: number, side: number, reach: number): { d: number; off: number } | null {
    let bestOff = 0, bestD = d, bestSpread = -Infinity;
    for (let dd = -120; dd <= 120; dd += 20) {
      for (let off = ROAD_HALF_WIDTH + 12; off <= 90; off += 9) {
        const jd = this.track.wrap(d + dd);
        const q = this.track.pointAt(jd, side * off);
        // THE PROP'S OWN FOOTPRINT HAS TO CLEAR THE ROAD, and this had no such
        // check — which is how a waterfall ended up standing across the track.
        //
        // The mechanism is worth spelling out because "search for the steepest
        // ground" sounds safe and is not: where a road cuts THROUGH a hill, the
        // steepest ground for a hundred metres in any direction is the cutting
        // itself. So the search reliably picked the embankment at the very
        // first offset it tried, and a waterfall scaled 1.5-2.2x overhung the
        // tarmac from there. Looking for a cliff finds the one the road made.
        //
        // roadClear tests against the WHOLE circuit, not just this point, so it
        // also stops a prop being planted on a different part of the lap that
        // happens to pass nearby.
        if (!this.roadClear(q.x, q.z, reach, 6)) continue;
        const spread = this.groundSpreadUnder(q.x, q.z, reach);
        if (spread > bestSpread) { bestSpread = spread; bestOff = off; bestD = jd; }
        if (spread >= Game.CLIFF_SPREAD) return { d: jd, off };
      }
    }
    return bestSpread >= Game.CLIFF_SPREAD ? { d: bestD, off: bestOff } : null;
  }

  /**
   * The surface a trailing camera must stay above.
   *
   * NOT by projecting the camera onto the track. That was the whole problem:
   * `project` returns the nearest point on the WHOLE circuit, so a lap that
   * doubles back — or a road that runs beside its own tunnel — hands back a
   * point on a different section at a different height. Narrowing the corridor
   * made it rare and widening it made it common; gating on lap distance just
   * turned a wrong answer into no answer, and the fallback was the terrain,
   * which above a tunnel is the hill the road is bored through. Measured at
   * Enchanted Forest's cave exit, the floor went 1.19 -> 11.77 m between two
   * frames and took the viewpoint with it.
   *
   * The camera is a TRAILING camera, so the road it is over is simply the road
   * `back` metres behind the car. Sampling it by distance instead of by
   * position has no nearest-point ambiguity in it at all, and is continuous by
   * construction because the car's own distance is.
   */
  private cameraFloorAt(carDist: number, back: number, camX: number, camZ: number): number {
    const fd = this.freeDrive;
    const bi = fd.onBranchIdx;
    let road: number;
    if (bi >= 0 && bi < this.branches.length) {
      const b = this.branches[bi].path;
      const u = clamp(b.project(fd.x, fd.z).u - back, 0, b.length);
      road = b.pointAt(u, 0, this.tmpCamFloor).y;
    } else {
      road = this.track.pointAt(this.track.wrap(carDist - back), 0, this.tmpCamFloor, false).y;
    }
    // Off the ribbon the terrain is what you are over, so it counts too. On it,
    // the road alone is the floor — see the tunnel note above.
    if (Math.abs(fd.lateral) > ROAD_HALF_WIDTH) {
      return Math.max(road, this.groundHeightAtXZ(camX, camZ));
    }
    return road;
  }

  private groundSpreadUnder(x: number, z: number, reach: number): number {
    const r = Math.min(Math.max(1, reach), 12);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = this.renderedGroundY(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    return hi - lo;
  }

  /**
   * The lowest ground height under a prop's footprint.
   *
   * Props have flat bases and terrain does not. Placing one at the height of
   * its centre point works on a plain and fails on a hillside, where the base
   * floats by however much the slope drops across the footprint. Sampling a
   * ring plus the centre and taking the minimum means a prop is always
   * standing on something; the cost is that it beds into the uphill side,
   * which nobody ever notices.
   */
  private groundFloorUnder(x: number, z: number, reach: number, maxSink = 8): number {
    // Sample no wider than 12 m even for a huge monument: `reach` comes from a
    // bounding box that includes the prop's HEIGHT, so a tall tower would
    // otherwise probe a ring 40 m out and find an unrelated valley.
    const r = Math.min(Math.max(1, reach), 12);
    const centre = this.renderedGroundY(x, z);
    let lo = centre;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = this.renderedGroundY(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (h < lo) lo = h;
    }
    // And never bury a prop further than `maxSink` below its centre, so a spot
    // beside a cliff edge sinks a monument rather than swallowing it.
    return Math.max(lo, centre - maxSink);
  }

  /** True if a prop of the given footprint, standing at (x,z), leaves the whole
   *  circuit clear by `margin`. */
  private roadClear(x: number, z: number, reach: number, margin = 3): boolean {
    const { x: sx, z: sz } = this.ensureRoadSamples();
    const need = ROAD_HALF_WIDTH + margin + reach;
    const n2 = need * need;
    for (let i = 0; i < sx.length; i++) {
      const dx = x - sx[i], dz = z - sz[i];
      if (dx * dx + dz * dz < n2) return false;
    }
    return true;
  }

  /** Push a prop's lateral offset out until its OWN footprint clears the road.
   *  Monuments (pyramids, castles, grandstands) are tens of metres wide, so a
   *  fixed band offset let them overhang the tarmac — you'd round a bend into a
   *  pyramid sitting on the racing line. This measures the prop's ACTUAL scaled
   *  footprint and guarantees a gap, in every realm and every band. Call AFTER
   *  scaling and BEFORE positioning (the prop is still at the origin). */
  private clearOffset(obj: THREE.Object3D, off: number, gap = 4): number {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return off;
    const reach = Math.max(
      Math.abs(box.min.x), Math.abs(box.max.x),
      Math.abs(box.min.z), Math.abs(box.max.z),
    );
    const need = ROAD_HALF_WIDTH + gap + reach;
    return Math.sign(off) * Math.max(Math.abs(off), need);
  }


  // --- instanced scenery ----------------------------------------------------
  /** Baked, mergeable variants for one scenery kind, or null if the kind can't
   *  be instanced (sprites, animated parts, multi-material meshes). */
  private propVariantCache = new Map<SceneryKind, { reach: number; parts: { mat: THREE.Material; geo: THREE.BufferGeometry }[] }[] | null>();

  /** Build a small variant set for a kind ONCE, baking each variant's geometry
   *  down to one merged geometry per material.
   *
   *  Trees proved the point: this renderer is draw-call bound, so thousands of
   *  individually-built props convert almost linearly into frame time. Props are
   *  procedurally unique, which is exactly what blocks instancing — so we trade
   *  "every prop unique" for "N unique variants, reused". The group's own random
   *  yaw is deliberately NOT baked; yaw goes per instance, so a handful of
   *  variants still yields a roadside where no two props sit identically.
   *  Building 5 variants instead of thousands of objects also makes world build
   *  dramatically cheaper. */
  private getPropVariants(kind: SceneryKind, library: ModelLibrary, rand: () => number) {
    const cached = this.propVariantCache.get(kind);
    if (cached !== undefined) return cached;
    const list: { reach: number; parts: { mat: THREE.Material; geo: THREE.BufferGeometry }[] }[] = [];
    let ok = true;
    for (let i = 0; i < 5 && ok; i++) {
      const g = this.sceneryObjectRaw(kind, library, rand);
      g.rotation.y = 0;
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      if (!isFinite(box.min.x) || !isFinite(box.max.x)) { ok = false; break; }
      const reach = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
      const inv = g.matrixWorld.clone().invert();
      const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
      g.traverse((o) => {
        if (!ok) return;
        const a = o as unknown as { isMesh?: boolean; isInstancedMesh?: boolean; isSprite?: boolean; isLine?: boolean; isPoints?: boolean };
        if (a.isSprite || a.isLine || a.isPoints || a.isInstancedMesh) { ok = false; return; }
        if (!a.isMesh) return;
        const m = o as THREE.Mesh;
        if (Array.isArray(m.material)) { ok = false; return; }
        let geo = m.geometry.clone();
        if (geo.index) geo = geo.toNonIndexed();
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        const arr = buckets.get(m.material as THREE.Material) ?? [];
        arr.push(geo);
        buckets.set(m.material as THREE.Material, arr);
      });
      if (!ok) break;
      const parts: { mat: THREE.Material; geo: THREE.BufferGeometry }[] = [];
      for (const [mat, geos] of buckets) {
        // a merge needs every geometry in the bucket to carry the same attributes
        const sig = new Set(geos.map((x) => Object.keys(x.attributes).sort().join(",")));
        if (sig.size !== 1) { ok = false; break; }
        const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
        if (!merged) { ok = false; break; }
        parts.push({ mat, geo: merged });
      }
      if (!ok) break;
      list.push({ reach, parts });
    }
    const result = ok && list.length ? list : null;
    this.propVariantCache.set(kind, result);
    return result;
  }

  /** Same standoff rule as clearOffset/propMetrics, but from a cached reach so
   *  no object needs to exist to decide where a prop can stand. */
  private offsetForReach(reach: number, off: number, gap = 4) {
    const need = ROAD_HALF_WIDTH + gap + reach;
    return Math.sign(off) * Math.max(Math.abs(off), need);
  }
  private marginForReach(reach: number) {
    return 3 + Math.max(0, reach - 4) * 1.4;
  }

  /** Turn collected placements into instanced draw calls. */
  private buildPropFields(buckets: Map<string, { variant: { parts: { mat: THREE.Material; geo: THREE.BufferGeometry }[] }; spots: { x: number; y: number; z: number; s: number; r: number }[] }>) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let calls = 0;
    for (const { variant, spots } of buckets.values()) {
      if (!spots.length) continue;
      for (const part of variant.parts) {
        const inst = new THREE.InstancedMesh(part.geo, part.mat, spots.length);
        spots.forEach((sp, i) => {
          q.setFromAxisAngle(up, sp.r);
          pos.set(sp.x, sp.y, sp.z);
          scl.set(sp.s, sp.s, sp.s);
          m.compose(pos, q, scl);
          inst.setMatrixAt(i, m);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = true;
        inst.receiveShadow = true;
        this.scene.add(inst);
        calls++;
      }
    }
    return calls;
  }

  private sceneryObject(kind: SceneryKind, library: ModelLibrary, rand: () => number): THREE.Object3D {
    return this.mergeProp(this.sceneryObjectRaw(kind, library, rand));
  }

  private sceneryObjectRaw(kind: SceneryKind, library: ModelLibrary, rand: () => number): THREE.Object3D {
    if (kind === "crystal") return makeCrystalCluster(rand, this.realm.palette.crystalColors);
    // textured procedural trees (bark trunk + leaf foliage) instead of the flat
    // low-poly kit models — shared materials so hundreds stay cheap
    if (this.treeMats) {
      if (kind === "treeA") return makeTree(rand, this.treeMats, "pine");
      if (kind === "treeB") return makeTree(rand, this.treeMats, "round");
      if (kind === "treeDark") return makeTree(rand, this.treeMats, "tall");
    }
    // procedural mushrooms + rocks (nicer than the crude imported GLTF models)
    if (kind === "mushroom") return makeMushroom(rand, false);
    if (kind === "mushroomTall") return makeMushroom(rand, true);
    if (kind === "rockA" || kind === "rockB") return makeRockProp(rand);
    // themed-realm props (self-contained procedural builders)
    switch (kind) {
      case "pyramid": return makePyramid(rand);
      case "obelisk": return makeObelisk(rand);
      case "sphinx": return makeSphinx(rand);
      // one palm in the game, not two — see makePalmProp
      case "palm": return makePalmProp(rand, this.realm.palette);
      case "sandRock": return makeSandRock(rand);
      case "tower": return makeTower(rand);
      case "gatehouse": return makeGatehouse(rand);
      case "castleWall": return makeCastleWall(rand);
      case "banner": return makeBanner(rand);
      case "torch": return makeTorch(rand);
      case "grandstand": return makeGrandstand(rand);
      case "tyreStack": return makeTyreStack(rand);
      case "floodlight": return makeFloodlight(rand);
      case "pitBuilding": return makePitBuilding(rand);
      case "marshalBoard": return makeMarshalBoard(rand);
      case "skyscraper": return makeSkyscraper(rand);
      case "brownstone": return makeBrownstone(rand);
      case "streetlight": return makeStreetlight(rand);
      case "billboard": return makeBillboard(rand);
      case "waterTower": return makeWaterTower(rand);
      case "hogwartsCastle": return makeHogwartsCastle(rand);
      case "hogwartsExpress": return makeHogwartsExpress(rand);
      case "quidditchHoop": return makeQuidditchHoop(rand);
      case "floatingCandle": return makeFloatingCandle(rand);
      case "goldenSnitch": return makeGoldenSnitch(rand);
      case "whompingWillow": return makeWhompingWillow(rand);
      case "waterfall": return makeWaterfall(rand);
    }
    let obj: THREE.Object3D;
    switch (kind) {
      // trees fall back to the GLTF kit only if the procedural materials failed
      case "treeA": obj = instantiate(library, "treeA", 3 + rand() * 2.2); break;
      case "treeB": obj = instantiate(library, "treeB", 3 + rand() * 2.2); break;
      case "treeDark": obj = instantiate(library, "treeDark", 2.5 + rand() * 2); break;
      default: obj = makeRockProp(rand); break; // anything else → a procedural boulder
    }
    // per-instance colour variation so the forest isn't a wall of identical props
    obj.rotation.y = rand() * Math.PI * 2;
    varyTint(obj, rand);
    return obj;
  }

  /**
   * @param road -1 for the main circuit, or an index into `branches`. A branch
   *   entity is placed along that branch's own curve and stores its `dist` as
   *   the MAIN-track distance the branch maps to, so the distance buckets and
   *   every lap/progress check keep working unchanged.
   */
  private addEntity(
    type: EntityType, dist: number, lateral: number, obj: THREE.Object3D,
    extraY = 0, power = 1, road = -1,
  ) {
    const onBranch = road >= 0 && road < this.branches.length;
    const br = onBranch ? this.branches[road].path : null;
    // `dist` is a branch arc-length when on a branch, main distance otherwise.
    const d = br
      ? this.track.wrap(br.startDist + (dist / br.length) * (br.endDist - br.startDist))
      : this.track.wrap(dist);
    const at = (o: number) => br
      ? br.pointAt(clamp(dist + o, 0, br.length), lateral * ROAD_HALF_WIDTH)
      : this.track.pointAt(this.track.wrap(d + o), lateral * ROAD_HALF_WIDTH);
    const p = at(0);
    obj.position.set(p.x, p.y + extraY, p.z);
    const tan = br ? br.tangentAt(clamp(dist, 0, br.length)) : this.track.tangentAt(d);
    obj.rotation.order = "YXZ";
    obj.rotation.y = Math.atan2(tan.x, tan.z);
    // ramps/rocks/pads sit on the road, so pitch them to match its slope on hills
    if (type === "ramp" || type === "rock" || type === "boostpad" || type === "boostgate") {
      const a = at(-2), b = at(2);
      const horiz = Math.hypot(b.x - a.x, b.z - a.z) || 4;
      obj.rotation.x = -Math.atan2(b.y - a.y, horiz);
    }
    this.scene.add(obj);
    const entity: Entity = {
      type, dist: d, lateral, collectedLap: 0, obj,
      baseY: obj.position.y, phase: Math.random() * Math.PI * 2, home: lateral, power,
      road: onBranch ? road : -1,
    };
    this.entities.push(entity);
    if (type === "monster") {
      // monsters move, so they collide via their own pass, not the buckets
      this.monsters.push(entity);
    } else {
      const key = Math.floor(d / BUCKET_METERS);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(entity);
      else this.buckets.set(key, [entity]);
    }
    if (type === "gem" || type === "airGem" || type === "orb" || type === "nitro" || type === "itembox") {
      this.spinners.push(entity);
    }
  }

  /** Sit an oriented object on the road centreline at `dist`, yawed to the
   *  track tangent and pitched to its slope (like ramps). */
  private placeOnTrack(obj: THREE.Object3D, dist: number, extraYaw = 0) {
    const d = this.track.wrap(dist);
    const p = this.track.pointAt(d, 0);
    obj.position.set(p.x, p.y + 0.05, p.z);
    const tan = this.track.tangentAt(d);
    obj.rotation.order = "YXZ";
    obj.rotation.y = Math.atan2(tan.x, tan.z) + extraYaw;
    const a = this.track.pointAt(d - 2);
    const b = this.track.pointAt(d + 2);
    const horiz = Math.hypot(b.x - a.x, b.z - a.z) || 4;
    obj.rotation.x = -Math.atan2(b.y - a.y, horiz);
  }

  /** Build tunnel runs (entry/exit portals + a colonnade of arches) that hug
   *  the track curve, from the per-realm REALM_TUNNELS config. */

  /** A genuine stone CAVE, not a road tunnel.
   *
   *  The previous "cave" was the engineered tunnel geometry: a repeated, perfectly
   *  uniform ribbed arch. That reads as poured concrete infrastructure no matter
   *  what texture you hang on it. A cave is the opposite of uniform — it's a bored
   *  irregular tube through rock, so this generates ONE continuous mesh that
   *  follows the road centreline, with the cross-section radius perturbed by
   *  layered sine noise per-ring AND per-angle so no two metres of wall match.
   *  Stalactites hang from the ceiling; the whole thing is one merged geometry,
   *  so a 90 m cave is 1-2 draw calls instead of ~35 arches. */
  private buildCaveTube(d0: number, d1: number): THREE.Mesh[] {
    const STEP = 2.2, M = 13;          // rings along the cave, points around the arch
    const HALF = ROAD_HALF_WIDTH + 4.2, H = 8.2;
    const rings: THREE.Vector3[][] = [];
    const noise = (a: number, b: number) =>
      Math.sin(a * 1.7 + b * 0.9) * 0.5 + Math.sin(a * 3.1 - b * 2.3) * 0.28 + Math.sin(b * 5.7) * 0.16;
    const tmpC = new THREE.Vector3();
    for (let d = d0; d <= d1; d += STEP) {
      const c = this.track.pointAt(this.track.wrap(d), 0, tmpC.clone(), true);
      const tan = this.track.tangentAt(this.track.wrap(d));
      const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i < M; i++) {
        const a = (i / (M - 1)) * Math.PI;            // right side -> over the top -> left
        const wob = 1 + noise(d * 0.22, a * 2.4) * 0.17;
        // the walls flare out near the floor like a real bored passage
        const flare = 1 + Math.pow(Math.cos(a), 2) * 0.12;
        const x = Math.cos(a) * HALF * wob * flare;
        const y = Math.sin(a) * H * wob;
        ring.push(new THREE.Vector3(c.x + right.x * x, c.y + y, c.z + right.z * x));
      }
      rings.push(ring);
    }
    const pos: number[] = [];
    for (let r = 0; r < rings.length - 1; r++) {
      for (let i = 0; i < M - 1; i++) {
        const A = rings[r][i], B = rings[r][i + 1], C = rings[r + 1][i + 1], D = rings[r + 1][i];
        // wound so the faces point INWARD — you're inside the rock looking out
        pos.push(A.x, A.y, A.z, C.x, C.y, C.z, B.x, B.y, B.z);
        pos.push(A.x, A.y, A.z, D.x, D.y, D.z, C.x, C.y, C.z);
      }
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    shell.computeVertexNormals();

    // stalactites: cones hung from the ceiling, merged into one geometry
    const spikes: THREE.BufferGeometry[] = [];
    let seed = 1337;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let r = 2; r < rings.length - 2; r++) {
      if (rnd() > 0.55) continue;
      const i = 4 + Math.floor(rnd() * 5);            // roughly the ceiling band
      const p = rings[r][i];
      const len = 0.8 + rnd() * 2.4;
      const g = new THREE.ConeGeometry(0.18 + rnd() * 0.26, len, 5);
      g.translate(0, -len / 2, 0);                    // hang downward from the roof
      g.rotateX(Math.PI);
      g.translate(p.x, p.y - 0.1, p.z);
      spikes.push(g.toNonIndexed());
    }
    const lib = pbr();
    const rockMat = new THREE.MeshStandardMaterial({
      ...(lib ? { map: lib.rock.diff, normalMap: lib.rock.nor, roughnessMap: lib.rock.arm ?? undefined } : {}),
      color: 0x8f8c86, roughness: 1, metalness: 0, flatShading: true, side: THREE.DoubleSide,
    });
    const out = [new THREE.Mesh(shell, rockMat)];
    if (spikes.length) {
      const merged = mergeGeometries(spikes, false);
      if (merged) out.push(new THREE.Mesh(merged, rockMat));
    }
    for (const m of out) { m.castShadow = true; m.receiveShadow = true; }
    return out;
  }

  private placeTunnels() {
    const pal = this.realm.palette;
    const len = this.track.length;
    const rand = mulberry32(5521);
    for (const t of REALM_TUNNELS[this.realm.id] ?? []) {
      const d0 = t.at * len;
      const d1 = d0 + t.len;
      // The forest's are natural CAVES, not engineered road tunnels: no crown
      // strip lighting, no marker beacons. It should go dark as you enter, the
      // way a cave actually does.
      const lit = this.realm.id !== "forest";
      const entry = makeTunnelPortal(pal, lit);
      this.placeOnTrack(entry, d0);
      this.scene.add(entry);
      const exit = makeTunnelPortal(pal, lit);
      this.placeOnTrack(exit, d1, Math.PI); // flip so its face points back out
      this.scene.add(exit);
      if (lit) {
        for (let d = d0 + 3; d < d1 - 3; d += 2.6) {
          const arch = makeTunnelArch(pal, lit);
          this.placeOnTrack(arch, d);
          this.scene.add(arch);
        }
      } else {
        // natural cave: one irregular bored tube, not a row of identical arches
        for (const m of this.buildCaveTube(d0 + 1, d1 - 1)) this.scene.add(m);
      }
      // Bats, but only in the natural (unlit) caves — a colony roosting in a
      // lit road tunnel would read as a bug. Their flight volume floors at
      // 1.1 m, deliberately above windscreen height, so they're atmosphere
      // rather than something that appears to fly into you.
      if (!lit) {
        for (const bd of [d0 + t.len * 0.34, d0 + t.len * 0.72]) {
          const bats = makeBatFlock(rand, 12);
          this.placeOnTrack(bats, this.track.wrap(bd));
          bats.position.y += 2.2;
          this.scene.add(bats);
          this.batFlocks.push(bats);
        }
      }
    }
  }

  /** River crossings: a railed bridge over water, with a mega jump ramp just
   *  before it and an air-gem arc across the gap. */

  /** An arched viaduct GENERATED ALONG THE ROAD.
   *
   *  The imported makeStoneBridge is one rigid straight deck, which is why it cut
   *  diagonally across the tarmac here: this circuit both curves AND climbs
   *  through the river crossing, so a straight slab simply cannot follow it. This
   *  builds the deck from the track centreline itself — same technique as the cave
   *  tube — so it tracks every curve and every hill exactly. Piers drop at regular
   *  spans and the soffit between them dips in a semicircle, giving the Roman
   *  arcade read while still being one merged geometry. */
  private buildRoadBridge(d0: number, d1: number): THREE.Mesh[] {
    const STEP = 2.0;
    const W = ROAD_HALF_WIDTH + 2.4;      // deck half-width (road + shoulders)
    const DECK = 1.1;                      // deck slab thickness
    const SPAN = 17;                       // distance between pier centres
    const ARCH = 5.0;                      // how deep the soffit arcs between piers
    const PIER_DROP = 15;                  // how far piers reach into the gorge
    const deck: number[] = [];
    const rail: number[] = [];
    const piers: THREE.BufferGeometry[] = [];
    const quad = (arr: number[], a: number[], b: number[], c: number[], d: number[]) => {
      arr.push(...a, ...b, ...c, ...a, ...c, ...d);
    };
    let prev: { L: number[]; R: number[]; Lb: number[]; Rb: number[]; rlo: number[]; rhi: number[]; rlo2: number[]; rhi2: number[] } | null = null;
    for (let d = d0; d <= d1; d += STEP) {
      const w = this.track.wrap(d);
      const c = this.track.pointAt(w, 0, undefined, true);
      const tan = this.track.tangentAt(w);
      const rx = tan.z, rz = -tan.x;
      // 0.30 under the ribbon, not 0.06: the road is BANKED and now hilly, so a
      // deck only 6 cm down poked through the tarmac on cambered sections and
      // swallowed the lane markings. The shoulders still read as bridge.
      const top = c.y - 0.30;
      // soffit arcs between piers -> the arcade read
      const phase = ((d - d0) % SPAN) / SPAN;
      const sag = Math.sin(Math.PI * phase) * ARCH;
      const bot = top - DECK - sag;
      const L = [c.x - rx * W, top, c.z - rz * W];
      const R = [c.x + rx * W, top, c.z + rz * W];
      const Lb = [c.x - rx * W, bot, c.z - rz * W];
      const Rb = [c.x + rx * W, bot, c.z + rz * W];
      // low parapet along both edges (kept under 1 m so it never blocks the view)
      const H = 0.92, T = 0.34;
      const rlo = [c.x - rx * W, top, c.z - rz * W];
      const rhi = [c.x - rx * (W - T), top + H, c.z - rz * (W - T)];
      const rlo2 = [c.x + rx * W, top, c.z + rz * W];
      const rhi2 = [c.x + rx * (W - T), top + H, c.z + rz * (W - T)];
      if (prev) {
        quad(deck, prev.L, L, R, prev.R);           // deck top
        quad(deck, prev.Lb, prev.Rb, Rb, Lb);       // arched soffit
        quad(deck, prev.L, prev.Lb, Lb, L);         // outer faces
        quad(deck, prev.R, R, Rb, prev.Rb);
        quad(rail, prev.rlo, prev.rhi, rhi, rlo);   // parapets
        quad(rail, prev.rlo2, rlo2, rhi2, prev.rhi2);
        // NO third quad here. There used to be one spanning prev.rhi -> rhi2,
        // i.e. from the LEFT parapet's inner top across to the RIGHT parapet's
        // inner top — a 16 m x 92 m stone LID roofing the whole carriageway at
        // 0.92 m, which you drove straight through and which read on screen as
        // a huge hard-edged black slab lying over the road. Each parapet is
        // already a closed sloped band (rlo -> rhi) and the material is
        // DoubleSide, so nothing is left open by dropping it.
      }
      prev = { L, R, Lb, Rb, rlo, rhi, rlo2, rhi2 };
      // a pier at each span crossing
      if (Math.abs(phase) < STEP / SPAN) {
        const pw = 1.9;
        const g = new THREE.BoxGeometry(pw * 2, PIER_DROP, pw * 1.3);
        g.translate(c.x, top - DECK - PIER_DROP / 2, c.z);
        piers.push(g.toNonIndexed());
      }
    }
    const lib = pbr();
    const stone = new THREE.MeshStandardMaterial({
      ...(lib ? { map: lib.rock.diff, normalMap: lib.rock.nor, roughnessMap: lib.rock.arm ?? undefined } : {}),
      color: 0x9d9a92, roughness: 1, metalness: 0, flatShading: true, side: THREE.DoubleSide,
    });
    const mk = (arr: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      return new THREE.Mesh(g, stone);
    };
    const out = [mk(deck), mk(rail)];
    if (piers.length) {
      const merged = mergeGeometries(piers, false);
      if (merged) out.push(new THREE.Mesh(merged, stone));
    }
    for (const m of out) { m.castShadow = true; m.receiveShadow = true; }
    return out;
  }

  private placeRivers() {
    const pal = this.realm.palette;
    const len = this.track.length;
    const rand = mulberry32(9173);
    for (const at of REALM_RIVERS[this.realm.id] ?? []) {
      const d = at * len;
      // A classical arched viaduct now carries the road over the gorge instead of
      // the old flat plank bridge. Its deck sits 4 cm proud of nothing — recessed
      // to y = -0.04 — so the road ribbon at y = 0 always wins the depth test.
      // NO rigid viaduct here. makeStoneBridge is one straight 88 m slab, but the
      // road both curves AND (since hills went in) climbs through this stretch —
      // so the deck cut diagonally across the tarmac instead of carrying it. It
      // needs a straight, flat span to sit on, which this circuit doesn't have at
      // the river. Left out rather than shipped broken; the crossing keeps the
      // original railed bridge that actually follows the road.
      for (const m of this.buildRoadBridge(d - 46, d + 46)) this.scene.add(m);

      // ...and a monumental fall pouring in beside it — but ONLY where the
      // realm asked for one. This prop is a 74 m x 42 m CLIFF with water on it,
      // authored for the forest gorge, and REALM_RIVERS was handing it to every
      // realm with a river. On a Big Sur headland and a snow pass it arrives as
      // the same enormous brown blocky mass with the same white streaks down it,
      // in the same place, twice — which is the thing that reads as every new
      // map being the same map. A river crossing does not imply a monument.
      if (!this.realm.grandFall) continue;
      // Multnomah composition: the fall should tower right beside the road with
      // the crossing passing in FRONT of it, not sit 64 m back as distant set
      // dressing. Its cliff is ~74 m wide, so it's offset enough to clear the
      // tarmac but close enough to fill the windscreen as you cross.
      const side = rand() < 0.5 ? 1 : -1;
      const jd = this.track.wrap(d + 8);
      const off = side * (ROAD_HALF_WIDTH + 46);
      const p = this.track.pointAt(jd, off);
      const p0 = this.track.pointAt(jd, 0);     // the road point it must face
      const wf = makeGrandWaterfall(rand, pal);
      wf.userData.kind = "grandfall";
      wf.position.set(p.x, this.terrainYAt(jd, off) - 4, p.z);
      // Aim the fall's FRONT at the road, derived from the actual geometry rather
      // than from a shared faceRoad() convention — going via that helper got the
      // facing wrong twice (you saw the bare back of the cliff both times).
      // makeGrandWaterfall faces -Z. After a yaw of t, its -Z axis points along
      // (-sin t, -cos t). Setting that equal to the unit vector from the fall to
      // the road gives t = atan2(-dx, -dz) directly. No convention to misread.
      const dxr = p0.x - wf.position.x, dzr = p0.z - wf.position.z;
      wf.rotation.y = Math.atan2(-dxr, -dzr);
      this.scene.add(wf);
      this.grandFalls.push(wf);

      // A curtain of water falling ACROSS the road, so you drive through it.
      //
      // Two earlier attempts failed for instructive reasons. Scaling down
      // makeGrandWaterfall dragged its 60 m cliff onto the carriageway. Then
      // untextured planes with an unlit white material composited into a solid
      // white billboard — a flat rectangle cannot read as water no matter how
      // transparent it is, because the eye needs STREAKS and needs the edges to
      // dissolve rather than end in a straight line. So the alpha does the work:
      // vertical streaks of varying brightness, faded out at both sides and top
      // so there is no rectangular border, scrolling downward.
      const od = this.track.wrap(d - 34);
      const op = this.track.pointAt(od, 0);
      const otan = this.track.tangentAt(od);
      const cv = document.createElement("canvas");
      cv.width = 128; cv.height = 256;
      const cx2 = cv.getContext("2d")!;
      const img = cx2.createImageData(cv.width, cv.height);
      let cseed = 24601;
      const crnd = () => { cseed = (cseed * 16807) % 2147483647; return cseed / 2147483647; };
      const cols: number[] = [];
      for (let i = 0; i < cv.width; i++) cols.push(0.25 + crnd() * 0.75);
      for (let y = 0; y < cv.height; y++) {
        for (let x = 0; x < cv.width; x++) {
          const u = x / (cv.width - 1), v = y / (cv.height - 1);
          // streak brightness, with fine vertical grain so it isn't banded
          const streak = cols[x] * (0.65 + 0.35 * Math.sin(v * 40 + cols[x] * 25));
          // dissolve the left/right edges and the very top: no hard rectangle
          const edge = Math.sin(Math.PI * u);
          const top = Math.min(1, v * 3.2);
          const a = Math.max(0, streak * Math.pow(edge, 1.6) * top) * 205;
          const o = (y * cv.width + x) * 4;
          img.data[o] = 232; img.data[o + 1] = 245; img.data[o + 2] = 255;
          img.data[o + 3] = a;
        }
      }
      cx2.putImageData(img, 0, 0);
      const curtain = new THREE.Group();
      const CW = ROAD_HALF_WIDTH * 2.25, CH = 6.5;
      for (let k = 0; k < 2; k++) {
        const tex = new THREE.CanvasTexture(cv);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2 + k, 1);
        const mat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: 0.5 - k * 0.16,
          depthWrite: false, side: THREE.DoubleSide,
        });
        const sheet = new THREE.Mesh(new THREE.PlaneGeometry(CW, CH, 1, 1), mat);
        sheet.position.set(0, CH / 2 - 0.4, (k - 0.5) * 0.8);
        sheet.userData.noShadow = true;
        sheet.userData.scroll = 1.6 + k * 0.7;   // fall speed
        curtain.add(sheet);
      }
      curtain.position.set(op.x, op.y, op.z);
      curtain.rotation.y = Math.atan2(otan.x, otan.z);   // lie across the road
      this.scene.add(curtain);
      this.waterCurtains.push(curtain);
    }
  }

  /**
   * Build the fork routes from REALM_SPLITS: a SEPARATE alternate road that
   * peels off the main track, bows to one side, and rejoins later. A big fork
   * sign marks the mouth; steering toward the branch side takes it, and
   * `freeDrive` then walls you onto whichever road you are nearest.
   *
   * WHICH SIDE IS THE POINT. The old version picked the side from a character
   * code, which on a straight makes the branch a lens — and a lens is always
   * LONGER than its chord. Measured: a 130 m fork span produced a 152 m branch,
   * 22 m and half a second of pure penalty for nothing, and the geometry cannot
   * be tightened out of it because the two roads need 13.2 m between their
   * centrelines just not to overlap.
   *
   * So the bow goes to the INSIDE of a bend, where it is a chord rather than a
   * lens — a genuine shortcut you pay for with a tighter radius. `outsideSign`
   * measures which side that is (see there for why it is measured rather than
   * derived from the sign of the curvature), and the fork slides along the lap
   * to find a bend worth cutting.
   */
  private placeBranches() {
    const pal = this.realm.palette;
    const len = this.track.length;
    // the branch uses the SAME textured, double-sided asphalt as the main road,
    // so it reads as a real road (a flat single-sided material rendered as a
    // "ghost" surface — grass showing through with only the lines drawn)
    const roadMat = new THREE.MeshStandardMaterial({
      map: makeRoadTexture(pal), roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
    });
    // samplers give the branch the main road's flat centre + tangent at any dist
    const sampleP = (dist: number, out?: THREE.Vector3) => this.track.pointAt(this.track.wrap(dist), 0, out, true);
    const sampleT = (dist: number, out?: THREE.Vector3) => this.track.tangentAt(this.track.wrap(dist), out);
    const forks = REALM_SPLITS[this.realm.id] ?? [];
    for (let fi = 0; fi < forks.length; fi++) {
      const s = forks[fi];
      // Slide the configured position along the lap until the span actually
      // bends. A fork on a straight can only ever be the slower road.
      const bendAt = (at: number) => {
        let sum = 0;
        for (let o = 0; o <= s.len; o += 10) sum += Math.abs(this.track.curvatureAt(this.track.wrap(at + o)));
        return sum / (s.len / 10 + 1);
      };
      // …but NOT into a cave. The fork positions in REALM_SPLITS are hand-placed
      // clear of each realm's tunnels and river crossings, and then this search
      // used to move them up to 600 m downstream without checking what it was
      // moving them into. On Enchanted Forest the fork is authored at 244 m to
      // miss the cave at 756-838; the bend search slid it to 819 and put the
      // mouth 19 m INSIDE the cave, which is why the alternate route could only
      // be reached by scraping through rock. Reject any candidate whose span
      // touches a tunnel or a river, with a margin so the junction is not right
      // on a portal either.
      const MARGIN = 45;
      const blocked: { d0: number; d1: number }[] = [
        ...(REALM_TUNNELS[this.realm.id] ?? []).map((t) => ({ d0: t.at * len, d1: t.at * len + t.len })),
        ...(REALM_RIVERS[this.realm.id] ?? []).map((f) => ({ d0: f * len - 40, d1: f * len + 40 })),
      ];
      const clear = (at: number) => {
        const a0 = at - MARGIN, a1 = at + s.len + MARGIN;
        // compare on the unwrapped lap, testing the span shifted by ±one lap
        // so a fork that straddles the start line is still caught
        return blocked.every((b) =>
          [-len, 0, len].every((sh) => a0 >= b.d1 + sh || a1 <= b.d0 + sh));
      };
      let startDist = s.at * len;
      let best = clear(startDist) ? bendAt(startDist) : -1;
      for (let k = 1; k <= 24; k++) {
        const cand = s.at * len + k * 25;
        if (!clear(cand)) continue;
        const score = bendAt(cand);
        if (score > best) { best = score; startDist = cand; }
      }
      const endDist = startDist + s.len;
      this.splits.push({ d0: this.track.wrap(startDist), d1: this.track.wrap(endDist) });
      // OUTSIDE of the bend, which is now the FASTER way round. Corner speed
      // is √(grip · radius) since the friction circle went in, so the wide line
      // is worth more than the metres it costs — the opposite of what was true
      // before, when corners were free and only distance mattered. `outsideSign`
      // measures which side that is rather than deriving it from the sign of the
      // curvature, because this codebase has been bitten by that convention.
      const side: 1 | -1 = this.outsideSign(startDist, endDist) > 0 ? 1 : -1;
      // Just enough separation that the two ribbons never touch: each is
      // drivable to 6.6 m from its own centreline, so 13.2 m is the floor and
      // 16 leaves a 2.8 m median. Wider costs branch length quadratically.
      const bulge = 16;
      const branch = new BranchPath(sampleP, sampleT, startDist, endDist, { side, bulge, rise: 0, seed: 100 + fi });
      // Same ribbon half-width as the main road (which is ROAD_HALF_WIDTH *
      // 1.25, not ROAD_HALF_WIDTH). Built at 5 m the branch was visibly
      // NARROWER than the road it forks off, while the containment walls — which
      // are absolute, at 5.6 m soft and 6.6 m hard — sat outside its edge. So
      // the fork could be driven a metre and a half past its own tarmac, and
      // measured, the car spent 47% of the branch flagged off-road, grinding
      // the wall out over nothing.
      this.scene.add(branch.buildRoad(roadMat, ROAD_HALF_WIDTH * 1.25));
      this.branches.push({ path: branch, side });
      // …and put it on the minimap. A second road you cannot see on the map is
      // a second road you do not know is there.
      {
        const pts = [];
        const steps = Math.max(8, Math.round(branch.length / 6));
        for (let i = 0; i <= steps; i++) {
          const q = branch.pointAt((i / steps) * branch.length, 0);
          pts.push({ x: q.x, z: q.z });
        }
        this.branchRoutes.push(pts);
      }
      // the divider sitting in the median between the main road and the branch
      this.placeSplitIsland((startDist + endDist) / 2, side, branch);
      this.placeRouteFeatures(this.branches.length - 1);
      // Fork sign on the VERGE, 34 m before the mouth, on the side the branch
      // goes. It was placed on the centreline at the mouth — and it is built as
      // a gantry with two narrow central posts (|x| < 1.05), so those posts
      // stood in the middle of the racing line. They are not registered as
      // solid, so you drove straight through a steel sign at 115 mph. Moving it
      // upstream also makes it do its job: a direction sign you reach at the
      // same instant as the junction is not a direction sign.
      const sign = makeForkArrowSign(pal);
      const signD = this.track.wrap(startDist - 34);
      const sp = this.track.pointAt(signD, side * (ROAD_HALF_WIDTH * 1.25 + 2.2));
      const stan = this.track.tangentAt(signD);
      sign.position.set(sp.x, this.terrainYAt(signD, side * (ROAD_HALF_WIDTH * 1.25 + 2.2)), sp.z);
      sign.rotation.order = "YXZ";
      sign.rotation.y = Math.atan2(stan.x, stan.z);
      this.scene.add(sign);
    }
  }

  /**
   * What makes an alternate route worth taking: a boost chain into a ramp.
   *
   * The route's whole problem was that it had nothing on it. It could not — an
   * entity's lateral is metres from a centreline, and "which centreline" was
   * not a question the data could answer, so every pickup, pad and ramp in the
   * game belonged to the main road by construction. `Entity.road` fixes that,
   * and this is the first thing to use it.
   *
   * The ramp is the point. Cornering load is yaw rate × speed, and in the air
   * both are irrelevant — so a jump carries speed through a bend that would
   * otherwise scrub half of it away. That is why an Asphalt route feels fast
   * and a merely-wider one does not, and it is only true here because the
   * friction circle made corners cost something in the first place.
   *
   * Everything is placed along the branch's OWN arc length, on its own
   * centreline, and only collides while you are on it.
   */
  private placeRouteFeatures(road: number) {
    if (this.cfg.endless || road < 0 || road >= this.branches.length) return;
    const b = this.branches[road].path;
    const L = b.length;
    // The plateau: the stretch where the branch runs parallel to the main road,
    // clear of the peel-off and the merge. Everything goes here, because the
    // ends are where the branch is busy changing direction.
    const from = L * 0.28, to = L * 0.86;
    if (to - from < 45) return;             // too short to be worth furnishing

    // Three pads, centre lane, leading INTO the ramp — this is the run-up, so
    // they are on the line you want rather than off it. The last one sits ~18 m
    // short of the take-off, close enough that the surge is still burning.
    const rampAt = from + (to - from) * 0.62;
    for (let i = 0; i < 3; i++) {
      this.addEntity("boostpad", rampAt - 52 + i * 13, 0, makeBoostPad(3.2), 0, 1, road);
    }

    // The ramp. `mega` because this is the one place on the circuit where a big
    // launch is the intended line rather than a hazard to avoid.
    const kind: RampKind = "mega";
    this.addEntity("ramp", rampAt, 0, makeRamp(kind, this.realm.style === "void"), 0, RAMP_SPECS[kind].power, road);
    this.ramps.push({
      road,
      // `ramps` is matched against `this.position`, which on a branch is the
      // MAIN-track distance the branch maps to — so this has to be mapped the
      // same way addEntity maps it, not stored as an arc length.
      dist: this.track.wrap(b.startDist + (rampAt / L) * (b.endDist - b.startDist)),
      power: RAMP_SPECS[kind].power,
      lane: 0,
      len: RAMP_SPECS[kind].l * 2,
      height: RAMP_SPECS[kind].h,
      twist: false,
    });

    // A run of chips down the back half, so the route pays even if you miss the
    // ramp — and so it reads as a road that goes somewhere.
    for (let i = 0; i < 6; i++) {
      this.addEntity("gem", rampAt + 26 + i * 4, 0, makeGem(this.realm.palette.gem, false), 0.8, 1, road);
    }
  }

  /**
   * The divider in the median of a fork — a themed mound topped by a glowing
   * beacon, so the split reads as two roads around something rather than a road
   * that inexplicably doubles.
   *
   * SIZED FROM THE GAP THAT IS ACTUALLY THERE, by measuring where the branch's
   * inner edge falls. Derived from `bulge` it was a 6.6 m cone in a 4.6 m
   * median: it overlapped the main road at 5.5 m (drivable to 6.6) and the
   * branch at 12.1 m (inner edge 11.2), so both roads had a hill in them. That
   * is a good part of what "the separate curve felt bad" was.
   */
  private placeSplitIsland(midDist: number, side: number, branch: BranchPath) {
    const pal = this.realm.palette;
    // Where the branch centreline sits, in main-road metres, at the apex.
    const apex = branch.pointAt(branch.length / 2, 0);
    const gapOuter = Math.abs(this.track.project(apex.x, apex.z).lateral) - (ROAD_HALF_WIDTH + 1.6);
    const gapInner = ROAD_HALF_WIDTH + 1.6;
    const r = Math.max(0.8, (gapOuter - gapInner) / 2 - 0.5);
    const centreOff = (gapInner + gapOuter) / 2;
    const island = new THREE.Group();
    const mound = new THREE.Mesh(
      new THREE.ConeGeometry(r, r * 0.55, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.groundBase), flatShading: true, roughness: 1 }),
    );
    mound.position.y = r * 0.275; // base sits on the ground
    mound.rotation.y = Math.random() * Math.PI;
    island.add(mound);
    const col = new THREE.Color(pal.gem);
    const beacon = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.3, r * 1.5, 5),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, flatShading: true }),
    );
    beacon.position.y = r * 0.55 + r * 0.75; // perched on top of the mound
    island.add(beacon);
    // median centre: halfway between the two roads' drivable edges
    const p = this.track.pointAt(this.track.wrap(midDist), side * centreOff, undefined, true);
    island.position.set(p.x, p.y, p.z);
    this.scene.add(island);
  }

  /**
   * True while the car is on the MAIN circuit rather than an alternate route.
   *
   * This is the guard the fork could not work without, and the reason it was
   * torn out rather than fixed. Everything in the game reads
   * `freeDrive.lateral` as "metres from the main centreline" — entity hits, the
   * ramp ride-up, the drift zones, the crossing, near misses, car-to-car
   * contact, the lane bonus, the slipstream. But `freeDrive` reports the
   * lateral of whichever road it has you on, so out on a branch bowing 17 m
   * away it reports ZERO, and every one of those systems silently believes you
   * are on the racing line.
   *
   * Measured before this guard: parked on the branch centreline at the apex,
   * `freeDrive.lateral` was 0.00 while `track.project` put the car 17.23 m off
   * the main road — with thirteen entities in the fork span all sitting at a
   * lateral the collision test would have matched. Taking the fork would have
   * vacuumed up every chip on the road you did not drive.
   *
   * The branch is a different road. What is on the main road is not there.
   */
  private get onMainRoad(): boolean {
    return this.freeDrive.onBranchIdx < 0;
  }

  /**
   * Height of the road the car is ACTUALLY ON, at a given lateral offset.
   *
   * This one function is why the fork used to sink the car. `freeDrive` picks
   * whichever road is nearer and keeps you on it, and reports `lateral`
   * relative to THAT road — but the height was read from
   * `track.pointAt(position, lateral)`, the main road, every time. Out on a
   * branch bowing 24 m away, the main road at the mapped distance is a
   * different piece of geometry at a different height, so the car rode at the
   * main road's elevation while its wheels were over the branch. Where the
   * branch was lower you floated; where it was higher you were buried.
   *
   * @param lateralM lateral offset in metres on the current road.
   */
  private surfaceY(lateralM: number): number {
    const bi = this.freeDrive.onBranchIdx;
    if (bi >= 0 && bi < this.branches.length) {
      const b = this.branches[bi].path;
      const u = b.project(this.freeDrive.x, this.freeDrive.z).u;
      return b.pointAt(u, lateralM, this.tmpSurface).y;
    }
    return this.track.pointAt(this.position, lateralM, this.tmpSurface, false).y;
  }

  /** True when (x,z) is on or close to an alternate route — used to keep the
   *  scenery bands, which are laid out from the MAIN centreline, from planting
   *  a forest across the middle of the branch road. */
  private nearBranch(x: number, z: number, clearance: number): boolean {
    for (const br of this.branches) {
      const p = br.path.project(x, z);
      // project() is an open path: a point beyond either end clamps to it, so a
      // near-zero lateral there is not really "on the branch". Guard with u.
      if (p.u <= 0.5 || p.u >= br.path.length - 0.5) continue;
      if (Math.abs(p.lateral) < clearance) return true;
    }
    return false;
  }

  /** Enter a branch if we're at its fork mouth and leaning toward its side. */
  private maybeEnterBranch() {
    if (this.alt > 0.6 || this.transformed) return;
    for (const br of this.branches) {
      const b = br.path;
      if (this.position >= b.startDist && this.position < b.startDist + 6 &&
          Math.sign(this.playerX) === br.side && Math.abs(this.playerX) > 0.28) {
        this.onBranch = b;
        this.branchU = 0;
        this.sound.play("nitro");
        this.toast("ALT ROUTE!", "#67e8f9");
        return;
      }
    }
  }

  /** World point on the CURRENT path (branch or main), `offset` metres ahead of
   *  the player, at lateral `lateralM` metres. */
  private pathPoint(offset: number, lateralM: number, out?: THREE.Vector3): THREE.Vector3 {
    if (this.onBranch) {
      const u = clamp(this.branchU + offset, 0, this.onBranch.length);
      return this.onBranch.pointAt(u, lateralM, out);
    }
    return this.track.pointAt(this.track.wrap(this.position + offset), lateralM, out);
  }

  /** Unit tangent on the current path `offset` metres ahead of the player. */
  private pathTangent(offset: number, out?: THREE.Vector3): THREE.Vector3 {
    if (this.onBranch) {
      const u = clamp(this.branchU + offset, 0, this.onBranch.length);
      return this.onBranch.tangentAt(u, out);
    }
    return this.track.tangentAt(this.track.wrap(this.position + offset), out);
  }

  /** true while `dist` falls inside a fork zone (used by the central soft barrier
   *  and by opponents to pick a side instead of ploughing the island). */
  private inSplitZone(dist: number): boolean {
    const d = this.track.wrap(dist);
    for (const s of this.splits) if (d >= s.d0 && d <= s.d1) return true;
    return false;
  }

  /** A blimp or two drifting high over the track — the only bit of the old
   *  "signage everywhere" that stays (the scattered corner boards were removed). */
  private placeSkyProps() {
    const len = this.track.length;
    const pal = this.realm.palette;
    for (const at of [0.3, 0.72]) {
      const blimp = makeBlimp(pal);
      const p = this.track.pointAt(this.track.wrap(at * len), 0, undefined, true);
      blimp.position.set(p.x + 34, p.y + 60, p.z + 22);
      blimp.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(blimp);
    }
  }

  /** A terrain grid that FOLLOWS the track's height near the road (so the road
   *  sits grounded in rolling hills instead of floating on a flat plane), easing
   *  back to the base level away from the track. Reuses the flat ground material. */
  /** Cache the track polyline (x,z + centreline height) for ground-height queries. */
  private ensureTerrSamples() {
    if (this.terrSamp) return this.terrSamp;
    const T = this.track, N = 400;
    const sx = new Float64Array(N), sz = new Float64Array(N), sy = new Float64Array(N);
    const sag = new Float64Array(N);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < N; i++) { T.pointAt((i / N) * T.length, 0, tmp, true); sx[i] = tmp.x; sz[i] = tmp.z; sy[i] = tmp.y; }

    // HOW FAR THE TERRAIN CAN CHORD ABOVE THE ROAD.
    //
    // The ground is a 12 m grid sampling this same height field, so between two
    // grid points it draws a straight line while the road keeps curving. Where
    // the road is in a dip, that chord passes OVER it — measured at 0.905 m on
    // this circuit against a flat 0.12 m clearance, which is the terrain slab
    // that cuts the carriageway in half.
    //
    // A constant big enough for the worst dip would dish the verge everywhere,
    // so the clearance is per-sample: the local sag of the road over a 12 m
    // span, which is zero on the straights and only opens up in the dips.
    const step = T.length / N;
    const half = Math.max(1, Math.round(6 / step));   // ±6 m ≈ half a grid cell
    for (let i = 0; i < N; i++) {
      const a = sy[(i - half + N) % N], b = sy[(i + half) % N];
      sag[i] = Math.max(0, (a + b) / 2 - sy[i]);
    }
    // spread each sample's requirement to its neighbours, so the dish eases in
    // and out along the road instead of stepping
    const smooth = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let k = -half; k <= half; k++) m = Math.max(m, sag[(i + k + N) % N]);
      smooth[i] = m;
    }
    return (this.terrSamp = { sx, sz, sy, sag: smooth });
  }

  /** Landscape height field (range ~[-1.5, 1.6]). Broad rolling hills PLUS a
   *  ridged octave that gives sharp crests and broad valleys — reads as ridges
   *  and cliffs rather than gentle swells. Deterministic in world space so the
   *  terrain mesh, scenery and grass all agree. */
  private terrainRelief(x: number, z: number): number {
    const rolling =
      Math.sin(x * 0.0060 + 1.3) * Math.cos(z * 0.0052 - 0.7) * 0.7 +
      Math.sin(x * 0.0121 - 0.4) * Math.cos(z * 0.0099 + 2.1) * 0.35;
    // ridged: |sum of sines| inverted → crests pinch to sharp ridgelines
    const ridge = 1 - Math.abs(Math.sin(x * 0.0072 + 0.4) + Math.sin(z * 0.0068 - 1.2)) * 0.5;
    return rolling + (ridge - 0.45) * 0.95 + Math.sin((x - z) * 0.02 + 0.5) * 0.12;
  }

  /** THE ground height at any world (x,z): the road's own elevation right by the
   *  ribbon, easing over `fall` metres into per-realm rolling hills further out. */
  private groundHeightAtXZ(x: number, z: number): number {
    const { sx, sz, sy, sag } = this.ensureTerrSamples();
    const n = sx.length;
    let best = 1e18, bi = 0;
    for (let i = 0; i < n; i++) { const dx = x - sx[i], dz = z - sz[i]; const d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
    // Interpolate the road height ALONG the centreline rather than snapping to the
    // nearest sample. Snapping produced a staircase whose steps stood up to ~0.2 m
    // ABOVE the real (smooth) road surface between samples — that is the terrain
    // poking through the ribbon that reads as "dirt instead of road".
    let by = sy[bi], bd2 = best, bside = 0;
    for (const j of [(bi - 1 + n) % n, (bi + 1) % n]) {
      const ax = sx[bi], az = sz[bi], ux = sx[j] - ax, uz = sz[j] - az;
      const L2 = ux * ux + uz * uz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / L2));
      const px = ax + ux * t, pz = az + uz * t;
      const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
      if (d2 < bd2) {
        bd2 = d2; by = sy[bi] + (sy[j] - sy[bi]) * t;
        // which hand of the road this point falls on. Forward is (ux,uz) from
        // bi toward j, so the cross product's sign is the side — but j can be
        // the PREVIOUS sample, in which case forward is reversed.
        const fwd = j === (bi + 1) % n ? 1 : -1;
        bside = Math.sign((ux * dz - uz * dx) * fwd);
      }
    }
    const dist = Math.sqrt(bd2);
    const near = 34, fall = 108; // narrower flat shelf + steeper onset = more dramatic land
    const t = dist <= near ? 1 : dist >= near + fall ? 0 : 1 - (dist - near) / fall;
    const ts = t * t * (3 - 2 * t);
    const y = by * ts + this.reliefAmp * (1 - ts) * this.terrainRelief(x, z);
    // Hold the ground a few cm BELOW the ribbon across the road corridor so the
    // road always wins the depth test (no z-fighting, no dirt bleeding over the
    // tarmac). Eased out over ~20 m, so it's far too gentle to feel while driving.
    // 0.12 was a z-fighting margin and nothing more. It has to also cover the
    // chord the ground mesh draws over a dip — see ensureTerrSamples.
    const CLEAR = 0.12 + sag[bi] * 1.25;
    // The clearance must be FULL under the ribbon and GONE by the time the
    // verge is walkable, or there is a step at the road edge — and with the
    // adaptive sag that step reached 0.84 m on Peaks, so putting a wheel on
    // the verge dropped the car most of a metre. Full to 7.5 m (the ribbon is
    // 6.25 m half-width), zero by 12.
    const CLEAR_NEAR = 7.5, CLEAR_FAR = 12;
    const fade = clamp((dist - CLEAR_NEAR) / (CLEAR_FAR - CLEAR_NEAR), 0, 1);
    // NO GORGE CARVE HERE. I added one so the bridge would span a valley, and it
    // caused every symptom at once: the bowl is centred ON the road, so the
    // ground beside the ribbon fell away and you dropped into a pit the moment
    // you put a wheel off; the flat plank bridge was suddenly hanging over a void
    // and read as a black floating slab; and the waterfall standing in the bowl
    // lost the ground under it and became "floating ghost water". A gorge needs a
    // proper spanning structure AND protected verges to exist at all — carving
    // terrain alone makes the world strictly worse, so it's gone.
    let h = y - CLEAR * Math.max(0, 1 - fade);
    // COASTLINE. A single ocean plane parked beside the track only shows up for
    // the stretch of lap that happens to face it. For a coast road the water has
    // to be there the whole way round, so coastal realms treat the circuit as an
    // ISLAND: land holds inside `r`, then the ground ramps down past sea level
    // over a beach band. The ocean plane sits under that, so open water is
    // visible off the outside of every corner.
    if (this.coast && (this.coast.side === 0 || this.coast.side === bside)) {
      // Measured from the ROAD, not from the middle of the circuit. An island
      // ring put the shore 876 m away on a loop this size — technically water,
      // but past the fog and invisible from the car. The references are
      // causeways: the sea is right there at the verge on both sides. `dist` is
      // already the distance to the centreline, so this costs nothing.
      //
      // SIDED. A causeway drops away on both hands and that is correct for one.
      // A cliff road does not: the sea is on one side and the hill it was cut
      // into is on the other. Dropping both made Cape Road a 48 m ribbon of
      // land floating in fog with sheer walls either side — a flying road, not
      // a coast road. `side` 0 keeps the old behaviour for the causeway.
      const over = dist - this.coast.r;
      if (over > 0) {
        // Steep and immediate. The previous 55 m ramp meant water only actually
        // appeared ~77 m from the centreline, which from a low camera is a wide
        // brown plain with a distant pink strip — not a causeway. This puts the
        // waterline a few metres past the kerb.
        const t = Math.min(1, over / this.coast.band);
        h -= (t * t) * this.coast.drop;
      }
    }
    return h;
  }

  /**
   * Shore apron for coastal realms: a high-resolution strip that runs from
   * under the road edge, across the sand, and down past the waterline.
   *
   * The world terrain is a 12 m grid — far too coarse to render a shoreline
   * that happens between 13 m and 26 m of the centreline, and coarse enough
   * that it chords straight across the drop. This strip samples the same
   * height field at 3 m along and ~3 m across, so the beach and the water's
   * edge are actually shaped. The coarse mesh chords BELOW the true curve
   * through the drop (it is concave down), so it stays hidden underneath.
   */
  private buildCoastApron(tex: THREE.Texture, beach = true): THREE.Mesh {
    const c = this.coast!;
    const inner = ROAD_HALF_WIDTH * 1.25 - 0.8; // tucks under the road edge
    const lats = [inner, c.r * 0.5, c.r * 0.8, c.r, c.r + 3, c.r + 6, c.r + 10, c.r + 16, c.r + 28];
    const step = 3;
    const count = Math.ceil(this.track.length / step);
    const cols = lats.length;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const p = new THREE.Vector3();
    let base = 0;
    for (const side of [1, -1]) {
      for (let i = 0; i <= count; i++) {
        const d = (i / count) * this.track.length;
        for (let k = 0; k < cols; k++) {
          this.track.pointAt(d, side * lats[k], p, true);
          pos.push(p.x, this.groundHeightAtXZ(p.x, p.z) + 0.02, p.z);
          // A beach texture is a CROSS-SECTION: u spans the strip exactly once so
          // one column of pixels paints sand-to-seabed. A ground texture is a
          // tile and has to repeat, or a single tile stretches 50 m sideways.
          if (beach) uv.push(k / (cols - 1), d / 12);
          else uv.push(lats[k] / 9, d / 9);
        }
      }
      for (let i = 0; i < count; i++) for (let k = 0; k < cols - 1; k++) {
        const a = base + i * cols + k, b = a + cols;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      base += (count + 1) * cols;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, flatShading: true });
    return new THREE.Mesh(geo, m);
  }

  private buildGroundTerrain(mat: THREE.Material): THREE.Mesh {
    // 9 m cells on poster realms: the facets are the look, so they have to be
    // hill-sized. 12 m was tuned for smooth shading, where cell size only
    // affected accuracy.
    const b = this.track.bounds, margin = 470, cell = this.realm.palette.posterSun ? 9 : 12;
    const minX = b.minX - margin, minZ = b.minZ - margin;
    const cols = Math.ceil((b.maxX + margin - minX) / cell) + 1;
    const rows = Math.ceil((b.maxZ + margin - minZ) / cell) + 1;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = minX + c * cell, z = minZ + r * cell;
      pos.push(x, this.groundHeightAtXZ(x, z), z);
      uv.push(x / 220, z / 220);
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, bb = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, bb, bb, d, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }

  /** Ground height under a piece of scenery at track distance + lateral offset. */
  private terrainYAt(dist: number, off: number): number {
    const p = this.track.pointAt(this.track.wrap(dist), off);
    return this.groundHeightAtXZ(p.x, p.z);
  }

  private decorate(library: ModelLibrary) {
    const rand = mulberry32(1337);
    const { track, realm } = this;
    const len = track.length;
    const pal = realm.palette;
    this.placeTunnels();
    this.placeRivers();
    // ALTERNATE ROUTES, on again — and this time with a reason to exist.
    //
    // The first version was deleted because it was never taken, and it deserved
    // that: 8-12 m longer than the road it forks off, on a tighter radius, and
    // structurally unable to hold a single pickup because entities were
    // addressed in main-road coordinates only.
    //
    // Both halves are fixed. `Entity.road` and `ramps[].road` mean a branch can
    // carry pads, chips and ramps of its own. And the friction circle changed
    // what a route can BE: corner speed is now √(grip · radius), so geometry
    // finally has a time value — and a RAMP is worth more than either, because
    // in the air there is no cornering load at all, so a jump carries speed
    // through a bend that would otherwise cost you half of it.
    //
    // So the fork goes where the main line is SLOWEST, bows to the outside for
    // the wider radius, and carries a boost chain into a ramp. See
    // placeRouteFeatures.
    this.placeBranches();
    this.minimap.setRoutes(this.branchRoutes);
    this.freeDrive.branches = this.branches.map((b) => ({
      path: b.path,
      startDist: b.path.startDist,
      endDist: b.path.endDist,
    }));
    this.placeSkyProps();
    this.treeMats = makeTreeMaterials(pal); // shared bark/foliage tree materials
    const lane = () => LANE_CENTERS[Math.floor(rand() * 3)];
    // big monuments/buildings shouldn't hug the verge (they'd overhang the road)
    const LANDMARK_KINDS = new Set<SceneryKind>([
      "pyramid", "tower", "gatehouse", "grandstand", "floodlight", "pitBuilding", "skyscraper",
      "hogwartsCastle", "waterfall", "quidditchHoop",
    ]);
    // scenery you should be able to pass through (water, floating, thin flags) —
    // everything else (trees, rocks, buildings, mushrooms) is a solid obstacle
    const SOFT_SCENERY = new Set<SceneryKind>([
      "waterfall", "floatingCandle", "goldenSnitch", "banner", "torch", "quidditchHoop",
    ]);

    if (realm.style === "void") {
      this.decorateVoid(library, rand);
    } else {
      // ROADSIDE SCENERY — three bands each side for depth, now INSTANCED.
      // Every prop used to be individually built and added to the scene, and
      // since the renderer is draw-call bound that converted almost linearly
      // into frame time (this was the bulk of the ~6,300 remaining meshes).
      // Trees proved the fix; this applies it to the rest of the scenery. Kinds
      // that can't be instanced (sprites, animated parts) fall back to the old
      // per-object path automatically.
      const propBuckets = new Map<string, { variant: { parts: { mat: THREE.Material; geo: THREE.BufferGeometry }[] }; spots: { x: number; y: number; z: number; s: number; r: number }[] }>();
      const addInstanced = (kind: SceneryKind, vi: number, v: { parts: { mat: THREE.Material; geo: THREE.BufferGeometry }[] }, x: number, y: number, z: number, sc: number, yaw: number) => {
        const key = kind + "#" + vi;
        let b = propBuckets.get(key);
        if (!b) { b = { variant: v, spots: [] }; propBuckets.set(key, b); }
        b.spots.push({ x, y, z, s: sc, r: yaw });
      };

      for (let d = 0; d < len; d += 5.3) {
        for (const side of [-1, 1]) {
          // three bands: near (dense, by the road), mid, far (big background fill)
          const bands: { chance: number; base: number; spread: number; scale: [number, number]; solid: number | null }[] = [
            { chance: 0.85, base: 5, spread: 13, scale: [1.0, 0.0], solid: 1.7 },
            { chance: 0.56, base: 20, spread: 36, scale: [1.1, 0.5], solid: 2.2 },
            { chance: 0.34, base: 58, spread: 70, scale: [1.5, 1.1], solid: null },
          ];
          bands.forEach((band, bi) => {
            if (rand() >= band.chance) return;
            const kind = pickScenery(realm, rand);
            const isLandmark = LANDMARK_KINDS.has(kind);
            const sc = band.scale[0] + rand() * band.scale[1];
            const jd = d + rand() * (bi === 2 ? 5 : 4);
            const yaw = rand() * Math.PI * 2;

            const variants = this.getPropVariants(kind, library, rand);
            if (variants) {
              const vi = Math.floor(rand() * variants.length);
              const v = variants[vi];
              const reach = v.reach * sc;
              // big monuments stand well back so they never overhang the track
              const want = bi === 0 && isLandmark ? 34 + rand() * 22 : band.base + rand() * band.spread;
              const off = this.offsetForReach(reach, side * (ROAD_HALF_WIDTH + want));
              const p = track.pointAt(jd, off);
              // the offset clears the road HERE, but a winding circuit can loop
              // back into this spot — drop the prop rather than block the line
              if (!this.roadClear(p.x, p.z, reach, this.marginForReach(reach))) return;
              addInstanced(kind, vi, v, p.x, this.terrainYAt(jd, off), p.z, sc, yaw);
              const nr = band.solid === null ? null : (bi === 0 && isLandmark ? 5 : band.solid);
              if (nr !== null && !SOFT_SCENERY.has(kind) && this.obstacleClear(p.x, p.z, nr)) {
                this.obstacles.push({ x: p.x, z: p.z, r: nr });
              }
              return;
            }

            // fallback: kinds with sprites/animated parts stay individual objects
            const obj = this.sceneryObject(kind, library, rand);
            if (sc !== 1) obj.scale.multiplyScalar(sc);
            const want = bi === 0 && isLandmark ? 34 + rand() * 22 : band.base + rand() * band.spread;
            const off = this.clearOffset(obj, side * (ROAD_HALF_WIDTH + want));
            const p = track.pointAt(jd, off);
            const mt = this.propMetrics(obj);
            if (!this.roadClear(p.x, p.z, mt.reach, mt.margin)) return;
            obj.position.set(p.x, this.terrainYAt(jd, off), p.z);
            this.scene.add(obj);
            const nr = band.solid === null ? null : (bi === 0 && isLandmark ? 5 : band.solid);
            if (nr !== null && !SOFT_SCENERY.has(kind) && this.obstacleClear(p.x, p.z, nr)) {
              this.obstacles.push({ x: p.x, z: p.z, r: nr });
            }
          });
        }
      }
      this.buildPropFields(propBuckets);

      // ground clutter fills the empty flats
      const centerline = track.sampleXZ(240);
      // On a causeway there are only ~6 m of sand either side before the water,
      // so scattering 34k tufts out to 150 m just buries the beach (and drops
      // most of them under the sea). Coastal realms get sparse dune grass on
      // the strip and nothing beyond it.
      const grass = this.coast
        ? this.scatter(centerline, rand, 3600, ROAD_HALF_WIDTH + 2.4, this.coast.r - 1)
        : this.scatter(centerline, rand, 34000, ROAD_HALF_WIDTH * 1.3 + 3, 150);
      this.scene.add(makeGrassField(pal, grass));
      if (!this.coast) {
        const pebbles = this.scatter(centerline, rand, 1100, ROAD_HALF_WIDTH * 1.3 + 4, 170);
        this.scene.add(makeRockField(pal, pebbles));
      }

      // LUSH forest: a thick understory crowding the verge + a dense wall of
      // trees close to the road, so the woods read as overgrown, not a lawn.
      if (realm.id === "forest") {
        // dense ferny understory right up to the tarmac (one instanced draw call)
        // +3.2 not +1.5: tufts have width, so starting 1.5 m off a 5 m half-width
        // road put blades over the tarmac edge — that's the grass-on-the-road.
        const under = this.scatter(centerline, rand, 60000, ROAD_HALF_WIDTH + 3.2, 70);
        for (const u of under) u.s = 0.8 + rand() * 0.9; // a shade taller than the lawn, not a thicket of 4 m blades
        this.scene.add(makeGrassField(pal, under));
        // A DENSE wall of trees, now genuinely dense because it's INSTANCED.
        // Every tree used to be its own Group of meshes, and since the renderer
        // is draw-call bound the count converted almost linearly into frame time
        // (3 rows measured 10,518 meshes / 24.3 ms / 41 fps, so density had to be
        // rationed). makeTreeField draws all placements of a variant in one call
        // per material, so the whole forest is ~36 draw calls regardless of how
        // many thousand trees there are — density is essentially free now, and
        // this runs 4 rows at high fill where 2 sparse rows were the old ceiling.
        const kinds: ("pine" | "round" | "tall")[] = ["round", "round", "pine", "round"];
        const spots: { kind: "pine" | "round" | "tall"; x: number; y: number; z: number; s: number; r: number }[] = [];
        for (let d = 0; d < len; d += 3.4) {
          for (const side of [-1, 1]) {
            for (const row of [0, 1, 2, 3]) {
              if (rand() < [0.95, 0.8, 0.62, 0.45][row]) {
                const kind = kinds[Math.floor(rand() * kinds.length)];
                const off = side * (ROAD_HALF_WIDTH + 4 + row * 11 + rand() * 9);
                const jd = d + rand() * 3;
                const p = track.pointAt(this.track.wrap(jd), off);
                // NOT ON THE FORK. These bands are laid out from the MAIN
                // centreline and reach 40+ m out, while a branch bows 24 m to
                // one side — so rows 2 and 3 planted a forest straight down the
                // middle of the alternate road. This is the other half of why
                // the fork "felt bad": you turned onto it and drove into trees.
                if (this.nearBranch(p.x, p.z, ROAD_HALF_WIDTH + 4)) continue;
                spots.push({
                  kind, x: p.x, y: this.terrainYAt(jd, off), z: p.z,
                  s: 0.95 + rand() * 1.0, r: rand() * Math.PI * 2,
                });
                // only the innermost row is close enough to be a real hazard
                if (row === 0 && this.obstacleClear(p.x, p.z, 1.7)) {
                  this.obstacles.push({ x: p.x, z: p.z, r: 1.7 });
                }
              }
            }
          }
        }
        this.scene.add(makeTreeField(rand, this.treeMats!, spots, 6));
      }

      // hero landmarks: a handful of BIG signature monuments set well back from
      // the road, so each world has a recognisable skyline instead of only the
      // roadside band. (Ground realms only — void gets its asteroid field.)
      this.placeLandmarks(library, rand);
      this.placeRealmFeatures(rand);
    }

    // gem runs — patterned (line / zigzag / lane-sweep) so they're a mini
    // skill challenge, not just a straight line to hold.
    //
    // NOTHING TO COLLECT on the endless cruise. Chips and nitro cans turn a
    // drive into a route you are supposed to be optimising — you start weaving
    // for pickups instead of just driving, which is the one thing that mode is
    // for. The distance readout is the only score it needs.
    let gi = 0;
    for (let d = 40; !this.cfg.endless && d < len - 40; d += 100) {
      const pattern = gi++ % 3;
      const startLane = lane();
      for (let k = 0; k < 6; k++) {
        let l = startLane;
        if (pattern === 1) l = LANE_CENTERS[k % 2 === 0 ? 0 : 2];          // zigzag edges
        else if (pattern === 2) l = LANE_CENTERS[Math.min(2, Math.floor(k / 2))]; // sweep across
        this.addEntity("gem", d + k * 3.5, l, makeGem(pal.gem, false), 0.8);
      }
    }

    // (boost pads, boost gates/rings and decorative ring hoops all removed —
    //  the track stays clean; only gems + nitro cans remain as pickups)

    // nitro canisters — frequent enough that nitro is a rhythm you can count on
    // rather than a rarity. Each site drops a PAIR in different lanes, so you no
    // longer have to be in the one exact lane to ever pick a charge up.
    let ni = 0;
    // 145 m -> 300 m. Note the trap: 200 m looked like a 31% cut in density but
    // the 1.55x longer lap turned it into 24 cans per lap, MORE than the 20 you
    // had before. 300 m lands ~16 per lap — an actual trim, not a drought.
    for (let d = 130; !this.cfg.endless && d < len - 40; d += 300) {
      const a = LANE_CENTERS[ni % 3];
      const b = LANE_CENTERS[(ni + 1) % 3];
      ni++;
      this.addEntity("nitro", d, a, makeNitroCan());
      this.addEntity("nitro", d + 7, b, makeNitroCan());
    }

    // RAMPS ARE BACK, but built to be OPTIONAL rather than unavoidable. They were
    // pulled because they spanned two thirds of the road and pitched you off the
    // map; RAMP_SPECS is now genuinely one lane wide (half-width 1.5 on a 10 m
    // road) with the launch power dialled down. Each ramp is pinned to ONE lane
    // and the gentler kinds dominate, so there is always a clear line past it and
    // taking one is a choice you make for the airtime, not a trap.
    {
      const rampKinds: RampKind[] = ["kicker", "twist", "standard", "kicker", "twist", "standard"];
      let rk = 0;
      // A ramp is only safe on a STRAIGHT. On a bend you launch along the
      // tangent while the road turns away, so you land off-track however well
      // you drive — that's what was throwing you out. Require the take-off AND
      // the whole landing zone (~70 m downrange) to be near-straight, and walk
      // forward until that's true rather than placing on a fixed stride.
      // The straight has to cover the whole FLIGHT, not just the take-off. At
      // ~55 m/s a standard ramp is airborne ~1.3 s, so it lands ~72 m downrange —
      // a 70 m check let one land just past the end of the straight and off the
      // road. 110 m covers even the mega ramp with margin.
      // Relaxed from 0.0045 to 0.007 and the window from 110 m to 95 m. The
      // strict version only found ~3 ramps on a twisty circuit; now that air
      // control actually works a gentle bend is recoverable, so this trades a
      // little margin for roughly double the ramps.
      const straightAt = (at: number) => {
        for (let o = -12; o <= 95; o += 10) {
          if (Math.abs(this.track.curvatureAt(this.track.wrap(at + o))) > 0.007) return false;
        }
        return true;
      };
      for (let d = 200; d < len - 170; d += 175) {
        let at = d, tries = 0;
        while (!straightAt(at) && tries++ < 30) at += 12;   // slide to the next straight
        if (!straightAt(at)) continue;                      // no straight here — skip it
        d = at;
        // No ramps on the endless cruise. Being thrown into the air every few
        // hundred metres is the opposite of what that mode is for — it is meant
        // to be a drive, not a stunt course.
        if (this.cfg.endless) continue;
        const kind = rampKinds[rk % rampKinds.length];
        // Cycle the lanes. These used to be centre-lane ALWAYS, because the
        // pure-pursuit steering assist pulls you back to the centreline and so
        // actively steers you off a ramp parked out wide — 2 of 4 never
        // launched in testing. But every ramp on the racing line reads as a
        // conveyor belt, which is the real complaint. Cycling puts two thirds
        // of them off-centre; the assist only holds the wheel when YOU are not
        // steering, so aiming for one still works, and the centre-lane third
        // keeps them from being missable by accident.
        const lane = LANE_CENTERS[rk % 3];
        this.addEntity("ramp", d, lane, makeRamp(kind, this.realm.style === "void"), 0, RAMP_SPECS[kind].power);
        // The ride-up physics reads `this.ramps`, which NOTHING was populating —
        // so before this the ramps were pure decoration you drove straight
        // through. Register each one so it can actually be driven up.
        //   len:  RAMP_SPECS.l is HALF-length (makeRamp spans z from -l to +l).
        //   lane: the ride-up compares against `playerX`, and the two differ —
        //         addEntity places at `lateral * ROAD_HALF_WIDTH` (/5) while
        //         playerX divides by ROAD_HALF_WIDTH * 0.9 (/4.5). Convert, or
        //         the collision band sits off-centre from the visible ramp.
        this.ramps.push({
          road: -1,
          dist: this.track.wrap(d),
          power: RAMP_SPECS[kind].power,
          lane: lane / 0.9,
          len: RAMP_SPECS[kind].l * 2,
          height: RAMP_SPECS[kind].h,
          twist: kind === "twist",
        });
        rk++;
      }
    }

    // TRANSFORMER RUSH: orbs + the things the mech exists to destroy.
    if (this.cfg.orbs) {
      // Orbs were every 460 m, so you spent most of the race NOT a mech — which
      // is the whole appeal of the mode. Roughly double them for real uptime.
      for (let d = 120; d < len - 60; d += 235) {
        this.addEntity("orb", d, lane(), makeOrb());
      }
      // Smashable boulders. The smash scoring + collision already existed but
      // NOTHING ever spawned a "rock", so the mech had nothing to rampage
      // through. These are the mech's fodder — paired across lanes so there's
      // always a line through them when you're on wheels.
      let ri = 0;
      for (let d = 190; d < len - 60; d += 125) {
        this.addEntity("rock", d, LANE_CENTERS[ri % 3], makeRockProp(rand));
        ri++;
      }
    }
    if (this.cfg.monsters) {
      // thinned out (was every 150 m): with a soft penalty they're targets, not
      // a gauntlet that stops the race dead every few seconds
      for (let d = 240; d < len - 60; d += 230) {
        this.addEntity("monster", d, lane(), makeMonster(rand));
      }
    }

    // item-box power-ups (missile/shield/mine/boost): only in the combat mode
    // (Space Wars) now — removed from normal races to keep the track clean.
    if (this.cfg.combat) {
      for (let d = 110; d < len - 40; d += 85) {
        for (const l of LANE_CENTERS) {
          this.addEntity("itembox", d, l, makeItemBox(), 0.2);
        }
      }
    }

    // Drift zones first: they pick the circuit's best corners, and the boost
    // chains then hang off those same corner exits, so the two gimmicks land in
    // the same places and read as one feature rather than two sprinklings.
  }

  /** Place a handful (~3-6) of BIG signature landmarks per ground realm at
   *  scenic spots well back from the road (offset ~80-140 m). Reuses the existing
   *  themed prop builders, scaled up and grouped into recognisable set-pieces
   *  (a Giza cluster, a downtown block, a grandstand row, the Hogwarts castle…).
   *  Grounded on the elevated terrain via terrainYAt, like the roadside bands. */
  private placeLandmarks(library: ModelLibrary, rand: () => number) {
    const { track, realm } = this;
    const CLIFF_SPREAD = Game.CLIFF_SPREAD;
    const len = track.length;
    const cols = realm.palette.crystalColors;

    // scale a built prop and offset it within a cluster's local frame (base stays
    // on the cluster's y=0 plane since the builders sit their base at the origin)
    /** Mark a prop so it can be found at runtime — used to diagnose placement. */
    const tag = (obj: THREE.Object3D, kind: string): THREE.Object3D => {
      obj.userData.kind = kind;
      return obj;
    };
    const at = (obj: THREE.Object3D, x: number, z: number, s: number): THREE.Object3D => {
      obj.position.set(x, obj.position.y, z);
      obj.scale.multiplyScalar(s);
      return obj;
    };
    // a big instanced rock (asteroid-style), tinted, at a target size
    const rock = (kind: "rockA" | "rockB", size: number): THREE.Object3D => {
      const r = instantiate(library, kind, size);
      varyTint(r, rand);
      return r;
    };
    const crystals = (s: number) => at(makeCrystalCluster(rand, cols), 0, 0, s);

    // drop a hero group at `frac` of the lap, `off` m back from the road on
    // `side` (±1), grounded on the terrain. `faceRoad` turns local +Z (the
    // "front" of stands / castles / sphinxes) toward the track; otherwise the
    // group takes a free random spin.
    // `yawOffset` exists for props whose FRONT is -Z (the waterfalls). Aiming +Z
    // at the road, as faceRoad does, presents their back — which is why bare
    // cliffs kept turning up around the map.
    const drop = (group: THREE.Object3D, frac: number, side: 1 | -1, off: number, faceRoad: boolean, yawOffset = 0, wantsCliff = false) => {
      const d = track.wrap(frac * len);
      // Hero monuments are huge, so a local offset isn't enough — walk them out
      // until their whole footprint clears the ENTIRE circuit (a twisty lap can
      // otherwise come back round straight into a pyramid).
      let lat = this.clearOffset(group, side * off, 12);
      const hm = this.propMetrics(group);
      // Walk out until the spot is BOTH clear of the circuit and flat enough to
      // stand a flat-based prop on.
      //
      // Clearance alone was the old test, and it is why a waterfall cliff ended
      // up pitched on a mountainside with its downhill edge in the air: no
      // amount of sinking fixes a slope that drops 10 m across a footprint,
      // because the base is flat and the hill is not. So flatness is a
      // placement criterion, not something to correct afterwards. Keep the
      // flattest candidate seen, so a realm with nowhere truly level still gets
      // the best available spot rather than the first one.
      // Walk OUTWARD and take the first spot that is clear and not a cliff —
      // nearest wins, because distance is its own bug. A previous pass had
      // these falls 95-100 m out and the note in the code was that they were
      // "scenery you never really register"; searching for perfectly level
      // ground pushed one to 246 m, which is worse than the slope was.
      //
      // 6 m of spread across the footprint is the tolerance, not 0: these props
      // are CLIFFS, they read fine pitched on a hillside, and the sink below
      // handles the remainder. Ten tries (140 m) then settle for the flattest
      // seen, so no monument wanders off to the horizon hunting a plain.
      //
      // A WATERFALL WANTS THE OPPOSITE OF THIS. Everything above is a search for
      // level ground, which is right for a castle and exactly wrong for water:
      // run it on a waterfall and you get what Enchanted Forest had — a rock
      // slab with a sheet of water down its face, standing upright in the
      // middle of an open, gently sloping meadow, no cliff, no watercourse
      // above it, no pool below. It was the flattest spot available, which is
      // precisely why it looked absurd. `wantsCliff` inverts the test: take the
      // STEEPEST footprint found, and if the realm has nothing steep enough
      // within reach, place nothing at all. A missing landmark is invisible; a
      // waterfall in a field is the first thing you see.
      // A cliff-seeker also slides along the lap; a level-ground seeker does
      // not, because level ground is common and the fraction is chosen for the
      // view. Steep ground is the scarce resource, so it is the one worth
      // hunting for in two dimensions.
      const slides = wantsCliff ? [0, 60, -60, 120, -120, 180, -180] : [0];
      let best = { lat, d, spread: wantsCliff ? -Infinity : Infinity };
      search:
      for (const sd of slides) {
        const dd = track.wrap(d + sd);
        let l = lat;
        for (let tries = 0; tries < 10; tries++) {
          const q = track.pointAt(dd, l);
          if (this.roadClear(q.x, q.z, hm.reach, Math.max(6, hm.margin))) {
            const spread = this.groundSpreadUnder(q.x, q.z, hm.reach);
            if (wantsCliff) {
              if (spread > best.spread) best = { lat: l, d: dd, spread };
              if (spread >= CLIFF_SPREAD) break search;
            } else {
              if (spread < best.spread) best = { lat: l, d: dd, spread };
              if (spread <= 6) break search;
            }
          }
          l += side * 14;
        }
      }
      if (wantsCliff && best.spread < CLIFF_SPREAD) return;   // no cliff here — skip it
      lat = best.lat;
      const p = track.pointAt(best.d, lat);
      // Same single-sample bug as place() had, and worse here: these are the
      // hero monuments — the widest footprints in the game, walked 90-120 m off
      // the road into terrain nothing else constrains. A waterfall cliff on
      // Crystal Peaks was standing with its downhill edge 9.8 m in the air.
      group.position.set(p.x, this.groundFloorUnder(p.x, p.z, hm.reach), p.z);
      if (faceRoad) {
        const rp = track.pointAt(best.d, 0);
        group.rotation.y = Math.atan2(rp.x - p.x, rp.z - p.z) + yawOffset;
      } else {
        group.rotation.y = rand() * Math.PI * 2;
      }
      this.scene.add(group);
    };
    const cluster = (...members: THREE.Object3D[]): THREE.Group => {
      const g = new THREE.Group();
      for (const m of members) g.add(m);
      return g;
    };

    switch (realm.id) {
      case "sands": {
        // a Giza-style row of stepped pyramids with a sphinx out front
        const sph = makeSphinx(rand); sph.rotation.y = 0; // face +Z → the road
        drop(cluster(
          at(makePyramid(rand), 0, 0, 2.6),
          at(makePyramid(rand), 42, 22, 2.0),
          at(makePyramid(rand), 72, 46, 1.5),
          at(sph, -16, 36, 3.2),
        ), 0.2, 1, 120, true);
        // a pair of towering obelisks flanking a lone sphinx
        const sph2 = makeSphinx(rand); sph2.rotation.y = 0;
        drop(cluster(
          at(makeObelisk(rand), -7, 0, 2.6),
          at(makeObelisk(rand), 7, 0, 2.6),
          at(sph2, 0, 12, 2.4),
        ), 0.6, -1, 90, true);
        drop(at(makePyramid(rand), 0, 0, 3.0), 0.85, 1, 130, false);
        break;
      }
      case "castle": {
        // THE landmark: Hogwarts, facing the road, on the inside of the loop
        drop(at(makeHogwartsCastle(rand), 0, 0, 1.7), 0.5, 1, 135, true);
        // the three Quidditch goal hoops standing together
        drop(cluster(
          at(makeQuidditchHoop(rand), -8, 0, 1.35),
          at(makeQuidditchHoop(rand), 0, 2, 1.5),
          at(makeQuidditchHoop(rand), 8, 0, 1.35),
        ), 0.26, -1, 85, false);
        // an outlying keep: big towers + a wall section
        drop(cluster(
          at(makeTower(rand), 0, 0, 1.8),
          at(makeTower(rand), 15, 9, 1.4),
          at(makeCastleWall(rand), 8, -6, 2.4),
        ), 0.78, 1, 100, false);
        break;
      }
      case "circuit": {
        // a long grandstand run with floodlight masts behind, open to the track
        drop(cluster(
          at(makeGrandstand(rand), -15, 0, 2.0),
          at(makeGrandstand(rand), 0, 0, 2.0),
          at(makeGrandstand(rand), 15, 0, 2.0),
          at(makeFloodlight(rand), -24, -5, 1.6),
          at(makeFloodlight(rand), 24, -5, 1.6),
        ), 0.5, 1, 85, true);
        // the pit / paddock complex flanked by floodlights
        drop(cluster(
          at(makePitBuilding(rand), 0, 0, 2.2),
          at(makeFloodlight(rand), -20, -6, 1.5),
          at(makeFloodlight(rand), 20, -6, 1.5),
        ), 0.16, -1, 80, true);
        drop(cluster(
          at(makeGrandstand(rand), -13, 0, 2.2),
          at(makeGrandstand(rand), 13, 0, 2.2),
        ), 0.8, -1, 90, true);
        break;
      }
      case "metro": {
        // two downtown blocks of clustered towers rising over the skyline
        drop(cluster(
          at(makeSkyscraper(rand), 0, 0, 1.8),
          at(makeSkyscraper(rand), 24, 12, 2.2),
          at(makeSkyscraper(rand), 44, -6, 1.6),
          at(makeSkyscraper(rand), 16, 30, 2.0),
          at(makeSkyscraper(rand), 46, 28, 1.5),
        ), 0.35, 1, 120, false);
        drop(cluster(
          at(makeSkyscraper(rand), 0, 0, 2.0),
          at(makeSkyscraper(rand), 26, 14, 1.7),
          at(makeSkyscraper(rand), 42, 32, 2.2),
        ), 0.72, -1, 130, false);
        break;
      }
      case "forest": {
        // a giant ancient grove with a glowing crystal outcrop
        const grove = new THREE.Group();
        if (this.treeMats) {
          grove.add(at(makeTree(rand, this.treeMats, "tall"), 0, 0, 2.4));
          grove.add(at(makeTree(rand, this.treeMats, "pine"), 17, 9, 2.0));
          grove.add(at(makeTree(rand, this.treeMats, "round"), -13, 11, 1.8));
        }
        grove.add(crystals(2.6));
        drop(grove, 0.4, 1, 95, false);
        // a big scenic waterfall cliff
        drop(tag(at(makeWaterfall(rand), 0, 0, 2.0), "waterfall"), 0.15, -1, 100, true, Math.PI, true);
        drop(cluster(crystals(3.0), at(makeCrystalCluster(rand, cols), 11, 6, 2.2)), 0.78, 1, 90, false);
        break;
      }
      case "ember": {
        // massive volcanic outcrops shot through with glowing crystal
        drop(cluster(
          at(rock("rockA", 9), 0, 0, 1),
          at(rock("rockB", 7), 13, 7, 1),
          at(makeCrystalCluster(rand, cols), 5, -5, 3.2),
        ), 0.35, 1, 100, false);
        drop(cluster(
          at(rock("rockB", 11), 0, 0, 1),
          at(makeCrystalCluster(rand, cols), -8, 6, 2.4),
        ), 0.68, -1, 95, false);
        drop(at(rock("rockA", 13), 0, 0, 1), 0.12, 1, 120, false);
        break;
      }
      case "peaks": {
        // towering ice spires with a big rock and a frozen waterfall
        drop(cluster(
          crystals(3.6),
          at(makeCrystalCluster(rand, cols), 12, 8, 2.8),
          at(makeCrystalCluster(rand, cols), -10, 6, 2.4),
          at(rock("rockA", 10), 6, -6, 1),
        ), 0.4, 1, 100, false);
        drop(tag(at(makeWaterfall(rand), 0, 0, 2.2), "waterfall"), 0.62, -1, 95, true, Math.PI, true);
        drop(cluster(
          crystals(4.0),
          at(makeCrystalCluster(rand, cols), 14, 10, 2.6),
        ), 0.15, 1, 120, false);
        break;
      }

      // The six photo realms had NO case here at all, which is why they were
      // interchangeable: identical roadside scatter, and whatever generic
      // set-piece the shared systems happened to hand them. Each one gets the
      // thing you would actually recognise it by.
      case "azur": {
        // the harbour: a terrace of pastel apartment blocks stacked up the hill
        // behind the waterfront, and the breakwater light at the harbour mouth
        for (const [frac, side, off] of [[0.18, -1, 62], [0.52, -1, 74], [0.81, -1, 58]] as const) {
          drop(cluster(
            at(makeBrownstone(rand), 0, 0, 1.5),
            at(makeBrownstone(rand), 26, 16, 1.8),
            at(makeBrownstone(rand), -22, 22, 1.3),
            at(makeBrownstone(rand), 8, 40, 2.1),
          ), frac, side, off, true);
        }
        drop(at(makeTower(rand), 0, 0, 1.1), 0.36, 1, 52, false);
        break;
      }
      case "hokkai": {
        // avalanche shelter frames and a stand of the tallest firs on the pass
        for (const [frac, side] of [[0.26, 1], [0.58, -1], [0.87, 1]] as const) {
          drop(cluster(
            at(makeTree(rand, this.treeMats!, "pine"), 0, 0, 3.4),
            at(makeTree(rand, this.treeMats!, "pine"), 14, 9, 4.2),
            at(makeTree(rand, this.treeMats!, "pine"), -12, 14, 3.0),
            at(rock("rockB", 7), 9, -7, 1),
          ), frac, side, 56, false);
        }
        break;
      }
      case "mirage": {
        // the glass skyline, brought in off the horizon so it actually passes
        for (const [frac, side, off] of [[0.22, 1, 150], [0.55, -1, 175], [0.84, 1, 160]] as const) {
          drop(cluster(
            at(makeSkyscraper(rand), 0, 0, 1.9),
            at(makeSkyscraper(rand), 46, 34, 2.6),
            at(makeSkyscraper(rand), -40, 52, 1.5),
            at(makeSkyscraper(rand), 18, 86, 3.1),
          ), frac, side, off, false);
        }
        break;
      }
      case "basin": {
        // mesas, and the water tower every desert highway has one of
        for (const [frac, side, off] of [[0.2, -1, 120], [0.47, 1, 145], [0.76, -1, 132]] as const) {
          drop(cluster(
            at(rock("rockA", 26), 0, 0, 1),
            at(rock("rockB", 17), 34, 22, 1),
            at(rock("rockA", 12), -26, 30, 1),
          ), frac, side, off, false);
        }
        drop(at(makeWaterTower(rand), 0, 0, 1.5), 0.62, 1, 48, false);
        drop(at(makeBillboard(rand), 0, 0, 1.3), 0.34, -1, 34, true);
        break;
      }
      case "cape": {
        // cypress on the headland and the light at the point — no monuments,
        // because on this road the drop IS the view
        for (const [frac, side] of [[0.3, -1], [0.64, -1], [0.9, -1]] as const) {
          drop(cluster(
            at(makeTree(rand, this.treeMats!, "tall"), 0, 0, 2.6),
            at(makeTree(rand, this.treeMats!, "tall"), 11, 8, 3.2),
            at(rock("rockB", 9), -9, 6, 1),
          ), frac, side, 44, false);
        }
        drop(at(makeTower(rand), 0, 0, 0.85), 0.47, 1, 70, false);
        break;
      }
      case "neon": {
        // Overhead lighting down the whole highway, alternating verges so the
        // lamps pass over your head in a steady rhythm. This is the single
        // biggest thing that makes a night road read as a ROAD rather than as
        // a dark strip with glowing edges.
        {
          const spacing = 78;
          const n = Math.floor(len / spacing);
          for (let k = 0; k < n; k++) {
            const d = k * spacing + 20;
            const side: 1 | -1 = k % 2 === 0 ? 1 : -1;
            const off = side * (ROAD_HALF_WIDTH + 2.6);
            const pt = track.pointAt(track.wrap(d), off);
            const lamp = makeOverheadLight(rand, 0x9fd8ff, ROAD_HALF_WIDTH + 1.4);
            lamp.position.set(pt.x, this.terrainYAt(d, off), pt.z);
            // aim the boom across the carriageway
            const mid = track.pointAt(track.wrap(d), 0);
            lamp.rotation.y = Math.atan2(mid.x - pt.x, mid.z - pt.z) + Math.PI / 2;
            this.scene.add(lamp);
          }
        }
        // The city IS the scenery here: slabs of tower marching down both sides
        // of the highway, close enough to feel like walls of light, plus
        // billboards turned to face the traffic.
        // The city wall, both sides, all the way round. Stepped-massing towers
        // rather than extruded boxes — see makeNeoTower: a city of plain boxes
        // is a bar chart, and what carries the reference is the silhouette.
        for (let k = 0; k < 44; k++) {
          const frac = k / 44 + 0.006;
          const side: 1 | -1 = k % 2 === 0 ? 1 : -1;
          const t = (n: number) => makeNeoTower(rand, 16 + rand() * 22, 14 + rand() * 20, n);
          drop(cluster(
            at(t(46 + rand() * 90), 0, 0, 1),
            at(t(34 + rand() * 70), 44 + rand() * 26, 30 + rand() * 24, 1),
            at(t(28 + rand() * 58), -38 - rand() * 24, 52 + rand() * 30, 1),
            at(t(60 + rand() * 110), 14 + rand() * 30, 96 + rand() * 40, 1),
          ), frac, side, 46 + rand() * 26, false);
        }
        // OVERPASSES crossing above the carriageway. Neo-Tokyo's roads run
        // under other roads — it is the thing that makes the city feel stacked
        // rather than lining a corridor, and from the seat it gives you
        // something that passes OVER you, which nothing else here does.
        for (let k = 0; k < 9; k++) {
          const d = track.wrap((k / 9 + 0.05) * len);
          const p0 = track.pointAt(d, 0);
          const tan = track.tangentAt(d);
          const deckY = this.terrainYAt(d, 0) + 11 + rand() * 5;
          const span = new THREE.Group();
          const conc = new THREE.MeshStandardMaterial({ color: 0x14121f, roughness: 0.95, flatShading: true });
          const deck = new THREE.Mesh(new THREE.BoxGeometry(96, 1.9, 11 + rand() * 5), conc);
          deck.position.y = deckY;
          span.add(deck);
          // parapets, and the lit underside strip that says "this is a road"
          for (const sz of [-1, 1]) {
            const par = new THREE.Mesh(new THREE.BoxGeometry(96, 1.5, 0.7), conc);
            par.position.set(0, deckY + 1.5, sz * 5.6);
            span.add(par);
          }
          const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(96, 0.18, 0.5),
            new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
          glowStrip.position.set(0, deckY - 1.05, 0);
          span.add(glowStrip);
          // piers, set well outside the carriageway
          for (const sx of [-1, 1]) {
            const pier = new THREE.Mesh(new THREE.BoxGeometry(3.4, deckY, 3.4), conc);
            pier.position.set(sx * 26, deckY / 2, 0);
            span.add(pier);
          }
          span.position.set(p0.x, 0, p0.z);
          span.rotation.y = Math.atan2(tan.x, tan.z);   // deck runs ACROSS the road
          this.scene.add(span);
        }
        for (let k = 0; k < 8; k++) {
          drop(at(makeBillboard(rand), 0, 0, 1.5 + rand() * 0.5),
            k / 8 + 0.06, k % 2 === 0 ? -1 : 1, 26 + rand() * 8, true);
        }
        // SIGNAGE, thick along both sides. Towers with nothing but window
        // squares give the eye nothing to read as a city — the signs are what
        // make the buildings feel occupied, and they are the light source the
        // reference keeps insisting on. Hung at varying heights and facing the
        // traffic, so they sweep past at eye level as you drive.
        // 260 over a 16 km lap is a sign every 60 m on average. Neo-Tokyo is
        // papered in them; 120 left long dark stretches between.
        //
        // The spill quads are collected rather than added one by one: 520 of
        // them all share the wash material and none of them ever move, so they
        // become ONE mesh. This renderer is draw-call bound and 520 extra
        // objects to cull and submit is exactly the kind of thing that has hurt
        // it before.
        const washGeos: THREE.BufferGeometry[] = [];
        const collect = (m: THREE.Mesh) => {
          m.updateMatrix();
          const gm = m.geometry.clone();
          gm.applyMatrix4(m.matrix);
          washGeos.push(gm);
        };
        for (let k = 0; k < 260; k++) {
          const d = track.wrap(rand() * len);
          const side: 1 | -1 = rand() < 0.5 ? 1 : -1;
          const off = side * (34 + rand() * 46);
          const pt = track.pointAt(d, off);
          const sign = makeNeonSign(rand);
          const sc = 1.3 + rand() * 1.9;
          sign.scale.multiplyScalar(sc);
          const signY = this.terrainYAt(d, off) + 6 + rand() * 26;
          sign.position.set(pt.x, signY, pt.z);
          const road = track.pointAt(d, 0);
          sign.rotation.y = Math.atan2(road.x - pt.x, road.z - pt.z);
          this.scene.add(sign);

          // THE LIGHT IT THROWS. A sign that only lights itself is a sticker on
          // a black wall; in the reference a sign across the street puts its
          // colour on the block opposite and on the wet road underneath, and
          // that spill is most of what makes the city feel lit rather than
          // decorated. Two washes, both additive and both falling off softly.
          const hue = sign.userData.signColor as number;

          // on the road below, stretched along it the way a real throw is
          const poolD = track.wrap(d + (rand() - 0.5) * 20);
          const poolP = track.pointAt(poolD, side * (rand() * 6));
          const pool = makeLightWash(hue, 34 + rand() * 22, 0.22);
          pool.rotation.x = -Math.PI / 2;
          pool.rotation.z = rand() * Math.PI;
          pool.position.set(poolP.x, this.terrainYAt(poolD, 0) + 0.05, poolP.z);
          collect(pool);

          // and on the block across the road, facing back the way the sign does
          const farOff = -side * (30 + rand() * 34);
          const farP = track.pointAt(d, farOff);
          const far = makeLightWash(hue, 26 + rand() * 30, 0.17);
          far.position.set(farP.x, signY + (rand() - 0.4) * 16, farP.z);
          far.rotation.y = Math.atan2(pt.x - farP.x, pt.z - farP.z);
          collect(far);
        }
        if (washGeos.length) {
          const merged = mergeGeometries(washGeos, false);
          if (merged) {
            const m = new THREE.Mesh(merged, washMaterial());
            m.renderOrder = 3;
            this.scene.add(m);
          }
        }
        break;
      }
      case "hills": {
        // houses on stilts hanging off the canyon side, and the mast on the ridge
        for (const [frac, side, off] of [[0.24, 1, 58], [0.52, -1, 64], [0.79, 1, 55]] as const) {
          drop(cluster(
            at(makeBrownstone(rand), 0, 0, 1.2),
            at(makeBrownstone(rand), 22, 18, 0.95),
          ), frac, side, off, true);
        }
        drop(at(makeFloodlight(rand), 0, 0, 2.4), 0.4, -1, 88, false);
        drop(at(makeBillboard(rand), 0, 0, 1.4), 0.68, 1, 30, true);
        break;
      }
    }
  }

  /** Per-realm signature set-pieces the generic scenery bands don't cover:
   *  volcanoes + lava for Ember, snowmen for Peaks, cave mouths for the Forest. */
  private placeRealmFeatures(rand: () => number) {
    const { track, realm } = this;
    const len = track.length;
    const pal = realm.palette;
    const place = (obj: THREE.Object3D, d: number, off: number, yaw = rand() * Math.PI * 2) => {
      const w = track.wrap(d);
      const p = track.pointAt(w, off);
      // never let a realm feature sit on the racing line (the circuit can wind
      // back into a spot that looked clear at this arc distance)
      const fm = this.propMetrics(obj);
      if (!this.roadClear(p.x, p.z, fm.reach, Math.max(2, fm.margin))) return;
      // Sit it on the LOWEST ground under its footprint, not on one sample at
      // its centre.
      //
      // This is what put a waterfall 9.3 m into the air on Crystal Peaks. The
      // prop is ~7 m wide before a 2.2x scale, so its base spans ~18 m of
      // mountainside; a single centre sample leaves the downhill edge hanging
      // by the height the slope drops across that span. Measured: base at
      // 41.88, ground beneath falling to 32.57.
      //
      // Sinking to the minimum buries the uphill edge instead, and buried is
      // invisible while floating is the first thing you notice. Cheap, too —
      // nine samples per prop, once, at build time.
      obj.position.set(p.x, this.groundFloorUnder(p.x, p.z, fm.reach), p.z);
      obj.rotation.y = yaw;
      this.scene.add(obj);
    };
    // orient a prop's +Z toward the road from an offset `side`
    const faceRoad = (d: number, side: number) => {
      const t = track.tangentAt(track.wrap(d));
      const rx = t.z, rz = -t.x; // road "right"
      return Math.atan2(-side * rx, -side * rz);
    };

    if (realm.id === "ember") {
      // volcanoes brooding over the wastes — a couple loom close, the rest ring
      // the horizon so there's always one in view
      for (let i = 0; i < 5; i++) {
        const d = (i / 5) * len + rand() * 60;
        const side = i % 2 === 0 ? 1 : -1;
        const near = i < 2 ? 95 + rand() * 40 : 180 + rand() * 140;
        const v = makeVolcano(pal);
        if (i < 2) v.scale.multiplyScalar(1.25);
        place(v, d, side * near);
      }
      // …and molten pools glowing just off the ribbon
      for (let d = 90; d < len - 40; d += 180) {
        const side = rand() < 0.5 ? 1 : -1;
        place(makeLavaPool(), d + rand() * 40, side * (ROAD_HALF_WIDTH + 8 + rand() * 22));
      }
    } else if (realm.id === "peaks") {
      // big friendly snowmen dotted close along the verges (scaled up so they
      // read clearly against the vast snowfield)
      for (let d = 70; d < len - 40; d += 105) {
        const side = rand() < 0.5 ? 1 : -1;
        const s = makeSnowman();
        s.scale.multiplyScalar(1.8 + rand() * 1.6);
        place(s, d + rand() * 22, side * (ROAD_HALF_WIDTH + 4 + rand() * 14));
      }
      // Frozen falls close in, so the ice realm also has a feature you pass —
      // on a cliff, same rule as the forest ones. This pair was the second
      // copy of the same bug: a fixed 12-18 m offset from a verge that is
      // graded flat by construction, which is how you end up with a waterfall
      // standing in a field.
      for (let i = 0; i < 2; i++) {
        const d = len * (0.24 + i * 0.42) + rand() * 30;
        const side = i % 2 === 0 ? -1 : 1;
        const w = makeWaterfall(rand);
        w.userData.kind = "waterfall";
        w.scale.multiplyScalar(1.4 + rand() * 0.6);
        const spot = this.findCliff(d, side, this.propMetrics(w).reach);
        if (!spot) continue;
        place(w, spot.d, side * spot.off, faceRoad(spot.d, side));
      }
    } else if (this.coast) {
      // THE SEA. Offset to one side of the circuit and dropped below the road so
      // the causeway reads as running along a shore. It's a painted plane rather
      // than a reflective surface — see makeOceanPlane — because the look needs
      // it to hold its colour exactly, and anything lit turns grey once the
      // ambient is this low.
      const c = this.coast;
      const cs = realm.coast!;
      const sea = makeOceanPlane(pal, Math.max(12000, c.far * 8), cs.sea);
      // just under the beach ramp, centred on the island so it surrounds it
      sea.position.set(c.x, this.seaY, c.z);
      this.scene.add(sea);

      // the city, across the water: a flat cut-out band on the far shore
      if (cs.skyline) for (const [ang, span, dist] of [[0.6, 2400, 2.15], [2.4, 1700, 2.45], [4.3, 1500, 2.3]] as const) {
        const sk = makeSkyline(rand, pal, span);
        const R = c.far * dist;   // c.far, NOT c.r — see the coast comment above
        sk.position.set(c.x + Math.cos(ang) * R, this.seaY + 1, c.z + Math.sin(ang) * R);
        sk.rotation.y = -ang + Math.PI / 2;   // face the island across the water
        this.scene.add(sk);
      }

      // palms all the way down both sides of the causeway, instanced
      const palmSpots: { x: number; y: number; z: number; s: number; r: number }[] = [];
      if (cs.palms) for (let d = 0; d < len; d += 15) {
        for (const side of [-1, 1]) {
          if (rand() < 0.28) continue;
          // clear of the tarmac: a palm trunk at +5 m was close enough to
          // overhang the road on a bend, which is why they read as standing
          // "on the road"
          const off = side * (ROAD_HALF_WIDTH + 2.4 + rand() * 3.2);
          const jd = d + rand() * 11;
          const p = track.pointAt(this.track.wrap(jd), off);
          palmSpots.push({ x: p.x, y: this.terrainYAt(jd, off), z: p.z, s: 0.85 + rand() * 0.3, r: rand() * Math.PI * 2 });
          // and SOLID — scenery you can drive straight through breaks the world
          if (this.obstacleClear(p.x, p.z, 1.0)) this.obstacles.push({ x: p.x, z: p.z, r: 1.0 });
        }
      }
      this.scene.add(makePalmField(rand, palmSpots, pal));
    } else if (realm.id === "forest") {
      // cave mouths set back in the hillsides, facing the road
      for (let d = 60; d < len - 40; d += 220) {
        const side = rand() < 0.5 ? 1 : -1;
        const c = makeCaveMouth(pal);
        c.scale.multiplyScalar(1 + rand() * 0.6);
        place(c, d + rand() * 40, side * (ROAD_HALF_WIDTH + 26 + rand() * 44), faceRoad(d, side));
      }
      // Signature waterfalls near the ribbon — ON A CLIFF, or not at all.
      //
      // These were pinned at 11-17 m off the verge so "you drive past the
      // spray". The verge is the one part of the map that is graded flat,
      // which is how the forest ended up with waterfalls standing bolt upright
      // in open meadow: a rock slab, a sheet of water down its face, and
      // nothing above or below it. So the offset is a SEARCH now, not a
      // constant — walk out from the verge and take the first genuinely steep
      // footprint; if the whole band out to 90 m is gentle, place nothing.
      for (let i = 0; i < 3; i++) {
        const d = len * (0.17 + i * 0.29) + rand() * 40;
        const side = i % 2 === 0 ? 1 : -1;
        const w = makeWaterfall(rand);
        w.userData.kind = "waterfall";
        w.scale.multiplyScalar(1.5 + rand() * 0.7);
        const spot = this.findCliff(d, side, this.propMetrics(w).reach);
        if (!spot) continue;                            // nowhere near here is a cliff
        place(w, spot.d, side * spot.off, faceRoad(spot.d, side));
      }
    }
  }

  /** Scatter points across the arena, skipping the road corridor. */
  private scatter(
    centerline: { x: number; z: number }[],
    rand: () => number,
    count: number,
    minDist: number,
    reach: number
  ): Placement[] {
    // Sample ALONG THE ROAD, not across the track's bounding box.
    //
    // The old version threw darts at the whole bounding box and rejected
    // anything too close to the centreline. On a circuit that box is mostly
    // empty interior, so the overwhelming majority of darts landed nowhere near
    // the road, the `tries < count * 4` budget burned out long before `count`
    // points were accepted, and what survived was thin and blotchy — the bald
    // patches on the forest floor. There was also no MAXIMUM distance, so
    // accepted points were scattered across the entire map, spending instances
    // where nobody ever drives.
    //
    // Picking a centreline segment and then an offset inside [minDist, reach]
    // is rejection-free: every point lands in the band you actually see, the
    // full count is always met, and coverage is even along the whole lap.
    const pts: Placement[] = [];
    const n = centerline.length;
    if (!n) return pts;
    for (let k = 0; k < count; k++) {
      const i = Math.floor(rand() * n);
      const c = centerline[i], c2 = centerline[(i + 1) % n];
      const tx = c2.x - c.x, tz = c2.z - c.z;
      const tl = Math.hypot(tx, tz) || 1;
      const rx = tz / tl, rz = -tx / tl;          // road "right"
      const u = rand();                            // slide along this segment
      const side = rand() < 0.5 ? -1 : 1;
      const off = minDist + rand() * Math.max(0, reach - minDist);
      const x = c.x + tx * u + rx * off * side;
      const z = c.z + tz * u + rz * off * side;
      // +0.1: groundHeightAtXZ deliberately holds the ground a few cm BELOW the
      // road ribbon across the corridor (so the tarmac always wins the depth
      // test). Scatter placed on that lowered surface, which is why tufts and
      // clutter looked half-sunk into the ground near the road.
      pts.push({ x, z, y: this.groundHeightAtXZ(x, z) + 0.1, s: 0.6 + rand() * 1.1, r: rand() * Math.PI * 2 });
    }
    return pts;
  }

  /** Floating crystals and asteroids around the anti-gravity void track. */
  private decorateVoid(library: ModelLibrary, rand: () => number) {
    // A dense asteroid field floating in 3D around the tube — textured rock
    // chunks at varied sizes/depths, with occasional glowing space crystals for
    // colour, so it reads as real space rather than a few scattered shapes.
    const { track, realm } = this;
    const len = track.length;
    for (let d = 0; d < len; d += 2.6) {
      for (const side of [-1, 1]) {
        if (rand() < 0.28) continue;
        let obj: THREE.Object3D;
        if (rand() < 0.86) {
          // rock asteroid (real PBR rock via the relit GLB), tumbling
          const size = 1.4 + rand() * rand() * 9; // mostly small, a few huge
          obj = instantiate(library, rand() < 0.5 ? "rockA" : "rockB", size);
          varyTint(obj, rand);
        } else {
          obj = makeCrystalCluster(rand, realm.palette.crystalColors);
        }
        const lateral = side * (ROAD_HALF_WIDTH + 5 + rand() * 75);
        const p = track.pointAt(d + rand() * 2.6, lateral);
        obj.position.set(p.x, p.y + (rand() - 0.5) * 130, p.z);
        obj.rotation.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
        this.scene.add(obj);
      }
    }
    // a handful of massive distant asteroids for a sense of scale
    for (let i = 0; i < 14; i++) {
      const rock = instantiate(library, rand() < 0.5 ? "rockA" : "rockB", 22 + rand() * 40);
      varyTint(rock, rand);
      const a = rand() * Math.PI * 2;
      const rad = 320 + rand() * 340;
      const c = (track.bounds.minX + track.bounds.maxX) / 2;
      const cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
      rock.position.set(c + Math.cos(a) * rad, (rand() - 0.5) * 260, cz + Math.sin(a) * rad);
      rock.rotation.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
      this.scene.add(rock);
    }
  }

  // --- game loop -----------------------------------------------------------

  private frame = (now: number) => {
    if (this.stopped) return;
    if (this.paused) {
      this.last = now; // hold time still so dt doesn't jump on resume
      // PHOTO MODE is paused-but-live: the simulation is frozen, the camera is
      // not. Without this the free camera renders exactly one frame and then
      // sits there, which looks like the controls are dead rather than like
      // the world is. update() stays skipped — nothing should move while you
      // are composing a shot.
      if (this.photo) this.render();
      this.rafId = requestAnimationFrame(this.frame);
      return;
    }
    const raw = Math.min(now - this.last, 250);
    // heavy smoothing: a per-frame number jitters too much to read, and what
    // matters is the sustained rate, not one slow frame
    this.frameMs += (raw - this.frameMs) * 0.06;
    this.accumulator += raw / 1000;
    // Never negative: rAF timestamps are monotonic, but ease() turns a negative
    // frame time into a factor far above 1, and one of those throws the camera
    // into orbit. (A test harness stepping its own clock found it.)
    this.renderDt = clamp(raw / 1000, 0, 0.1);
    this.last = now;
    while (this.accumulator >= STEP) {
      this.captureRenderState(this.prevView);
      this.hasPrevView = true;
      this.update(STEP);
      this.accumulator -= STEP;
    }
    this.renderInterpolated(this.accumulator / STEP);
    this.rafId = requestAnimationFrame(this.frame);
  };

  /*
   * RENDER INTERPOLATION.
   *
   * The simulation steps at a fixed 60 Hz; the display refreshes at whatever
   * it refreshes at. Rendering the latest step as-is meant that on a 120 Hz
   * screen every other frame showed a car that had not moved — while the chase
   * camera, which eases toward the car every RENDERED frame, kept closing in.
   * So the car lurched forward one frame and slid back the next, by more the
   * faster it went: measured at 70 m/s, 5.6 px RMS frame-to-frame wobble at
   * 120 Hz against 0.9 px at 60 Hz, and the rivals the same. That was "the
   * cars shake when they're speeding".
   *
   * The fix is the standard one: draw the world between the last two steps, at
   * the fraction of a step the clock has reached. Only what the eye tracks is
   * blended — the player's pose, the camera's inputs, and the rivals — and the
   * true state is put back the moment the frame is drawn, so nothing the
   * simulation reads ever sees a blended value.
   */
  private renderDt = STEP;
  private hasPrevView = false;
  private prevView = Game.emptyView();
  private currView = Game.emptyView();
  private mixView = Game.emptyView();
  private oppPrev: number[] = [];
  private oppCurr: number[] = [];

  private static emptyView() {
    return {
      x: 0, z: 0, heading: 0, lateral: 0, dist: 0, slip: 0,
      alt: 0, carPitch: 0, carYaw: 0, weightPitch: 0, weightRoll: 0, gLoad: 0, steer: 0, time: 0,
    };
  }

  private captureRenderState(v: ReturnType<typeof Game.emptyView>) {
    const fd = this.freeDrive;
    v.x = fd.x; v.z = fd.z; v.heading = fd.heading; v.lateral = fd.lateral; v.dist = fd.dist; v.slip = fd.slip;
    v.alt = this.alt; v.carPitch = this.carPitch; v.carYaw = this.carYaw;
    v.weightPitch = this.weightPitch; v.weightRoll = this.weightRoll; v.gLoad = this.gLoad;
    v.steer = this.steer; v.time = this.time;
    if (v === this.prevView) this.captureOpponents(this.oppPrev);
  }

  private applyRenderState(v: ReturnType<typeof Game.emptyView>) {
    const fd = this.freeDrive;
    fd.x = v.x; fd.z = v.z; fd.heading = v.heading; fd.lateral = v.lateral; fd.dist = v.dist; fd.slip = v.slip;
    this.position = v.dist;
    this.alt = v.alt; this.carPitch = v.carPitch; this.carYaw = v.carYaw;
    this.weightPitch = v.weightPitch; this.weightRoll = v.weightRoll; this.gLoad = v.gLoad;
    this.steer = v.steer; this.time = v.time;
  }

  /** Rival transforms, flat: x, y, z, yaw, roll per car. */
  private captureOpponents(out: number[]) {
    out.length = 0;
    for (const o of this.opponents) {
      const p = o.obj.position;
      out.push(p.x, p.y, p.z, o.obj.rotation.y, o.obj.rotation.z);
    }
  }

  private renderInterpolated(alpha: number) {
    const a = clamp(alpha, 0, 1);
    if (!this.hasPrevView || this.phase === "loading") { this.render(); return; }
    const p = this.prevView, c = this.currView, m = this.mixView;
    this.captureRenderState(c);
    // A respawn or reset moves the car tens of metres in one step; blending
    // across it would draw the car flying between the two spots for a frame.
    if (Math.hypot(c.x - p.x, c.z - p.z) > 25) { this.render(); return; }

    const lerp = (x: number, y: number) => x + (y - x) * a;
    const lerpAngle = (x: number, y: number) => x + Math.atan2(Math.sin(y - x), Math.cos(y - x)) * a;
    let dd = c.dist - p.dist;                       // across the start line, the short way
    const len = this.track.length;
    if (dd > len / 2) dd -= len; else if (dd < -len / 2) dd += len;
    m.x = lerp(p.x, c.x); m.z = lerp(p.z, c.z);
    m.heading = lerpAngle(p.heading, c.heading);
    m.lateral = lerp(p.lateral, c.lateral);
    m.dist = this.track.wrap(p.dist + dd * a);
    m.slip = lerp(p.slip, c.slip);
    m.alt = lerp(p.alt, c.alt);
    m.carPitch = lerp(p.carPitch, c.carPitch); m.carYaw = lerpAngle(p.carYaw, c.carYaw);
    m.weightPitch = lerp(p.weightPitch, c.weightPitch); m.weightRoll = lerp(p.weightRoll, c.weightRoll);
    m.gLoad = lerp(p.gLoad, c.gLoad); m.steer = lerp(p.steer, c.steer);
    m.time = lerp(p.time, c.time);

    this.captureOpponents(this.oppCurr);
    const op = this.oppPrev, oc = this.oppCurr;
    const blendRivals = op.length === oc.length;
    if (blendRivals) {
      this.opponents.forEach((o, i) => {
        const k = i * 5;
        // a rival that was just reset (respawn after a crash) jumps; draw it where it is
        if (Math.hypot(oc[k] - op[k], oc[k + 2] - op[k + 2]) > 25) return;
        o.obj.position.set(lerp(op[k], oc[k]), lerp(op[k + 1], oc[k + 1]), lerp(op[k + 2], oc[k + 2]));
        o.obj.rotation.y = lerpAngle(op[k + 3], oc[k + 3]);
        o.obj.rotation.z = lerp(op[k + 4], oc[k + 4]);
      });
    }

    this.applyRenderState(m);
    try {
      this.render();
    } finally {
      this.applyRenderState(c);
      if (blendRivals) {
        this.opponents.forEach((o, i) => {
          const k = i * 5;
          o.obj.position.set(oc[k], oc[k + 1], oc[k + 2]);
          o.obj.rotation.y = oc[k + 3];
          o.obj.rotation.z = oc[k + 4];
        });
      }
    }
  }

  /** A per-frame easing factor `k` tuned at 60 fps, converted to this frame's
   *  real length — so the camera settles in the same TIME at 60, 120 or 144 Hz
   *  instead of twice as fast on a fast screen. */
  private ease(k: number): number {
    return 1 - Math.pow(1 - k, this.renderDt * 60);
  }

  /**
   * The most recently COMPLETED lap, as a flat [x, z, heading, alt, …] array.
   *
   * Flat rather than an array of objects because it crosses a React state
   * boundary and gets held while the engine is torn down and rebuilt — a few
   * thousand plain numbers survive that cleanly and cost nothing to copy.
   *
   * Falls back to the lap in progress when no full one was finished, so a
   * one-lap race or a retirement still has something to show.
   */
  lastLapReplay(): number[] | null {
    const buf = this.replayLast.length > 120 ? this.replayLast : this.replayCur;
    return buf.length > 120 ? buf.slice() : null;
  }

  /** Play a recorded lap instead of racing. */
  startReplay(data: number[]): void {
    this.replayData = data;
    this.replayAt = 0;
    this.phase = "racing";      // keeps the world updating and the HUD sane
    this.paused = false;
    this.camSnap = true;
    // The rivals are BUILT but never updated while a replay runs, so they would
    // stand on the grid for the whole lap like a row of parked cars. They were
    // not in the recording; they should not be in the picture.
    for (const o of this.opponents) o.obj.visible = false;
    // Likewise the starting lights: this is not a race about to begin.
    this.countdownT = 0;
  }

  /** 0..1 through the replay, for a progress bar. */
  replayProgress(): number {
    if (!this.replayData) return 0;
    return Math.min(1, this.replayAt / Math.max(1, this.replayData.length / 4));
  }

  private replayStep(dt: number): void {
    const d = this.replayData!;
    const frames = Math.floor(d.length / 4);
    this.replayAt += dt * 60;                       // recorded at the fixed step
    if (this.replayAt >= frames - 1) {
      // Loop, so it can be watched twice without going back to the menu — and
      // SNAP the camera when it does. The wrap teleports the car a whole lap
      // backwards; without this the chase camera eases across the entire
      // circuit, which is a two-second pan over the scenery from nowhere.
      this.replayAt = 0;
      this.camSnap = true;
    }
    const i = Math.floor(this.replayAt);
    const k = i * 4;
    // Interpolate between samples so playback is smooth even when the display
    // is not running at the rate this was recorded at.
    const t = this.replayAt - i;
    const j = Math.min(frames - 1, i + 1) * 4;
    const fd = this.freeDrive;
    fd.x = d[k] + (d[j] - d[k]) * t;
    fd.z = d[k + 1] + (d[j + 1] - d[k + 1]) * t;
    // headings are angles: lerping 359 -> 1 the short way round matters
    let dh = d[j + 2] - d[k + 2];
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    fd.heading = d[k + 2] + dh * t;
    this.alt = d[k + 3] + (d[j + 3] - d[k + 3]) * t;
    // keep the projection (and therefore the camera's road floor) in step
    const pr = this.track.project(fd.x, fd.z);
    fd.dist = pr.dist;
    fd.lateral = pr.lateral;
    this.position = pr.dist;
    // wheels should turn at the speed the car is actually moving
    const vx = (d[j] - d[k]) * 60, vz = (d[j + 1] - d[k + 1]) * 60;
    this.speed = Math.hypot(vx, vz);
    // The HUD clock reads the lap as it was driven, so the replay is watchable
    // against the time on the results screen rather than sitting at 0:00.
    this.raceTime = this.replayAt / 60;
  }

  pause() {
    this.paused = true;
    this.sound.setEngine(0, false);
    this.sound.setRoad(0, 0, false, false);
  }

  resume() {
    this.paused = false;
    this.last = performance.now();
  }

  /** True while the free camera is up. The UI swaps its overlay on this. */
  photoActive(): boolean {
    return this.photo;
  }

  enterPhotoMode(): void {
    this.photo = true;
    this.paused = true;                 // freeze the world, keep rendering it
    this.sound.setEngine(0, false);
    this.sound.setRoad(0, 0, false, false);
    this.hudCanvas.style.display = "none";
    // Start from roughly where the chase camera was, so entering photo mode
    // does not teleport the view — you adjust from the shot you were in.
    this.photoOrbit.fov = this.camera.fov;
  }

  exitPhotoMode(): void {
    this.photo = false;
    this.hudCanvas.style.display = "";
    this.camera.fov = CAMERA_PRESETS[this.cameraIndex].fov;
    this.camera.updateProjectionMatrix();
  }

  /** Nudge the orbit. Called from the photo overlay's own controls. */
  photoNudge(d: { yaw?: number; pitch?: number; dist?: number; fov?: number }): void {
    const o = this.photoOrbit;
    o.yaw += d.yaw ?? 0;
    o.pitch = clamp(o.pitch + (d.pitch ?? 0), -0.25, 1.35);
    o.dist = clamp(o.dist + (d.dist ?? 0), 3.2, 46);
    o.fov = clamp(o.fov + (d.fov ?? 0), 18, 82);
  }

  /**
   * Grab the frame as a PNG data URL.
   *
   * Has to render and read in the SAME synchronous block: the drawing buffer is
   * cleared once the browser composites, and `preserveDrawingBuffer: true`
   * would cost every frame of every race for the sake of a screenshot.
   */
  capturePhoto(): string {
    this.composer.render();
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** Autoplay policy is holding audio down. See Sound.blocked. */
  audioBlocked(): boolean {
    return this.sound.blocked;
  }

  /** Called from a real user gesture, which is the only thing that works. */
  unlockAudio(): void {
    this.sound.unlock();
    this.sound.setAmbient(REALM_AMBIENCE[this.realm.id]);
    const s = loadSettings();
    this.sound.setVolumes(s.musicVolume, s.sfxVolume);
  }

  applySettings(s: Settings) {
    if (s.quality && s.quality !== this.quality) {
      this.quality = s.quality;
      // Resolution and the post chain take effect immediately. Shadow map size
      // and scenery density are baked into the built world, so those need a
      // restart — the pause menu says so rather than pretending otherwise.
      this.resize();
    }
    const post = QUALITY[this.quality].post;
    if (this.radialBlur) this.radialBlur.enabled = post;
    if (this.filmGrade) this.filmGrade.enabled = post;
    this.showFps = !!s.showFps;
    this.bloomPass.enabled = s.bloom && post;
    if (this.gtao) this.gtao.enabled = s.ao && post;
    this.sound.setVolumes(s.musicVolume, s.sfxVolume);
    this.cameraIndex = s.camera % CAMERA_PRESETS.length;
    this.camera.fov = CAMERA_PRESETS[this.cameraIndex].fov;
    this.camera.updateProjectionMatrix();
    this.camSnap = true;
  }

  private toast(text: string, color = "#e8e0ff") {
    this.toasts.unshift({ text, color, t: 2 });
    if (this.toasts.length > 4) this.toasts.length = 4;
  }

  /**
   * One counting line for a run of chips, instead of one line per chip.
   *
   * A gem run is six chips 3.5 m apart — at racing speed that is six toasts in
   * half a second, and the stack only holds four, so collecting a run reliably
   * pushed every line that actually meant something (NEAR MISS, DRIFT ZONE,
   * CHAIN BANKED) straight off the top. The score notifications were drowning
   * out the skill notifications.
   */
  private gemToast(value: number) {
    this.gemTickSum = this.gemTickT > 0 ? this.gemTickSum + value : value;
    this.gemTickT = 1.2;
    if (this.gemTick && this.toasts.includes(this.gemTick)) {
      this.gemTick.text = `+${this.gemTickSum}`;
      this.gemTick.t = 2;               // keep it alive while the run continues
      return;
    }
    this.gemTick = { text: `+${this.gemTickSum}`, color: "#67e8f9", t: 2 };
    this.toasts.unshift(this.gemTick);
    if (this.toasts.length > 4) this.toasts.length = 4;
  }

  /** Register a mech kill: bump the combo, return the score multiplier and shout
   *  about it once the chain is worth shouting about. */
  private mechCombo(): number {
    this.combo++;
    this.comboT = 4.2;                       // keep the chain alive between targets
    const mult = Math.min(5, 1 + Math.floor(this.combo / 3)); // x1 .. x5
    if (this.combo >= 3 && this.combo % 3 === 0) {
      this.announce(`${mult}x RAMPAGE`, `${this.combo} IN A ROW`, "#f0abfc", 1.2);
      this.shake = Math.max(this.shake, 0.5);
    }
    return mult;
  }

  /**
  /**
  /**
   * Which side of the road is the OUTSIDE of the bend between two distances.
   *
   * MEASURED, not derived from the sign of the curvature: the outside is simply
   * the side whose offset path through the corner is longer, which is true
   * whatever sign convention `pointAt` happens to use. This codebase has
   * already been bitten once by a lateral sign mismatch that silently mirrored
   * every placement on the circuit, and this returns the right answer even if
   * that convention flips again.
   *
   * @returns +1 or -1, in the lateral units `addEntity` takes.
   */
  private outsideSign(from: number, to: number): number {
    const off = ROAD_HALF_WIDTH * 0.7;
    const walk = (side: number) => {
      let sum = 0;
      let prev = this.track.pointAt(this.track.wrap(from), side * off);
      for (let d = from + 6; d <= to; d += 6) {
        const p = this.track.pointAt(this.track.wrap(d), side * off);
        sum += prev.distanceTo(p);
        prev = p;
      }
      return sum;
    };
    return walk(1) >= walk(-1) ? 1 : -1;
  }

  /** A lap ended: keep it if it beat the stored one, then start recording again. */
  /** Current multiplier: x1 at the start, +1 every two links, capped at x6. */
  private get chainMult(): number {
    return Math.min(6, 1 + Math.floor(this.chainLinks / 2));
  }

  /**
   * Add a link. `base` is the points this act is worth before the multiplier.
   *
   * Deliberately does NOT add to `score` — that happens in bankChain(). The
   * whole tension is that these points are not yours yet.
   */
  private addChain(label: string, base: number): void {
    this.chainLinks++;
    const mult = this.chainMult;
    this.chainPending += Math.round(base * mult);
    this.chainT = 3.6;
    if (this.chainLinks > this.chainBest) this.chainBest = this.chainLinks;
    this.toast(`${label} x${mult}`, "#67e8f9");
    if (this.chainLinks === 4) this.announce("CHAIN x3", "KEEP IT ALIVE", "#67e8f9", 1.0);
    else if (this.chainLinks === 8) this.announce("CHAIN x5", "DO NOT TOUCH ANYTHING", "#fbbf24", 1.2);
  }

  /** Timer lapsed cleanly: the pending pot is yours. */
  private bankChain(): void {
    if (this.chainPending <= 0) { this.chainLinks = 0; return; }
    const won = this.chainPending;
    const links = this.chainLinks;
    this.score += won;
    this.chainPending = 0;
    this.chainLinks = 0;
    this.sound.play("gem");
    this.toast(`CHAIN BANKED +${won}`, "#a7f3d0");
    if (links >= 4) this.announce("BANKED", `${links} LINKS · +${won}`, "#a7f3d0", 1.0);
  }

  /** Crashed, spun, or left the road: lose the lot. */
  private breakChain(): void {
    if (this.chainPending <= 0 && this.chainLinks === 0) return;
    const lost = this.chainPending;
    this.chainPending = 0;
    this.chainLinks = 0;
    this.chainT = 0;
    if (lost > 0) {
      this.sound.play("powerDown");
      this.toast(`CHAIN LOST -${lost}`, "#f87171");
    }
  }

  /** Fire a big centre-screen callout (overtake, final lap, …). Overwrites any
   *  current one so the freshest drama always shows. */
  private announce(text: string, sub: string, color: string, life = 1.5) {
    this.callout = { text, sub, color, t: life, life };
  }

  /** Detect the player gaining/losing a place and fire an overtake callout.
   *  Skips the opening grid shuffle and debounces rapid swaps. */
  private trackOvertakes(dt: number) {
    this.overtakeCd = Math.max(0, this.overtakeCd - dt);
    if (!this.opponents.length) return;
    const p = this.computePosition();
    // seed on the first couple of seconds without firing (grid still sorting)
    if (this.lastPosition === 0 || this.raceTime < 2.5) { this.lastPosition = p; return; }
    if (p !== this.lastPosition && this.overtakeCd <= 0) {
      const ord = (n: number) => ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH", "7TH", "8TH", "9TH"][n - 1] ?? `${n}TH`;
      if (p < this.lastPosition) {
        this.announce("OVERTAKE!", p === 1 ? "TAKING THE LEAD" : `UP TO ${ord(p)}`, p === 1 ? "#fbbf24" : "#a7f3d0");
        this.addChain("OVERTAKE", 120);
        this.sound.play("lane");
      } else {
        this.announce("PASSED", `DOWN TO ${ord(p)}`, "#f87171");
        this.sound.play("bump");
      }
      this.overtakeCd = 0.7;
    }
    this.lastPosition = p;
  }

  private effectiveMaxSpeed() {
    let max = MAX_SPEED * this.carStat.speed;
    if (this.transformed) max *= TRANSFORM_SPEED_FACTOR;
    if (this.nitroT > 0) max *= NITRO_SPEED_FACTOR;
    if (this.driftBoostT > 0) max *= DRIFT_BOOST_FACTOR;
    if (this.boostT > 0) max *= ITEM_BOOST_FACTOR;
    max *= 1 + this.tow * TOW_GAIN;
    return max;
  }

  private endDrift() {
    if (this.driftCharge > DRIFT_MIN_CHARGE) {
      const charge = Math.min(this.driftCharge, 2.5);
      this.driftBoostT = 0.4 + charge * 0.35;
      this.sound.play("nitro");
      // A long slide is worth more than a flick, so the base scales with how
      // much charge was actually built rather than paying a flat rate.
      this.addChain("DRIFT", Math.round(60 + charge * 80));
    }
    this.drifting = false;
    this.driftCharge = 0;
  }

  /** Snap the car back onto the centre of the track at its current progress,
   *  facing down-course, after it's roamed off the terrain too long. No penalty. */
  private respawnOnTrack() {
    this.breakChain();          // off the road is the clearest possible fumble
    this.freeDrive.reset(this.track, this.offTrackExitDist); // back where you left, not wherever you wandered to
    this.alt = 0; this.vAlt = 0; this.spin = 0; this.flip = 0; this.spinRate = 0;
    this.carPitch = 0; this.stuntAir = false;
    this.offTrackT = 0;
    this.camSnap = true;             // re-anchor the camera at the new spot
    this.crashFlash = 0.3;
    this.sound.play("oob");
    this.toast("BACK ON TRACK", "#67e8f9");
  }

  private playerProgress() {
    return (this.lap - 1) * this.track.length + this.position;
  }

  private computePosition() {
    if (this.opponents.length === 0) return 1;
    const mine = this.playerProgress();
    let ahead = 0;
    for (const o of this.opponents) {
      if (o.progress(this.track.length) > mine) ahead++;
    }
    return ahead + 1;
  }

  private computeStandings(): RaceStanding[] {
    const len = this.track.length;
    const racers = [
      { name: "YOU", isPlayer: true, finishOrder: this.playerFinishOrder, progress: this.playerProgress() },
      ...this.opponents.map((o) => ({ name: o.name, isPlayer: false, finishOrder: o.finishOrder, progress: o.progress(len) })),
    ];
    // Racers who actually crossed the line rank by the order they crossed (a
    // finished car freezes its distance at the seam, so progress alone ties them
    // all — the finish sequence is the real result). Anyone still on track ranks
    // after every finisher, by how far they've travelled.
    racers.sort((a, b) => {
      const aF = a.finishOrder > 0, bF = b.finishOrder > 0;
      if (aF && bF) return a.finishOrder - b.finishOrder;
      if (aF !== bF) return aF ? -1 : 1;
      return b.progress - a.progress;
    });
    return racers.map((r, i) => ({ name: r.name, isPlayer: r.isPlayer, position: i + 1 }));
  }

  private update(dt: number) {
    // REPLAY takes the update over completely: the car is placed from the
    // recording instead of being driven, and nothing else in the simulation
    // runs. Stepping the physics from recorded positions would fight the
    // recording (the wheels would be turning against a body that is being
    // teleported), and the rivals have no business racing a lap that is
    // already over.
    if (this.replayData) {
      this.replayStep(dt);
      return;
    }

    // Drift the cloud deck. A full revolution takes ~12 minutes, which at the
    // dome radius is a few metres a second of apparent motion — enough that the
    // sky is alive when you look at it, slow enough that it never pulls the eye
    // off the road.
    if (this.clouds) this.clouds.rotation.y += 0.0085 * dt;

    // G-LOAD from the road's vertical shape. Scaled by speed squared, because
    // that is what it is: a crest taken slowly is a view, and taken fast it
    // unloads the car. Smoothed hard — the raw curvature steps between track
    // samples, and a step here would read as a pothole.
    {
      const v = this.speed / MAX_SPEED;
      const k = this.track.verticalCurvature(this.position) * 1150 * v * v;
      this.gLoad += (clamp(k, -1.6, 1.6) - this.gLoad) * Math.min(1, dt * 5.5);
    }
    // Drift the analytic cloud deck. Slow enough that it never pulls the eye
    // off the road, fast enough that the sky is alive if you look at it.
    if (this.skyMat) this.skyMat.uniforms.uTime.value += dt;

    this.time += dt;
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter((t) => t.t > 0);
    if (this.callout) { this.callout.t -= dt; if (this.callout.t <= 0) this.callout = null; }
    this.crashFlash = Math.max(0, this.crashFlash - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    // The style chain banks on a clean lapse — see addChain/bankChain.
    if (this.gemTickT > 0) this.gemTickT -= dt;
    if (this.chainT > 0) { this.chainT -= dt; if (this.chainT <= 0) this.bankChain(); }
    this.nearMissCd = Math.max(0, this.nearMissCd - dt);
    this.slashCooldown = Math.max(0, this.slashCooldown - dt);
    this.bumpCd = Math.max(0, this.bumpCd - dt);
    this.slotFullCd = Math.max(0, this.slotFullCd - dt);

    if (this.input.cameraCycle) {
      this.cameraIndex = (this.cameraIndex + 1) % CAMERA_PRESETS.length;
      this.camera.fov = CAMERA_PRESETS[this.cameraIndex].fov;
      this.camera.updateProjectionMatrix();
      this.camSnap = true;
    }
    if (this.input.muteToggle) this.sound.toggleMute();

    if (this.phase === "loading") return;

    if (this.phase === "countdown") {
      const n = Math.ceil(this.countdownT - 0.5);
      if (n !== this.lastBeep) {
        this.lastBeep = n;
        this.sound.play(n > 0 ? "beep" : "go");
      }
      this.sound.setEngine(0.05, false, 0);
      this.sound.setRoad(0, 0, false, false);
      this.countdownT -= dt;
      if (this.countdownT <= 0) this.phase = "racing";
      return;
    }

    if (this.phase === "racing") this.updateOpponents(dt);

    if (this.phase === "finished") {
      this.speed = Math.max(0, this.speed + DECEL * dt);
      this.position = this.track.wrap(this.position + this.speed * dt);
      this.sound.setEngine(this.speed / MAX_SPEED, false, 0);
      this.sound.setRoad(this.speed / MAX_SPEED, 0, false, false);
      this.updateOpponents(dt);
      this.finishT -= dt;
      if (this.finishT <= 0 && !this.finished) {
        this.finished = true;
        this.onFinish({
          mode: this.mode,
          realm: this.realm.id,
          score: Math.max(0, Math.round(this.score)),
          gems: this.gems,
          stunts: this.stunts,
          laneBonuses: this.laneBonuses,
          penalties: this.penalties,
          timeMs: Math.round(this.raceTime * 1000),
          position: this.finalPosition,
          totalRacers: this.opponents.length + 1,
          // Distance actually driven, for career progress. `playerProgress` is
          // laps x length + position, which is the same number the ranking
          // uses — so a retired or endless run reports what it really covered
          // rather than a lap count it never completed.
          distanceM: Math.max(0, Math.round(this.playerProgress())),
          standings: this.finalStandings,
          // The lap itself, so the results screen has something to offer.
          // Handed over here because `stop()` runs moments later and takes the
          // whole engine with it.
          replay: this.lastLapReplay() ?? undefined,
        });
      }
      return;
    }

    this.raceTime += dt;
    this.trackOvertakes(dt);
    // weather turns over every ~25-45 s so a long race visibly changes mood
    this.weatherT -= dt;
    if (this.weatherT <= 0) { this.rollWeather(); this.weatherT = 25 + Math.random() * 20; }
    this.updateSurface(dt);
    const speedPercent = Math.min(this.speed / MAX_SPEED, 1);
    const airborne = this.alt > 0.15;
    this.shake = Math.max(0, this.shake - dt * 2.2);

    // analog steering with inertia (weight): the "wheel" eases to the input and
    // re-centers when released — no instant snap.
    const rawSteer = this.input.left ? -1 : this.input.right ? 1 : 0;
    const steerRate = rawSteer === 0 ? STEER_RETURN : STEER_RESPONSE;
    this.steerInput += (rawSteer - this.steerInput) * Math.min(1, dt * steerRate);
    if (Math.abs(this.steerInput) < 0.003) this.steerInput = 0;
    this.steer = this.steerInput;

    this.driftBoostT = Math.max(0, this.driftBoostT - dt);

    // FREE-ROAM: the car is a real world-space body. freedrive owns heading +
    // velocity + grip + the walls that keep you on the ribbon; we then project
    // onto the track to derive the (distance, lateral) the rest of the engine
    // reads (entities, laps, HUD, minimap). In the air, steering barrel-rolls
    // instead of turning; the transformed mech just adds vertical lift on top.
    const boosting = this.nitroT > 0 || this.driftBoostT > 0 || this.boostT > 0;
    const driveAccel = ACCEL * this.carStat.accel * (boosting ? 2 : 1) * (this.transformed ? 1.5 : 1);
    const handbrake = this.input.brake && this.speed > MAX_SPEED * 0.3 && rawSteer !== 0;
    // the mech only gets free flight while off the ground
    const flyingMech = this.transformed && this.alt > 1.2;
    this.freeDrive.step(
      {
        throttle: this.input.accelerate || this.transformed,
        brake: this.input.brake && !this.transformed,
        steer: -this.steerInput * (this.stuntAir ? 0.4 : 1), // -steer so Right turns right; reduced authority in the air so you can aim the landing without barrel-rolling
        handbrake,
      },
      dt, this.track,
      {
        maxSpeed: this.effectiveMaxSpeed(), accel: driveAccel, turnRate: FREE_TURN_RATE,
        // Weight over the axles changes with the road. In a compression the car
        // is pressed in and finds grip; over a crest it goes light and the back
        // steps out. Clamped tight — this is meant to be felt, not to become a
        // second handbrake.
        // …and so does the weather. Rain and snow take traction away without
        // touching top speed, so the straights are unchanged and every corner
        // becomes a decision. See WEATHER_GRIP.
        grip: FREE_GRIP * clamp(1 + this.gLoad * 0.22, 0.72, 1.28) * this.gripMul,
        // Corners now COST speed above the tyres' limit — see the scrub in
        // freedrive. Scaled by the car's grip stat and by the weather, so a
        // better-handling kart carries more through a bend and a wet road
        // takes it away, which is what those numbers were always supposed to
        // mean and never did.
        cornerGrip: CORNER_GRIP * this.carStat.grip * this.gripMul,
        // Free flight only while the mech is ACTUALLY AIRBORNE. Gating these on
        // `transformed` alone meant that the instant you grabbed an orb you lost
        // the walls, the steering assist AND the off-track respawn all at once —
        // so the mech quietly sailed off the map with no way back (measured 1.15 km
        // off the centreline). On the ground the mech drives like a car.
        contain: !flyingMech,
        // The grounded mech runs ~11% faster than a car (measured 64.6 vs ~55 m/s),
        // so corners arrive sooner and the car-tuned assist under-corrects — it was
        // off-road 27% of the time vs 9% on wheels. Scale the help with the form.
        // AIR CORRECTION. This used to be a hard 0 while airborne, which is the
        // real reason ramps threw you off the road: the car keeps its world
        // velocity, so on any bend the road curves away underneath you and you
        // land in the scenery with no way to influence it. Asphalt gives you air
        // control for exactly this. A strong pull in the air aims the landing
        // back down the road; on the ground it's the normal assist.
        assist: flyingMech ? 0
          : this.stuntAir ? FREE_STEER_ASSIST * 1.25
          : FREE_STEER_ASSIST * (this.transformed ? 1.4 : 1),
      },
    );
    this.resolveObstacles(dt); // keep the car OUT of solid scenery (trees/rocks/buildings)
    // derive the rail-space coordinates every other system still reads
    this.position = this.freeDrive.dist;
    this.playerX = clamp(this.freeDrive.lateral / (ROAD_HALF_WIDTH * 0.9), -3, 3);
    this.speed = Math.abs(this.freeDrive.speed);
    this.slipping = this.freeDrive.onWall;

    // handbrake slide builds a drift-boost charge, like before
    if (this.freeDrive.drifting) {
      if (!this.drifting) { this.drifting = true; this.driftCharge = 0; }
      this.driftCharge += dt;
    } else if (this.drifting) {
      this.endDrift();
    }

    // visual body yaw: lean into the slip + steer on the ground; barrel-roll in air
    if (this.stuntAir) {
      // in the air the car stays level and just arcs (carPitch handles the nose
      // from vertical velocity) — NO involuntary barrel-rolls that land you flipped
      this.carYaw += (0 - this.carYaw) * Math.min(1, dt * 6);
    } else {
      const yawTarget = clamp(this.freeDrive.slip * 0.05, -0.45, 0.45) + this.steer * 0.08;
      this.carYaw += (yawTarget - this.carYaw) * Math.min(1, dt * 8);
    }

    // nitro
    this.nitroT = Math.max(0, this.nitroT - dt);
    // Nitro trickles back on its own, so the meter is always doing something
    // and you're never stranded with an empty bar between pickups. Slow enough
    // (~14 s a charge) that collecting cans is still clearly the fast route.
    if (this.nitroCharges < NITRO_MAX_CHARGES) {
      this.nitroFill += dt / 14;
      while (this.nitroFill >= 1 && this.nitroCharges < NITRO_MAX_CHARGES) {
        this.nitroFill -= 1;
        this.nitroCharges++;
      }
    } else {
      this.nitroFill = 0;
    }
    if (this.input.nitroPressed && this.nitroCharges > 0 && this.nitroT <= 0) {
      this.nitroCharges--;
      this.nitroT = NITRO_DURATION;
      this.sound.play("nitro");
      this.toast("NITRO!", "#fb923c");
    }

    // power-ups
    this.boostT = Math.max(0, this.boostT - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    if (this.input.usePressed && this.heldItems.length) this.useItem();
    this.updateProjectiles(dt);

    // transform timer
    if (this.transformed) {
      this.transformT -= dt;
      if (this.transformT <= 0) {
        this.transformed = false;
        this.sound.play("powerDown");
        this.toast("POWER DOWN", "#8b85a8");
      }
    }

    // --- ramp ride-up ---------------------------------------------------------
    // Drive UP a ramp's face (altitude tracks how far along it you are), then
    // launch off the lip into an arc — instead of popping straight up on contact.
    // Only fires when you're actually in the ramp's lane; clip it half-on and you
    // get a partial pop, not a clean launch (hit it sideways at your peril).
    let onRamp: (typeof this.ramps)[number] | null = null;
    let rampT = 0;
    if (!this.transformed) {
      const trackLen = this.track.length;
      for (const r of this.ramps) {
        if (r.road !== this.freeDrive.onBranchIdx) continue;   // different road
        let gap = this.position - r.dist;
        if (gap > trackLen / 2) gap -= trackLen;
        else if (gap < -trackLen / 2) gap += trackLen;
        if (gap < -r.len / 2 || gap > r.len / 2) continue; // not on this ramp lengthwise
        // Forgiving one-lane band: anywhere over the ramp (plus a little margin)
        // gives a clean ride-up. Adjacent lanes sit ~0.67 away so they stay clear.
        // No side-shove, no crash — miss the lane and you simply drive past it.
        if (Math.abs(this.playerX - r.lane) < 0.46) {
          onRamp = r;
          rampT = (gap + r.len / 2) / r.len; // 0 at the base → 1 at the lip
          break;
        }
      }
    }

    // altitude
    if (onRamp) {
      // riding up the face: altitude is driven by your position along the ramp
      const peak = onRamp.height * onRamp.power;
      this.alt = Math.max(this.alt, peak * rampT);
      this.vAlt = 0;
      this.stuntAir = true;
      this.lastRampPower = onRamp.power;
      this.lastRampTwist = onRamp.twist;
      this.lastRampT = rampT;
      if (!this.wasOnRamp) {
        this.wasOnRamp = true;
        this.sound.play("jump");
      }
    } else {
      if (this.wasOnRamp) {
        this.wasOnRamp = false;
        if (this.lastRampT > 0.4) {
          // rolled off the lip → arc through the air (gentle, capped by MAX_ALT)
          this.vAlt = RAMP_LAUNCH * this.lastRampPower * clamp(speedPercent, 0.4, 1);
          this.spin = 0;
          // Twist ramps corkscrew you (Asphalt-style). The roll is imparted here
          // rather than by steering, so it's a reliable trick you get for taking
          // the ramp — not something you have to fight the controls for. It's
          // snapped back to level on touchdown so you never land on your roof.
          this.spinRate = this.lastRampTwist ? 1.25 : 0;
          this.playerVX = 0;
          // kill side-slip on take-off so the jump flies STRAIGHT down the car's
          // heading and lands predictably ahead — never carries a sideways drift
          // into the wall (you can still aim mildly with the air steering)
          const F = { x: Math.sin(this.freeDrive.heading), z: Math.cos(this.freeDrive.heading) };
          const vf = this.freeDrive.vx * F.x + this.freeDrive.vz * F.z;
          this.freeDrive.vx = F.x * vf;
          this.freeDrive.vz = F.z * vf;
          this.toast(this.lastRampPower > 1.3 ? "MEGA JUMP!" : "JUMP!", "#c084fc");
        }
        // dropped off before the lip → just settle back down, no crash or tumble
      }
      if (this.transformed && this.input.fly) {
        this.vAlt = Math.min(this.vAlt + FLY_LIFT * dt, 9);
      } else if (this.alt > 0) {
        this.vAlt -= GRAVITY * dt;
      }
      this.alt += this.vAlt * dt;
      if (this.spinRate !== 0 && this.alt > 0) this.spin += this.spinRate * dt;
    }
    if (this.alt >= MAX_ALT) {
      this.alt = MAX_ALT;
      this.vAlt = Math.min(this.vAlt, 0);
    }
    if (this.alt <= 0) {
      this.alt = 0;
      const impact = Math.max(0, -this.vAlt); // downward speed at touchdown
      this.vAlt = 0;
      if (this.stuntAir) this.land();
      this.spinRate = 0;
      if (impact > 0.5) this.susp = Math.min(0.42, this.susp + impact * 0.045); // compress the springs
    }

    // on the ground, any residual barrel-roll / flip eases back to level, so the
    // car can never get stuck rolled onto its side and clipping through the road
    if (this.alt < 0.15 && !this.stuntAir) {
      this.spin -= this.spin * Math.min(1, dt * 14);
      this.flip -= this.flip * Math.min(1, dt * 14);
      if (Math.abs(this.spin) < 0.01) this.spin = 0;
      if (Math.abs(this.flip) < 0.01) this.flip = 0;
    }

    // nose pitch (negative = nose up): angle UP a ramp face, arc in the air (up
    // while rising, down while falling), and follow the road's slope on the
    // ground — so the car rides surfaces instead of floating flat through them.
    let pitchTarget: number;
    if (onRamp) {
      pitchTarget = -Math.atan2(onRamp.height * onRamp.power, onRamp.len);
    } else if (this.alt > 0.25) {
      pitchTarget = clamp(-this.vAlt * 0.045, -0.7, 0.55);
    } else {
      const latM = this.playerX * ROAD_HALF_WIDTH * 0.9;
      const a = this.pathPoint(3.5, latM), b = this.pathPoint(-3.5, latM);
      const h = Math.hypot(a.x - b.x, a.z - b.z) || 7;
      pitchTarget = -Math.atan2(a.y - b.y, h);
    }
    this.carPitch += (pitchTarget - this.carPitch) * Math.min(1, dt * 10);

    // WEIGHT TRANSFER — the body leans into corners and dives/squats under the
    // brake/throttle, so the car reads as a heavy machine instead of a floaty box
    const spdF = Math.min(this.speed / MAX_SPEED, 1);
    const rollTarget = -this.steer * (0.11 + spdF * 0.22);                 // lean into the turn, more at speed
    const braking = this.input.brake && !this.transformed && this.speed > 2;
    const throttling = this.input.accelerate && !braking;
    const pitchW = ((braking ? 1 : 0) - (throttling ? 0.45 : 0)) * 0.07 * (0.35 + spdF); // + = nose dives
    this.weightRoll += (rollTarget - this.weightRoll) * Math.min(1, dt * 9);
    this.weightPitch += (pitchW - this.weightPitch) * Math.min(1, dt * 8);

    // ENV HIT: clip the edge post row (~7m off-centre) and you just throw a
    // shower of orange sparks — cosmetic only, no deflection, no jolt (the car
    // keeps driving; you're free to cut across the terrain).
    this.postHitCd = Math.max(0, this.postHitCd - dt);
    const latAbs = Math.abs(this.freeDrive.lateral);
    if (latAbs > 6.3 && latAbs < 7.7 && this.speed > 8 && !this.transformed && this.postHitCd <= 0) {
      const pp = this.playerRoot.position;
      this.spawnSparks(pp.x, pp.y + 0.4, pp.z, 10);
      this.sound.play("bump");
      this.postHitCd = 0.2;                 // ~one shower per post as you scrape along
    }

    // OFF-TRACK GRACE (no walls, no penalty): you can cut across the terrain for
    // a few seconds. Stray off the ribbon and a countdown starts; get back on
    // before it expires and nothing happens — ignore it and you respawn on the
    // track. Never any score penalty.
    // The soft walls now hold the car within ~6.6 m of centre, so this respawn is
    // only a failsafe for the rare case something knocks it clean past the wall.
    const offTrack = !(this.transformed && this.alt > 1.2) && Math.abs(this.freeDrive.lateral) > ROAD_HALF_WIDTH + 3;
    if (offTrack && this.phase === "racing") {
      if (this.offTrackT <= 0) {
        this.offTrackT = OFFTRACK_GRACE;          // just left the ribbon
        this.offTrackExitDist = this.freeDrive.dist; // remember WHERE, so respawn returns here
      }
      this.offTrackT -= dt;
      if (this.offTrackT <= 0) this.respawnOnTrack();
    } else if (this.offTrackT !== 0) {
      this.offTrackT = 0; // back on the road (or race over) — clear the warning
    }

    // Lane discipline bonus. This used to be suppressed inside a drift zone,
    // which asked for a slide across the whole road while the lane bonus paid
    // for holding one lane arrow-straight — whichever a player chased, the
    // other told them they had got it wrong. Apexes replaced the zones and do
    // not have that problem: clipping one IS a lane, briefly, so the two now
    // want the same thing and the suppression is gone.
    if (!airborne && this.onMainRoad && Math.abs(this.playerX) <= 1 && speedPercent > 0.3) {
      const laneIdx = this.playerX < -1 / 3 ? 0 : this.playerX > 1 / 3 ? 2 : 1;
      if (laneIdx === this.lastLane) {
        this.laneT += dt;
        if (this.laneT >= LANE_BONUS_SECONDS) {
          this.laneT = 0;
          this.score += SCORE_LANE_BONUS;
          this.laneBonuses++;
          this.sound.play("lane");
          this.toast(`CLEAN LANE +${SCORE_LANE_BONUS}`, "#a7f3d0");
        }
      } else {
        this.lastLane = laneIdx;
        this.laneT = 0;
      }
    } else {
      this.laneT = 0;
    }

    // main-track entities/monsters don't exist on a branch — skip them while on one
    if (!this.onBranch) this.collide(speedPercent);
    if (this.cfg.monsters) {
      this.updateMonsters(dt);
      if (!this.onBranch) this.collideMonsters();
    }
    // load = how hard you're actually on the power, so the note changes between
    // driving, coasting and braking rather than tracking speed alone
    this.sound.setEngine(this.speed / MAX_SPEED, this.nitroT > 0,
      throttling ? 1 : braking ? 0 : 0.22);
    // wind, tarmac and tyres — what the car is doing to the world around it
    this.sound.setRoad(this.speed / MAX_SPEED, this.freeDrive.slip,
      this.alt > 0.35, this.freeDrive.offRoad);
    // lift the music with speed + nitro so the track drives harder when flat out
    // In NEON RUN the music should stay ambient and hypnotic however fast you go
    // — ramping it with speed is exactly the tension the mode is meant to avoid.
    this.sound.setMusicIntensity(this.cfg.endless
      ? 0.26 + (this.speed / MAX_SPEED) * 0.16
      : 0.32 + (this.speed / MAX_SPEED) * 0.55 + (this.nitroT > 0 ? 0.18 : 0));

    // Sample the path for the replay. After the drive step, so what is stored
    // is where the car ENDED this frame — the same state render() is about to
    // draw, so a replay and a live lap put the car in identical places.
    if (this.phase === "racing") {
      this.replayCur.push(this.freeDrive.x, this.freeDrive.z, this.freeDrive.heading, this.alt);
    }

    // advance & laps — `position` is the free-roam projection onto the track;
    // detect a forward crossing of the start/finish seam (guard jitter/reverse)
    const len = this.track.length;
    let delta = this.position - this.lastFreeDist;
    if (delta > len / 2) delta -= len;        // wrapped backward across the seam
    else if (delta < -len / 2) delta += len;  // wrapped forward across the seam
    this.lastFreeDist = this.position;
    if (this.phase === "racing") {
      this.lapProgress += delta;

      if (this.lapProgress >= len) {
        this.lapProgress -= len;
        // A lap just completed: keep it, and start collecting the next one.
        if (this.replayCur.length > 120) this.replayLast = this.replayCur;
        this.replayCur = [];
        this.lap++;
        if (this.lap > this.cfg.laps) {
          this.phase = "finished";
          this.finishT = 2.5;
          // stamp the player into the finish sequence, then snapshot the order at
          // the line so the results screen reflects who actually crossed first
          this.playerFinishOrder = ++this.finishSeq;
          this.finalStandings = this.computeStandings();
          this.finalPosition = this.finalStandings.find((s) => s.isPlayer)?.position ?? 1;
          this.score += SCORE_FINISH;
          this.sound.play("finish");
          this.toast(`FINISH +${SCORE_FINISH}`, "#fbbf24");
        } else {
          this.sound.play("lap");
          this.toast(`LAP ${this.lap}/${this.cfg.laps}`, "#c084fc");
          if (this.lap === this.cfg.laps && this.cfg.laps > 1) this.announce("FINAL LAP", "LEAVE IT ALL OUT THERE", "#fbbf24", 2);
          this.clearProjectiles();
          for (const e of this.entities) {
            if (e.collectedLap !== 0 && e.collectedLap !== this.lap) {
              e.collectedLap = 0;
              e.obj.visible = true;
            }
          }
        }
      }
    }

    // wheels, weight transfer and tyre smoke
    this.animateCar(dt);
  }

  /**
   * How much tow a rival is getting from whatever is directly in front of it —
   * another rival, or the player.
   *
   * The player's own tow is eased over time because it is a thing you feel
   * building; a rival's is computed fresh each frame and applied to its target
   * speed, which the AI already eases toward at its own rate. Cheap enough not
   * to care: nine rivals is at most 90 gap checks a frame, and it only looks at
   * the car it is closest behind rather than summing a queue.
   */
  private rivalTow(self: Opponent, len: number): number {
    if (self.finished || self.stunnedT > 0) return 0;
    const signed = (aheadOf: number) => {
      let d = aheadOf - self.dist;
      if (d > len / 2) d -= len;
      else if (d < -len / 2) d += len;
      return d;
    };
    let best = 0;
    const consider = (d: number, lane: number) => {
      if (d <= 4 || d >= 30) return;
      // Both laterals in METRES. `lane` is in ROAD_HALF_WIDTH*0.9 units for a
      // rival (that is what ai.place() uses) and the player's is already metres.
      const dl = Math.abs(self.lane * ROAD_HALF_WIDTH * 0.9 - lane);
      if (dl >= TOW_WIDTH) return;
      const t = (1 - (d - 4) / 26) * (1 - dl / TOW_WIDTH);
      if (t > best) best = t;
    };
    for (const o of this.opponents) {
      if (o === self || o.finished) continue;
      consider(signed(o.dist), o.lane * ROAD_HALF_WIDTH * 0.9);
    }
    // …and off the player, but only while the player is on the same road.
    if (this.phase === "racing" && this.alt < 1.2 && this.onMainRoad) {
      consider(signed(this.position), this.freeDrive.lateral);
    }
    return best;
  }

  private updateOpponents(dt: number) {
    const mine = this.playerProgress();
    const len = this.track.length;
    this.takedownCd = Math.max(0, this.takedownCd - dt);
    let towTarget = 0;
    for (const o of this.opponents) {
      const gap = mine - o.progress(len); // + means player ahead

      // NEAR MISS — threading a gap without touching it.
      //
      // The link that makes the chain about nerve rather than luck: drifts and
      // ramps are things the track offers you, but a near miss is something
      // you choose at the exact moment you could instead have lifted. Wants
      // real speed, real proximity, and NO contact — the bump handler breaks
      // the chain, so brushing a rival costs you the pot you were building.
      if (this.nearMissCd <= 0 && this.speed > MAX_SPEED * 0.45 && this.onMainRoad) {
        const dd = Math.abs(this.track.wrap(this.position - o.dist + len / 2) - len / 2);
        const dl = Math.abs(this.freeDrive.lateral - o.lane * ROAD_HALF_WIDTH);
        if (dd < 4.5 && dl > 1.5 && dl < 3.2) {
          this.addChain("NEAR MISS", 90);
          this.nearMissCd = 1.2;      // one per pass, not one per frame
        }
      }
      // each racer holds its own pace so the field strings out; only a gentle
      // rubber-band keeps it competitive around the player
      // rubber-band: rivals dig in HARD when you pull away (up to +26%) and ease
      // off only slightly when they're ahead — keeps the race close and tense
      // rubber-band: rivals ease off HARD when they're ahead (up to -30%, so you
      // can catch a runaway leader) and only dig in a little when you pull away
      // Gentle elastic only. The old -0.30 made a leading rival visibly brake to
      // wait for you (and +0.16 made a trailing one reel you in on a straight) —
      // the clearest "they're fake" tell. Now the field mostly races its own pace.
      // The rivals' base used to be raw MAX_SPEED while YOU cruise at
      // MAX_SPEED * your kart's speed stat — on a 5-star kart that's ~15% more,
      // permanently, which is how you ended up nearly lapping the field. Base
      // them on the same cruise speed you actually have, and widen the catch-up
      // so a gap is closable rather than terminal.
      const cruise = MAX_SPEED * this.carStat.speed;
      const base = cruise * o.pace * (1 + clamp(gap / 300, -0.10, 0.20));
      o.update(dt, this.track, base, this.cfg.laps, this.gripMul, this.rivalTow(o, len));
      // stamp the true finishing order the instant a rival crosses the final line
      if (o.finished && o.finishOrder === 0) o.finishOrder = ++this.finishSeq;

      // spin the rival's wheels by its ground speed (keeps the pack alive)
      const ow = o.obj.userData.wheels as WheelRef[] | undefined;
      if (ow && ow.length) {
        const wd = ((o.obj.userData.wheelDist as number) || 0) + o.speed * dt;
        o.obj.userData.wheelDist = wd;
        for (const ww of ow) ww.obj.rotation.x = wd / ww.r;
      }

      // hop ramps (full-width, so any lane) when reaching one on the ground
      if (o.alt < 0.4 && !o.finished) {
        for (const r of this.ramps) {
          let g = ((r.dist - o.dist) % len + len) % len;
          if (g > len / 2) g -= len;
          if (Math.abs(g) < 4.5) { o.hop(r.power); break; }
        }
      }

      // --- PHYSICAL car-to-car contact with the player (Asphalt-style) --------
      // Cars shove each other with real momentum: ram a rival hard from behind or
      // side-slam them and they SPIN OUT (takedown) while you punch through; get
      // rammed and you're shoved + shaken. No more ghosting through with a tap.
      let d = o.dist - this.position;        // + = rival ahead of the player
      if (d > len / 2) d -= len;
      if (d < -len / 2) d += len;

      // SLIPSTREAM — the hole in the air behind the car in front.
      //
      // Without it, following a rival is strictly worse than being alone: you
      // are the same speed, in their spoiled air, with nowhere to go. That is
      // why the pack used to string out and stay strung out. A tow makes the
      // gap behind a rival somewhere you WANT to be for a few seconds, and
      // turns every straight into a decision about when to pull out — which is
      // the whole texture of real wheel-to-wheel racing, for about forty lines.
      if (!o.finished && d > 4 && d < 30 && this.alt < 1.2 && this.speed > MAX_SPEED * 0.42
          && this.onMainRoad) {
        const dl = Math.abs(this.freeDrive.lateral - o.lane * ROAD_HALF_WIDTH);
        if (dl < TOW_WIDTH) {
          // Strongest right behind the gearbox, gone by 30 m, and only if you
          // are actually lined up — tucking in is a skill, not a proximity check.
          const near = 1 - (d - 4) / 26;
          towTarget = Math.max(towTarget, near * (1 - dl / TOW_WIDTH));
        }
      }

      const laneGap = this.playerX - o.lane;
      if (Math.abs(d) < 4.2 && Math.abs(laneGap) < 0.62 && this.phase === "racing" && !o.finished
          && this.onMainRoad) {
        const dir = laneGap >= 0 ? 1 : -1;   // push player this way, rival the other
        const rel = this.speed - o.speed;    // closing speed (+ = player faster)
        const pp = this.playerRoot.position, op = o.obj.position;
        const cx = (pp.x + op.x) / 2, cy = (pp.y + op.y) / 2 + 0.5, cz = (pp.z + op.z) / 2;
        const F = { x: Math.sin(this.freeDrive.heading), z: Math.cos(this.freeDrive.heading) };
        const scrub = (f: number) => { this.freeDrive.vx *= f; this.freeDrive.vz *= f; };
        const shove = (a: number) => { this.freeDrive.vx += F.x * a; this.freeDrive.vz += F.z * a; };

        // always separate laterally so the two bodies can't overlap
        this.playerX = clamp(this.playerX + dir * 0.09, -OUT_OF_BOUNDS_X, OUT_OF_BOUNDS_X);
        o.lane = clamp(o.lane - dir * 0.09, -0.95, 0.95);
        o.targetLane = o.lane;

        if (d > 0 && rel > 2 && this.takedownCd <= 0) {
          // player charges INTO the rival ahead — momentum transfers, hard = takedown
          o.speed += rel * 0.55;             // shove them forward
          scrub(0.92);                       // you lose a little on the hit
          if (rel > 7 || this.nitroT > 0) {  // TAKEDOWN — a solid ram, or ANY nitro-ram
            o.stun(1.4);                     // rival spins out (visible in ai.update)
            this.boostT = Math.max(this.boostT, PAD_BOOST_DURATION * 0.9); // reward surge
            this.score += SCORE_HIT;
            this.spawnSparks(cx, cy, cz, 26);
            this.shake = Math.max(this.shake, 0.8);
            this.sound.play("crash");
            this.takedownCd = 0.7;
          } else {
            this.spawnSparks(cx, cy, cz, 12);
            this.takedownCd = 0.25;
          }
        } else if (d < 0 && rel < -5) {
          // the rival rams YOU from behind — you get shoved forward + shaken
          shove(Math.min(-rel, 22) * 0.35);
          o.speed *= 0.9;
          this.shake = Math.max(this.shake, 0.65);
          this.spawnSparks(cx, cy, cz, 12);
        } else {
          // side-by-side jostle — both scrub a touch, sparks fly
          scrub(0.985); o.speed *= 0.985;
          if (this.bumpCd <= 0) this.spawnSparks(cx, cy, cz, 10);
        }
        if (this.bumpCd <= 0) { this.sound.play("bump"); this.shake = Math.max(this.shake, 0.4); this.bumpCd = 0.3; }
      }
    }

    // Build fast, bleed slow. The tow arrives the moment you tuck in, and
    // lingers for most of a second after you pull out — which is exactly what
    // makes a slingshot pass feel like one instead of the speed switching off
    // the instant you move to overtake.
    this.tow += (towTarget - this.tow) * Math.min(1, dt * (towTarget > this.tow ? 3.2 : 1.3));
    this.towCallout = Math.max(0, this.towCallout - dt);
    if (this.tow > 0.75 && this.towCallout <= 0 && this.phase === "racing") {
      this.toast("SLIPSTREAM", "#a7f3d0");
      this.towCallout = 4;
    }

    // rival-vs-rival collision: keep cars from driving THROUGH each other. If two
    // overlap (close in distance AND lane), shove them into different lanes and
    // make the trailing car lift so it tucks in behind instead of clipping through.
    const opps = this.opponents;
    for (let i = 0; i < opps.length; i++) {
      const a = opps[i];
      if (a.finished) continue;
      for (let j = i + 1; j < opps.length; j++) {
        const b = opps[j];
        if (b.finished) continue;
        let dd = a.dist - b.dist;                     // + means a is ahead of b
        if (dd > len / 2) dd -= len; else if (dd < -len / 2) dd += len;
        if (Math.abs(dd) > 4.2) continue;
        if (Math.abs(a.lane - b.lane) > 0.55) continue;
        const dir = a.lane - b.lane >= 0 ? 1 : -1;    // split them apart laterally
        a.lane = clamp(a.lane + dir * 0.07, -0.95, 0.95); a.targetLane = a.lane;
        b.lane = clamp(b.lane - dir * 0.07, -0.95, 0.95); b.targetLane = b.lane;
        const trailing = dd > 0 ? b : a;              // the one behind eases off so it can't overlap
        trailing.speed *= 0.9;
        if (Math.abs(dd) < 2.6) {
          trailing.dist -= (2.6 - Math.abs(dd)) * 0.6; // hard nudge apart when nearly on top
          if (Math.random() < 0.25) this.spawnSparks(a.obj.position.x, a.obj.position.y + 0.5, a.obj.position.z, 5);
        }
      }
    }

    // opponents drop mines ONLY in the combat mode (Space Wars) — normal races
    // stay clean, no random mines scattered across the track
    if (this.cfg.combat && this.opponents.length && this.mines.length < 28 &&
        Math.random() < OPPONENT_MINE_CHANCE * 5 * dt) {
      const live = this.opponents.filter((o) => !o.finished && o.stunnedT <= 0);
      if (live.length) {
        const o = live[Math.floor(Math.random() * live.length)];
        const md = this.track.wrap(o.dist - 3);
        const obj = makeMine();
        const p = this.track.pointAt(md, o.lane * ROAD_HALF_WIDTH * 0.9);
        obj.position.set(p.x, p.y + 0.3, p.z);
        this.scene.add(obj);
        this.mines.push({ obj, dist: md, lateral: o.lane, travelled: 5, fromPlayer: false });
      }
    }
  }

  private land() {
    this.stuntAir = false;
    this.shake = Math.max(this.shake, 0.7); // touchdown thump
    const rollAmt = Math.abs(this.spin);
    const flipAmt = Math.abs(this.flip);
    const rollRevs = Math.round(rollAmt);
    const flipRevs = Math.round(flipAmt);
    const attempted = rollAmt > 0.25 || flipAmt > 0.25;
    const rollOk = rollAmt <= 0.25 || Math.abs(rollAmt - rollRevs) < 0.25;
    const flipOk = flipAmt <= 0.25 || Math.abs(flipAmt - flipRevs) < 0.25;

    if (attempted && rollOk && flipOk && (rollRevs >= 1 || flipRevs >= 1)) {
      const tricks: string[] = [];
      let bonus = 0;
      if (flipRevs >= 1) {
        tricks.push((this.flip > 0 ? "FRONTFLIP" : "BACKFLIP") + (flipRevs > 1 ? ` x${flipRevs}` : ""));
        bonus += SCORE_STUNT * flipRevs;
      }
      if (rollRevs >= 1) {
        tricks.push("BARREL ROLL" + (rollRevs > 1 ? ` x${rollRevs}` : ""));
        bonus += SCORE_STUNT * rollRevs;
      }
      if (tricks.length === 2) bonus = Math.round(bonus * 1.5); // combo bonus
      this.stunts += tricks.length;
      this.sound.play("stunt");
      // Into the chain, not straight into the score: a trick landed mid-chain
      // is worth several times a trick landed cold, which is the whole point.
      this.addChain((tricks.length === 2 ? "COMBO! " : "") + tricks.join(" + "), bonus);
    } else if (attempted) {
      this.speed *= 0.55;
      this.crashFlash = 0.4;
      this.sound.play("land");
      this.toast("WIPEOUT!", "#f87171");
      this.breakChain();       // a botched landing is exactly the risk
    }
    this.spin = 0;
    this.flip = 0;
  }

  private updateMonsters(dt: number) {
    const { track } = this;
    const len = track.length;
    const half = ROAD_HALF_WIDTH * 0.9;
    for (const e of this.monsters) {
      if (e.collectedLap !== 0) {
        e.obj.visible = false;
        continue;
      }
      e.obj.visible = true;
      e.phase += dt;
      let gap = e.dist - this.position;
      if (gap > len / 2) gap -= len;
      if (gap < -len / 2) gap += len;
      if (this.transformed && gap > -5 && gap < 28) {
        // charge the transformed player, tracking their lane
        e.dist = track.wrap(e.dist - 7 * dt);
        e.lateral += (this.playerX - e.lateral) * Math.min(1, dt * 1.6);
      } else {
        e.lateral = e.home + Math.sin(e.phase * 1.6) * 0.45;
      }
      e.lateral = clamp(e.lateral, -0.95, 0.95);
      const bob = Math.abs(Math.sin(this.time * 3 + e.phase)) * 0.25;
      const p = track.pointAt(e.dist, e.lateral * half);
      e.obj.position.set(p.x, p.y + bob, p.z);
      const tan = track.tangentAt(e.dist);
      e.obj.rotation.y = Math.atan2(-tan.x, -tan.z); // face the oncoming player
    }
  }

  private collideMonsters() {
    const len = this.track.length;
    for (const e of this.monsters) {
      if (e.collectedLap !== 0) continue;
      let gap = e.dist - this.position;
      if (gap > len / 2) gap -= len;
      if (gap < -len / 2) gap += len;
      // monsters CHARGE, so the closing speed is high — a tight window made hits
      // land only on lucky frames. Wider window + metre-space lateral (see collide).
      if (Math.abs(gap) > 5) continue;
      if (Math.abs(this.freeDrive.lateral - e.lateral * ROAD_HALF_WIDTH) > COLLIDE_WIDTH.monster * ROAD_HALF_WIDTH) continue;
      if (this.alt > 1.6) continue;

      if (this.transformed && this.slashCooldown <= 0) {
        this.collect(e);
        const mult = this.mechCombo();
        const gain = SCORE_MONSTER * mult;
        this.score += gain;
        this.swingT = SWING_DURATION;
        this.slashCooldown = 0.45;
        this.sound.play("slash");
        this.shake = Math.max(this.shake, 0.4);
        this.toast(`SLASH +${gain}${mult > 1 ? ` (${mult}x)` : ""}`, "#67e8f9");
      } else if (this.transformed) {
        // caught mid-recovery — the monster lands a hit
        this.speed = Math.min(this.speed, MAX_SPEED * 0.4);
        this.score -= 50;
        this.penalties += 50;
        this.crashFlash = 0.6;
        this.sound.play("monsterHit");
        if (this.bumpCd <= 0) {
          this.toast("MONSTER HIT -50", "#f87171");
          this.bumpCd = 0.5;
        }
        e.dist = this.track.wrap(e.dist + 6);
      } else if (this.shieldT > 0) {
        this.toast("BLOCKED", "#67e8f9");
        e.dist = this.track.wrap(e.dist + 6);
      } else {
        // was 0.12 — an almost dead stop, several times a lap, which is what made
        // this mode feel like punishment instead of a rampage. A real setback,
        // but you keep racing.
        this.speed = Math.min(this.speed, MAX_SPEED * 0.45);
        this.combo = 0; this.comboT = 0;
        if (this.crashFlash <= 0) {
          this.sound.play("crash");
          this.toast("MONSTER!", "#f87171");
        }
        this.crashFlash = 0.7;
        e.dist = this.track.wrap(e.dist + 6);
      }
    }
  }

  private collide(speedPercent: number) {
    // No blanket main-road gate any more: each entity knows which road it is
    // on, so a branch can hold pickups and the main road's stay put while you
    // are off it. See Entity.road.
    const key = Math.floor(this.position / BUCKET_METERS);
    const totalBuckets = Math.ceil(this.track.length / BUCKET_METERS);
    for (let k = key - 1; k <= key + 1; k++) {
      const bucket = this.buckets.get(((k % totalBuckets) + totalBuckets) % totalBuckets);
      if (!bucket) continue;
      for (const e of bucket) {
        if (e.collectedLap !== 0) continue;
        if (e.road !== this.freeDrive.onBranchIdx) continue;  // different road
        let dd = Math.abs(e.dist - this.position);
        dd = Math.min(dd, this.track.length - dd);
        if (dd > COLLIDE_DIST) continue;
        // Compare laterals in METRES. Entities are placed at `lateral *
        // ROAD_HALF_WIDTH` (5 m/unit) but playerX is scaled by ROAD_HALF_WIDTH *
        // 0.9 (4.5 m/unit) — mixing the two skewed every check by up to ~0.5 m
        // near the edges, which is why pickups missed inconsistently.
        const latGapM = Math.abs(this.freeDrive.lateral - e.lateral * ROAD_HALF_WIDTH);
        if (latGapM > COLLIDE_WIDTH[e.type] * ROAD_HALF_WIDTH) continue;
        this.hitEntity(e, speedPercent);
      }
    }
  }

  private hitEntity(e: Entity, _speedPercent: number) {
    switch (e.type) {
      case "gem":
        if (this.alt < 1.2) {
          const value = this.transformed ? SCORE_GEM * 2 : SCORE_GEM;
          this.collect(e);
          this.score += value;
          this.gems++;
          this.sound.play("gem");
          this.gemToast(value);
        }
        break;
      case "airGem":
        if (Math.abs(this.alt - AIR_GEM_ALT) < AIR_GEM_TOLERANCE) {
          this.collect(e);
          this.score += SCORE_AIR_GEM;
          this.gems++;
          this.sound.play("airGem");
          this.toast(`AIR GEM +${SCORE_AIR_GEM}`, "#fbbf24");
        }
        break;
      case "nitro":
        if (this.alt < 1.2 && this.nitroCharges < NITRO_MAX_CHARGES) {
          this.collect(e);
          this.nitroCharges++;
          this.sound.play("nitroCharge");
          this.toast("NITRO CHARGE", "#67e8f9");
        }
        break;
      case "boostpad":
        // Wired but unspawned. Nothing places a pad on the circuit: the
        // corner-exit chains that did were removed — measured over a lap of
        // ordinary driving they were touched ZERO times, because the steering
        // assist holds the car within 0.2 m of the centreline while the pads
        // sat 3.4 m out. Kept because the collision and the boost still work,
        // so a placement that respects where the car actually goes would need
        // nothing else.
        if (this.alt < 1.0) {
          if (this.boostT < 0.35) {
            this.sound.play("nitro");
            this.toast("BOOST!", "#22d3ee");
          }
          this.boostT = Math.max(this.boostT, PAD_BOOST_DURATION);
        }
        break;
      case "boostgate":
        // drive THROUGH the ring on its lane for a stronger, longer surge
        if (this.alt < 2.2) {
          if (this.boostT < 0.5) {
            this.sound.play("nitro");
            this.toast("BOOST GATE!", "#67e8f9");
            this.score += 40;
          }
          this.boostT = Math.max(this.boostT, PAD_BOOST_DURATION * 1.4);
          this.speed = Math.max(this.speed, MAX_SPEED * 0.85);
        }
        break;
      case "orb":
        if (this.alt < 1.2) {
          this.collect(e);
          this.sound.play("transform");
          if (this.transformed) {
            // Driving over an orb mid-transform used to do NOTHING — the pickup
            // was simply wasted, which felt awful. Now it tops the timer back up
            // and pays out, so chaining orbs sustains the rampage.
            this.transformT = Math.min(TRANSFORM_DURATION * 1.6, this.transformT + TRANSFORM_DURATION * 0.7);
            this.score += SCORE_GEM;
            this.toast(`ORB +${SCORE_GEM} · EXTENDED`, "#f0abfc");
          } else {
            this.transformed = true;
            this.transformT = TRANSFORM_DURATION;
            this.announce("TRANSFORMED!", "SMASH EVERYTHING", "#f0abfc", 1.2);
          }
        }
        break;
      case "ramp":
        // ramps are handled physically by the ride-up in update() (climb the face,
        // launch off the lip); the entity is now just the visual marker.
        break;
      case "rock":
        if (this.alt < 1.2) {
          if (this.transformed) {
            this.collect(e);
            const mult = this.mechCombo();
            const gain = SCORE_SMASH * mult;
            this.score += gain;
            this.swingT = SWING_DURATION;
            this.sound.play("smash");
            this.shake = Math.max(this.shake, 0.32);
            this.spawnSparks(this.playerRoot.position.x, this.playerRoot.position.y + 0.7, this.playerRoot.position.z, 14);
            this.toast(`SMASH +${gain}${mult > 1 ? ` (${mult}x)` : ""}`, "#f0abfc");
          } else if (this.shieldT > 0) {
            this.collect(e); // plow through under shield
            this.toast("BLOCKED", "#67e8f9");
          } else {
            // rocks now actually spawn, so a 0.15 wall would gut on-wheels laps
            this.speed = Math.min(this.speed, MAX_SPEED * 0.5);
            this.combo = 0; this.comboT = 0;
            if (this.crashFlash <= 0) {
              this.sound.play("crash");
              this.toast("CRASH!", "#f87171");
            }
            this.crashFlash = 0.6;
          }
        }
        break;
      case "itembox":
        if (this.alt < 1.2) {
          if (this.heldItems.length < MAX_ITEMS) {
            this.collect(e);
            const it = this.randomItem();
            this.heldItems.push(it);
            this.sound.play("nitroCharge");
            this.toast(`ITEM: ${ITEM_LABEL[it]}  [E]`, "#f0abfc");
          } else if (this.slotFullCd <= 0) {
            // all three slots banked — nudge the player to fire one
            this.slotFullCd = 1.2;
            this.toast("SLOTS FULL — [E] TO FIRE", "#8b85a8");
          }
        }
        break;
    }
  }

  private collect(e: Entity) {
    e.collectedLap = this.lap;
    e.obj.visible = false;
  }

  private randomItem(): ItemKind {
    const pool: ItemKind[] = this.cfg.combat
      ? ["missile", "missile", "missile", "mine", "mine", "shield", "boost"]
      : this.opponents.length
        ? ["boost", "boost", "shield", "missile", "missile", "mine"]
        : ["boost", "boost", "shield"];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private useItem() {
    const item = this.heldItems.shift(); // fire the oldest banked item first
    if (!item) return;
    const half = ROAD_HALF_WIDTH * 0.9;
    switch (item) {
      case "boost":
        this.boostT = ITEM_BOOST_DURATION;
        this.speed = Math.max(this.speed, MAX_SPEED * 1.05);
        this.sound.play("nitro");
        this.toast("BOOST!", "#fb923c");
        break;
      case "shield":
        this.shieldT = ITEM_SHIELD_DURATION;
        this.sound.play("nitroCharge");
        this.toast("SHIELD UP", "#67e8f9");
        break;
      case "missile": {
        const obj = makeMissile();
        this.scene.add(obj);
        this.missiles.push({ obj, dist: this.track.wrap(this.position + 4), lateral: this.playerX, travelled: 0, fromPlayer: true });
        this.sound.play("nitro");
        this.toast("MISSILE FIRED!", "#f87171");
        break;
      }
      case "mine": {
        const obj = makeMine();
        const d = this.track.wrap(this.position - 4);
        const p = this.track.pointAt(d, this.playerX * half);
        obj.position.set(p.x, p.y + 0.3, p.z);
        this.scene.add(obj);
        this.mines.push({ obj, dist: d, lateral: this.playerX, travelled: 0, fromPlayer: true });
        this.sound.play("nitroCharge");
        this.toast("MINE DROPPED", "#f0abfc");
        break;
      }
    }
  }

  private updateProjectiles(dt: number) {
    const len = this.track.length;
    const half = ROAD_HALF_WIDTH * 0.9;
    const signedGap = (a: number, b: number) => {
      let g = a - b;
      if (g > len / 2) g -= len;
      if (g < -len / 2) g += len;
      return g;
    };

    // missiles travel forward, homing onto the nearest opponent ahead
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.dist = this.track.wrap(m.dist + MISSILE_SPEED * dt);
      m.travelled += MISSILE_SPEED * dt;
      let target: Opponent | null = null;
      let best = Infinity;
      for (const o of this.opponents) {
        if (o.stunnedT > 0 || o.finished) continue;
        const g = signedGap(o.dist, m.dist);
        if (g > -3 && g < 45 && g < best) { best = g; target = o; }
      }
      if (target) m.lateral += (target.lane - m.lateral) * Math.min(1, dt * 3);
      const p = this.track.pointAt(m.dist, m.lateral * half);
      m.obj.position.set(p.x, p.y + 0.9, p.z);
      const tan = this.track.tangentAt(m.dist);
      m.obj.rotation.y = Math.atan2(tan.x, tan.z);
      let hit = false;
      for (const o of this.opponents) {
        if (o.stunnedT > 0 || o.finished) continue;
        if (Math.abs(signedGap(o.dist, m.dist)) < 3 && Math.abs(o.lane - m.lateral) < ITEM_LATERAL_TOL) {
          o.stun(STUN_DURATION);
          this.score += SCORE_HIT;
          this.sound.play("crash");
          this.toast(`DIRECT HIT +${SCORE_HIT}`, "#fbbf24");
          hit = true;
          break;
        }
      }
      if (hit || m.travelled > MISSILE_MAX_DIST) {
        this.scene.remove(m.obj);
        this.missiles.splice(i, 1);
      }
    }

    // mines: static hazards; whoever drives over one spins out
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mine = this.mines[i];
      mine.travelled += dt; // used as an arm/age timer
      mine.obj.rotation.y += dt * 2;
      let done = false;
      for (const o of this.opponents) {
        if (o.stunnedT > 0 || o.finished) continue;
        if (Math.abs(signedGap(o.dist, mine.dist)) < 2.5 && Math.abs(o.lane - mine.lateral) < ITEM_LATERAL_TOL) {
          o.stun(STUN_DURATION);
          if (mine.fromPlayer) this.score += SCORE_HIT;
          done = true;
          break;
        }
      }
      if (!done) {
        const canHitPlayer = !mine.fromPlayer || mine.travelled > 1.2;
        if (canHitPlayer && this.alt < 1.2 &&
            Math.abs(signedGap(this.position, mine.dist)) < 2.5 &&
            Math.abs(this.playerX - mine.lateral) < ITEM_LATERAL_TOL) {
          if (this.shieldT > 0) {
            this.toast("BLOCKED", "#67e8f9");
          } else {
            this.speed = Math.min(this.speed, MAX_SPEED * 0.15);
            this.crashFlash = 0.6;
            this.sound.play("crash");
            this.toast("MINE!", "#f87171");
          }
          done = true;
        }
      }
      if (done) {
        this.scene.remove(mine.obj);
        this.mines.splice(i, 1);
      }
    }
  }

  private clearProjectiles() {
    for (const m of this.missiles) this.scene.remove(m.obj);
    for (const m of this.mines) this.scene.remove(m.obj);
    this.missiles = [];
    this.mines = [];
  }

  // --- render ----------------------------------------------------------------

  private render() {
    // Keep the sky (and its cloud deck) centred on the camera — see makeSkyDome
    // above. Only the horizontal position matters for the illusion, but moving
    // all three axes is simplest and costs nothing.
    if (this.skyMesh) this.skyMesh.position.copy(this.camera.position);
    if (this.clouds) this.clouds.position.copy(this.camera.position);
    const { track } = this;

    if (this.phase !== "loading") {
      // FREE-ROAM: the car sits at its real world position, facing its heading
      // on the road the car rides the exact track height; off it, ride the
      // rolling terrain (they match at the verge, so the handoff is seamless)
      // On the road, ride the BANKED surface at the lateral offset you are
      // actually at — not the flat centreline. Passing flat = true here is what
      // made a banked road poke up through the car, which is why banking was
      // switched off in the first place.
      // Blend, do not switch. A hard handoff at |lateral| > ROAD_HALF_WIDTH put
      // the car on the terrain the instant a wheel crossed the white line, and
      // the terrain sits below the ribbon by design — so the car dropped
      // through the road surface at the edge. This eases from the banked road
      // height to the terrain over 6 m, which is the width of the verge.
      const roadSurfaceY = this.surfaceY(this.freeDrive.lateral);
      const terrainY = this.groundHeightAtXZ(this.freeDrive.x, this.freeDrive.z);
      const offK = clamp((Math.abs(this.freeDrive.lateral) - ROAD_HALF_WIDTH) / 6, 0, 1);
      const groundY = roadSurfaceY * (1 - offK) + terrainY * offK;
      this.playerRoot.position.set(this.freeDrive.x, groundY + this.alt + CAR_LIFT, this.freeDrive.z);
      this.playerRoot.rotation.order = "YXZ";
      // keep the shadow-casting sun (and its tight frustum) centred slightly
      // AHEAD of the car — along its travel direction — so the shorter-range
      // frustum still covers the road you're driving into, not the space behind.
      if (this.sun) {
        const vx = this.freeDrive.vx, vz = this.freeDrive.vz;
        const vl = Math.hypot(vx, vz);
        const bx = vl > 1 ? (vx / vl) * 24 : 0;
        const bz = vl > 1 ? (vz / vl) * 24 : 0;
        const tx = this.freeDrive.x + bx, tz = this.freeDrive.z + bz;
        this.sun.target.position.set(tx, groundY, tz);
        this.sun.position.set(tx + 55, groundY + 120, tz + 45);
      }
      this.playerRoot.rotation.y = this.freeDrive.heading;
      // nose pitch: rides up ramps, arcs in the air, follows the road slope on
      // the ground (computed + smoothed in update) — no more flat "sinking"
      // suspension travel: a few centimetres, but it is what sells a dip as a
      // dip rather than as a change of altitude
      this.playerRoot.position.y -= clamp(this.gLoad, -1, 1) * 0.05;
      this.playerRoot.rotation.x = this.carPitch + this.weightPitch; // slope + brake-dive/throttle-squat

      // pitch = flips + air tilt, yaw = steer/drift heading, roll = barrel roll +
      // corner lean (weight transfer) + the road's bank (so the car sits flat on banked corners)
      const bankRoll = (!this.onBranch && this.alt < 0.4) ? track.bankAt(this.position) : 0;
      this.playerBody.rotation.x = this.flip * Math.PI * 2; // barrel-roll/flip stunts only
      this.playerBody.rotation.y = this.carYaw;
      this.playerBody.rotation.z =
        this.spin * Math.PI * 2 + this.weightRoll - (this.drifting ? this.driftDir * 0.1 : 0) + bankRoll;

      // form swap + effects
      if (this.carModel) this.carModel.visible = !this.transformed;
      if (this.mech) {
        this.mech.group.visible = this.transformed;
        this.mech.wings.visible = this.transformed && this.alt > 0.15;
        (this.mech.core.material as THREE.MeshStandardMaterial).emissiveIntensity =
          1.8 + Math.sin(this.time * 6) * 0.6;
        // sword swing arc
        let swing = -0.5;
        if (this.swingT > 0) {
          const t = 1 - this.swingT / SWING_DURATION;
          swing = -0.5 + Math.sin(t * Math.PI) * 2.4;
        }
        this.mech.armR.rotation.x = swing;
      }
      if (this.slash) {
        const show = this.transformed && this.swingT > 0;
        this.slash.visible = show;
        if (show) {
          const t = 1 - this.swingT / SWING_DURATION;
          this.slash.scale.setScalar(1 + t * 1.6);
          (this.slash.material as THREE.MeshBasicMaterial).opacity = 1 - t;
          this.slash.rotation.z = -t * 2.2;
        }
      }
      const boosting = this.nitroT > 0 || this.driftBoostT > 0 || this.boostT > 0 || (this.transformed && this.alt > 0.15);
      for (const flame of this.flames) {
        flame.visible = boosting;
        const flick = 1 + Math.sin(this.time * 40 + flame.position.x) * 0.3;
        flame.scale.set(flick, 1 + flick * 0.4, flick);
        (flame.material as THREE.MeshBasicMaterial).color.setHex(this.transformed ? 0x22d3ee : 0xfb923c);
      }
      if (this.underGlow) {
        this.underGlow.visible = !this.transformed;
        this.underGlow.scale.setScalar(0.9 + Math.sin(this.time * 9) * 0.15);
        this.underGlow.position.y = 0.08 - this.alt;
      }
      if (this.shieldBubble) {
        this.shieldBubble.visible = this.shieldT > 0;
        if (this.shieldT > 0) {
          (this.shieldBubble.material as THREE.MeshBasicMaterial).opacity =
            0.14 + Math.sin(this.time * 6) * 0.06;
          this.shieldBubble.rotation.y = this.time;
        }
      }

      // pickup + monster animation
      for (const e of this.spinners) {
        if (!e.obj.visible) continue;
        e.obj.rotation.y = this.time * 1.6 + e.phase;
        e.obj.position.y = e.baseY + Math.sin(this.time * 2.5 + e.phase) * 0.18;
      }
      // weather (snow/ash/sand/rain/…) drifts and follows the camera so it fills view
      if (this.weather) this.weather.update(this.time, this.camera.position);
      // animate the set-pieces: scrolling water sheets + drifting mist, flapping
      // bats. Both updaters are allocation-free and no-op on a group without
      // their userData, so this is safe to call unconditionally.
      for (const wf of this.grandFalls) updateGrandWaterfall(wf, this.time);
      for (const bf of this.batFlocks) updateBatFlock(bf, this.time);
      for (const cu of this.waterCurtains) {
        for (const sh of cu.children) {
          const mm = (sh as THREE.Mesh).material as THREE.MeshBasicMaterial;
          if (mm.map) mm.map.offset.y = -this.time * (sh.userData.scroll as number);
        }
      }
      // drive the foliage wind + shimmer/sway the god-ray shafts so they breathe
      windTime.value = this.time;
      if (this.heatHaze && this.heatHaze.enabled) this.heatHaze.uniforms.time.value = this.time;
      if (this.filmGrade) this.filmGrade.uniforms.time.value = this.time;
      if (this.lightShafts) {
        this.lightShafts.children.forEach((h, i) => {
          h.rotation.z = Math.sin(this.time * 0.15 + i) * 0.14;
          const mat = ((h as THREE.Group).children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
          const base = (h.userData.baseOpacity as number) ?? (h.userData.baseOpacity = mat.opacity);
          mat.opacity = base * (0.65 + 0.35 * Math.sin(this.time * 0.6 + i * 1.7));
        });
      }
      // monsters are positioned in updateMonsters (they move + charge)

      // FREE-ROAM chase camera: sit behind + above the car along its heading and
      // look ahead of it. FOV kicks with speed/boost; banks slightly with steer.
      const preset = CAMERA_PRESETS[this.cameraIndex];
      const spd = this.speed / MAX_SPEED;
      // HOOD is a bonnet cam: it sits AHEAD of the car's centre and just above
      // the bodywork, so there is nothing useful to see of your own car from
      // it — and plenty to see wrong. Hiding the model removes a whole class of
      // bug at once, including looking straight into the inside of the shell.
      const hood = preset.name === "HOOD";
      if (this.carModel) this.carModel.visible = !hood;
      // auto-follow: the camera yaw eases toward the car's heading instead of
      // snapping to it, so flicking the wheel swings the view in smoothly behind
      // you (much easier to place the car). Snap it on a hard cut (start/camera cycle).
      // AUTO-TURN INTO BENDS: aim the camera down the ROAD AHEAD, not just where
      // the nose points, so a corner opens up BEFORE you reach it and you can
      // place the car instead of discovering the turn late (and running wide).
      // Looks further ahead the faster you go; fades out if you leave the ribbon
      // (then it just follows the car) and while the mech is flying.
      let targetYaw = this.freeDrive.heading;
      if (!this.transformed && this.freeDrive.speed > 2) {
        const lookAhead = 16 + spd * 18;
        const tA = this.track.tangentAt(this.track.wrap(this.freeDrive.dist + lookAhead));
        let toRoad = Math.atan2(tA.x, tA.z) - this.freeDrive.heading;
        toRoad = Math.atan2(Math.sin(toRoad), Math.cos(toRoad)); // shortest way round
        // full strength on the ribbon, easing to 0 by ~6 m off it
        const onRibbon = clamp(1 - (Math.abs(this.freeDrive.lateral) - ROAD_HALF_WIDTH) / 6, 0, 1);
        // Only a GENTLE lead. Aligning the camera hard to the road (this was 0.92)
        // left it a mean 16.7deg / max 53deg off the car's nose: entering a bend the
        // view swung into the corner long before the car did, so the car appeared to
        // slide the OPPOSITE way and correcting that apparent slide steered you
        // wrong. The pure-pursuit steering assist keeps you on the road now, so the
        // camera only has to open the corner up a little.
        targetYaw = this.freeDrive.heading + toRoad * 0.26 * onRibbon;
      }
      let dyaw = targetYaw - this.camYaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      if (this.camSnap) this.camYaw = targetYaw;
      else this.camYaw += dyaw * this.ease(0.17); // settle faster so the view leads the corner instead of trailing it
      const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);

      // Drive the speed smear from the SAME number as the FOV kick, so the
      // periphery blurs exactly when it starts moving fast enough to strobe.
      if (this.radialBlur) {
        const want = this.reduceMotion
          ? 0
          : (Math.max(0, spd - 0.45) / 0.55) * (boosting ? 1.35 : 1);
        const u = this.radialBlur.uniforms.amount;
        u.value += (Math.min(1.15, want) - u.value) * this.ease(0.1);
      }
      // FOV kick, eased back from 9/12. A wide lens at speed stretches the
      // periphery, which makes the same roadside object cross the frame faster
      // AND arrive distorted — the opposite of legible. The smear now carries
      // the sense of speed, so the lens doesn't have to shout.
      const targetFov = preset.fov + spd * 5 + (boosting ? 8 : 0);
      this.camera.fov += (targetFov - this.camera.fov) * this.ease(boosting ? 0.14 : 0.08); // snappier kick, gentle relax
      this.camera.updateProjectionMatrix();

      const camAnchor = new THREE.Vector3(
        this.freeDrive.x - fx * preset.back,
        // Track the car's jump altitude almost fully. At 0.55 the car climbed
        // past the camera on every launch while the camera lagged below it —
        // which on the bonnet cam put the viewpoint INSIDE the shell, looking
        // at its back faces. 0.92 keeps the camera with the car.
        groundY + preset.height + this.alt * 0.92,
        this.freeDrive.z - fz * preset.back,
      );
      // THE FLOOR UNDER THE CAMERA BELONGS IN THE ANCHOR, not only in the clamp
      // below. `groundY` is the surface under the CAR; the clamp that follows
      // samples the surface under the CAMERA, which on CINEMATIC is 16 m back.
      // Over a crest those two disagree by metres, so the anchor pulled the
      // camera down while the clamp shoved it back up, and when the camera
      // cleared the crest and the clamp let go it fell the whole way at the
      // follow rate. Measured: a 6.01 m step in ONE frame, which is the 14.5
      // degrees of whip. Folding the camera's own ground into the anchor means
      // the two terms agree and the clamp is a safety net again rather than
      // half of a tug of war.
      //
      // I tried lifting the anchor by the ground under the CAMERA here as well,
      // to stop it fighting the clamp. It made things worse in a new way: the
      // anchor is a straight line back along the car's heading, so the moment
      // the car is sideways that point swings off the road onto the hillside
      // beside it, and the lift rocketed the viewpoint to 8.7 m. The eased,
      // road-first floor below is the whole fix; this was one term too many.
      if (this.camSnap) { this.camPos.copy(camAnchor); this.camSnap = false; this.camFloor = 0; }
      else this.camPos.lerp(camAnchor, this.ease(preset.follow));

      // DO NOT LET THE CAMERA GO UNDER THE GROUND. Its height is taken from the
      // road at the CAR's position, but it sits several metres behind — and on
      // a steep decline the ground behind you is higher than the ground you are
      // on, so that anchor puts the viewpoint underneath it. You end up looking
      // at the underside of the road with the car nowhere in frame. Sample the
      // ground where the camera actually IS and hold it clear.
      {
        // The floor has to be the ROAD, not the terrain.
        //
        // An earlier pass clamped to groundHeightAtXZ and that is not the
        // surface you fall through. The terrain is deliberately held BELOW the
        // road ribbon (see the CLEAR ramp), so on a descent the camera — which
        // trails several metres behind, where the road you just came down is
        // still high — can sit above the terrain and under the tarmac at the
        // same time. That is exactly the "I can see the underside of the road"
        // case: the clamp was satisfied and the view was still beneath it.
        //
        // So: sample the road surface at the camera's own position via
        // project(), take whichever of road and terrain is higher, and hold
        // clear of that. Only when the camera is actually over the ribbon —
        // out in a field the road's height is irrelevant.
        const floor = this.cameraFloorAt(this.freeDrive.dist, preset.back, this.camPos.x, this.camPos.z) + 1.1;
        // …and ease onto it. A hard assignment turns any step in the sampled
        // surface into a step in the picture.
        //
        // The easing is ASYMMETRIC and there is no hard backstop behind it. A
        // backstop was the obvious safety net and it silently cancelled the
        // easing: whenever the raw floor rose, the backstop snapped the camera
        // the whole way and the eased value was never the binding one. Rising
        // at 0.5 is quick enough to stay out of the tarmac (the surface under
        // the camera moves slowly now the corridor is wide); falling at 0.12
        // is what stops a crest from dropping the viewpoint out from under you.
        const k = this.ease(floor > this.camFloor ? 0.5 : 0.12);
        this.camFloor = this.camFloor === 0 ? floor : this.camFloor + (floor - this.camFloor) * k;
        if (this.camPos.y < this.camFloor) this.camPos.y = this.camFloor;
      }
      // PHOTO MODE takes the camera over completely: an orbit around the car
      // that the player steers, instead of the chase rig. Everything else in
      // render() runs unchanged, so the photograph is the game's own image.
      if (this.photo) {
        const o = this.photoOrbit;
        const i = this.input;
        const step = 0.028;
        if (i.left) o.yaw -= step;
        if (i.right) o.yaw += step;
        if (i.accelerate) o.pitch = clamp(o.pitch + step * 0.7, -0.25, 1.35);
        if (i.brake) o.pitch = clamp(o.pitch - step * 0.7, -0.25, 1.35);
        if (i.holding("z")) o.dist = clamp(o.dist - 0.18, 3.2, 46);
        if (i.holding("x")) o.dist = clamp(o.dist + 0.18, 3.2, 46);
        if (i.holding("q")) o.fov = clamp(o.fov - 0.5, 18, 82);
        if (i.holding("e")) o.fov = clamp(o.fov + 0.5, 18, 82);

        const target = this.playerRoot.position;
        const cp = Math.cos(o.pitch);
        this.camera.position.set(
          target.x + Math.sin(o.yaw) * o.dist * cp,
          target.y + 1.1 + Math.sin(o.pitch) * o.dist,
          target.z + Math.cos(o.yaw) * o.dist * cp,
        );
        this.camera.lookAt(target.x, target.y + 0.85, target.z);
        if (Math.abs(this.camera.fov - o.fov) > 0.01) {
          this.camera.fov = o.fov;
          this.camera.updateProjectionMatrix();
        }
        this.composer.render();
        return;
      }

      this.camera.position.copy(this.camPos);
      if (this.shake > 0.01 && !this.reduceMotion) {
        const s = this.shake * 0.18;
        this.camera.position.x += (Math.random() - 0.5) * s;
        this.camera.position.y += (Math.random() - 0.5) * s;
      }
      const lookAt = new THREE.Vector3(
        this.freeDrive.x + fx * preset.ahead,
        groundY + preset.lookHeight + this.alt * 0.92,
        this.freeDrive.z + fz * preset.ahead,
      );
      this.camera.lookAt(lookAt);
      const bank = clamp(-this.freeDrive.slip * 0.006 - this.steer * 0.012, -0.055, 0.055);
      this.camera.rotateZ(bank);

      this.composer.render();
    }

    this.renderHud();
  }

  private renderHud() {
    const ctx = this.hudCtx;
    const vw = this.viewW;
    const vh = this.viewH;
    ctx.clearRect(0, 0, vw, vh);

    if (this.phase === "loading") {
      ctx.fillStyle = "#0b0b1a";
      ctx.fillRect(0, 0, vw, vh);
      drawCenterText(ctx, "SUMMONING REALM…", 32, "#c084fc", vw, vh);
      return;
    }

    // sense-of-speed overlay sits under the HUD panels
    if (this.phase === "racing" || this.phase === "finished") {
      drawFrameGrade(ctx, vw, vh); // subtle always-on cinematic vignette
      const boosting = this.nitroT > 0 || this.driftBoostT > 0 || this.boostT > 0;
      drawSpeedFx(ctx, vw, vh, this.speed / MAX_SPEED, boosting, this.time);
    }

    // once finished, freeze the position at the placement taken at the line —
    // the car keeps coasting past it, so a live recompute would drift (e.g. creep
    // to "1st") as you roll on
    const position = this.opponents.length && !this.replayData
      ? (this.phase === "finished" ? this.finalPosition : this.computePosition())
      : undefined;
    drawHud(ctx, {
      // Scaled so a flat-out lap in the quickest car reads ~165, and ~195 on
      // nitro — a cap you can believe, not a 300 that makes every number
      // meaningless.
      mph: Math.min(SPEEDO_MAX, Math.round((this.speed / MAX_SPEED) * SPEEDO_SCALE)),
      // A replay is a recording of one lap: no score accruing, no nitro to
      // spend, no field to be placed against. See HudState.replay.
      replay: !!this.replayData,
      score: Math.max(0, Math.round(this.score)),
      lap: Math.min(this.lap, this.cfg.laps),
      totalLaps: this.cfg.laps,
      raceTime: this.raceTime,
      nitroCharges: this.replayData ? 0 : this.nitroCharges,
      nitroFill: this.nitroFill,
      nitroActive: this.nitroT > 0,
      nitroBurn: this.nitroT / NITRO_DURATION,
      chainLinks: this.chainLinks,
      chainPending: this.chainPending,
      chainT: this.chainT,
      tow: this.tow,
      grip: this.gripMul,
      gripCause: WEATHER_LABEL[this.weatherKind],
      transformT: this.transformed ? this.transformT : 0,
      crashFlash: this.crashFlash,
      position,
      totalRacers: this.opponents.length && !this.replayData ? this.opponents.length + 1 : undefined,
      cameraName: CAMERA_PRESETS[this.cameraIndex].name,
      fps: this.showFps ? Math.round(1000 / Math.max(1, this.frameMs)) : undefined,
      frameMs: this.showFps ? this.frameMs : undefined,
      soundMuted: this.sound.isMuted,
      heldItems: this.heldItems.map((i) => ITEM_LABEL[i]),
      shieldActive: this.shieldT > 0,
      carName: CAR_SPECS[this.carId].name,
      offTrackWarn: this.offTrackT > 0 ? this.offTrackT : 0,
      endless: !!this.cfg.endless,
      distanceM: this.playerProgress(),
    }, vw, vh);

    // NO MINIMAP in endless. A map of the circuit is useless on a road with no
    // junctions and no rivals to track — and worse, it draws the loop, which is
    // the one thing the whole realm is shaped to stop you noticing. Scoped to
    // the minimap only: an early return here would also drop the toasts, the
    // callouts and the countdown lights, which endless still uses.
    if (!this.cfg.endless) {
      // minimap bottom-right (out of the driving sightline)
      const size = Math.round(Math.min(150, Math.max(112, vw * 0.11)));
      this.minimap.draw(
        ctx,
        vw - size - 18,
        vh - size - 18,
        size,
        { x: this.playerRoot.position.x, z: this.playerRoot.position.z, color: "#67e8f9" },
        this.opponents.map((o) => ({ x: o.obj.position.x, z: o.obj.position.z, color: `#${o.color.toString(16).padStart(6, "0")}` }))
      );
    }

    // Fixed at the top now. The stack used to be pushed below the callout when
    // one fired, because both lived in the middle of the screen; it sits above
    // it entirely, so there is nothing left to dodge.
    drawToasts(ctx, this.toasts, vw);
    // race-drama callout (overtake / final lap) sits above the toasts; hide it
    // once finished so it doesn't fight the FINISH! banner
    if (this.callout && this.phase !== "finished") drawCallout(ctx, this.callout, vw, vh);

    if (this.replayData) {
      drawReplayBar(ctx, this.replayProgress(), vw, vh);
    } else if (this.phase === "countdown") {
      drawStartLights(ctx, this.countdownT, vw, vh);
    } else if (this.phase === "finished") {
      drawCenterText(ctx, "FINISH!", 64, "#fbbf24", vw, vh);
    }
  }
}
