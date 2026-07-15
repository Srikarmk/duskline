import * as THREE from "three";
import type { RealmPalette } from "../realms";
import { ROAD_HALF_WIDTH } from "../constants";

// --- track-fork props ------------------------------------------------------
//
// A Mario-Kart-style split: the road (2 * ROAD_HALF_WIDTH = 10m wide) forks
// around a raised central island into a LEFT route and a RIGHT route that
// rejoin further on. These pieces build that island.
//
// Both builders are made spanning local X (across the road) with local +Z as
// the track's forward direction and base on y=0; the engine centres them on
// x=0 and yaws/pitches them to the track tangent, so neither takes a
// whole-group rotation.y. Everything stays in the middle of the road
// (|x| < ~1.2) so a car has a clear lane down the LEFT route (x in [-4,-1.4])
// and the RIGHT route (x in [1.4,4]) either side of the divider.
//
// House style: faceted low-poly (flatShading, few segments), shared
// geometries/materials, and tasteful emissive accents. UnrealBloom is on, so
// emissiveIntensity is kept low (<= ~1.3) and reserved for thin bright lines
// rather than flooding the whole prop.

/** The tiled median is one SEG-long segment; the engine repeats it end-to-end. */
const SEG_LEN = 4;

/** Realm accent for the bright emissive lines. `gem` is each realm's brightest
 *  pickup hue, so it reads as a lit accent against the dark divider body. */
function accentColor(pal: RealmPalette): THREE.Color {
  return new THREE.Color(pal.gem);
}

/**
 * Extrude a closed 2D cross-section (list of [x,y] points around the perimeter,
 * in order) along Z from -halfLen..+halfLen. Produces the swept side walls plus
 * flat end caps (convex fan). flatShading + DoubleSide means facet lighting is
 * correct regardless of winding, and the flat Z-end caps butt cleanly against a
 * tiled copy. Returns a non-indexed geometry ready for flat shading.
 */
function extrudePrism(profile: [number, number][], halfLen: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const n = profile.length;
  const zf = halfLen;
  const zb = -halfLen;

  // swept side walls: one quad per profile edge
  for (let i = 0; i < n; i++) {
    const [x0, y0] = profile[i];
    const [x1, y1] = profile[(i + 1) % n];
    pos.push(x0, y0, zb, x1, y1, zb, x1, y1, zf);
    pos.push(x0, y0, zb, x1, y1, zf, x0, y0, zf);
  }
  // end caps (convex polygon fan from vertex 0)
  for (let i = 1; i < n - 1; i++) {
    const a = profile[0];
    const b = profile[i];
    const c = profile[i + 1];
    pos.push(a[0], a[1], zf, b[0], b[1], zf, c[0], c[1], zf); // front (+Z)
    pos.push(a[0], a[1], zb, c[0], c[1], zb, b[0], b[1], zb); // back (-Z)
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * makeSplitMedian — ONE ~4m segment of the raised central divider the engine
 * tiles down the middle of a fork. A kerb-like chamfered barrier, 2.2m wide
 * (x in [-1.1, 1.1]) and 0.5m tall, sitting on y=0, with a thin bright
 * emissive accent line running the full length along its top (plus two dimmer
 * shoulder rails). The chamfered sides read as a racing kerb; the flat vertical
 * Z-ends butt cleanly against the next tile. This is the barrier that forces
 * you to commit to the LEFT or RIGHT route.
 */
export function makeSplitMedian(pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();
  const half = SEG_LEN / 2; // 2 -> segment spans z in [-2, 2]

  // kerb cross-section (perimeter order): flat 2.2m base, near-vertical curb
  // faces, sloped shoulders, flat chamfered top at y=0.5.
  const profile: [number, number][] = [
    [-1.1, 0.0],
    [-1.1, 0.14],
    [-0.92, 0.36],
    [-0.7, 0.5],
    [0.7, 0.5],
    [0.92, 0.36],
    [1.1, 0.14],
    [1.1, 0.0],
  ];

  const accent = accentColor(pal);

  // solid divider body — dark, tied to the realm road, faint accent underglow
  const body = new THREE.Mesh(
    extrudePrism(profile, half),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(pal.roadDark),
      emissive: accent,
      emissiveIntensity: 0.06,
      metalness: 0.25,
      roughness: 0.7,
      flatShading: true,
      side: THREE.DoubleSide,
    })
  );
  g.add(body);

  // bright emissive accent line along the top ridge, full length (tileable)
  const topLine = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.06, SEG_LEN),
    new THREE.MeshStandardMaterial({
      color: accent.clone().offsetHSL(0, -0.15, 0.28),
      emissive: accent,
      emissiveIntensity: 1.1,
      flatShading: true,
    })
  );
  topLine.position.set(0, 0.5, 0);
  g.add(topLine);

  // two dimmer shoulder rails tracing the chamfer edges (shared geo)
  const railGeo = new THREE.BoxGeometry(0.07, 0.05, SEG_LEN);
  const railMat = new THREE.MeshStandardMaterial({
    color: accent.clone().offsetHSL(0, -0.2, 0.1),
    emissive: accent,
    emissiveIntensity: 0.5,
    flatShading: true,
  });
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(sx * 0.69, 0.5, 0);
    g.add(rail);
  }

  return g;
}

