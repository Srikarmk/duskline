import * as THREE from "three";
import { ROAD_HALF_WIDTH } from "../constants";
import type { RealmPalette } from "../realms";

// --- track-quirk gate props ------------------------------------------------
//
// Drive-through / drive-under set pieces the engine drops onto the track. They
// are built spanning local X (across the road) with local +Z as the track's
// forward direction, base on y=0; the engine centres them on x=0 and yaws them
// to the track tangent, so every one keeps the driving corridor clear:
// |x| < ~4 and the vertical opening empty from y ~0.1 up to ~3.6 so a car
// passes straight through or under.
//
// House style: faceted low-poly (flatShading, few segments), shared geometries,
// and tasteful emissive glow (UnrealBloom is on, so emissiveIntensity is kept
// <= ~1.4 and reserved for thin accents rather than flooding the whole prop).
//
// None of the three take a whole-group rotation.y: each has a forward-facing
// (the opening plane / the chevron direction) that the engine's tangent yaw
// relies on, so a random yaw would twist the gate off the track.

/** One racing lane, derived from the road half-width (~3.33m). Gate openings
 *  span roughly one lane so a driver threads them in the centre. */
const LANE_W = (ROAD_HALF_WIDTH * 2) / 3;

/** Accent hue for a decorative frame. A realm palette's trim colour is used
 *  when one is supplied; otherwise a house violet keeps the cosmetic arch
 *  distinct from the cyan boost family. */
function accentColor(pal?: RealmPalette): THREE.Color {
  return new THREE.Color(pal ? pal.rumbleB : 0xa855f7);
}

/** A flat solid arrowhead lying in the XZ plane, tip pointing +Z (forward).
 *  Shared by the boost gate's crown chevrons and the speed strip. */
function chevronGeometry(halfWidth: number, length: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, length,          // tip (forward, +Z)
    -halfWidth, 0, -length * 0.55, // back-left
    halfWidth, 0, -length * 0.55,  // back-right
  ], 3));
  g.computeVertexNormals();
  return g;
}

/**
 * makeBoostGate — a bold SPEED-BOOST RING you drive THROUGH for a burst.
 *
 * An upright faceted energy torus stands across the centre lane with a hot
 * inner rim, a couple of forward chevrons crowning it and two short posts
 * planting it in the road. Reads instantly as "drive through me for speed."
 *
 * Inner opening: ~3.6 wide x ~3.6 tall, its bottom ~0.12 above the road.
 */
export function makeBoostGate(rand: () => number): THREE.Group {
  const g = new THREE.Group();

  // ring geometry: inner opening radius 1.80 (=> ~3.6 wide/tall). radius is the
  // tube centreline, so radius = innerR + tube; centre lifted so the opening
  // bottom clears the road at ~0.12.
  const tube = 0.26;
  const innerR = 1.8;
  const radius = innerR + tube;      // 2.06
  const cy = innerR + 0.12;          // 1.92 -> opening bottom ~0.12, top ~3.72
  const outerR = radius + tube;      // 2.32

  const cyan = new THREE.Color(0x22d3ee);

  // main energy ring — faceted tube, emissive but not flooding
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 6, 24),
    new THREE.MeshStandardMaterial({
      color: 0x67e8f9, emissive: cyan,
      emissiveIntensity: 1.2 + rand() * 0.15, // <= ~1.35
      metalness: 0.4, roughness: 0.3, flatShading: true,
    })
  );
  ring.position.y = cy;
  g.add(ring);

  // hot inner rim tracing the opening edge (thin, brightest element)
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(innerR + 0.03, 0.08, 4, 24),
    new THREE.MeshStandardMaterial({
      color: 0xecfeff, emissive: 0xa5f3fc, emissiveIntensity: 1.4, flatShading: true,
    })
  );
  rim.position.y = cy;
  g.add(rim);

  // two forward chevrons crowning the gate (above the clear opening, tucked at
  // the ring crown so they never intrude the driving corridor)
  const chevGeo = chevronGeometry(0.55, 0.62);
  const chevMat = new THREE.MeshStandardMaterial({
    color: 0xecfeff, emissive: cyan, emissiveIntensity: 1.3,
    flatShading: true, side: THREE.DoubleSide,
  });
  [3.86, 4.14].forEach((y, i) => {
    const c = new THREE.Mesh(chevGeo, chevMat);
    c.position.set(0, y, 0.02 + i * 0.02);
    c.rotation.x = 0.4; // dip the front toward the approaching driver
    g.add(c);
  });

  // two short posts planting the ring in the road, flanking the opening
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.75, roughness: 0.35 });
  const glowRingMat = new THREE.MeshStandardMaterial({
    color: 0x67e8f9, emissive: cyan, emissiveIntensity: 1.1, flatShading: true,
  });
  const postX = outerR + 0.18; // ~2.5, well inside |x| < 4
  const postGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.0, 6);
  const footGeo = new THREE.BoxGeometry(0.7, 0.28, 0.7);
  for (const sx of [-1, 1]) {
    const h = 1.0 + rand() * 0.25;
    const post = new THREE.Mesh(postGeo, postMat);
    post.scale.y = h; // reuse one geo, vary height per post
    post.position.set(sx * postX, (1.0 * h) / 2, 0);
    g.add(post);
    const foot = new THREE.Mesh(footGeo, postMat);
    foot.position.set(sx * postX, 0.14, 0);
    g.add(foot);
    const glow = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 4, 12), glowRingMat);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(sx * postX, 1.0 * h - 0.08, 0);
    g.add(glow);
  }

  return g;
}

