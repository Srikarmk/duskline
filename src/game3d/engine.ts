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
  GRIP_LIMIT, LATERAL_DAMP, CENTRI_K, WEIGHT_BRAKE_GRIP, WEIGHT_THROTTLE_GRIP,
  DRIFT_GRIP_MULT, DRIFT_STEER_MULT, DRIFT_MIN_CHARGE, DRIFT_BOOST_FACTOR,
  OUT_OF_BOUNDS_X, OUT_OF_BOUNDS_PENALTY,
  NITRO_MAX_CHARGES, NITRO_DURATION, NITRO_SPEED_FACTOR,
  GRAVITY, RAMP_LAUNCH, FLY_LIFT, MAX_ALT, AIR_GEM_ALT, AIR_GEM_TOLERANCE,
  TRANSFORM_DURATION, TRANSFORM_SPEED_FACTOR,
  SCORE_GEM, SCORE_AIR_GEM, SCORE_STUNT, SCORE_LANE_BONUS, SCORE_SMASH,
  SCORE_MONSTER, SCORE_FINISH, LANE_BONUS_SECONDS,
  OPPONENTS, CAMERA_PRESETS, SWING_DURATION,
  PAD_BOOST_DURATION,
  ITEM_BOOST_DURATION, ITEM_BOOST_FACTOR, ITEM_SHIELD_DURATION,
  MISSILE_SPEED, MISSILE_MAX_DIST, STUN_DURATION, ITEM_LATERAL_TOL,
  SCORE_HIT, OPPONENT_MINE_CHANCE,
} from "./constants";
import { Track, makeRoadTexture, makeCheckerTexture } from "./track";
import { loadModels, instantiate, type ModelLibrary } from "./assets";
import {
  makeSkyDome, makeGround, makeGroundTexture, makeGrassTexture,
  makeGrassField, makeRockField, makeMountainRing,
  makeGem, makeNitroCan, makeOrb, makeRamp, RAMP_SPECS, type RampKind,
  makeCrystalCluster, makeMonster,
  makeMech, makeSlash, makeFlame, makeUnderGlow,
  makeItemBox, makeMissile, makeMine, makeShieldBubble, makeBoostPad,
  makeParticleField, makeStartGantry, varyTint, makeSpaceBackdrop,
  makeTree, makeTreeMaterials,
  type MechRig, type Placement, type ParticleField, type TreeMats,
} from "./objects";
import { loadPBR } from "./textures";
import { makeKart, CAR_SPECS, CAR_IDS, type CarStat } from "./cars";
import { REALMS, pickScenery, type RealmSpec, type SceneryKind } from "./realms";
import { Opponent } from "./ai";
import { Minimap } from "./minimap";
import { Sound } from "./sound";
import { loadSetting, loadSettings, type Settings } from "../ui/settings";
import { Input } from "../game/input";
import { drawHud, drawToasts, drawCenterText, drawSpeedFx, type Toast } from "../game/render";
import type { GameMode, GameResult, GameOptions, RaceStanding, CarId } from "../game/engine";

type Phase = "loading" | "countdown" | "racing" | "finished";

type EntityType = "gem" | "airGem" | "nitro" | "orb" | "ramp" | "rock" | "monster" | "itembox" | "boostpad";

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
}

const MODE_CONFIG: Record<GameMode, ModeConfig> = {
  classic:   { laps: 3, opponents: true,  orbs: false, monsters: false, startNitro: 1, label: "CIRCUIT" },
  timetrial: { laps: 3, opponents: false, orbs: false, monsters: false, startNitro: 1, label: "TIME TRIAL" },
  nitro:     { laps: 1, opponents: true,  orbs: false, monsters: false, startNitro: NITRO_MAX_CHARGES, label: "NITRO SPRINT" },
  transform: { laps: 3, opponents: true,  orbs: true,  monsters: true,  startNitro: 1, label: "TRANSFORMER" },
  grandprix: { laps: 2, opponents: true,  orbs: false, monsters: false, startNitro: 1, label: "GRAND PRIX" },
};

const COLLIDE_WIDTH: Record<EntityType, number> = {
  gem: 0.36, airGem: 0.42, nitro: 0.36, orb: 0.44, ramp: 1.45, rock: 0.34, monster: 0.38, itembox: 0.56,
  boostpad: 1.0,
};

