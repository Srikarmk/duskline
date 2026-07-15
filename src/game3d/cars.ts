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
    case "comet":
    default:
      // balanced GT coupe — even proportions, full greenhouse, tidy ducktail
      return buildKart(color, {
        length: 4.0, width: 1.9, ride: 0.9, wheelR: 0.54,
        wing: "duck", cabin: 0.55, mirrors: true,
      });
  }
}
