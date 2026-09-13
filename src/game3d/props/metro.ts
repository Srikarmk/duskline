import * as THREE from "three";

// -----------------------------------------------------------------------------
// New-York-City night street-circuit props. Procedural, faceted low-poly massing
// tuned for a MOODY, MOSTLY-DARK skyline: dark concrete/glass facades where only
// a minority of windows are lit, and a handful of signs read as accents rather
// than a solid neon glow. The scene runs UnrealBloom, so emissive surfaces are
// kept deliberately dim. Every group's base sits on y=0. Palette:
//   glass  #1b2532 / #212c3c   masonry #33383f / #2b2f37   brick #7a4a3a
//   stone/steel #2c2f36 / #3f444e   warm window #ffcf94   cool window #a8c4ec
// -----------------------------------------------------------------------------

// --- shared helpers ----------------------------------------------------------

/** A cylinder strut spanning two points — used for splayed legs and bracing. */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

type FacadeStyle = "glass" | "masonry";

/** A facade baked to a canvas used as an emissiveMap. The panel is baked MOSTLY
 *  DARK: only a minority of windows are lit, and they cluster into believable
 *  vertical office stacks and occupied floors (per-column / per-floor bias) so
 *  no two towers match. Lit cells are dim on their own; the material's low
 *  emissiveIntensity does the final dimming so windows read as small distinct
 *  rectangles on a dark wall instead of a glowing grid. Glass towers get wide
 *  ribbon glazing, masonry gets narrower punched windows. */
