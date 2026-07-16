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
  | "skyscraper" | "brownstone" | "streetlight" | "billboard" | "waterTower"
  // hogwarts
  | "hogwartsCastle" | "hogwartsExpress" | "quidditchHoop" | "floatingCandle" | "goldenSnitch" | "whompingWillow"
  // water
  | "waterfall";

/** Per-realm atmosphere. Kept here (three-free) so both the UI and the weather
 *  module can read it. The renderer maps each kind to a particle behaviour. */
export type WeatherKind =
  | "none" | "snow" | "ember" | "sand" | "spores" | "mist" | "rain";

export const REALM_WEATHER: Record<RealmId, WeatherKind> = {
  forest: "spores",
  ember: "ember",
  peaks: "snow",
  void: "none",
  sands: "sand",
  castle: "mist",
  circuit: "none",
  metro: "rain",
  nebula: "none",
};

/** Per-realm ambient sound bed (procedural). */
export type AmbienceKind = "none" | "wind" | "lava" | "city" | "space" | "forest" | "mist";
export const REALM_AMBIENCE: Record<RealmId, AmbienceKind> = {
  forest: "forest",
  ember: "lava",
  peaks: "wind",
  void: "space",
  sands: "wind",
  castle: "mist",
  circuit: "city",
  metro: "city",
  nebula: "space",
};

/** Tunnel set-pieces per realm: `at` is a fraction (0..1) of the lap where the
 *  tunnel starts, `len` its length in metres. Ground realms only (space tubes
 *  and the open stadium get none). */
export const REALM_TUNNELS: Record<RealmId, { at: number; len: number }[]> = {
  forest: [{ at: 0.34, len: 78 }],
  ember: [{ at: 0.52, len: 68 }],
  peaks: [{ at: 0.26, len: 96 }, { at: 0.72, len: 58 }],
  void: [],
  sands: [{ at: 0.42, len: 74 }],
  castle: [{ at: 0.2, len: 112 }],
  circuit: [],
  metro: [{ at: 0.36, len: 98 }, { at: 0.74, len: 66 }],
  nebula: [],
};

/** River crossings per realm: fractions (0..1) of the lap where the track
 *  crosses a river on a railed bridge (with a jump ramp just before it). */
export const REALM_RIVERS: Record<RealmId, number[]> = {
  forest: [0.58],
  ember: [],
  peaks: [0.44],
  void: [],
  sands: [],
  castle: [0.66],
  circuit: [],
  metro: [],
  nebula: [],
};

/** Fork zones per realm: the road splits around a central island into a LEFT
 *  and RIGHT route (with a different quirk on each side) that rejoin. `at` is
 *  the start fraction (0..1) of the lap; `len` is the fork length in metres.
 *  Placed to steer clear of each realm's tunnels and river crossings. */
// One clear fork per map: the road splits wide around a central island and
// rejoins (placed clear of each realm's tunnels and river crossings).
export const REALM_SPLITS: Record<RealmId, { at: number; len: number }[]> = {
  forest: [{ at: 0.1, len: 130 }],
  ember: [{ at: 0.24, len: 150 }],
  peaks: [{ at: 0.55, len: 120 }],
  void: [{ at: 0.48, len: 130 }],
  sands: [{ at: 0.16, len: 150 }],
  castle: [{ at: 0.44, len: 120 }],
  circuit: [{ at: 0.3, len: 140 }],
  metro: [{ at: 0.52, len: 120 }],
  nebula: [],
};

