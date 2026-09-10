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
export const CAR_LIFT = 0.2;
export const LANE_CENTERS = [-2 / 3, 0, 2 / 3]; // in playerX units (1 = road edge)

export const MAX_SPEED = 58;
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
export const DRIFT_BOOST_FACTOR = 1.28;

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
export const NITRO_SPEED_FACTOR = 1.35;

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
export const ITEM_BOOST_FACTOR = 1.4;
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
}
export const CAMERA_PRESETS: CameraPreset[] = [
  { name: "CHASE", back: 9.5, height: 3.4, ahead: 7, lookHeight: 1.2, fov: 72 },
  { name: "CINEMATIC", back: 16, height: 6.5, ahead: 4, lookHeight: 1.8, fov: 66 },
  { name: "HOOD", back: 2, height: 2.3, ahead: 14, lookHeight: 1.6, fov: 82 },
];

// re-exported so 3D code and the shared HUD agree
export { NITRO_MAX_CHARGES, TRANSFORM_DURATION } from "../game/constants";
