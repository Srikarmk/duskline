import { COLORS, LANES, WIDTH, HEIGHT } from "./constants";
import type { Segment } from "./road";

export function drawBackground(ctx: CanvasRenderingContext2D) {
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT / 2);
  sky.addColorStop(0, COLORS.sky.top);
  sky.addColorStop(1, COLORS.sky.bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT / 2);

  // soft magical glow at the horizon
  const glow = ctx.createLinearGradient(0, HEIGHT / 2 - 60, 0, HEIGHT / 2);
  glow.addColorStop(0, "rgba(192, 132, 252, 0)");
  glow.addColorStop(1, "rgba(192, 132, 252, 0.35)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, HEIGHT / 2 - 60, WIDTH, 60);

  ctx.fillStyle = COLORS.dark.grass;
  ctx.fillRect(0, HEIGHT / 2, WIDTH, HEIGHT / 2);
}

function polygon(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  x4: number, y4: number,
  color: string
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

export function drawSegment(ctx: CanvasRenderingContext2D, segment: Segment) {
  const { p1, p2, palette } = segment;
  const colors = COLORS[palette];

  const r1 = p1.screen.w / Math.max(6, 2 * LANES);
  const r2 = p2.screen.w / Math.max(6, 2 * LANES);

  // grass
  ctx.fillStyle = colors.grass;
  ctx.fillRect(0, p2.screen.y, WIDTH, p1.screen.y - p2.screen.y);

  // rumble strips
  polygon(ctx,
    p1.screen.x - p1.screen.w - r1, p1.screen.y,
    p1.screen.x - p1.screen.w, p1.screen.y,
    p2.screen.x - p2.screen.w, p2.screen.y,
    p2.screen.x - p2.screen.w - r2, p2.screen.y,
    colors.rumble);
  polygon(ctx,
    p1.screen.x + p1.screen.w + r1, p1.screen.y,
    p1.screen.x + p1.screen.w, p1.screen.y,
    p2.screen.x + p2.screen.w, p2.screen.y,
    p2.screen.x + p2.screen.w + r2, p2.screen.y,
    colors.rumble);

  // road surface
  polygon(ctx,
    p1.screen.x - p1.screen.w, p1.screen.y,
    p1.screen.x + p1.screen.w, p1.screen.y,
    p2.screen.x + p2.screen.w, p2.screen.y,
    p2.screen.x - p2.screen.w, p2.screen.y,
    colors.road);

  // lane markers on light segments only, so they appear dashed
  if (palette === "light") {
    const l1 = p1.screen.w / Math.max(32, 8 * LANES);
    const l2 = p2.screen.w / Math.max(32, 8 * LANES);
    const laneW1 = (p1.screen.w * 2) / LANES;
    const laneW2 = (p2.screen.w * 2) / LANES;
    let laneX1 = p1.screen.x - p1.screen.w + laneW1;
    let laneX2 = p2.screen.x - p2.screen.w + laneW2;
    for (let lane = 1; lane < LANES; lane++) {
      polygon(ctx,
        laneX1 - l1 / 2, p1.screen.y,
        laneX1 + l1 / 2, p1.screen.y,
        laneX2 + l2 / 2, p2.screen.y,
        laneX2 - l2 / 2, p2.screen.y,
        COLORS.light.lane);
      laneX1 += laneW1;
      laneX2 += laneW2;
    }
  }
}

/** Placeholder player vehicle until we have sprites: a small magic kart. */
export function drawPlayer(ctx: CanvasRenderingContext2D, steer: number) {
  const x = WIDTH / 2;
  const y = HEIGHT - 60;
  const lean = steer * 8;

  ctx.save();
  ctx.translate(x, y);

  // shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.beginPath();
  ctx.ellipse(0, 22, 46, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // body
  ctx.fillStyle = "#7c3aed";
  ctx.beginPath();
  ctx.moveTo(-40 + lean, 10);
  ctx.lineTo(-28 + lean, -18);
  ctx.lineTo(28 + lean, -18);
  ctx.lineTo(40 + lean, 10);
  ctx.closePath();
  ctx.fill();

  // canopy glow
  ctx.fillStyle = "#c084fc";
  ctx.beginPath();
  ctx.ellipse(lean, -18, 16, 8, 0, Math.PI, 0);
  ctx.fill();

  // wheels
  ctx.fillStyle = "#1e1b2e";
  ctx.fillRect(-46 + lean / 2, 4, 14, 18);
  ctx.fillRect(32 + lean / 2, 4, 14, 18);

  ctx.restore();
}

export function drawHud(ctx: CanvasRenderingContext2D, speedPercent: number) {
  const mph = Math.round(speedPercent * 180);
  ctx.fillStyle = "rgba(11, 11, 26, 0.6)";
  ctx.fillRect(16, 16, 150, 44);
  ctx.strokeStyle = "#c084fc";
  ctx.strokeRect(16, 16, 150, 44);
  ctx.fillStyle = "#e8e0ff";
  ctx.font = "bold 24px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`${mph} mph`, 30, 39);
}