function windowFacade(rand: () => number, cols: number, rows: number, style: FacadeStyle, litFrac: number): THREE.CanvasTexture {
  const cell = 12;
  // horizontal vs vertical inset differs by style: glass = ribbon (wide, short
  // panes with strong horizontal spandrels), masonry = punched (narrower panes)
  const padX = style === "glass" ? 1.5 : 3;
  const padY = style === "glass" ? 4 : 2.5;
  const c = document.createElement("canvas");
  c.width = Math.max(1, cols) * cell;
  c.height = Math.max(1, rows) * cell;
  const ctx = c.getContext("2d")!;

  // Near-black base: spandrels and unlit panes emit essentially nothing.
  ctx.fillStyle = "#05070b";
  ctx.fillRect(0, 0, c.width, c.height);

  // Per-column / per-floor propensity. ~1/3 of columns and floors are "dark"
  // (vacant / unoccupied), the rest lean lit — this is what makes lit windows
  // read as clustered stacks rather than random static.
  const colBias: number[] = [];
  for (let x = 0; x < cols; x++) colBias[x] = rand() < 0.35 ? 0.05 : 0.3 + rand() * 0.7;
  const rowBias: number[] = [];
  for (let y = 0; y < rows; y++) rowBias[y] = rand() < 0.3 ? 0.08 : 0.35 + rand() * 0.65;

  // Lit panes are kept fairly bright in the map; emissiveIntensity (~0.3) then
  // dims the whole thing to roughly a third of the old brightness.
  const warmShades = ["#ffcf94", "#f0b870", "#ffdca8", "#e0a860"];
  const coolShades = ["#a8c4ec", "#8fb0e0", "#c0d6ff", "#7f9dc4"];
  const warmProb = style === "masonry" ? 0.75 : 0.42;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cell + padX;
      const py = y * cell + padY;
      const ww = cell - padX * 2;
      const wh = cell - padY * 2;
      const p = litFrac * colBias[x] * rowBias[y] * (0.7 + rand() * 0.7);
      if (rand() < p) {
        const set = rand() < warmProb ? warmShades : coolShades;
        ctx.fillStyle = set[Math.floor(rand() * set.length)];
      } else {
        // unlit pane: barely-there dark glass so it never blooms
        ctx.fillStyle = rand() < 0.5 ? "#0a0e16" : "#070a11";
      }
      ctx.fillRect(px, py, ww, wh);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** A lit ad baked to a canvas: a DARK panel with one saturated content block, a
 *  bright logo and a few neon text bars, used as an emissiveMap. Reads as a real
 *  illuminated sign (content on black) rather than a solid glowing slab. */
function billboardAd(rand: () => number, neon: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const hex = "#" + neon.toString(16).padStart(6, "0");

  // dark panel base — most of the sign is unlit
  ctx.fillStyle = "#08080c";
  ctx.fillRect(0, 0, 256, 128);

  // one saturated "ad image" block on the left
  const bw = 150;
  ctx.fillStyle = hex;
  ctx.fillRect(10, 16, bw, 96);
  // interior shadow band to break up the field
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(10, 74, bw, 22);
  // bright logo square
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(24, 34, 40, 40);

  // neon text bars over the dark right-hand area
  ctx.fillStyle = hex;
  for (let i = 0; i < 4; i++) {
    const w = 40 + rand() * 66;
    ctx.fillRect(178, 24 + i * 22, w, 10);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- skyscraper (the landmark) ----------------------------------------------

/** A dark night tower with proper massing: a wider street-level podium, 1-3
 *  setback tiers with cornice ledges, a mostly-dark window facade (glass-curtain
 *  or masonry look), and one of five crowns (flat penthouse / stepped / antenna
 *  beacon / rooftop water-tank / lit sign). Height, footprint, tier count,
 *  material style, window-lit density and crown all vary per call so the skyline
 *  never repeats. ~13-24 units. */
export function makeSkyscraper(rand: () => number): THREE.Group {
  const g = new THREE.Group();

  const glass = rand() < 0.55; // glass-curtain tower vs older masonry block
  const totalH = 13 + rand() * 11; // 13 - 24
  const tierCount = 1 + Math.floor(rand() * 3); // 1, 2 or 3
  const tierFracs = tierCount === 1 ? [1] : tierCount === 2 ? [0.6, 0.4] : [0.5, 0.32, 0.18];

  // Varied dark greys / blue-greys. Glass reads smoother + slightly metallic;
  // masonry reads matte and rough.
  const bodyColors = glass ? [0x1b2532, 0x212c3c, 0x172029] : [0x33383f, 0x2b2f37, 0x3b3e46];
  const roughness = glass ? 0.38 + rand() * 0.14 : 0.85 + rand() * 0.1;
  const metalness = glass ? 0.28 + rand() * 0.18 : 0.06 + rand() * 0.06;
  const emInt = glass ? 0.26 + rand() * 0.1 : 0.32 + rand() * 0.1; // ~1/3 of the old 0.85-1.15
  const litFrac = 0.22 + rand() * 0.6; // some towers nearly dark, some busier

  const stone = new THREE.MeshStandardMaterial({ color: glass ? 0x232833 : 0x2c2f36, roughness: 0.8, metalness: 0.2, flatShading: true });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3f444e, metalness: 0.55, roughness: 0.5, flatShading: true });

  let footprint = 4.5 + rand() * 3.5; // 4.5 - 8
  let baseW = footprint;
  let baseD = footprint;
  let y = 0;
  let topFootprint = footprint;
  for (let i = 0; i < tierCount; i++) {
    const tierH = totalH * (tierFracs[i] * (0.9 + rand() * 0.2));
    const w = footprint;
    const d = footprint * (0.82 + rand() * 0.34);
    if (i === 0) {
      baseW = w;
      baseD = d;
    }
    const cols = Math.max(3, Math.round(w * 1.4));
    const rows = Math.max(4, Math.round(tierH * 1.25));
    const mat = new THREE.MeshStandardMaterial({
      color: bodyColors[i % bodyColors.length],
      emissive: 0xffffff,
      emissiveMap: windowFacade(rand, cols, rows, glass ? "glass" : "masonry", litFrac),
      emissiveIntensity: emInt,
      roughness,
      metalness,
      flatShading: true,
    });
    const tier = new THREE.Mesh(new THREE.BoxGeometry(w, tierH, d), mat);
    tier.position.y = y + tierH / 2;
    g.add(tier);
    y += tierH;

    // thin recessed cornice ledge marking each setback
    if (i < tierCount - 1) {
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.24, d + 0.3), stone);
      ledge.position.y = y;
      g.add(ledge);
    }
    topFootprint = Math.min(w, d);
    footprint *= 0.68 + rand() * 0.16;
  }

  // street-level podium (retail base): slightly wider, dark, unlit
  const podH = 1.0 + rand() * 0.5;
  const podium = new THREE.Mesh(
    new THREE.BoxGeometry(baseW + 0.4, podH, baseD + 0.4),
    new THREE.MeshStandardMaterial({ color: 0x181b21, roughness: 0.85, metalness: 0.12, flatShading: true })
  );
  podium.position.y = podH / 2;
  g.add(podium);

  // --- crown: every tower gets a parapet cap, then one of five roof forms ---
  const capW = topFootprint * 1.02;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(capW, 0.35, capW), stone);
  cap.position.y = y + 0.175;
  g.add(cap);
  const cy = y + 0.35;

  const crown = Math.floor(rand() * 5);
  if (crown === 0) {
    // flat: a low mechanical penthouse off-centre
    const pent = new THREE.Mesh(new THREE.BoxGeometry(capW * 0.5, 0.8, capW * 0.5), stone);
    pent.position.set((rand() - 0.5) * capW * 0.25, cy + 0.4, (rand() - 0.5) * capW * 0.25);
    g.add(pent);
  } else if (crown === 1) {
    // stepped: two shrinking blocks
    let sw = capW * 0.82;
    let sy = cy;
    for (let i = 0; i < 2; i++) {
      const sh = 0.7;
      const b = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sw), stone);
      b.position.y = sy + sh / 2;
      g.add(b);
      sy += sh;
      sw *= 0.6;
    }
  } else if (crown === 2) {
    // antenna mast + a single dim red aviation beacon
    const mastH = 2 + rand() * 2.5;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, mastH, 6), steel);
    mast.position.y = cy + mastH / 2;
    g.add(mast);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0xff2a2a, emissiveIntensity: 0.9, flatShading: true })
    );
    beacon.position.y = cy + mastH;
    g.add(beacon);
  } else if (crown === 3) {
    // rooftop wooden water tank on splayed legs (NYC motif)
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3f28, roughness: 0.95, metalness: 0, flatShading: true });
    const tR = Math.max(0.6, capW * 0.28);
    const tH = 1.0;
    const lH = 1.1;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bot = new THREE.Vector3(Math.cos(a) * tR * 1.15, cy, Math.sin(a) * tR * 1.15);
      const top = new THREE.Vector3(Math.cos(a) * tR * 0.8, cy + lH, Math.sin(a) * tR * 0.8);
      g.add(strut(bot, top, 0.05, steel));
    }
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(tR, tR, tH, 9), wood);
    tank.position.y = cy + lH + tH / 2;
    g.add(tank);
    const lid = new THREE.Mesh(
      new THREE.ConeGeometry(tR + 0.05, 0.5, 9),
      new THREE.MeshStandardMaterial({ color: 0x3f2c1a, roughness: 0.95, metalness: 0, flatShading: true })
    );
    lid.position.y = cy + lH + tH + 0.25;
    g.add(lid);
  } else {
    // rooftop lit sign — a moderate accent, not a floodlight
    const neons = [0xff3ea5, 0x22d3ee, 0x4ade80, 0xffd9a0];
    const neon = neons[Math.floor(rand() * neons.length)];
    const legH = 0.8;
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, legH, 0.12), steel);
      leg.position.set(sx * capW * 0.3, cy + legH / 2, 0);
      g.add(leg);
    }
    const pw = capW * 0.95;
    const ph = 1.3;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, ph),
      new THREE.MeshStandardMaterial({
        color: 0x0a0a0e,
        emissive: 0xffffff,
        emissiveMap: billboardAd(rand, neon),
        emissiveIntensity: 0.6,
        side: THREE.DoubleSide,
        flatShading: true,
      })
    );
    panel.position.set(0, cy + legH + ph / 2, 0);
    g.add(panel);
  }

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

