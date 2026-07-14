import * as THREE from "three";
import { ROAD_HALF_WIDTH } from "./constants";
import type { RealmPalette } from "./realms";

const TEX_TILE_METERS = 10;
const VERGE_WIDTH = 18; // grass bank from road edge out to flat ground

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
      positions.push(p.x + nx * edge, p.y + 0.06, p.z + nz * edge);
      positions.push(p.x - nx * edge, p.y + 0.06, p.z - nz * edge);
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

    const mat = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide });
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
      // 4 verts per cross section: rightOuter, rightInner, leftInner, leftOuter
      positions.push(p.x + nx * (edge + VERGE_WIDTH), 0, p.z + nz * (edge + VERGE_WIDTH));
      positions.push(p.x + nx * edge, p.y + 0.03, p.z + nz * edge);
      positions.push(p.x - nx * edge, p.y + 0.03, p.z - nz * edge);
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

/** Procedural road surface: asphalt, lane dashes, edge lines, rumble strips. */
export function makeRoadTexture(pal: RealmPalette): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;

  // rumble strips on the outer edges (alternating halves)
  ctx.fillStyle = pal.rumbleA;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = pal.rumbleB;
  ctx.fillRect(0, 128, 256, 128);

  // asphalt body
  ctx.fillStyle = pal.road;
  ctx.fillRect(26, 0, 204, 256);
  ctx.fillStyle = pal.roadDark;
  ctx.fillRect(26, 128, 204, 128);
  // grain
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    ctx.fillRect(26 + Math.random() * 204, Math.random() * 256, 2, 2);
  }

  // edge lines
  ctx.fillStyle = pal.edgeLine;
  ctx.fillRect(30, 0, 5, 256);
  ctx.fillRect(221, 0, 5, 256);

  // lane dashes (2 dividers for 3 lanes)
  ctx.fillStyle = pal.laneLine;
  for (const x of [94, 158]) {
    ctx.fillRect(x, 16, 5, 96);
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
