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
    metalness: o.metal ?? 0.55,
    roughness: o.rough ?? 0.35,
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

/** A wheel with a glowing hubcap; axle runs along X. */
function wheel(x: number, z: number, radius: number, width: number, accent: number): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 16),
    new THREE.MeshStandardMaterial({ color: 0x0c0c16, roughness: 0.85, metalness: 0.1 })
  );
  tire.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, width + 0.05, 12),
    paint(accent, { emissive: accent, ei: 0.8, metal: 0.7, rough: 0.3 })
  );
  hub.rotation.z = Math.PI / 2;
  g.add(tire, hub);
  g.position.set(x, radius, z);
  return g;
}

interface KartParams {
  length: number;
  width: number;
  ride: number;       // hull thickness
  wheelR: number;
  wing: "low" | "tall" | "fin" | "none";
  bulky?: boolean;    // adds roll-cage / side pods
}

/**
 * Build a stylised hover-kart facing +Z (forward = +Z, matching the engine's
 * "increasing track distance" direction). `color` is the livery; a lighter
 * shade of it becomes the glowing trim so the car reads as one machine.
 */
function buildKart(color: number, p: KartParams): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Color(color);
  const accent = base.clone().offsetHSL(0, 0.05, 0.28);
  const dark = base.clone().offsetHSL(0, -0.05, -0.22);
  const accentHex = accent.getHex();

  const bodyMat = paint(base.getHex(), { metal: 0.6, rough: 0.32 });
  const darkMat = paint(dark.getHex(), { metal: 0.7, rough: 0.4 });
  const trimMat = paint(accentHex, { emissive: accentHex, ei: 0.7, metal: 0.6, rough: 0.3 });
  // real CC0 metal-plate albedo + normal (tinted by the livery colour); falls
  // back to the procedural brushed-metal map if the PBR set isn't loaded
  const lib = pbr();
  if (lib) {
    // use the real metal-plate NORMAL only (panel/scratch relief); keep the
    // bright livery colour instead of multiplying it by the dark plate albedo
    lib.metal.nor.repeat.set(1.5, 1.5);
    for (const mat of [bodyMat, darkMat, trimMat]) {
      mat.normalMap = lib.metal.nor;
      mat.normalScale = new THREE.Vector2(0.6, 0.6);
    }
  } else {
    const { map: metalMap, bump: metalBump } = metalDetail();
    for (const mat of [bodyMat, darkMat]) {
      mat.map = metalMap;
      mat.bumpMap = metalBump;
      mat.bumpScale = 0.03;
    }
    trimMat.bumpMap = metalBump;
    trimMat.bumpScale = 0.02;
  }
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a1a2a, metalness: 0.9, roughness: 0.08,
    emissive: 0x112233, emissiveIntensity: 0.4, transparent: true, opacity: 0.85,
  });

  const { length: L, width: W, ride: H, wheelR: R } = p;

  // --- smooth extruded car hull (a real car silhouette, not stacked boxes) ---
  const hl = L / 2;
  const BH = H * 1.9;      // total body height incl. cabin
  const floor = R * 0.55;  // hull sits here; lower half of the wheels shows
  const sil = new THREE.Shape();
  sil.moveTo(-hl, 0);
  sil.lineTo(hl * 0.99, 0.02);
  sil.lineTo(hl, BH * 0.36);                                    // nose tip
  sil.quadraticCurveTo(hl * 0.78, BH * 0.42, hl * 0.46, BH * 0.46); // hood
  sil.quadraticCurveTo(hl * 0.16, BH * 0.98, -hl * 0.14, BH * 0.96); // windshield → roof
  sil.lineTo(-hl * 0.56, BH * 0.88);                            // roofline
  sil.quadraticCurveTo(-hl * 0.95, BH * 0.6, -hl, BH * 0.38);   // rear glass / tail
  sil.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(sil, {
    depth: W, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.09, bevelSegments: 2, steps: 1,
  });
  hullGeo.rotateY(-Math.PI / 2);   // length(x) → +z, front points forward
  hullGeo.center();
  hullGeo.computeBoundingBox();
  hullGeo.translate(0, -hullGeo.boundingBox!.min.y, 0); // rest bottom on y=0
  // taper the width toward the top (and a touch toward the nose) so it reads as
  // a rounded car body from behind, not a constant-width slab
  {
    const pa = hullGeo.getAttribute("position");
    hullGeo.computeBoundingBox();
    const maxY = hullGeo.boundingBox!.max.y || 1;
    const maxZ = hullGeo.boundingBox!.max.z || 1;
    for (let i = 0; i < pa.count; i++) {
      const ty = Math.max(0, pa.getY(i) / maxY);
      const tz = Math.max(0, pa.getZ(i) / maxZ); // 1 at the nose
      const wScale = (1 - ty * ty * 0.5) * (1 - tz * 0.18);
      pa.setX(i, pa.getX(i) * wScale);
    }
    pa.needsUpdate = true;
    hullGeo.computeVertexNormals();
  }
  const hull = new THREE.Mesh(hullGeo, bodyMat);
  hull.position.y = floor;
  g.add(hull);

  // glowing chin splitter + rear light bar
  g.add(box(W * 0.92, 0.14, L * 0.26, trimMat, 0, floor + 0.06, hl * 0.62));
  g.add(box(W * 0.62, 0.14, 0.4, trimMat, 0, floor + BH * 0.34, -hl * 0.94));

  // side sill accent along the lower body
  for (const sx of [-1, 1]) {
    g.add(box(0.08, 0.16, L * 0.7, trimMat, sx * W * 0.5, floor + BH * 0.22, 0));
  }

  // glass windshield / greenhouse sitting on the cabin
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(W * 0.36, 18, 12), glass);
  canopy.scale.set(0.92, 0.6, 1.25);
  canopy.position.set(0, floor + BH * 0.72, hl * 0.02);
  g.add(canopy);

  // headlights
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 10, 8),
      paint(0xfffbe6, { emissive: 0xfff2b0, ei: 1.6 })
    );
    lamp.position.set(sx * W * 0.32, floor + BH * 0.28, hl * 0.92);
    g.add(lamp);
  }

  // roll cage / side pods on the bulky bruiser
  if (p.bulky) {
    for (const sx of [-1, 1]) {
      const pod = box(W * 0.32, BH * 0.55, L * 0.5, darkMat, sx * W * 0.62, floor + BH * 0.4, -L * 0.05);
      g.add(pod);
      const exhaust = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.5, 8),
        paint(0x2a2a33, { metal: 0.9, rough: 0.3 })
      );
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(sx * W * 0.62, floor + BH * 0.55, -hl * 0.98);
      g.add(exhaust);
    }
  }

  // rear wing
  if (p.wing === "low" || p.wing === "tall") {
    const wingH = p.wing === "tall" ? BH * 1.25 : BH * 0.85;
    g.add(box(W * 1.05, 0.12, L * 0.16, darkMat, 0, floor + wingH, -hl * 0.9));
    g.add(box(W * 1.05, 0.08, L * 0.1, trimMat, 0, floor + wingH + 0.14, -hl * 0.94));
    for (const sx of [-1, 1]) {
      g.add(box(0.12, wingH * 0.55, 0.12, darkMat, sx * W * 0.42, floor + wingH * 0.62, -hl * 0.86));
    }
  } else if (p.wing === "fin") {
    const fin = new THREE.Mesh(new THREE.BufferGeometry(), trimMat);
    const w2 = W * 0.06;
    const fh = BH * 1.15;
    const verts = new Float32Array([
      -w2, 0, -L * 0.15, w2, 0, -L * 0.15, w2, fh, -L * 0.42,
      -w2, 0, -L * 0.15, w2, fh, -L * 0.42, -w2, fh, -L * 0.42,
    ]);
    fin.geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    fin.geometry.computeVertexNormals();
    fin.position.y = floor + BH * 0.4;
    g.add(fin);
  }

  // rear thruster glow
  for (const sx of [-1, 1]) {
    const thruster = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.26, 0.3, 12),
      paint(0x67e8f9, { emissive: 0x22d3ee, ei: 1.4 })
    );
    thruster.rotation.x = Math.PI / 2;
    thruster.position.set(sx * W * 0.28, floor + BH * 0.28, -hl * 0.98);
    g.add(thruster);
  }

  // wheels
  const wx = W * 0.55;
  const wz = L * 0.34;
  g.add(
    wheel(-wx, wz, R, R * 0.7, accentHex),
    wheel(wx, wz, R, R * 0.7, accentHex),
    wheel(-wx, -wz, R * 1.1, R * 0.8, accentHex),
    wheel(wx, -wz, R * 1.1, R * 0.8, accentHex)
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
      return buildKart(color, { length: 4.4, width: 1.7, ride: 0.7, wheelR: 0.5, wing: "tall" });
    case "titan":
      return buildKart(color, { length: 4.2, width: 2.3, ride: 1.0, wheelR: 0.62, wing: "low", bulky: true });
    case "wisp":
      return buildKart(color, { length: 3.4, width: 1.7, ride: 0.7, wheelR: 0.52, wing: "fin" });
    case "comet":
    default:
      return buildKart(color, { length: 4.0, width: 1.9, ride: 0.85, wheelR: 0.55, wing: "low" });
  }
}
