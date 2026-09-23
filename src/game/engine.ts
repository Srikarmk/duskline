import {
  STEP, WIDTH, HEIGHT,
  ROAD_WIDTH, SEGMENT_LENGTH, DRAW_DISTANCE, CAMERA_HEIGHT, CAMERA_DEPTH, PLAYER_Z,
  MAX_SPEED, ACCEL, BRAKING, DECEL, OFF_ROAD_DECEL, OFF_ROAD_LIMIT, CENTRIFUGAL,
  TOTAL_LAPS, OUT_OF_BOUNDS_X, OUT_OF_BOUNDS_PENALTY,
  NITRO_MAX_CHARGES, NITRO_DURATION, NITRO_SPEED_FACTOR,
  GRAVITY, RAMP_LAUNCH, FLY_LIFT, ALT_PIXEL_FACTOR, AIR_GEM_ALT, AIR_GEM_TOLERANCE,
  TRANSFORM_DURATION, TRANSFORM_SPEED_FACTOR,
  SCORE_GEM, SCORE_AIR_GEM, SCORE_STUNT, SCORE_LANE_BONUS, SCORE_SMASH, SCORE_FINISH,
  LANE_BONUS_SECONDS,
} from "./constants";
import { Input } from "./input";
import { Road, project, type Segment } from "./road";
import { COLLIDE_WIDTH } from "./sprites";
import {
  drawBackground, drawSegment, drawSegmentSprite, drawPlayer, drawHud,
  drawToasts, drawCenterText, type Toast,
} from "./render";

/**
 * Every mode the game can run.
 *
 * "timetrial" and "nitro" used to be here and are GONE — they were thin
 * variations on classic (no rivals; one lap with full nitro) and were removed
 * from the game, so leaving them in the union meant every
 * `Record<GameMode, …>` carried two rows nothing could reach.
 *
 * "transform" is different: it is ARCHIVED, not deleted. It is off the picker
 * but the mech, the sword and the monsters are all still wired to it, so it
 * stays reachable by passing the mode directly.
 */
export type GameMode = "classic" | "transform" | "grandprix" | "spacewars" | "endless";
export type RealmId =
  | "forest" | "ember" | "peaks" | "void"
  | "sands" | "castle" | "circuit" | "metro"
  | "nebula"
  | "bay"
  // built from the reference photographs: a Riviera street circuit, a snow
  // pass, a Gulf highway, a desert basin, a clifftop coast road and a canyon
  // above a city
  | "azur"
  | "hokkai"
  | "mirage"
  | "basin"
  | "cape"
  | "hills"
  // NEON RUN's own world: not on the picker, the endless mode selects it
  | "neon";
export type CarId =
  | "f40" | "tauro" | "meridian" | "veloce" | "testa"
  | "fairlady" | "firehawk" | "iroc" | "imprez" | "zanza"
  // The JDM four, built from the reference art: an R34-era Skyline, a
  // widebody A90 Supra, an FC RX-7 on pop-ups, and a whale-tail 930.
  | "r34" | "a90" | "fc3s" | "p930";

export interface RaceStanding {
  name: string;
  isPlayer: boolean;
  position: number;
}

export interface GameResult {
  mode: GameMode;
  realm?: RealmId;
  score: number;
  gems: number;
  stunts: number;
  laneBonuses: number;
  penalties: number;
  timeMs: number;
  position?: number;
  totalRacers?: number;
  standings?: RaceStanding[];
}

export interface GameOptions {
  mode: GameMode;
  realm?: RealmId;
  car?: CarId;
  laps?: number;
  onFinish: (result: GameResult) => void;
  /**
   * Something failed while building or running the world.
   *
   * This exists because the async world build was the one failure the crash
   * handling could not see: `init()` is async, so a model that will not parse
   * or a texture that 404s rejects a promise, and a rejected promise reaches
   * neither a React error boundary nor a window `error` listener. The player
   * got a frozen loading screen and no way out.
   */
  onError?: (err: unknown) => void;
}

