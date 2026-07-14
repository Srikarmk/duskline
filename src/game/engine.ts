import {
  STEP, WIDTH, HEIGHT,
  ROAD_WIDTH, DRAW_DISTANCE, CAMERA_HEIGHT, CAMERA_DEPTH,
  MAX_SPEED, ACCEL, BRAKING, DECEL, OFF_ROAD_DECEL, OFF_ROAD_LIMIT,
} from "./constants";
import { Input } from "./input";
import { Road, project } from "./road";
import { drawBackground, drawSegment, drawPlayer, drawHud } from "./render";

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export class Game {
  private ctx: CanvasRenderingContext2D;
  private input = new Input();
  private road = new Road();
  private rafId = 0;
  private last = 0;
  private accumulator = 0;

  // player state
  private position = 0; // camera z on the track
  private playerX = 0; // -1 .. 1, normalized across road width
  private speed = 0;
  private steer = 0; // -1 .. 1, for rendering lean

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.road.buildStraight();
  }

  start() {
    this.input.attach();
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    this.input.detach();
  }

  private frame = (now: number) => {
    this.accumulator += Math.min(now - this.last, 250) / 1000;
    this.last = now;
    while (this.accumulator >= STEP) {
      this.update(STEP);
      this.accumulator -= STEP;
    }
    this.render();
    this.rafId = requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    const speedPercent = this.speed / MAX_SPEED;

    // steering, scaled by speed so you can't turn while stopped
    const dx = dt * 2 * speedPercent;
    this.steer = this.input.left ? -1 : this.input.right ? 1 : 0;
    this.playerX = clamp(this.playerX + this.steer * dx, -2, 2);

    // throttle / brake / coast
    if (this.input.accelerate) this.speed += ACCEL * dt;
    else if (this.input.brake) this.speed += BRAKING * dt;
    else this.speed += DECEL * dt;

    // off-road drag when outside the rumble strips
    if (Math.abs(this.playerX) > 1 && this.speed > OFF_ROAD_LIMIT) {
      this.speed += OFF_ROAD_DECEL * dt;
    }

    this.speed = clamp(this.speed, 0, MAX_SPEED);

    this.position += this.speed * dt;
    while (this.position >= this.road.trackLength) {
      this.position -= this.road.trackLength;
    }
  }

  private render() {
    const { ctx, road } = this;
    drawBackground(ctx);

    const baseSegment = road.findSegment(this.position);
    let maxY = HEIGHT;

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const segment = road.segments[(baseSegment.index + n) % road.segments.length];
      const looped = segment.index < baseSegment.index;
      const cameraZ = this.position - (looped ? road.trackLength : 0);

      project(segment.p1, this.playerX * ROAD_WIDTH, CAMERA_HEIGHT, cameraZ,
        CAMERA_DEPTH, WIDTH, HEIGHT, ROAD_WIDTH);
      project(segment.p2, this.playerX * ROAD_WIDTH, CAMERA_HEIGHT, cameraZ,
        CAMERA_DEPTH, WIDTH, HEIGHT, ROAD_WIDTH);

      const behindCamera = segment.p1.camera.z <= CAMERA_DEPTH;
      const hidden = segment.p2.screen.y >= maxY;
      if (behindCamera || hidden) continue;

      drawSegment(ctx, segment);
      maxY = segment.p2.screen.y;
    }

    drawPlayer(ctx, this.steer);
    drawHud(ctx, this.speed / MAX_SPEED);
  }
}