// --- brownstone row-house ----------------------------------------------------

/** A short, warm classic brownstone: a 3-4 story brick block (clearly lower and
 *  warmer than the glass towers), a base water-table course, an overhanging
 *  cornice, a stepped stoop up to a softly lit doorway, and a few warm lit
 *  windows on an otherwise dark brick face. ~5-7 units. Front faces +z. */
export function makeBrownstone(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const stories = 3 + Math.floor(rand() * 2); // 3 or 4
  const storyH = 1.5 + rand() * 0.2;
  const h = stories * storyH;
  const w = 3.4 + rand() * 1.2;
  const d = 3.0 + rand() * 1.0;

  const brickShades = [0x6e4636, 0x7a4a3a, 0x5f3b2e, 0x83513c];
  const brick = new THREE.MeshStandardMaterial({ color: brickShades[Math.floor(rand() * brickShades.length)], roughness: 0.92, metalness: 0.05, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: 0x4e352a, roughness: 0.9, metalness: 0.05, flatShading: true });
  const stone = new THREE.MeshStandardMaterial({ color: 0x635f5c, roughness: 0.9, metalness: 0.1, flatShading: true });

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), brick);
  body.position.y = h / 2;
  g.add(body);

  // base water-table course (slightly wider dark stone plinth)
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.6, d + 0.2), trim);
  plinth.position.y = 0.3;
  g.add(plinth);

  // overhanging cornice
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.5, d + 0.5), trim);
  cornice.position.y = h + 0.2;
  g.add(cornice);

  // stepped stoop rising to the parlor-floor door
  const stoopTop = 1.2;
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const sh = stoopTop * ((i + 1) / steps);
    const step = new THREE.Mesh(new THREE.BoxGeometry(w * 0.42, sh, 0.42), stone);
    step.position.set(0, sh / 2, d / 2 + 0.18 + (steps - 1 - i) * 0.42);
    g.add(step);
  }
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 1.15, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2a1e18, emissive: 0xffc27a, emissiveIntensity: 0.28, flatShading: true })
  );
  door.position.set(0, stoopTop + 0.57, d / 2 + 0.03);
  g.add(door);

  // a few warm lit windows — most stay dark
  for (let s = 0; s < stories; s++) {
    for (const cx of [-1, 1]) {
      const lit = rand() < 0.4;
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.8, 0.08),
        new THREE.MeshStandardMaterial({
          color: 0x14202f,
          emissive: lit ? 0xffcf94 : 0x000000,
          emissiveIntensity: lit ? 0.35 : 0,
          flatShading: true,
        })
      );
      win.position.set(cx * w * 0.24, 0.9 + s * storyH, d / 2 + 0.04);
      g.add(win);
    }
  }

  g.rotation.y = (rand() - 0.5) * 0.3;
  return g;
}

