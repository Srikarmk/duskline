import * as THREE from "three";
import { ROAD_HALF_WIDTH } from "./constants";
import { asphaltBump, pbr, tileSet } from "./textures";
import { TRACK_SCALE } from "./constants";
import type { RealmPalette } from "./realms";

/** Per-realm road surface: roughness / metalness / env-reflection strength. */
export type RoadFinish = "wet" | "gloss" | "ice" | "matte" | "dusty";
const ROAD_FINISH: Record<RoadFinish, { rough: number; metal: number; env: number }> = {
  wet:   { rough: 0.26, metal: 0.18, env: 2.4 }, // rain-slick neon streets, mirror-ish
  ice:   { rough: 0.34, metal: 0.16, env: 2.2 }, // glassy frozen sheen
  gloss: { rough: 0.5,  metal: 0.12, env: 1.7 }, // damp, polished asphalt
  matte: { rough: 0.66, metal: 0.08, env: 1.1 }, // dry volcanic rock, low sheen
  dusty: { rough: 0.82, metal: 0.05, env: 0.6 }, // sun-baked desert, no shine
};

const TEX_TILE_METERS = 10;
const VERGE_WIDTH = 18; // grass bank from road edge out to flat ground
// The CatmullRom curve can undershoot below its control points in dips; keep the
// road surface above this floor so the flat ground plane never pokes through it.
const GROUND_FLOOR = 0.35;
// banking: the road tilts INTO corners (velodrome-style). Bank angle is the
// smoothed signed curvature scaled by BANK_K, capped at MAX_BANK.
const BANK_K = 11;
const MAX_BANK = 0.28; // ~16° — gentle lean; the road is lifted into a berm so
                       // the inner edge never dips below the ground (no sinking)
const BANK_EDGE = ROAD_HALF_WIDTH * 1.25; // road half-width used for the berm lift

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface XZ {
  x: number;
  z: number;
}

