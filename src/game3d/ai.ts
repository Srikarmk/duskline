import * as THREE from "three";
import type { Track } from "./track";
import { ROAD_HALF_WIDTH, LANE_CENTERS } from "./constants";

/** A CPU racer that follows the track, changes lanes, and slows for curves. */
export class Opponent {
  dist: number;
  lap = 1;
  lane: number;
  targetLane: number;
  speed = 0;
  finished = false;
  stunnedT = 0;
  private laneTimer: number;

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
  }

  /** total meters travelled, for ranking */
  progress(trackLength: number) {
    return (this.lap - 1) * trackLength + this.dist;
  }

  stun(seconds: number) {
    this.stunnedT = Math.max(this.stunnedT, seconds);
  }

  update(dt: number, track: Track, baseSpeed: number, totalLaps: number) {
    if (this.finished) {
      this.speed *= 1 - Math.min(1, dt);
      this.place(track);
      return;
    }

    if (this.stunnedT > 0) {
      // spun out: drop speed, wobble, don't advance much
      this.stunnedT -= dt;
      this.speed *= 1 - Math.min(1, dt * 3);
      this.dist += this.speed * dt;
      this.obj.rotation.y += dt * 12; // visible spin
      this.place(track, true);
      return;
    }

    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.targetLane = LANE_CENTERS[Math.floor(Math.random() * 3)];
      this.laneTimer = 2 + Math.random() * 3;
    }
    this.lane += (this.targetLane - this.lane) * Math.min(1, dt * 2);

    // ease off the throttle through tight curves so they hold the road
    const curve = Math.abs(track.curvatureAt(this.dist));
    const target = baseSpeed * this.skill * (1 - Math.min(curve * 9, 0.4));
    this.speed += (target - this.speed) * Math.min(1, dt * 1.5);

    this.dist += this.speed * dt;
    if (this.dist >= track.length) {
      this.dist -= track.length;
      this.lap++;
      if (this.lap > totalLaps) this.finished = true;
    }
    this.place(track);
  }

  private place(track: Track, spinning = false) {
    const p = track.pointAt(this.dist, this.lane * ROAD_HALF_WIDTH * 0.9);
    this.obj.position.set(p.x, p.y, p.z);
    if (!spinning) {
      const tan = track.tangentAt(this.dist);
      this.obj.rotation.y = Math.atan2(tan.x, tan.z);
    }
  }
}