// --- street lamp -------------------------------------------------------------

/** A curved-arm street lamp: a stepped base, a tapered post, a gooseneck arm
 *  and a downward amber lamp head. The head is a soft warm accent, not a flare.
 *  ~4-5 units. */
/**
 * A proper highway light: a tall pole with a long boom arching OVER the
 * carriageway and a lamp head hanging above the lane.
 *
 * makeStreetlight is a 4-5 m urban pole with a 1 m gooseneck — beside the road
 * and barely above the roofline of a car, which from the driver's seat reads
 * as a small bar on the verge rather than as lighting. Motorway lighting is
 * 10-12 m up with a 5-6 m reach, so the lamps pass over your head, and that
 * overhead rhythm is most of what makes a night highway look like one.
 *
 * `reach` is how far the boom extends toward the road; positive values point
 * along +X, so mirror the group for the other verge.
 */
/**
 * A neon sign: a stack of lit bars hung on a building face.
 *
 * The reference is emphatic that Neo-Tokyo's light is MOTIVATED — it comes
 * from signs, streetlamps and headlights, never from an ambient wash. Towers
 * with nothing but window squares give the eye nothing to read as a city, and
 * the signs are what make the buildings feel occupied. Unlit material on
 * purpose: these are light sources, so they must not dim with distance or take
 * the scene's ambient.
 */
