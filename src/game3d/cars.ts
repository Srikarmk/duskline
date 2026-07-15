import * as THREE from "three";
import type { CarId } from "../game/engine";
import { metalDetail, pbr } from "./textures";

// A car type is a distinct hull silhouette + a set of driving stats. The livery
// color is supplied at build time (the player's pick, or an opponent's team
// color), so every type can appear in any color. Stats/metadata live in
// carData.ts (no three.js); this file only builds the meshes.
//
// Design brief: SEGA arcade-racer / Hot Shot Racing look — cars must read
// INSTANTLY as cars. That means crisp faceted low-poly bodywork with clearly
// defined features: a stepped hood + grille + bumper up front, flared wheel
// arches over every tyre, a proper greenhouse (slanted windshield, side glass,
// roof, visible A/C pillars) with a driver (helmet + shoulders) inside, sharp
// side character lines, and a clear rear (taillights, diffuser, spoiler). No
// smooth blobs — sharp edges read as "car".
export { CAR_SPECS, CAR_IDS } from "./carData";
export type { CarStat, CarStars, CarSpec } from "./carData";

// ---------------------------------------------------------------------------
// low-poly building blocks
// ---------------------------------------------------------------------------

function paint(
  color: number,
  o: { metal?: number; rough?: number; emissive?: number; ei?: number; flat?: boolean } = {}
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: o.metal ?? 0.5,
    roughness: o.rough ?? 0.4,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.ei ?? 0,
    flatShading: o.flat ?? false,
  });
}

function box(
  w: number, h: number, d: number, mat: THREE.Material,
  x = 0, y = 0, z = 0
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** A wheel: dark low-poly tyre + a subtle metallic rim (no glow). Axle along X. */
function wheel(
  x: number, z: number,
  tireGeo: THREE.BufferGeometry, rimGeo: THREE.BufferGeometry,
  tireMat: THREE.Material, rimMat: THREE.Material, radius: number
): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.rotation.z = Math.PI / 2;
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.z = Math.PI / 2;
  g.add(tire, rim);
  g.position.set(x, radius, z);
  return g;
}

/**
 * Extrude a crisp side-profile polygon (x = length, y = height, all straight
 * lines → faceted creases) across the car's width. Matches the engine's forward
 * axis: after the rotate the profile's +x end (the nose) points to +z, and the
 * width is centred on x=0. Bottom of the profile sits at the mesh's local y=0.
 */
function hullPiece(profile: [number, number][], width: number, mat: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  s.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) s.lineTo(profile[i][0], profile[i][1]);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, steps: 1 });
  geo.rotateY(-Math.PI / 2);      // length(x) → +z (nose forward)
  geo.translate(width / 2, 0, 0); // centre the width on x=0
  return new THREE.Mesh(geo, mat);
}

/**
 * A flat panel (windshield, backlight, pillar) bridging two points in the
 * side (z,y) plane at a given x. `width` is the panel's extent across X; the
 * plate is rotated so its long axis runs from (z0,y0) to (z1,y1).
 */
function panelBetween(
  x: number, z0: number, y0: number, z1: number, y1: number,
  width: number, thick: number, mat: THREE.Material
): THREE.Mesh {
  const dz = z1 - z0, dy = y1 - y0;
  const len = Math.hypot(dz, dy);
  const m = box(width, thick, len, mat, x, (y0 + y1) / 2, (z0 + z1) / 2);
  m.rotation.x = -Math.atan2(dy, dz); // +z end lands on (z1,y1)
  return m;
}

/** A faceted flared wheel arch (fender eyebrow) that frames a tyre. Axle X. */
function fenderArch(radius: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const geo = new THREE.TorusGeometry(radius * 1.12, radius * 0.17, 5, 10, Math.PI);
  geo.rotateY(Math.PI / 2);            // arch spans Z (over the tyre), peak +Y
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.x = 2.7;                     // give the fender girth (flare outward in X)
  return m;
}

/** A seated racing driver: faceted helmet + dark visor + shoulders. Origin at
 *  the seat base; helmet sits ~0.5 above it. `suit` tints the shoulders. */
function makeDriver(suit: number): THREE.Group {
  const grp = new THREE.Group();
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xededf2, metalness: 0.3, roughness: 0.45, flatShading: true });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x0b0f16, metalness: 0.9, roughness: 0.12, emissive: 0x0a0e14, emissiveIntensity: 0.15 });
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, metalness: 0.3, roughness: 0.6 });
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), helmetMat);
  helmet.position.set(0, 0.5, 0);
  const visor = box(0.2, 0.07, 0.03, visorMat, 0, 0.5, 0.14);
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.36), suitMat);
  shoulders.position.set(0, 0.24, -0.02);
  grp.add(helmet, visor, shoulders);
  return grp;
}

type Wing = "duck" | "swan" | "low" | "kart";

interface KartParams {
  length: number;
  width: number;
  ride: number;     // solid lower-body (beltline) height above the ground
  wheelR: number;
  wing: Wing;
  cabin?: number;   // greenhouse height as a fraction of the ride height
  open?: boolean;   // open cockpit (kart / formula) — no roof, driver exposed
  cage?: boolean;   // chrome roll cage over the cabin (stock car)
  scoop?: boolean;  // hood scoop (muscle car)
  bulky?: boolean;  // side pods + twin exhausts (the bruiser)
  mirrors?: boolean;
}

/**
 * Build a stylised faceted arcade race car facing +Z. The lower body is a crisp
 * stepped hull (low nose → low hood → sharp cowl → flat deck → tail drop),
 * flared fenders arch over each wheel, a narrower greenhouse carries a driver
 * under slanted glass (or open to the air), and the rear is clearly defined
 * with taillights, a diffuser and a type-appropriate spoiler. `color` is the
 * livery; darker/accent shades come from it so the machine reads as one piece.
 */
