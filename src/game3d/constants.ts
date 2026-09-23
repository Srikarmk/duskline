// 3D world tuning. Distances are meters, speeds m/s, times seconds.
export const WIDTH = 800;
export const HEIGHT = 600;
export const STEP = 1 / 60;

/** Multiplier on every realm's control points, so laps are longer and a race
 *  actually takes time. 1.55 turns the ~1.5 km circuits into ~2.4 km ones: at
 *  ~60 m/s that's ~40 s a lap, so a 3-lap race runs about two minutes instead of
 *  well under one. Shape, corner sequence and elevation are unchanged — only the
 *  scale — and everything downstream is per-metre so it follows automatically. */
export const TRACK_SCALE = 1.55;

export const ROAD_HALF_WIDTH = 5;
export const LANES = 3;
/** the road surface renders slightly above the track centerline, so lift cars
 *  by this much to keep their wheels on the road instead of sinking in */
// Clearance between the car's origin and the road. makeWheel already places
// each wheel centre at exactly its radius, so the tyre's contact patch sits at
// the car's own origin — meaning any lift here is a gap between the tyres and
// the tarmac. At 0.2 the car hovered 20 cm off the road, which is the
// "floating, not running on the road" feel. This is now just enough to keep
// the shadow and the road out of a depth fight.
// Enough to absorb the suspension squat below, so a hard compression can bring
// the contact patch to the road but never through it.
export const CAR_LIFT = 0.05;
export const LANE_CENTERS = [-2 / 3, 0, 2 / 3]; // in playerX units (1 = road edge)

// 46 was cut from 58 back when corners were free and the car sat at terminal
// velocity for the whole lap — at that point the only thing top speed changed
// was how fast the scenery blurred. The friction circle changed the premise:
// corner speed is now sqrt(grip x radius) and does not depend on this number
// at all, so raising it lengthens the gap between the slowest corner and the
// fastest straight instead of just making everything faster. Measured over a
// forest lap at 56: p05 35 m/s, p50 52, p95 58.5 — a 23 m/s working range,
// where 46 gave 21 m/s but topped out at 48.
export const MAX_SPEED = 56;
export const ACCEL = MAX_SPEED / 3.6; // punchier off-the-line + out of corners
export const BRAKING = -MAX_SPEED;
export const DECEL = -MAX_SPEED / 5;
export const OFF_ROAD_DECEL = -MAX_SPEED / 2;
export const OFF_ROAD_LIMIT = MAX_SPEED / 4;

// --- arcade handling (grip-limited lateral model) -------------------------
// The car carries lateral velocity (playerX units/s). Steering asks for a
// lateral acceleration; the tires can only deliver up to a grip limit, so a
// too-fast corner pushes you wide (understeer) — you feel the limit. Weight
// transfer, steering inertia and speed-sensitive authority give it heft.

/** how fast the "wheel" turns toward the input (steering inertia = weight) */
export const STEER_RESPONSE = 8;  // lower = the wheel eases in, not a twitchy snap
/** how fast steering re-centers when released */
export const STEER_RETURN = 13;
/** lateral accel from full steer at speed (playerX units/s²) */
export const TURN_ACCEL = 13;
/** steering authority loss with speed (higher = heavier at top speed) */
export const STEER_SPEED_FALLOFF = 0.007;
/** max lateral accel the tires can produce — the grip ceiling (playerX u/s²) */
export const GRIP_LIMIT = 14;
/** tire scrub: bleeds off sideways velocity so the car settles / self-centers */
export const LATERAL_DAMP = 7.5;
/** strength of the v²/r push toward the outside of a curve — gentle so corners
 *  don't fling you wide (arcade-forgiving) */
export const CENTRI_K = 0.78; // stronger corner load — you must actively steer/brake, not coast turns

// --- free-roam driving (the car is a world-space body, not rail-locked) ---
export const FREE_TURN_RATE = 2.0; // base yaw rate (rad/s) — dialed back further (was 2.6) so it isn't over-sensitive/darty
export const FREE_GRIP = 11.5;     // lateral traction (side-slip bleed / s) — high, so the car stays PLANTED and stable; handbrake still breaks it loose for drift
/**
 * Cornering force the tyres hold before speed starts scrubbing, in m/s².
 *
 * TUNED AGAINST THE LAP'S OWN DISTRIBUTION, not from physics. The first pass
 * set this to 5, reasoning that a quarter of the lap over the limit would make
 * corners cost something. Measured after the fact, it was not a quarter: the
 * car was at the drive floor for 48% of the lap and under 60% drive for 55%,
 * with median lateral load 4.7 against a limit of 5. More than half the race
 * was run with four fifths of the engine taken away, which is what "the
 * acceleration is weird and the speed is low" actually was.
 *
 * 15 was the other end of the same mistake. It freed the corners almost
 * completely: the car sat at 96% of its top speed for half the lap (median
 * 56.3 m/s against a maximum of 58.4), which is the terminal-velocity ride
 * the friction circle exists to stop.
 *
 * 11 is where the two numbers both behave. Measured over a forest lap, the
 * median sits at 82% of top speed with the dial reading 130 through the
 * slowest corners and 209 flat out — a range you can feel — and the tyres are
 * saturated for a bit under 40% of the lap rather than half of it.
 *
 * Multiplied by the kart's grip stat and by the weather, so those numbers
 * finally mean what they say.
 */
export const CORNER_GRIP = 11;
/** gentle auto-turn into bends (rad/s per rad of heading error). Subtle on
 *  purpose — it helps the car track a corner without steering for you, and
 *  fades out the moment you touch the wheel. Raise for more assist. */