/**
 * A Neo-Tokyo tower.
 *
 * makeSkyscraper is one extruded box with a window grid, and a city of those
 * is a bar chart. What gives the reference its density is SILHOUETTE: the
 * massing steps back as it climbs, blocks of different heights are jammed hard
 * against each other, and the roofline is a mess of tanks, vents, masts and
 * aircraft warning lights. None of it is expensive — it is all boxes — but it
 * is the difference between "buildings" and "a city".
 *
 * Built around the origin at its base, footprint roughly `w` by `d`.
 */
export function makeNeoTower(rand: () => number, w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({
    color: 0x0d0c18, metalness: 0.1, roughness: 0.92, flatShading: true,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x07060e, metalness: 0.2, roughness: 0.85, flatShading: true,
  });
  const lit = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  const litCool = new THREE.MeshBasicMaterial({ color: 0x8fd8ff });
  const box = (bw: number, bh: number, bd: number, m: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
    b.position.set(x, y, z);
    g.add(b);
    return b;
  };

  // --- massing: a stack of slabs that step back and shift as it climbs ------
  let y = 0;
  let cw = w, cd = d;
  let ox = 0, oz = 0;
  const tiers = 2 + Math.floor(rand() * 3);
  for (let t = 0; t < tiers; t++) {
    const th = (h / tiers) * (0.6 + rand() * 0.8);
    box(cw, th, cd, shell, ox, y + th / 2, oz);
    // a service core or lift shaft riding up the side of this tier, which is
    // what stops the profile being a clean rectangle
    if (rand() < 0.55) {
      const sw = cw * (0.16 + rand() * 0.14);
      box(sw, th * (0.7 + rand() * 0.5), cd * 0.5, dark,
        ox + (rand() < 0.5 ? -1 : 1) * (cw / 2 - sw / 2), y + th * 0.45, oz + cd * 0.3);
    }
    y += th;
    // step back, and shift off-axis so the stack leans rather than telescoping
    cw *= 0.62 + rand() * 0.26;
    cd *= 0.62 + rand() * 0.26;
    ox += (rand() - 0.5) * w * 0.2;
    oz += (rand() - 0.5) * d * 0.2;
  }
  const topY = y;

  // --- a neighbour jammed against it, at a different height ----------------
  if (rand() < 0.75) {
    const nw = w * (0.5 + rand() * 0.5), nd = d * (0.6 + rand() * 0.5);
    const nh = h * (0.3 + rand() * 0.45);
    box(nw, nh, nd, shell,
      (w / 2 + nw / 2) * (rand() < 0.5 ? -1 : 1) * 0.92, nh / 2, (rand() - 0.5) * d * 0.5);
  }

  // --- roofline clutter ----------------------------------------------------
  const tank = () => {
    const r = cw * (0.12 + rand() * 0.12);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * (1.2 + rand()), 8), dark);
    t.position.set(ox + (rand() - 0.5) * cw * 0.6, topY + r * 0.9, oz + (rand() - 0.5) * cd * 0.6);
    g.add(t);
  };
  for (let i = 0; i < 1 + Math.floor(rand() * 3); i++) tank();
  for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) {
    box(cw * (0.1 + rand() * 0.16), cw * (0.1 + rand() * 0.14), cd * (0.1 + rand() * 0.16), dark,
      ox + (rand() - 0.5) * cw * 0.7, topY + cw * 0.08, oz + (rand() - 0.5) * cd * 0.7);
  }
  // masts, with the red aircraft lamp on top
  for (let i = 0; i < 1 + Math.floor(rand() * 2); i++) {
    const mh = h * (0.08 + rand() * 0.16);
    const mx = ox + (rand() - 0.5) * cw * 0.5, mz = oz + (rand() - 0.5) * cd * 0.5;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, mh, 5), dark);
    mast.position.set(mx, topY + mh / 2, mz);
    g.add(mast);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xff2b2b }));
    lamp.position.set(mx, topY + mh, mz);
    g.add(lamp);
  }

  // --- lit windows: irregular, in blocks, with whole dark floors -----------
  // A perfect grid reads as wallpaper. Real towers have floors that are out,
  // runs of lit offices, and the odd single window burning on its own.
  const floors = Math.max(4, Math.round(h / 3.4));
  for (let f = 1; f < floors; f++) {
    if (rand() < 0.3) continue;                       // this floor is dark
    const fy = (f / floors) * topY * 0.94;
    if (fy > topY) break;
    // width available at this height: shrink with the setbacks
    const k = 1 - (fy / topY) * 0.45;
    const runs = 1 + Math.floor(rand() * 3);
    for (let r = 0; r < runs; r++) {
      const ww = w * k * (0.06 + rand() * 0.2);
      const wx = (rand() - 0.5) * w * k * 0.86;
      const m = rand() < 0.22 ? litCool : lit;
      box(ww, 1.1 + rand() * 0.7, 0.16, m, wx, fy, d * k * 0.5 + 0.02);
      box(ww, 1.1 + rand() * 0.7, 0.16, m, wx, fy, -d * k * 0.5 - 0.02);
    }
    if (rand() < 0.5) {
      const wd = d * k * (0.08 + rand() * 0.2);
      const wz = (rand() - 0.5) * d * k * 0.8;
      box(0.16, 1.1 + rand() * 0.6, wd, lit, w * k * 0.5 + 0.02, fy, wz);
      box(0.16, 1.1 + rand() * 0.6, wd, lit, -w * k * 0.5 - 0.02, fy, wz);
    }
  }
  return g;
}