function buildKart(color: number, p: KartParams): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Color(color);
  const accent = base.clone().offsetHSL(0, 0.05, 0.26);
  const dark = base.clone().offsetHSL(0, -0.04, -0.22);
  const accentHex = accent.getHex();

  // --- shared materials -----------------------------------------------------
  const bodyMat = paint(base.getHex(), { metal: 0.5, rough: 0.4, flat: true });
  const darkMat = paint(dark.getHex(), { metal: 0.55, rough: 0.45, flat: true });
  const trimMat = paint(accentHex, { emissive: accentHex, ei: 0.4, metal: 0.6, rough: 0.3 });
  // real CC0 metal-plate normal (panel/scratch relief) tints nothing — we keep
  // the bright livery colour instead of the dark plate albedo. Falls back to the
  // procedural brushed-metal map if the PBR set isn't loaded yet.
  const lib = pbr();
  if (lib) {
    lib.metal.nor.repeat.set(1.5, 1.5);
    for (const mat of [bodyMat, darkMat, trimMat]) {
      mat.normalMap = lib.metal.nor;
      mat.normalScale = new THREE.Vector2(0.5, 0.5);
    }
  } else {
    const { map: metalMap, bump: metalBump } = metalDetail();
    for (const mat of [bodyMat, darkMat]) {
      mat.map = metalMap;
      mat.bumpMap = metalBump;
      mat.bumpScale = 0.03;
    }
  }
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a1622, metalness: 0.9, roughness: 0.1,
    emissive: 0x0a1420, emissiveIntensity: 0.22, transparent: true, opacity: 0.68,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0b12, roughness: 0.85, metalness: 0.1 });
  const rimMat = paint(accentHex, { metal: 0.9, rough: 0.25 });
  const chromeMat = paint(0x2a2a33, { metal: 0.9, rough: 0.3 });
  const grilleMat = paint(0x14141a, { metal: 0.7, rough: 0.4 });
  const headMat = paint(0xfff6d5, { emissive: 0xffe6a0, ei: 0.55 });
  const tailMat = paint(0x2a0000, { emissive: 0xff2626, ei: 0.5 });

  const { length: L, width: W, ride: H, wheelR: R } = p;
  const hl = L / 2;
  const floor = R * 0.40;                // ground clearance under the tub
  const bodyH = H * 0.60;                // solid lower body height (belt over floor)
  const cabH = H * (p.cabin ?? 0.55);    // greenhouse height above the beltline
  const beltY = floor + bodyH;           // world height of the deck / beltline
  const coreW = W * 0.78;                // body core is narrower than the fenders
  const wx = W * 0.48;                   // wheel centreline (fenders flare over it)
  const rf = R, rr = R * 1.06;           // front / rear tyre radius
  const wzF = L * 0.32, wzR = L * 0.33;  // wheel positions along the length

  // === lower body: a crisp stepped hull (all straight creases) ==============
  // Side profile (x = length, y = height): low nose face → short low hood →
  // SHARP cowl step up to the beltline → flat rear deck → tail drop. Extruded
  // at a constant (narrow) width; the fenders and cabin do the shaping, so the
  // silhouette stays sharp and unmistakably car-like rather than a smooth blob.
  const P: [number, number][] = [
    [-hl,       0],
    [ hl,       0],
    [ hl,       bodyH * 0.34],   // front bumper / nose face
    [ hl * 0.82, bodyH * 0.48],  // nose top crease
    [ hl * 0.44, bodyH * 0.48],  // end of the low flat hood
    [ hl * 0.28, bodyH * 1.00],  // cowl: sharp step up to the beltline
    [-hl * 0.46, bodyH * 1.00],  // flat rear deck
    [-hl * 0.78, bodyH * 0.88],  // tail begins to drop
    [-hl,        bodyH * 0.50],  // tail bottom crease
  ];
  const hull = hullPiece(P, coreW, bodyMat);
  hull.position.y = floor;
  g.add(hull);

  // side character line (beltline crease) + rocker sill — sharp two-tone panels
  for (const sx of [-1, 1]) {
    g.add(box(0.05, 0.05, L * 0.56, darkMat, sx * coreW * 0.5, floor + bodyH * 0.82, -L * 0.02)); // beltline crease
    if (!p.bulky) // (the bruiser's side pods take the place of a rocker)
      g.add(box(0.06, bodyH * 0.3, L * 0.5, darkMat, sx * coreW * 0.5, floor + bodyH * 0.24, -L * 0.02)); // rocker sill
  }

  // === flared wheel arches (body-colour fenders framing every tyre) =========
  for (const sx of [-1, 1]) {
    g.add(fenderArch(rf, bodyMat, sx * wx, rf, wzF));
    g.add(fenderArch(rr, bodyMat, sx * wx, rr, -wzR));
  }

  // === front end: bumper + grille + stepped hood + headlights ===============
  g.add(box(W * 0.9, bodyH * 0.34, L * 0.08, darkMat, 0, floor + bodyH * 0.2, hl * 0.97)); // bumper
  g.add(box(W * 0.42, bodyH * 0.22, 0.06, grilleMat, 0, floor + bodyH * 0.26, hl * 1.0));   // grille
  const lampGeo = new THREE.BoxGeometry(W * 0.14, 0.08, 0.05);
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(lampGeo, headMat);
    lamp.position.set(sx * W * 0.3, floor + bodyH * 0.44, hl * 0.9);
    g.add(lamp);
  }
  if (p.scoop) {
    // muscle-car hood scoop: a raised block with a dark forward intake mouth
    g.add(box(W * 0.34, bodyH * 0.2, L * 0.16, bodyMat, 0, floor + bodyH * 0.56, hl * 0.42));
    g.add(box(W * 0.28, bodyH * 0.12, 0.05, grilleMat, 0, floor + bodyH * 0.56, hl * 0.5));
  }

  // === rear end: diffuser + taillight bar + exhausts ========================
  g.add(box(W * 0.86, bodyH * 0.3, L * 0.08, darkMat, 0, floor + bodyH * 0.18, -hl * 0.96)); // rear bumper
  if (!p.bulky) // diffuser strakes (the bruiser's twin exhausts fill this space)
    for (const sx of [-1, 1])
      g.add(box(0.05, bodyH * 0.22, L * 0.1, chromeMat, sx * W * 0.2, floor + bodyH * 0.12, -hl * 0.99));
  g.add(box(W * 0.66, 0.08, 0.05, tailMat, 0, floor + bodyH * 0.56, -hl * 0.99)); // taillight bar

  // === greenhouse ===========================================================
  const wsBaseZ = hl * 0.30;                       // windshield foot (near the cowl)
  const roofFrontZ = hl * 0.30 - L * (p.open ? 0.12 : 0.18);
  const roofBackZ = -hl * 0.30;
  const backBaseZ = -hl * 0.50;                    // backlight foot on the rear deck
  const cabW = W * 0.58;
  const roofY = beltY + cabH;

  if (p.open) {
    // open cockpit: a low wraparound windscreen + an exposed driver + a roll
    // hoop behind the head. The driver sits tall and fully visible.
    g.add(panelBetween(0, wsBaseZ, beltY, wsBaseZ - L * 0.1, beltY + cabH * 0.55, cabW * 0.95, 0.03, glass));
    for (const sx of [-1, 1]) // windscreen side wings
      g.add(box(0.03, cabH * 0.3, L * 0.1, glass, sx * cabW * 0.46, beltY + cabH * 0.22, wsBaseZ - L * 0.02));
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 5, 10, Math.PI), chromeMat);
    hoop.scale.set(cabW * 0.5, cabH * 0.95, 1);
    hoop.position.set(0, beltY, roofBackZ + L * 0.04);
    g.add(hoop);
    const drv = makeDriver(dark.getHex());
    drv.position.set(0, beltY - 0.02, -L * 0.02);
    g.add(drv);
  } else {
    // closed greenhouse: slanted windshield + backlight, side glass, a roof
    // panel and body-colour A/C pillars framing the windows.
    g.add(panelBetween(0, wsBaseZ, beltY, roofFrontZ, roofY, cabW * 0.9, 0.03, glass));    // windshield
    g.add(panelBetween(0, backBaseZ, beltY, roofBackZ, roofY, cabW * 0.9, 0.03, glass));   // backlight
    g.add(box(cabW * 0.9, 0.05, roofFrontZ - roofBackZ, bodyMat, 0, roofY, (roofFrontZ + roofBackZ) / 2)); // roof
    const winMidZ = (wsBaseZ + backBaseZ) / 2;
    for (const sx of [-1, 1]) {
      // side glass (the caged stock car runs an open, netted window instead)
      if (!p.cage)
        g.add(box(0.03, cabH * 0.5, (wsBaseZ - backBaseZ) * 0.62, glass, sx * cabW * 0.5, beltY + cabH * 0.42, winMidZ));
      g.add(panelBetween(sx * cabW * 0.46, wsBaseZ, beltY, roofFrontZ, roofY, 0.07, 0.05, bodyMat)); // A-pillar
      g.add(panelBetween(sx * cabW * 0.46, backBaseZ, beltY, roofBackZ, roofY, 0.07, 0.05, bodyMat)); // C-pillar
    }
    const drv = makeDriver(dark.getHex());
    drv.position.set(0, beltY - 0.2, wsBaseZ - L * 0.18);
    g.add(drv);
  }

  // chrome roll cage over the cabin (stock car) — two hoops + side rails
  if (p.cage) {
    const cageGeo = new THREE.TorusGeometry(1, 0.045, 5, 10, Math.PI);
    for (const hz of [wsBaseZ - L * 0.04, roofBackZ]) {
      const hoop = new THREE.Mesh(cageGeo, chromeMat);
      hoop.scale.set(cabW * 0.52, cabH, 1);
      hoop.position.set(0, beltY, hz);
      g.add(hoop);
    }
    for (const sx of [-1, 1])
      g.add(box(0.05, 0.05, wsBaseZ - roofBackZ, chromeMat, sx * cabW * 0.44, roofY - 0.02, (wsBaseZ - L * 0.04 + roofBackZ) / 2));
  }

  // side mirrors (small, but they sell "this is a car")
  if (p.mirrors) {
    for (const sx of [-1, 1])
      g.add(box(0.1, 0.06, 0.1, bodyMat, sx * (cabW * 0.5 + 0.11), beltY + cabH * 0.32, wsBaseZ * 0.5));
  }

  // === type-specific spoiler ================================================
  if (p.wing === "duck") {
    // tidy ducktail lip on the rear deck (balanced GT)
    g.add(box(coreW * 0.98, 0.07, L * 0.13, darkMat, 0, beltY + 0.06, -hl * 0.78));
    for (const sx of [-1, 1])
      g.add(box(0.06, 0.14, L * 0.12, darkMat, sx * coreW * 0.48, beltY + 0.02, -hl * 0.78));
  } else if (p.wing === "low") {
    // wide, low bruiser wing on stubby end plates (stock car)
    const wy = beltY + bodyH * 0.34;
    g.add(box(W * 1.08, 0.09, L * 0.16, darkMat, 0, wy, -hl * 0.9));
    for (const sx of [-1, 1])
      g.add(box(0.1, bodyH * 0.36, L * 0.15, darkMat, sx * W * 0.5, wy - bodyH * 0.16, -hl * 0.9));
  } else if (p.wing === "swan") {
    // tall swan-neck GT wing for the top-speed car
    const wy = roofY + bodyH * 0.4;
    g.add(box(W * 1.02, 0.06, L * 0.15, darkMat, 0, wy, -hl * 0.88));
    g.add(box(W * 1.02, 0.03, L * 0.05, trimMat, 0, wy + 0.06, -hl * 0.92)); // subtle Gurney flap
    for (const sx of [-1, 1]) {
      const stalk = box(0.08, wy - beltY, 0.14, chromeMat, sx * W * 0.3, (beltY + wy) / 2, -hl * 0.8);
      stalk.rotation.x = -0.14;
      g.add(stalk);
    }
  } else if (p.wing === "kart") {
    // compact rear wing on twin low pylons (nimble kart)
    const wy = beltY + bodyH * 0.5;
    g.add(box(W * 0.9, 0.05, L * 0.12, darkMat, 0, wy, -hl * 0.86));
    for (const sx of [-1, 1])
      g.add(box(0.06, wy - beltY, 0.1, chromeMat, sx * W * 0.28, (beltY + wy) / 2, -hl * 0.82));
  }

  // === bruiser side pods + twin exhausts ====================================
  if (p.bulky) {
    const exGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.4, 10);
    for (const sx of [-1, 1]) {
      g.add(box(W * 0.2, bodyH * 0.5, L * 0.4, darkMat, sx * W * 0.55, floor + bodyH * 0.4, -L * 0.04));
      const ex = new THREE.Mesh(exGeo, chromeMat);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(sx * W * 0.42, floor + bodyH * 0.3, -hl * 0.98);
      g.add(ex);
    }
  } else {
    // twin thruster nozzles with a subtle accent glow
    const nozzleGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.2, 12);
    for (const sx of [-1, 1]) {
      const n = new THREE.Mesh(nozzleGeo, trimMat);
      n.rotation.x = Math.PI / 2;
      n.position.set(sx * W * 0.22, floor + bodyH * 0.34, -hl * 0.98);
      g.add(n);
    }
  }

  // === wheels (shared geometry per size) ====================================
  const tireGeoF = new THREE.CylinderGeometry(rf, rf, rf * 0.72, 16);
  const rimGeoF = new THREE.CylinderGeometry(rf * 0.58, rf * 0.58, rf * 0.74, 12);
  const tireGeoR = new THREE.CylinderGeometry(rr, rr, rr * 0.78, 16);
  const rimGeoR = new THREE.CylinderGeometry(rr * 0.58, rr * 0.58, rr * 0.8, 12);
  g.add(
    wheel(-wx, wzF, tireGeoF, rimGeoF, tireMat, rimMat, rf),
    wheel(wx, wzF, tireGeoF, rimGeoF, tireMat, rimMat, rf),
    wheel(-wx, -wzR, tireGeoR, rimGeoR, tireMat, rimMat, rr),
    wheel(wx, -wzR, tireGeoR, rimGeoR, tireMat, rimMat, rr)
  );

  return g;
}

