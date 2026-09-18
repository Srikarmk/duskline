import * as THREE from "three";

// The branch road renders slightly above its curve so it never sinks into the
// ground plane — mirrors the +0.1 lift the main road ribbon uses in track.ts.
const ROAD_LIFT = 0.1;
// arc-length lookup table resolution: one sample per metre of curve.
const LUT_SPACING = 1;
// road ribbon cross-sections are emitted every this many metres.
const ROAD_STEP = 2;

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Tiny deterministic seeded rng (matches the inline pattern used across the
 *  game3d modules) so a given `seed` always yields the same branch shape. */
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export interface BranchOpts {
  /** which side of the main track the branch bows to (+1 or -1). */
  side: 1 | -1;
  /** how far, in metres, the apex bows away from the straight chord. */
  bulge: number;
  /** optional hill: metres the branch rises at its mid-point (default 0). */
  rise?: number;
  /** optional seed for the subtle shape jitter (default deterministic). */
  seed?: number;
}

/**
 * An alternate route ("branch") off the main track: a separate drivable road
 * that peels off the main road at `startDist`, bows out to one side as its own
 * sweeping stretch (optionally rising into a gentle overpass), then rejoins the
 * main road at `endDist`.
 *
 * The curve is an OPEN centripetal Catmull-Rom through: the main centre at
 * startDist, a tangent-aligned lead-in that peels off smoothly, a row of bowed
 * mid points, a tangent-aligned lead-out, and the main centre at endDist. It is
 * arc-length parameterised via a lookup table so `u` is metres along the branch.
 */
export class BranchPath {
  readonly length: number;
  readonly startDist: number;
  readonly endDist: number;

  private curve: THREE.CatmullRomCurve3;
  /** cumulative arc length at each of `divisions`+1 uniform curve-parameters. */
  private lengths: number[];
  private divisions: number;
  /** scratch tangent reused inside pointAt to avoid per-call allocation. */
  private _tan = new THREE.Vector3();
  // sampled centreline (x,z + arc-length u) for project()
  private sx: number[] = [];
  private sz: number[] = [];
  private su: number[] = [];

