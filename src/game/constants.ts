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

// Driving model
export const MAX_SPEED = SEGMENT_LENGTH / STEP; // one segment per frame at top speed
export const ACCEL = MAX_SPEED / 5;
export const BRAKING = -MAX_SPEED;
export const DECEL = -MAX_SPEED / 5;
export const OFF_ROAD_DECEL = -MAX_SPEED / 2;
export const OFF_ROAD_LIMIT = MAX_SPEED / 4;

// Enchanted-forest realm palette
export const COLORS = {
  sky: { top: "#1a1033", bottom: "#4a2d6e" },
  horizonGlow: "#c084fc",
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