// ---------------------------------------------------------------------------
// shared building blocks for the dedicated silhouette builders below
// ---------------------------------------------------------------------------

interface CarMaterials {
  base: THREE.Color;
  accent: THREE.Color;
  dark: THREE.Color;
  accentHex: number;
  bodyMat: THREE.MeshStandardMaterial;
  darkMat: THREE.MeshStandardMaterial;
  trimMat: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  tireMat: THREE.MeshStandardMaterial;
  rimMat: THREE.MeshStandardMaterial;
  chromeMat: THREE.MeshStandardMaterial;
  grilleMat: THREE.MeshStandardMaterial;
  headMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshStandardMaterial;
}

/**
 * The exact livery-derived material palette buildKart uses, factored out so the
 * four dedicated builders (formula / monster truck / ship / limo) share the same
 * faceted metal look. body/dark/trim carry the CC0 metal normal (or the
 * procedural brushed-metal fallback); glass/tyre/rim/chrome/grille/head/tail are
 * the shared arcade materials. Accent + dark shades are offset from the livery.
 */
function carMaterials(color: number): CarMaterials {
  const base = new THREE.Color(color);
  const accent = base.clone().offsetHSL(0, 0.05, 0.26);
  const dark = base.clone().offsetHSL(0, -0.04, -0.22);
  const accentHex = accent.getHex();

  const bodyMat = paint(base.getHex(), { metal: 0.5, rough: 0.4, flat: true });
  const darkMat = paint(dark.getHex(), { metal: 0.55, rough: 0.45, flat: true });
  const trimMat = paint(accentHex, { emissive: accentHex, ei: 0.4, metal: 0.6, rough: 0.3 });
  const lib = pbr();
  if (lib) {
    lib.metal.nor.repeat.set(1.5, 1.5);
    for (const mat of [bodyMat, darkMat, trimMat]) {
      mat.normalMap = lib.metal.nor;
      mat.normalScale = new THREE.Vector2(0.5, 0.5);
    }
  } else {
    const { map: metalMap, bump: metalBump } = metalDetail();
    for (const mat of [bodyMat, darkMat]) {
      mat.map = metalMap;
      mat.bumpMap = metalBump;
      mat.bumpScale = 0.03;
    }
  }
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a1622, metalness: 0.9, roughness: 0.1,
    emissive: 0x0a1420, emissiveIntensity: 0.22, transparent: true, opacity: 0.68,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0b12, roughness: 0.85, metalness: 0.1 });
  const rimMat = paint(accentHex, { metal: 0.9, rough: 0.25 });
  const chromeMat = paint(0x2a2a33, { metal: 0.9, rough: 0.3 });
  const grilleMat = paint(0x14141a, { metal: 0.7, rough: 0.4 });
  const headMat = paint(0xfff6d5, { emissive: 0xffe6a0, ei: 0.55 });
  const tailMat = paint(0x2a0000, { emissive: 0xff2626, ei: 0.5 });

  return {
    base, accent, dark, accentHex,
    bodyMat, darkMat, trimMat, glass, tireMat, rimMat, chromeMat, grilleMat, headMat, tailMat,
  };
}