export function makeNeonSign(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const palette = [0xff2d95, 0x00e5ff, 0x7cff4a, 0xffd426, 0xb14bff, 0xff4d3d];
  const vertical = rand() < 0.62;
  const n = 2 + Math.floor(rand() * 4);
  const col = palette[Math.floor(rand() * palette.length)];

  // the backing board, dark so the bars read against it
  const w = vertical ? 1.1 + rand() * 0.7 : 3.4 + rand() * 2.6;
  const h = vertical ? 4.5 + rand() * 3.5 : 1.3 + rand() * 0.8;
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.22),
    new THREE.MeshBasicMaterial({ color: 0x0a0812 }));
  g.add(board);

  // the lit elements: bars of a single hue, the way a sign of one word is
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const bw = vertical ? w * (0.42 + rand() * 0.34) : w * (0.1 + rand() * 0.2);
    const bh = vertical ? h * (0.1 + rand() * 0.12) : h * (0.42 + rand() * 0.34);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.07),
      new THREE.MeshBasicMaterial({ color: col }));
    bar.position.set(
      vertical ? (rand() - 0.5) * w * 0.18 : (t - 0.5) * w * 0.82,
      vertical ? (0.5 - t) * h * 0.82 : (rand() - 0.5) * h * 0.18,
      0.15
    );
    g.add(bar);
  }
  // the glow it throws back onto its own board
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.7, h * 1.5),
    new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
  halo.position.z = 0.2;
  g.add(halo);
  return g;
}

