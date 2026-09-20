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
  /**
   * Cornering force the tyres hold before the car starts scrubbing speed,
   * in m/s². Demand above this bleeds FORWARD speed — see the scrub below.
   * Undefined = no limit, which is how this drove before: a constant-velocity
   * ride where corners cost nothing.
   */
  cornerGrip?: number;
  contain?: boolean;  // soft walls keep the car on the ribbon (default true); false = free flight (mech)
  assist?: number;    // gentle auto-turn into bends (rad/s per rad of error); 0/undefined = off
}

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Metres per second of forward speed lost per second, per m/s² of cornering
 * demand beyond what the tyres hold.
 *
 * This is a RATE, and what it really controls is how fast the car converges on
 * the speed a corner can actually be taken at. That speed is fixed by the
 * geometry: holding radius r needs v²/r ≤ limit, so the car settles at
 * √(limit·r) — about 107 mph through a 322 m sweeper and 56 through an 86 m
 * hairpin. At 0.5 the convergence was so slow that a two-second corner shed
 * only 5-10 mph and 80% of the lap still sat in one 10 mph band; the car was
 * never in the corner long enough to be slowed by it.
 */
const CORNER_SCRUB = 2.5;

/**
 * Fraction of drive still available with the tyres fully loaded sideways.
 *
 * Zero is a trap — see the friction circle. But it has to stay SMALL: at 0.34
 * the floor alone was 4.25 m/s² of drive, which cancelled the scrub almost
 * exactly, and even a grip limit of 2.5 left 92% of the lap above 110 mph.
 * Enough to recover on, not enough to power through a corner.
 */