/** A line of flavour for each world — shown on the loadout before a race. */
export const REALM_LORE: Record<RealmId, string> = {
  forest:
    "Long before the circuits, these woods raced with will-o'-wisps. Drivers who chase the glow swear the trees lean in to watch.",
  ember:
    "A dead volcano's caldera, paved over the old lava roads. The embers never fully cooled — and neither did the rivalries forged here.",
  peaks:
    "Thin air, thinner margins. The ice remembers every racer who mistook a sweeper for a straight.",
  void:
    "An anti-gravity ribbon strung between dead stars. There is no down out here — only forward, and the long fall if you lift.",
  sands:
    "The pharaohs built monuments to outlast time; racers built a track to outrun it. The storm keeps the finish line honest.",
  castle:
    "Mind the Whomping Willow on the back straight, and don't chase the Snitch — the Express waits for no racer. Boarding at the third pillar past nine and three-quarters.",
  circuit:
    "The only purpose-built speedway in the realms. No monsters, no magic — just apex, throttle, and ninety thousand voices.",
  metro:
    "Downtown after midnight, when the grid belongs to whoever's fastest. Wet asphalt, neon, and no speed limit the law can catch.",
  nebula:
    "Deeper than the Void, where the war-tubes coil through a living green cloud. Weapons hot, no rules, no witnesses.",
};

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
    // HAND-AUTHORED — Enchanted Forest: long main straight (S), a big fast
    // right sweeper up the E side, an S-esse over the top, sweeping run down to a
    // tight left hairpin (W). Organic kidney silhouette. min turn radius ~35 m.
    controlPoints: [
      [206, 6, -173], [235, 6, -156], [258, 7, -131], [277, 7, -103], [294, 7, -74],
      [309, 8, -44], [315, 8, -11], [310, 8, 23], [297, 8, 54], [281, 8, 84],
      [265, 8, 113], [247, 8, 143], [226, 8, 169], [197, 8, 184], [164, 7, 181],
      [136, 7, 163], [112, 7, 138], [87, 6, 116], [55, 6, 109], [25, 6, 123],
      [3, 5, 149], [-18, 5, 175], [-46, 4, 194], [-79, 4, 203], [-113, 3, 207],
      [-146, 3, 211], [-180, 2, 214], [-213, 2, 211], [-243, 2, 195], [-263, 1, 168],
      [-276, 1, 137], [-287, 1, 104], [-297, 0, 72], [-304, 0, 39], [-305, 0, 5],
      [-300, 0, -28], [-293, 0, -61], [-286, 0, -94], [-276, 0, -127], [-259, 0, -156],
      [-232, 1, -176], [-199, 1, -183], [-166, 1, -184], [-132, 1, -184], [-98, 2, -184],
      [-64, 2, -183], [-30, 3, -183], [4, 3, -182], [38, 4, -182], [72, 4, -182],
      [105, 5, -181], [139, 5, -181], [173, 5, -179],
    ],
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
      { kind: "waterfall", weight: 1 },
    ],
  },

  ember: {
    id: "ember",
    name: "Ember Wastes",
    blurb: "Volcanic flats — long straights, sweeping fast bends, ash sky.",
    // HAND-AUTHORED — Ember Wastes: elongated volcanic speedway. A very long main
    // straight into one big flat-out sweeper (E), a long back straight, and a
    // single hairpin (W). Fast and flowing. min turn radius ~41 m.
    controlPoints: [
      [220, 1, -148], [252, 1, -133], [276, 1, -106], [291, 1, -73], [303, 1, -39],
      [313, 1, -5], [316, 1, 31], [304, 1, 64], [285, 1, 95], [264, 1, 124],
      [240, 1, 150], [208, 1, 167], [173, 1, 171], [137, 1, 168], [101, 1, 165],
      [65, 1, 161], [30, 1, 158], [-6, 1, 155], [-42, 1, 151], [-78, 1, 148],
      [-114, 1, 145], [-149, 1, 141], [-185, 1, 135], [-217, 1, 120], [-241, 1, 93],
      [-262, 1, 64], [-282, 1, 34], [-296, 1, 1], [-292, 1, -34], [-280, 1, -68],
      [-265, 1, -101], [-243, 1, -128], [-211, 1, -143], [-175, 1, -146], [-139, 1, -147],
      [-103, 1, -148], [-67, 1, -148], [-31, 1, -149], [5, 1, -149], [41, 1, -150],
      [77, 1, -150], [113, 1, -151], [149, 1, -151], [185, 1, -151],
    ],
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
    // HAND-AUTHORED — Crystal Peaks: a twisty alpine circuit — several medium
    // corners, an S-section over the top, and a hairpin (lower-left), with gentle
    // elevation change. min turn radius ~32 m.
    controlPoints: [
      [165, 7, -173], [189, 7, -155], [211, 8, -135], [232, 8, -113], [252, 9, -91],
      [271, 9, -68], [283, 9, -41], [284, 9, -11], [277, 9, 18], [268, 9, 47],
      [259, 9, 75], [248, 8, 103], [235, 8, 130], [213, 8, 151], [185, 8, 156],
      [158, 7, 144], [141, 7, 120], [131, 7, 92], [120, 7, 64], [102, 7, 40],
      [75, 7, 30], [46, 7, 35], [25, 7, 56], [19, 7, 85], [27, 7, 114],
      [41, 7, 141], [52, 7, 168], [53, 7, 198], [37, 7, 222], [10, 7, 234],
      [-20, 7, 234], [-49, 7, 229], [-78, 6, 223], [-108, 6, 216], [-137, 6, 208],
      [-164, 5, 196], [-187, 5, 178], [-207, 4, 155], [-225, 3, 131], [-242, 3, 107],
      [-259, 2, 82], [-273, 1, 55], [-279, 1, 26], [-274, 0, -3], [-264, 0, -32],
      [-253, 0, -60], [-241, 0, -87], [-225, 0, -113], [-203, 0, -133], [-177, 0, -147],
      [-149, 0, -158], [-121, 0, -170], [-94, 0, -181], [-66, 1, -192], [-38, 1, -202],
      [-9, 2, -210], [21, 3, -213], [51, 4, -208], [80, 5, -202], [109, 5, -194],
      [137, 6, -185],
    ],
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
      { kind: "treeB", weight: 1 }, { kind: "waterfall", weight: 1 },
    ],
  },

  void: {
    id: "void",
    name: "Void Circuit",
    blurb: "Anti-gravity glass tube through deep space — huge climbs and drops.",
    style: "void",
    // HAND-AUTHORED — Void Circuit: a smooth flowing anti-grav loop — three long
    // sweepers and a single chicane, on rolling elevation. min turn radius ~25 m
    // (chicane).
    controlPoints: [
      [171, 37, -209], [204, 41, -191], [230, 45, -163], [248, 48, -130], [262, 50, -95],
      [276, 52, -60], [290, 53, -25], [303, 53, 11], [312, 52, 48], [309, 50, 85],
      [295, 48, 120], [270, 45, 148], [237, 41, 167], [201, 37, 177], [164, 34, 186],
      [127, 30, 194], [90, 27, 202], [53, 24, 209], [15, 22, 209], [-17, 20, 191],
      [-37, 19, 159], [-54, 18, 125], [-80, 18, 99], [-116, 18, 101], [-144, 19, 125],
      [-170, 20, 153], [-205, 20, 165], [-240, 21, 152], [-264, 21, 123], [-282, 21, 90],
      [-300, 21, 57], [-314, 21, 22], [-318, 20, -16], [-309, 19, -52], [-289, 17, -84],
      [-264, 16, -112], [-237, 15, -139], [-211, 14, -167], [-184, 13, -194], [-157, 13, -220],
      [-126, 13, -241], [-90, 14, -252], [-52, 16, -251], [-14, 18, -246], [23, 21, -239],
      [60, 25, -232], [97, 29, -226], [135, 33, -219],
    ],
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
    // HAND-AUTHORED — Sunspire Sands: long sun-baked straights joined by a couple
    // of fast 90s and one hairpin (W). min turn radius ~41 m.
    controlPoints: [
      [220, 1, -192], [249, 1, -167], [262, 2, -132], [270, 2, -95], [278, 2, -57],
      [285, 2, -20], [292, 3, 17], [296, 3, 55], [286, 3, 91], [258, 3, 117],
      [224, 3, 135], [190, 3, 152], [156, 3, 169], [122, 3, 186], [87, 3, 200],
      [50, 3, 207], [12, 3, 206], [-26, 2, 203], [-64, 2, 200], [-102, 2, 197],
      [-140, 2, 193], [-178, 1, 189], [-215, 1, 181], [-245, 1, 159], [-262, 0, 125],
      [-275, 0, 89], [-286, 0, 53], [-298, 0, 16], [-303, 0, -21], [-288, 0, -56],
      [-264, 0, -85], [-238, 0, -113], [-212, 0, -141], [-185, 0, -168], [-156, 0, -193],
      [-121, 0, -207], [-83, 0, -209], [-45, 0, -208], [-7, 0, -207], [31, 0, -205],
      [69, 0, -204], [107, 0, -203], [145, 0, -202], [183, 1, -200],
    ],
    palette: {
      sky: ["#2f6bb0", "#5f97cc", "#b8d6e6", "#f2e2b8"],
      stars: false,
      moons: [{ x: 680, y: 120, r: 46, tint: "#fff4d0" }],
      fog: 0xe4cb98, fogNear: 55, fogFar: 460,
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
    name: "Hogwarts",
    blurb: "A twisting lap around the wizarding castle — turrets, the Express, floating candles and a Whomping Willow.",
    // HAND-AUTHORED — Hogwarts: a tight, twisty castle circuit — two hairpins, an
    // esse and a chicane linked by short chutes. min turn radius ~26 m.
    controlPoints: [
      [186, 4, -161], [210, 4, -143], [228, 5, -119], [244, 5, -94], [259, 5, -68],
      [274, 5, -42], [286, 6, -15], [292, 6, 15], [281, 6, 41], [256, 6, 56],
      [226, 6, 57], [197, 6, 52], [168, 6, 47], [138, 6, 47], [111, 6, 58],
      [95, 6, 83], [87, 6, 112], [81, 6, 141], [68, 5, 167], [41, 5, 179],
      [13, 5, 171], [-2, 5, 147], [-7, 4, 117], [-11, 4, 88], [-23, 4, 61],
      [-49, 4, 47], [-78, 3, 50], [-99, 3, 70], [-105, 3, 98], [-100, 2, 128],
      [-93, 2, 157], [-95, 2, 186], [-114, 2, 207], [-143, 1, 212], [-172, 1, 202],
      [-198, 1, 187], [-223, 1, 171], [-246, 0, 153], [-266, 0, 130], [-278, 0, 103],
      [-285, 0, 74], [-291, 0, 45], [-297, 0, 15], [-300, 0, -14], [-295, 0, -44],
      [-280, 0, -69], [-258, 0, -90], [-236, 0, -109], [-213, 0, -128], [-189, 1, -147],
      [-166, 1, -165], [-140, 1, -180], [-111, 1, -187], [-81, 2, -187], [-51, 2, -185],
      [-21, 2, -183], [9, 2, -181], [39, 3, -179], [68, 3, -177], [98, 3, -175],
      [128, 4, -173], [158, 4, -169],
    ],
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
      { kind: "hogwartsCastle", weight: 1 }, { kind: "quidditchHoop", weight: 1 },
      { kind: "whompingWillow", weight: 1 }, { kind: "hogwartsExpress", weight: 1 },
      { kind: "floatingCandle", weight: 3 }, { kind: "goldenSnitch", weight: 1 },
      { kind: "castleWall", weight: 2 }, { kind: "torch", weight: 3 },
      { kind: "tower", weight: 1 }, { kind: "treeDark", weight: 2 },
    ],
  },

  circuit: {
    id: "circuit",
    name: "Apex Speedway",
    blurb: "A real grand-prix stadium — grandstands, floodlights, flat-out sweepers and a stadium roar.",
    // HAND-AUTHORED — Apex Speedway: a grand-prix layout — a long main straight,
    // two fast sweepers, a stadium chicane and a hairpin (W). min turn radius ~29 m.
    controlPoints: [
      [222, 1, -214], [253, 1, -197], [275, 1, -168], [287, 2, -134], [295, 2, -99],
      [302, 2, -63], [309, 2, -28], [315, 2, 8], [314, 2, 44], [302, 2, 78],
      [279, 2, 105], [252, 2, 130], [224, 1, 153], [196, 1, 176], [167, 1, 197],
      [133, 1, 210], [98, 1, 204], [76, 0, 176], [66, 0, 141], [57, 0, 106],
      [39, 0, 75], [5, 0, 64], [-26, 0, 79], [-41, 0, 112], [-45, 0, 148],
      [-54, 0, 183], [-78, 1, 209], [-112, 1, 219], [-149, 1, 220], [-185, 1, 220],
      [-221, 2, 215], [-254, 2, 202], [-278, 2, 176], [-291, 2, 142], [-298, 2, 106],
      [-304, 2, 71], [-309, 2, 35], [-308, 2, -1], [-298, 2, -36], [-281, 2, -68],
      [-264, 1, -100], [-246, 1, -132], [-228, 1, -163], [-205, 1, -191], [-175, 0, -211],
      [-140, 0, -218], [-104, 0, -220], [-68, 0, -220], [-31, 0, -220], [5, 0, -220],
      [41, 0, -220], [77, 0, -220], [114, 0, -220], [150, 1, -220], [186, 1, -219],
    ],
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
    // HAND-AUTHORED — Neon Metro: a blocky street circuit — long straights joined
    // by tight ~90s, a right-hand jog and one chicane (Monaco-ish). min turn ~32 m.
    controlPoints: [
      [196, 1, -191], [221, 1, -171], [239, 1, -144], [255, 1, -116], [270, 1, -88],
      [283, 1, -59], [287, 1, -27], [273, 1, 1], [246, 1, 17], [215, 1, 24],
      [184, 1, 28], [152, 1, 35], [125, 1, 50], [109, 1, 77], [105, 1, 109],
      [102, 1, 141], [93, 1, 171], [70, 1, 192], [38, 1, 197], [7, 1, 195],
      [-25, 1, 190], [-57, 1, 184], [-87, 1, 176], [-118, 1, 165], [-149, 1, 158],
      [-181, 1, 159], [-212, 1, 163], [-244, 1, 163], [-271, 1, 146], [-286, 1, 119],
      [-292, 1, 87], [-296, 1, 55], [-300, 1, 24], [-303, 1, -8], [-303, 1, -40],
      [-294, 1, -71], [-274, 1, -96], [-251, 1, -118], [-227, 1, -139], [-203, 1, -160],
      [-178, 1, -180], [-152, 1, -198], [-122, 1, -210], [-90, 1, -213], [-58, 1, -212],
      [-26, 1, -210], [6, 1, -209], [38, 1, -207], [70, 1, -205], [102, 1, -204],
      [134, 1, -202], [166, 1, -199],
    ],
    palette: {
      sky: ["#05060f", "#0b1024", "#161a3a", "#2a2450"],
      stars: true,
      moons: [{ x: 700, y: 90, r: 26, tint: "#cfd8ff" }],
      fog: 0x1a2340, fogNear: 90, fogFar: 620,
      hemiSky: 0x7a8ad0, hemiGround: 0x2c3346, hemiInt: 1.35,
      sun: 0xbfccff, sunInt: 1.35,
      groundBase: "#3a3f4a", groundSpeck: "#474d5a", groundDark: "#2a2e38",
      groundTint: 0x565e6e,
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
      22, 235,
      [{ k: 2, amp: 48, phase: 1.4 }, { k: 3, amp: 30, phase: 0.4 }],
      50, [{ k: 2, amp: 32, phase: 0.6 }, { k: 3, amp: 22, phase: 2.0 }, { k: 1, amp: 18, phase: 1.0 }, { k: 4, amp: 12, phase: 0.4 }]
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
