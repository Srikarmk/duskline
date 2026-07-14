import * as THREE from "three";
import {
  WIDTH, HEIGHT, STEP,
  ROAD_HALF_WIDTH, LANE_CENTERS,
  MAX_SPEED, ACCEL, BRAKING, DECEL, OFF_ROAD_DECEL, OFF_ROAD_LIMIT, CENTRIFUGAL,
  OUT_OF_BOUNDS_X, OUT_OF_BOUNDS_PENALTY,
  NITRO_MAX_CHARGES, NITRO_DURATION, NITRO_SPEED_FACTOR,
  GRAVITY, RAMP_LAUNCH, FLY_LIFT, MAX_ALT, AIR_GEM_ALT, AIR_GEM_TOLERANCE,
  TRANSFORM_DURATION, TRANSFORM_SPEED_FACTOR,
  SCORE_GEM, SCORE_AIR_GEM, SCORE_STUNT, SCORE_LANE_BONUS, SCORE_SMASH,
  SCORE_MONSTER, SCORE_FINISH, LANE_BONUS_SECONDS,
  OPPONENTS, CAMERA_PRESETS, SWING_DURATION,
} from "./constants";
import { Track, makeRoadTexture, makeCheckerTexture } from "./track";
import { loadModels, instantiate, type ModelLibrary } from "./assets";
import {
  makeSkyDome, makeGround, makeGroundTexture, makeGrassTexture,
  makeGrassField, makeRockField, makeMountainRing,
  makeGem, makeNitroCan, makeOrb, makeRamp, makeCrystalCluster, makeMonster,
  makeMech, makeSlash, makeFlame, makeUnderGlow, tintModel,
  type MechRig, type Placement,
} from "./objects";
import { REALMS, pickScenery, type RealmSpec, type SceneryKind } from "./realms";
import { Opponent } from "./ai";
import { Minimap } from "./minimap";
import { Sound } from "./sound";
import { Input } from "../game/input";
import { drawHud, drawToasts, drawCenterText, type Toast } from "../game/render";
import type { GameMode, GameResult, GameOptions } from "../game/engine";

type Phase = "loading" | "countdown" | "racing" | "finished";

type EntityType = "gem" | "airGem" | "nitro" | "orb" | "ramp" | "rock" | "monster";

interface Entity {
  type: EntityType;
  dist: number;
  lateral: number;
  collectedLap: number;
  obj: THREE.Object3D;
  baseY: number;
  phase: number;
  home: number; // spawn lateral, for monster patrol
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
};

const COLLIDE_WIDTH: Record<EntityType, number> = {
  gem: 0.24, airGem: 0.3, nitro: 0.24, orb: 0.32, ramp: 0.42, rock: 0.3, monster: 0.36,
};