/** A standard faceted road tyre (axle along X, bottom resting on y=0). `wide`
 *  scales the tread width as a fraction of the radius. */
function tyre(
  x: number, z: number, radius: number,
  tireMat: THREE.Material, rimMat: THREE.Material, wide = 0.72
): THREE.Group {
  const w = radius * wide;
  const tireGeo = new THREE.CylinderGeometry(radius, radius, w, 16);
  const rimGeo = new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, w * 1.03, 12);
  return wheel(x, z, tireGeo, rimGeo, tireMat, rimMat, radius);
}

/** An enormous knobbly monster-truck tyre: chunky faceted carcass + a raised
 *  tread band + a small hub. Bottom rests on y=0. */
function monsterWheel(
  x: number, z: number, radius: number,
  tireMat: THREE.Material, rimMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  const w = radius * 0.8;
  const carcass = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, w, 10), tireMat);
  carcass.rotation.z = Math.PI / 2;
  const tread = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.94, radius * 0.16, 5, 10), tireMat);
  tread.rotation.y = Math.PI / 2;           // ring plane faces X (the axle)
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.4, radius * 0.4, w * 1.04, 8), rimMat);
  hub.rotation.z = Math.PI / 2;
  g.add(carcass, tread, hub);
  g.position.set(x, radius, z);
  return g;
}

