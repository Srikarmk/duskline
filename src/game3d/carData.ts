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
  // The grid is now ten real-world supercar archetypes rather than fantasy
  // karts, because the reference art is photographs of actual cars. Stats keep
  // the old spread (speed 0.9-1.22, accel 0.85-1.3, grip 0.68-1.32) so nothing
  // downstream — AI rubber-banding, lap times, the star display — needs
  // retuning; only the names, liveries and bodies changed.
  f40: {
    id: "f40",
    name: "F40",
    blurb: "Twin-turbo 80s wedge. No driver aids, no comfort, a straked wing and a red that means it.",
    color: 0xd0021b,
    stars: { speed: 5, accel: 4, handling: 4 },
    stat: { speed: 1.14, accel: 1.05, grip: 1.1 },
  },
  meridian: {
    id: "meridian",
    name: "MERIDIAN",
    blurb: "Centre-seat road racer. Gold-lined V12 behind your head — the fastest thing here, and it knows.",
    color: 0xff6a13,
    stars: { speed: 5, accel: 4, handling: 5 },
    stat: { speed: 1.2, accel: 1.05, grip: 1.15 },
  },
  veloce: {
    id: "veloce",
    name: "VELOCE",
    blurb: "Quad-turbo W16 in two-tone. Absurdly fast in a straight line, absurdly heavy everywhere else.",
    color: 0x1b3a8f,
    stars: { speed: 5, accel: 5, handling: 3 },
    stat: { speed: 1.22, accel: 1.15, grip: 0.95 },
  },
  tauro: {
    id: "tauro",
    name: "TAURO",
    blurb: "Pure wedge. A basket-handle wing, terrible visibility and the best poster of all time.",
    color: 0xf2f2ef,
    stars: { speed: 5, accel: 3, handling: 3 },
    stat: { speed: 1.18, accel: 0.92, grip: 0.9 },
  },
  testa: {
    id: "testa",
    name: "TESTA",
    blurb: "Flat-twelve grand tourer. Side strakes, a metre of rear track and a slatted tail.",
    color: 0xc81f24,
    stars: { speed: 4, accel: 3, handling: 3 },
    stat: { speed: 1.1, accel: 0.95, grip: 0.95 },
  },
  zanza: {
    id: "zanza",
    name: "ZANZA",
    blurb: "All-alloy mid-engine scalpel. Glass canopy, fighter-jet visibility, surgical through a corner.",
    color: 0x101318,
    stars: { speed: 4, accel: 3, handling: 5 },
    stat: { speed: 1.05, accel: 1.02, grip: 1.22 },
  },
  imprez: {
    id: "imprez",
    name: "IMPREZ",
    blurb: "Turbo all-wheel-drive rally sedan. Gold wheels, a bonnet scoop and grip on anything.",
    color: 0x0b5fd0,
    stars: { speed: 3, accel: 5, handling: 5 },
    stat: { speed: 0.96, accel: 1.18, grip: 1.28 },
  },
  firehawk: {
    id: "firehawk",
    name: "FIREHAWK",
    blurb: "Five litres of black T-top muscle. Shaker scoop, whale tail, and absolutely no interest in corners.",
    color: 0x14141a,
    stars: { speed: 3, accel: 4, handling: 2 },
    stat: { speed: 1.0, accel: 1.12, grip: 0.8 },
  },
  iroc: {
    id: "iroc",
    name: "IROC",
    blurb: "Square-jawed race-series coupe. Deep front air dam, ducktail lip, four round lamps.",
    color: 0xe8e8ea,
    stars: { speed: 3, accel: 4, handling: 2 },
    stat: { speed: 1.02, accel: 1.08, grip: 0.85 },
  },
  fairlady: {
    id: "fairlady",
    name: "FAIRLADY",
    blurb: "Long-bonnet fastback classic. Light, chrome-bumpered and far quicker than it looks.",
    color: 0xf07f13,
    stars: { speed: 2, accel: 3, handling: 4 },
    stat: { speed: 0.92, accel: 0.98, grip: 1.12 },
  },
};

export const CAR_IDS = Object.keys(CAR_SPECS) as CarId[];

/** "#rrggbb" string form of a car's default livery, for CSS. */
export function carColorHex(id: CarId): string {
  return "#" + CAR_SPECS[id].color.toString(16).padStart(6, "0");
}

/**
 * The livery, lifted to something legible as UI text on the dark home screen.
 * Real cars come in black and white, and the menu paints the car's NAME in its
 * own livery — so FIREHAWK (0x14141a) rendered as black text on a black panel
 * and simply wasn't there. Anything below ~45% luminance is raised; anything
 * above stays put.
 */
export function carUIHex(id: CarId): string {
  const c = CAR_SPECS[id].color;
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum < 0.45) {
    // push toward white, keeping the hue: a near-black car reads as pale silver
    const k = (0.45 - lum) / 0.45;
    const t = 0.25 + 0.65 * k;
    r = Math.round(r + (235 - r) * t);
    g = Math.round(g + (238 - g) * t);
    b = Math.round(b + (245 - b) * t);
  }
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}
