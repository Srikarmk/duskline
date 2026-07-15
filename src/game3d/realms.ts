import type { RealmId } from "../game/engine";

export type SceneryKind =
  | "treeA" | "treeB" | "treeDark"
  | "mushroom" | "mushroomTall"
  | "rockA" | "rockB"
  | "crystal";

export interface RealmPalette {
  // sky gradient stops, top -> bottom (canvas)
  sky: [string, string, string, string];
  stars: boolean;
  moons: { x: number; y: number; r: number; tint: string }[];
  // fog (three.js)
  fog: number;
  fogNear: number;
  fogFar: number;
  // lighting
  hemiSky: number;
  hemiGround: number;
  hemiInt: number;
  sun: number;
  sunInt: number;
  // ground texture (canvas)
  groundBase: string;
  groundSpeck: string;
  groundDark: string;
  // road texture (canvas)
  road: string;
  roadDark: string;
  rumbleA: string;
  rumbleB: string;
  laneLine: string;
  edgeLine: string;
  // props
  crystalColors: number[];
  mountain: number;
  mountainDark: number;
  clutter: number;
  gem: number;
}

export interface RealmSpec {
  id: RealmId;
  name: string;
  blurb: string;
  /** "ground" = grass verges + terrain; "void" = floating glass-tube track */
  style?: "ground" | "void";
  /** [x, elevation, z] control points of the closed loop (meters) */
  controlPoints: [number, number, number][];
  palette: RealmPalette;
  /** weighted scenery mix for roadside props */
  scenery: { kind: SceneryKind; weight: number }[];
}

interface Harm {
  k: number;
  amp: number;
  phase: number;
}

/**
 * Build a smooth closed loop as a "wobbly circle": radius and elevation vary
 * with angle via a few sine harmonics. Because radius stays well above the road
 * width, curvature is bounded — no cusps or self-overlaps, unlike hand-placed
 * hairpins. Variety comes from the harmonics (lobes) and elevation profile.
 */
function loopTrack(
  n: number,
  base: number,
  shape: Harm[],
  baseY: number,
  elev: Harm[]
): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    let r = base;
    for (const h of shape) r += h.amp * Math.sin(h.k * t + h.phase);
    let y = baseY;
    for (const e of elev) y += e.amp * Math.sin(e.k * t + e.phase);
    pts.push([
      Math.round(r * Math.cos(t)),
      Math.round(Math.max(0, y)),
      Math.round(r * Math.sin(t)),
    ]);
  }
  return pts;
}