const MIN_DRIVE_GRIP = 0.2;

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
  /** Lateral acceleration the tyres were carrying last step (m/s²). Drives the
   *  friction circle at the top of the next one. */
  latAccel = 0;
  /** Direction of travel last step, for measuring the PATH's curvature. */
  private prevVHeading = 0;
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
    this.vx = 0; this.vz = 0; this.speed = 0; this.slip = 0; this.latAccel = 0;
    this.prevVHeading = this.heading;
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
    //
    // THE FRICTION CIRCLE. A tyre has one budget of grip and cornering spends
    // it: what is left over is what you can put down as forward drive. Without
    // this the scrub below could not win — measured, acceleration is ~12.5 m/s²
    // and a typical corner's scrub is ~7, so the engine simply powered through
    // every bend and the car held top speed all the way round. Raising the
    // scrub until it beat the engine would have been a number fight; taking
    // the grip away from the engine instead is the thing that is actually
    // happening, and it produces the loop the game was missing: turn in, lose
    // the ability to accelerate, bleed down to the speed the corner allows,
    // then get it all back on the exit.
    //
    // Uses LAST step's cornering load, which is a frame of lag nobody can feel.
    // `?? Infinity` was wrong: it only catches null/undefined, so a cornerGrip
    // of 0 fell through and divided — load became NaN, driveGrip became NaN,
    // and every velocity in the simulation followed. It surfaced as a
    // non-finite value thrown by the audio engine, several layers away.
    const limit = tuning.cornerGrip && tuning.cornerGrip > 0 ? tuning.cornerGrip : Infinity;
    const load = Math.min(1, this.latAccel / limit);
    // FLOORED. The textbook circle takes drive to exactly zero at the limit,
    // and with nothing left to accelerate on, a car that is both cornering hard
    // and being pushed by the containment wall never recovers: measured,
    // holding one steering key went 108 mph → 23 → 1 → 0 and stayed there,
    // parked against the wall for the rest of the race. A car on the limit can
    // still hold its speed — that is what being on the limit means — so drive
    // bottoms out at a third rather than at nothing.
    const driveGrip = Math.max(
      MIN_DRIVE_GRIP,
      Math.sqrt(Math.max(0, 1 - load * load)),
    );
    const grassMul = this.offRoad ? 0.55 : 1;
    if (input.throttle) vf += tuning.accel * grassMul * driveGrip * dt;
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
    // 3.5 m/s of side-slip is a big slide — you had to provoke it deliberately,
    // which is why ordinary hard cornering left no marks on the road at all.
    // 1.8 catches a car that is genuinely sliding without calling every corner
    // a drift.
    this.drifting = Math.abs(vl) > 1.8 && spd > tuning.maxSpeed * 0.18;
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
      // AIM DOWN THE ROAD YOU ARE ON. The assist is pure pursuit to a point on
      // the centreline, and that point was always taken from the MAIN track —
      // so the moment you turned onto a fork it steered you straight back off
      // it. Measured: holding the throttle after joining a branch, the car was
      // on it for 34 frames out of 600. An alternate route you cannot stay on
      // is not an alternate route.
      if (kind >= 0) {
        const b = this.branches[kind];
        const bu = b.path.project(this.x, this.z).u;
        // Look ahead LESS on a branch than on the main road. A branch is an
        // open path a couple of hundred metres long, so a 41 m look-ahead
        // clamps to its final point near the exit and the car then aims at a
        // fixed spot instead of following the road — which is running wide,
        // exactly where the fork is already tightest.
        const look = 10 + Math.min(16, vf * 0.32);
        // Let pointAt allocate: this module deliberately holds no runtime three.js
        // import, and one Vector3 a frame is not worth breaking that for.
        const aim = b.path.pointAt(clampN(bu + look, 0, b.path.length), 0);
        let toAim = Math.atan2(aim.x - this.x, aim.z - this.z) - this.heading;
        toAim = Math.atan2(Math.sin(toAim), Math.cos(toAim));
        if (Math.abs(toAim) < 1.4) {
          const yieldToInput = 1 - Math.min(1, Math.abs(steer)) * 0.7;
          this.heading += toAim * tuning.assist * yieldToInput * dt;
        }
      } else {
      // PURE PURSUIT: aim at a point down the CENTRELINE (not just along the road's
      // tangent). Aiming at the tangent only held the car parallel to the road, so
      // one that had run wide ground along the wall forever with no way back; an
      // aim point pulls it in. Look further ahead the faster you go, so fast bends
      // are picked up early instead of at the apex.
      const look = 13 + Math.min(28, vf * 0.5);
      const aim = track.pointAt(track.wrap(this.dist + look), 0, undefined, true);
      let toAim = Math.atan2(aim.x - this.x, aim.z - this.z) - this.heading;
      toAim = Math.atan2(Math.sin(toAim), Math.cos(toAim)); // shortest way round
      if (Math.abs(toAim) < 1.4) {
        const yieldToInput = 1 - Math.min(1, Math.abs(steer)) * 0.7; // your input wins
        this.heading += toAim * tuning.assist * yieldToInput * dt;
      }
      }
    }

    // --- CORNERING SCRUB ---------------------------------------------------
    //
    // THE reason this did not feel like a racing game. Measured over a full lap
    // before this existed: mean 122.9 mph against a maximum of 123, standard
    // deviation 1.9, and 100% of the lap spent within 5 mph of top speed. The
    // car reached terminal velocity 3.3 s after the lights and held it for the
    // rest of the race, through every corner, because nothing anywhere took
    // speed away. With no speed to lose there is no speed to regain, so the
    // whole arcade loop — lift, commit to a line, get it back on the exit —
    // had no first step.
    //
    // A corner is the car turning, and turning is lateral acceleration:
    // yaw rate × speed. Above what the tyres hold, the excess has to come out
    // of forward speed. Deliberately measured from the ACTUAL heading change
    // rather than from the player's input, because the steering assist turns
    // the car too — if only your own steering scrubbed, the assist would go on
    // carrying you through every corner at full speed, which is exactly the
    // bug this is fixing.
    if (!tuning.cornerGrip || tuning.cornerGrip <= 0) this.latAccel = 0;
    if (tuning.cornerGrip && tuning.cornerGrip > 0) {
      // MEASURED FROM THE PATH, NOT THE HEADING.
      //
      // The first version used the car's yaw rate × speed, which in this model
      // is not a lateral acceleration at all: steering sets the HEADING
      // directly and the velocity follows only as fast as the grip term drags
      // it round. A flick of full lock is ~2 rad/s, so at 46 m/s that read as
      // 92 m/s² against a 5 m/s² limit — and the scrub then removed 100 m/s of
      // speed per second. Measured: holding one steering key took the car from
      // 104 mph to a DEAD STOP against the wall in five seconds, permanently.
      //
      // The real centripetal load is how fast the DIRECTION OF TRAVEL turns,
      // which the grip term already bounds — so it cannot run away, and a flick
      // costs what a flick should cost rather than the whole race.
      //
      // (I missed this because every measurement up to that point was taken
      // hands-off, where the steering assist turns the car gently. The failure
      // only appears when a player actually steers.)
      const speedNow = Math.hypot(this.vx, this.vz);
      let latAccel = 0;
      if (speedNow > 2) {
        const vHeading = Math.atan2(this.vx, this.vz);
        let dv = vHeading - this.prevVHeading;
        dv = Math.atan2(Math.sin(dv), Math.cos(dv));
        latAccel = (Math.abs(dv) / Math.max(1e-4, dt)) * speedNow;
        this.prevVHeading = vHeading;
      } else {
        this.prevVHeading = Math.atan2(this.vx, this.vz);
      }
      this.latAccel = latAccel;              // feeds next step's friction circle
      const over = latAccel - tuning.cornerGrip;
      if (over > 0) {
        // Speed lost per second, proportional to how far past the limit you
        // are. Applied to the whole velocity so the side-slip scrubs with it.
        const loss = Math.min(Math.abs(vf), over * CORNER_SCRUB * dt);
        const k = Math.abs(vf) > 1e-3 ? Math.max(0, 1 - loss / Math.abs(vf)) : 1;
        this.vx *= k;
        this.vz *= k;
        this.speed = vf * k;
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