export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private curvatures: number[];
  private banks: number[] = [];
  private banked: boolean;
  private samples: number;
  // stored centreline samples (world x,z + arc distance) for project()
  private cx: number[] = [];
  private cz: number[] = [];
  private cd: number[] = [];

  constructor(controlPoints: [number, number, number][], banked = true, hillScale = 1) {
    this.banked = banked;
    // LAP LENGTH. Scaling the control points outward in X/Z stretches the whole
    // circuit while preserving its shape, corner sequence and elevation, so every
    // realm gets proportionally longer without any hand-retuning. Everything
    // downstream (scenery bands, pickups, terrain samples, the minimap) is
    // expressed per-metre of arc length, so it all follows automatically.
    // Y is left alone: scaling height too would turn the hills into cliffs.
    // HILLS. The authored control points only vary ~6 m of height across a whole
    // lap, which is why the circuits felt dead flat. Rather than re-author every
    // realm's elevation by hand, layer a smooth two-octave hill profile on top.
    // It's driven by the point's fraction AROUND THE LOOP and built only from
    // whole-number sine harmonics, so it is exactly periodic — the last point
    // meets the first at the same height with the same slope, and the closed
    // curve never gets a step or a kink at the seam. Amplitudes stay modest
    // because grade, not height, is what launches a car: ~9 m over the ~50 m
    // between control points is a drivable roll, not a ramp.
    const N = controlPoints.length;
    const pts = controlPoints.map(([x, y, z], i) => {
      const u = (i / N) * Math.PI * 2;
      // hillScale lets a realm opt out: a causeway has to stay near sea level,
      // because the ocean is one flat plane — a road that climbs 17 m over a lap
      // is a clifftop for half of it, and the water stops reading as adjacent.
      const hill = (Math.sin(u * 2) * 6.5 + Math.sin(u * 3 + 1.1) * 3.0) * hillScale;
      return new THREE.Vector3(x * TRACK_SCALE, y + hill, z * TRACK_SCALE);
    });
    this.curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
    this.curve.arcLengthDivisions = 2000;
    this.length = this.curve.getLength();

    // precompute signed curvature (rad per meter) at regular intervals
    this.samples = 1024;
    this.curvatures = [];
    const delta = 2;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.samples; i++) {
      const d = (i / this.samples) * this.length;
      const t0 = this.curve.getTangentAt(this.wrap(d - delta) / this.length);
      const t1 = this.curve.getTangentAt(this.wrap(d + delta) / this.length);
      const angle = Math.atan2(
        t0.x * t1.z - t0.z * t1.x,
        t0.x * t1.x + t0.z * t1.z
      );
      this.curvatures.push(angle / (2 * delta));
      const p = this.curve.getPointAt(this.wrap(d) / this.length);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      this.cx.push(p.x); this.cz.push(p.z); this.cd.push(d);
    }
    this.bounds = { minX, maxX, minZ, maxZ };

    // precompute a smoothed bank per sample from the signed curvature, so the
    // road leans into corners without jitter (ground realms only)
    this.banks = new Array(this.samples).fill(0);
    if (banked) {
      const win = 7;
      for (let i = 0; i < this.samples; i++) {
        let sum = 0;
        for (let j = -win; j <= win; j++) {
          sum += this.curvatures[((i + j) % this.samples + this.samples) % this.samples];
        }
        const c = sum / (2 * win + 1);
        this.banks[i] = clampN(c * BANK_K, -MAX_BANK, MAX_BANK);
      }
    }
  }

  /** Bank (roll) angle in radians at a distance — 0 on unbanked (void) tracks. */
  bankAt(dist: number): number {
    if (!this.banked) return 0;
    const i = Math.floor((this.wrap(dist) / this.length) * this.samples) % this.samples;
    return this.banks[i];
  }

  wrap(dist: number) {
    return ((dist % this.length) + this.length) % this.length;
  }

  /** Project a world (x,z) onto the centreline. Returns the arc distance of the
   *  nearest point and the signed lateral offset in METRES.
   *
   *  The sign convention MATCHES `pointAt(dist, lateral)` — i.e. projecting the
   *  point `pointAt(d, L)` gives back `lateral === L`. That round-trip matters:
   *  everything in the world (entities, AI lanes, mines) is PLACED with pointAt,
   *  while the car's position is MEASURED with project, and the two are compared
   *  against each other constantly (pickups, monster homing, rival gaps). The raw
   *  cross-product below is the opposite handedness to pointAt's right-vector, so
   *  it is negated here to keep the two in agreement. */
  project(x: number, z: number): { dist: number; lateral: number } {
    const n = this.samples;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = x - this.cx[i], dz = z - this.cz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; bi = i; }
    }
    let best = { dist: this.cd[bi], lateral: 0, d2: Infinity };
    const segs = [[(bi - 1 + n) % n, bi], [bi, (bi + 1) % n]];
    for (const [a, b] of segs) {
      const ax = this.cx[a], az = this.cz[a];
      const sx = this.cx[b] - ax, sz = this.cz[b] - az;
      const segLen2 = sx * sx + sz * sz || 1;
      const t = clampN(((x - ax) * sx + (z - az) * sz) / segLen2, 0, 1);
      const px = ax + sx * t, pz = az + sz * t;
      const dx = x - px, dz = z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < best.d2) {
        let da = this.cd[a], db = this.cd[b];
        if (db < da) db += this.length; // seam wrap
        const invLen = 1 / Math.sqrt(segLen2);
        best = { dist: this.wrap(da + (db - da) * t), lateral: (sx * dz - sz * dx) * invLen, d2 };
      }
    }
    return { dist: best.dist, lateral: best.lateral };
  }

  pointAt(dist: number, lateral = 0, out = new THREE.Vector3(), flat = false) {
    const t = this.wrap(dist) / this.length;
    const p = this.curve.getPointAt(t, out);
    if (p.y < GROUND_FLOOR) p.y = GROUND_FLOOR;
    const bank = flat ? 0 : this.bankAt(dist);
    if (bank !== 0) {
      // lift the whole cross-section so a banked corner reads as a raised berm
      // whose INNER edge stays at road level — otherwise the inner edge (and the
      // car on it) drops below the flat ground plane and sinks through it.
      p.y += BANK_EDGE * Math.abs(Math.sin(bank));
    }
    if (lateral !== 0) {
      const tan = this.curve.getTangentAt(t);
      // road "right" vector, rotated around the tangent by the bank so the
      // cross-section tilts (outer edge lifts). `flat` skips it (roadside scenery
      // must stay on the ground, not ride up the banked plane).
      let rx = -tan.z, ry = 0, rz = tan.x;
      if (bank !== 0) {
        const c = Math.cos(bank), s = Math.sin(bank);
        const ux = tan.y * rz - tan.z * ry;
        const uy = tan.z * rx - tan.x * rz;
        const uz = tan.x * ry - tan.y * rx;
        rx = rx * c + ux * s; ry = ry * c + uy * s; rz = rz * c + uz * s;
      }
      p.x += rx * lateral;
      p.y += ry * lateral;
      p.z += rz * lateral;
    }
    return p;
  }

  tangentAt(dist: number, out = new THREE.Vector3()) {
    return this.curve.getTangentAt(this.wrap(dist) / this.length, out);
  }

  curvatureAt(dist: number) {
    const i = Math.floor((this.wrap(dist) / this.length) * this.samples) % this.samples;
    return this.curvatures[i];
  }

  /** XZ polyline of the track centerline, for the minimap. */
  sampleXZ(n: number): XZ[] {
    const pts: XZ[] = [];
    for (let i = 0; i < n; i++) {
      const p = this.curve.getPointAt(i / n);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  }

  buildRoadMesh(texture: THREE.Texture, finish: RoadFinish = "gloss"): THREE.Mesh {
    const step = 2;
    const count = Math.ceil(this.length / step);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const edge = ROAD_HALF_WIDTH * 1.25;

    for (let i = 0; i <= count; i++) {
      const d = (i / count) * this.length;
      const t = this.wrap(d) / this.length;
      const p = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t);
      // banked road "right" vector (tilts the ribbon into corners)
      let rx = -tan.z, ry = 0, rz = tan.x;
      const bank = this.bankAt(d);
      if (bank !== 0) {
        const c = Math.cos(bank), s = Math.sin(bank);
        const ux = tan.y * rz - tan.z * ry;
        const uy = tan.z * rx - tan.x * rz;
        const uz = tan.x * ry - tan.y * rx;
        rx = rx * c + ux * s; ry = ry * c + uy * s; rz = rz * c + uz * s;
      }
      // match pointAt's berm lift so the banked ribbon rises with the car
      const lift = bank !== 0 ? BANK_EDGE * Math.abs(Math.sin(bank)) : 0;
      const cy = Math.max(GROUND_FLOOR, p.y) + 0.1 + lift;
      positions.push(p.x + rx * edge, cy + ry * edge, p.z + rz * edge);
      positions.push(p.x - rx * edge, cy - ry * edge, p.z - rz * edge);
      const v = d / TEX_TILE_METERS;
      uvs.push(0, v, 1, v);
      if (i < count) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // procedural colour (keeps the lane markings + kerbs) + real asphalt normal
    const lib = pbr();
    // per-realm surface finish: wet neon streets reflect hard, desert dust is
    // matte, ice is glassy. The scene-env reflection + the asphalt normal make
    // it read as a real damp/dry/frozen surface rather than a flat plane.
    const f = ROAD_FINISH[finish];
    const matOpts: THREE.MeshStandardMaterialParameters = {
      map: texture, metalness: f.metal, roughness: f.rough, side: THREE.DoubleSide,
      envMapIntensity: f.env,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    };
    if (lib) {
      const t = tileSet(lib.road, 6, 5);
      matOpts.normalMap = t.nor;
      matOpts.normalScale = new THREE.Vector2(0.85, 0.85);
      // real asphalt roughness (ARM .g) — worn/polished patches now catch the
      // light differently instead of the whole road sharing one constant, which
      // is what made wet and icy finishes read as a flat plastic sheet.
      if (t.arm) {
        matOpts.roughnessMap = t.arm;
        // The ARM map's RED channel is baked ambient occlusion — free contact
        // darkening in the asphalt's pits and cracks. We already pay to load it
        // for roughness; using .r as well costs nothing at render time.
        matOpts.aoMap = t.arm;
        matOpts.aoMapIntensity = 0.8;
        // roughnessMap MULTIPLIES material.roughness, and asphalt's map averages
        // ~0.8 — so leaving the per-realm finish as-is would quietly gloss every
        // road up by ~20% and make dry realms look wet. Pre-divide so the mean
        // lands back on the realm's intended finish, keeping wet/dry/ice identity
        // while still gaining real per-texel variation.
        matOpts.roughness = Math.min(1, f.rough / 0.8);
      }
    } else {
      const bump = asphaltBump();
      bump.repeat.set(4, 4);
      matOpts.bumpMap = bump;
      matOpts.bumpScale = 0.05;
    }
    const mat = new THREE.MeshStandardMaterial(matOpts);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    return mesh;
  }

  /**
   * Grass banks that slope from the road edge down to ground level, so
   * elevated road sections don't float over the flat ground plane.
   */
  buildVergeMesh(texture: THREE.Texture): THREE.Mesh {
    const step = 2;
    const count = Math.ceil(this.length / step);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const edge = ROAD_HALF_WIDTH * 1.25;

    for (let i = 0; i <= count; i++) {
      const d = (i / count) * this.length;
      const t = this.wrap(d) / this.length;
      const p = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t);
      const nx = -tan.z;
      const nz = tan.x;
      // inner edge tucks slightly under the road so the grass never bleeds onto
      // the road edge; its height follows the floored road
      const innerEdge = edge - 0.8;
      const vy = Math.max(GROUND_FLOOR, p.y) + 0.02;
      // 4 verts per cross section: rightOuter, rightInner, leftInner, leftOuter
      positions.push(p.x + nx * (edge + VERGE_WIDTH), 0, p.z + nz * (edge + VERGE_WIDTH));
      positions.push(p.x + nx * innerEdge, vy, p.z + nz * innerEdge);
      positions.push(p.x - nx * innerEdge, vy, p.z - nz * innerEdge);
      positions.push(p.x - nx * (edge + VERGE_WIDTH), 0, p.z - nz * (edge + VERGE_WIDTH));
      const v = d / TEX_TILE_METERS;
      uvs.push(0, v, 0.3, v, 0.7, v, 1, v);
      if (i < count) {
        const a = i * 4;
        const b = a + 4;
        // right strip (outer->inner) and left strip (inner->outer)
        indices.push(a, a + 1, b + 1, a, b + 1, b);
        indices.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide });
    return new THREE.Mesh(geo, mat);
  }

  /** Translucent glass tube enclosing the road (anti-gravity void realm). */
  buildTube(): THREE.Group {
    const g = new THREE.Group();
    const geo = new THREE.TubeGeometry(this.curve, 500, ROAD_HALF_WIDTH * 1.8, 14, true);
    const fill = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x0e7490, transparent: true, opacity: 0.09,
        side: THREE.BackSide, depthWrite: false,
      })
    );
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.28 })
    );
    g.add(fill, wire);
    return g;
  }

  /** Glowing neon rails running along both road edges. */
  buildRails(color = 0x22d3ee): THREE.Group {
    const g = new THREE.Group();
    const edge = ROAD_HALF_WIDTH * 1.25;
    const n = 220;
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const p = this.curve.getPointAt(t);
        const tan = this.curve.getTangentAt(t);
        pts.push(new THREE.Vector3(
          p.x + -tan.z * edge * side,
          p.y + 0.35,
          p.z + tan.x * edge * side
        ));
      }
      const railCurve = new THREE.CatmullRomCurve3(pts, true);
      const geo = new THREE.TubeGeometry(railCurve, 320, 0.3, 6, true);
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.95 });
      g.add(new THREE.Mesh(geo, mat));
    }
    return g;
  }

  /** Glowing marker posts down both road edges — a real-circuit look and a
   *  speed reference that whips past as you go. Colors alternate; fullbright so
   *  they read as neon and the bloom catches them. */
  buildEdgePosts(colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation): THREE.Group {
    const g = new THREE.Group();
    const edge = ROAD_HALF_WIDTH * 1.25 + 0.7;
    const step = 13;
    const count = Math.max(2, Math.floor(this.length / step));

    // Marker posts. These have now been wrong twice in opposite directions: a
    // near-black stem with a near-black cap read as "small black pillars", and
    // brightening the cap to 0.95 turned it into a glowing white SPHERE on a
    // white stick — a row of lollipops down both verges, which is the odd
    // lights. A real marker post is a slim dark blade with a small flat
    // reflector PLATE facing the traffic, so that is what this builds: the
    // bright part is a 12 cm square panel, not a ball.
    const stemGeo = new THREE.BoxGeometry(0.075, 0.8, 0.05);
    stemGeo.translate(0, 0.4, 0);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0xe8e6ee, metalness: 0.2, roughness: 0.6 });
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, count * 2);

    const capGeo = new THREE.BoxGeometry(0.11, 0.11, 0.02);
    capGeo.translate(0, 0.66, -0.035);
    const capMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const caps = new THREE.InstancedMesh(capGeo, capMat, count * 2);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const cA = new THREE.Color(colorA);
    const cB = new THREE.Color(colorB);
    let idx = 0;
    for (let i = 0; i < count; i++) {
      const d = (i / count) * this.length;
      const t = this.wrap(d) / this.length;
      const pt = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t);
      const nx = -tan.z, nz = tan.x;
      const y = Math.max(GROUND_FLOOR, pt.y) + 0.1;
      const col = i % 2 === 0 ? cA : cB;
      for (const side of [-1, 1]) {
        p.set(pt.x + nx * edge * side, y, pt.z + nz * edge * side);
        // turn the blade edge-on to the road so it stays slim from the car, and
        // aim the reflector plate inward at the traffic
        q.setFromAxisAngle(up, Math.atan2(nx * side, nz * side));
        m.compose(p, q, s);
        stems.setMatrixAt(idx, m);
        caps.setMatrixAt(idx, m);
        caps.setColorAt(idx, col);
        idx++;
      }
    }
    stems.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    g.add(stems, caps);
    return g;
  }

  buildStartLine(texture: THREE.Texture): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 4);
    const mat = new THREE.MeshBasicMaterial({ map: texture });
    const mesh = new THREE.Mesh(geo, mat);
    const p = this.pointAt(2);
    const tan = this.tangentAt(2);
    mesh.position.set(p.x, p.y + 0.1, p.z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(-tan.x, -tan.z);
    return mesh;
  }
}

