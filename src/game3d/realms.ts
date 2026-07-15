import type { RealmId } from "../game/engine";

export type SceneryKind =
  | "treeA" | "treeB" | "treeDark"
  | "mushroom" | "mushroomTall"
  | "rockA" | "rockB"
  | "crystal"
  // egyptian
  | "pyramid" | "obelisk" | "sphinx" | "palm" | "sandRock"
  // castle
  | "tower" | "gatehouse" | "castleWall" | "banner" | "torch"
  // f1 stadium
  | "grandstand" | "tyreStack" | "floodlight" | "pitBuilding" | "marshalBoard"
  // nyc
  | "skyscraper" | "brownstone" | "streetlight" | "billboard" | "waterTower";

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
  /** optional multiply-tint for the PBR ground albedo (realms that reuse
   *  another realm's shipped ground texture recolour it to their own hue) */
  groundTint?: number;
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
  /** hidden from the realm picker — only reached via a mode (e.g. Space Wars) */
  hidden?: boolean;
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
      24, 175,
      [{ k: 2, amp: 38, phase: 0.3 }, { k: 3, amp: 18, phase: 1.0 }, { k: 5, amp: 11, phase: 2.0 }],
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
      22, 225,
      [{ k: 1, amp: 60, phase: 0.5 }, { k: 2, amp: 20, phase: 0 }, { k: 4, amp: 15, phase: 1.6 }],
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

  sands: {
    id: "sands",
    name: "Sunspire Sands",
    blurb: "Blazing desert circuit — vast dunes, ancient monuments, long sun-baked straights.",
    controlPoints: loopTrack(
      22, 215,
      [{ k: 1, amp: 58, phase: 0.2 }, { k: 2, amp: 24, phase: 1.1 }, { k: 3, amp: 12, phase: 2.3 }],
      1.2, [{ k: 1, amp: 4, phase: 0 }, { k: 3, amp: 2.5, phase: 1.0 }]
    ),
    palette: {
      sky: ["#2f6bb0", "#5f97cc", "#b8d6e6", "#f2e2b8"],
      stars: false,
      moons: [{ x: 680, y: 120, r: 46, tint: "#fff4d0" }],
      fog: 0xe8d3a0, fogNear: 90, fogFar: 640,
      hemiSky: 0xbfd8ff, hemiGround: 0xd9b47a, hemiInt: 1.2,
      sun: 0xfff2d0, sunInt: 1.9,
      groundBase: "#d9b47a", groundSpeck: "#c79a5c", groundDark: "#a9793f",
      groundTint: 0xcaa46a,
      road: "#7d6f52", roadDark: "#6b5f45", rumbleA: "#b3892f", rumbleB: "#e6c458",
      laneLine: "#f7ecd0", edgeLine: "#fff6e0",
      crystalColors: [0xe6c458, 0xf0d878, 0xfff0b0],
      mountain: 0xc79a5c, mountainDark: 0x9a713c, clutter: 0xc79a5c, gem: 0xf59e0b,
    },
    scenery: [
      { kind: "palm", weight: 4 }, { kind: "sandRock", weight: 5 },
      { kind: "obelisk", weight: 2 }, { kind: "sphinx", weight: 1 },
      { kind: "pyramid", weight: 1 },
    ],
  },

  castle: {
    id: "castle",
    name: "Ravenspire Keep",
    blurb: "A twisting run through a haunted castle — torchlit walls, banners, misty ramparts.",
    controlPoints: loopTrack(
      24, 168,
      [{ k: 3, amp: 34, phase: 0.4 }, { k: 4, amp: 16, phase: 1.2 }, { k: 6, amp: 8, phase: 0.6 }],
      2, [{ k: 2, amp: 5, phase: 0.5 }, { k: 4, amp: 3, phase: 1.4 }]
    ),
    palette: {
      sky: ["#0b1020", "#161e33", "#2c3350", "#4a4a6e"],
      stars: true,
      moons: [{ x: 640, y: 110, r: 38, tint: "#cdd6ef" }],
      fog: 0x1a2033, fogNear: 60, fogFar: 470,
      hemiSky: 0x9aa8cc, hemiGround: 0x2a2a38, hemiInt: 1.0,
      sun: 0xb8c0e0, sunInt: 1.2,
      groundBase: "#2f3a2c", groundSpeck: "#3c4a38", groundDark: "#232c22",
      road: "#4a4650", roadDark: "#3c3944", rumbleA: "#6d28d9", rumbleB: "#a01f2e",
      laneLine: "#dcd8ec", edgeLine: "#efeaff",
      crystalColors: [0x6d28d9, 0x8b5cf6, 0xa01f2e],
      mountain: 0x2a2c40, mountainDark: 0x1c1e2e, clutter: 0x4c505a, gem: 0xa78bfa,
    },
    scenery: [
      { kind: "castleWall", weight: 4 }, { kind: "torch", weight: 3 },
      { kind: "banner", weight: 2 }, { kind: "tower", weight: 1 },
      { kind: "gatehouse", weight: 1 }, { kind: "treeDark", weight: 2 },
    ],
  },

  circuit: {
    id: "circuit",
    name: "Apex Speedway",
    blurb: "A real grand-prix stadium — grandstands, floodlights, flat-out sweepers and a stadium roar.",
    controlPoints: loopTrack(
      26, 220,
      [{ k: 2, amp: 46, phase: 0.5 }, { k: 3, amp: 20, phase: 2.4 }, { k: 5, amp: 10, phase: 1.0 }],
      1, [{ k: 2, amp: 2, phase: 0 }]
    ),
    palette: {
      sky: ["#1c3a6e", "#2f5a9e", "#6a9ad0", "#cfe4f5"],
      stars: false,
      moons: [{ x: 720, y: 100, r: 34, tint: "#fffbe6" }],
      fog: 0xbcd4ec, fogNear: 100, fogFar: 700,
      hemiSky: 0xbcd8ff, hemiGround: 0x4a5240, hemiInt: 1.25,
      sun: 0xfffbe6, sunInt: 1.7,
      groundBase: "#3f7a3a", groundSpeck: "#4f8f45", groundDark: "#2f5f2c",
      road: "#2e3238", roadDark: "#24272c", rumbleA: "#e23b3b", rumbleB: "#f5f5f5",
      laneLine: "#f5f5f5", edgeLine: "#ffffff",
      crystalColors: [0x22d3ee, 0xe23b3b, 0xf5f5f5],
      mountain: 0x5a6270, mountainDark: 0x3c414c, clutter: 0x9aa1ab, gem: 0x22d3ee,
    },
    scenery: [
      { kind: "tyreStack", weight: 4 }, { kind: "marshalBoard", weight: 3 },
      { kind: "grandstand", weight: 2 }, { kind: "floodlight", weight: 2 },
      { kind: "pitBuilding", weight: 1 },
    ],
  },

  metro: {
    id: "metro",
    name: "Neon Metro",
    blurb: "A midnight street circuit through the city — glass towers, neon billboards, wet asphalt.",
    controlPoints: loopTrack(
      22, 188,
      [{ k: 2, amp: 40, phase: 1.2 }, { k: 4, amp: 18, phase: 0.3 }, { k: 1, amp: 22, phase: 2.0 }],
      1, [{ k: 2, amp: 3, phase: 0.5 }]
    ),
    palette: {
      sky: ["#05060f", "#0b1024", "#161a3a", "#2a2450"],
      stars: true,
      moons: [{ x: 700, y: 90, r: 26, tint: "#cfd8ff" }],
      fog: 0x0e1226, fogNear: 70, fogFar: 520,
      hemiSky: 0x5a6ab0, hemiGround: 0x1a1e2a, hemiInt: 0.95,
      sun: 0x9fb0ff, sunInt: 1.1,
      groundBase: "#23262e", groundSpeck: "#2e323c", groundDark: "#16181e",
      groundTint: 0x3c4048,
      road: "#26282e", roadDark: "#1c1e24", rumbleA: "#ff3ea5", rumbleB: "#22d3ee",
      laneLine: "#f0e9c0", edgeLine: "#fff6c8",
      crystalColors: [0xff3ea5, 0x22d3ee, 0xbcd4ff],
      mountain: 0x1a1e33, mountainDark: 0x0e1122, clutter: 0x3a3f4a, gem: 0x22d3ee,
    },
    scenery: [
      { kind: "skyscraper", weight: 3 }, { kind: "brownstone", weight: 3 },
      { kind: "streetlight", weight: 4 }, { kind: "billboard", weight: 2 },
      { kind: "waterTower", weight: 1 },
    ],
  },

  // hidden battle arena — only reached through Space Wars (the 2nd space map)
  nebula: {
    id: "nebula",
    name: "Nebula Run",
    blurb: "A neon war-tube through a green nebula — deep space, no rules.",
    hidden: true,
    style: "void",
    controlPoints: loopTrack(
      18, 210,
      [{ k: 2, amp: 40, phase: 1.4 }, { k: 3, amp: 26, phase: 0.4 }],
      35, [{ k: 2, amp: 24, phase: 0.6 }, { k: 3, amp: 16, phase: 2.0 }, { k: 1, amp: 12, phase: 1.0 }]
    ),
    palette: {
      sky: ["#02060a", "#05131a", "#0a2630", "#124036"],
      stars: true,
      moons: [{ x: 760, y: 100, r: 24, tint: "#6ee7b7" }],
      fog: 0x06140f, fogNear: 120, fogFar: 720,
      hemiSky: 0x3fb0a0, hemiGround: 0x0a2018, hemiInt: 0.95,
      sun: 0x7ff0d0, sunInt: 1.2,
      groundBase: "#06140f", groundSpeck: "#0f3028", groundDark: "#03100b",
      road: "#0d2420", roadDark: "#0a1c18", rumbleA: "#0891b2", rumbleB: "#34d399",
      laneLine: "#6ee7b7", edgeLine: "#a7f3d0",
      crystalColors: [0x34d399, 0x22d3ee, 0xa7f3d0],
      mountain: 0x0a2630, mountainDark: 0x05131a, clutter: 0x0a2630, gem: 0x34d399,
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