/** A straight suspension link / wishbone bar running out along X toward a hub. */
function suspensionArm(x0: number, x1: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
  return box(Math.abs(x1 - x0), 0.05, 0.09, mat, (x0 + x1) / 2, y, z);
}

/** A round nautical porthole (chrome ring + dark glass disc) facing out along X. */
function porthole(x: number, y: number, z: number, glass: THREE.Material, chrome: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 10), chrome);
  ring.rotation.y = Math.PI / 2;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10), glass);
  disc.rotation.z = Math.PI / 2;
  g.add(ring, disc);
  g.position.set(x, y, z);
  return g;
}

// ---------------------------------------------------------------------------
// APEX — open-wheel formula car
// ---------------------------------------------------------------------------

/** A long pointed nose, exposed slick tyres on visible wishbones, wide front &
 *  rear wings, sidepods, an airbox and a haloed open cockpit. Reads instantly
 *  as an F1 machine — no fenders anywhere, that's the signature. */
function buildFormula(color: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color);
  const { bodyMat, darkMat, trimMat, chromeMat, tireMat, rimMat, tailMat } = m;

  const L = 4.8, R = 0.42;
  const hl = L / 2;                     // 2.4
  const floor = 0.08;                   // ultra-low monocoque
  const coreW = 0.72;                   // narrow body — wheels sit outside it

  // --- monocoque tub: low & flat with a raised cockpit coaming ---
  const tub: [number, number][] = [
    [-1.9, 0.02], [1.15, 0.02], [1.15, 0.20], [0.45, 0.24],
    [0.12, 0.46], [-0.55, 0.46], [-1.15, 0.34], [-1.9, 0.22],
  ];
  const body = hullPiece(tub, coreW, bodyMat);
  body.position.y = floor;
  g.add(body);
  for (const sx of [-1, 1]) // sharp floor-edge crease
    g.add(box(0.05, 0.06, L * 0.55, darkMat, sx * coreW * 0.5, floor + 0.05, -0.1));

  // --- long pointed nose cone tapering to the front ---
  const noseGeo = new THREE.ConeGeometry(0.3, 1.5, 4);
  noseGeo.rotateY(Math.PI / 4);
  noseGeo.rotateX(Math.PI / 2);          // tip → +Z
  const nose = new THREE.Mesh(noseGeo, bodyMat);
  nose.scale.set(1, 0.6, 1);
  nose.position.set(0, floor + 0.18, 1.87);
  g.add(nose);

  // --- wide low front wing across the nose tip + endplates ---
  const fwZ = hl * 0.94;
  g.add(box(1.9, 0.04, 0.42, darkMat, 0, floor + 0.05, fwZ));
  g.add(box(1.7, 0.03, 0.26, trimMat, 0, floor + 0.12, fwZ + 0.05));      // upper flap (accent)
  for (const sx of [-1, 1])
    g.add(box(0.05, 0.34, 0.5, darkMat, sx * 0.95, floor + 0.18, fwZ));   // endplates

  // --- tall wide rear wing on twin pylons ---
  const rwY = floor + 0.9, rwZ = -hl * 0.92;
  g.add(box(1.7, 0.05, 0.5, darkMat, 0, rwY, rwZ));
  g.add(box(1.7, 0.04, 0.14, trimMat, 0, rwY + 0.12, rwZ - 0.18));        // Gurney flap (accent)
  for (const sx of [-1, 1]) {
    g.add(box(0.07, rwY - floor - 0.2, 0.16, chromeMat, sx * 0.34, (floor + 0.34 + rwY) / 2, rwZ)); // pylon
    g.add(box(0.05, 0.52, 0.5, darkMat, sx * 0.84, rwY - 0.24, rwZ));     // endplates
  }

  // --- sidepods flanking the cockpit ---
  for (const sx of [-1, 1]) {
    g.add(box(0.42, 0.34, 1.5, bodyMat, sx * 0.62, floor + 0.2, -0.3));
    g.add(box(0.16, 0.2, 0.06, tailMat, sx * 0.72, floor + 0.24, 0.42));  // pod intake mouth (glow)
  }

  // --- airbox / intake scoop rising behind the driver's head + engine-cover fin ---
  g.add(box(0.34, 0.42, 0.6, bodyMat, 0, floor + 0.48, -0.78));
  g.add(box(0.2, 0.16, 0.05, chromeMat, 0, floor + 0.6, -0.5));           // scoop mouth
  g.add(box(0.06, 0.32, 0.95, darkMat, 0, floor + 0.4, -1.2));            // shark fin

  // --- open cockpit: exposed driver + halo hoop + central strut ---
  const drv = makeDriver(m.dark.getHex());
  drv.position.set(0, floor + 0.14, -0.12);
  g.add(drv);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 5, 12, Math.PI), chromeMat);
  halo.scale.set(0.36, 0.44, 1);
  halo.position.set(0, floor + 0.4, -0.1);
  g.add(halo);
  const strut = box(0.06, 0.42, 0.06, chromeMat, 0, floor + 0.62, 0.22);
  strut.rotation.x = 0.5;
  g.add(strut);

  // --- exposed wheels on visible wishbones (front wider & further forward) ---
  const wxF = 1.0, wzF = hl * 0.72, wxR = 0.94, wzR = -hl * 0.66;
  const inner = coreW * 0.42;
  for (const sx of [-1, 1])
    for (const [wx, wz] of [[wxF, wzF], [wxR, wzR]] as const) {
      g.add(suspensionArm(sx * inner, sx * wx, floor + 0.12, wz + 0.12, chromeMat));
      g.add(suspensionArm(sx * inner, sx * wx, floor + 0.3, wz - 0.12, chromeMat));
    }
  g.add(
    tyre(-wxF, wzF, R, tireMat, rimMat, 1.0),
    tyre(wxF, wzF, R, tireMat, rimMat, 1.0),
    tyre(-wxR, wzR, R, tireMat, rimMat, 1.05),
    tyre(wxR, wzR, R, tireMat, rimMat, 1.05),
  );
  return g;
}

