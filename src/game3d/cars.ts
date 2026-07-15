import * as THREE from "three";
import type { CarId } from "../game/engine";

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
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a1a2a, metalness: 0.9, roughness: 0.08,
    emissive: 0x112233, emissiveIntensity: 0.4, transparent: true, opacity: 0.85,
  });

  const { length: L, width: W, ride: H, wheelR: R } = p;

  // lower hull (wide, low) + tapered upper deck
  const lower = box(W, H, L * 0.92, bodyMat, 0, R + H * 0.2, 0);
  // bevel the lower hull slightly for a less boxy read
  lower.scale.z = 1;
  g.add(lower);
  const deck = box(W * 0.72, H * 0.7, L * 0.55, bodyMat, 0, R + H * 0.75, -L * 0.02);
  g.add(deck);

  // pointed nose cone at the front (+Z)
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(W * 0.5, L * 0.34, 4),
    bodyMat
  );
  nose.rotation.x = Math.PI / 2;      // point +Z
  nose.rotation.y = Math.PI / 4;      // square the 4-gon to the body
  nose.scale.set(1, 0.5, 1);
  nose.position.set(0, R + H * 0.25, L * 0.5);
  g.add(nose);

  // glowing chin splitter + belly light bar
  const chin = box(W * 0.9, 0.12, L * 0.3, trimMat, 0, R - H * 0.05, L * 0.34);
  g.add(chin);
  const bar = box(W * 0.5, 0.1, 0.5, trimMat, 0, R + H * 0.02, -L * 0.46);
  g.add(bar);

  // side accent strakes
  for (const sx of [-1, 1]) {
    const strake = box(0.1, H * 0.5, L * 0.6, trimMat, sx * W * 0.5, R + H * 0.4, 0);
    g.add(strake);
  }

  // cockpit canopy (glass bubble)
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(W * 0.34, 16, 12), glass);
  canopy.scale.set(1, 0.7, 1.35);
  canopy.position.set(0, R + H * 0.95, L * 0.02);
  g.add(canopy);

  // headlights
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      paint(0xfffbe6, { emissive: 0xfff2b0, ei: 1.6 })
    );
    lamp.position.set(sx * W * 0.28, R + H * 0.3, L * 0.5);
    g.add(lamp);
  }

  // roll cage / side pods on the bulky bruiser
  if (p.bulky) {
    for (const sx of [-1, 1]) {
      const pod = box(W * 0.34, H * 0.9, L * 0.5, darkMat, sx * W * 0.62, R + H * 0.5, -L * 0.05);
      g.add(pod);
      const exhaust = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.5, 8),
        paint(0x2a2a33, { metal: 0.9, rough: 0.3 })
      );
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(sx * W * 0.62, R + H * 0.9, -L * 0.5);
      g.add(exhaust);
    }
  }

  // rear wing
  if (p.wing === "low" || p.wing === "tall") {
    const wingH = p.wing === "tall" ? H * 1.7 : H * 0.9;
    const wing = box(W * 1.05, 0.12, L * 0.16, darkMat, 0, R + wingH, -L * 0.48);
    g.add(wing);
    const winglet = box(W * 1.05, 0.08, L * 0.1, trimMat, 0, R + wingH + 0.14, -L * 0.5);
    g.add(winglet);
    for (const sx of [-1, 1]) {
      const strut = box(0.12, wingH - H * 0.3, 0.12, darkMat, sx * W * 0.42, R + wingH * 0.6, -L * 0.46);
      g.add(strut);
    }
  } else if (p.wing === "fin") {
    const fin = new THREE.Mesh(
      new THREE.BufferGeometry(),
      trimMat
    );
    const w2 = W * 0.06;
    const verts = new Float32Array([
      -w2, 0, -L * 0.2, w2, 0, -L * 0.2, w2, H * 1.6, -L * 0.42,
      -w2, 0, -L * 0.2, w2, H * 1.6, -L * 0.42, -w2, H * 1.6, -L * 0.42,
    ]);
    fin.geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    fin.geometry.computeVertexNormals();
    fin.position.y = R + H * 0.4;
    g.add(fin);
  }

  // rear thruster glow
  for (const sx of [-1, 1]) {
    const thruster = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.26, 0.3, 12),
      paint(0x67e8f9, { emissive: 0x22d3ee, ei: 1.4 })
    );
    thruster.rotation.x = Math.PI / 2;
    thruster.position.set(sx * W * 0.28, R + H * 0.35, -L * 0.5);
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
