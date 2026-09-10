import * as THREE from "three";
import { pbr } from "./textures";
import { ROAD_HALF_WIDTH } from "./constants";
import type { RealmPalette } from "./realms";

// Track set-pieces: covered-corridor geometry (tunnels). Everything is built
// centred on the origin, spanning local X across the road, with the road
// running along local +Z and the base sitting on y = 0. The engine places each
// piece (position via track.pointAt) and yaws it to the track tangent, so +Z is
// always "down the road" and the arch opening lines up with the driving line.
//
// Shared opening dims (kept clear of the drivable corridor):
//   inner half-width HW_IN = ROAD_HALF_WIDTH + 1.5 = 6.5  → 13.0 wide opening
//   vertical jambs rise to LEG_TOP = 5.0 before the arch springs
//   crown (headroom at centre) CROWN_Y = 7.6
// The 10-wide road (half-width 5) passes with ~1.5 m of clearance each side.

const HW_IN = ROAD_HALF_WIDTH + 1.5; // 6.5 — inner opening half-width
const LEG_TOP = 5.0; // straight jamb height before the arch curves in
const CROWN_Y = 7.6; // inner crown height (clear headroom over the cars)
const ARC_SEGS = 8; // faceted arch resolution — low, since arches repeat a lot

// --- low-poly geometry helpers ---------------------------------------------

/** Inner + (outward-offset) outer boundary of the archway profile in the XY
 *  face plane: two vertical jambs meeting an elliptical crown. Index-aligned so
 *  the pair defines a wall of thickness `wallT`. */
function archProfile(wallT: number): { inner: THREE.Vector2[]; outer: THREE.Vector2[] } {
  const a = HW_IN;
  const bIn = CROWN_Y - LEG_TOP;
  const inner: THREE.Vector2[] = [];
  const outer: THREE.Vector2[] = [];

  // jamb foot (left)
  inner.push(new THREE.Vector2(-HW_IN, 0));
  outer.push(new THREE.Vector2(-(HW_IN + wallT), 0));

  // elliptical crown, left spring → apex → right spring
  for (let i = 0; i <= ARC_SEGS; i++) {
    const th = Math.PI * (1 - i / ARC_SEGS); // π → 0
    const x = a * Math.cos(th);
    const y = LEG_TOP + bIn * Math.sin(th);
    inner.push(new THREE.Vector2(x, y));
    // outward ellipse normal (falls back to horizontal at the springs)
    let nx = x / (a * a);
    let ny = (y - LEG_TOP) / (bIn * bIn);
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    outer.push(new THREE.Vector2(x + nx * wallT, y + ny * wallT));
  }

  // jamb foot (right)
  inner.push(new THREE.Vector2(HW_IN, 0));
  outer.push(new THREE.Vector2(HW_IN + wallT, 0));

  return { inner, outer };
}

/** A single archway ring: front + back faces, inner soffit and outer skin,
 *  extruded `depth` along Z. Faceted (non-indexed, flat normals). */
