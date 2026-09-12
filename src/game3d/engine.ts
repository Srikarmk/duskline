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
  MAX_SPEED, ACCEL, BRAKING, DECEL, OFF_ROAD_DECEL, OFF_ROAD_LIMIT,
  STEER_RESPONSE, STEER_RETURN, TURN_ACCEL, STEER_SPEED_FALLOFF,
  GRIP_LIMIT, LATERAL_DAMP, CENTRI_K, FREE_TURN_RATE, FREE_GRIP, FREE_STEER_ASSIST, WEIGHT_BRAKE_GRIP, WEIGHT_THROTTLE_GRIP,
  DRIFT_GRIP_MULT, DRIFT_STEER_MULT, DRIFT_MIN_CHARGE, DRIFT_BOOST_FACTOR,
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
  makeSkyDome, makePosterSky, makeCloudLayer, makeEnvMap, makeLightShafts, windTime, makeGround, makeGrassTexture,
  makeGrassField, makeRockField, makeMountainRing,
  makeGem, makeNitroCan, makeOrb, makeRamp, RAMP_SPECS, type RampKind,
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
import { makeGrandWaterfall, updateGrandWaterfall, makeStoneBridge, makeBatFlock, updateBatFlock } from "./props/grand";
import { makeOceanPlane, makeSkyline, makePalmField, makePalmProp, makeSandTexture } from "./props/coast";
import { makeForkArrowSign, makeBlimp } from "./props/signage";
import { BranchPath } from "./branch";
import { FreeDrive } from "./freedrive";
import { loadPBR, pbr } from "./textures";
import { makeKart, setCarEnvTint, setCarPosterMode, CAR_SPECS, CAR_IDS, type CarStat } from "./cars";
import { REALMS, pickScenery, REALM_WEATHER, REALM_WEATHER_POOL, REALM_AMBIENCE, REALM_TUNNELS, REALM_RIVERS, REALM_SPLITS, type RealmSpec, type SceneryKind, type RealmPalette, type WeatherKind } from "./realms";
import { makePyramid, makeObelisk, makeSphinx, makePalm, makeSandRock } from "./props/egyptian";
import { makeTower, makeGatehouse, makeCastleWall, makeBanner, makeTorch } from "./props/castle";
import { makeGrandstand, makeTyreStack, makeFloodlight, makePitBuilding, makeMarshalBoard } from "./props/circuit";
import { makeSkyscraper, makeBrownstone, makeStreetlight, makeBillboard, makeWaterTower } from "./props/metro";
import { makeHogwartsCastle, makeHogwartsExpress, makeQuidditchHoop, makeFloatingCandle, makeGoldenSnitch, makeWhompingWillow } from "./props/hogwarts";
import { makeWaterfall, makeRiverBridge } from "./props/water";
import { Opponent } from "./ai";
import { Minimap } from "./minimap";
import { Sound } from "./sound";
import { loadSetting, loadSettings, type Settings } from "../ui/settings";
import { Input } from "../game/input";
import { drawHud, drawToasts, drawCallout, drawCenterText, drawSpeedFx, drawFrameGrade, drawStartLights, type Toast } from "../game/render";
import type { GameMode, GameResult, GameOptions, RaceStanding, CarId } from "../game/engine";

type Phase = "loading" | "countdown" | "racing" | "finished";

