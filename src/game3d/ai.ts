import * as THREE from "three";
import type { Track } from "./track";
import { ROAD_HALF_WIDTH, LANE_CENTERS, GRAVITY, MAX_SPEED, CAR_LIFT } from "./constants";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** FNV-1a hash of the racer's name — a stable per-racer seed so the same name
 *  always yields the same personality. */
function hashName(name: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). Each racer gets its own stream so its
 *  "random" choices are reproducible and independent of every other racer. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** When a racer decides to fire its nitro. */
enum BoostStyle {
  Straights, // top-speed runs, only on open straights
  CornerExit, // punches out of corners
  Comeback, // hits it when trailing the player (rubber-banded up)
  Wildcard, // fires opportunistically, regardless of track
}

/** A CPU racer with a distinct, deterministic PERSONALITY (derived from its
 *  `name` + `skill`): how hard it brakes for corners, its preferred racing line
 *  and how much it weaves, how eagerly it hunts the apex, when it spends nitro,
 *  and how often it makes mistakes. Two racers on the same grid therefore drive
 *  visibly differently. Its `pace` (personal top-speed factor, set by the
 *  engine) still spreads the field so racers string out. */
export class Opponent {
  dist: number;
  lap = 1;
  lane: number;
  targetLane: number;
  speed = 0;
  finished = false;
  stunnedT = 0;
  pace = 1;          // personal top-speed factor (set by the engine)
  alt = 0;           // ramp-hop height
  vAlt = 0;
  boostT = 0;        // nitro-burst timer
  flames: THREE.Mesh[] = [];

  // --- personality (constant per racer) ---
  private readonly rng: () => number;
  private readonly aggression: number;    // 0..1: apex-hunting + decisive steering
  private readonly cornerCaution: number; // ~0.6 (send it) .. 1.3 (brake hard, clean)
  private readonly cornerCap: number;     // max fraction of speed shed for a corner
  private readonly laneBias: number;      // preferred racing line (lateral, -1..1)
  private readonly laneRoam: number;      // 0 hold a line .. 1 constant weaver
  private readonly laneBase: number;      // seconds between lane decisions
  private readonly laneAgility: number;   // how fast it slews toward its line
  private readonly consistency: number;   // 0 sloppy .. 1 clean (skill-weighted)
  private readonly boostStyle: BoostStyle;
  private readonly boostBase: number;     // nitro cadence (seconds, own timer)
  private readonly boostDur: number;      // burst length
  private readonly boostMult: number;     // burst speed multiplier

  // --- live state ---
  private laneTimer: number;
  private boostCd: number;
  private mistakeCd: number;
  private wobbleT = 0;
  private wobbleLane = 0;
  private brakeSlip = 0;
  private prevCurve = 0;

  constructor(
    readonly obj: THREE.Group,
    readonly color: number,
    readonly name: string,
    readonly skill: number,
    startDist: number
  ) {
    this.dist = startDist;

    // Traits are pulled from a name-seeded stream, so a given racer is always
    // the same character. Skill (0.93..1.0) feeds "grade": stronger racers make
    // fewer mistakes.
    const rng = mulberry32(hashName(name));
    this.rng = mulberry32(hashName(name) ^ 0x9e3779b9); // separate live stream
    const grade = clamp((skill - 0.9) / 0.1, 0, 1);

    this.aggression = 0.15 + rng() * 0.8;
    this.cornerCaution = 0.6 + rng() * 0.7;
    this.cornerCap = 0.28 + ((this.cornerCaution - 0.6) / 0.7) * 0.24;
    this.laneBias = (rng() * 2 - 1) * 0.75;
    this.laneRoam = rng();
    this.laneBase = 3.6 - this.laneRoam * 2.3;
    this.laneAgility = 1.3 + this.aggression * 2.4;
    this.consistency = clamp(grade * 0.7 + rng() * 0.3, 0, 1);
    this.boostStyle = Math.floor(rng() * 4) as BoostStyle;
    this.boostBase = 4 + rng() * 10;
    this.boostDur = 1.0 + rng() * 0.9;
    this.boostMult = 1.32 + this.aggression * 0.18;

    this.lane = LANE_CENTERS[1];
    this.targetLane = clamp(this.laneBias, -0.9, 0.9);
    this.laneTimer = this.rng() * this.laneBase;
    this.boostCd = 2 + this.rng() * this.boostBase;
    this.mistakeCd = 1.4 + this.rng() * 2.6;
  }

  /** total meters travelled, for ranking */
  progress(trackLength: number) {
    return (this.lap - 1) * trackLength + this.dist;
  }

  stun(seconds: number) {
    this.stunnedT = Math.max(this.stunnedT, seconds);
  }

  /** launch off a ramp (only from the ground) */
  hop(power: number) {
    if (this.alt < 0.4) this.vAlt = 7.5 * power;
  }

