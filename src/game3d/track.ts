import * as THREE from "three";
import { ROAD_HALF_WIDTH } from "./constants";
import { asphaltBump, pbr, tileSet } from "./textures";
import type { RealmPalette } from "./realms";

const TEX_TILE_METERS = 10;
const VERGE_WIDTH = 18; // grass bank from road edge out to flat ground
// The CatmullRom curve can undershoot below its control points in dips; keep the
// road surface above this floor so the flat ground plane never pokes through it.
const GROUND_FLOOR = 0.35;

export interface XZ {
  x: number;
  z: number;
}

export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private curvatures: number[];
  private samples: number;

  constructor(controlPoints: [number, number, number][]) {
    const pts = controlPoints.map(([x, y, z]) => new THREE.Vector3(x, y, z));
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
    }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  wrap(dist: number) {
    return ((dist % this.length) + this.length) % this.length;
  }

  pointAt(dist: number, lateral = 0, out = new THREE.Vector3()) {
    const t = this.wrap(dist) / this.length;
    const p = this.curve.getPointAt(t, out);
    if (p.y < GROUND_FLOOR) p.y = GROUND_FLOOR;
    if (lateral !== 0) {
      const tan = this.curve.getTangentAt(t);
      p.x += -tan.z * lateral;
      p.z += tan.x * lateral;
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

  buildRoadMesh(texture: THREE.Texture): THREE.Mesh {
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
      const ry = Math.max(GROUND_FLOOR, p.y) + 0.1;
      positions.push(p.x + nx * edge, ry, p.z + nz * edge);
      positions.push(p.x - nx * edge, ry, p.z - nz * edge);
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
    const matOpts: THREE.MeshStandardMaterialParameters = {
      map: texture, metalness: 0.0, roughness: 0.95, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    };
    if (lib) {
      const nor = tileSet(lib.road, 6, 5).nor;
      matOpts.normalMap = nor;
      matOpts.normalScale = new THREE.Vector2(0.7, 0.7);
    } else {
      const bump = asphaltBump();
      bump.repeat.set(4, 4);
      matOpts.bumpMap = bump;
      matOpts.bumpScale = 0.04;
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

    // dark stems (lit) + bright caps (fullbright) as two instanced meshes
    const stemGeo = new THREE.CylinderGeometry(0.13, 0.18, 1.35, 6);
    stemGeo.translate(0, 0.675, 0);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x2a2438, metalness: 0.5, roughness: 0.5 });
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, count * 2);

    const capGeo = new THREE.SphereGeometry(0.26, 10, 8);
    capGeo.translate(0, 1.45, 0);
    const capMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const caps = new THREE.InstancedMesh(capGeo, capMat, count * 2);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    // dimmed so the markers read as gentle dots rather than blinding glow
    const cA = new THREE.Color(colorA).multiplyScalar(0.42);
    const cB = new THREE.Color(colorB).multiplyScalar(0.42);
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