type EntityType = "gem" | "airGem" | "nitro" | "orb" | "ramp" | "rock" | "monster" | "itembox" | "boostpad" | "boostgate";

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
  timetrial: { laps: 3, opponents: false, orbs: false, monsters: false, startNitro: 1, label: "TIME TRIAL" },
  nitro:     { laps: 1, opponents: true,  orbs: false, monsters: false, startNitro: NITRO_MAX_CHARGES, label: "NITRO SPRINT" },
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
  boostpad: 1.0, boostgate: 0.5,
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
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float amount;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // chromatic aberration: zero in the middle, only noticeable at the corners
      vec2 off = c * r2 * 0.0075 * amount;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;

      // filmic S-curve: lifts contrast without crushing either end
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22 * amount);

      // split tone — cool the shadows, warm the highlights
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.90, 0.97, 1.10);
      vec3 highTint   = vec3(1.06, 1.01, 0.94);
      col *= mix(shadowTint, highTint, smoothstep(0.15, 0.85, luma)) * amount + (1.0 - amount);

      // a little saturation so the realm palettes stay punchy after the S-curve
      col = mix(vec3(luma), col, 1.0 + 0.10 * amount);

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
  private ramps: { dist: number; power: number; lane: number; len: number; height: number; twist: boolean }[] = [];
  /** fork zones as main-track ranges [d0,d1] — used to keep boost pads/gates from
   *  cluttering a fork mouth. */
  private splits: { d0: number; d1: number }[] = [];
  /** true alternate routes: a separate drivable road you can peel onto at a fork
   *  and rejoin later. `side` is which way it bows (used to decide entry). */
  private branches: { path: BranchPath; side: number }[] = [];
  /** the branch you're currently driving (null = on the main track), and how far
   *  along it (arc-length metres). */
  private onBranch: BranchPath | null = null;
  private branchU = 0;
  /** free-roam driving body (world-space physics; the rail position/playerX are
   *  derived from it by projecting onto the track each frame). */
  private freeDrive = new FreeDrive();
  private lapProgress = 0;   // cumulative signed distance travelled this lap
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
  private skyMat: THREE.ShaderMaterial | null = null;
  private seaY = -11; // coastal realms: land inside r, sea beyond
  private reliefAmp = 0; // per-realm amplitude of the rolling hills the ground rises into away from the road
  private sun!: THREE.DirectionalLight; // shadow-casting key light; its frustum follows the car
  private offTrackT = 0; // seconds left before an off-track respawn (0 = on track / no warning)
  private offTrackExitDist = 0; // arc distance where you left the ribbon — respawn point
  private terrSamp?: { sx: Float64Array; sz: Float64Array; sy: Float64Array }; // cached track polyline for ground-height queries
  private camSnap = true;
  private cameraIndex = 0;

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
  // big centre-screen race-drama callouts (overtakes, final lap) — distinct
  // from the small stacked toasts; one at a time, with a pop + fade
  private callout: { text: string; sub: string; color: string; t: number; life: number } | null = null;
  private lastPosition = 0;   // player's rank last frame, to detect overtakes
  private overtakeCd = 0;     // debounce so grid shuffles don't spam callouts

  constructor(container: HTMLElement, options: GameOptions) {
    this.container = container;
    this.mode = options.mode;
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
    } else {
      this.realm = REALMS[options.realm ?? "forest"];
    }
    // banking OFF: the car sits at the flat centreline height, so a banked (tilted)
    // road surface would poke up through it on corners and look like the car sinks
    this.track = new Track(this.realm.controlPoints, false, this.realm.hillScale ?? 1);
    // how dramatically the land rolls away from the road, per realm — peaks/dunes
    // heave, the speedway + city stay near-flat, the space tubes get none
    this.reliefAmp = ({
      forest: 18, ember: 26, peaks: 32, void: 0, sands: 28,
      castle: 22, circuit: 7, metro: 10, nebula: 0, bay: 0,
      // The photo realms. On a one-sided coast this is what the INLAND side
      // becomes, so the cliff road has a hillside to have been cut into rather
      // than a flat shelf: 70 m of relief on the cape, 90 in the canyon.
      azur: 46, hokkai: 74, mirage: 12, basin: 40, cape: 70, hills: 90,
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

    // fill the container at its true aspect ratio (full-width, no letterbox)
    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);
    this.viewW = w;
    this.viewH = h;

    // preserveDrawingBuffer left OFF: nothing reads the WebGL backbuffer (realm
    // thumbnails are static JPGs) and keeping it on blocks the browser's swap
    // optimizations — a free perf win.
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.className = "game-layer";
    this.renderer.setClearColor(this.realm.palette.fog);
    // filmic tone mapping → richer colors + smooth highlight roll-off
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    // real-time shadows — the single biggest "this is 3D, not flat" upgrade
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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
    this.heatHaze = haze;

    // final pass applies tone mapping + sRGB so the composed image is graded
    this.composer.addPass(new OutputPass());

    // …then the film grade on top, in display space (see FilmGradeShader).
    const grade = new ShaderPass(FilmGradeShader);
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
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloomPass.setSize((w * dpr) / 2, (h * dpr) / 2);
    if (this.gtao) this.gtao.setSize(w * dpr, h * dpr);
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
    void this.init();
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
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private async init() {
    // load the CC0 PBR textures for this realm alongside the models. New realms
    // reuse a close-matching shipped ground albedo (then tint it via palette).
    const GROUND: Record<string, string> = {
      forest: "ground_forest", ember: "ground_ember", peaks: "ground_peaks",
      void: "ground_peaks", sands: "ground_peaks", castle: "ground_forest",
      circuit: "ground_forest", metro: "ground_peaks",
      // The photo realms were falling through to ground_forest, which is a
      // dark green woodland floor. groundTint is a MULTIPLY, so it can only
      // ever darken that — which is why the snow pass came out olive and the
      // deserts came out mossy. Pick the closest shipped albedo per realm and
      // let the tint do the last 20%.
      hokkai: "ground_peaks",   // pale rock, tints to snow
      // peaks is bare pale rock, and tinting it straw made the headland read
      // as desert sand. Big Sur in late summer is dry GRASS over scrub, so the
      // forest albedo with its grass structure, tinted warm, is the closer set.
      cape: "ground_forest",
      hills: "ground_ember",    // scorched chaparral
      basin: "ground_ember",    // red desert rock
      mirage: "ground_peaks",   // pale sand
      azur: "ground_peaks",     // dusty stone waterfront
      bay: "ground_peaks",
    };
    const groundName = GROUND[this.realm.id] ?? "ground_forest";
    const [library] = await Promise.all([loadModels(), loadPBR(groundName)]);
    if (this.stopped) return;
    this.buildWorld(library);
    // place the free-roam body on the start line, facing down the track
    this.freeDrive.reset(this.track, 0);
    this.lastFreeDist = 0;
    this.lapProgress = 0;
    this.combo = 0;
    this.comboT = 0;
    this.lastPosition = 0;
    this.overtakeCd = 0;
    this.callout = null;
    this.phase = "countdown";
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
    sky.userData.noShadow = true; // the sky must never cast/receive shadows
    scene.add(sky);
    // The analytic sky draws its own clouds, lit and drifting, so it needs no
    // dome — which also drops a 4096 texture and a draw call. Only the canvas
    // realms still get the separate cloud layer.
    this.skyMat = analytic ? (sky.material as THREE.ShaderMaterial) : null;
    if (!analytic) {
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
      // horizon-filling mountain ring
      const cx = (track.bounds.minX + track.bounds.maxX) / 2;
      const cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
      const radius = Math.max(track.bounds.maxX - track.bounds.minX, track.bounds.maxZ - track.bounds.minZ) * 0.75 + 260;
      scene.add(makeMountainRing(pal, cx, cz, radius));
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
    sun.shadow.mapSize.set(4096, 4096);
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
    scene.add(track.buildRoadMesh(makeRoadTexture(pal), pal.roadFinish));
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
      const gp = track.pointAt(2);
      const gtan = track.tangentAt(2);
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
    const LABEL: Record<WeatherKind, string> = {
      none: "SKIES CLEARING", snow: "SNOWFALL", ember: "EMBER STORM",
      sand: "SANDSTORM", spores: "SPORE DRIFT", mist: "MIST ROLLING IN", rain: "RAIN INCOMING",
    };
    // deliberately silent. A full-screen "MIST ROLLING IN" callout every 25-45 s
    // is pure interruption — you can SEE the weather change, it doesn't need
    // announcing over the racing.
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
    return Math.abs(this.track.project(x, z).lateral) - r > ROAD_HALF_WIDTH + 0.5;
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
    const rowStep = 8.0;    // metres between ROWS
    const stagger = 1.6;    // the right-hand slot of each row sits this far up
    const colLane = 0.38;   // the two columns, ± this in playerX units
    const gridN = Math.min(OPPONENT_COUNT, OPPONENTS.length);
    const playerSlot = gridN;                 // player is last (behind every rival)
    const rowOf = (slot: number) => Math.floor(slot / 2);
    const lastRow = rowOf(playerSlot);
    const slotDist = (slot: number) =>
      (lastRow - rowOf(slot)) * rowStep + (slot % 2 === 1 ? stagger : 0);
    const slotLane = (slot: number) => (slot % 2 === 0 ? -colLane : colLane);

    for (let i = 0; i < gridN; i++) {
      const spec = OPPONENTS[i];
      const car = makeKart(CAR_IDS[i % CAR_IDS.length], spec.color);
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
    m.position.set(x, y + 0.03, z);
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
    const x = new Float64Array(n), z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.track.pointAt((this.track.length * i) / n, 0);
      x[i] = p.x; z[i] = p.z;
    }
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

  private addEntity(type: EntityType, dist: number, lateral: number, obj: THREE.Object3D, extraY = 0, power = 1) {
    const d = this.track.wrap(dist);
    const p = this.track.pointAt(d, lateral * ROAD_HALF_WIDTH);
    obj.position.set(p.x, p.y + extraY, p.z);
    const tan = this.track.tangentAt(d);
    obj.rotation.order = "YXZ";
    obj.rotation.y = Math.atan2(tan.x, tan.z);
    // ramps/rocks/pads sit on the road, so pitch them to match its slope on hills
    if (type === "ramp" || type === "rock" || type === "boostpad" || type === "boostgate") {
      const a = this.track.pointAt(d - 2);
      const b = this.track.pointAt(d + 2);
      const horiz = Math.hypot(b.x - a.x, b.z - a.z) || 4;
      obj.rotation.x = -Math.atan2(b.y - a.y, horiz);
    }
    this.scene.add(obj);
    const entity: Entity = {
      type, dist: d, lateral, collectedLap: 0, obj,
      baseY: obj.position.y, phase: Math.random() * Math.PI * 2, home: lateral, power,
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
        quad(rail, prev.rhi, prev.rhi2, rhi2, rhi);
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

  /** Build the TRUE fork routes from REALM_SPLITS: at each fork the road peels
   *  onto a SEPARATE alternate road that bows away to one side (optionally rising
   *  into an overpass) and rejoins the main track later. A big fork sign marks the
   *  mouth; steering toward the branch side takes it (see maybeEnterBranch). */
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
      const startDist = s.at * len;
      const endDist = startDist + s.len;
      this.splits.push({ d0: this.track.wrap(startDist), d1: this.track.wrap(endDist) });
      // which way the lens bows — varied per realm so it's not always the same side
      const side: 1 | -1 = (this.realm.id.charCodeAt(0) + fi) % 2 === 0 ? 1 : -1;
      // a wide lens (so the two roads clearly separate around the island), flat so
      // the island reads cleanly between them
      const bulge = clamp(15 + s.len * 0.02, 16, 20); // TIGHT parallel-lane offset — a small island split, like the sketch
      const branch = new BranchPath(sampleP, sampleT, startDist, endDist, { side, bulge, rise: 0, seed: 100 + fi });
      this.scene.add(branch.buildRoad(roadMat, ROAD_HALF_WIDTH));
      this.branches.push({ path: branch, side });
      // the island sitting in the pocket between the main road and the branch
      this.placeSplitIsland((startDist + endDist) / 2, side, bulge);
      // big fork sign at the mouth, facing oncoming cars
      const sign = makeForkArrowSign(pal);
      this.placeOnTrack(sign, startDist);
      this.scene.add(sign);
    }
  }

  /** A scenic island in the pocket of a fork — a themed mound topped by a glowing
   *  beacon, so the split reads as "two roads around an island" (see the sketch). */
  private placeSplitIsland(midDist: number, side: number, bulge: number) {
    const pal = this.realm.palette;
    const r = clamp((bulge - 11) / 2, 3, 5); // small island that fits the tight gap
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
    // pocket centre: halfway between the main road centre and the branch apex,
    // which bows ~`bulge` metres out — pointAt takes a lateral offset in metres
    const p = this.track.pointAt(this.track.wrap(midDist), (side * bulge) / 2, undefined, true);
    island.position.set(p.x, p.y, p.z);
    this.scene.add(island);
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
    const tmp = new THREE.Vector3();
    for (let i = 0; i < N; i++) { T.pointAt((i / N) * T.length, 0, tmp, true); sx[i] = tmp.x; sz[i] = tmp.z; sy[i] = tmp.y; }
    return (this.terrSamp = { sx, sz, sy });
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
    const { sx, sz, sy } = this.ensureTerrSamples();
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
    const CLEAR = 0.12, CLEAR_FAR = 26;
    const fade = Math.max(0, dist - ROAD_HALF_WIDTH) / (CLEAR_FAR - ROAD_HALF_WIDTH);
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
    // branches REMOVED — the open fork corridor let the car wander off-road (OOB
    // + sink) and the separate curve felt bad. One clean road, firm walls everywhere.
    this.freeDrive.branches = [];
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
    // skill challenge, not just a straight line to hold
    let gi = 0;
    for (let d = 40; d < len - 40; d += 100) {
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
    for (let d = 130; d < len - 40; d += 300) {
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
  }

  /** Place a handful (~3-6) of BIG signature landmarks per ground realm at
   *  scenic spots well back from the road (offset ~80-140 m). Reuses the existing
   *  themed prop builders, scaled up and grouped into recognisable set-pieces
   *  (a Giza cluster, a downtown block, a grandstand row, the Hogwarts castle…).
   *  Grounded on the elevated terrain via terrainYAt, like the roadside bands. */
  private placeLandmarks(library: ModelLibrary, rand: () => number) {
    const { track, realm } = this;
    const len = track.length;
    const cols = realm.palette.crystalColors;

    // scale a built prop and offset it within a cluster's local frame (base stays
    // on the cluster's y=0 plane since the builders sit their base at the origin)
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
    const drop = (group: THREE.Object3D, frac: number, side: 1 | -1, off: number, faceRoad: boolean, yawOffset = 0) => {
      const d = track.wrap(frac * len);
      // Hero monuments are huge, so a local offset isn't enough — walk them out
      // until their whole footprint clears the ENTIRE circuit (a twisty lap can
      // otherwise come back round straight into a pyramid).
      let lat = this.clearOffset(group, side * off, 12);
      const hm = this.propMetrics(group);
      for (let tries = 0; tries < 24; tries++) {
        const q = track.pointAt(d, lat);
        if (this.roadClear(q.x, q.z, hm.reach, Math.max(6, hm.margin))) break;
        lat += side * 14;
      }
      const p = track.pointAt(d, lat);
      group.position.set(p.x, this.terrainYAt(d, lat), p.z);
      if (faceRoad) {
        const rp = track.pointAt(d, 0);
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
        drop(at(makeWaterfall(rand), 0, 0, 2.0), 0.15, -1, 100, true, Math.PI);
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
        drop(at(makeWaterfall(rand), 0, 0, 2.2), 0.62, -1, 95, true, Math.PI);
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
      obj.position.set(p.x, this.terrainYAt(w, off), p.z);
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
      // frozen falls close in, so the ice realm also has a feature you pass
      for (let i = 0; i < 2; i++) {
        const d = len * (0.24 + i * 0.42) + rand() * 30;
        const side = i % 2 === 0 ? -1 : 1;
        const w = makeWaterfall(rand);
        w.scale.multiplyScalar(1.4 + rand() * 0.6);
        place(w, d, side * (ROAD_HALF_WIDTH + 12 + rand() * 6), faceRoad(d, side));
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
      // Signature waterfalls RIGHT BESIDE the ribbon. There were already
      // waterfalls in this realm, but only as landmarks dropped 95-100 m out,
      // where they're scenery you never really register. At ~12 m off the verge
      // you drive past the spray.
      for (let i = 0; i < 3; i++) {
        const d = len * (0.17 + i * 0.29) + rand() * 40;
        const side = i % 2 === 0 ? 1 : -1;
        const w = makeWaterfall(rand);
        w.scale.multiplyScalar(1.5 + rand() * 0.7);
        place(w, d, side * (ROAD_HALF_WIDTH + 11 + rand() * 6), faceRoad(d, side));
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
      this.rafId = requestAnimationFrame(this.frame);
      return;
    }
    this.accumulator += Math.min(now - this.last, 250) / 1000;
    this.last = now;
    while (this.accumulator >= STEP) {
      this.update(STEP);
      this.accumulator -= STEP;
    }
    this.render();
    this.rafId = requestAnimationFrame(this.frame);
  };

  pause() {
    this.paused = true;
    this.sound.setEngine(0, false);
  }

  resume() {
    this.paused = false;
    this.last = performance.now();
  }

  applySettings(s: Settings) {
    this.bloomPass.enabled = s.bloom;
    if (this.gtao) this.gtao.enabled = s.ao;
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
    return max;
  }

  private endDrift() {
    if (this.driftCharge > DRIFT_MIN_CHARGE) {
      const charge = Math.min(this.driftCharge, 2.5);
      this.driftBoostT = 0.4 + charge * 0.35;
      this.sound.play("nitro");
      this.toast("DRIFT BOOST!", "#67e8f9");
    }
    this.drifting = false;
    this.driftCharge = 0;
  }

  /** Snap the car back onto the centre of the track at its current progress,
   *  facing down-course, after it's roamed off the terrain too long. No penalty. */
  private respawnOnTrack() {
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
    // Drift the cloud deck. A full revolution takes ~12 minutes, which at the
    // dome radius is a few metres a second of apparent motion — enough that the
    // sky is alive when you look at it, slow enough that it never pulls the eye
    // off the road.
    if (this.clouds) this.clouds.rotation.y += 0.0085 * dt;
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
      this.countdownT -= dt;
      if (this.countdownT <= 0) this.phase = "racing";
      return;
    }

    if (this.phase === "racing") this.updateOpponents(dt);

    if (this.phase === "finished") {
      this.speed = Math.max(0, this.speed + DECEL * dt);
      this.position = this.track.wrap(this.position + this.speed * dt);
      this.sound.setEngine(this.speed / MAX_SPEED, false, 0);
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
          standings: this.finalStandings,
        });
      }
      return;
    }

    this.raceTime += dt;
    this.trackOvertakes(dt);
    // weather turns over every ~25-45 s so a long race visibly changes mood
    this.weatherT -= dt;
    if (this.weatherT <= 0) { this.rollWeather(); this.weatherT = 25 + Math.random() * 20; }
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
        maxSpeed: this.effectiveMaxSpeed(), accel: driveAccel, turnRate: FREE_TURN_RATE, grip: FREE_GRIP,
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
    if (!this.transformed && !this.onBranch) {
      const trackLen = this.track.length;
      for (const r of this.ramps) {
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

    // lane discipline bonus
    if (!airborne && Math.abs(this.playerX) <= 1 && speedPercent > 0.3) {
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
    // lift the music with speed + nitro so the track drives harder when flat out
    // In NEON RUN the music should stay ambient and hypnotic however fast you go
    // — ramping it with speed is exactly the tension the mode is meant to avoid.
    this.sound.setMusicIntensity(this.cfg.endless
      ? 0.26 + (this.speed / MAX_SPEED) * 0.16
      : 0.32 + (this.speed / MAX_SPEED) * 0.55 + (this.nitroT > 0 ? 0.18 : 0));

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

  private updateOpponents(dt: number) {
    const mine = this.playerProgress();
    const len = this.track.length;
    this.takedownCd = Math.max(0, this.takedownCd - dt);
    for (const o of this.opponents) {
      const gap = mine - o.progress(len); // + means player ahead
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
      o.update(dt, this.track, base, this.cfg.laps);
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
      const laneGap = this.playerX - o.lane;
      if (Math.abs(d) < 4.2 && Math.abs(laneGap) < 0.62 && this.phase === "racing" && !o.finished) {
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
      this.score += bonus;
      this.stunts += tricks.length;
      this.sound.play("stunt");
      const label = (tricks.length === 2 ? "COMBO! " : "") + tricks.join(" + ");
      this.toast(`${label} +${bonus}`, "#fbbf24");
    } else if (attempted) {
      this.speed *= 0.55;
      this.crashFlash = 0.4;
      this.sound.play("land");
      this.toast("WIPEOUT!", "#f87171");
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
    const key = Math.floor(this.position / BUCKET_METERS);
    const totalBuckets = Math.ceil(this.track.length / BUCKET_METERS);
    for (let k = key - 1; k <= key + 1; k++) {
      const bucket = this.buckets.get(((k % totalBuckets) + totalBuckets) % totalBuckets);
      if (!bucket) continue;
      for (const e of bucket) {
        if (e.collectedLap !== 0) continue;
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

  private hitEntity(e: Entity, speedPercent: number) {
    switch (e.type) {
      case "gem":
        if (this.alt < 1.2) {
          const value = this.transformed ? SCORE_GEM * 2 : SCORE_GEM;
          this.collect(e);
          this.score += value;
          this.gems++;
          this.sound.play("gem");
          this.toast(`+${value}`, "#67e8f9");
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
        // reusable pad — refresh the boost while driving over it
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
    const { track } = this;

    if (this.phase !== "loading") {
      // FREE-ROAM: the car sits at its real world position, facing its heading
      // on the road the car rides the exact track height; off it, ride the
      // rolling terrain (they match at the verge, so the handoff is seamless)
      const groundY = this.freeDrive.offRoad
        ? this.groundHeightAtXZ(this.freeDrive.x, this.freeDrive.z)
        : this.track.pointAt(this.position, 0, undefined, true).y;
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
      else this.camYaw += dyaw * 0.17; // settle faster so the view leads the corner instead of trailing it
      const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);

      const targetFov = preset.fov + spd * 9 + (boosting ? 12 : 0); // speed-rush FOV kick, harder on boost
      this.camera.fov += (targetFov - this.camera.fov) * (boosting ? 0.14 : 0.08); // snappier kick, gentle relax
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
      if (this.camSnap) { this.camPos.copy(camAnchor); this.camSnap = false; }
      else this.camPos.lerp(camAnchor, 0.5);
      this.camera.position.copy(this.camPos);
      if (this.shake > 0.01) {
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
    const position = this.opponents.length
      ? (this.phase === "finished" ? this.finalPosition : this.computePosition())
      : undefined;
    drawHud(ctx, {
      mph: Math.round((this.speed / MAX_SPEED) * 180),
      score: Math.max(0, Math.round(this.score)),
      lap: Math.min(this.lap, this.cfg.laps),
      totalLaps: this.cfg.laps,
      raceTime: this.raceTime,
      nitroCharges: this.nitroCharges,
      nitroFill: this.nitroFill,
      nitroActive: this.nitroT > 0,
      transformT: this.transformed ? this.transformT : 0,
      crashFlash: this.crashFlash,
      position,
      totalRacers: this.opponents.length ? this.opponents.length + 1 : undefined,
      cameraName: CAMERA_PRESETS[this.cameraIndex].name,
      soundMuted: this.sound.isMuted,
      heldItems: this.heldItems.map((i) => ITEM_LABEL[i]),
      shieldActive: this.shieldT > 0,
      carName: CAR_SPECS[this.carId].name,
      offTrackWarn: this.offTrackT > 0 ? this.offTrackT : 0,
      endless: !!this.cfg.endless,
      distanceM: this.playerProgress(),
    }, vw, vh);

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

    drawToasts(ctx, this.toasts, vw);
    // race-drama callout (overtake / final lap) sits above the toasts; hide it
    // once finished so it doesn't fight the FINISH! banner
    if (this.callout && this.phase !== "finished") drawCallout(ctx, this.callout, vw, vh);

    if (this.phase === "countdown") {
      drawStartLights(ctx, this.countdownT, vw, vh);
    } else if (this.phase === "finished") {
      drawCenterText(ctx, "FINISH!", 64, "#fbbf24", vw, vh);
    }
  }
}