/**
 * makeSpeedStrip — a flat forward-arrow DASH strip flush with the road.
 *
 * A low ribbed panel with glowing edge lines and 3-4 bright forward chevrons —
 * a boost pad you hit for a small kick. Distinct from makeBoostGate: flat, not
 * an arch. One lane wide (~3.2), ~5 long in Z, top ~0.12.
 */
export function makeSpeedStrip(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const W = LANE_W * 0.96; // ~3.2 — just under one lane, centred on x=0
  const L = 5;

  // dark ribbed deck sitting flush with the road
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(W, 0.1, L),
    new THREE.MeshStandardMaterial({
      color: 0x13233a, metalness: 0.6, roughness: 0.4,
      emissive: 0x0891b2, emissiveIntensity: 0.18,
    })
  );
  deck.position.y = 0.05;
  g.add(deck);

  // tread ribs across the width
  const treadMat = new THREE.MeshStandardMaterial({ color: 0x2c4c6a, metalness: 0.7, roughness: 0.4 });
  const treadGeo = new THREE.BoxGeometry(W * 0.9, 0.05, 0.14);
  for (let z = -L / 2 + 0.55; z < L / 2; z += 0.72) {
    const t = new THREE.Mesh(treadGeo, treadMat);
    t.position.set(0, 0.11, z);
    g.add(t);
  }

  // glowing edge lines running the length
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1.0 + rand() * 0.2,
  });
  const edgeGeo = new THREE.BoxGeometry(0.18, 0.12, L);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(edgeGeo, edgeMat);
    e.position.set(sx * (W / 2 - 0.09), 0.12, 0);
    g.add(e);
  }

  // 3-4 bright forward chevrons flat on the deck
  const chevMat = new THREE.MeshStandardMaterial({
    color: 0x9df0ff, emissive: 0x22d3ee, emissiveIntensity: 1.3,
    flatShading: true, side: THREE.DoubleSide,
  });
  const chevGeo = chevronGeometry(W * 0.34, 0.95);
  const chevN = rand() < 0.5 ? 3 : 4;
  const span = L - 1.6;
  for (let i = 0; i < chevN; i++) {
    const t = i / (chevN - 1);
    const c = new THREE.Mesh(chevGeo, chevMat);
    c.position.set(0, 0.13, -span / 2 + t * span);
    g.add(c);
  }

  return g;
}

/**
 * makeRingArch — a decorative glowing checkpoint HOOP you pass under.
 *
 * A slim faceted frame in the realm accent spans the centre lane with two small
 * marker-light beacons perched on its crown. A lighter cosmetic sibling of
 * makeBoostGate: no chevrons, thinner frame, gentler glow.
 *
 * Inner opening: ~3.4 wide, crown ~3.8 tall, bottom ~0.14 above the road.
 */
export function makeRingArch(rand: () => number): THREE.Group {
  const g = new THREE.Group();

  const tube = 0.15;              // slim frame
  const innerR = 1.68;           // opening half-width -> ~3.36 wide
  const radius = innerR + tube;  // 1.83
  const cy = innerR + 0.14;      // 1.82 -> opening bottom ~0.14
  // outer radius (radius + tube) is ~1.98, so the crown sits near 3.8

  const accent = accentColor();

  // slim emissive frame hoop
  const frame = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 6, 24),
    new THREE.MeshStandardMaterial({
      color: accent.clone().offsetHSL(0, -0.1, 0.18), emissive: accent,
      emissiveIntensity: 1.0 + rand() * 0.15, // <= ~1.15, lighter than the boost gate
      metalness: 0.4, roughness: 0.35, flatShading: true,
    })
  );
  frame.position.y = cy;
  g.add(frame);

  // two small marker-light beacons resting on the crown shoulders, above the
  // clear opening (y > 3.6) so they stay out of the driving corridor
  const beaconGeo = new THREE.OctahedronGeometry(0.12, 0);
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xfff7ed, emissive: 0xfbbf24, emissiveIntensity: 1.3, flatShading: true,
  });
  const haloMat = new THREE.MeshStandardMaterial({
    color: 0xfde68a, emissive: 0xf59e0b, emissiveIntensity: 0.9, flatShading: true,
  });
  for (const sx of [-1, 1]) {
    const by = 3.66 + rand() * 0.12;
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.set(sx * 0.85, by, 0);
    g.add(beacon);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 3, 10), haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.set(sx * 0.85, by, 0);
    g.add(halo);
  }

  // two slim feet anchoring the hoop where its lower sides meet the road
  const footMat = new THREE.MeshStandardMaterial({ color: 0x2a2438, metalness: 0.6, roughness: 0.45 });
  const footGeo = new THREE.BoxGeometry(0.3, 0.5, 0.5);
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(footGeo, footMat);
    // the frame passes through ~x=+-1.02 at y~0.29; sit a foot under it
    foot.position.set(sx * 1.02, 0.25, 0);
    g.add(foot);
  }

  return g;
}