  update(dt: number, track: Track, baseSpeed: number, totalLaps: number) {
    // ballistic ramp hop, independent of driving state
    if (this.alt > 0 || this.vAlt > 0) {
      this.vAlt -= GRAVITY * dt;
      this.alt = Math.max(0, this.alt + this.vAlt * dt);
      if (this.alt <= 0) { this.alt = 0; this.vAlt = 0; }
    }

    if (this.finished) {
      this.speed *= 1 - Math.min(1, dt);
      this.place(track);
      this.updateFlames();
      return;
    }

    if (this.stunnedT > 0) {
      // spun out: drop speed, spin, don't advance much
      this.stunnedT -= dt;
      this.speed *= 1 - Math.min(1, dt * 3);
      this.dist += this.speed * dt;
      this.obj.rotation.y += dt * 12;
      this.boostT = 0;
      this.wobbleT = 0;
      this.place(track, true);
      this.updateFlames();
      return;
    }

    const sc = track.curvatureAt(this.dist);   // signed: + turns toward +lateral
    const curve = Math.abs(sc);

    // --- mistakes: weaker / less consistent racers occasionally bobble ---
    this.mistakeCd -= dt;
    if (this.mistakeCd <= 0) {
      this.mistakeCd = 1.4 + this.rng() * 2.6;
      if (this.rng() > this.consistency) {
        // a wobble + a late brake / grip slip, scaled by how sloppy they are
        this.wobbleT = 0.3 + this.rng() * 0.45;
        this.wobbleLane = (this.rng() - 0.5) * 0.8;
        this.brakeSlip = 0.1 + this.rng() * 0.14;
      }
    }
    let slipMult = 1;
    if (this.wobbleT > 0) { this.wobbleT -= dt; slipMult = 1 - this.brakeSlip; }

    // --- lane behaviour: pick a line, apex the corners, drift wide if greedy ---
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      if (this.rng() < 0.35 + this.laneRoam * 0.5) {
        // weavers roam across the whole road
        this.targetLane = LANE_CENTERS[Math.floor(this.rng() * 3)];
      } else {
        // holders settle back onto their preferred racing line
        this.targetLane = clamp(this.laneBias + (this.rng() - 0.5) * 0.3, -0.9, 0.9);
      }
      this.laneTimer = this.laneBase * (0.6 + this.rng() * 0.8);
    }
    // aggressive racers hug the inside; low-caution racers wash out wide
    const apexPull = Math.sign(sc) * Math.min(curve * 12 * this.aggression, 0.3);
    const overcook = Math.max(0, 1 - this.cornerCaution) * curve;
    const washPull = -Math.sign(sc) * Math.min(overcook * 9, 0.32);
    let desired = this.targetLane + apexPull + washPull;
    if (this.wobbleT > 0) desired += this.wobbleLane;
    desired = clamp(desired, -0.98, 0.98);
    this.lane += (desired - this.lane) * Math.min(1, dt * this.laneAgility);

    // --- nitro: each racer has its own trigger + cadence ---
    this.boostCd -= dt;
    if (this.boostCd <= 0 && this.boostT <= 0) {
      const straightness = 1 - Math.min(curve * 22, 1);        // 1 open .. 0 hairpin
      const exiting = this.prevCurve - curve > 0.004;          // curvature falling away
      const helped = this.pace > 0 ? baseSpeed / (MAX_SPEED * this.pace) : 1; // >1 = trailing
      let fire = false;
      switch (this.boostStyle) {
        case BoostStyle.Straights: fire = straightness > 0.7; break;
        case BoostStyle.CornerExit: fire = exiting && straightness > 0.4; break;
        case BoostStyle.Comeback: fire = helped > 1.01 || straightness > 0.9; break;
        default: fire = this.rng() < 0.5; break; // Wildcard
      }
      if (fire) {
        this.boostT = this.boostDur;
        this.boostCd = this.boostBase * (0.7 + this.rng() * 0.9);
      } else {
        this.boostCd = 0.35; // keep watching for the right moment
      }
    }
    this.boostT = Math.max(0, this.boostT - dt);

    // ease off through curves (cautious racers lift more, cleanly; send-it racers
    // carry speed but scrub grip when they overcook and run wide)
    const cornerLift = Math.min(curve * 9 * this.cornerCaution, this.cornerCap);
    const gripScrub = Math.min(overcook * 2.2, 0.14);
    let target = baseSpeed * (1 - cornerLift) * (1 - gripScrub) * slipMult;
    if (this.boostT > 0) target *= this.boostMult;
    this.speed += (target - this.speed) * Math.min(1, dt * 1.5);

    this.dist += this.speed * dt;
    if (this.dist >= track.length) {
      this.dist -= track.length;
      this.lap++;
      if (this.lap > totalLaps) this.finished = true;
    }
    this.prevCurve = curve;
    this.place(track);
    this.updateFlames();
  }

  private updateFlames() {
    const on = this.boostT > 0 && !this.finished;
    for (const f of this.flames) {
      f.visible = on;
      if (on) {
        const s = 1 + Math.random() * 0.4;
        f.scale.set(s, s * 1.3, s);
      }
    }
  }

  /** Position + orient the car mesh on the track from its current dist/lane.
   *  Public so the engine can snap the field onto the grid before the lights. */
  place(track: Track, spinning = false) {
    const p = track.pointAt(this.dist, this.lane * ROAD_HALF_WIDTH * 0.9);
    this.obj.position.set(p.x, p.y + this.alt + CAR_LIFT, p.z);
    if (!spinning) {
      const tan = track.tangentAt(this.dist);
      this.obj.rotation.order = "YXZ";
      this.obj.rotation.y = Math.atan2(tan.x, tan.z);
      this.obj.rotation.z = this.alt < 0.4 ? track.bankAt(this.dist) : 0; // lean on banked corners
    }
  }
}
