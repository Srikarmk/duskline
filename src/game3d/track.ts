import * as THREE from "three";
import { ROAD_HALF_WIDTH } from "./constants";

/** Closed circuit control points (XZ plane, meters). */
const CONTROL_POINTS: [number, number][] = [
  [0, 0],
  [70, -12],
  [150, 10],
  [195, 70],
  [175, 140],
  [110, 165],
  [60, 130],
  [-10, 150],
  [-70, 195],
  [-140, 170],
  [-170, 95],
  [-135, 25],
  [-70, -5],
];

const TEX_TILE_METERS = 10;

export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  private curvatures: number[];
  private samples: number;

  constructor() {
    const pts = CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
    this.curve.arcLengthDivisions = 2000;
    this.length = this.curve.getLength();

    // precompute signed curvature (rad per meter) at regular intervals
    this.samples = 1024;
    this.curvatures = [];
    const delta = 2; // meters each side
    for (let i = 0; i < this.samples; i++) {
      const d = (i / this.samples) * this.length;
      const t0 = this.curve.getTangentAt(this.wrap(d - delta) / this.length);
      const t1 = this.curve.getTangentAt(this.wrap(d + delta) / this.length);
      const angle = Math.atan2(
        t0.x * t1.z - t0.z * t1.x, // cross.y (sign = turn direction)
        t0.x * t1.x + t0.z * t1.z
      );
      this.curvatures.push(angle / (2 * delta));
    }
  }

  wrap(dist: number) {
    return ((dist % this.length) + this.length) % this.length;
  }

  pointAt(dist: number, lateral = 0, out = new THREE.Vector3()) {
    const t = this.wrap(dist) / this.length;
    const p = this.curve.getPointAt(t, out);
    if (lateral !== 0) {
      const tan = this.curve.getTangentAt(t);
      // right-hand normal in XZ
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

  buildRoadMesh(texture: THREE.Texture): THREE.Mesh {
    const step = 2; // meters between cross-sections
    const count = Math.ceil(this.length / step);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const edge = ROAD_HALF_WIDTH * 1.25; // includes rumble strip painted in texture

    for (let i = 0; i <= count; i++) {
      const d = (i / count) * this.length;
      const t = this.wrap(d) / this.length;
      const p = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t);
      const nx = -tan.z;
      const nz = tan.x;
      positions.push(p.x + nx * edge, 0.02, p.z + nz * edge);
      positions.push(p.x - nx * edge, 0.02, p.z - nz * edge);
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
    mesh.receiveShadow = true;
    return mesh;
  }

  buildStartLine(texture: THREE.Texture): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 3);
    const mat = new THREE.MeshBasicMaterial({ map: texture });
    const mesh = new THREE.Mesh(geo, mat);
    const p = this.pointAt(1.5);
    const tan = this.tangentAt(1.5);
    mesh.position.set(p.x, 0.06, p.z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(-tan.x, -tan.z);
    return mesh;
  }
}

/** Procedural road surface: asphalt, lane dashes, edge lines, rumble strips. */
export function makeRoadTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;

  // rumble strips on the outer 10% (alternating halves for the retro stripe feel)
  ctx.fillStyle = "#6d28d9";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "#c084fc";
  ctx.fillRect(0, 128, 256, 128);

  // asphalt body
  ctx.fillStyle = "#3b3355";
  ctx.fillRect(26, 0, 204, 256);
  // subtle tone variation
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(26, 128, 204, 128);

  // edge lines
  ctx.fillStyle = "#d8d0f0";
  ctx.fillRect(30, 0, 5, 256);
  ctx.fillRect(221, 0, 5, 256);

  // lane dashes (2 dividers for 3 lanes)
  for (const x of [94, 158] as const) {
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
