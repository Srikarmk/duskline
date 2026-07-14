import * as THREE from "three";
import {
  WIDTH, HEIGHT, STEP,
  ROAD_HALF_WIDTH, LANE_CENTERS,
  MAX_SPEED, ACCEL, BRAKING, DECEL, OFF_ROAD_DECEL, OFF_ROAD_LIMIT, CENTRIFUGAL,
  TOTAL_LAPS, OUT_OF_BOUNDS_X, OUT_OF_BOUNDS_PENALTY,
  NITRO_MAX_CHARGES, NITRO_DURATION, NITRO_SPEED_FACTOR,
  GRAVITY, RAMP_LAUNCH, FLY_LIFT, MAX_ALT, AIR_GEM_ALT, AIR_GEM_TOLERANCE,
  TRANSFORM_DURATION, TRANSFORM_SPEED_FACTOR,
  SCORE_GEM, SCORE_AIR_GEM, SCORE_STUNT, SCORE_LANE_BONUS, SCORE_SMASH, SCORE_FINISH,
  LANE_BONUS_SECONDS,
} from "./constants";
import { Track, makeRoadTexture, makeCheckerTexture } from "./track";
import { loadModels, instantiate, type ModelLibrary } from "./assets";
import {
  makeSkyDome, makeGround, makeGem, makeNitroCan, makeOrb, makeRamp,
  makeCrystalCluster, makeMech, makeFlame, makeUnderGlow, type MechRig,
} from "./objects";
import { Input } from "../game/input";
import { drawHud, drawToasts, drawCenterText, type Toast } from "../game/render";
import type { GameMode, GameResult, GameOptions } from "../game/engine";

type Phase = "loading" | "countdown" | "racing" | "finished";

type EntityType = "gem" | "airGem" | "nitro" | "orb" | "ramp" | "rock";

interface Entity {
  type: EntityType;
  dist: number;
  lateral: number; // playerX units: 1 = road edge
  collectedLap: number;
  obj: THREE.Object3D;
  baseY: number;
  phase: number;
}

const COLLIDE_WIDTH: Record<EntityType, number> = {
  gem: 0.24,
  airGem: 0.3,
  nitro: 0.24,
  orb: 0.32,
  ramp: 0.42,
  rock: 0.3,
};

