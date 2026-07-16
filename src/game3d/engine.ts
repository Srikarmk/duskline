import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import {
  WIDTH, HEIGHT, STEP,
  ROAD_HALF_WIDTH, LANE_CENTERS, CAR_LIFT,
  MAX_SPEED, ACCEL, BRAKING, DECEL, OFF_ROAD_DECEL, OFF_ROAD_LIMIT,
  STEER_RESPONSE, STEER_RETURN, TURN_ACCEL, STEER_SPEED_FALLOFF,
  GRIP_LIMIT, LATERAL_DAMP, CENTRI_K, FREE_TURN_RATE, FREE_GRIP, WEIGHT_BRAKE_GRIP, WEIGHT_THROTTLE_GRIP,
  DRIFT_GRIP_MULT, DRIFT_STEER_MULT, DRIFT_MIN_CHARGE, DRIFT_BOOST_FACTOR,
  OUT_OF_BOUNDS_X, OUT_OF_BOUNDS_PENALTY,
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
  makeSkyDome, makeGround, makeGrassTexture,
  makeGrassField, makeRockField, makeMountainRing,
  makeGem, makeNitroCan, makeOrb, makeRamp, RAMP_SPECS, type RampKind,
  makeCrystalCluster, makeMonster,
  makeMech, makeSlash, makeFlame, makeUnderGlow,
  makeItemBox, makeMissile, makeMine, makeShieldBubble, makeBoostPad,
  makeStartGantry, varyTint, makeSpaceBackdrop,
  makeTree, makeTreeMaterials,
  type MechRig, type Placement, type TreeMats,
} from "./objects";
import { makeWeather, type WeatherSystem } from "./weather";
import { makeTunnelArch, makeTunnelPortal } from "./setpieces";
import { makeBoostGate, makeRingArch } from "./props/gates";
import { makeForkArrowSign, makeBlimp } from "./props/signage";
import { BranchPath } from "./branch";
import { FreeDrive } from "./freedrive";
import { loadPBR } from "./textures";
import { makeKart, setCarEnvTint, CAR_SPECS, CAR_IDS, type CarStat } from "./cars";
import { REALMS, pickScenery, REALM_WEATHER, REALM_AMBIENCE, REALM_TUNNELS, REALM_RIVERS, REALM_SPLITS, type RealmSpec, type SceneryKind } from "./realms";
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
import { drawHud, drawToasts, drawCenterText, drawSpeedFx, type Toast } from "../game/render";
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
}

const MODE_CONFIG: Record<GameMode, ModeConfig> = {
  classic:   { laps: 3, opponents: true,  orbs: false, monsters: false, startNitro: 1, label: "CIRCUIT" },
  timetrial: { laps: 3, opponents: false, orbs: false, monsters: false, startNitro: 1, label: "TIME TRIAL" },
  nitro:     { laps: 1, opponents: true,  orbs: false, monsters: false, startNitro: NITRO_MAX_CHARGES, label: "NITRO SPRINT" },
  transform: { laps: 3, opponents: true,  orbs: true,  monsters: true,  startNitro: 1, label: "TRANSFORMER" },
  grandprix: { laps: 2, opponents: true,  orbs: false, monsters: false, startNitro: 1, label: "GRAND PRIX" },
  spacewars: { laps: 3, opponents: true,  orbs: false, monsters: false, startNitro: 1, label: "SPACE WARS", combat: true },
};

const COLLIDE_WIDTH: Record<EntityType, number> = {
  gem: 0.36, airGem: 0.42, nitro: 0.36, orb: 0.44, ramp: 1.45, rock: 0.34, monster: 0.38, itembox: 0.56,
  boostpad: 1.0, boostgate: 0.45,
};

