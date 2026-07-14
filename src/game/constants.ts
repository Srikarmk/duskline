export const WIDTH = 800;
export const HEIGHT = 600;
export const STEP = 1 / 60; // fixed timestep, seconds

// Road geometry (world units)
export const ROAD_WIDTH = 2000; // half-width of road, center to edge
export const SEGMENT_LENGTH = 200;
export const RUMBLE_LENGTH = 3; // segments per rumble strip
export const DRAW_DISTANCE = 300; // segments drawn per frame
export const LANES = 3;

// Camera
export const FIELD_OF_VIEW = 100; // degrees
export const CAMERA_HEIGHT = 1000;
export const CAMERA_DEPTH = 1 / Math.tan(((FIELD_OF_VIEW / 2) * Math.PI) / 180);
export const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH; // player sits this far ahead of camera

// Driving model
export const MAX_SPEED = SEGMENT_LENGTH / STEP; // one segment per frame at top speed
export const ACCEL = MAX_SPEED / 5;
export const BRAKING = -MAX_SPEED;
export const DECEL = -MAX_SPEED / 5;
export const OFF_ROAD_DECEL = -MAX_SPEED / 2;
export const OFF_ROAD_LIMIT = MAX_SPEED / 4;
export const CENTRIFUGAL = 0.3; // how hard curves push you outward

// Race rules
export const TOTAL_LAPS = 3;
export const OUT_OF_BOUNDS_X = 2.3; // beyond this |playerX| you are hauled back
export const OUT_OF_BOUNDS_PENALTY = 100;

// Nitro
export const NITRO_MAX_CHARGES = 3;
export const NITRO_DURATION = 2.2; // seconds per boost
export const NITRO_SPEED_FACTOR = 1.35;

// Altitude is normalized 0..1 (0 = ground, 1 = flight ceiling)
export const GRAVITY = 2.2; // alt units / s^2
export const RAMP_LAUNCH = 1.9; // initial vertical speed off a ramp at full speed
export const FLY_LIFT = 5.5; // lift accel while holding fly
export const ALT_PIXEL_FACTOR = 0.21; // alt -> screen pixels, scaled by segment width
export const AIR_GEM_ALT = 0.55; // where air gems float
export const AIR_GEM_TOLERANCE = 0.28;

// Transformer mode
export const TRANSFORM_DURATION = 12; // seconds per orb
export const TRANSFORM_SPEED_FACTOR = 1.2;

// Scoring
export const SCORE_GEM = 100;
export const SCORE_AIR_GEM = 250;
export const SCORE_STUNT = 400; // per full mid-air rotation
export const SCORE_LANE_BONUS = 200;
export const SCORE_SMASH = 50; // mech smashing a rock
export const SCORE_FINISH = 1000;
export const LANE_BONUS_SECONDS = 4; // hold a lane this long for the bonus

// Enchanted-forest realm palette
export const COLORS = {
  sky: { top: "#1a1033", bottom: "#4a2d6e" },
  fog: "#4a2d6e",
  horizonGlow: "#c084fc",
  mountainFar: "#2b1d4d",
  mountainNear: "#231640",
  light: {
    road: "#3b3355",
    grass: "#14532d",
    rumble: "#c084fc",
    lane: "#d8d0f0",
  },
  dark: {
    road: "#352e4d",
    grass: "#0f3d22",
    rumble: "#6d28d9",
  },
} as const;