// ---------------------------------------------------------------------------
// GOLIATH — monster truck
// ---------------------------------------------------------------------------

/** A boxy pickup cab-and-bed lifted sky-high on four enormous knobbly tyres,
 *  with visible shocks, a roll cage, a roof light bar and big round headlights.
 *  Towers over everything else on the grid. */
function buildMonsterTruck(color: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color);
  const { bodyMat, darkMat, trimMat, glass, chromeMat, tireMat, rimMat, grilleMat, headMat, tailMat } = m;

  const L = 4.2, W = 1.8, R = 1.1;      // wheels far bigger than the ground clearance
  const hl = L / 2;                     // 2.1
  const lift = 1.15;                    // body floor lifted well up the huge tyres

  // --- ladder chassis rails + axle beams under the raised body ---
  for (const sx of [-1, 1])
    g.add(box(0.16, 0.2, L * 0.94, darkMat, sx * 0.5, lift - 0.16, 0));
  g.add(box(1.0, 0.14, 0.3, darkMat, 0, lift - 0.16, hl * 0.7));
  g.add(box(1.0, 0.14, 0.3, darkMat, 0, lift - 0.16, -hl * 0.66));

  // --- pickup body: low hood → tall cab → open bed (all sharp facets) ---
  const truck: [number, number][] = [
    [-hl, 0], [hl, 0], [hl, 0.5], [hl * 0.58, 0.62], [hl * 0.5, 0.62],
    [hl * 0.24, 1.2], [-hl * 0.12, 1.2], [-hl * 0.28, 0.66],
    [-hl * 0.95, 0.62], [-hl, 0.52],
  ];
  const body = hullPiece(truck, W, bodyMat);
  body.position.y = lift;
  g.add(body);
  for (const sx of [-1, 1]) // bed side walls
    g.add(box(0.08, 0.24, L * 0.42, darkMat, sx * W * 0.5, lift + 0.66, -hl * 0.6));

  // --- boxy cabin glass (near-upright windshield + side windows) ---
  const beltY = lift + 0.66, roofY = lift + 1.2;
  g.add(panelBetween(0, hl * 0.24, beltY, hl * 0.24, roofY, W * 0.82, 0.04, glass));
  for (const sx of [-1, 1])
    g.add(box(0.03, 0.44, L * 0.3, glass, sx * W * 0.42, beltY + 0.26, -hl * 0.02));

  // --- roll cage over the cab: two hoops + side rails ---
  const cageGeo = new THREE.TorusGeometry(1, 0.05, 5, 10, Math.PI);
  for (const hz of [hl * 0.2, -hl * 0.14]) {
    const hoop = new THREE.Mesh(cageGeo, chromeMat);
    hoop.scale.set(W * 0.46, 0.62, 1);
    hoop.position.set(0, roofY - 0.02, hz);
    g.add(hoop);
  }
  for (const sx of [-1, 1])
    g.add(box(0.05, 0.05, hl * 0.34, chromeMat, sx * W * 0.4, roofY - 0.02, hl * 0.03));

  // --- upright grille, big round headlights, roof light bar, rear lights ---
  g.add(box(W * 0.5, 0.34, 0.06, grilleMat, 0, lift + 0.28, hl * 1.0));
  const lampGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.1, 12);
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(lampGeo, headMat);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(sx * W * 0.3, lift + 0.42, hl * 0.99);
    g.add(lamp);
  }
  g.add(box(W * 0.6, 0.09, 0.05, tailMat, 0, lift + 0.9, -hl * 0.98));    // taillight bar
  g.add(box(W * 0.72, 0.12, 0.16, darkMat, 0, roofY + 0.08, hl * 0.12));  // light-bar housing
  for (const sx of [-1, 0, 1]) {
    const rl = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10), headMat);
    rl.rotation.x = Math.PI / 2;
    rl.position.set(sx * W * 0.22, roofY + 0.1, hl * 0.19);
    g.add(rl);
  }

  // --- driver in the cab ---
  const drv = makeDriver(m.dark.getHex());
  drv.position.set(0, beltY - 0.16, hl * 0.02);
  g.add(drv);

  // --- huge tyres on visible shocks (splayed shock body + a track link per hub) ---
  const wx = 1.25, wzF = hl * 0.7, wzR = -hl * 0.66;
  for (const sx of [-1, 1])
    for (const wz of [wzF, wzR]) {
      const shock = box(0.12, 0.9, 0.16, trimMat, sx * (0.5 + (wx - 0.5) / 2), lift - 0.4, wz);
      shock.rotation.z = sx * 0.5;
      g.add(shock);
      g.add(suspensionArm(sx * 0.4, sx * wx, R, wz, chromeMat));
    }
  g.add(
    monsterWheel(-wx, wzF, R, tireMat, rimMat),
    monsterWheel(wx, wzF, R, tireMat, rimMat),
    monsterWheel(-wx, wzR, R, tireMat, rimMat),
    monsterWheel(wx, wzR, R, tireMat, rimMat),
  );
  return g;
}