const BUCKET_METERS = 5;
const COLLIDE_DIST = 2.8;

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
  private hudCtx: CanvasRenderingContext2D;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private input = new Input();
  private sound = new Sound();
  private slashCooldown = 0;
  private bumpCd = 0;
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

  // world objects
  private entities: Entity[] = [];
  private buckets = new Map<number, Entity[]>();
  private spinners: Entity[] = [];
  private monsters: Entity[] = [];
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
  private speed = 0;
  private steer = 0;
  private alt = 0;
  private vAlt = 0;
  private stuntAir = false;
  private spin = 0;
  private swingT = 0;

  private nitroCharges = 1;
  private nitroT = 0;
  private transformed = false;
  private transformT = 0;

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
    this.cfg = MODE_CONFIG[options.mode];
    this.realm = REALMS[options.realm ?? "forest"];
    this.track = new Track(this.realm.controlPoints);
    this.minimap = new Minimap(this.track);
    this.onFinish = options.onFinish;
    this.lap = 1;
    this.nitroCharges = this.cfg.startNitro;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(WIDTH, HEIGHT, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "game-layer";
    this.renderer.setClearColor(this.realm.palette.fog);

    const hudCanvas = document.createElement("canvas");
    hudCanvas.width = WIDTH;
    hudCanvas.height = HEIGHT;
    hudCanvas.className = "game-layer game-hud";
    const hudCtx = hudCanvas.getContext("2d");
    if (!hudCtx) throw new Error("2d canvas context unavailable");
    this.hudCtx = hudCtx;

    container.appendChild(this.renderer.domElement);
    container.appendChild(hudCanvas);

    const pal = this.realm.palette;
    this.camera = new THREE.PerspectiveCamera(CAMERA_PRESETS[0].fov, WIDTH / HEIGHT, 0.1, 1600);
    this.scene.fog = new THREE.Fog(pal.fog, pal.fogNear, pal.fogFar);

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __frGame?: Game }).__frGame = this;
    }
  }

  start() {
    this.input.attach();
    this.sound.unlock();
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
    void this.init();
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.rafId);
    this.input.detach();
    this.sound.dispose();
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private async init() {
    const library = await loadModels();
    if (this.stopped) return;
    this.buildWorld(library);
    this.phase = "countdown";
  }

  // --- world building ------------------------------------------------------

  private buildWorld(library: ModelLibrary) {
    const { scene, track, realm } = this;
    const pal = realm.palette;

    scene.add(makeSkyDome(pal));
    scene.add(makeGround(makeGroundTexture(pal)));

    // horizon-filling mountain ring
    const cx = (track.bounds.minX + track.bounds.maxX) / 2;
    const cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
    const radius = Math.max(track.bounds.maxX - track.bounds.minX, track.bounds.maxZ - track.bounds.minZ) * 0.75 + 260;
    scene.add(makeMountainRing(pal, cx, cz, radius));

    scene.add(new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiInt));
    const sun = new THREE.DirectionalLight(pal.sun, pal.sunInt);
    sun.position.set(80, 130, 40);
    scene.add(sun);

    scene.add(track.buildVergeMesh(makeGrassTexture(pal)));
    scene.add(track.buildRoadMesh(makeRoadTexture(pal)));
    scene.add(track.buildStartLine(makeCheckerTexture()));

    // player rig
    this.carModel = instantiate(library, "racer", 4.2);
    const mech = makeMech();
    mech.group.visible = false;
    this.mech = mech;
    this.slash = makeSlash();
    this.slash.position.set(1.2, 2.2, 1.6);
    this.playerBody.add(this.slash);
    this.underGlow = makeUnderGlow();
    this.underGlow.position.y = 0.08;
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

    if (this.cfg.opponents) this.spawnOpponents(library);
    this.decorate(library);
  }

  private spawnOpponents(library: ModelLibrary) {
    for (let i = 0; i < OPPONENTS.length; i++) {
      const spec = OPPONENTS[i];
      const car = instantiate(library, "racer", 4.2);
      tintModel(car, spec.color);
      this.scene.add(car);
      const startDist = this.track.wrap(-(i + 1) * 7);
      const opp = new Opponent(car, spec.color, spec.name, spec.skill, startDist);
      opp.lane = LANE_CENTERS[i % 3];
      this.opponents.push(opp);
    }
  }

  private sceneryObject(kind: SceneryKind, library: ModelLibrary, rand: () => number): THREE.Object3D {
    switch (kind) {
      case "crystal": return makeCrystalCluster(rand, this.realm.palette.crystalColors);
      case "treeA": return instantiate(library, "treeA", 3 + rand() * 2.2);
      case "treeB": return instantiate(library, "treeB", 3 + rand() * 2.2);
      case "treeDark": return instantiate(library, "treeDark", 2.5 + rand() * 2);
      case "mushroom": return instantiate(library, "mushroom", 1.2 + rand() * 1.4);
      case "mushroomTall": return instantiate(library, "mushroomTall", 1.6 + rand() * 1.6);
      case "rockA": return instantiate(library, "rockA", 2 + rand() * 2.5);
      case "rockB": return instantiate(library, "rockB", 2 + rand() * 2.5);
    }
  }

  private addEntity(type: EntityType, dist: number, lateral: number, obj: THREE.Object3D, extraY = 0) {
    const d = this.track.wrap(dist);
    const p = this.track.pointAt(d, lateral * ROAD_HALF_WIDTH);
    obj.position.set(p.x, p.y + extraY, p.z);
    const tan = this.track.tangentAt(d);
    obj.rotation.y = Math.atan2(tan.x, tan.z);
    this.scene.add(obj);
    const entity: Entity = {
      type, dist: d, lateral, collectedLap: 0, obj,
      baseY: obj.position.y, phase: Math.random() * Math.PI * 2, home: lateral,
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
    if (type === "gem" || type === "airGem" || type === "orb" || type === "nitro") {
      this.spinners.push(entity);
    }
  }

  private decorate(library: ModelLibrary) {
    const rand = mulberry32(1337);
    const { track, realm } = this;
    const len = track.length;
    const pal = realm.palette;
    const lane = () => LANE_CENTERS[Math.floor(rand() * 3)];

    // roadside scenery — two bands each side for depth, denser than before
    for (let d = 0; d < len; d += 4) {
      for (const side of [-1, 1]) {
        // near band
        if (rand() < 0.85) {
          const obj = this.sceneryObject(pickScenery(realm, rand), library, rand);
          const off = side * (ROAD_HALF_WIDTH + 6 + rand() * 12);
          const p = track.pointAt(d + rand() * 3, off);
          obj.position.set(p.x, 0, p.z);
          obj.rotation.y = rand() * Math.PI * 2;
          this.scene.add(obj);
        }
        // far band
        if (rand() < 0.5) {
          const obj = this.sceneryObject(pickScenery(realm, rand), library, rand);
          const off = side * (ROAD_HALF_WIDTH + 22 + rand() * 34);
          const p = track.pointAt(d + rand() * 3, off);
          obj.position.set(p.x, 0, p.z);
          obj.rotation.y = rand() * Math.PI * 2;
          obj.scale.multiplyScalar(1.1 + rand() * 0.5);
          this.scene.add(obj);
        }
      }
    }

    // ground clutter fills the empty flats
    const centerline = track.sampleXZ(220);
    const grass = this.scatter(centerline, rand, 2600, ROAD_HALF_WIDTH * 1.3 + 3, 130);
    this.scene.add(makeGrassField(pal, grass));
    const pebbles = this.scatter(centerline, rand, 700, ROAD_HALF_WIDTH * 1.3 + 4, 150);
    this.scene.add(makeRockField(pal, pebbles));

    // gem runs
    for (let d = 40; d < len - 40; d += 120) {
      const l = lane();
      for (let k = 0; k < 6; k++) {
        this.addEntity("gem", d + k * 3.5, l, makeGem(pal.gem, false), 0.8);
      }
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

    // ramps + air gem arcs
    for (let d = 200; d < len - 60; d += 380) {
      const l = lane();
      this.addEntity("ramp", d, l, makeRamp());
      for (const off of [15, 21, 27]) {
        this.addEntity("airGem", d + off, l, makeGem(0xfbbf24, true), AIR_GEM_ALT);
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

  // --- game loop -----------------------------------------------------------

  private frame = (now: number) => {
    if (this.stopped) return;
    this.accumulator += Math.min(now - this.last, 250) / 1000;
    this.last = now;
    while (this.accumulator >= STEP) {
      this.update(STEP);
      this.accumulator -= STEP;
    }
    this.render();
    this.rafId = requestAnimationFrame(this.frame);
  };

  private toast(text: string, color = "#e8e0ff") {
    this.toasts.unshift({ text, color, t: 2 });
    if (this.toasts.length > 4) this.toasts.length = 4;
  }

  private effectiveMaxSpeed() {
    let max = MAX_SPEED;
    if (this.transformed) max *= TRANSFORM_SPEED_FACTOR;
    if (this.nitroT > 0) max *= NITRO_SPEED_FACTOR;
    return max;
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

  private update(dt: number) {
    this.time += dt;
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter((t) => t.t > 0);
    this.crashFlash = Math.max(0, this.crashFlash - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    this.slashCooldown = Math.max(0, this.slashCooldown - dt);
    this.bumpCd = Math.max(0, this.bumpCd - dt);

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
        });
      }
      return;
    }

    this.raceTime += dt;
    const speedPercent = Math.min(this.speed / MAX_SPEED, 1);
    const airborne = this.alt > 0.15;

    // steering / spinning
    this.steer = this.input.left ? -1 : this.input.right ? 1 : 0;
    const dx = dt * 2.2 * speedPercent;
    if (!airborne) {
      this.playerX += this.steer * dx;
      this.playerX -= this.track.curvatureAt(this.position) * this.speed * dt * CENTRIFUGAL * speedPercent;
    } else if (this.stuntAir) {
      this.spin += this.steer * 1.1 * dt;
      this.playerX += this.steer * dx * 0.2;
    } else {
      this.playerX += this.steer * dx * 0.7;
    }

    // throttle
    if (this.transformed) {
      this.speed += ACCEL * 1.5 * dt;
    } else if (this.input.accelerate) {
      this.speed += ACCEL * (this.nitroT > 0 ? 2 : 1) * dt;
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
      this.speed *= 0.3;
      this.score -= OUT_OF_BOUNDS_PENALTY;
      this.penalties += OUT_OF_BOUNDS_PENALTY;
      this.crashFlash = 0.5;
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
      const base = MAX_SPEED * (0.88 + clamp(gap / 140, -0.14, 0.2));
      o.update(dt, this.track, base, this.cfg.laps);

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
  }

  private land() {
    this.stuntAir = false;
    const revs = Math.round(Math.abs(this.spin));
    const wobble = Math.abs(Math.abs(this.spin) - revs);
    if (revs >= 1 && wobble < 0.2) {
      const bonus = SCORE_STUNT * revs;
      this.score += bonus;
      this.stunts++;
      this.sound.play("stunt");
      this.toast(`STUNT x${revs} +${bonus}`, "#fbbf24");
    } else if (Math.abs(this.spin) > 0.25) {
      this.speed *= 0.6;
      this.sound.play("land");
      this.toast("ROUGH LANDING", "#f87171");
    }
    this.spin = 0;
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
        if (this.alt < 0.4 && speedPercent > 0.2) {
          this.vAlt = RAMP_LAUNCH * clamp(speedPercent, 0.4, 1);
          this.stuntAir = !this.transformed;
          this.spin = 0;
          this.sound.play("jump");
          this.toast("JUMP!", "#c084fc");
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
    }
  }

  private collect(e: Entity) {
    e.collectedLap = this.lap;
    e.obj.visible = false;
  }

  // --- render ----------------------------------------------------------------

  private render() {
    const { track } = this;

    if (this.phase !== "loading") {
      const lateralM = this.playerX * ROAD_HALF_WIDTH * 0.9;
      const p = track.pointAt(this.position, lateralM);
      this.playerRoot.position.set(p.x, p.y + this.alt, p.z);
      const tan = track.tangentAt(this.position);
      this.playerRoot.rotation.y = Math.atan2(tan.x, tan.z);

      this.playerBody.rotation.z = -this.steer * 0.16 + this.spin * Math.PI * 2;
      this.playerBody.rotation.x = clamp(-this.vAlt * 0.03, -0.35, 0.35);

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
      const boosting = this.nitroT > 0 || (this.transformed && this.alt > 0.15);
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

      // pickup + monster animation
      for (const e of this.spinners) {
        if (!e.obj.visible) continue;
        e.obj.rotation.y = this.time * 1.6 + e.phase;
        e.obj.position.y = e.baseY + Math.sin(this.time * 2.5 + e.phase) * 0.18;
      }
      // monsters are positioned in updateMonsters (they move + charge)

      // camera
      const preset = CAMERA_PRESETS[this.cameraIndex];
      const camAnchor = track.pointAt(this.position - preset.back, lateralM * 0.7);
      camAnchor.y += preset.height + this.alt * 0.55;
      if (this.camSnap) {
        this.camPos.copy(camAnchor);
        this.camSnap = false;
      } else {
        this.camPos.lerp(camAnchor, 0.55);
      }
      this.camera.position.copy(this.camPos);
      const lookAt = track.pointAt(this.position + preset.ahead, lateralM * 0.5);
      lookAt.y += preset.lookHeight + this.alt * 0.8;
      this.camera.lookAt(lookAt);

      this.renderer.render(this.scene, this.camera);
    }

    this.renderHud();
  }

  private renderHud() {
    const ctx = this.hudCtx;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    if (this.phase === "loading") {
      ctx.fillStyle = "#0b0b1a";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      drawCenterText(ctx, "SUMMONING REALM…", 32, "#c084fc");
      return;
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
    });

    // minimap bottom-center
    const size = 132;
    this.minimap.draw(
      ctx,
      WIDTH / 2 - size / 2,
      HEIGHT - size - 8,
      size,
      { x: this.playerRoot.position.x, z: this.playerRoot.position.z, color: "#67e8f9" },
      this.opponents.map((o) => ({ x: o.obj.position.x, z: o.obj.position.z, color: `#${o.color.toString(16).padStart(6, "0")}` }))
    );

    drawToasts(ctx, this.toasts);

    if (this.phase === "countdown") {
      const n = Math.ceil(this.countdownT - 0.5);
      drawCenterText(ctx, n > 0 ? String(n) : "GO!", 72, n > 0 ? "#e8e0ff" : "#a7f3d0");
    } else if (this.phase === "finished") {
      drawCenterText(ctx, "FINISH!", 64, "#fbbf24");
    }
  }
}
