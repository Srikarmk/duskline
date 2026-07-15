import * as THREE from "three";
import type { Track } from "./track";
import { ROAD_HALF_WIDTH, LANE_CENTERS, GRAVITY } from "./constants";

/** A CPU racer that follows the track, changes lanes, slows for curves, hops
 *  ramps, and fires the occasional nitro burst. Its `pace` (personal top-speed
 *  factor) spreads the field so racers string out instead of clustering. */
export class Opponent {
  dist: number;
  lap = 1;
  lane: number;
  targetLane: number;
  speed = 0;
  finished = false;
  stunnedT = 0;
  pace = 1;          // personal top-speed factor
  alt = 0;           // ramp-hop height
  vAlt = 0;
  boostT = 0;        // nitro-burst timer
  flames: THREE.Mesh[] = [];
  private laneTimer: number;
  private boostCd: number;

  constructor(
    readonly obj: THREE.Group,
    readonly color: number,
    readonly name: string,
    readonly skill: number,
    startDist: number
  ) {
    this.dist = startDist;
    this.lane = LANE_CENTERS[1];
    this.targetLane = LANE_CENTERS[Math.floor(Math.random() * 3)];
    this.laneTimer = 1 + Math.random() * 3;
    this.boostCd = 5 + Math.random() * 9;
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
      this.place(track, true);
      this.updateFlames();
      return;
    }

    // fire an occasional nitro burst
    this.boostCd -= dt;
    if (this.boostCd <= 0) {
      this.boostT = 1.3;
      this.boostCd = 8 + Math.random() * 11;
    }
    this.boostT = Math.max(0, this.boostT - dt);

    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.targetLane = LANE_CENTERS[Math.floor(Math.random() * 3)];
      this.laneTimer = 2 + Math.random() * 3;
    }
    this.lane += (this.targetLane - this.lane) * Math.min(1, dt * 2);

    // ease off the throttle through tight curves so they hold the road
    const curve = Math.abs(track.curvatureAt(this.dist));
    let target = baseSpeed * (1 - Math.min(curve * 9, 0.4));
    if (this.boostT > 0) target *= 1.4;
    this.speed += (target - this.speed) * Math.min(1, dt * 1.5);

    this.dist += this.speed * dt;
    if (this.dist >= track.length) {
      this.dist -= track.length;
      this.lap++;
      if (this.lap > totalLaps) this.finished = true;
    }
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

  private place(track: Track, spinning = false) {
    const p = track.pointAt(this.dist, this.lane * ROAD_HALF_WIDTH * 0.9);
    this.obj.position.set(p.x, p.y + this.alt, p.z);
    if (!spinning) {
      const tan = track.tangentAt(this.dist);
      this.obj.rotation.y = Math.atan2(tan.x, tan.z);
    }
  }
}
