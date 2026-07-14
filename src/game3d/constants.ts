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
/** playerX push per (curvature rad/m × speed m/s — i.e. rad/s of turning) */
export const CENTRIFUGAL = 1.2;

export const TOTAL_LAPS = 3;
export const OUT_OF_BOUNDS_X = 2.3;
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
export const SCORE_FINISH = 1000;
export const LANE_BONUS_SECONDS = 4;

// re-exported so 3D code and the shared HUD agree
export { NITRO_MAX_CHARGES, TRANSFORM_DURATION } from "../game/constants";
