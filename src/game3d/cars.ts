import * as THREE from "three";
import type { CarId } from "../game/engine";
import { metalDetail, pbr } from "./textures";

// A car type is a distinct hull silhouette + a set of driving stats. The livery
// color is supplied at build time (the player's pick, or an opponent's team
// color), so every type can appear in any color. Stats/metadata live in
// carData.ts (no three.js); this file only builds the meshes.
export { CAR_SPECS, CAR_IDS } from "./carData";
export type { CarStat, CarStars, CarSpec } from "./carData";

// ---------------------------------------------------------------------------
// low-poly building blocks
// ---------------------------------------------------------------------------

function paint(
  color: number,
  o: { metal?: number; rough?: number; emissive?: number; ei?: number } = {}
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: o.metal ?? 0.5,
    roughness: o.rough ?? 0.4,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.ei ?? 0,
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

type Wing = "duck" | "swan" | "low" | "fin" | "none";

interface KartParams {
  length: number;
  width: number;
  ride: number;     // solid lower-body (beltline) height
  wheelR: number;
  wing: Wing;
  cabin?: number;   // greenhouse height as a fraction of the body height
  bulky?: boolean;  // side pods + twin exhausts (the bruiser)
  mirrors?: boolean;
}

/**
 * Build a stylised low-poly race car facing +Z (forward = +Z, matching the
 * engine's "increasing track distance" direction). The body is a smooth,
 * width-tapered hull (wide fenders, a narrow greenhouse) so it reads as a real
 * car from behind — not a stacked-box slab. `color` is the livery; a lighter
 * shade becomes the subtle accent trim so the machine reads as one piece.
 */
function buildKart(color: number, p: KartParams): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Color(color);
  const accent = base.clone().offsetHSL(0, 0.05, 0.26);
  const dark = base.clone().offsetHSL(0, -0.04, -0.2);
  const accentHex = accent.getHex();

  // --- shared materials -----------------------------------------------------
  const bodyMat = paint(base.getHex(), { metal: 0.5, rough: 0.4 });
  const darkMat = paint(dark.getHex(), { metal: 0.55, rough: 0.45 });
  const trimMat = paint(accentHex, { emissive: accentHex, ei: 0.5, metal: 0.6, rough: 0.3 });
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
    emissive: 0x0a1420, emissiveIntensity: 0.25, transparent: true, opacity: 0.72,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0b12, roughness: 0.85, metalness: 0.1 });
  const rimMat = paint(accentHex, { metal: 0.9, rough: 0.25 });
  const chromeMat = paint(0x2a2a33, { metal: 0.9, rough: 0.3 });
  const headMat = paint(0xfff6d5, { emissive: 0xffe6a0, ei: 0.6 });
  const tailMat = paint(0x2a0000, { emissive: 0xff2a2a, ei: 0.55 });

  const { length: L, width: W, ride: H, wheelR: R } = p;
  const hl = L / 2;
  const bodyH = H * 0.82;                  // solid lower body (beltline)
  const cabH = bodyH * (p.cabin ?? 0.62);  // greenhouse height
  const floor = R * 0.45;                  // ground clearance
  const beltY = floor + bodyH;             // world height of the deck / beltline

  // === lower body: a smooth, width-tapered hull (a car silhouette) ==========
  // Side profile (x = length, y = height): low nose → hood → cowl → flat deck →
  // tail drop. Extruded across the width, then the width is tapered by height so
  // the cross-section is a rounded car body (tucked sills, full fenders, a much
  // narrower roofline) rather than a constant-width slab.
  const sil = new THREE.Shape();
  sil.moveTo(-hl, bodyH * 0.06);
  sil.lineTo(hl * 0.97, 0);
  sil.lineTo(hl, bodyH * 0.5);                                        // low nose tip
  sil.quadraticCurveTo(hl * 0.86, bodyH * 0.66, hl * 0.5, bodyH * 0.8); // hood
  sil.quadraticCurveTo(hl * 0.3, bodyH * 0.95, hl * 0.14, bodyH);       // cowl → beltline
  sil.lineTo(-hl * 0.5, bodyH);                                         // flat rear deck
  sil.quadraticCurveTo(-hl * 0.85, bodyH * 0.92, -hl, bodyH * 0.6);     // tail
  sil.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(sil, {
    depth: W, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.1, bevelSegments: 2, steps: 1,
  });
  hullGeo.rotateY(-Math.PI / 2);   // length(x) → +z, front points forward
  hullGeo.center();
  hullGeo.computeBoundingBox();
  hullGeo.translate(0, -hullGeo.boundingBox!.min.y, 0); // rest bottom on y=0
  {
    const pa = hullGeo.getAttribute("position");
    hullGeo.computeBoundingBox();
    const maxY = hullGeo.boundingBox!.max.y || 1;
    const maxZ = hullGeo.boundingBox!.max.z || 1;
    const shoulder = 0.42; // height of the widest point (the fender line)
    for (let i = 0; i < pa.count; i++) {
      const ty = Math.min(1, Math.max(0, pa.getY(i) / maxY));
      const tz = pa.getZ(i) / maxZ;        // +1 nose … -1 tail
      let hs: number;
      if (ty <= shoulder) {
        hs = 0.8 + 0.2 * Math.sin((ty / shoulder) * Math.PI * 0.5); // tucked sills → full fenders
      } else {
        const t = (ty - shoulder) / (1 - shoulder);
        hs = 1 - 0.36 * (t * t * (3 - 2 * t));                      // roofline ~0.64 width
      }
      const nose = Math.max(0, tz), tail = Math.max(0, -tz);
      const plan = 1 - 0.2 * nose * nose - 0.07 * tail * tail;      // pointier nose, tucked tail
      pa.setX(i, pa.getX(i) * hs * plan);
    }
    pa.needsUpdate = true;
    hullGeo.computeVertexNormals();
  }
  const hull = new THREE.Mesh(hullGeo, bodyMat);
  hull.position.y = floor;
  g.add(hull);

  // === glass greenhouse: sloped windshield, roof, sloped backlight ==========
  // A faceted glass canopy, clearly narrower than the body, sitting on the deck.
  const cabW = W * 0.56;
  const cab = new THREE.Shape();
  cab.moveTo(hl * 0.32, 0);                                     // windshield base (front)
  cab.quadraticCurveTo(hl * 0.14, cabH * 0.95, -hl * 0.02, cabH); // windshield → roof
  cab.lineTo(-hl * 0.34, cabH);                                 // roof
  cab.quadraticCurveTo(-hl * 0.5, cabH * 0.62, -hl * 0.56, 0);  // backlight → deck
  cab.closePath();
  const cabGeo = new THREE.ExtrudeGeometry(cab, {
    depth: cabW, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 1, steps: 1,
  });
  cabGeo.rotateY(-Math.PI / 2);
  cabGeo.translate(cabW / 2, 0, 0); // centre the width
  const cabin = new THREE.Mesh(cabGeo, glass);
  cabin.position.y = beltY - 0.03;  // slight overlap into the deck
  g.add(cabin);

  // === paneling & aero trim =================================================
  g.add(box(W * 0.88, 0.12, L * 0.16, darkMat, 0, floor + 0.02, hl * 0.82));  // front splitter
  g.add(box(W * 0.78, 0.14, L * 0.12, darkMat, 0, floor + 0.03, -hl * 0.88)); // rear diffuser
  for (const sx of [-1, 1]) {
    // rocker/side-sill panel (subtle two-tone paneling along the lower body)
    g.add(box(0.07, bodyH * 0.34, L * 0.56, darkMat, sx * W * 0.47, floor + bodyH * 0.3, 0));
  }
  // subtle accent stripe down the hood
  g.add(box(0.12, 0.04, L * 0.24, trimMat, 0, floor + bodyH * 0.86, hl * 0.5));

  // === lights ================================================================
  const lampGeo = new THREE.BoxGeometry(W * 0.16, 0.08, 0.05);
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(lampGeo, headMat);
    lamp.position.set(sx * W * 0.3, floor + bodyH * 0.56, hl * 0.9);
    g.add(lamp);
  }
  // slim rear light bar
  g.add(box(W * 0.66, 0.08, 0.05, tailMat, 0, floor + bodyH * 0.62, -hl * 0.98));

  // side mirrors (small, but they sell "this is a car")
  if (p.mirrors) {
    for (const sx of [-1, 1]) {
      g.add(box(0.11, 0.07, 0.1, bodyMat, sx * (cabW * 0.5 + 0.13), beltY + cabH * 0.34, hl * 0.16));
    }
  }

  // === type-specific spoiler / fin ==========================================
  const deckY = beltY;
  if (p.wing === "duck") {
    // ducktail lip on the rear deck
    g.add(box(W * 0.84, 0.07, L * 0.14, darkMat, 0, deckY + 0.07, -hl * 0.78));
    for (const sx of [-1, 1])
      g.add(box(0.06, 0.16, L * 0.13, darkMat, sx * W * 0.4, deckY + 0.02, -hl * 0.78));
  } else if (p.wing === "low") {
    // wide, low bruiser wing on stubby end plates
    const wy = deckY + bodyH * 0.3;
    g.add(box(W * 1.08, 0.09, L * 0.16, darkMat, 0, wy, -hl * 0.86));
    for (const sx of [-1, 1])
      g.add(box(0.1, bodyH * 0.34, L * 0.15, darkMat, sx * W * 0.5, wy - bodyH * 0.15, -hl * 0.86));
  } else if (p.wing === "swan") {
    // tall swan-neck GT wing for the top-speed car
    const wy = deckY + cabH + bodyH * 0.32;
    g.add(box(W * 1.0, 0.06, L * 0.15, darkMat, 0, wy, -hl * 0.86));
    g.add(box(W * 1.0, 0.04, L * 0.06, trimMat, 0, wy + 0.07, -hl * 0.9)); // subtle trim edge
    for (const sx of [-1, 1]) {
      const stalk = box(0.08, wy - deckY, 0.14, chromeMat, sx * W * 0.32, deckY + (wy - deckY) / 2, -hl * 0.8);
      stalk.rotation.x = -0.16;
      g.add(stalk);
    }
  } else if (p.wing === "fin") {
    // central dorsal shark-fin for the darty compact
    const fin = new THREE.Mesh(new THREE.BufferGeometry(), bodyMat);
    const w2 = W * 0.045;
    const fh = cabH * 0.85;
    const verts = new Float32Array([
      -w2, 0, hl * 0.06, w2, 0, hl * 0.06, w2, fh, -hl * 0.4,
      -w2, 0, hl * 0.06, w2, fh, -hl * 0.4, -w2, fh, -hl * 0.4,
    ]);
    fin.geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    fin.geometry.computeVertexNormals();
    fin.position.y = beltY;
    g.add(fin);
  }

  // === bruiser side pods + twin exhausts ====================================
  if (p.bulky) {
    for (const sx of [-1, 1]) {
      g.add(box(W * 0.24, bodyH * 0.5, L * 0.42, darkMat, sx * W * 0.56, floor + bodyH * 0.4, -L * 0.04));
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.4, 10), chromeMat);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(sx * W * 0.5, floor + bodyH * 0.35, -hl * 0.98);
      g.add(ex);
    }
  } else {
    // small twin thruster nozzles with a subtle accent glow
    const nozzleGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.22, 12);
    for (const sx of [-1, 1]) {
      const n = new THREE.Mesh(nozzleGeo, trimMat);
      n.rotation.x = Math.PI / 2;
      n.position.set(sx * W * 0.24, floor + bodyH * 0.4, -hl * 0.96);
      g.add(n);
    }
  }

  // === wheels (shared geometry per size) ====================================
  const rf = R, rr = R * 1.08;
  const tireGeoF = new THREE.CylinderGeometry(rf, rf, rf * 0.72, 16);
  const rimGeoF = new THREE.CylinderGeometry(rf * 0.58, rf * 0.58, rf * 0.74, 12);
  const tireGeoR = new THREE.CylinderGeometry(rr, rr, rr * 0.78, 16);
  const rimGeoR = new THREE.CylinderGeometry(rr * 0.58, rr * 0.58, rr * 0.8, 12);
  const wx = W * 0.52;
  const wzF = L * 0.32, wzR = L * 0.33;
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
      // long, low, sleek — pointed nose, sunk cabin, tall swan-neck GT wing
      return buildKart(color, {
        length: 4.4, width: 1.68, ride: 0.82, wheelR: 0.48,
        wing: "swan", cabin: 0.5, mirrors: true,
      });
    case "titan":
      // short, very wide bruiser — chunky, side pods, twin exhausts, low wing
      return buildKart(color, {
        length: 4.2, width: 2.3, ride: 1.05, wheelR: 0.62,
        wing: "low", cabin: 0.6, bulky: true,
      });
    case "wisp":
      // tiny, tall bubble-canopy compact with a central dorsal fin
      return buildKart(color, {
        length: 3.4, width: 1.66, ride: 0.78, wheelR: 0.5,
        wing: "fin", cabin: 0.9, mirrors: true,
      });
    case "comet":
    default:
      // balanced sports car — even proportions, tidy ducktail spoiler
      return buildKart(color, {
        length: 4.0, width: 1.9, ride: 0.9, wheelR: 0.54,
        wing: "duck", cabin: 0.62, mirrors: true,
      });
  }
}
