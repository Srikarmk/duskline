import * as THREE from "three";
import { ROAD_HALF_WIDTH } from "../constants";
import type { RealmPalette } from "../realms";

// --- arcade-racer roadside signage -----------------------------------------
//
// Bold Hotshot-Racing / SEGA-arcade style roadside billboards: big directional
// corner arrows, a floating cartoon blimp, a fork-in-the-road marker and a
// checkered corner-apex board. The engine stands each on the ground (base on
// y=0), yaws it to face the oncoming cars, and offsets some to the roadside; a
// couple (fork, blimp) sit centred. So every builder here is centred on x=0
// with its "front" (the readable face) pointing -Z, toward the approaching
// driver. The blimp is the one exception — it is centred at the origin because
// the engine lifts it high above the track and orients it freely.
//
// House style, matching objects.ts / gates.ts: faceted low-poly (flatShading,
// few segments), shared geometries/materials, and emissive reserved for thin
// accents. UnrealBloom is on and there was an over-glow complaint, so
// emissiveIntensity stays <= ~1.2 and never floods a whole prop.

/** A flat solid arrow outline lying in the XY plane, base at x=0 (centred on
 *  y=0), tip at x=len, pointing +X. Shared by the corner arrow and the two
 *  fork branches. */
function arrowShape(len: number, halfW: number, headLen: number, headHalfW: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, halfW);
  s.lineTo(len - headLen, halfW);
  s.lineTo(len - headLen, headHalfW);
  s.lineTo(len, 0);
  s.lineTo(len - headLen, -headHalfW);
  s.lineTo(len - headLen, -halfW);
  s.lineTo(0, -halfW);
  s.closePath();
  return s;
}

/**
 * makeArrowSign — a BIG bold corner-direction billboard (the red arrow signs in
 * Hotshot Racing). A ~4m x 2.6m board raised on two sturdy posts so its centre
 * sits ~3.3m up, carrying a fat unmistakable arrow. `dir > 0` points RIGHT,
 * `dir < 0` points LEFT (one arrow built, mirrored via scale.x). Bright red
 * board + white arrow, thin emissive rim so it reads at dusk. Fits its own
 * roadside footprint (|x| < 2.5).
 */
export function makeArrowSign(dir: number, pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();
  const accent = new THREE.Color(pal.rumbleB);

  const boardW = ROAD_HALF_WIDTH * 0.8; // ~4.0
  const boardH = 2.6;
  const boardD = 0.32;
  const boardCY = 3.3; // board centre height

  // --- posts + feet (two sturdy uprights, well inside |x| < 2.5) ----------
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.7, roughness: 0.4, flatShading: true });
  const postGeo = new THREE.BoxGeometry(0.34, 2.2, 0.34);
  const footGeo = new THREE.BoxGeometry(0.7, 0.3, 0.7);
  const postX = boardW / 2 - 0.6; // ~1.4
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(sx * postX, 1.1, 0); // base y=0, top ~2.2 (into the board)
    g.add(post);
    const foot = new THREE.Mesh(footGeo, postMat);
    foot.position.set(sx * postX, 0.15, 0);
    g.add(foot);
  }

  // --- board (thin red box, face toward -Z) -------------------------------
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(boardW, boardH, boardD),
    new THREE.MeshStandardMaterial({ color: 0xe23b3b, metalness: 0.2, roughness: 0.55, flatShading: true })
  );
  board.position.set(0, boardCY, 0);
  g.add(board);

  // --- thin emissive rim frame on the front face (dusk readability) -------
  const rimMat = new THREE.MeshStandardMaterial({
    color: accent.clone().offsetHSL(0, -0.1, 0.2), emissive: accent,
    emissiveIntensity: 1.0, metalness: 0.3, roughness: 0.35, flatShading: true,
  });
  const rimZ = -boardD / 2 - 0.04;
  const barH = new THREE.BoxGeometry(boardW + 0.04, 0.16, 0.08);
  const barV = new THREE.BoxGeometry(0.16, boardH + 0.04, 0.08);
  for (const sy of [-1, 1]) {
    const bar = new THREE.Mesh(barH, rimMat);
    bar.position.set(0, boardCY + sy * (boardH / 2 - 0.08), rimZ);
    g.add(bar);
  }
  for (const sx of [-1, 1]) {
    const bar = new THREE.Mesh(barV, rimMat);
    bar.position.set(sx * (boardW / 2 - 0.08), boardCY, rimZ);
    g.add(bar);
  }

  // --- the fat arrow, proud of the board front, mirrored for a left turn --
  const arrowGeo = new THREE.ExtrudeGeometry(
    arrowShape(3.2, 0.42, 1.3, 0.92), { depth: 0.14, bevelEnabled: false }
  );
  arrowGeo.translate(-1.55, 0, 0); // recentre so the arrow spans x ~ -1.55..1.65
  const arrow = new THREE.Mesh(
    arrowGeo,
    new THREE.MeshStandardMaterial({ color: 0xfafafa, metalness: 0.1, roughness: 0.5, flatShading: true, side: THREE.DoubleSide })
  );
  arrow.position.set(0, boardCY, -boardD / 2 - 0.14);
  arrow.scale.x = dir < 0 ? -1 : 1; // build RIGHT, mirror for LEFT
  g.add(arrow);

  return g;
}