const BUCKET_METERS = 5;
const COLLIDE_DIST = 2.6;

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
  private track = new Track();
  private mode: GameMode;
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
  private playerRoot = new THREE.Group();
  private playerBody = new THREE.Group(); // leans & rolls
  private carModel: THREE.Group | null = null;
  private mech: MechRig | null = null;
  private flames: THREE.Mesh[] = [];
  private underGlow: THREE.Mesh | null = null;
  private camPos = new THREE.Vector3();

  // race state
  private phase: Phase = "loading";
  private countdownT = 3.5;
  private finishT = 0;
  private lap = 1;
  private raceTime = 0;
  private finished = false;

  // player state
  private position = 0;
  private playerX = 0;
  private speed = 0;
  private steer = 0;
  private alt = 0;
  private vAlt = 0;
  private stuntAir = false;
  private spin = 0;

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
    this.onFinish = options.onFinish;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(WIDTH, HEIGHT, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "game-layer";

    const hudCanvas = document.createElement("canvas");
    hudCanvas.width = WIDTH;
    hudCanvas.height = HEIGHT;
    hudCanvas.className = "game-layer game-hud";
    const hudCtx = hudCanvas.getContext("2d");
    if (!hudCtx) throw new Error("2d canvas context unavailable");
    this.hudCtx = hudCtx;

    container.appendChild(this.renderer.domElement);
    container.appendChild(hudCanvas);

    this.camera = new THREE.PerspectiveCamera(72, WIDTH / HEIGHT, 0.1, 1500);
    this.scene.fog = new THREE.Fog(0x2a1b4d, 60, 420);

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __frGame?: Game }).__frGame = this;
    }
  }

  start() {
    this.input.attach();
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
    void this.init();
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.rafId);
    this.input.detach();
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
    const { scene, track } = this;

    scene.add(makeSkyDome());
    scene.add(makeGround());
    scene.add(new THREE.HemisphereLight(0x9080d0, 0x1a2e1a, 1.1));
    const sun = new THREE.DirectionalLight(0xc0b0ff, 1.4);
    sun.position.set(60, 100, 30);
    scene.add(sun);

    scene.add(track.buildRoadMesh(makeRoadTexture()));
    scene.add(track.buildStartLine(makeCheckerTexture()));

    // player rig: root follows the track, body leans/rolls, forms swap inside
    this.carModel = instantiate(library, "racer", 4.2);
    const mech = makeMech();
    mech.group.visible = false;
    this.mech = mech;
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

    this.decorate(library);
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
      baseY: obj.position.y, phase: Math.random() * Math.PI * 2,
    };
    this.entities.push(entity);
    const key = Math.floor(d / BUCKET_METERS);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(entity);
    else this.buckets.set(key, [entity]);
    if (type === "gem" || type === "airGem" || type === "orb" || type === "nitro") {
      this.spinners.push(entity);
    }
  }

  private decorate(library: ModelLibrary) {
    const rand = mulberry32(42);
    const len = this.track.length;
    const lane = () => LANE_CENTERS[Math.floor(rand() * 3)];

    // roadside scenery (no collision)
    for (let d = 0; d < len; d += 6) {
      for (const side of [-1, 1]) {
        const r = rand();
        let obj: THREE.Object3D;
        if (r < 0.28) obj = makeCrystalCluster(rand);
        else if (r < 0.5) obj = instantiate(library, rand() < 0.5 ? "treeA" : "treeB", 3 + rand() * 2);
        else if (r < 0.62) obj = instantiate(library, "treeDark", 2.5 + rand() * 2);
        else if (r < 0.8) obj = instantiate(library, rand() < 0.5 ? "mushroom" : "mushroomTall", 1.2 + rand() * 1.6);
        else if (r < 0.92) obj = instantiate(library, rand() < 0.5 ? "rockA" : "rockB", 2 + rand() * 2.5);
        else continue; // occasional gap
        const lateral = side * (ROAD_HALF_WIDTH + 3 + rand() * 9);
        const p = this.track.pointAt(d + rand() * 4, lateral);
        obj.position.x = p.x;
        obj.position.z = p.z;
        obj.rotation.y = rand() * Math.PI * 2;
        this.scene.add(obj);
      }
    }

    // gem runs
    for (let d = 40; d < len - 40; d += 120) {
      const l = lane();
      for (let k = 0; k < 6; k++) {
        const gem = makeGem(false);
        this.addEntity("gem", d + k * 3.5, l, gem, 0.8);
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
        const gem = makeGem(true);
        this.addEntity("airGem", d + off, l, gem, AIR_GEM_ALT);
      }
    }

    // transform orbs
    if (this.mode === "transform") {
      for (let d = 120; d < len - 60; d += 480) {
        this.addEntity("orb", d, lane(), makeOrb());
      }
    }
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

  private update(dt: number) {
    this.time += dt;
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter((t) => t.t > 0);
    this.crashFlash = Math.max(0, this.crashFlash - dt);

    if (this.phase === "loading") return;

    if (this.phase === "countdown") {
      this.countdownT -= dt;
      if (this.countdownT <= 0) this.phase = "racing";
      return;
    }

    if (this.phase === "finished") {
      this.speed = Math.max(0, this.speed + DECEL * dt);
      this.position = this.track.wrap(this.position + this.speed * dt);
      this.finishT -= dt;
      if (this.finishT <= 0 && !this.finished) {
        this.finished = true;
        this.onFinish({
          mode: this.mode,
          score: Math.max(0, Math.round(this.score)),
          gems: this.gems,
          stunts: this.stunts,
          laneBonuses: this.laneBonuses,
          penalties: this.penalties,
          timeMs: Math.round(this.raceTime * 1000),
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
      this.toast("NITRO!", "#fb923c");
    }

    // transform timer
    if (this.transformed) {
      this.transformT -= dt;
      if (this.transformT <= 0) {
        this.transformed = false;
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
      this.toast(`OUT OF BOUNDS -${OUT_OF_BOUNDS_PENALTY}`, "#f87171");
    }

    // lane discipline bonus
    if (!airborne && Math.abs(this.playerX) <= 1 && speedPercent > 0.3) {
      const lane = this.playerX < -1 / 3 ? 0 : this.playerX > 1 / 3 ? 2 : 1;
      if (lane === this.lastLane) {
        this.laneT += dt;
        if (this.laneT >= LANE_BONUS_SECONDS) {
          this.laneT = 0;
          this.score += SCORE_LANE_BONUS;
          this.laneBonuses++;
          this.toast(`CLEAN LANE +${SCORE_LANE_BONUS}`, "#a7f3d0");
        }
      } else {
        this.lastLane = lane;
        this.laneT = 0;
      }
    } else {
      this.laneT = 0;
    }

    this.collide(speedPercent);

    // advance & laps
    const before = this.position;
    this.position += this.speed * dt;
    if (this.position >= this.track.length) {
      this.position -= this.track.length;
      this.lap++;
      if (this.lap > TOTAL_LAPS) {
        this.phase = "finished";
        this.finishT = 2.5;
        this.score += SCORE_FINISH;
        this.toast(`FINISH +${SCORE_FINISH}`, "#fbbf24");
      } else {
        this.toast(`LAP ${this.lap}/${TOTAL_LAPS}`, "#c084fc");
        // respawn consumables collected on earlier laps
        for (const e of this.entities) {
          if (e.collectedLap !== 0 && e.collectedLap !== this.lap) {
            e.collectedLap = 0;
            e.obj.visible = true;
          }
        }
      }
    }
    void before;
  }

  private land() {
    this.stuntAir = false;
    const revs = Math.round(Math.abs(this.spin));
    const wobble = Math.abs(Math.abs(this.spin) - revs);
    if (revs >= 1 && wobble < 0.2) {
      const bonus = SCORE_STUNT * revs;
      this.score += bonus;
      this.stunts++;
      this.toast(`STUNT x${revs} +${bonus}`, "#fbbf24");
    } else if (Math.abs(this.spin) > 0.25) {
      this.speed *= 0.6;
      this.toast("ROUGH LANDING", "#f87171");
    }
    this.spin = 0;
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
          this.toast(`+${value}`, "#67e8f9");
        }
        break;
      case "airGem":
        if (Math.abs(this.alt - AIR_GEM_ALT) < AIR_GEM_TOLERANCE) {
          this.collect(e);
          this.score += SCORE_AIR_GEM;
          this.gems++;
          this.toast(`AIR GEM +${SCORE_AIR_GEM}`, "#fbbf24");
        }
        break;
      case "nitro":
        if (this.alt < 1.2 && this.nitroCharges < NITRO_MAX_CHARGES) {
          this.collect(e);
          this.nitroCharges++;
          this.toast("NITRO CHARGE", "#67e8f9");
        }
        break;
      case "orb":
        if (this.alt < 1.2 && !this.transformed) {
          this.collect(e);
          this.transformed = true;
          this.transformT = TRANSFORM_DURATION;
          this.toast("TRANSFORMED!", "#f0abfc");
        }
        break;
      case "ramp":
        if (this.alt < 0.4 && speedPercent > 0.2) {
          this.vAlt = RAMP_LAUNCH * clamp(speedPercent, 0.4, 1);
          this.stuntAir = !this.transformed;
          this.spin = 0;
          this.toast("JUMP!", "#c084fc");
        }
        break;
      case "rock":
        if (this.alt < 1.2) {
          if (this.transformed) {
            this.collect(e);
            this.score += SCORE_SMASH;
            this.toast(`SMASH +${SCORE_SMASH}`, "#f0abfc");
          } else {
            this.speed = Math.min(this.speed, MAX_SPEED * 0.15);
            if (this.crashFlash <= 0) this.toast("CRASH!", "#f87171");
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
      // player placement
      const lateralM = this.playerX * ROAD_HALF_WIDTH * 0.9;
      const p = track.pointAt(this.position, lateralM);
      this.playerRoot.position.set(p.x, p.y + this.alt, p.z);
      const tan = track.tangentAt(this.position);
      this.playerRoot.rotation.y = Math.atan2(tan.x, tan.z);

      // lean + barrel roll
      this.playerBody.rotation.z = -this.steer * 0.16 + this.spin * Math.PI * 2;
      this.playerBody.rotation.x = clamp(-this.vAlt * 0.03, -0.35, 0.35);

      // form swap + effects
      if (this.carModel) this.carModel.visible = !this.transformed;
      if (this.mech) {
        this.mech.group.visible = this.transformed;
        this.mech.wings.visible = this.transformed && this.alt > 0.15;
        const corePulse = 1.8 + Math.sin(this.time * 6) * 0.6;
        (this.mech.core.material as THREE.MeshStandardMaterial).emissiveIntensity = corePulse;
      }
      const boosting = this.nitroT > 0 || (this.transformed && this.alt > 0.15);
      for (const flame of this.flames) {
        flame.visible = boosting;
        const flick = 1 + Math.sin(this.time * 40 + flame.position.x) * 0.3;
        flame.scale.set(flick, 1 + flick * 0.4, flick);
        (flame.material as THREE.MeshBasicMaterial).color.setHex(
          this.transformed ? 0x22d3ee : 0xfb923c
        );
      }
      if (this.underGlow) {
        this.underGlow.visible = !this.transformed;
        const pulse = 0.9 + Math.sin(this.time * 9) * 0.15;
        this.underGlow.scale.setScalar(pulse);
        this.underGlow.position.y = 0.08 - this.alt; // glow stays on the road
      }

      // pickup animations
      for (const e of this.spinners) {
        if (!e.obj.visible) continue;
        e.obj.rotation.y = this.time * 1.6 + e.phase;
        e.obj.position.y = e.baseY + Math.sin(this.time * 2.5 + e.phase) * 0.18;
      }

      // chase camera
      const camAnchor = track.pointAt(this.position - 9.5, lateralM * 0.7);
      camAnchor.y = 3.4 + this.alt * 0.55;
      this.camPos.lerp(camAnchor, this.camPos.lengthSq() === 0 ? 1 : 0.55);
      this.camera.position.copy(this.camPos);
      const lookAt = track.pointAt(this.position + 7, lateralM * 0.5);
      lookAt.y = 1.2 + this.alt * 0.8;
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

    drawHud(ctx, {
      mph: Math.round((this.speed / MAX_SPEED) * 180),
      score: Math.max(0, Math.round(this.score)),
      lap: Math.min(this.lap, TOTAL_LAPS),
      totalLaps: TOTAL_LAPS,
      raceTime: this.raceTime,
      nitroCharges: this.nitroCharges,
      nitroActive: this.nitroT > 0,
      transformT: this.transformed ? this.transformT : 0,
      crashFlash: this.crashFlash,
    });
    drawToasts(ctx, this.toasts);

    if (this.phase === "countdown") {
      const n = Math.ceil(this.countdownT - 0.5);
      drawCenterText(ctx, n > 0 ? String(n) : "GO!", 72, n > 0 ? "#e8e0ff" : "#a7f3d0");
    } else if (this.phase === "finished") {
      drawCenterText(ctx, "FINISH!", 64, "#fbbf24");
    }
  }
}