function archRingGeometry(wallT: number, depth: number): THREE.BufferGeometry {
  const { inner, outer } = archProfile(wallT);
  const z0 = -depth / 2;
  const z1 = depth / 2;
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    tri(a, b, c);
    tri(a, c, d);
  };

  for (let i = 0; i < inner.length - 1; i++) {
    const i0 = inner[i];
    const i1 = inner[i + 1];
    const o0 = outer[i];
    const o1 = outer[i + 1];
    // front face ring
    quad([i0.x, i0.y, z0], [i1.x, i1.y, z0], [o1.x, o1.y, z0], [o0.x, o0.y, z0]);
    // back face ring
    quad([o0.x, o0.y, z1], [o1.x, o1.y, z1], [i1.x, i1.y, z1], [i0.x, i0.y, z1]);
    // inner soffit (the surface the car sees passing under)
    quad([i0.x, i0.y, z0], [i0.x, i0.y, z1], [i1.x, i1.y, z1], [i1.x, i1.y, z0]);
    // outer skin
    quad([o0.x, o0.y, z1], [o0.x, o0.y, z0], [o1.x, o1.y, z0], [o1.x, o1.y, z1]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A trapezoidal prism (front/back trapezoids extruded along Z), base on y = 0
 *  and centred on X/Z. Used battered (wBottom > wTop) for buttresses and flared
 *  (wTop > wBottom) for the keystone. */
function trapezoidBlockGeometry(wBottom: number, wTop: number, height: number, depth: number): THREE.BufferGeometry {
  const bx = wBottom / 2;
  const tx = wTop / 2;
  const z0 = -depth / 2;
  const z1 = depth / 2;
  const flb = [-bx, 0, z0];
  const frb = [bx, 0, z0];
  const frt = [tx, height, z0];
  const flt = [-tx, height, z0];
  const blb = [-bx, 0, z1];
  const brb = [bx, 0, z1];
  const brt = [tx, height, z1];
  const blt = [-tx, height, z1];

  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  quad(flb, frb, frt, flt); // front
  quad(brb, blb, blt, brt); // back
  quad(blb, flb, flt, blt); // left
  quad(frb, brb, brt, frt); // right
  quad(flt, frt, brt, blt); // top
  quad(blb, brb, frb, flb); // bottom

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A glowing light strip tracing the crown + upper sides of the opening, sitting
 *  just against the soffit. It only runs above head height (y ≥ CLEAR) on the
 *  legs so nothing reaches down into the drivable corridor. This is what reads
 *  as "tunnel lighting" as the car passes under. */
function crownLightGeometry(): THREE.BufferGeometry {
  const a = HW_IN;
  const bIn = CROWN_Y - LEG_TOP;
  const delta = 0.08; // poke a hair proud of the soffit so it reads from inside
  const CLEAR = 3.2; // strip stays well above the cars on the leg sections
  const pts: THREE.Vector3[] = [];

  pts.push(new THREE.Vector3(-a + delta, CLEAR, 0));
  for (let i = 0; i <= ARC_SEGS; i++) {
    const th = Math.PI * (1 - i / ARC_SEGS);
    const x = a * Math.cos(th);
    const y = LEG_TOP + bIn * Math.sin(th);
    // inward normal (toward the opening)
    let nx = -x / (a * a);
    let ny = -(y - LEG_TOP) / (bIn * bIn);
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    pts.push(new THREE.Vector3(x + nx * delta, y + ny * delta, 0));
  }
  pts.push(new THREE.Vector3(a - delta, CLEAR, 0));

  const curve = new THREE.CatmullRomCurve3(pts, false);
  return new THREE.TubeGeometry(curve, pts.length * 3, 0.1, 4, false);
}

/** Dark realm-tinted stone/concrete for the structure body. */
function stoneColor(pal: RealmPalette, mix: number): THREE.Color {
  return new THREE.Color(pal.mountain).lerp(new THREE.Color(0x26262b), mix);
}

// --- exported builders ------------------------------------------------------

/**
 * A single tunnel ring the engine repeats every few metres to form a covered
 * corridor. Inner opening: 13.0 wide (2 × 6.5) × 7.6 tall. Shallow in Z (1.2 m)
 * so packed rings read as continuous tunnel. Dark faceted stone with a proud
 * rib on each face and a warm/realm-tinted emissive light strip along the crown.
 */
export function makeTunnelArch(pal: RealmPalette, lit = true): THREE.Group {
  const g = new THREE.Group();
  const depth = 1.2;
  const stone = stoneColor(pal, 0.5);

  // An UNLIT arch is a natural cave, so give it the real rock texture rather
  // than the palette's smooth "cement" grey — a cave should read as hewn stone.
  const rock = lit ? null : pbr()?.rock;
  const stoneMat = new THREE.MeshStandardMaterial({
    ...(rock ? { map: rock.diff, normalMap: rock.nor, roughnessMap: rock.arm ?? undefined } : {}),
    color: rock ? new THREE.Color(0x9a9a94) : stone,
    metalness: 0.1,
    roughness: 0.92,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  g.add(new THREE.Mesh(archRingGeometry(1.1, depth), stoneMat));

  // subtle structural ribbing: a lighter, shallower ring standing proud of each
  // face — successive rings then read as a ribbed vault.
  const ribMat = new THREE.MeshStandardMaterial({
    color: stone.clone().lerp(new THREE.Color(0xffffff), 0.12),
    metalness: 0.1,
    roughness: 0.9,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const ribFront = new THREE.Mesh(archRingGeometry(0.7, 0.4), ribMat);
  ribFront.position.z = -(depth / 2) - 0.1;
  g.add(ribFront);
  const ribBack = new THREE.Mesh(archRingGeometry(0.7, 0.4), ribMat);
  ribBack.position.z = depth / 2 + 0.1;
  g.add(ribBack);

  // Emissive crown light strip. Skipped when `lit` is false: a NATURAL cave has
  // no strip lighting in it, and a glowing rock roof is the kind of thing that
  // instantly breaks the illusion. Engineered road tunnels keep theirs.
  if (lit) {
    const glow = new THREE.Color(pal.rumbleB);
    const glowMat = new THREE.MeshStandardMaterial({
      color: glow.clone().lerp(new THREE.Color(0xffffff), 0.4),
      emissive: glow,
      emissiveIntensity: 0.85,
      metalness: 0,
      roughness: 0.4,
    });
    g.add(new THREE.Mesh(crownLightGeometry(), glowMat));
  }

  return g;
}

/**
 * A larger decorated entrance/exit face placed at each end of a tunnel run.
 * Bold thick portal frame around the same 13.0-wide × 7.6-tall opening, a flared
 * keystone, a cornice header, battered side buttresses, a dark recessed interior
 * lip so the mouth reads as "going in", and a pair of emissive marker lights
 * framing the mouth. Built facing down +Z with the base on y = 0.
 */
export function makeTunnelPortal(pal: RealmPalette, lit = true): THREE.Group {
  const g = new THREE.Group();
  const D = 2.6; // portal depth
  const zFront = -D / 2;
  const zBack = D / 2;
  const frameOuterX = HW_IN + 2.4; // outer edge of the thick frame jambs (8.9)

  const stone = stoneColor(pal, 0.55);
  const stoneMat = new THREE.MeshStandardMaterial({
    color: stone,
    metalness: 0.12,
    roughness: 0.92,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: stone.clone().lerp(new THREE.Color(0xffffff), 0.16),
    metalness: 0.12,
    roughness: 0.86,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x05060a),
    metalness: 0.2,
    roughness: 1,
    flatShading: true,
    side: THREE.DoubleSide,
  });

  // bold thick portal frame
  g.add(new THREE.Mesh(archRingGeometry(2.4, D), stoneMat));

  // dark recessed interior lip at the back — the mouth reads as going in
  const lip = new THREE.Mesh(archRingGeometry(0.9, 0.6), darkMat);
  lip.position.z = zBack - 0.35;
  g.add(lip);

  // battered side buttresses, each with a pyramidal cap
  for (const sx of [-1, 1]) {
    const butt = new THREE.Mesh(trapezoidBlockGeometry(3.0, 1.8, 6.4, D + 0.6), trimMat);
    butt.position.set(sx * (frameOuterX + 0.9), 0, 0);
    g.add(butt);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.6, 4), stoneMat);
    cap.rotation.y = Math.PI / 4;
    cap.position.set(sx * (frameOuterX + 0.9), 7.2, 0);
    g.add(cap);
  }

  // cornice header across the top
  const cornice = new THREE.Mesh(new THREE.BoxGeometry((frameOuterX + 2.4) * 2, 1.3, D + 0.9), trimMat);
  cornice.position.set(0, CROWN_Y + 2.6, 0);
  g.add(cornice);

  // flared keystone at the crown, protruding toward the approach (−Z)
  const key = new THREE.Mesh(trapezoidBlockGeometry(1.3, 2.2, 2.4, 1.5), trimMat);
  key.position.set(0, CROWN_Y + 0.05, zFront - 0.1);
  g.add(key);

  // Marker lights framing the mouth — engineered tunnels only. A cave mouth in
  // a forest has no beacons bolted to it.
  if (lit) {
    const glow = new THREE.Color(pal.rumbleB);
    const glowMat = new THREE.MeshStandardMaterial({
      color: glow.clone().lerp(new THREE.Color(0xffffff), 0.45),
      emissive: glow,
      emissiveIntensity: 0.9,
      metalness: 0,
      roughness: 0.4,
    });
    for (const sx of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.2, 0.4), glowMat);
      bar.position.set(sx * (HW_IN + 0.9), 3.0, zFront - 0.15);
      g.add(bar);
      const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), glowMat);
      beacon.position.set(sx * (HW_IN + 0.9), 5.4, zFront - 0.15);
      g.add(beacon);
    }
  }

  return g;
}