// ---------------------------------------------------------------------------
// CORSAIR — a car shaped like a ship
// ---------------------------------------------------------------------------

/** A boat hull as the body: a pointed raised bow, flared gunwales with a rail,
 *  a flat transom stern, a portholed deckhouse and a little masted flag —
 *  rolling on four wheels tucked under the hull skirt. Nautical but clearly a car. */
function buildShipCar(color: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color);
  const { bodyMat, darkMat, trimMat, glass, chromeMat, tireMat, rimMat, headMat, tailMat } = m;

  const L = 4.4, W = 2.0, R = 0.5;
  const hl = L / 2;                      // 2.2
  const keel = 0.12;                     // hull bottom (skirt hides the upper wheels)

  // --- the hull: transom stern, sheer rising to a raised pointed bow, low keel ---
  const hull: [number, number][] = [
    [-hl, 0.18], [-hl, 0.95],            // flat transom
    [hl * 0.35, 0.9], [hl * 0.8, 1.12],  // deck line rising toward the bow
    [hl * 1.0, 0.86],                    // raised bow top (pointed in profile)
    [hl * 0.86, 0.16],                   // bow stem down to the waterline
    [hl * 0.1, 0.0], [-hl * 0.6, 0.06],  // keel
  ];
  const body = hullPiece(hull, W * 0.9, bodyMat);
  body.position.y = keel;
  g.add(body);

  // pointed prow wedge → the bow reads as a point in plan too
  const prowGeo = new THREE.ConeGeometry(W * 0.46, 1.1, 4);
  prowGeo.rotateY(Math.PI / 4);
  prowGeo.rotateX(Math.PI / 2);
  const prow = new THREE.Mesh(prowGeo, bodyMat);
  prow.scale.set(1, 0.7, 1);
  prow.position.set(0, keel + 0.5, hl * 0.86);
  g.add(prow);

  // waterline boot stripe + gunwale rail with stanchions
  for (const sx of [-1, 1]) {
    g.add(box(0.06, 0.12, L * 0.9, trimMat, sx * W * 0.46, keel + 0.42, 0));
    g.add(box(0.08, 0.08, L * 0.86, chromeMat, sx * W * 0.45, keel + 0.98, -0.05));
    for (const rz of [hl * 0.4, 0, -hl * 0.45])
      g.add(box(0.04, 0.16, 0.04, chromeMat, sx * W * 0.45, keel + 1.06, rz));
  }
  g.add(box(W * 0.9, 0.1, 0.12, darkMat, 0, keel + 0.9, -hl * 0.99)); // transom trim

  // --- raised deckhouse / cabin with round portholes instead of a windshield ---
  const cabZ = hl * 0.05, cabY = keel + 0.95;
  g.add(box(W * 0.6, 0.55, L * 0.34, bodyMat, 0, cabY + 0.27, cabZ));
  g.add(box(W * 0.5, 0.14, L * 0.3, darkMat, 0, cabY + 0.56, cabZ));    // cabin roof cap
  for (const sx of [-1, 1]) {
    g.add(porthole(sx * W * 0.31, cabY + 0.28, cabZ + L * 0.09, glass, chromeMat));
    g.add(porthole(sx * W * 0.31, cabY + 0.28, cabZ - L * 0.09, glass, chromeMat));
  }
  g.add(box(W * 0.44, 0.2, 0.05, glass, 0, cabY + 0.32, cabZ + L * 0.17)); // forward screen

  // --- a short mast with a pennant, and bow / stern navigation lights ---
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 8), chromeMat);
  mast.position.set(0, cabY + 0.55, -hl * 0.2);
  g.add(mast);
  g.add(box(0.02, 0.24, 0.34, trimMat, 0, cabY + 0.95, -hl * 0.2 - 0.18)); // pennant
  g.add(box(0.12, 0.1, 0.08, headMat, 0, keel + 0.7, hl * 0.92));          // bow light
  g.add(box(0.12, 0.1, 0.08, tailMat, 0, keel + 0.7, -hl * 0.98));         // stern light

  // --- driver at the helm ---
  const drv = makeDriver(m.dark.getHex());
  drv.position.set(0, cabY - 0.15, cabZ - L * 0.02);
  g.add(drv);

  // --- four wheels tucked under the hull skirt ---
  const wx = 0.85, wzF = hl * 0.62, wzR = -hl * 0.6;
  g.add(
    tyre(-wx, wzF, R, tireMat, rimMat),
    tyre(wx, wzF, R, tireMat, rimMat),
    tyre(-wx, wzR, R, tireMat, rimMat),
    tyre(wx, wzR, R, tireMat, rimMat),
  );
  return g;
}

// ---------------------------------------------------------------------------
// BARON — stretch limousine
// ---------------------------------------------------------------------------

/** An extremely long, low three-box sedan: a formal upright grille, quad
 *  headlights, a hood ornament and a long greenhouse broken into a row of side
 *  windows by thin pillars, riding on six wheels (three per side). */
