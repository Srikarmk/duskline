import type { CarId } from "../game/engine";

// Pure car metadata — no three.js, so the React home screen can render the
// garage without pulling the 3D engine into its bundle. The mesh builder
// (makeKart) lives in cars.ts and reads these stats.

export interface CarStat {
  /** top-speed multiplier */
  speed: number;
  /** acceleration multiplier */
  accel: number;
  /** cornering grip + steering-response multiplier */
  grip: number;
}

export interface CarStars {
  speed: number;
  accel: number;
  handling: number;
}

export interface CarSpec {
  id: CarId;
  name: string;
  blurb: string;
  /** default livery color */
  color: number;
  stars: CarStars;
  stat: CarStat;
}

export const CAR_SPECS: Record<CarId, CarSpec> = {
  comet: {
    id: "comet",
    name: "COMET",
    blurb: "All-rounder. No weaknesses, no drama — a safe first pick.",
    color: 0x22d3ee,
    stars: { speed: 3, accel: 3, handling: 3 },
    stat: { speed: 1.0, accel: 1.0, grip: 1.0 },
  },
  bolt: {
    id: "bolt",
    name: "BOLT",
    blurb: "Top-speed monster. Slow to wind up, but untouchable on straights.",
    color: 0xa855f7,
    stars: { speed: 5, accel: 2, handling: 3 },
    stat: { speed: 1.14, accel: 0.85, grip: 0.95 },
  },
  titan: {
    id: "titan",
    name: "TITAN",
    blurb: "Heavy bruiser. Rockets off the line and shrugs off hits.",
    color: 0xf97316,
    stars: { speed: 3, accel: 5, handling: 2 },
    stat: { speed: 0.95, accel: 1.2, grip: 0.82 },
  },
  wisp: {
    id: "wisp",
    name: "WISP",
    blurb: "Featherweight. Razor cornering, darts through packs and chicanes.",
    color: 0x4ade80,
    stars: { speed: 2, accel: 4, handling: 5 },
    stat: { speed: 0.9, accel: 1.1, grip: 1.25 },
  },
};

export const CAR_IDS = Object.keys(CAR_SPECS) as CarId[];

/** "#rrggbb" string form of a car's default livery, for CSS. */
export function carColorHex(id: CarId): string {
  return "#" + CAR_SPECS[id].color.toString(16).padStart(6, "0");
}