/**
 * makeBlimp — a friendly cartoon airship (the "HOTSHOT" blimp). A faceted
 * elongated ellipsoid envelope (~14m long, ~4m diameter, long axis X), tail
 * fins, a small gondola with lit windows, cheerful colours and thin emissive
 * accents (a girth band + nose light, <= 1.2). Centred at the origin with no
 * rotation baked in — the engine lifts and orients it above the track.
 */
export function makeBlimp(pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();
  const accent = new THREE.Color(pal.rumbleB);

  // --- envelope: faceted ellipsoid ---------------------------------------
  const envGeo = new THREE.IcosahedronGeometry(2, 1);
  envGeo.scale(3.5, 1, 1); // 14 long (x) x 4 dia (y,z)
  const env = new THREE.Mesh(
    envGeo,
    new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.1, roughness: 0.6, flatShading: true })
  );
  g.add(env);

  // --- emissive nose light at the +X tip ---------------------------------
  const nose = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0xfff7ed, emissive: 0xfbbf24, emissiveIntensity: 1.1, flatShading: true })
  );
  nose.position.x = 7.05;
  g.add(nose);

  // --- two emissive girth bands (accent racing stripes) ------------------
  const bandMat = new THREE.MeshStandardMaterial({
    color: accent.clone().offsetHSL(0, -0.05, 0.15), emissive: accent,
    emissiveIntensity: 1.0, metalness: 0.3, roughness: 0.4, flatShading: true,
  });
  for (const bx of [-1.6, 1.6]) {
    const crossR = 2 * Math.sqrt(Math.max(0, 1 - (bx / 7) ** 2)); // hug the hull
    const band = new THREE.Mesh(new THREE.TorusGeometry(crossR + 0.06, 0.1, 4, 16), bandMat);
    band.rotation.y = Math.PI / 2; // ring around the X (long) axis
    band.position.x = bx;
    g.add(band);
  }

  // --- four tail fins at the -X end (flat triangles, cross arrangement) ---
  const finShape = new THREE.Shape();
  finShape.moveTo(-4.2, 0);
  finShape.lineTo(-6.7, 0);
  finShape.lineTo(-6.4, 1.9);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.18, bevelEnabled: false });
  finGeo.translate(0, 0, -0.09); // centre the thin dimension on z=0
  const finMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.1, roughness: 0.5, flatShading: true, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.rotation.x = (i * Math.PI) / 2; // top / side / bottom / side
    g.add(fin);
  }

  // --- gondola under the belly + lit windows -----------------------------
  const gond = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.8, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.5, flatShading: true })
  );
  gond.position.set(0, -2.35, 0); // top overlaps the hull bottom (~ -2)
  g.add(gond);

  const winMat = new THREE.MeshStandardMaterial({ color: 0xfff7cc, emissive: 0xfde68a, emissiveIntensity: 1.0, flatShading: true });
  const winGeo = new THREE.BoxGeometry(0.4, 0.35, 0.06);
  for (const sz of [-1, 1]) {
    for (const wx of [-0.9, 0, 0.9]) {
      const w = new THREE.Mesh(winGeo, winMat);
      w.position.set(wx, -2.35, sz * 0.56);
      g.add(w);
    }
  }

  return g;
}

/**
 * makeCheckerBoard — a small checkered corner-apex marker on a short post
 * (~1.6m tall, ~1.2m board). Classic black/white motorsport check with a thin
 * accent rim. Purely cosmetic roadside prop; faces -Z toward the oncoming car.
 */
export function makeCheckerBoard(pal: RealmPalette): THREE.Group {
  const g = new THREE.Group();
  const accent = new THREE.Color(pal.rumbleB);

  const boardW = 1.2;
  const boardH = 0.9;
  const boardD = 0.1;
  const postH = 0.8;
  const boardCY = postH + boardH / 2 - 0.1; // ~1.15, top ~1.6

  // --- short post + foot --------------------------------------------------
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.7, roughness: 0.4, flatShading: true });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, postH + 0.4, 8), postMat);
  post.position.y = (postH + 0.4) / 2; // base y=0, rises into the board
  g.add(post);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.4), postMat);
  foot.position.y = 0.07;
  g.add(foot);

  // --- checkered board (canvas texture, like the start-gantry checker) ----
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 96;
  const ctx = c.getContext("2d")!;
  const cols = 4, rows = 3;
  const cw = c.width / cols, ch = c.height / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#f5f5f5" : "#111114";
      ctx.fillRect(x * cw, y * ch, cw, ch);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(boardW, boardH, boardD),
    new THREE.MeshStandardMaterial({ map: tex, metalness: 0.1, roughness: 0.6, flatShading: true })
  );
  board.position.set(0, boardCY, 0);
  g.add(board);

  // --- thin accent rim (subtle dusk glow, sparing emissive) --------------
  const rimMat = new THREE.MeshStandardMaterial({
    color: accent.clone().offsetHSL(0, -0.1, 0.2), emissive: accent,
    emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.4, flatShading: true,
  });
  const rimZ = -boardD / 2 - 0.03;
  const barH = new THREE.BoxGeometry(boardW + 0.03, 0.08, 0.05);
  const barV = new THREE.BoxGeometry(0.08, boardH + 0.03, 0.05);
  for (const sy of [-1, 1]) {
    const bar = new THREE.Mesh(barH, rimMat);
    bar.position.set(0, boardCY + sy * (boardH / 2 - 0.04), rimZ);
    g.add(bar);
  }
  for (const sx of [-1, 1]) {
    const bar = new THREE.Mesh(barV, rimMat);
    bar.position.set(sx * (boardW / 2 - 0.04), boardCY, rimZ);
    g.add(bar);
  }

  return g;
}
