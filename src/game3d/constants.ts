// 3D world tuning. Distances are meters, speeds m/s, times seconds.
export const WIDTH = 800;
export const HEIGHT = 600;
export const STEP = 1 / 60;

export const ROAD_HALF_WIDTH = 5;
export const LANES = 3;
export const LANE_CENTERS = [-2 / 3, 0, 2 / 3]; // in playerX units (1 = road edge)

export const MAX_SPEED = 55;
export const ACCEL = MAX_SPEED / 5;
export const BRAKING = -MAX_SPEED;
export const DECEL = -MAX_SPEED / 5;
export const OFF_ROAD_DECEL = -MAX_SPEED / 2;
export const OFF_ROAD_LIMIT = MAX_SPEED / 4;

// --- steering & drift (lateral-velocity model, not positional) ---
/** target lateral velocity (playerX units/s) per unit steer at full speed */
export const STEER_ACCEL = 3.2;
/** how fast lateral velocity chases its target when gripping (higher = tighter) */
export const GRIP = 6.5;
/** low grip while drifting — the car slides instead of biting */
export const DRIFT_GRIP = 2.1;
/** outward lateral velocity from a curve, per (curvature × speed) — gentle so
 *  turns don't fling you off the road unless you ignore the steering */
export const CENTRIFUGAL = 0.9;
/** seconds of drift before a boost is earned */
export const DRIFT_MIN_CHARGE = 0.55;
export const DRIFT_BOOST_FACTOR = 1.28;

export const TOTAL_LAPS = 3;
export const OUT_OF_BOUNDS_X = 2.9;
export const OUT_OF_BOUNDS_PENALTY = 100;

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
export const OPPONENT_COUNT = 8;
export const OPPONENTS: { name: string; color: number; skill: number }[] = [
  { name: "Vex", color: 0xef4444, skill: 1.0 },
  { name: "Nyx", color: 0x22c55e, skill: 0.99 },
  { name: "Zir", color: 0xf59e0b, skill: 0.98 },
  { name: "Kai", color: 0x3b82f6, skill: 0.97 },
  { name: "Rok", color: 0xec4899, skill: 0.96 },
  { name: "Ash", color: 0xa855f7, skill: 0.95 },
  { name: "Jet", color: 0x14b8a6, skill: 0.94 },
  { name: "Bo", color: 0xf97316, skill: 0.93 },
];

// sword swing (transformer melee)
export const SWING_DURATION = 0.35;

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