  constructor(
    sampleMainPoint: (dist: number, out?: THREE.Vector3) => THREE.Vector3,
    sampleMainTangent: (dist: number, out?: THREE.Vector3) => THREE.Vector3,
    startDist: number,
    endDist: number,
    opts: BranchOpts,
  ) {
    this.startDist = startDist;
    this.endDist = endDist;

    const side = opts.side;
    const bulge = opts.bulge;
    const rise = opts.rise ?? 0;
    const rng = seeded(opts.seed ?? 12345);

    // main road centre + unit tangent at the leave / rejoin points
    const pStart = sampleMainPoint(startDist, new THREE.Vector3());
    const pEnd = sampleMainPoint(endDist, new THREE.Vector3());
    const tStart = sampleMainTangent(startDist, new THREE.Vector3()).normalize();
    const tEnd = sampleMainTangent(endDist, new THREE.Vector3()).normalize();

    // lead length: how far the branch runs along the main tangent before/after
    // bending, so it leaves and rejoins without a kink.
    const chordLen = pEnd.clone().sub(pStart).length() || 1;
    // SHORT leads. These two control points sit on the main road's tangent
    // LINE, so on a bend the branch runs straight out past the corner before
    // turning back toward its lane — distance spent going the wrong way. At
    // 0.14 of a 125 m chord that was 17.5 m at each end, and together with the
    // wide taper below it turned a lane whose ideal length was 119.8 m into a
    // 154 m detour on a 130 m span (measured). Enough lead to leave without a
    // kink, no more.
    const lead = clampN(chordLen * 0.05, 2, 9);

    // A PARALLEL exit lane, NOT a side-bulge: each mid point is the MAIN road
    // point at that fraction, offset sideways by its OWN local perpendicular, so
    // the branch runs alongside the main road. The offset ramps up (peel off),
    // holds constant (run parallel around the island), then ramps down (merge) —
    // reads as a road division / exit, not a random curve out to the side.
    const span = endDist - startDist;
    // Fraction of the branch spent diverging / converging.
    //
    // A three-way trade, all of it measured. Long (0.3): only 40% of the span
    // is actually at the full offset, so the middle gives back what the ends
    // cost and the branch came out 24 m longer than the main span. Short
    // (0.18): the branch swings its full 16 m sideways in 23 m of span, a ~35°
    // divergence the steering assist cannot hold at 34 m/s — the car overshot
    // and spent 21% of the fork off the tarmac against the main road's 0%.
    // 0.26 keeps the length penalty at ~12 m and the divergence driveable.
    const edge = 0.26;
    const plateau = (s: number): number => {
      if (s < edge) { const t = s / edge; return t * t * (3 - 2 * t); }
      if (s > 1 - edge) { const t = (1 - s) / edge; return t * t * (3 - 2 * t); }
      return 1;
    };
    const mid = (s: number): THREE.Vector3 => {
      const d = startDist + s * span;
      const mp = sampleMainPoint(d, new THREE.Vector3());
      const mt = sampleMainTangent(d, new THREE.Vector3()).normalize();
      const localRight = new THREE.Vector3(-mt.z, 0, mt.x).multiplyScalar(side);
      mp.addScaledVector(localRight, bulge * plateau(s));
      mp.y += rise * plateau(s) + (rng() - 0.5) * 0.2;
      return mp;
    };

    // start, tangent lead-in, parallel-lane mids, tangent lead-out, end — an
    // open centripetal Catmull-Rom that peels off and rejoins the main road.
    const pts: THREE.Vector3[] = [
      pStart.clone(),
      pStart.clone().addScaledVector(tStart, lead),
      mid(0.09),
      mid(0.2),
      mid(0.35),
      mid(0.5),
      mid(0.65),
      mid(0.8),
      mid(0.91),
      pEnd.clone().addScaledVector(tEnd, -lead),
      pEnd.clone(),
    ];

    // open, centripetal Catmull-Rom (robust against the overshoot the uniform
    // form can show through a wide bow).
    this.curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    this.curve.arcLengthDivisions = 2000;

    // arc-length lookup table at ~1 m spacing so pointAt/tangentAt take metres.
    const raw = this.curve.getLength();
    this.divisions = Math.max(2, Math.ceil(raw / LUT_SPACING));
    this.lengths = this.curve.getLengths(this.divisions);
    this.length = this.lengths[this.lengths.length - 1];

    // sample the centreline every ~2m for project() (nearest-point queries)
    const p = new THREE.Vector3();
    for (let u = 0; u <= this.length; u += 2) {
      this.pointAt(u, 0, p);
      this.sx.push(p.x); this.sz.push(p.z); this.su.push(u);
    }
  }

