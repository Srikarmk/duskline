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
  apex: {
    id: "apex",
    name: "APEX",
    blurb: "Formula thoroughbred. Surgical grip and blistering top end — punishes mistakes.",
    color: 0xef4444,
    stars: { speed: 5, accel: 3, handling: 5 },
    stat: { speed: 1.16, accel: 1.0, grip: 1.3 },
  },
  goliath: {
    id: "goliath",
    name: "GOLIATH",
    blurb: "Monster truck. Enormous tyres crush anything, rockets off the line, wallows in bends.",
    color: 0x84cc16,
    stars: { speed: 3, accel: 5, handling: 1 },
    stat: { speed: 0.92, accel: 1.25, grip: 0.72 },
  },
  wraith: {
    id: "wraith",
    name: "WRAITH",
    blurb: "Anti-grav phantom. No wheels — it hovers, ghosting through corners on a cushion of light.",
    color: 0x818cf8,
    stars: { speed: 3, accel: 3, handling: 5 },
    stat: { speed: 1.0, accel: 0.95, grip: 1.32 },
  },
  nitro: {
    id: "nitro",
    name: "NITRO",
    blurb: "Top-fuel dragster. A blown engine on wheels — savage down the straights, hopeless in bends.",
    color: 0xfacc15,
    stars: { speed: 5, accel: 5, handling: 1 },
    stat: { speed: 1.18, accel: 1.3, grip: 0.68 },
  },
  dune: {
    id: "dune",
    name: "DUNE",
    blurb: "Off-road buggy. Caged, knobbly and fearless — claws out of anything, tops out early.",
    color: 0xf472b6,
    stars: { speed: 2, accel: 4, handling: 4 },
    stat: { speed: 0.9, accel: 1.15, grip: 1.18 },
  },
  blaze: {
    id: "blaze",
    name: "BLAZE",
    blurb: "Jet-powered rocket car. A turbine strapped to a needle — blistering top end, white-knuckle grip.",
    color: 0x0ea5e9,
    stars: { speed: 5, accel: 4, handling: 2 },
    stat: { speed: 1.2, accel: 1.08, grip: 0.82 },
  },
};

export const CAR_IDS = Object.keys(CAR_SPECS) as CarId[];

/** "#rrggbb" string form of a car's default livery, for CSS. */
export function carColorHex(id: CarId): string {
  return "#" + CAR_SPECS[id].color.toString(16).padStart(6, "0");
}