function buildLimo(color: number): THREE.Group {
  const g = new THREE.Group();
  const m = carMaterials(color);
  const { bodyMat, darkMat, trimMat, glass, chromeMat, tireMat, rimMat, grilleMat, headMat, tailMat } = m;

  const L = 6.8, W = 1.9, R = 0.48;      // ~1.7x a normal car
  const hl = L / 2;                      // 3.4
  const floor = R * 0.4;
  const coreW = W * 0.82;

  // --- one very long, low three-box hull (long hood, long roof, short trunk) ---
  const limo: [number, number][] = [
    [-hl, 0], [hl, 0],
    [hl, 0.34], [hl * 0.98, 0.56],        // upright grille face
    [hl * 0.62, 0.6], [hl * 0.5, 0.62],   // long flat hood
    [hl * 0.42, 0.94],                    // windshield up to the roof
    [-hl * 0.58, 0.94],                   // long flat roof
    [-hl * 0.7, 0.62],                    // backlight down to the trunk
    [-hl * 0.95, 0.6], [-hl, 0.44],       // trunk deck + rear
  ];
  const body = hullPiece(limo, coreW, bodyMat);
  body.position.y = floor;
  g.add(body);

  const beltY = floor + 0.62, roofY = floor + 0.94;
  const cabW = W * 0.62;
  for (const sx of [-1, 1]) { // chrome waistline strip + rocker sill
    g.add(box(0.05, 0.05, L * 0.82, chromeMat, sx * coreW * 0.5, beltY - 0.04, -0.1));
    g.add(box(0.06, 0.2, L * 0.8, darkMat, sx * coreW * 0.5, floor + 0.16, -0.1));
  }

  // --- long greenhouse: windshield, backlight, roof + a ROW of side windows ---
  const wsZ = hl * 0.42, bkZ = -hl * 0.58;
  g.add(panelBetween(0, wsZ, beltY, wsZ - 0.5, roofY, cabW * 0.92, 0.04, glass));
  g.add(panelBetween(0, bkZ, beltY, bkZ + 0.5, roofY, cabW * 0.92, 0.04, glass));
  g.add(box(cabW * 0.92, 0.05, (wsZ - 0.5) - (bkZ + 0.5), bodyMat, 0, roofY, ((wsZ - 0.5) + (bkZ + 0.5)) / 2)); // roof
  const glassFrontZ = wsZ - 0.55, glassBackZ = bkZ + 0.55;
  const span = glassFrontZ - glassBackZ, panes = 4;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < panes; i++) {
      const cz = glassBackZ + span * ((i + 0.5) / panes);
      g.add(box(0.03, 0.3, (span / panes) * 0.82, glass, sx * cabW * 0.5, beltY + 0.16, cz)); // pane
    }
    for (let i = 0; i <= panes; i++) {
      const pz = glassBackZ + span * (i / panes);
      g.add(box(0.05, 0.34, 0.06, bodyMat, sx * cabW * 0.5, beltY + 0.16, pz)); // pillar
    }
  }

  // --- formal front: upright grille + chrome surround + quad headlights ---
  g.add(box(W * 0.5, 0.46, 0.05, chromeMat, 0, floor + 0.34, hl * 0.99)); // grille surround
  g.add(box(W * 0.44, 0.4, 0.06, grilleMat, 0, floor + 0.34, hl * 1.0));  // grille
  const lampGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12);
  for (const sx of [-1, 1])
    for (const lz of [W * 0.26, W * 0.4]) {
      const lamp = new THREE.Mesh(lampGeo, headMat);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(sx * lz, floor + 0.42, hl * 0.97);
      g.add(lamp);
    }
  g.add(box(W * 0.9, 0.16, 0.08, darkMat, 0, floor + 0.16, hl * 0.98));   // front bumper
  g.add(box(W * 0.9, 0.16, 0.08, darkMat, 0, floor + 0.16, -hl * 0.98));  // rear bumper
  g.add(box(W * 0.66, 0.08, 0.05, tailMat, 0, floor + 0.44, -hl * 0.99)); // taillight bar

  // --- hood ornament + a little flag up front ---
  g.add(box(0.06, 0.16, 0.06, chromeMat, 0, floor + 0.64, hl * 0.9));
  g.add(box(0.02, 0.12, 0.18, trimMat, 0.03, floor + 0.78, hl * 0.87));

  // --- chauffeur up front ---
  const drv = makeDriver(m.dark.getHex());
  drv.position.set(0, beltY - 0.2, wsZ - 0.7);
  g.add(drv);

  // --- six wheels: three per side, evenly spaced along the long wheelbase ---
  const wx = W * 0.46;
  for (const sx of [-1, 1])
    for (const wz of [hl * 0.66, 0, -hl * 0.66]) {
      g.add(fenderArch(R, bodyMat, sx * wx, R, wz));
      g.add(tyre(sx * wx, wz, R, tireMat, rimMat));
    }
  return g;
}

// ---------------------------------------------------------------------------
// the roster (mesh builder)
// ---------------------------------------------------------------------------

/** Build the drivable mesh for a car type in a given livery color. */
export function makeKart(id: CarId, color: number): THREE.Group {
  switch (id) {
    case "bolt":
      // long, low, sleek top-speed racer — laid-back cabin, tall swan-neck wing
      return buildKart(color, {
        length: 4.4, width: 1.68, ride: 0.82, wheelR: 0.48,
        wing: "swan", cabin: 0.44, mirrors: true,
      });
    case "titan":
      // wide muscle / stock car — chunky, hood scoop, roll cage, twin exhausts
      return buildKart(color, {
        length: 4.2, width: 2.3, ride: 1.05, wheelR: 0.62,
        wing: "low", cabin: 0.6, cage: true, scoop: true, bulky: true,
      });
    case "wisp":
      // tiny nimble kart — open cockpit, tall exposed driver, compact wing
      return buildKart(color, {
        length: 3.4, width: 1.66, ride: 0.78, wheelR: 0.5,
        wing: "kart", cabin: 0.78, open: true,
      });
    case "apex":
      // open-wheel F1 — pointed nose, exposed slicks, front/rear wings, halo
      return buildFormula(color);
    case "goliath":
      // monster truck — boxy cab lifted sky-high on enormous knobbly tyres
      return buildMonsterTruck(color);
    case "corsair":
      // ship-car — boat hull, pointed bow, portholed deckhouse, masted pennant
      return buildShipCar(color);
    case "baron":
      // stretch limo — very long three-box body, row of side windows, six wheels
      return buildLimo(color);
    case "comet":
    default:
      // balanced GT coupe — even proportions, full greenhouse, tidy ducktail
      return buildKart(color, {
        length: 4.0, width: 1.9, ride: 0.9, wheelR: 0.54,
        wing: "duck", cabin: 0.55, mirrors: true,
      });
  }
}