/**
 * makeForkSign — the entrance marker at the MOUTH of a split, facing the
 * oncoming car (which approaches from -Z). A low rounded nose/pylon splits the
 * road down the middle, and a short post above carries a sign board with two
 * diverging arrows (one LEFT, one RIGHT) so it reads instantly as
 * "road splits — pick a side."
 *
 * Everything stays within |x| < 1.2 and under ~2.4m tall, clear of both routes.
 */
export function makeForkSign(pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();
  const accent = accentColor(pal);
  // keep it comfortably inside the island footprint (road is ROAD_HALF_WIDTH wide each side)
  const HALF_X = Math.min(1.1, ROAD_HALF_WIDTH * 0.22);

  // --- low rounded nose: a faceted cone laid on its side, apex pointing back
  // toward the oncoming car (-Z), flattened so it reads as a road island tip.
  const noseR = HALF_X * 0.82; // ~0.9 -> within |x| < 1.2
  const noseH = 2.2;
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(noseR, noseH, 6),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(pal.roadDark),
      emissive: accent,
      emissiveIntensity: 0.08,
      metalness: 0.3,
      roughness: 0.65,
      flatShading: true,
    })
  );
  nose.rotation.x = -Math.PI / 2; // apex -> -Z
  nose.scale.y = 0.45; // flatten it low
  nose.position.y = noseR * 0.45; // rest the flattened base on y=0
  g.add(nose);

  // bright emissive ridge line down the top of the nose, drawing the eye
  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.05, noseH * 0.8),
    new THREE.MeshStandardMaterial({
      color: accent.clone().offsetHSL(0, -0.15, 0.28),
      emissive: accent,
      emissiveIntensity: 1.15,
      flatShading: true,
    })
  );
  ridge.position.set(0, noseR * 0.45 + noseR * 0.45 + 0.02, 0.1);
  g.add(ridge);

  // --- short post carrying the sign, planted on the island behind the tip
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.7,
    roughness: 0.4,
    flatShading: true,
  });
  const postH = 1.6;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, postH, 6), postMat);
  post.position.set(0, postH / 2, 0.3);
  g.add(post);

  // --- sign board: a dark plate the two arrows sit on, facing the driver (-Z)
  const boardW = HALF_X * 2 * 0.9; // ~2.0 -> corners at |x| ~1.0
  const boardMat = new THREE.MeshStandardMaterial({
    color: 0x141a2a,
    emissive: accent,
    emissiveIntensity: 0.1,
    metalness: 0.4,
    roughness: 0.5,
    flatShading: true,
  });
  const boardY = 2.02;
  const boardZ = 0.3;
  const board = new THREE.Mesh(new THREE.BoxGeometry(boardW, 0.72, 0.12), boardMat);
  board.position.set(0, boardY, boardZ);
  g.add(board);

  // two bright diverging arrowheads on the board's front face (-Z side): a
  // right-pointing arrow on the right half, a left-pointing one on the left.
  // Shared triangle geometry, mirrored via scale.x for the left arrow.
  const aLen = 0.52;
  const aH = 0.26;
  const arrowGeo = new THREE.BufferGeometry();
  arrowGeo.setAttribute("position", new THREE.Float32BufferAttribute([
    aLen, 0, 0,   // tip (+X, outward)
    0, aH, 0,     // back-top
    0, -aH, 0,    // back-bottom
  ], 3));
  arrowGeo.computeVertexNormals();
  const arrowMat = new THREE.MeshStandardMaterial({
    color: accent.clone().offsetHSL(0, -0.1, 0.3),
    emissive: accent,
    emissiveIntensity: 1.25,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const frontZ = boardZ - 0.06 - 0.03; // just in front of the board face
  for (const sx of [-1, 1]) {
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.scale.x = sx; // mirror to point outward on each side
    arrow.position.set(sx * 0.3, boardY, frontZ);
    g.add(arrow);
  }

  return g;
}