const BUCKET_METERS = 5;
const COLLIDE_DIST = 3.4;
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
  private hudCtx: CanvasRenderingContext2D;
  private hudCanvas: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private viewW = WIDTH;
  private viewH = HEIGHT;
  private resizeObs: ResizeObserver | null = null;
  private carId: CarId;
  private carStat: CarStat;
  private weather: WeatherSystem | null = null;
  private input = new Input();
  private sound = new Sound();
  private slashCooldown = 0;
  private bumpCd = 0;
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
  private ramps: { dist: number; power: number; lane: number; len: number; height: number }[] = [];
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
  private edgeHitCd = 0; // cooldown after clipping a ramp's side
  private lastRampPower = 1;
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
  // car "feel": spinning/steering wheels, weight transfer, drift smoke
  private playerWheels: WheelRef[] = [];
  private wheelDist = 0;   // integrated ground distance → wheel spin angle
  private prevSpeed = 0;
  private bodyPitch = 0;   // dynamic squat (accel) / dive (brake) nod
  private smoke: SmokePuff[] = [];
  private smokeTimer = 0;
  private camPos = new THREE.Vector3();
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
  private stuntAir = false;
  private spin = 0; // barrel-roll revolutions
  private flip = 0; // pitch-flip revolutions
  private swingT = 0;

  private nitroCharges = 1;
  private nitroT = 0;
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

  constructor(container: HTMLElement, options: GameOptions) {
    this.container = container;
    this.mode = options.mode;
    this.cfg = { ...MODE_CONFIG[options.mode] };
    // per-match lap override (time trial keeps its own clean-lap rule)
    if (options.laps && options.mode !== "grandprix") this.cfg.laps = options.laps;
    // Space Wars is always fought in deep space — swap the realm pick for one of
    // the two battle tubes (the 2nd, "nebula", is otherwise hidden)
    if (options.mode === "spacewars") {
      this.realm = Math.random() < 0.5 ? REALMS.void : REALMS.nebula;
    } else {
      this.realm = REALMS[options.realm ?? "forest"];
    }
    this.track = new Track(this.realm.controlPoints, this.realm.style !== "void");
    this.minimap = new Minimap(this.track);
    this.onFinish = options.onFinish;
    this.lap = 1;
    this.nitroCharges = this.cfg.startNitro;
    if (this.cfg.combat) this.heldItems = ["missile", "missile"]; // start armed
    this.carId = options.car ?? "comet";
    this.carStat = CAR_SPECS[this.carId].stat;

    // fill the container at its true aspect ratio (full-width, no letterbox)
    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);
    this.viewW = w;
    this.viewH = h;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.className = "game-layer";
    this.renderer.setClearColor(this.realm.palette.fog);
    // filmic tone mapping → richer colors + smooth highlight roll-off
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

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

    // bloom post-processing so emissive gems / rails / crystals / nitro glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // bloom runs at half resolution — it's a soft blur anyway, so it looks the
    // same but costs a quarter of the fill rate (keeps big retina buffers smooth)
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.11, 0.6, 0.95);
    this.composer.addPass(this.bloomPass);
    // final pass applies tone mapping + sRGB so the composed image is graded
    this.composer.addPass(new OutputPass());
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
    };
    const groundName = GROUND[this.realm.id] ?? "ground_forest";
    const [library] = await Promise.all([loadModels(), loadPBR(groundName)]);
    if (this.stopped) return;
    this.buildWorld(library);
    // place the free-roam body on the start line, facing down the track
    this.freeDrive.reset(this.track, 0);
    this.lastFreeDist = 0;
    this.lapProgress = 0;
    this.phase = "countdown";
  }

  // --- world building ------------------------------------------------------

  private buildWorld(library: ModelLibrary) {
    const { scene, track, realm } = this;
    const pal = realm.palette;

    const isVoid = realm.style === "void";
    scene.add(makeSkyDome(pal));

    if (!isVoid) {
      // terrain that RISES with the road near the track (roads sit grounded in
      // hills instead of floating on a flat plane); we only want makeGround's
      // material, and build our own heightfield geometry in its place
      const flatGround = makeGround(pal);
      const groundMat = flatGround.material as THREE.MeshStandardMaterial;
      groundMat.normalMap = null; // terrain fills the screen — drop the per-pixel normal cost
      groundMat.needsUpdate = true;
      flatGround.geometry.dispose();
      scene.add(this.buildGroundTerrain(groundMat));
      // horizon-filling mountain ring
      const cx = (track.bounds.minX + track.bounds.maxX) / 2;
      const cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
      const radius = Math.max(track.bounds.maxX - track.bounds.minX, track.bounds.maxZ - track.bounds.minZ) * 0.75 + 260;
      scene.add(makeMountainRing(pal, cx, cz, radius));
    }

    scene.add(new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiInt * 1.7));
    // ambient lift so shadows aren't pure black — cuts the harsh neon-on-black
    // contrast and lets the ground/scenery + their textures read clearly
    scene.add(new THREE.AmbientLight(pal.hemiSky, 0.62));
    // key light rakes across surfaces so the bump/texture detail catches light
    const sun = new THREE.DirectionalLight(pal.sun, pal.sunInt * 1.9);
    sun.position.set(60, 90, 50);
    scene.add(sun);
    // cool fill from the opposite side so nothing reads as a black silhouette
    const fill = new THREE.DirectionalLight(pal.hemiSky, 0.7);
    fill.position.set(-70, 45, -90);
    scene.add(fill);

    if (!isVoid) scene.add(track.buildVergeMesh(makeGrassTexture(pal)));
    scene.add(track.buildRoadMesh(makeRoadTexture(pal)));
    if (!isVoid) scene.add(track.buildEdgePosts(pal.rumbleB, pal.edgeLine));
    scene.add(track.buildStartLine(makeCheckerTexture()));
    if (isVoid) {
      scene.add(track.buildTube());
      scene.add(track.buildRails());
      scene.add(makeSpaceBackdrop()); // ringed planet + atmosphere in the distance
    }

    // tint every car's reflections toward this realm's sky before building them
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
    this.playerBody.add(this.carModel, mech.group, this.underGlow);
    this.playerRoot.add(this.playerBody);
    scene.add(this.playerRoot);
    this.playerWheels = collectWheels(this.carModel);
    this.buildSmoke();

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
    this.weather = makeWeather(REALM_WEATHER[realm.id], pal);
    scene.add(this.weather.object);

    this.decorate(library);
  }

  private spawnOpponents() {
    // F1-style standing grid: two staggered columns, cars lined up one behind
    // the other. The player starts at the BACK on the start line (dist 0), so
    // the whole field is arrayed ahead — a proper grid you launch from, not
    // karts that pop in mid-race. Slot 0 = pole (front, fastest qualifier);
    // higher slots sit further back; the player is the backmost slot. Each rival
    // drives a different kart type for real variety.
    const rowStep = 5.0;    // metres each grid slot sits ahead of the one behind
    const colLane = 0.34;   // the two staggered columns, ± this in playerX units
    const gridN = Math.min(OPPONENT_COUNT, OPPONENTS.length);
    const playerSlot = gridN;                 // player is last (behind every rival)
    const slotDist = (slot: number) => (playerSlot - slot) * rowStep; // ahead > 0
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
      // spread the field but keep it FAST: pole (1.12) down to tail (0.98), so
      // rivals are genuinely competitive with the player, not stragglers
      opp.pace = 1.12 - (i / Math.max(1, gridN - 1)) * 0.14;
      opp.place(this.track); // snap onto the grid now so the field lines up during the countdown
      this.opponents.push(opp);
    }
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

  private spawnSmoke(x: number, y: number, z: number, tanx: number, tanz: number) {
    const puff = this.smoke.find((s) => s.life <= 0);
    if (!puff) return;
    puff.max = 0.5 + Math.random() * 0.22;
    puff.life = puff.max;
    puff.spr.position.set(x + (Math.random() - 0.5) * 0.25, y, z + (Math.random() - 0.5) * 0.25);
    puff.spr.scale.setScalar(0.45 + Math.random() * 0.2);
    puff.spr.visible = true;
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
    if (this.carModel) this.carModel.rotation.x = this.bodyPitch;

    // drifting / sliding rear tyres throw smoke (grounded and moving only)
    const smoking = (this.drifting || this.slipping) && this.alt < 0.35 && this.speed > 6 && !this.transformed;
    if (smoking) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.025;
        const tan = this.pathTangent(0);
        const wp = new THREE.Vector3();
        for (const w of this.playerWheels) {
          if (w.front) continue;
          w.obj.getWorldPosition(wp);
          this.spawnSmoke(wp.x, wp.y - w.r * 0.4, wp.z, tan.x, tan.z);
        }
      }
    }
    this.updateSmoke(dt);
  }

  private sceneryObject(kind: SceneryKind, library: ModelLibrary, rand: () => number): THREE.Object3D {
    if (kind === "crystal") return makeCrystalCluster(rand, this.realm.palette.crystalColors);
    // textured procedural trees (bark trunk + leaf foliage) instead of the flat
    // low-poly kit models — shared materials so hundreds stay cheap
    if (this.treeMats) {
      if (kind === "treeA") return makeTree(rand, this.treeMats, "pine");
      if (kind === "treeB") return makeTree(rand, this.treeMats, "round");
      if (kind === "treeDark") return makeTree(rand, this.treeMats, "tall");
    }
    // themed-realm props (self-contained procedural builders)
    switch (kind) {
      case "pyramid": return makePyramid(rand);
      case "obelisk": return makeObelisk(rand);
      case "sphinx": return makeSphinx(rand);
      case "palm": return makePalm(rand);
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
      case "treeA": obj = instantiate(library, "treeA", 3 + rand() * 2.2); break;
      case "treeB": obj = instantiate(library, "treeB", 3 + rand() * 2.2); break;
      case "treeDark": obj = instantiate(library, "treeDark", 2.5 + rand() * 2); break;
      case "mushroom": obj = instantiate(library, "mushroom", 1.2 + rand() * 1.4); break;
      case "mushroomTall": obj = instantiate(library, "mushroomTall", 1.6 + rand() * 1.6); break;
      case "rockA": obj = instantiate(library, "rockA", 2 + rand() * 2.5); break;
      case "rockB": obj = instantiate(library, "rockB", 2 + rand() * 2.5); break;
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
  private placeTunnels() {
    const pal = this.realm.palette;
    const len = this.track.length;
    for (const t of REALM_TUNNELS[this.realm.id] ?? []) {
      const d0 = t.at * len;
      const d1 = d0 + t.len;
      const entry = makeTunnelPortal(pal);
      this.placeOnTrack(entry, d0);
      this.scene.add(entry);
      const exit = makeTunnelPortal(pal);
      this.placeOnTrack(exit, d1, Math.PI); // flip so its face points back out
      this.scene.add(exit);
      for (let d = d0 + 3; d < d1 - 3; d += 2.6) {
        const arch = makeTunnelArch(pal);
        this.placeOnTrack(arch, d);
        this.scene.add(arch);
      }
    }
  }

  /** River crossings: a railed bridge over water, with a mega jump ramp just
   *  before it and an air-gem arc across the gap. */
  private placeRivers() {
    const pal = this.realm.palette;
    const len = this.track.length;
    for (const at of REALM_RIVERS[this.realm.id] ?? []) {
      const d = at * len;
      const bridge = makeRiverBridge(pal);
      this.placeOnTrack(bridge, d);
      this.scene.add(bridge);
      // launch ramp a bit before the bridge, so you jump the river
      const rampD = this.track.wrap(d - 18);
      this.addEntity("ramp", rampD, 0, makeRamp("mega"), 0, RAMP_SPECS.mega.power);
      this.ramps.push({ dist: rampD, power: RAMP_SPECS.mega.power, lane: 0, len: RAMP_SPECS.mega.l, height: RAMP_SPECS.mega.h });
      for (const off of [16, 22, 28]) {
        this.addEntity("airGem", rampD + off, 0, makeGem(0xfbbf24, true), AIR_GEM_ALT);
      }
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
  private buildGroundTerrain(mat: THREE.Material): THREE.Mesh {
    const T = this.track;
    const N = 400; // track polyline samples (x,z + centreline height)
    const sx = new Float64Array(N), sz = new Float64Array(N), sy = new Float64Array(N);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < N; i++) { T.pointAt((i / N) * T.length, 0, tmp, true); sx[i] = tmp.x; sz[i] = tmp.z; sy[i] = tmp.y; }
    const b = T.bounds, margin = 470, cell = 12;
    const minX = b.minX - margin, minZ = b.minZ - margin;
    const cols = Math.ceil((b.maxX + margin - minX) / cell) + 1;
    const rows = Math.ceil((b.maxZ + margin - minZ) / cell) + 1;
    const near = 42, fall = 130; // full track height within `near` m, easing to base over `fall`
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = minX + c * cell, z = minZ + r * cell;
      let best = 1e18, by = 0; // nearest track sample's height
      for (let i = 0; i < N; i++) { const dx = x - sx[i], dz = z - sz[i]; const d = dx * dx + dz * dz; if (d < best) { best = d; by = sy[i]; } }
      const dist = Math.sqrt(best);
      const t = dist <= near ? 1 : dist >= near + fall ? 0 : 1 - (dist - near) / fall;
      pos.push(x, by * (t * t * (3 - 2 * t)), z);
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

  private decorate(library: ModelLibrary) {
    const rand = mulberry32(1337);
    const { track, realm } = this;
    const len = track.length;
    const pal = realm.palette;
    this.placeTunnels();
    this.placeRivers();
    // this.placeBranches(); // disabled for free-roam v1 — the walls make branches
    // unreachable; re-enable once free-roam opens the corridor at forks
    this.placeSkyProps();
    this.treeMats = makeTreeMaterials(pal); // shared bark/foliage tree materials
    const lane = () => LANE_CENTERS[Math.floor(rand() * 3)];
    // big monuments/buildings shouldn't hug the verge (they'd overhang the road)
    const LANDMARK_KINDS = new Set<SceneryKind>([
      "pyramid", "tower", "gatehouse", "grandstand", "floodlight", "pitBuilding", "skyscraper",
      "hogwartsCastle", "waterfall", "quidditchHoop",
    ]);

    if (realm.style === "void") {
      this.decorateVoid(library, rand);
    } else {
      // roadside scenery — three bands each side for depth. Spacing is tuned so
      // the (now longer) tracks stay lush without ballooning the draw-call count
      // (that was the top-speed lag: thousands of separate meshes).
      for (let d = 0; d < len; d += 5.2) {
        for (const side of [-1, 1]) {
          // near band (dense, right by the road)
          if (rand() < 0.85) {
            const kind = pickScenery(realm, rand);
            const obj = this.sceneryObject(kind, library, rand);
            // keep big monuments off the verge so they don't overhang the track
            const nearOff = LANDMARK_KINDS.has(kind) ? 34 + rand() * 22 : 5 + rand() * 13;
            const off = side * (ROAD_HALF_WIDTH + nearOff);
            const p = track.pointAt(d + rand() * 4, off);
            obj.position.set(p.x, 0, p.z);
            this.scene.add(obj);
          }
          // mid band
          if (rand() < 0.55) {
            const obj = this.sceneryObject(pickScenery(realm, rand), library, rand);
            const off = side * (ROAD_HALF_WIDTH + 20 + rand() * 36);
            const p = track.pointAt(d + rand() * 4, off);
            obj.position.set(p.x, 0, p.z);
            obj.scale.multiplyScalar(1.1 + rand() * 0.5);
            this.scene.add(obj);
          }
          // far band (big, fills the mid-distance out toward the mountains)
          if (rand() < 0.28) {
            const obj = this.sceneryObject(pickScenery(realm, rand), library, rand);
            const off = side * (ROAD_HALF_WIDTH + 58 + rand() * 70);
            const p = track.pointAt(d + rand() * 5, off);
            obj.position.set(p.x, 0, p.z);
            obj.scale.multiplyScalar(1.5 + rand() * 1.1);
            this.scene.add(obj);
          }
        }
      }

      // ground clutter fills the empty flats
      const centerline = track.sampleXZ(240);
      const grass = this.scatter(centerline, rand, 4200, ROAD_HALF_WIDTH * 1.3 + 3, 150);
      this.scene.add(makeGrassField(pal, grass));
      const pebbles = this.scatter(centerline, rand, 1100, ROAD_HALF_WIDTH * 1.3 + 4, 170);
      this.scene.add(makeRockField(pal, pebbles));
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

    // boost pads (flat escalator strip) — sparse now, and never inside a fork
    // (forks and gates carry the surges, so the pads don't pile on redundantly)
    for (let d = 200; d < len - 50; d += 540) {
      if (this.inSplitZone(d)) continue;
      this.addEntity("boostpad", d, 0, makeBoostPad(), 0.02);
    }

    // a few free-standing boost gates on the straights (the forks carry their own)
    for (let d = 400; d < len - 60; d += 840) {
      if (this.inSplitZone(d)) continue;
      const l = LANE_CENTERS[Math.floor(rand() * 3)];
      this.addEntity("boostgate", d, l, makeBoostGate(rand), 0.1);
    }

    // decorative checkpoint hoops you pass under (pure cosmetic set-dressing)
    for (let d = 240; d < len - 60; d += 690) {
      this.placeOnTrack(makeRingArch(rand), d);
    }

    // (road-blocking rocks removed — they were pure race-stoppers, not fun)

    // nitro canisters
    for (let d = 150; d < len - 40; d += 280) {
      this.addEntity("nitro", d, lane(), makeNitroCan());
    }

    // ramps + air gem arcs — cycle the ramp kinds for variety (each launches
    // with its own power, and the air-gem arc stretches to match)
    const rampKinds: RampKind[] = ["standard", "mega", "kicker", "wide"];
    let ri = 0;
    for (let d = 200; d < len - 60; d += 520) {
      const kind = rampKinds[ri % rampKinds.length];
      const l = LANE_CENTERS[ri % LANE_CENTERS.length]; // each ramp sits in ONE lane
      ri++;
      const spec = RAMP_SPECS[kind];
      this.addEntity("ramp", d, l, makeRamp(kind), 0, spec.power);
      this.ramps.push({ dist: this.track.wrap(d), power: spec.power, lane: l, len: spec.l, height: spec.h });
      for (const off of [15, 21, 27]) {
        const gap = Math.round(off * (0.7 + 0.35 * spec.power));
        this.addEntity("airGem", d + gap, l, makeGem(0xfbbf24, true), AIR_GEM_ALT);
      }
    }

    // transform orbs + monsters
    if (this.cfg.orbs) {
      for (let d = 120; d < len - 60; d += 460) {
        this.addEntity("orb", d, lane(), makeOrb());
      }
    }
    if (this.cfg.monsters) {
      for (let d = 240; d < len - 60; d += 150) {
        this.addEntity("monster", d, lane(), makeMonster(rand));
      }
    }

    // item boxes — power-ups, a row across the lanes so you can always grab one.
    // Space Wars packs them far tighter so the tube is a running firefight.
    const boxGap = this.cfg.combat ? 85 : 210;
    for (let d = 110; d < len - 40; d += boxGap) {
      for (const l of LANE_CENTERS) {
        this.addEntity("itembox", d, l, makeItemBox(), 0.2);
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
    const { bounds } = this.track;
    const pts: Placement[] = [];
    let tries = 0;
    while (pts.length < count && tries < count * 4) {
      tries++;
      const x = bounds.minX - reach + rand() * (bounds.maxX - bounds.minX + reach * 2);
      const z = bounds.minZ - reach + rand() * (bounds.maxZ - bounds.minZ + reach * 2);
      let near = Infinity;
      for (const c of centerline) {
        const dx = c.x - x, dz = c.z - z;
        const dd = dx * dx + dz * dz;
        if (dd < near) near = dd;
      }
      if (near < minDist * minDist) continue;
      pts.push({ x, z, y: 0, s: 0.6 + rand() * 1.1, r: rand() * Math.PI * 2 });
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
      { name: "YOU", isPlayer: true, progress: this.playerProgress() },
      ...this.opponents.map((o) => ({ name: o.name, isPlayer: false, progress: o.progress(len) })),
    ];
    racers.sort((a, b) => b.progress - a.progress);
    return racers.map((r, i) => ({ name: r.name, isPlayer: r.isPlayer, position: i + 1 }));
  }

  private update(dt: number) {
    this.time += dt;
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter((t) => t.t > 0);
    this.crashFlash = Math.max(0, this.crashFlash - dt);
    this.swingT = Math.max(0, this.swingT - dt);
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
      this.sound.setEngine(0.05, false);
      this.countdownT -= dt;
      if (this.countdownT <= 0) this.phase = "racing";
      return;
    }

    if (this.phase === "racing") this.updateOpponents(dt);

    if (this.phase === "finished") {
      this.speed = Math.max(0, this.speed + DECEL * dt);
      this.position = this.track.wrap(this.position + this.speed * dt);
      this.sound.setEngine(this.speed / MAX_SPEED, false);
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
    this.freeDrive.step(
      {
        throttle: this.input.accelerate || this.transformed,
        brake: this.input.brake && !this.transformed,
        steer: this.stuntAir ? 0 : -this.steerInput, // smoothed analog; -steer so Right turns right
        handbrake,
      },
      dt, this.track,
      { maxSpeed: this.effectiveMaxSpeed(), accel: driveAccel, turnRate: FREE_TURN_RATE, grip: FREE_GRIP },
    );
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
      this.spin += rawSteer * 1.25 * dt;
      const pitchIn = this.input.accelerate ? 1 : this.input.brake ? -1 : 0;
      this.flip += pitchIn * 1.25 * dt;
      this.carYaw += (0 - this.carYaw) * Math.min(1, dt * 6);
    } else {
      const yawTarget = clamp(this.freeDrive.slip * 0.05, -0.45, 0.45) + this.steer * 0.08;
      this.carYaw += (yawTarget - this.carYaw) * Math.min(1, dt * 8);
    }

    // nitro
    this.nitroT = Math.max(0, this.nitroT - dt);
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
    let edgeHit: (typeof this.ramps)[number] | null = null; // clipped its side
    this.edgeHitCd = Math.max(0, this.edgeHitCd - dt);
    if (!this.transformed && !this.onBranch) {
      const trackLen = this.track.length;
      for (const r of this.ramps) {
        let gap = this.position - r.dist;
        if (gap > trackLen / 2) gap -= trackLen;
        else if (gap < -trackLen / 2) gap += trackLen;
        if (gap < -r.len / 2 || gap > r.len / 2) continue; // not on this ramp lengthwise
        const off = Math.abs(this.playerX - r.lane);
        if (off < 0.28) {                    // centred in the lane → clean ride-up
          onRamp = r;
          rampT = (gap + r.len / 2) / r.len; // 0 at the base → 1 at the lip
          break;
        } else if (off < 0.5) {              // clipped the ramp's SIDE edge
          edgeHit = r;
        }
      }
    }
    // hitting a ramp side-on: no launch — the car is DEFLECTED off it (a
    // world-space shove away from the ramp) and bends/rolls, with a speed hit.
    if (edgeHit && !onRamp && this.alt < 0.4 && this.edgeHitCd <= 0) {
      this.edgeHitCd = 0.5;
      const t = this.track.tangentAt(this.position);
      const rx = t.z, rz = -t.x;                             // road "right" (unit)
      const away = Math.sign(this.playerX - edgeHit.lane) || 1;
      this.freeDrive.vx += rx * away * 9;                    // shove off the ramp
      this.freeDrive.vz += rz * away * 9;
      this.freeDrive.speed *= 0.72;
      this.spin = 0.28 * away;                               // visible bend/roll
      this.shake = Math.max(this.shake, 0.5);
      this.crashFlash = 0.25;
      this.sound.play("bump");
      this.toast("CLIPPED!", "#fca5a5");
    }

    // altitude
    if (onRamp) {
      // riding up the face: altitude is driven by your position along the ramp
      const peak = onRamp.height * onRamp.power;
      this.alt = Math.max(this.alt, peak * rampT);
      this.vAlt = 0;
      this.stuntAir = true;
      this.lastRampPower = onRamp.power;
      this.lastRampT = rampT;
      if (!this.wasOnRamp) {
        this.wasOnRamp = true;
        this.sound.play("jump");
      }
    } else {
      if (this.wasOnRamp) {
        this.wasOnRamp = false;
        if (this.lastRampT > 0.6) {
          // launched cleanly off the lip → arc through the air
          this.vAlt = RAMP_LAUNCH * this.lastRampPower * clamp(speedPercent, 0.4, 1);
          this.spin = 0;
          this.playerVX = 0;
          this.toast(this.lastRampPower > 1.3 ? "MEGA JUMP!" : "JUMP!", "#c084fc");
        } else if (this.lastRampT > 0.2 && this.alt > 0.4) {
          // slid off the SIDE of the ramp mid-climb → a clumsy tumble, not a jump
          this.speed *= 0.6;
          this.playerVX += (Math.random() - 0.5) * 0.8;
          this.spin = 0.3;
          this.crashFlash = 0.35;
          this.shake = Math.max(this.shake, 0.6);
          this.sound.play("crash");
          this.toast("SIDESWIPE!", "#f87171");
        }
      }
      if (this.transformed && this.input.fly) {
        this.vAlt = Math.min(this.vAlt + FLY_LIFT * dt, 9);
      } else if (this.alt > 0) {
        this.vAlt -= GRAVITY * dt;
      }
      this.alt += this.vAlt * dt;
    }
    if (this.alt >= MAX_ALT) {
      this.alt = MAX_ALT;
      this.vAlt = Math.min(this.vAlt, 0);
    }
    if (this.alt <= 0) {
      this.alt = 0;
      this.vAlt = 0;
      if (this.stuntAir) this.land();
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

    // out of bounds
    if (Math.abs(this.playerX) > OUT_OF_BOUNDS_X) {
      this.playerX = Math.sign(this.playerX) * 1.3; // nudge back to the verge, not the centre
      this.playerVX = 0;
      this.speed *= 0.55; // less of a dead stop
      this.score -= OUT_OF_BOUNDS_PENALTY;
      this.penalties += OUT_OF_BOUNDS_PENALTY;
      this.crashFlash = 0.4;
      this.shake = Math.max(this.shake, 0.8);
      this.sound.play("oob");
      this.toast(`OUT OF BOUNDS -${OUT_OF_BOUNDS_PENALTY}`, "#f87171");
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
    this.sound.setEngine(this.speed / MAX_SPEED, this.nitroT > 0);

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
          // snapshot placement + order at the line so the results screen agrees
          this.finalStandings = this.computeStandings();
          this.finalPosition = this.finalStandings.find((s) => s.isPlayer)?.position ?? 1;
          this.score += SCORE_FINISH;
          this.sound.play("finish");
          this.toast(`FINISH +${SCORE_FINISH}`, "#fbbf24");
        } else {
          this.sound.play("lap");
          this.toast(`LAP ${this.lap}/${this.cfg.laps}`, "#c084fc");
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
    for (const o of this.opponents) {
      const gap = mine - o.progress(len); // + means player ahead
      // each racer holds its own pace so the field strings out; only a gentle
      // rubber-band keeps it competitive around the player
      // rubber-band: rivals dig in HARD when you pull away (up to +26%) and ease
      // off only slightly when they're ahead — keeps the race close and tense
      const base = MAX_SPEED * o.pace * (1 + clamp(gap / 240, -0.06, 0.26));
      o.update(dt, this.track, base, this.cfg.laps);

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

      // side-by-side bumping with the player
      let d = o.dist - this.position;
      if (d > len / 2) d -= len;
      if (d < -len / 2) d += len;
      if (Math.abs(d) < 4 && Math.abs(this.playerX - o.lane) < 0.55) {
        const dir = this.playerX - o.lane >= 0 ? 1 : -1;
        this.playerX = clamp(this.playerX + dir * 0.05, -OUT_OF_BOUNDS_X, OUT_OF_BOUNDS_X);
        o.lane = clamp(o.lane - dir * 0.05, -0.95, 0.95);
        o.targetLane = o.lane;
        this.speed *= 0.99;
        o.speed *= 0.99;
        if (this.bumpCd <= 0 && this.phase === "racing") {
          this.sound.play("bump");
          this.toast("BUMP!", "#fca5a5");
          this.bumpCd = 0.5;
        }
      }
    }

    // an opponent occasionally drops a mine on the road behind it (Space Wars
    // rivals are far more trigger-happy, and the tube holds more live mines)
    const mineChance = OPPONENT_MINE_CHANCE * (this.cfg.combat ? 5 : 1);
    const mineCap = this.cfg.combat ? 28 : 14;
    if (this.opponents.length && this.mines.length < mineCap && Math.random() < mineChance * dt) {
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
      if (Math.abs(gap) > 3) continue;
      if (Math.abs(this.playerX - e.lateral) > COLLIDE_WIDTH.monster) continue;
      if (this.alt > 1.6) continue;

      if (this.transformed && this.slashCooldown <= 0) {
        this.collect(e);
        this.score += SCORE_MONSTER;
        this.swingT = SWING_DURATION;
        this.slashCooldown = 0.45;
        this.sound.play("slash");
        this.toast(`SLASH +${SCORE_MONSTER}`, "#67e8f9");
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
        this.speed = Math.min(this.speed, MAX_SPEED * 0.12);
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
        if (Math.abs(this.playerX - e.lateral) > COLLIDE_WIDTH[e.type]) continue;
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
        if (this.alt < 1.2 && !this.transformed) {
          this.collect(e);
          this.transformed = true;
          this.transformT = TRANSFORM_DURATION;
          this.sound.play("transform");
          this.toast("TRANSFORMED!", "#f0abfc");
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
            this.score += SCORE_SMASH;
            this.swingT = SWING_DURATION;
            this.sound.play("smash");
            this.toast(`SMASH +${SCORE_SMASH}`, "#f0abfc");
          } else if (this.shieldT > 0) {
            this.collect(e); // plow through under shield
            this.toast("BLOCKED", "#67e8f9");
          } else {
            this.speed = Math.min(this.speed, MAX_SPEED * 0.15);
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
      const groundY = this.track.pointAt(this.position, 0, undefined, true).y;
      this.playerRoot.position.set(this.freeDrive.x, groundY + this.alt + CAR_LIFT, this.freeDrive.z);
      this.playerRoot.rotation.order = "YXZ";
      this.playerRoot.rotation.y = this.freeDrive.heading;
      // nose pitch: rides up ramps, arcs in the air, follows the road slope on
      // the ground (computed + smoothed in update) — no more flat "sinking"
      this.playerRoot.rotation.x = this.carPitch;

      // pitch = flips + air tilt, yaw = steer/drift heading, roll = barrel roll +
      // lean + the road's bank (so the car sits flat on banked corners)
      const bankRoll = (!this.onBranch && this.alt < 0.4) ? track.bankAt(this.position) : 0;
      this.playerBody.rotation.x = this.flip * Math.PI * 2; // barrel-roll/flip stunts only
      this.playerBody.rotation.y = this.carYaw;
      this.playerBody.rotation.z =
        this.spin * Math.PI * 2 - this.steer * 0.09 - (this.drifting ? this.driftDir * 0.1 : 0) + bankRoll;

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
      // monsters are positioned in updateMonsters (they move + charge)

      // FREE-ROAM chase camera: sit behind + above the car along its heading and
      // look ahead of it. FOV kicks with speed/boost; banks slightly with steer.
      const preset = CAMERA_PRESETS[this.cameraIndex];
      const spd = this.speed / MAX_SPEED;
      const fx = Math.sin(this.freeDrive.heading), fz = Math.cos(this.freeDrive.heading);

      const targetFov = preset.fov + spd * 4 + (boosting ? 4 : 0);
      this.camera.fov += (targetFov - this.camera.fov) * 0.06;
      this.camera.updateProjectionMatrix();

      const camAnchor = new THREE.Vector3(
        this.freeDrive.x - fx * preset.back,
        groundY + preset.height + this.alt * 0.55,
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
        groundY + preset.lookHeight + this.alt * 0.8,
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

    if (this.phase === "countdown") {
      const n = Math.ceil(this.countdownT - 0.5);
      drawCenterText(ctx, n > 0 ? String(n) : "GO!", 72, n > 0 ? "#e8e0ff" : "#a7f3d0", vw, vh);
    } else if (this.phase === "finished") {
      drawCenterText(ctx, "FINISH!", 64, "#fbbf24", vw, vh);
    }
  }
}