/** Procedural road surface: asphalt with aggregate + wear, lane dashes, edge
 *  lines, and rumble strips down each edge. */
export function makeRoadTexture(pal: RealmPalette): THREE.Texture {
  const R = 512;
  const c = document.createElement("canvas");
  c.width = R;
  c.height = R;
  const ctx = c.getContext("2d")!;
  let seed = 909;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  const edgeW = 52;       // rumble-strip width per side
  const asphaltL = edgeW; // asphalt left x
  const asphaltR = R - edgeW;
  const asphaltW = asphaltR - asphaltL;

  // rumble strips on both edges, alternating color every quarter along length
  for (let y = 0; y < R; y += R / 8) {
    const a = ((y / (R / 8)) | 0) % 2 === 0;
    ctx.fillStyle = a ? pal.rumbleA : pal.rumbleB;
    ctx.fillRect(0, y, edgeW, R / 8);
    ctx.fillRect(asphaltR, y, edgeW, R / 8);
  }
  // knock the neon back so the kerbs read as an accent, not a light source
  ctx.fillStyle = "rgba(8,6,16,0.34)";
  ctx.fillRect(0, 0, edgeW, R);
  ctx.fillRect(asphaltR, 0, edgeW, R);

  // asphalt base + soft patches for uneven surfacing
  ctx.fillStyle = pal.road;
  ctx.fillRect(asphaltL, 0, asphaltW, R);
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.08 + rand() * 0.12;
    ctx.fillStyle = rand() < 0.5 ? pal.roadDark : "#000000";
    const w = 30 + rand() * 120, h = 30 + rand() * 120;
    ctx.beginPath();
    ctx.ellipse(asphaltL + rand() * asphaltW, rand() * R, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // darker tire-wear bands down each lane centre
  for (const lx of [0.17, 0.5, 0.83]) {
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(asphaltL + asphaltW * lx - 16, 0, 32, R);
  }

  // aggregate grain (light + dark flecks)
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${rand() * 0.18})` : `rgba(255,255,255,${rand() * 0.06})`;
    const s = 1 + rand() * 2;
    ctx.fillRect(asphaltL + rand() * asphaltW, rand() * R, s, s);
  }

  // hairline cracks
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    let x = asphaltL + rand() * asphaltW;
    let y = rand() * R;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rand() - 0.5) * 40;
      y += 20 + rand() * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // solid edge lines
  ctx.fillStyle = pal.edgeLine;
  ctx.fillRect(asphaltL + 4, 0, 8, R);
  ctx.fillRect(asphaltR - 12, 0, 8, R);

  // lane dashes (2 dividers for 3 lanes)
  ctx.fillStyle = pal.laneLine;
  for (const lx of [1 / 3, 2 / 3]) {
    const x = asphaltL + asphaltW * lx - 4;
    for (let y = 20; y < R; y += 128) ctx.fillRect(x, y, 8, 72);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function makeCheckerTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? "#e8e0ff" : "#1e1b2e";
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