export const REALMS: Record<RealmId, RealmSpec> = {
  forest: {
    id: "forest",
    name: "Enchanted Forest",
    blurb: "Moonlit woods, glowing mushrooms, gentle rolling hills.",
    controlPoints: loopTrack(
      18, 175,
      [{ k: 2, amp: 38, phase: 0.3 }, { k: 3, amp: 18, phase: 1.0 }],
      1.5, [{ k: 2, amp: 3, phase: 0 }, { k: 4, amp: 2, phase: 1.5 }]
    ),
    palette: {
      sky: ["#0d0821", "#1a1033", "#4a2d6e", "#6d4a9e"],
      stars: true,
      moons: [
        { x: 700, y: 130, r: 34, tint: "#c7b8f5" },
        { x: 240, y: 180, r: 14, tint: "#9ad5d0" },
      ],
      fog: 0x2a1b4d, fogNear: 70, fogFar: 470,
      hemiSky: 0x9080d0, hemiGround: 0x1a2e1a, hemiInt: 1.1,
      sun: 0xc0b0ff, sunInt: 1.4,
      groundBase: "#173d22", groundSpeck: "#1f5230", groundDark: "#0f2d1a",
      road: "#3b3355", roadDark: "#332b4d", rumbleA: "#6d28d9", rumbleB: "#c084fc",
      laneLine: "#d8d0f0", edgeLine: "#e8e0ff",
      crystalColors: [0x7c3aed, 0xa855f7, 0xc084fc],
      mountain: 0x2b1d4d, mountainDark: 0x1d1436, clutter: 0x2f6b3a, gem: 0x22d3ee,
    },
    scenery: [
      { kind: "treeA", weight: 3 }, { kind: "treeB", weight: 3 },
      { kind: "treeDark", weight: 2 }, { kind: "mushroom", weight: 2 },
      { kind: "mushroomTall", weight: 1 }, { kind: "crystal", weight: 2 },
      { kind: "rockA", weight: 1 }, { kind: "rockB", weight: 1 },
    ],
  },

  ember: {
    id: "ember",
    name: "Ember Wastes",
    blurb: "Volcanic flats — long straights, sweeping fast bends, ash sky.",
    controlPoints: loopTrack(
      16, 225,
      [{ k: 1, amp: 60, phase: 0.5 }, { k: 2, amp: 20, phase: 0 }],
      1, [{ k: 2, amp: 2.5, phase: 0.5 }]
    ),
    palette: {
      sky: ["#1a0805", "#3b1206", "#7c2d12", "#b45309"],
      stars: false,
      moons: [{ x: 640, y: 150, r: 40, tint: "#fbbf24" }],
      fog: 0x5a1e0a, fogNear: 60, fogFar: 420,
      hemiSky: 0xff8a4a, hemiGround: 0x3a1206, hemiInt: 1.2,
      sun: 0xffb060, sunInt: 1.6,
      groundBase: "#3a1a10", groundSpeck: "#5a2410", groundDark: "#24100a",
      road: "#2e2a2e", roadDark: "#241f22", rumbleA: "#7c2d12", rumbleB: "#f59e0b",
      laneLine: "#fde68a", edgeLine: "#fed7aa",
      crystalColors: [0xdc2626, 0xf97316, 0xfbbf24],
      mountain: 0x4a1c0c, mountainDark: 0x2c110a, clutter: 0x5a2a18, gem: 0xf59e0b,
    },
    scenery: [
      { kind: "rockA", weight: 4 }, { kind: "rockB", weight: 4 },
      { kind: "treeDark", weight: 2 }, { kind: "crystal", weight: 3 },
      { kind: "mushroom", weight: 1 },
    ],
  },

  peaks: {
    id: "peaks",
    name: "Crystal Peaks",
    blurb: "High icy mountains — steep climbs, tight twists, thin air.",
    controlPoints: loopTrack(
      20, 170,
      [{ k: 3, amp: 30, phase: 0.2 }, { k: 5, amp: 13, phase: 0.8 }],
      2, [{ k: 3, amp: 4, phase: 0 }, { k: 2, amp: 2.5, phase: 1.0 }]
    ),
    palette: {
      sky: ["#081428", "#0e2540", "#2a5a8a", "#7ec8e8"],
      stars: true,
      moons: [{ x: 560, y: 120, r: 30, tint: "#e0f2fe" }],
      fog: 0x1a3a55, fogNear: 80, fogFar: 520,
      hemiSky: 0xbfe6ff, hemiGround: 0x24506a, hemiInt: 1.3,
      sun: 0xe8f6ff, sunInt: 1.7,
      groundBase: "#dbeafe", groundSpeck: "#bcd7f0", groundDark: "#a8c3e0",
      road: "#4a5568", roadDark: "#3c4557", rumbleA: "#1d4ed8", rumbleB: "#93c5fd",
      laneLine: "#f0f9ff", edgeLine: "#dbeafe",
      crystalColors: [0x38bdf8, 0x7dd3fc, 0xe0f2fe],
      mountain: 0x9db8d4, mountainDark: 0x6d8bb0, clutter: 0xcfe0f0, gem: 0x38bdf8,
    },
    scenery: [
      { kind: "crystal", weight: 5 }, { kind: "rockA", weight: 3 },
      { kind: "rockB", weight: 3 }, { kind: "treeA", weight: 1 },
      { kind: "treeB", weight: 1 },
    ],
  },

  void: {
    id: "void",
    name: "Void Circuit",
    blurb: "Anti-gravity glass tube through deep space — huge climbs and drops.",
    style: "void",
    controlPoints: loopTrack(
      18, 200,
      [{ k: 2, amp: 45, phase: 0.6 }, { k: 3, amp: 24, phase: 2.0 }],
      35, [{ k: 2, amp: 26, phase: 0 }, { k: 3, amp: 18, phase: 1.2 }, { k: 1, amp: 14, phase: 0.5 }]
    ),
    palette: {
      sky: ["#02010a", "#070218", "#0d0a2e", "#1a1040"],
      stars: true,
      moons: [{ x: 780, y: 90, r: 22, tint: "#a5b4fc" }],
      fog: 0x0a0820, fogNear: 120, fogFar: 720,
      hemiSky: 0x6070c0, hemiGround: 0x101030, hemiInt: 0.9,
      sun: 0xa0b0ff, sunInt: 1.2,
      groundBase: "#0a0820", groundSpeck: "#1a1040", groundDark: "#050312",
      road: "#161a33", roadDark: "#101026", rumbleA: "#0891b2", rumbleB: "#22d3ee",
      laneLine: "#67e8f9", edgeLine: "#a5f3fc",
      crystalColors: [0x22d3ee, 0x818cf8, 0xf0abfc],
      mountain: 0x1a1040, mountainDark: 0x0d0a2e, clutter: 0x1a1040, gem: 0xf0abfc,
    },
    scenery: [{ kind: "crystal", weight: 1 }],
  },
};

/** Pick a scenery kind from the realm's weighted mix. */
export function pickScenery(spec: RealmSpec, rand: () => number): SceneryKind {
  const total = spec.scenery.reduce((s, e) => s + e.weight, 0);
  let r = rand() * total;
  for (const e of spec.scenery) {
    r -= e.weight;
    if (r <= 0) return e.kind;
  }
  return spec.scenery[0].kind;
}