type Phase = "countdown" | "racing" | "finished";

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export class Game {
  private ctx: CanvasRenderingContext2D;
  private input = new Input();
  private road = new Road();
  private mode: GameMode;
  private onFinish: (result: GameResult) => void;
  private rafId = 0;
  private last = 0;
  private accumulator = 0;
  private time = 0; // total elapsed, for animations

  // race state
  private phase: Phase = "countdown";
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

  // altitude (0..1)
  private alt = 0;
  private vAlt = 0;
  private stuntAir = false; // airborne from a ramp (spins allowed)
  private spin = 0; // revolutions accumulated mid-air

  // nitro
  private nitroCharges = 1;
  private nitroT = 0;

  // transformer mode
  private transformed = false;
  private transformT = 0;

  // lane bonus
  private lastLane = -1;
  private laneT = 0;

  // scoring
  private score = 0;
  private gems = 0;
  private stunts = 0;
  private laneBonuses = 0;
  private penalties = 0;

  // fx
  private crashFlash = 0;
  private toasts: Toast[] = [];
  private bgOffset = 0;

  constructor(canvas: HTMLCanvasElement, options: GameOptions) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.mode = options.mode;
    this.onFinish = options.onFinish;
    this.road.buildCircuit(this.mode);
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __frGame?: Game }).__frGame = this;
    }
  }

  start() {
    this.input.attach();
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    this.input.detach();
  }

  private frame = (now: number) => {
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

  // --- update ------------------------------------------------------------

  private update(dt: number) {
    this.time += dt;
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter((t) => t.t > 0);
    this.crashFlash = Math.max(0, this.crashFlash - dt);

    if (this.phase === "countdown") {
      this.countdownT -= dt;
      if (this.countdownT <= 0) this.phase = "racing";
      return;
    }

    if (this.phase === "finished") {
      this.speed = Math.max(0, this.speed + DECEL * dt);
      this.position = (this.position + this.speed * dt) % this.road.trackLength;
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
    const playerSegment = this.road.findSegment(this.position + PLAYER_Z);
    const speedPercent = Math.min(this.speed / MAX_SPEED, 1);
    const airborne = this.alt > 0.02;

    // -- steering / spinning
    this.steer = this.input.left ? -1 : this.input.right ? 1 : 0;
    const dx = dt * 2 * speedPercent;
    if (!airborne) {
      this.playerX += this.steer * dx;
      // curves push you outward
      this.playerX -= dx * speedPercent * playerSegment.curve * CENTRIFUGAL;
    } else if (this.stuntAir) {
      this.spin += this.steer * 1.1 * dt; // steering mid-air = tricks
      this.playerX += this.steer * dx * 0.2;
    } else {
      this.playerX += this.steer * dx * 0.7; // flying mech steers freely
    }

    // -- throttle
    if (this.transformed) {
      this.speed += ACCEL * 1.5 * dt; // mech auto-runs
    } else if (this.input.accelerate) {
      this.speed += ACCEL * (this.nitroT > 0 ? 2 : 1) * dt;
    } else if (this.input.brake) {
      this.speed += BRAKING * dt;
    } else {
      this.speed += DECEL * dt;
    }

    // off-road drag
    if (!airborne && Math.abs(this.playerX) > 1 && this.speed > OFF_ROAD_LIMIT) {
      this.speed += OFF_ROAD_DECEL * dt;
    }

    // clamp to the current max; decay gently when a boost just expired
    const maxSpeed = this.effectiveMaxSpeed();
    this.speed = Math.max(0, this.speed);
    if (this.speed > maxSpeed) this.speed = Math.max(maxSpeed, this.speed + BRAKING * dt * 0.5);

    // -- nitro
    this.nitroT = Math.max(0, this.nitroT - dt);
    if (this.input.nitroPressed && this.nitroCharges > 0 && this.nitroT <= 0) {
      this.nitroCharges--;
      this.nitroT = NITRO_DURATION;
      this.toast("NITRO!", "#fb923c");
    }

    // -- transform timer
    if (this.transformed) {
      this.transformT -= dt;
      if (this.transformT <= 0) {
        this.transformed = false;
        this.toast("POWER DOWN", "#8b85a8");
      }
    }

    // -- altitude
    if (this.transformed && this.input.fly) {
      this.vAlt = Math.min(this.vAlt + FLY_LIFT * dt, 1.4);
    } else if (this.alt > 0) {
      this.vAlt -= GRAVITY * dt;
    }
    this.alt += this.vAlt * dt;
    if (this.alt >= 1) {
      this.alt = 1;
      this.vAlt = Math.min(this.vAlt, 0);
    }
    if (this.alt <= 0) {
      this.alt = 0;
      this.vAlt = 0;
      if (this.stuntAir) this.land();
    }

    // -- out of bounds
    if (Math.abs(this.playerX) > OUT_OF_BOUNDS_X) {
      this.playerX = Math.sign(this.playerX) * 1;
      this.speed *= 0.3;
      this.score -= OUT_OF_BOUNDS_PENALTY;
      this.penalties += OUT_OF_BOUNDS_PENALTY;
      this.crashFlash = 0.5;
      this.toast(`OUT OF BOUNDS -${OUT_OF_BOUNDS_PENALTY}`, "#f87171");
    }

    // -- lane discipline bonus
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

    // -- sprite collisions
    this.collide(playerSegment, airborne, speedPercent);

    // -- advance & laps
    this.position += this.speed * dt;
    while (this.position >= this.road.trackLength) {
      this.position -= this.road.trackLength;
      this.lap++;
      if (this.lap > TOTAL_LAPS) {
        this.phase = "finished";
        this.finishT = 2.5;
        this.score += SCORE_FINISH;
        this.toast(`FINISH +${SCORE_FINISH}`, "#fbbf24");
      } else {
        this.toast(`LAP ${this.lap}/${TOTAL_LAPS}`, "#c084fc");
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
      this.toast(`STUNT x${revs} +${bonus}`, "#fbbf24");
    } else if (Math.abs(this.spin) > 0.25) {
      this.speed *= 0.6;
      this.toast("ROUGH LANDING", "#f87171");
    }
    this.spin = 0;
  }

  private collide(segment: Segment, airborne: boolean, speedPercent: number) {
    for (const sprite of segment.sprites) {
      const width = COLLIDE_WIDTH[sprite.type];
      if (width === 0) continue; // scenery
      if (sprite.collectedLap === this.lap) continue;
      if (Math.abs(this.playerX - sprite.offset) > width) continue;

      switch (sprite.type) {
        case "gem":
          if (this.alt < 0.2) {
            const value = this.transformed ? SCORE_GEM * 2 : SCORE_GEM;
            sprite.collectedLap = this.lap;
            this.score += value;
            this.gems++;
            this.toast(`+${value}`, "#67e8f9");
          }
          break;
        case "airGem":
          if (Math.abs(this.alt - AIR_GEM_ALT) < AIR_GEM_TOLERANCE) {
            sprite.collectedLap = this.lap;
            this.score += SCORE_AIR_GEM;
            this.gems++;
            this.toast(`AIR GEM +${SCORE_AIR_GEM}`, "#fbbf24");
          }
          break;
        case "nitro":
          if (this.alt < 0.2 && this.nitroCharges < NITRO_MAX_CHARGES) {
            sprite.collectedLap = this.lap;
            this.nitroCharges++;
            this.toast("NITRO CHARGE", "#67e8f9");
          }
          break;
        case "orb":
          if (this.alt < 0.2 && !this.transformed) {
            sprite.collectedLap = this.lap;
            this.transformed = true;
            this.transformT = TRANSFORM_DURATION;
            this.toast("TRANSFORMED!", "#f0abfc");
          }
          break;
        case "ramp":
          if (this.alt < 0.05 && speedPercent > 0.2) {
            this.vAlt = RAMP_LAUNCH * clamp(speedPercent, 0.4, 1);
            this.stuntAir = !this.transformed;
            this.spin = 0;
            this.toast("JUMP!", "#c084fc");
          }
          break;
        case "rock":
          if (this.alt < 0.15) {
            if (this.transformed) {
              sprite.collectedLap = this.lap; // smashed for this lap
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
  }

  // --- render --------------------------------------------------------------

  private render() {
    const { ctx, road } = this;

    const baseSegment = road.findSegment(this.position);
    const basePercent = (this.position % SEGMENT_LENGTH) / SEGMENT_LENGTH;
    const playerSegment = road.findSegment(this.position + PLAYER_Z);
    const playerPercent = ((this.position + PLAYER_Z) % SEGMENT_LENGTH) / SEGMENT_LENGTH;
    const playerY =
      playerSegment.p1.world.y +
      (playerSegment.p2.world.y - playerSegment.p1.world.y) * playerPercent;

    this.bgOffset += playerSegment.curve * (this.speed / MAX_SPEED) * 2;
    drawBackground(ctx, this.bgOffset, playerY * 0.008, this.time);

    let x = 0;
    let dx = -(baseSegment.curve * basePercent);
    let maxY = HEIGHT;

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const segment = road.segments[(baseSegment.index + n) % road.segments.length];
      const looped = segment.index < baseSegment.index;
      const cameraZ = this.position - (looped ? road.trackLength : 0);
      segment.clip = maxY;

      project(segment.p1, this.playerX * ROAD_WIDTH - x, playerY + CAMERA_HEIGHT, cameraZ,
        CAMERA_DEPTH, WIDTH, HEIGHT, ROAD_WIDTH);
      project(segment.p2, this.playerX * ROAD_WIDTH - x - dx, playerY + CAMERA_HEIGHT, cameraZ,
        CAMERA_DEPTH, WIDTH, HEIGHT, ROAD_WIDTH);

      x += dx;
      dx += segment.curve;

      const behindCamera = segment.p1.camera.z <= CAMERA_DEPTH;
      const backFace = segment.p2.screen.y >= segment.p1.screen.y;
      const hidden = segment.p2.screen.y >= maxY;
      if (behindCamera || backFace || hidden) continue;

      const fog = 1 - Math.exp(-((n / DRAW_DISTANCE) ** 2) * 5);
      drawSegment(ctx, segment, fog, segment.index < 3);
      maxY = segment.p1.screen.y;
    }

    // sprites, back to front
    for (let n = DRAW_DISTANCE - 1; n > 0; n--) {
      const segment = road.segments[(baseSegment.index + n) % road.segments.length];
      if (segment.p1.camera.z <= CAMERA_DEPTH) continue;
      for (const sprite of segment.sprites) {
        if (sprite.collectedLap === this.lap) continue; // collected or smashed this lap
        const lift = sprite.type === "airGem"
          ? AIR_GEM_ALT * segment.p1.screen.w * ALT_PIXEL_FACTOR * 4
          : 0;
        drawSegmentSprite(ctx, segment, sprite, lift, this.time);
      }
    }

    drawPlayer(ctx, {
      steer: this.steer,
      altPx: this.alt * 170,
      spinRev: this.spin,
      transformed: this.transformed,
      flying: this.transformed && this.alt > 0.02,
      nitroActive: this.nitroT > 0,
      time: this.time,
    });

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
