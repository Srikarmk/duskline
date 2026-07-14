import { SEGMENT_LENGTH, RUMBLE_LENGTH } from "./constants";
import type { GameMode } from "./engine";

export interface ProjectedPoint {
  world: { x: number; y: number; z: number };
  camera: { x: number; y: number; z: number };
  screen: { x: number; y: number; w: number };
}

export type SpriteType =
  | "crystal"
  | "tree"
  | "mushroom"
  | "pillar"
  | "rock"
  | "gem"
  | "airGem"
  | "nitro"
  | "ramp"
  | "orb";

export interface RoadSprite {
  type: SpriteType;
  /** -1..1 spans the road; beyond that is roadside scenery */
  offset: number;
  /** lap number this consumable was collected on (0 = still available) */
  collectedLap: number;
}

export interface Segment {
  index: number;
  p1: ProjectedPoint;
  p2: ProjectedPoint;
  curve: number;
  palette: "light" | "dark";
  sprites: RoadSprite[];
  clip: number; // screen y of nearest hill crest, for sprite clipping
}

const ROAD = {
  LENGTH: { SHORT: 25, MEDIUM: 50, LONG: 100 },
  CURVE: { EASY: 2, MEDIUM: 4, HARD: 6 },
  HILL: { LOW: 20, MEDIUM: 40, HIGH: 60 },
} as const;

const LANE_CENTERS = [-2 / 3, 0, 2 / 3];

function point(y: number, z: number): ProjectedPoint {
  return {
    world: { x: 0, y, z },
    camera: { x: 0, y: 0, z: 0 },
    screen: { x: 0, y: 0, w: 0 },
  };
}

function easeIn(a: number, b: number, p: number) {
  return a + (b - a) * Math.pow(p, 2);
}
function easeInOut(a: number, b: number, p: number) {
  return a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
}

/** Deterministic PRNG so track decoration is stable across reloads. */
function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export class Road {
  segments: Segment[] = [];

  get trackLength() {
    return this.segments.length * SEGMENT_LENGTH;
  }

  findSegment(z: number): Segment {
    const i = Math.floor(z / SEGMENT_LENGTH) % this.segments.length;
    return this.segments[(i + this.segments.length) % this.segments.length];
  }

  private lastY() {
    const last = this.segments[this.segments.length - 1];
    return last ? last.p2.world.y : 0;
  }

  private addSegment(curve: number, y: number) {
    const n = this.segments.length;
    this.segments.push({
      index: n,
      p1: point(this.lastY(), n * SEGMENT_LENGTH),
      p2: point(y, (n + 1) * SEGMENT_LENGTH),
      curve,
      palette: Math.floor(n / RUMBLE_LENGTH) % 2 ? "dark" : "light",
      sprites: [],
      clip: 0,
    });
  }

  private addRoad(enter: number, hold: number, leave: number, curve: number, y = 0) {
    const startY = this.lastY();
    const endY = startY + y * SEGMENT_LENGTH;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++)
      this.addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    for (let n = 0; n < hold; n++)
      this.addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    for (let n = 0; n < leave; n++)
      this.addSegment(
        easeInOut(curve, 0, n / leave),
        easeInOut(startY, endY, (enter + hold + n) / total)
      );
  }

  private addStraight(n: number = ROAD.LENGTH.MEDIUM) {
    this.addRoad(n, n, n, 0, 0);
  }

  private addCurve(n: number = ROAD.LENGTH.MEDIUM, curve: number = ROAD.CURVE.MEDIUM, height = 0) {
    this.addRoad(n, n, n, curve, height);
  }

  private addHill(n: number = ROAD.LENGTH.MEDIUM, height: number = ROAD.HILL.MEDIUM) {
    this.addRoad(n, n, n, 0, height);
  }

  private addSCurves() {
    this.addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.EASY);
    this.addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.CURVE.MEDIUM, ROAD.HILL.LOW);
    this.addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.CURVE.EASY, -ROAD.HILL.LOW);
    this.addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.EASY);
  }

  private addRollingHills(n: number = ROAD.LENGTH.SHORT, height: number = ROAD.HILL.LOW) {
    this.addRoad(n, n, n, 0, height / 2);
    this.addRoad(n, n, n, 0, -height);
    this.addRoad(n, n, n, ROAD.CURVE.EASY, height);
    this.addRoad(n, n, n, 0, 0);
    this.addRoad(n, n, n, -ROAD.CURVE.EASY, height / 2);
    this.addRoad(n, n, n, 0, 0);
  }

  /** Ease elevation back to zero so the track loops seamlessly. */
  private closeLoop() {
    const drop = -this.lastY() / SEGMENT_LENGTH;
    this.addRoad(60, 60, 60, 0, drop);
  }

  buildCircuit(mode: GameMode) {
    this.segments = [];
    this.addStraight(ROAD.LENGTH.MEDIUM);
    this.addSCurves();
    this.addCurve(ROAD.LENGTH.LONG, ROAD.CURVE.MEDIUM, ROAD.HILL.MEDIUM);
    this.addStraight();
    this.addHill(ROAD.LENGTH.MEDIUM, ROAD.HILL.HIGH);
    this.addCurve(ROAD.LENGTH.LONG, -ROAD.CURVE.MEDIUM, -ROAD.HILL.MEDIUM);
    this.addRollingHills();
    this.addCurve(ROAD.LENGTH.LONG, ROAD.CURVE.HARD, 0);
    this.addStraight();
    this.addSCurves();
    this.closeLoop();
    this.decorate(mode);
  }

  private decorate(mode: GameMode) {
    const rand = mulberry32(42);
    const len = this.segments.length;
    const laneOf = () => LANE_CENTERS[Math.floor(rand() * 3)];
    const add = (i: number, type: SpriteType, offset: number) => {
      if (i < 10 || i >= len) return; // keep the start line clean
      this.segments[i].sprites.push({ type, offset, collectedLap: 0 });
    };

    // roadside scenery on both sides; pillars are rarer landmarks
    const scenery = (): SpriteType => {
      const r = rand();
      if (r < 0.35) return "crystal";
      if (r < 0.7) return "tree";
      if (r < 0.92) return "mushroom";
      return "pillar";
    };
    for (let i = 0; i < len; i += 4) {
      add(i, scenery(), -(1.4 + rand() * 2));
      add(i, scenery(), 1.4 + rand() * 2);
    }

    // gem runs: 8 gems spaced down one lane
    for (let s = 30; s < len - 30; s += 55) {
      const lane = laneOf();
      for (let k = 0; k < 8; k++) add(s + k * 2, "gem", lane);
    }

    // rocks to dodge (or smash, when transformed)
    for (let s = 80; s < len - 30; s += 95) add(s, "rock", laneOf());

    // nitro canisters
    for (let s = 100; s < len - 30; s += 140) add(s, "nitro", laneOf());

    // ramps with an arc of air gems past them
    for (let s = 140; s < len - 40; s += 170) {
      const lane = laneOf();
      add(s, "ramp", lane);
      add(s + 8, "airGem", lane);
      add(s + 11, "airGem", lane);
      add(s + 14, "airGem", lane);
    }

    // transform orbs (transformer mode only)
    if (mode === "transform") {
      for (let s = 120; s < len - 40; s += 230) add(s, "orb", laneOf());
    }
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