export function makeOverheadLight(rand: () => number, glow: number, reach = 6.2): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x33373f, metalness: 0.55, roughness: 0.45, flatShading: true });
  const h = 10.5 + rand() * 2.2;

  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.44, 0.55, 8), steel);
  foot.position.y = 0.27;
  g.add(foot);
  const poleH = h - 0.55;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.2, poleH, 8), steel);
  mast.position.y = 0.55 + poleH / 2;
  g.add(mast);

  // the boom: a long shallow arc out over the road, not a tight gooseneck
  const topY = 0.55 + poleH;
  const pts: THREE.Vector3[] = [];
  const seg = 10;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    // rises quickly then flattens, so the lamp hangs level above the lane
    pts.push(new THREE.Vector3(reach * t, topY + 1.5 * Math.sin(t * Math.PI * 0.5), 0));
  }
  g.add(new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.085, 6, false), steel
  ));

  // lamp head, and the hot emissive lens on its underside
  const end = pts[pts.length - 1];
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 0.62), steel);
  head.position.set(end.x - 0.45, end.y - 0.12, 0);
  g.add(head);
  const lensMat = new THREE.MeshBasicMaterial({ color: glow });
  const lens = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.06, 0.46), lensMat);
  lens.position.set(end.x - 0.45, end.y - 0.24, 0);
  g.add(lens);
  // The light it casts, as two pieces of MOTIVATED light rather than a solid
  // shape. A flat-opacity cone reads as a cyan triangle hanging in the air —
  // which is what it looked like — because a real beam is invisible except
  // where it hits something, and fades with distance from the lamp. So:
  // vertex-darkened downward and additively blended, plus the pool it throws
  // on the road, which is the part the eye actually reads as lighting.
  const beamH = end.y - 0.5;
  const beam = new THREE.ConeGeometry(2.6, beamH, 14, 1, true);
  {
    const pos = beam.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color(glow);
    for (let i = 0; i < pos.count; i++) {
      // cone apex is at +h/2 in local space: brightest at the lamp, gone by
      // the time it reaches the tarmac
      const t = Math.max(0, Math.min(1, (pos.getY(i) + beamH / 2) / beamH));
      const k = Math.pow(t, 2.2) * 0.5;
      col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
    }
    beam.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  const bm = new THREE.Mesh(beam, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  bm.position.set(end.x - 0.45, beamH / 2 + 0.1, 0);
  g.add(bm);

  // the pool on the tarmac
  const pool = new THREE.Mesh(new THREE.CircleGeometry(4.2, 20), new THREE.MeshBasicMaterial({
    color: glow, transparent: true, opacity: 0.11,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(end.x - 0.45, 0.03, 0);
  pool.scale.set(1, 1, 1.5);   // stretched along the road, as a real throw is
  g.add(pool);
  return g;
}

export function makeStreetlight(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 4 + rand(); // 4 - 5
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f5a, metalness: 0.6, roughness: 0.4, flatShading: true });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.4, 8), steel);
  base.position.y = 0.2;
  g.add(base);

  const poleH = h - 0.6;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, poleH, 8), steel);
  pole.position.y = 0.4 + poleH / 2;
  g.add(pole);

  // gooseneck arm: a quarter-circle bending up and out over the road
  const topY = 0.4 + poleH;
  const armR = 0.9 + rand() * 0.3;
  const pts: THREE.Vector3[] = [];
  const seg = 8;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector3(armR * Math.sin(a), topY + armR * (1 - Math.cos(a)), 0));
  }
  const arm = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.07, 6, false),
    steel
  );
  g.add(arm);

  const end = pts[pts.length - 1];
  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.26, 0.42, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffcf8a, emissiveIntensity: 0.5, flatShading: true })
  );
  head.position.set(end.x, end.y - 0.22, 0);
  g.add(head);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

// --- illuminated billboard ---------------------------------------------------

/** A raised illuminated billboard on a braced steel truss: two splayed legs
 *  with X-bracing and an emissive ad panel. Stays colorful but at moderate
 *  intensity so it accents the scene instead of flooding it. ~5-7 units. Neon
 *  color is randomized (magenta / cyan / green / amber). */