  /** Map an arc-length u (metres) to the curve's native parameter t in [0,1]. */
  private uToT(u: number): number {
    const L = this.lengths;
    const target = clampN(u, 0, this.length);
    // binary search for the first cumulative length >= target
    let lo = 0;
    let hi = L.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (L[m] < target) lo = m + 1;
      else hi = m;
    }
    if (lo === 0) return 0;
    const before = L[lo - 1];
    const seg = L[lo] - before || 1;
    const frac = (target - before) / seg;
    return (lo - 1 + frac) / this.divisions;
  }

  /**
   * World-space point on the branch road at arc-length `u` (metres), offset by
   * `lateralMeters` across the road (signed, +toward the tangent's right). The
   * whole road is lifted ~0.1 m so it sits above the ground like the main road.
   */
  pointAt(u: number, lateralMeters = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const t = this.uToT(u);
    this.curve.getPoint(t, out);
    out.y += ROAD_LIFT;
    if (lateralMeters !== 0) {
      const tan = this.curve.getTangent(t, this._tan);
      // right = normalize(tangent x up); up = (0,1,0) so the y term drops out
      const rx = -tan.z;
      const rz = tan.x;
      const inv = 1 / (Math.hypot(rx, rz) || 1);
      out.x += rx * inv * lateralMeters;
      out.z += rz * inv * lateralMeters;
    }
    return out;
  }

  /** Unit tangent of the branch at arc-length `u` (metres). */
  tangentAt(u: number, out = new THREE.Vector3()): THREE.Vector3 {
    const t = this.uToT(u);
    this.curve.getTangent(t, out);
    return out.normalize();
  }

  /** Project a world (x,z) onto the branch: nearest arc-length `u` + signed
   *  lateral offset in metres (right of travel = +). Open path (no seam wrap). */
  project(x: number, z: number): { u: number; lateral: number } {
    const n = this.sx.length;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = x - this.sx[i], dz = z - this.sz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; bi = i; }
    }
    let best = { u: this.su[bi], lateral: 0, d2: Infinity };
    for (const [a, b] of [[Math.max(0, bi - 1), bi], [bi, Math.min(n - 1, bi + 1)]]) {
      if (a === b) continue;
      const ax = this.sx[a], az = this.sz[a];
      const sx = this.sx[b] - ax, sz = this.sz[b] - az;
      const segLen2 = sx * sx + sz * sz || 1;
      const t = clampN(((x - ax) * sx + (z - az) * sz) / segLen2, 0, 1);
      const px = ax + sx * t, pz = az + sz * t;
      const dx = x - px, dz = z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < best.d2) {
        const invLen = 1 / Math.sqrt(segLen2);
        best = { u: this.su[a] + (this.su[b] - this.su[a]) * t, lateral: (sz * dx - sx * dz) * invLen, d2 };
      }
    }
    return { u: best.u, lateral: best.lateral };
  }

  /**
   * Build the visible branch road ribbon in WORLD coordinates: a flat faceted
   * lane road of the given `roadMat`, plus bright emissive edge strips and a
   * dashed centre line so it reads as a real lane. Cross-sections are sampled
   * every ~2 m and shared by every strip. The returned group stays at the
   * origin (all vertices are absolute world coords).
   */
  buildRoad(roadMat: THREE.Material, halfWidth: number): THREE.Group {
    const g = new THREE.Group();
    const count = Math.max(2, Math.ceil(this.length / ROAD_STEP));
    const n = count + 1;

    // sample the centre point (with lift) and unit "right" vector once, reused
    // by the road ribbon and every edge / centre strip below.
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    const pz = new Float64Array(n);
    const nx = new Float64Array(n);
    const nz = new Float64Array(n);
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = (i / count) * this.length;
      this.pointAt(u, 0, p);
      this.tangentAt(u, tan);
      const rx = -tan.z;
      const rz = tan.x;
      const inv = 1 / (Math.hypot(rx, rz) || 1);
      px[i] = p.x; py[i] = p.y; pz[i] = p.z;
      nx[i] = rx * inv; nz[i] = rz * inv;
    }

    // --- road surface ribbon ------------------------------------------------
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      pos.push(px[i] + nx[i] * halfWidth, py[i], pz[i] + nz[i] * halfWidth);
      pos.push(px[i] - nx[i] * halfWidth, py[i], pz[i] - nz[i] * halfWidth);
      const v = ((i / count) * this.length) / 10;
      uvs.push(0, v, 1, v);
      if (i < count) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, roadMat);
    road.renderOrder = 1;
    g.add(road);

    // --- thin strips (edges + dashed centre) -------------------------------
    // build a ribbon between two lateral offsets, lifted just over the road; a
    // dashed strip skips every other segment so the centre line reads as lane
    // dashes.
    const strip = (latA: number, latB: number, lift: number, mat: THREE.Material, dash: boolean): THREE.Mesh => {
      const sp: number[] = [];
      const si: number[] = [];
      for (let i = 0; i < n; i++) {
        sp.push(px[i] + nx[i] * latA, py[i] + lift, pz[i] + nz[i] * latA);
        sp.push(px[i] + nx[i] * latB, py[i] + lift, pz[i] + nz[i] * latB);
      }
      for (let i = 0; i < count; i++) {
        if (dash && i % 2 === 1) continue; // gaps between dashes
        const a = i * 2;
        si.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
      gg.setIndex(si);
      gg.computeVertexNormals();
      const m = new THREE.Mesh(gg, mat);
      m.renderOrder = 2;
      return m;
    };

    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0x9df0ff, emissive: 0x22d3ee, emissiveIntensity: 1.15,
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xfff7e0, emissive: 0xfde68a, emissiveIntensity: 0.85,
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const ew = 0.35; // edge strip width

    g.add(strip(halfWidth - ew, halfWidth, 0.04, edgeMat, false));    // right edge
    g.add(strip(-halfWidth, -halfWidth + ew, 0.04, edgeMat, false));  // left edge
    g.add(strip(-0.2, 0.2, 0.05, lineMat, true));                     // dashed centre line

    return g;
  }
}
