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

/** Plausible weather each realm can cycle through mid-race. Kept per-realm on
 *  purpose — a snowstorm in the desert would read as a bug, not as weather — but
 *  every realm gets at least a clear/heavy pair so the sky visibly turns while
 *  you drive. The engine picks a new one from this pool at random intervals. */
export const REALM_WEATHER_POOL: Record<RealmId, WeatherKind[]> = {
  forest: ["spores", "mist", "none"],   // rain read wrong under the canopy
  ember:  ["ember", "sand", "none"],
  peaks:  ["snow", "mist", "none"],
  void:   ["none"],                     // vacuum: nothing to fall
  sands:  ["sand", "none", "mist"],
  castle: ["mist", "rain", "snow", "none"],
  circuit:["none", "rain", "mist"],
  metro:  ["rain", "mist", "none"],
  nebula: ["none"],
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
  // Two drive-THROUGH caves. This was [] with a comment saying the roadside cave
  // mouths replaced it — but those sit 26-70 m off the road facing you, so the
  // forest had cave "definition" and nothing you could ever enter. Taking the
  // palette, the portal/arch geometry reads as hewn rock here rather than
  // concrete, so it's a cave rather than a road tunnel.
  forest: [{ at: 0.31, len: 82 }, { at: 0.69, len: 54 }],
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
  /** surface finish of the road: wet neon streets, glassy ice, dry desert dust… */
  roadFinish?: "wet" | "gloss" | "ice" | "matte" | "dusty";
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
    // Enchanted Forest: a long back straight (S) charging into a tight pointed
    // right-hander (E), an esse-wiggled run across the top, then a wide sweeping
    // left horseshoe (W). Organic, no straight edges alike. min turn radius ~24 m.
    controlPoints: [
      [-281, 14, 139], [-257, 13, 154], [-230, 13, 161], [-202, 12, 161], [-174, 11, 162],
      [-146, 10, 163], [-120, 10, 164], [-92, 9, 165], [-64, 8, 166], [-36, 8, 167],
      [-8, 8, 167], [20, 8, 168], [48, 9, 169], [76, 10, 170], [104, 12, 171],
      [132, 13, 172], [160, 15, 173], [186, 16, 173], [213, 18, 174], [241, 20, 173],
      [266, 21, 159], [290, 23, 145], [312, 25, 128], [320, 26, 102], [320, 26, 74],
      [303, 26, 53], [280, 26, 37], [254, 25, 26], [227, 25, 18], [202, 24, 11],
      [175, 23, 14], [149, 22, 25], [123, 20, 35], [95, 19, 31], [71, 17, 18],
      [47, 15, 4], [20, 14, -2], [-7, 13, 7], [-33, 12, 17], [-59, 12, 26],
      [-85, 13, 23], [-110, 15, 10], [-135, 16, -2], [-160, 18, -15], [-183, 19, -30],
      [-206, 20, -47], [-230, 20, -61], [-257, 20, -64], [-283, 20, -54], [-304, 19, -36],
      [-318, 19, -12], [-322, 18, 14], [-327, 18, 41], [-324, 17, 69], [-313, 16, 94],
      [-300, 15, 119],
    ],
    palette: {
      sky: ["#020b0f", "#04211d", "#0a3d33", "#12614a"],
      stars: true,
      moons: [
        { x: 700, y: 130, r: 34, tint: "#8ff5d0" },
        { x: 240, y: 180, r: 14, tint: "#4fd8c4" },
      ],
      fog: 0x123f2e, fogNear: 150, fogFar: 840,
      hemiSky: 0x6bf0cf, hemiGround: 0x123f2a, hemiInt: 0.98,
      sun: 0xd8f3e0, sunInt: 1.05,
      groundBase: "#18542f", groundSpeck: "#2c7648", groundDark: "#0e3521",
      road: "#233a34", roadDark: "#1a2c27", rumbleA: "#0f9d76", rumbleB: "#5eead4",
      laneLine: "#a7f3e0", edgeLine: "#d0fff0", roadFinish: "gloss",
      crystalColors: [0x2dd4bf, 0x5eead4, 0x99f6e4],
      mountain: 0x1a4d35, mountainDark: 0x0d2c1f, clutter: 0x35ad66, gem: 0x34d399,
    },
    scenery: [
      { kind: "treeA", weight: 8 }, { kind: "treeB", weight: 8 },
      { kind: "treeDark", weight: 1 }, { kind: "mushroom", weight: 4 },
      { kind: "mushroomTall", weight: 3 }, { kind: "crystal", weight: 2 },
    ],
  },

  ember: {
    id: "ember",
    name: "Ember Wastes",
    blurb: "Volcanic flats — long straights, sweeping fast bends, ash sky.",
    // Ember Wastes: a big sweeping teardrop — two very long volcanic straights
    // converging into one fast pointed apex (E), then a giant flat-out U-bend
    // sweeper wrapping the west end. Fast and flowing. min turn radius ~23 m (apex).
    controlPoints: [
      [196, 4, 135], [217, 4, 111], [239, 5, 85], [260, 5, 61], [281, 6, 37],
      [290, 7, 5], [275, 8, -23], [254, 9, -47], [233, 10, -71], [210, 11, -96],
      [188, 13, -119], [163, 15, -139], [132, 17, -154], [103, 19, -166], [74, 21, -179],
      [43, 22, -193], [12, 23, -203], [-19, 25, -208], [-51, 26, -210], [-85, 27, -213],
      [-117, 27, -216], [-149, 28, -213], [-180, 28, -200], [-208, 28, -185], [-237, 27, -170],
      [-265, 26, -151], [-283, 24, -125], [-295, 23, -96], [-306, 21, -65], [-316, 20, -33],
      [-317, 19, -1], [-310, 17, 30], [-303, 16, 63], [-294, 14, 94], [-276, 12, 120],
      [-250, 11, 142], [-224, 10, 161], [-199, 9, 180], [-172, 8, 198], [-140, 8, 208],
      [-108, 7, 213], [-77, 7, 217], [-43, 6, 222], [-11, 6, 224], [20, 6, 219],
      [52, 5, 207], [82, 5, 195], [112, 4, 183], [142, 4, 171], [172, 4, 156],
    ],
    palette: {
      sky: ["#211f1d", "#3a231a", "#7a2410", "#e2570f"],
      stars: false,
      moons: [{ x: 640, y: 150, r: 40, tint: "#ff6a3d" }],
      fog: 0x4a1c10, fogNear: 150, fogFar: 850,
      hemiSky: 0xff7a3d, hemiGround: 0x2a1006, hemiInt: 0.85,
      sun: 0xff8a40, sunInt: 1.1,
      groundBase: "#140d0a", groundSpeck: "#2a1208", groundDark: "#0a0604",
      road: "#1c1816", roadDark: "#120f0d", rumbleA: "#8a2508", rumbleB: "#ff7a1a",
      laneLine: "#ffcf8a", edgeLine: "#ffb066", roadFinish: "matte",
      crystalColors: [0x7c2d12, 0xdc2626, 0xf97316],
      mountain: 0x2a140a, mountainDark: 0x160a05, clutter: 0x3a1a10, gem: 0xf59e0b,
    },
    scenery: [
      { kind: "rockA", weight: 7 }, { kind: "rockB", weight: 6 },
      { kind: "crystal", weight: 3 }, { kind: "treeDark", weight: 1 },
      { kind: "mushroom", weight: 1 }, { kind: "mushroomTall", weight: 1 },
    ],
  },

  peaks: {
    id: "peaks",
    name: "Crystal Peaks",
    blurb: "High icy mountains — steep climbs, tight twists, thin air.",
    // Crystal Peaks (Alps reverse): a tall vertical alpine loop — a wide rounded
    // crest across the top, a distinctive concave pinch on the right-hand descent
    // (the road tucks in then back out), a narrow rounded base and a long smooth
    // left side. Big climb to the crest, drop to the valley. min turn radius ~27 m.
    controlPoints: [
      [-45, 12, 278], [-73, 14, 267], [-101, 15, 255], [-123, 17, 233], [-136, 20, 206],
      [-147, 22, 178], [-157, 25, 150], [-161, 27, 120], [-164, 30, 91], [-167, 32, 59],
      [-170, 35, 29], [-171, 37, -1], [-167, 40, -31], [-163, 43, -60], [-159, 45, -92],
      [-155, 48, -122], [-151, 50, -152], [-142, 52, -180], [-131, 54, -208], [-120, 56, -238],
      [-109, 57, -266], [-95, 58, -292], [-71, 58, -310], [-44, 58, -322], [-16, 57, -333],
      [16, 56, -337], [45, 54, -330], [73, 52, -318], [100, 50, -307], [123, 47, -287],
      [138, 45, -259], [152, 43, -233], [165, 40, -206], [171, 37, -176], [174, 34, -147],
      [175, 31, -117], [161, 29, -89], [141, 26, -67], [121, 24, -44], [118, 22, -15],
      [133, 20, 11], [154, 18, 36], [170, 16, 60], [173, 14, 90], [167, 13, 119],
      [160, 11, 148], [154, 10, 179], [139, 9, 205], [117, 8, 226], [95, 8, 246],
      [73, 8, 266], [46, 8, 279], [15, 9, 281], [-15, 10, 282],
    ],
    palette: {
      sky: ["#040c1c", "#0a1e38", "#1e4a72", "#a8dcf0"],
      stars: true,
      moons: [{ x: 560, y: 120, r: 32, tint: "#eaf6ff" }],
      fog: 0x2a5a80, fogNear: 180, fogFar: 950,
      hemiSky: 0xcfeeff, hemiGround: 0x1e405a, hemiInt: 0.85,
      sun: 0xeaf6ff, sunInt: 0.95,
      groundBase: "#e8f2fc", groundSpeck: "#c7ddf0", groundDark: "#9fc0dd",
      road: "#3d4a5c", roadDark: "#303c4c", rumbleA: "#1a4a8a", rumbleB: "#8fd4f5",
      laneLine: "#eef8ff", edgeLine: "#dbeafe", roadFinish: "ice",
      crystalColors: [0x60d0f5, 0xa8e6ff, 0xf0fbff],
      mountain: 0x8fb0d0, mountainDark: 0x5f85ad, clutter: 0xc7ddf0, gem: 0x38bdf8,
    },
    scenery: [
      { kind: "crystal", weight: 7 }, { kind: "rockA", weight: 3 },
      { kind: "rockB", weight: 3 }, { kind: "treeDark", weight: 4 },
      { kind: "waterfall", weight: 1 },
    ],
  },

  void: {
    id: "void",
    name: "Void Circuit",
    blurb: "Anti-gravity glass tube through deep space — huge climbs and drops.",
    style: "void",
    // Void Circuit (Iceland): a wild, very irregular anti-grav mitten — a big
    // rounded palm loop at the bottom-right with three finger-like peninsulas
    // clawing up and to the left, each capped by a tight hairpin. Huge climbs and
    // drops over the fingers — the most vertical map. min turn radius ~23 m (fingers).
    controlPoints: [
      [112, 20, 201], [144, 21, 189], [178, 23, 177], [210, 26, 165], [240, 28, 150],
      [260, 31, 123], [273, 34, 90], [285, 36, 58], [290, 39, 25], [280, 41, -10],
      [261, 44, -38], [243, 47, -66], [222, 50, -93], [199, 52, -121], [184, 54, -151],
      [184, 56, -185], [184, 56, -221], [179, 55, -254], [152, 53, -273], [119, 50, -270],
      [97, 47, -243], [96, 44, -209], [96, 42, -175], [77, 40, -146], [44, 40, -140],
      [16, 42, -158], [9, 44, -190], [9, 48, -226], [9, 51, -260], [9, 55, -294],
      [-1, 57, -328], [-30, 58, -343], [-62, 57, -334], [-79, 55, -304], [-79, 52, -270],
      [-79, 49, -236], [-79, 46, -202], [-82, 43, -166], [-105, 40, -143], [-138, 38, -142],
      [-163, 38, -166], [-166, 39, -200], [-166, 41, -234], [-179, 44, -263], [-213, 48, -275],
      [-243, 51, -261], [-254, 53, -230], [-254, 54, -194], [-254, 54, -160], [-255, 52, -127],
      [-258, 50, -93], [-261, 46, -57], [-256, 43, -24], [-244, 39, 8], [-232, 36, 42],
      [-220, 33, 74], [-203, 30, 103], [-176, 28, 124], [-147, 26, 145], [-119, 25, 165],
      [-92, 24, 184], [-59, 23, 199], [-26, 22, 201], [8, 21, 202], [42, 19, 203],
      [78, 19, 204],
    ],
    palette: {
      sky: ["#000005", "#04021a", "#0f0838", "#241454"],
      stars: true,
      moons: [{ x: 780, y: 90, r: 22, tint: "#b4a5fc" }],
      fog: 0x120a30, fogNear: 200, fogFar: 1100,
      hemiSky: 0x6a5fd0, hemiGround: 0x100a28, hemiInt: 0.5,
      sun: 0xb0a8ff, sunInt: 0.7,
      groundBase: "#0a0620", groundSpeck: "#160f38", groundDark: "#040210",
      road: "#1a1440", roadDark: "#120d30", rumbleA: "#6d28d9", rumbleB: "#a78bfa",
      laneLine: "#c4b5fd", edgeLine: "#ddd6fe", roadFinish: "wet",
      crystalColors: [0x8b5cf6, 0xa78bfa, 0xc4b5fd],
      mountain: 0x1a1040, mountainDark: 0x0d0a2e, clutter: 0x1a1040, gem: 0xa78bfa,
    },
    scenery: [{ kind: "crystal", weight: 1 }],
  },

  sands: {
    id: "sands",
    name: "Sunspire Sands",
    blurb: "Blazing desert circuit — vast dunes, ancient monuments, long sun-baked straights.",
    // Sunspire Sands: two long sun-baked straights (bottom + top) wrapped around a
    // tight inward stadium-infield notch on the east side — the road dives into the
    // interior, U-turns along a short floor and climbs back out — then a big
    // sweeping bend at the far west end. min turn radius ~22 m (infield notch).
    controlPoints: [
      [-284, 16, 97], [-278, 17, 126], [-265, 17, 151], [-242, 18, 171], [-216, 19, 180],
      [-186, 20, 182], [-158, 21, 182], [-128, 22, 183], [-100, 23, 184], [-70, 24, 184],
      [-42, 25, 185], [-12, 26, 186], [16, 28, 186], [46, 29, 187], [74, 29, 187],
      [104, 30, 188], [134, 30, 189], [162, 30, 189], [192, 29, 187], [216, 28, 174],
      [242, 26, 159], [266, 25, 144], [288, 23, 124], [294, 22, 97], [299, 20, 67],
      [302, 19, 40], [299, 18, 10], [284, 16, -14], [269, 15, -39], [249, 13, -62],
      [223, 12, -68], [193, 11, -64], [169, 10, -50], [153, 9, -25], [152, 8, 3],
      [142, 8, 31], [120, 7, 47], [90, 7, 50], [63, 6, 44], [43, 6, 23],
      [38, 6, -4], [38, 6, -34], [28, 6, -60], [4, 7, -78], [-22, 7, -93],
      [-50, 8, -95], [-80, 8, -95], [-108, 9, -95], [-138, 10, -95], [-165, 10, -90],
      [-193, 11, -80], [-220, 12, -71], [-247, 13, -59], [-268, 14, -40], [-282, 14, -14],
      [-293, 15, 12], [-298, 15, 41], [-293, 15, 69],
    ],
    palette: {
      sky: ["#1c2f5c", "#7a4a6e", "#d97a3e", "#ffd98a"],
      stars: false,
      moons: [{ x: 680, y: 220, r: 55, tint: "#fff0c0" }],
      fog: 0xd9a668, fogNear: 240, fogFar: 1400,
      hemiSky: 0xffd9a0, hemiGround: 0xd9a668, hemiInt: 0.85,
      sun: 0xffcf80, sunInt: 1.25,
      groundBase: "#d9a668", groundSpeck: "#c48a4a", groundDark: "#9c6b34",
      groundTint: 0xcaa46a,
      road: "#8a6f4a", roadDark: "#705a3c", rumbleA: "#b3892f", rumbleB: "#f0b24a",
      laneLine: "#ffe6b0", edgeLine: "#fff2cc", roadFinish: "dusty",
      crystalColors: [0xf0b24a, 0xffcf80, 0xffe6b0],
      mountain: 0xc48a4a, mountainDark: 0x8a6234, clutter: 0xc48a4a, gem: 0xf59e0b,
    },
    scenery: [
      { kind: "sandRock", weight: 6 }, { kind: "palm", weight: 5 },
      { kind: "obelisk", weight: 3 }, { kind: "pyramid", weight: 2 },
      { kind: "sphinx", weight: 2 },
    ],
  },

  castle: {
    id: "castle",
    name: "Hogwarts",
    blurb: "A twisting lap around the wizarding castle — turrets, the Express, floating candles and a Whomping Willow.",
    // Hogwarts: a tight, technical castle lap — an S-chicane cresting a rise on the
    // east side, a snapping esse into a hairpin over the top, then a long twisting
    // descent down the west flank back to the start. min turn radius ~23 m.
    controlPoints: [
      [-223, 8, 127], [-204, 8, 146], [-184, 9, 163], [-157, 10, 172], [-131, 10, 174],
      [-104, 11, 177], [-78, 12, 179], [-50, 13, 182], [-22, 14, 184], [4, 16, 187],
      [32, 17, 189], [57, 19, 184], [84, 20, 174], [108, 22, 165], [134, 23, 156],
      [156, 25, 138], [169, 26, 116], [183, 27, 91], [189, 28, 67], [180, 28, 41],
      [162, 28, 22], [136, 27, 14], [108, 26, 20], [83, 24, 27], [56, 22, 21],
      [37, 20, 4], [30, 19, -23], [41, 18, -46], [59, 18, -67], [81, 19, -84],
      [105, 20, -93], [126, 21, -111], [133, 22, -136], [124, 22, -162], [110, 22, -183],
      [85, 21, -195], [57, 19, -200], [31, 17, -204], [4, 16, -209], [-22, 14, -205],
      [-49, 12, -198], [-74, 11, -191], [-101, 11, -185], [-127, 10, -174], [-148, 9, -158],
      [-170, 9, -141], [-190, 9, -125], [-210, 8, -105], [-220, 8, -81], [-228, 8, -55],
      [-237, 8, -28], [-245, 7, -4], [-249, 7, 24], [-246, 7, 50], [-243, 7, 78],
      [-238, 8, 103],
    ],
    palette: {
      sky: ["#0a0820", "#1a1238", "#332a5c", "#5c4a8a"],
      stars: true,
      moons: [{ x: 640, y: 110, r: 38, tint: "#cdb8ef" }],
      fog: 0x2c2648, fogNear: 140, fogFar: 780,
      hemiSky: 0x9a8cd0, hemiGround: 0x3a2a2a, hemiInt: 0.7,
      sun: 0xc0b0e8, sunInt: 0.85,
      groundBase: "#241c38", groundSpeck: "#2e2444", groundDark: "#160f28",
      road: "#3a2e42", roadDark: "#2c2334", rumbleA: "#6d28d9", rumbleB: "#f0a840",
      laneLine: "#e0d4f5", edgeLine: "#f5ecff", roadFinish: "gloss",
      crystalColors: [0x6d28d9, 0x8b5cf6, 0xf0a840],
      mountain: 0x241c3c, mountainDark: 0x160f28, clutter: 0x4a3a30, gem: 0xf0a840,
    },
    scenery: [
      { kind: "torch", weight: 5 }, { kind: "castleWall", weight: 4 },
      { kind: "tower", weight: 4 }, { kind: "banner", weight: 3 },
      { kind: "treeDark", weight: 3 }, { kind: "gatehouse", weight: 2 },
      { kind: "floatingCandle", weight: 2 }, { kind: "whompingWillow", weight: 1 },
      { kind: "quidditchHoop", weight: 1 }, { kind: "goldenSnitch", weight: 1 },
      { kind: "hogwartsExpress", weight: 1 },
    ],
  },

  circuit: {
    id: "circuit",
    name: "Apex Speedway",
    blurb: "A real grand-prix stadium — grandstands, floodlights, flat-out sweepers and a stadium roar.",
    // Apex Speedway: a purpose-built GP tri-oval — a long main straight along the
    // bottom, a fast turn-1 sweeper up the east side, a flowing infield esse that
    // hooks toward the middle, a top straight and a big fast left sweeper back onto
    // the main straight. Fast, flowing, asymmetric. min turn radius ~25 m.
    controlPoints: [
      [-280, 6, 118], [-266, 6, 149], [-250, 7, 177], [-224, 7, 198], [-193, 8, 206],
      [-159, 9, 207], [-127, 10, 207], [-93, 11, 208], [-61, 12, 209], [-27, 12, 209],
      [7, 13, 210], [39, 14, 211], [73, 15, 211], [105, 16, 212], [139, 17, 213],
      [171, 18, 213], [205, 18, 214], [236, 18, 212], [264, 18, 193], [284, 17, 165],
      [302, 17, 139], [313, 16, 108], [309, 15, 76], [304, 15, 42], [295, 14, 12],
      [268, 13, -9], [241, 12, -25], [210, 11, -38], [176, 10, -36], [144, 9, -33],
      [111, 8, -36], [84, 8, -52], [61, 8, -77], [59, 8, -108], [67, 9, -141],
      [57, 10, -171], [31, 10, -191], [0, 11, -206], [-31, 12, -210], [-65, 12, -212],
      [-97, 12, -214], [-131, 12, -211], [-161, 12, -201], [-193, 11, -191], [-224, 11, -180],
      [-250, 11, -159], [-269, 10, -131], [-287, 10, -105], [-303, 9, -75], [-308, 8, -43],
      [-306, 8, -9], [-304, 7, 22], [-301, 6, 56], [-294, 6, 87],
    ],
    palette: {
      sky: ["#1a5fb0", "#3a82c8", "#7ec1ea", "#eaf6ff"],
      stars: false,
      moons: [{ x: 720, y: 100, r: 36, tint: "#ffffff" }],
      fog: 0xcfe6f5, fogNear: 260, fogFar: 1500,
      hemiSky: 0xd0ecff, hemiGround: 0x5a6a4a, hemiInt: 0.8,
      sun: 0xffffff, sunInt: 1.3,
      groundBase: "#3f8a3a", groundSpeck: "#4f9f45", groundDark: "#2f6f2c",
      road: "#302f34", roadDark: "#26262a", rumbleA: "#e0342f", rumbleB: "#ffffff",
      laneLine: "#ffffff", edgeLine: "#ffffff", roadFinish: "gloss",
      crystalColors: [0x22d3ee, 0xe0342f, 0xffffff],
      mountain: 0x6a7280, mountainDark: 0x454b56, clutter: 0xa8afb8, gem: 0x22d3ee,
    },
    scenery: [
      { kind: "grandstand", weight: 5 }, { kind: "floodlight", weight: 5 },
      { kind: "tyreStack", weight: 3 }, { kind: "marshalBoard", weight: 3 },
      { kind: "pitBuilding", weight: 2 },
    ],
  },

  metro: {
    id: "metro",
    name: "Neon Metro",
    blurb: "A midnight street circuit through the city — glass towers, neon billboards, wet asphalt.",
    // Neon Metro (London Eye): a lopsided kidney street circuit — two bumpy lobes
    // and a deep concave bite carved into the west side, a straighter high-speed run
    // down the east flank, wrapped top and bottom. min turn radius ~27 m.
    controlPoints: [
      [-177, 10, -197], [-148, 10, -206], [-120, 11, -216], [-91, 12, -225], [-63, 13, -235],
      [-36, 15, -243], [-8, 16, -253], [21, 18, -258], [50, 19, -250], [78, 20, -239],
      [106, 21, -228], [134, 22, -217], [161, 23, -203], [178, 24, -182], [193, 25, -156],
      [207, 26, -129], [222, 26, -103], [233, 26, -76], [235, 25, -46], [235, 24, -16],
      [235, 23, 14], [235, 22, 42], [230, 20, 72], [219, 19, 100], [209, 17, 128],
      [198, 16, 155], [181, 15, 180], [157, 14, 198], [132, 12, 215], [109, 11, 231],
      [84, 10, 248], [56, 9, 256], [26, 8, 255], [-4, 8, 254], [-34, 8, 252],
      [-64, 9, 250], [-92, 10, 239], [-117, 11, 227], [-144, 12, 213], [-170, 13, 200],
      [-195, 14, 183], [-213, 15, 159], [-231, 16, 135], [-241, 17, 107], [-234, 19, 78],
      [-213, 20, 59], [-189, 21, 42], [-175, 22, 16], [-180, 22, -13], [-201, 21, -34],
      [-225, 20, -51], [-243, 18, -75], [-245, 16, -104], [-233, 14, -129], [-218, 12, -156],
      [-202, 11, -181],
    ],
    palette: {
      sky: ["#02030a", "#080b1c", "#150f30", "#3a1f4a"],
      stars: true,
      moons: [{ x: 700, y: 90, r: 26, tint: "#c9baff" }],
      fog: 0x1c1830, fogNear: 170, fogFar: 900,
      hemiSky: 0x8a6ad0, hemiGround: 0x201c30, hemiInt: 0.8,
      sun: 0xa8b0ff, sunInt: 0.9,
      groundBase: "#26242e", groundSpeck: "#332e3e", groundDark: "#1a1822",
      groundTint: 0x484258,
      road: "#1c1c22", roadDark: "#121216", rumbleA: "#ff2ea5", rumbleB: "#22e0e8",
      laneLine: "#ffe97a", edgeLine: "#fff08a", roadFinish: "wet",
      crystalColors: [0xff2ea5, 0x22e0e8, 0xd6c8ff],
      mountain: 0x1c1830, mountainDark: 0x0e0c1c, clutter: 0x332e3e, gem: 0x22e0e8,
    },
    scenery: [
      { kind: "skyscraper", weight: 5 }, { kind: "streetlight", weight: 4 },
      { kind: "billboard", weight: 4 }, { kind: "brownstone", weight: 3 },
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
      sky: ["#010a06", "#04241a", "#0a4a2e", "#1a7a48"],
      stars: true,
      moons: [{ x: 760, y: 100, r: 24, tint: "#7dffb0" }],
      fog: 0x0a3020, fogNear: 200, fogFar: 1100,
      hemiSky: 0x3ff08a, hemiGround: 0x0a2818, hemiInt: 0.55,
      sun: 0x8dffc0, sunInt: 0.75,
      groundBase: "#06140f", groundSpeck: "#123a24", groundDark: "#03100b",
      road: "#0d2818", roadDark: "#081c10", rumbleA: "#0f9d4a", rumbleB: "#5eff9c",
      laneLine: "#8dffb0", edgeLine: "#c0ffd8", roadFinish: "wet",
      crystalColors: [0x22e88a, 0x7dffb0, 0xc8ffd8],
      mountain: 0x0a3020, mountainDark: 0x051f14, clutter: 0x0a3020, gem: 0x22e88a,
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