export function makeBillboard(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const neons = [0xff3ea5, 0x22d3ee, 0x4ade80, 0xffd9a0]; // magenta, cyan, green, amber
  const neon = neons[Math.floor(rand() * neons.length)];
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f5a, metalness: 0.6, roughness: 0.5, flatShading: true });

  const panelW = 4.5 + rand() * 1.5;
  const panelH = 2.2 + rand() * 0.8;
  const legH = 2.8 + rand(); // 2.8 - 3.8  -> total ~5 - 7
  const legX = panelW * 0.32;

  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, legH, 0.18), steel);
    leg.position.set(sx * legX, legH / 2, 0);
    g.add(leg);
  }
  // X cross-bracing between the legs
  const braceLen = Math.hypot(legX * 2, legH);
  for (const dir of [1, -1]) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.09, braceLen, 0.09), steel);
    brace.position.set(0, legH / 2, 0);
    brace.rotation.z = dir * Math.atan2(legX * 2, legH);
    g.add(brace);
  }
  // top beam under the panel
  const beam = new THREE.Mesh(new THREE.BoxGeometry(legX * 2 + 0.2, 0.14, 0.14), steel);
  beam.position.set(0, legH, 0);
  g.add(beam);

  // frame + emissive ad panel
  const frame = new THREE.Mesh(new THREE.BoxGeometry(panelW + 0.3, panelH + 0.3, 0.15), steel);
  frame.position.set(0, legH + panelH / 2, 0);
  g.add(frame);

  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(panelW, panelH),
    new THREE.MeshStandardMaterial({
      color: 0x0a0a0e,
      emissive: 0xffffff,
      emissiveMap: billboardAd(rand, neon),
      emissiveIntensity: 0.65,
      side: THREE.DoubleSide,
      flatShading: true,
    })
  );
  panel.position.set(0, legH + panelH / 2, 0.09);
  g.add(panel);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

// --- rooftop water tower -----------------------------------------------------

/** The iconic NYC wooden water tower: a hooped cylindrical tank with a conical
 *  lid on a short splayed-leg frame with cross-bracing. ~4 units. Placed at
 *  ground level, it still reads as the motif. */
export function makeWaterTower(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95, metalness: 0, flatShading: true });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x4e3620, roughness: 0.95, metalness: 0, flatShading: true });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f5a, metalness: 0.6, roughness: 0.5, flatShading: true });

  const legH = 1.5;
  const tankR = 0.95 + rand() * 0.25;
  const tankH = 1.6;
  const legTopR = tankR * 0.62;
  const legBotR = tankR * 0.62 + 0.7;

  // four splayed legs (base out, top in) + a bracing ring
  const n = 4;
  const tops: THREE.Vector3[] = [];
  const mids: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 4;
    const top = new THREE.Vector3(Math.cos(a) * legTopR, legH, Math.sin(a) * legTopR);
    const bot = new THREE.Vector3(Math.cos(a) * legBotR, 0, Math.sin(a) * legBotR);
    tops.push(top);
    mids.push(bot.clone().lerp(top, 0.5));
    g.add(strut(bot, top, 0.09, wood));
  }
  for (let i = 0; i < n; i++) {
    g.add(strut(mids[i], mids[(i + 1) % n], 0.05, woodDark));
  }

  // platform + tank + hoops + conical lid
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(tankR * 0.95, tankR * 0.95, 0.12, 8), woodDark);
  platform.position.y = legH;
  g.add(platform);

  const tank = new THREE.Mesh(new THREE.CylinderGeometry(tankR, tankR, tankH, 10), wood);
  tank.position.y = legH + tankH / 2;
  g.add(tank);

  for (const ty of [0.22, 0.5, 0.78]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(tankR + 0.02, 0.05, 6, 14), steel);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = legH + tankH * ty;
    g.add(hoop);
  }

  const lid = new THREE.Mesh(new THREE.ConeGeometry(tankR + 0.1, 0.7, 10), woodDark);
  lid.position.y = legH + tankH + 0.35;
  g.add(lid);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}
