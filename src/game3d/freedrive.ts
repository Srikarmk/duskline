import type { Track } from "./track";
import type { BranchPath } from "./branch";
import { ROAD_HALF_WIDTH } from "./constants";

/** Player input for a physics step (already debounced by the engine). */
export interface DriveInput {
  throttle: boolean;
  brake: boolean;
  steer: number;      // analog -1..1 (already smoothed by the caller): + = left, - = right
  handbrake: boolean; // drift
}

export interface DriveTuning {
  maxSpeed: number;   // top forward speed (m/s)
  accel: number;      // forward acceleration (m/s²)
  turnRate: number;   // base yaw rate (rad/s) at moderate speed
  grip: number;       // lateral traction (per-second bleed of side-slip)
  contain?: boolean;  // soft walls keep the car on the ribbon (default true); false = free flight (mech)
  assist?: number;    // gentle auto-turn into bends (rad/s per rad of error); 0/undefined = off
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
  /** alternate routes: the car drives whichever road (main or a branch) it's
   *  nearest to. Set by the engine after building branches. */
  branches: { path: BranchPath; startDist: number; endDist: number }[] = [];
  onBranchIdx = -1;   // index into branches, or -1 when on the main road

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
    vf = clampN(vf, -tuning.maxSpeed * 0.12, topFwd); // only a slow reverse (for un-sticking, not racing)

    // --- steering ---------------------------------------------------------
    // turn rate falls with speed (twitchy when slow, stable when fast) and needs
    // motion; reverse flips the steering so it behaves like a real car.
    const steer = input.steer;                                    // smoothed analog wheel
    const spd = Math.abs(vf);
    const speedFrac = clampN(spd / tuning.maxSpeed, 0, 1);
    const move = clampN(spd / 4, 0, 1);                           // needs some motion to turn
    // more stable at speed (0.5..1.0) so fast corners aren't twitchy
    const turn = steer * tuning.turnRate * (0.5 + 0.5 * (1 - speedFrac)) * move * Math.sign(vf || 1);
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

    // --- project onto the nearest road (main OR a branch), for progress,
    // ground, off-road and walls. Drive whichever road you're closest to, so at
    // a fork you can peel onto the branch and be kept on it.
    const pr = track.project(this.x, this.z);
    let bestLat = pr.lateral, bestDist = pr.dist, kind = -1;
    // chosen road's centre + right vector (world), for the wall push-back
    const mc = track.pointAt(track.wrap(pr.dist), 0);
    const mt = track.tangentAt(track.wrap(pr.dist));
    let cx = mc.x, cz = mc.z, rx = mt.z, rz = -mt.x;
    for (let bi = 0; bi < this.branches.length; bi++) {
      const b = this.branches[bi];
      if (pr.dist < b.startDist - 25 || pr.dist > b.endDist + 25) continue; // not near this fork
      const bp = b.path.project(this.x, this.z);
      if (Math.abs(bp.lateral) < Math.abs(bestLat)) {
        bestLat = bp.lateral;
        bestDist = b.startDist + (bp.u / b.path.length) * (b.endDist - b.startDist);
        kind = bi;
        const c = b.path.pointAt(bp.u, 0);
        const t = b.path.tangentAt(bp.u);
        cx = c.x; cz = c.z; rx = t.z; rz = -t.x;
      }
    }
    this.dist = bestDist;
    this.lateral = bestLat;
    this.onBranchIdx = kind;
    this.offRoad = Math.abs(bestLat) > ROAD_HALF_WIDTH;
    void cx; void cz;

    // GENTLE AUTO-TURN: a light steering assist that eases the nose toward the
    // road ahead through bends, so the car tracks the corner instead of running
    // wide. Deliberately subtle — it never drives for you: it backs off as soon
    // as you steer, is off while drifting, and only helps when you're already
    // pointing roughly down the road and on the ribbon.
    if (tuning.assist && !input.handbrake && vf > 5) {
      const ta = track.tangentAt(track.wrap(this.dist + 14));
      let toRoad = Math.atan2(ta.x, ta.z) - this.heading;
      toRoad = Math.atan2(Math.sin(toRoad), Math.cos(toRoad)); // shortest way round
      if (Math.abs(toRoad) < 0.7) {
        const onRibbon = clampN(1 - (Math.abs(this.lateral) - ROAD_HALF_WIDTH) / 4, 0, 1);
        const yieldToInput = 1 - Math.min(1, Math.abs(steer)) * 0.7; // your input wins
        this.heading += toRoad * tuning.assist * yieldToInput * onRibbon * dt;
      }
    }

    // SOFT-BUT-FIRM WALLS keep the car on the ribbon (and inside tubes/tunnels).
    // You can run a little onto the verge, but past `soft` you're smoothly steered
    // back, and you can never cross `hard` — so the car never sails off into the
    // void or out of a tunnel. Disabled for the flying mech (contain === false).
    this.onWall = false;
    if (tuning.contain !== false) {
      const absLat = Math.abs(bestLat);
      const soft = ROAD_HALF_WIDTH + 0.6;  // grass overrun begins (~5.6 m)
      const hard = ROAD_HALF_WIDTH + 1.6;  // absolute limit (~6.6 m) — never past this
      if (absLat > soft) {
        // Inward direction (toward the centreline). `rx,rz` here is (tan.z,-tan.x),
        // which is the OPPOSITE of pointAt's right-vector — and project()'s lateral
        // now matches pointAt — so inward is +sign(lateral) · (rx,rz).
        const inx = Math.sign(bestLat) * rx, inz = Math.sign(bestLat) * rz;
        const over = absLat - soft;
        // gentle spring back toward `soft`, plus a hard clamp so you can't pass `hard`
        let corr = over * Math.min(1, dt * 10);
        if (absLat > hard) corr = Math.max(corr, absLat - hard);
        this.x += inx * corr; this.z += inz * corr;
        // kill the outward-heading velocity so you don't keep plowing off the edge
        const outward = this.vx * -inx + this.vz * -inz;
        if (outward > 0) { this.vx += inx * outward; this.vz += inz * outward; }
        this.lateral = Math.sign(bestLat) * (absLat - corr); // reflect the correction
        this.offRoad = Math.abs(this.lateral) > ROAD_HALF_WIDTH;
        this.onWall = true;
      }
    }
  }

  /** Ground height at the car (track surface). Engine adds jump altitude on top. */
  groundY(track: Track): number {
    return track.pointAt(track.wrap(this.dist), 0, undefined, true).y;
  }
}