const BUCKET_METERS = 5;
const COLLIDE_DIST = 3.4;

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
  private particles: ParticleField | null = null;
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
  private ramps: { dist: number; power: number }[] = [];
  private treeMats: TreeMats | null = null;
  private opponents: Opponent[] = [];
  private playerRoot = new THREE.Group();
  private playerBody = new THREE.Group();
  private carModel: THREE.Group | null = null;
  private mech: MechRig | null = null;
  private slash: THREE.Mesh | null = null;
  private flames: THREE.Mesh[] = [];
  private underGlow: THREE.Mesh | null = null;
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
  private stuntAir = false;
  private spin = 0; // barrel-roll revolutions
  private flip = 0; // pitch-flip revolutions
  private swingT = 0;

  private nitroCharges = 1;
  private nitroT = 0;
  private transformed = false;
  private transformT = 0;

  // power-ups
  private heldItem: ItemKind | null = null;
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
    this.realm = REALMS[options.realm ?? "forest"];
    this.track = new Track(this.realm.controlPoints);
    this.minimap = new Minimap(this.track);
    this.onFinish = options.onFinish;
    this.lap = 1;
    this.nitroCharges = this.cfg.startNitro;
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
    this.renderer.toneMappingExposure = 1.35;

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
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.14, 0.6, 0.92);
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
    this.bloomPass.setSize(w * dpr, h * dpr);
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
    this.composer.dispose();
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private async init() {
    // load the CC0 PBR textures for this realm alongside the models
    const groundName = this.realm.style === "void" ? "ground_peaks" : `ground_${this.realm.id}`;
    const [library] = await Promise.all([loadModels(), loadPBR(groundName)]);
    if (this.stopped) return;
    this.buildWorld(library);
    this.phase = "countdown";
  }

  // --- world building ------------------------------------------------------

  private buildWorld(library: ModelLibrary) {
    const { scene, track, realm } = this;
    const pal = realm.palette;

    const isVoid = realm.style === "void";
    scene.add(makeSkyDome(pal));

    if (!isVoid) {
      scene.add(makeGround(makeGroundTexture(pal)));
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

    // player rig — a procedural kart of the chosen type
    this.carModel = makeKart(this.carId, CAR_SPECS[this.carId].color);
    const mech = makeMech();
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
    this.particles = makeParticleField(pal, track.bounds, realm.id);
    scene.add(this.particles.points);

    this.decorate(library);
  }

  private spawnOpponents() {
    // Clean starting grid: 3 columns (lanes) × rows, staggered so no two karts
    // overlap. The grid is shifted so the PLAYER's cell sits on the start line
    // (dist 0, lap 1). Karts in rows ahead get positive dist (also lap 1); karts
    // behind wrap to the end of the loop on lap 0 so ranking-by-progress reads
    // them as behind rather than a whole lap ahead. Each opponent drives a
    // different kart type, so the grid shows real variety.
    const cols = 3;
    const rowGap = 8;        // meters between grid rows
    const colStagger = 2.6;  // dist offset per column within a row
    const total = OPPONENTS.length + 1;
    const playerPos = Math.floor(total / 2); // mid-pack (P5 of 9)

    const cellDist = (pos: number) =>
      -(Math.floor(pos / cols) * rowGap + (pos % cols) * colStagger);
    const cellLane = (pos: number) => LANE_CENTERS[pos % cols];
    const playerRef = cellDist(playerPos); // shift so the player's cell => 0

    const n = OPPONENTS.length;
    let pos = 0;
    for (let i = 0; i < n; i++) {
      if (pos === playerPos) pos++; // reserve the player's grid slot
      const spec = OPPONENTS[i];
      const gridDist = cellDist(pos) - playerRef; // ahead > 0, behind < 0
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
      this.scene.add(car);
      const startDist = gridDist >= 0 ? gridDist : this.track.wrap(gridDist);
      const opp = new Opponent(car, spec.color, spec.name, spec.skill, startDist);
      opp.lane = cellLane(pos);
      opp.lap = gridDist >= 0 ? 1 : 0;
      opp.flames = flames;
      // spread the field: distinct top-speed pace from fastest (1.02) to
      // slowest (0.86), so racers string out instead of clustering
      opp.pace = 1.02 - (i / Math.max(1, n - 1)) * 0.16;
      this.opponents.push(opp);
      pos++;
    }
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
    if (type === "ramp" || type === "rock" || type === "boostpad") {
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

  private decorate(library: ModelLibrary) {
    const rand = mulberry32(1337);
    const { track, realm } = this;
    const len = track.length;
    const pal = realm.palette;
    this.treeMats = makeTreeMaterials(pal); // shared bark/foliage tree materials
    const lane = () => LANE_CENTERS[Math.floor(rand() * 3)];

    if (realm.style === "void") {
      this.decorateVoid(library, rand);
    } else {
      // roadside scenery — three bands each side for depth, so the flats aren't
      // empty (the sparse world felt "empty/anxious")
      for (let d = 0; d < len; d += 3.3) {
        for (const side of [-1, 1]) {
          // near band (dense, right by the road)
          if (rand() < 0.95) {
            const obj = this.sceneryObject(pickScenery(realm, rand), library, rand);
            const off = side * (ROAD_HALF_WIDTH + 5 + rand() * 13);
            const p = track.pointAt(d + rand() * 3, off);
            obj.position.set(p.x, 0, p.z);
            this.scene.add(obj);
          }
          // mid band
          if (rand() < 0.7) {
            const obj = this.sceneryObject(pickScenery(realm, rand), library, rand);
            const off = side * (ROAD_HALF_WIDTH + 20 + rand() * 36);
            const p = track.pointAt(d + rand() * 3, off);
            obj.position.set(p.x, 0, p.z);
            obj.scale.multiplyScalar(1.1 + rand() * 0.5);
            this.scene.add(obj);
          }
          // far band (big, fills the mid-distance out toward the mountains)
          if (rand() < 0.4) {
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

    // boost pads — drive over the arrows for a speed surge (something to aim for)
    for (let d = 170; d < len - 50; d += 300) {
      this.addEntity("boostpad", d, 0, makeBoostPad(), 0.14);
    }

    // rocks on the road
    for (let d = 90; d < len - 40; d += 200) {
      const rock = instantiate(library, rand() < 0.5 ? "rockA" : "rockB", 2.2);
      this.addEntity("rock", d, lane(), rock);
    }

    // nitro canisters
    for (let d = 150; d < len - 40; d += 280) {
      this.addEntity("nitro", d, lane(), makeNitroCan());
    }

    // ramps + air gem arcs — cycle the ramp kinds for variety (each launches
    // with its own power, and the air-gem arc stretches to match)
    const rampKinds: RampKind[] = ["standard", "mega", "kicker", "wide"];
    let ri = 0;
    for (let d = 200; d < len - 60; d += 270) {
      const l = 0; // centre lane so a launch always lands back on the road
      const kind = rampKinds[ri++ % rampKinds.length];
      const spec = RAMP_SPECS[kind];
      this.addEntity("ramp", d, l, makeRamp(kind), 0, spec.power);
      this.ramps.push({ dist: this.track.wrap(d), power: spec.power });
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

    // item boxes — power-ups, a row across the lanes so you can always grab one
    for (let d = 110; d < len - 40; d += 210) {
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
          standings: this.computeStandings(),
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
    if (!airborne) {
      // grip-limited lateral model: steering asks for lateral acceleration, but
      // the tires cap it (grip). A too-fast corner exceeds the cap and washes
      // you wide — you feel the limit. Braking loads the front for sharper
      // turn-in; power-on loosens it.
      const curve = this.track.curvatureAt(this.position);
      const LAT_M = ROAD_HALF_WIDTH * 0.9; // meters per playerX unit

      const load = this.input.brake ? WEIGHT_BRAKE_GRIP
        : this.input.accelerate ? WEIGHT_THROTTLE_GRIP : 1;
      const carGrip = this.carStat.grip * load;

      // drift: brake + steer at speed → slide and build a boost charge
      const wantDrift = this.input.brake && this.steerInput !== 0 && speedPercent > 0.35;
      if (wantDrift && !this.drifting) {
        this.drifting = true;
        this.driftDir = Math.sign(this.steerInput);
        this.driftCharge = 0;
      }
      if (this.drifting && (!this.input.brake || speedPercent < 0.18 || this.steerInput === 0)) {
        this.endDrift();
      }
      const gripMul = this.drifting ? DRIFT_GRIP_MULT : 1;

      // steering authority drops with speed; sharper into a drift
      const authority = (this.drifting ? DRIFT_STEER_MULT : 1) / (1 + this.speed * STEER_SPEED_FALLOFF);
      const aSteer = this.steerInput * TURN_ACCEL * authority * (0.35 + 0.65 * speedPercent);
      // centrifugal: v²/r pushes toward the outside of the curve
      const aCentri = (curve * this.speed * this.speed / LAT_M) * CENTRI_K;

      // grip ceiling on the net lateral acceleration
      let aLat = aSteer - aCentri;
      const gripLimit = GRIP_LIMIT * carGrip * gripMul;
      this.slipping = Math.abs(aLat) > gripLimit + 0.5;
      aLat = clamp(aLat, -gripLimit, gripLimit);

      this.playerVX += aLat * dt;
      // tire scrub bleeds off sideways velocity (self-centering), weaker in a drift
      const scrub = LATERAL_DAMP * carGrip * (this.drifting ? 0.35 : 1);
      this.playerVX -= this.playerVX * Math.min(1, dt * scrub);
      this.playerX += this.playerVX * dt;
      if (this.drifting) this.driftCharge += dt;

      // point the car where it's actually heading (slip), plus a steer lean
      // modest heading offset — enough to feel alive, not so much the car looks
      // like it's crab-walking / bending on turns
      const slipYaw = clamp(this.playerVX * 0.05, -0.26, 0.26);
      const yawTarget = this.steerInput * 0.09 + slipYaw + (this.drifting ? this.driftDir * 0.32 : 0);
      this.carYaw += (yawTarget - this.carYaw) * Math.min(1, dt * 8);
    } else if (this.stuntAir) {
      // mid-air: left/right = barrel roll, up/down = flips. Only a little lateral
      // drift so a jump doesn't fling you off the track.
      this.spin += this.steer * 1.25 * dt;
      const pitchIn = this.input.accelerate ? 1 : this.input.brake ? -1 : 0;
      this.flip += pitchIn * 1.25 * dt;
      this.playerX += this.steer * dt * 0.15 * speedPercent;
      this.playerVX = 0;
      this.carYaw += (0 - this.carYaw) * Math.min(1, dt * 6);
    } else {
      // flying mech steers freely
      this.playerX += this.steer * dt * 1.5 * speedPercent;
      this.carYaw += (this.steer * 0.2 - this.carYaw) * Math.min(1, dt * 6);
    }

    // throttle (car type sets acceleration; boost/nitro still override)
    const boosting = this.nitroT > 0 || this.driftBoostT > 0 || this.boostT > 0;
    const accel = ACCEL * this.carStat.accel;
    if (this.transformed) {
      this.speed += ACCEL * 1.5 * dt;
    } else if (this.drifting) {
      // hold speed through the slide instead of braking hard
      this.speed += (this.input.accelerate ? accel * 0.6 : DECEL * 0.5) * dt;
    } else if (this.input.accelerate) {
      this.speed += accel * (boosting ? 2 : 1) * dt;
    } else if (this.input.brake) {
      this.speed += BRAKING * dt;
    } else {
      this.speed += DECEL * dt;
    }

    if (!airborne && Math.abs(this.playerX) > 1 && this.speed > OFF_ROAD_LIMIT) {
      this.speed += OFF_ROAD_DECEL * dt;
    }

    const maxSpeed = this.effectiveMaxSpeed();
    this.speed = Math.max(0, this.speed);
    if (this.speed > maxSpeed) this.speed = Math.max(maxSpeed, this.speed + BRAKING * dt * 0.5);

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
    if (this.input.usePressed && this.heldItem) this.useItem();
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

    // altitude
    if (this.transformed && this.input.fly) {
      this.vAlt = Math.min(this.vAlt + FLY_LIFT * dt, 9);
    } else if (this.alt > 0) {
      this.vAlt -= GRAVITY * dt;
    }
    this.alt += this.vAlt * dt;
    if (this.alt >= MAX_ALT) {
      this.alt = MAX_ALT;
      this.vAlt = Math.min(this.vAlt, 0);
    }
    if (this.alt <= 0) {
      this.alt = 0;
      this.vAlt = 0;
      if (this.stuntAir) this.land();
    }

    // out of bounds
    if (Math.abs(this.playerX) > OUT_OF_BOUNDS_X) {
      this.playerX = Math.sign(this.playerX) * 1;
      this.playerVX = 0;
      this.speed *= 0.3;
      this.score -= OUT_OF_BOUNDS_PENALTY;
      this.penalties += OUT_OF_BOUNDS_PENALTY;
      this.crashFlash = 0.5;
      this.shake = Math.max(this.shake, 1);
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

    this.collide(speedPercent);
    if (this.cfg.monsters) {
      this.updateMonsters(dt);
      this.collideMonsters();
    }
    this.sound.setEngine(this.speed / MAX_SPEED, this.nitroT > 0);

    // advance & laps
    this.position += this.speed * dt;
    if (this.position >= this.track.length) {
      this.position -= this.track.length;
      this.lap++;
      if (this.lap > this.cfg.laps) {
        this.phase = "finished";
        this.finishT = 2.5;
        this.finalPosition = this.computePosition();
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

  private updateOpponents(dt: number) {
    const mine = this.playerProgress();
    const len = this.track.length;
    for (const o of this.opponents) {
      const gap = mine - o.progress(len); // + means player ahead
      // each racer holds its own pace so the field strings out; only a gentle
      // rubber-band keeps it competitive around the player
      const base = MAX_SPEED * o.pace * (1 + clamp(gap / 500, -0.05, 0.08));
      o.update(dt, this.track, base, this.cfg.laps);

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

    // an opponent occasionally drops a mine on the road behind it
    if (this.opponents.length && this.mines.length < 14 && Math.random() < OPPONENT_MINE_CHANCE * dt) {
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
        if (this.alt < 0.5 && speedPercent > 0.15) {
          this.vAlt = RAMP_LAUNCH * e.power * clamp(speedPercent, 0.4, 1);
          this.stuntAir = !this.transformed;
          this.spin = 0;
          this.playerVX = 0;               // launch straight — no sideways carry
          this.playerX += (e.lateral - this.playerX) * 0.5; // snap toward ramp centre
          this.sound.play("jump");
          this.toast(e.power > 1.3 ? "MEGA JUMP!" : "JUMP!", "#c084fc");
        }
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
          if (!this.heldItem) {
            this.collect(e);
            this.heldItem = this.randomItem();
            this.sound.play("nitroCharge");
            this.toast(`ITEM: ${ITEM_LABEL[this.heldItem]}  [E]`, "#f0abfc");
          } else if (this.slotFullCd <= 0) {
            // already holding one — tell the player instead of silently ignoring
            this.slotFullCd = 1.2;
            this.toast(`SLOT FULL — [E] TO USE ${ITEM_LABEL[this.heldItem]}`, "#8b85a8");
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
    const pool: ItemKind[] = this.opponents.length
      ? ["boost", "boost", "shield", "missile", "missile", "mine"]
      : ["boost", "boost", "shield"];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private useItem() {
    const item = this.heldItem;
    this.heldItem = null;
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
      const lateralM = this.playerX * ROAD_HALF_WIDTH * 0.9;
      const p = track.pointAt(this.position, lateralM);
      this.playerRoot.position.set(p.x, p.y + this.alt + CAR_LIFT, p.z);
      const tan = track.tangentAt(this.position);
      this.playerRoot.rotation.y = Math.atan2(tan.x, tan.z);

      // pitch = flips + air tilt, yaw = steer/drift heading, roll = barrel roll + lean
      this.playerBody.rotation.x = this.flip * Math.PI * 2 + clamp(-this.vAlt * 0.03, -0.35, 0.35);
      this.playerBody.rotation.y = this.carYaw;
      this.playerBody.rotation.z =
        this.spin * Math.PI * 2 - this.steer * 0.09 - (this.drifting ? this.driftDir * 0.1 : 0);

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
      // ambient particles drift and follow the camera so they always fill view
      if (this.particles) this.particles.update(this.time, this.playerRoot.position);
      // monsters are positioned in updateMonsters (they move + charge)

      // camera — chase with feel: FOV kicks with speed/boost, banks into
      // corners, looks ahead into the turn, and shakes on impacts.
      const preset = CAMERA_PRESETS[this.cameraIndex];
      const spd = this.speed / MAX_SPEED;
      const curve = track.curvatureAt(this.position);

      // gentle speed/boost FOV kick — kept small to avoid motion sickness
      const targetFov = preset.fov + spd * 4 + (boosting ? 4 : 0);
      this.camera.fov += (targetFov - this.camera.fov) * 0.06;
      this.camera.updateProjectionMatrix();

      const camAnchor = track.pointAt(this.position - preset.back, lateralM * 0.7);
      camAnchor.y += preset.height + this.alt * 0.55;
      if (this.camSnap) {
        this.camPos.copy(camAnchor);
        this.camSnap = false;
      } else {
        this.camPos.lerp(camAnchor, 0.55);
      }
      this.camera.position.copy(this.camPos);
      // subtle impact/landing shake
      if (this.shake > 0.01) {
        const s = this.shake * 0.18;
        this.camera.position.x += (Math.random() - 0.5) * s;
        this.camera.position.y += (Math.random() - 0.5) * s;
      }
      // look slightly ahead into the corner (small, so the view doesn't swing)
      const aheadBias = clamp(curve * this.speed * 0.6, -1.0, 1.0);
      const lookAt = track.pointAt(this.position + preset.ahead, lateralM * 0.5 + aheadBias);
      lookAt.y += preset.lookHeight + this.alt * 0.8;
      this.camera.lookAt(lookAt);
      // slight bank into the corner
      const bank = clamp(-curve * this.speed * 0.008 - this.steer * 0.012, -0.055, 0.055);
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

    const position = this.opponents.length ? this.computePosition() : undefined;
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
      heldItem: this.heldItem ? ITEM_LABEL[this.heldItem] : null,
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
