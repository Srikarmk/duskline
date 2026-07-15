import * as THREE from "three";

// -----------------------------------------------------------------------------
// New-York-City night street-circuit props. Procedural, faceted low-poly massing
// that glows against a night sky. Every group's base sits on y=0. Palette:
//   concrete #3a3f4a / #2a2e37 · brick #7a4a3a · steel #4a4f5a · glass #1a2233
//   warm window #ffd9a0 · cool window #bcd4ff · neon magenta #ff3ea5 · cyan #22d3ee
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

/** A grid of lit/unlit windows baked to a canvas, used as an emissiveMap so the
 *  facade glows at night. Windows are a cheap mix of warm, cool and dark. */
function windowFacade(rand: () => number, cols: number, rows: number): THREE.CanvasTexture {
  const cell = 10;
  const pad = 2;
  const c = document.createElement("canvas");
  c.width = Math.max(1, cols) * cell;
  c.height = Math.max(1, rows) * cell;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#070a12"; // dark spandrel between windows -> ~no emission
  ctx.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const r = rand();
      const color = r < 0.44 ? "#0a0e17" : r < 0.8 ? "#ffd9a0" : "#bcd4ff"; // off / warm / cool
      ctx.fillStyle = color;
      ctx.fillRect(x * cell + pad, y * cell + pad, cell - pad * 2, cell - pad * 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** A neon ad baked to a canvas: a saturated field with a few bright glyph-like
 *  blocks and scanlines, used as an emissiveMap so it reads as a lit billboard. */
function billboardAd(rand: () => number, neon: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#" + neon.toString(16).padStart(6, "0");
  ctx.fillRect(0, 0, 256, 128);
  // darker band suggesting a header
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, 12, 256, 26);
  // bright "logo" block + text bars
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillRect(18, 52, 44, 44);
  for (let i = 0; i < 4; i++) {
    const w = 60 + rand() * 120;
    ctx.fillRect(80, 54 + i * 14, w, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- skyscraper (the landmark) ----------------------------------------------

/** A tall setback tower: 2-3 boxy tiers of decreasing footprint, a stepped
 *  crown with an antenna + aviation beacon, and a dense grid of warm/cool lit
 *  windows. ~14-22 units — vary height/footprint/tier count per call. */
export function makeSkyscraper(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const totalH = 14 + rand() * 8; // 14 - 22
  const tierCount = 2 + Math.floor(rand() * 2); // 2 or 3
  const fracs = tierCount === 3 ? [0.48, 0.32, 0.2] : [0.62, 0.38];
  const concrete = [0x3a3f4a, 0x2a2e37];

  let footprint = 5 + rand() * 3; // 5 - 8
  let y = 0;
  for (let i = 0; i < tierCount; i++) {
    const tierH = totalH * (fracs[i] * (0.9 + rand() * 0.2));
    const w = footprint;
    const d = footprint * (0.85 + rand() * 0.3);
    const cols = Math.max(3, Math.round(w * 1.3));
    const rows = Math.max(4, Math.round(tierH * 1.3));
    const mat = new THREE.MeshStandardMaterial({
      color: concrete[i % 2],
      emissive: 0xffffff,
      emissiveMap: windowFacade(rand, cols, rows),
      emissiveIntensity: 0.85 + rand() * 0.3,
      roughness: 0.85,
      metalness: 0.15,
      flatShading: true,
    });
    const tier = new THREE.Mesh(new THREE.BoxGeometry(w, tierH, d), mat);
    tier.position.y = y + tierH / 2;
    g.add(tier);
    y += tierH;
    footprint *= 0.72 + rand() * 0.12;
  }

  // stepped crown + antenna mast + red aviation beacon
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f5a, metalness: 0.6, roughness: 0.45, flatShading: true });
  const capW = footprint * 1.05;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(capW, 0.7, capW), steel);
  cap.position.y = y + 0.35;
  g.add(cap);

  const mastH = 1.5 + rand() * 2.2;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, mastH, 6), steel);
  mast.position.y = y + 0.7 + mastH / 2;
  g.add(mast);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xff6b6b, emissive: 0xff3b3b, emissiveIntensity: 1.6, flatShading: true })
  );
  beacon.position.y = y + 0.7 + mastH;
  g.add(beacon);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

// --- brownstone row-house ----------------------------------------------------

/** A short classic brownstone: a 3-4 story brick block with a stepped stoop up
 *  to a lit doorway, an overhanging cornice, and a few warm lit windows.
 *  ~5-7 units. Front faces +z (with slight random jitter). */
export function makeBrownstone(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const stories = 3 + Math.floor(rand() * 2); // 3 or 4
  const storyH = 1.5 + rand() * 0.2;
  const h = stories * storyH;
  const w = 3.4 + rand() * 1.2;
  const d = 3.0 + rand() * 1.0;

  const brick = new THREE.MeshStandardMaterial({ color: 0x7a4a3a, roughness: 0.92, metalness: 0.05, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: 0x5a3a2e, roughness: 0.9, metalness: 0.05, flatShading: true });
  const stone = new THREE.MeshStandardMaterial({ color: 0x6b6b73, roughness: 0.9, metalness: 0.1, flatShading: true });

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), brick);
  body.position.y = h / 2;
  g.add(body);

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
    new THREE.MeshStandardMaterial({ color: 0x2a1e18, emissive: 0xffd9a0, emissiveIntensity: 0.4, flatShading: true })
  );
  door.position.set(0, stoopTop + 0.57, d / 2 + 0.03);
  g.add(door);

  // a few lit windows flanking the facade
  for (let s = 0; s < stories; s++) {
    for (const cx of [-1, 1]) {
      const lit = rand() < 0.6;
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.8, 0.08),
        new THREE.MeshStandardMaterial({
          color: 0x14202f,
          emissive: lit ? 0xffd9a0 : 0x000000,
          emissiveIntensity: lit ? 1.0 : 0,
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
 *  and a downward amber lamp head that glows warm. ~4-5 units. */
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
    new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffd27a, emissiveIntensity: 1.1, flatShading: true })
  );
  head.position.set(end.x, end.y - 0.22, 0);
  g.add(head);

  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

// --- illuminated billboard ---------------------------------------------------

/** A raised illuminated billboard on a braced steel truss: two splayed legs
 *  with X-bracing and a large emissive neon ad panel. ~5-7 units. Neon color is
 *  randomized (magenta / cyan / green / amber). */
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
      color: 0x111111,
      emissive: 0xffffff,
      emissiveMap: billboardAd(rand, neon),
      emissiveIntensity: 1.2,
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
