import type { Track } from "./track";
import { ROAD_HALF_WIDTH } from "./constants";

/** Player input for a physics step (already debounced by the engine). */
export interface DriveInput {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean; // drift
}

export interface DriveTuning {
  maxSpeed: number;   // top forward speed (m/s)
  accel: number;      // forward acceleration (m/s²)
  turnRate: number;   // base yaw rate (rad/s) at moderate speed
  grip: number;       // lateral traction (per-second bleed of side-slip)
}

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * FREE-ROAM arcade driving: the car is a real body in world space (x,z + heading
 * + velocity). Steering rotates the heading; throttle drives along it; grip bleeds
 * side-slip (less with the handbrake, so you drift). The track is a SURFACE — we
 * project the car onto it every step to get ground height, progress (arc distance)
 * and the walls that keep you on the ribbon. Nothing here is rail-locked.
 */
export class FreeDrive {
  x = 0;
  z = 0;
  heading = 0;        // radians; forward = (sin h, cos h) to match rotation.y = atan2(tan.x, tan.z)
  vx = 0;             // world velocity
  vz = 0;
  // projected onto the track each step (the engine reads these for laps/entities/HUD)
  dist = 0;
  lateral = 0;        // signed metres from centreline (right = +)
  offRoad = false;
  onWall = false;
  drifting = false;
  slip = 0;           // side-slip speed (m/s), for a visual yaw kick
  speed = 0;          // signed forward speed (m/s)

  /** Reset onto the start line: sit at arc distance `d0`, facing down the track. */
  reset(track: Track, d0: number) {
    const p = track.pointAt(track.wrap(d0), 0, undefined, true);
    const t = track.tangentAt(track.wrap(d0));
    this.x = p.x; this.z = p.z;
    this.heading = Math.atan2(t.x, t.z);
    this.vx = 0; this.vz = 0; this.speed = 0; this.slip = 0;
    this.dist = track.wrap(d0);
    this.lateral = 0; this.offRoad = false; this.onWall = false; this.drifting = false;
  }

  /** Advance one fixed step. Returns nothing; read the public fields after. */
  step(input: DriveInput, dt: number, track: Track, tuning: DriveTuning) {
    const F = { x: Math.sin(this.heading), z: Math.cos(this.heading) };   // forward
    const R = { x: F.z, z: -F.x };                                        // right of forward

    // split current velocity into forward / lateral components
    let vf = this.vx * F.x + this.vz * F.z;
    let vl = this.vx * R.x + this.vz * R.z;

    // --- throttle / brake -------------------------------------------------
    const grassMul = this.offRoad ? 0.55 : 1;
    if (input.throttle) vf += tuning.accel * grassMul * dt;
    else if (input.brake) vf -= tuning.accel * 1.5 * dt;          // brake / reverse
    else vf -= Math.sign(vf) * Math.min(Math.abs(vf), tuning.accel * 0.35 * dt); // engine drag
    const topFwd = tuning.maxSpeed * grassMul;
    vf = clampN(vf, -tuning.maxSpeed * 0.28, topFwd);

    // --- steering ---------------------------------------------------------
    // turn rate falls with speed (twitchy when slow, stable when fast) and needs
    // motion; reverse flips the steering so it behaves like a real car.
    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const spd = Math.abs(vf);
    const speedFrac = clampN(spd / tuning.maxSpeed, 0, 1);
    const move = clampN(spd / 6, 0, 1);                            // no turning at a standstill
    const turn = steer * tuning.turnRate * (0.55 + 0.45 * (1 - speedFrac)) * move * Math.sign(vf || 1);
    this.heading += turn * dt;

    // --- grip: bleed side-slip (traction). Handbrake or grass = looser = drift.
    const gripMul = input.handbrake ? 0.28 : this.offRoad ? 0.45 : 1;
    const traction = tuning.grip * gripMul;
    // steering induces some side-slip so hard cornering slides a touch
    vl += -steer * spd * 0.9 * dt * (input.handbrake ? 2.2 : 1);
    vl -= vl * Math.min(1, traction * dt);
    this.drifting = Math.abs(vl) > 3.5 && spd > tuning.maxSpeed * 0.25;
    this.slip = vl;

    // --- reassemble velocity + integrate ---------------------------------
    this.vx = F.x * vf + R.x * vl;
    this.vz = F.z * vf + R.z * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.speed = vf;

    // --- project onto the track: progress, ground, off-road --------------
    const pr = track.project(this.x, this.z);
    this.dist = pr.dist;
    this.lateral = pr.lateral;
    this.offRoad = Math.abs(pr.lateral) > ROAD_HALF_WIDTH;

    // --- walls: a firm barrier a bit past the verge keeps you on the ribbon.
    // Push the car back toward the road edge and kill the outward velocity.
    const WALL = ROAD_HALF_WIDTH + 3.5;
    this.onWall = Math.abs(pr.lateral) > WALL;
    if (this.onWall) {
      const over = Math.abs(pr.lateral) - WALL;
      const sign = Math.sign(pr.lateral);
      // road centre + its right vector at this distance, to shove back in world space
      const c = track.pointAt(track.wrap(pr.dist), 0, undefined, true);
      const t = track.tangentAt(track.wrap(pr.dist));
      const rx = t.z, rz = -t.x; // right of travel (unit, tangent is unit)
      this.x -= sign * rx * over;
      this.z -= sign * rz * over;
      // SCRAPE along the wall: remove only the into-wall velocity component and
      // keep the speed along it. No bounce — a bounce could reverse the car's
      // forward velocity and spin it (which also flipped reverse-steering).
      const outward = this.vx * (sign * rx) + this.vz * (sign * rz);
      if (outward > 0) {
        this.vx -= sign * rx * outward;
        this.vz -= sign * rz * outward;
      }
      void c;
    }
  }

  /** Ground height at the car (track surface). Engine adds jump altitude on top. */
  groundY(track: Track): number {
    return track.pointAt(track.wrap(this.dist), 0, undefined, true).y;
  }
}