export const FREE_STEER_ASSIST = 2.4;
/** grip while braking (weight forward → sharper turn-in) */
export const WEIGHT_BRAKE_GRIP = 1.3;
/** grip while on the throttle (weight back → a touch looser) */
export const WEIGHT_THROTTLE_GRIP = 0.92;
/** grip multiplier while drifting — the car slides instead of biting */
export const DRIFT_GRIP_MULT = 0.5;
/** extra steering authority into a drift */
export const DRIFT_STEER_MULT = 1.5;

/** seconds of drift before a boost is earned */
export const DRIFT_MIN_CHARGE = 0.55;
export const DRIFT_BOOST_FACTOR = 1.14;

export const TOTAL_LAPS = 3;
// |playerX| > 1 = a wheel on the grass; past this you're fully off the track
// and get snapped back. A little forgiving margin so minor wobbles aren't
// punished, but you still can't drive off into the scenery.
export const OUT_OF_BOUNDS_X = 2.0;
export const OUT_OF_BOUNDS_PENALTY = 100;
/** seconds you may roam off the track before you're respawned back on it (no
 *  penalty) — you can cut across the terrain for a bit, but not forever */
export const OFFTRACK_GRACE = 5;

export const NITRO_DURATION = 2.2;
// The boosts used to MULTIPLY together: car 1.22 x nitro 1.35 x item 1.4 was
// 2.31x base. Compressed so the whole stack lands near 200 rather than 400.
export const NITRO_SPEED_FACTOR = 1.18;

// vertical physics (meters)
export const GRAVITY = 14;
export const RAMP_LAUNCH = 7.5;
export const FLY_LIFT = 30;
export const MAX_ALT = 9;
export const AIR_GEM_ALT = 3.2;
export const AIR_GEM_TOLERANCE = 1.7;

export const TRANSFORM_SPEED_FACTOR = 1.2;

export const SCORE_GEM = 100;
export const SCORE_AIR_GEM = 250;
export const SCORE_STUNT = 400;
export const SCORE_LANE_BONUS = 200;
export const SCORE_SMASH = 50;
export const SCORE_MONSTER = 300;
export const SCORE_FINISH = 1000;
export const LANE_BONUS_SECONDS = 4;

// AI opponents
// 9 rivals + you = a 10-car grid, and the player always starts P10 (the grid
// code puts the player in the backmost slot), so every race is a climb from the
// back of an F1-style staggered grid.
export const OPPONENT_COUNT = 9;
export const OPPONENTS: { name: string; color: number; skill: number }[] = [
  { name: "Vex", color: 0xef4444, skill: 1.0 },
  { name: "Nyx", color: 0x22c55e, skill: 0.99 },
  { name: "Zir", color: 0xf59e0b, skill: 0.985 },
  { name: "Kai", color: 0x3b82f6, skill: 0.98 },
  { name: "Rok", color: 0xec4899, skill: 0.975 },
  { name: "Ash", color: 0xa855f7, skill: 0.97 },
  { name: "Jet", color: 0x14b8a6, skill: 0.965 },
  { name: "Bo", color: 0xf97316, skill: 0.96 },
  { name: "Kit", color: 0x84cc16, skill: 0.955 },
  { name: "Rune", color: 0x06b6d4, skill: 0.95 },
];

// sword swing (transformer melee)
export const SWING_DURATION = 0.35;

// boost pads on the track (drive over the arrows for a speed surge)
export const PAD_BOOST_DURATION = 1.1;

// power-ups
export const ITEM_BOOST_DURATION = 1.7;
export const ITEM_BOOST_FACTOR = 1.2;
export const ITEM_SHIELD_DURATION = 6;
export const MISSILE_SPEED = 100; // m/s along the track
export const MISSILE_MAX_DIST = 240; // how far before it fizzles
export const STUN_DURATION = 1.7; // seconds an opponent is spun out
export const ITEM_LATERAL_TOL = 0.65; // lateral hit tolerance for missile/mine
export const SCORE_HIT = 150; // points for hitting an opponent
export const OPPONENT_MINE_CHANCE = 0.06; // per second, an opponent drops a mine

// camera presets: distance behind, height, look-ahead distance, look height
export interface CameraPreset {
  name: string;
  back: number;
  height: number;
  ahead: number;
  lookHeight: number;
  fov: number;
  /**
   * How much of the gap to the ideal position the camera closes each frame.
   *
   * Every preset used to run at a hard-coded 0.5, which is a very stiff rig —
   * it copies half of any movement of the car IMMEDIATELY. On the chase cam
   * that reads as responsive. On CINEMATIC, sitting 16 m back where the ground
   * under the camera is a different height from the ground under the car, it
   * reads as the camera being jerked around: measured over 15 s on Enchanted
   * Forest, chase moved at most 0.32 degrees in a frame and cinematic 14.5.
   * A cinematic camera is supposed to lag.
   */
  follow: number;
}
export const CAMERA_PRESETS: CameraPreset[] = [
  { name: "CHASE", back: 9.5, height: 3.4, ahead: 7, lookHeight: 1.2, fov: 72, follow: 0.5 },
  { name: "CINEMATIC", back: 16, height: 6.5, ahead: 4, lookHeight: 1.8, fov: 66, follow: 0.13 },
  // A bonnet cam has to sit AHEAD of the car's centre, not 2 m behind it. With
  // the old value the camera sat inside the new low supercar body and you got a
  // full-screen close-up of the driver's helmet. Negative `back` puts it out
  // over the nose, so nothing of the car is between you and the road.
  { name: "HOOD", back: -1.6, height: 1.15, ahead: 18, lookHeight: 1.1, fov: 84, follow: 0.6 },
];

// re-exported so 3D code and the shared HUD agree
export { NITRO_MAX_CHARGES, TRANSFORM_DURATION } from "../game/constants";
