import { SEGMENT_LENGTH, RUMBLE_LENGTH } from "./constants";

export interface ProjectedPoint {
  world: { x: number; y: number; z: number };
  camera: { x: number; y: number; z: number };
  screen: { x: number; y: number; w: number };
}

export interface Segment {
  index: number;
  p1: ProjectedPoint;
  p2: ProjectedPoint;
  curve: number;
  palette: "light" | "dark";
}

function point(z: number): ProjectedPoint {
  return {
    world: { x: 0, y: 0, z },
    camera: { x: 0, y: 0, z: 0 },
    screen: { x: 0, y: 0, w: 0 },
  };
}

export class Road {
  segments: Segment[] = [];

  get trackLength() {
    return this.segments.length * SEGMENT_LENGTH;
  }

  /** Phase 1: a long straight track. Curves and hills come in phase 2. */
  buildStraight(segmentCount = 500) {
    this.segments = [];
    for (let n = 0; n < segmentCount; n++) {
      this.segments.push({
        index: n,
        p1: point(n * SEGMENT_LENGTH),
        p2: point((n + 1) * SEGMENT_LENGTH),
        curve: 0,
        palette: Math.floor(n / RUMBLE_LENGTH) % 2 ? "dark" : "light",
      });
    }
  }

  findSegment(z: number): Segment {
    const i = Math.floor(z / SEGMENT_LENGTH) % this.segments.length;
    return this.segments[(i + this.segments.length) % this.segments.length];
  }
}

/** Project a world point into screen space via simple perspective division. */
export function project(
  p: ProjectedPoint,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  cameraDepth: number,
  width: number,
  height: number,
  roadWidth: number
) {
  p.camera.x = p.world.x - cameraX;
  p.camera.y = p.world.y - cameraY;
  p.camera.z = p.world.z - cameraZ;
  const scale = cameraDepth / p.camera.z;
  p.screen.x = Math.round(width / 2 + (scale * p.camera.x * width) / 2);
  p.screen.y = Math.round(height / 2 - (scale * p.camera.y * height) / 2);
  p.screen.w = Math.round((scale * roadWidth * width) / 2);
}
