import { COLORS, LANES, WIDTH, HEIGHT, NITRO_MAX_CHARGES, TRANSFORM_DURATION } from "./constants";
import type { Segment, RoadSprite } from "./road";
import { drawSprite, SPRITE_SCALE } from "./sprites";

// --- background ---------------------------------------------------------

const STARS = (() => {
  const stars: { x: number; y: number; r: number }[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 90; i++) {
    stars.push({ x: rand() * WIDTH, y: rand() * HEIGHT * 0.45, r: rand() * 1.6 + 0.4 });
  }
  return stars;
})();

function mountainPath(seed: number, count: number): number[] {
  const heights: number[] = [];
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < count; i++) heights.push(30 + rand() * 60);
  return heights;
}

const FAR_PEAKS = mountainPath(3, 12);
const NEAR_PEAKS = mountainPath(11, 9);

function drawMountains(
  ctx: CanvasRenderingContext2D,
  peaks: number[],
  color: string,
  horizon: number,
  offset: number,
  scale: number
) {
  const span = WIDTH / (peaks.length - 2);
  const shift = ((offset % WIDTH) + WIDTH) % WIDTH;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-span, horizon);
  for (let i = -1; i <= peaks.length + 1; i++) {
    const h = peaks[((i % peaks.length) + peaks.length) % peaks.length];
    ctx.lineTo(i * span - shift + WIDTH / 2, horizon - h * scale);
  }
  ctx.lineTo(WIDTH + span, horizon);
  ctx.closePath();
  ctx.fill();
}

export function drawBackground(ctx: CanvasRenderingContext2D, bgOffset: number, horizonShift: number) {
  const horizon = HEIGHT / 2 + horizonShift;

  const sky = ctx.createLinearGradient(0, 0, 0, Math.max(horizon, 1));
  sky.addColorStop(0, COLORS.sky.top);
  sky.addColorStop(1, COLORS.sky.bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "#e8e0ff";
  for (const s of STARS) {
    ctx.globalAlpha = 0.4 + (s.r / 2) * 0.6;
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  drawMountains(ctx, FAR_PEAKS, COLORS.mountainFar, horizon, bgOffset * 0.4, 1.2);
  drawMountains(ctx, NEAR_PEAKS, COLORS.mountainNear, horizon, bgOffset, 0.8);

  const glow = ctx.createLinearGradient(0, horizon - 50, 0, horizon);
  glow.addColorStop(0, "rgba(192, 132, 252, 0)");
  glow.addColorStop(1, "rgba(192, 132, 252, 0.35)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, horizon - 50, WIDTH, 50);

  // ground haze below the horizon; road segments draw over this
  ctx.fillStyle = COLORS.fog;
  ctx.fillRect(0, horizon, WIDTH, HEIGHT - horizon);
}

// --- road ---------------------------------------------------------------

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

export function drawSegment(ctx: CanvasRenderingContext2D, segment: Segment, fog: number) {
  const { p1, p2, palette } = segment;
  const colors = COLORS[palette];

  const r1 = p1.screen.w / Math.max(6, 2 * LANES);
  const r2 = p2.screen.w / Math.max(6, 2 * LANES);

  ctx.fillStyle = colors.grass;
  ctx.fillRect(0, p2.screen.y, WIDTH, p1.screen.y - p2.screen.y);

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
  polygon(ctx,
    p1.screen.x - p1.screen.w, p1.screen.y,
    p1.screen.x + p1.screen.w, p1.screen.y,
    p2.screen.x + p2.screen.w, p2.screen.y,
    p2.screen.x - p2.screen.w, p2.screen.y,
    colors.road);

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

  if (fog > 0.01) {
    ctx.globalAlpha = fog;
    ctx.fillStyle = COLORS.fog;
    ctx.fillRect(0, p2.screen.y, WIDTH, p1.screen.y - p2.screen.y);
    ctx.globalAlpha = 1;
  }
}

export function drawSegmentSprite(
  ctx: CanvasRenderingContext2D,
  segment: Segment,
  sprite: RoadSprite,
  liftPx: number,
  time: number
) {
  const { p1 } = segment;
  const x = p1.screen.x + p1.screen.w * sprite.offset;
  const w = p1.screen.w * SPRITE_SCALE[sprite.type];
  const y = p1.screen.y - liftPx;
  if (segment.clip <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, WIDTH, segment.clip);
  ctx.clip();
  drawSprite(ctx, sprite.type, x, y, w, time);
  ctx.restore();
}

// --- player -------------------------------------------------------------

export interface PlayerRenderState {
  steer: number;
  altPx: number;
  spinRev: number; // mid-air rotation, in revolutions
  transformed: boolean;
  flying: boolean;
  nitroActive: boolean;
  time: number;
}

export function drawPlayer(ctx: CanvasRenderingContext2D, s: PlayerRenderState) {
  const x = WIDTH / 2;
  const groundY = HEIGHT - 60;
  const y = groundY - s.altPx;

  // shadow stays on the road
  const shrink = Math.min(s.altPx / 200, 0.6);
  ctx.fillStyle = `rgba(0, 0, 0, ${0.4 * (1 - shrink)})`;
  ctx.beginPath();
  ctx.ellipse(x, groundY + 22, 46 * (1 - shrink), 10 * (1 - shrink), 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(s.spinRev * Math.PI * 2);

  if (s.nitroActive || s.flying) {
    // exhaust flames
    const flick = 1 + Math.sin(s.time * 40) * 0.25;
    ctx.fillStyle = s.flying ? "#22d3ee" : "#fb923c";
    flame(ctx, -20, 20, 12 * flick);
    flame(ctx, 20, 20, 12 * flick);
    ctx.fillStyle = "#fef3c7";
    flame(ctx, -20, 20, 6 * flick);
    flame(ctx, 20, 20, 6 * flick);
  }

  if (s.transformed) {
    drawMech(ctx, s);
  } else {
    drawKart(ctx, s.steer);
  }

  ctx.restore();
}

function flame(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x - size * 0.5, y);
  ctx.lineTo(x + size * 0.5, y);
  ctx.lineTo(x, y + size * 2);
  ctx.closePath();
  ctx.fill();
}

function drawKart(ctx: CanvasRenderingContext2D, steer: number) {
  const lean = steer * 8;
  ctx.fillStyle = "#7c3aed";
  ctx.beginPath();
  ctx.moveTo(-40 + lean, 10);
  ctx.lineTo(-28 + lean, -18);
  ctx.lineTo(28 + lean, -18);
  ctx.lineTo(40 + lean, 10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#c084fc";
  ctx.beginPath();
  ctx.ellipse(lean, -18, 16, 8, 0, Math.PI, 0);
  ctx.fill();

  ctx.fillStyle = "#1e1b2e";
  ctx.fillRect(-46 + lean / 2, 4, 14, 18);
  ctx.fillRect(32 + lean / 2, 4, 14, 18);
}

function drawMech(ctx: CanvasRenderingContext2D, s: PlayerRenderState) {
  const lean = s.steer * 10;

  if (s.flying) {
    // swept wings
    ctx.fillStyle = "#0e7490";
    ctx.beginPath();
    ctx.moveTo(-18 + lean, -10);
    ctx.lineTo(-70 + lean, 8);
    ctx.lineTo(-24 + lean, 10);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(18 + lean, -10);
    ctx.lineTo(70 + lean, 8);
    ctx.lineTo(24 + lean, 10);
    ctx.closePath();
    ctx.fill();
  }

  // torso
  ctx.fillStyle = "#0891b2";
  ctx.beginPath();
  ctx.moveTo(-24 + lean, 16);
  ctx.lineTo(-18 + lean, -22);
  ctx.lineTo(18 + lean, -22);
  ctx.lineTo(24 + lean, 16);
  ctx.closePath();
  ctx.fill();

  // head
  ctx.fillStyle = "#67e8f9";
  ctx.fillRect(-9 + lean, -36, 18, 14);
  ctx.fillStyle = "#f0abfc";
  ctx.fillRect(-6 + lean, -32, 12, 4); // visor

  // arms
  ctx.fillStyle = "#155e75";
  ctx.fillRect(-34 + lean, -18, 10, 26);
  ctx.fillRect(24 + lean, -18, 10, 26);

  // legs / thrusters
  ctx.fillStyle = "#164e63";
  ctx.fillRect(-18 + lean / 2, 16, 12, 14);
  ctx.fillRect(6 + lean / 2, 16, 12, 14);

  // core glow
  const glow = ctx.createRadialGradient(lean, -6, 1, lean, -6, 10);
  glow.addColorStop(0, "#f0abfc");
  glow.addColorStop(1, "rgba(240,171,252,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(lean, -6, 10, 0, Math.PI * 2);
  ctx.fill();
}

// --- HUD ----------------------------------------------------------------

export interface HudState {
  mph: number;
  score: number;
  lap: number;
  totalLaps: number;
  raceTime: number;
  nitroCharges: number;
  nitroActive: boolean;
  transformT: number;
  crashFlash: number;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "rgba(11, 11, 26, 0.6)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#c084fc";
  ctx.strokeRect(x, y, w, h);
}

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const t = Math.floor((seconds * 10) % 10);
  return `${m}:${String(s).padStart(2, "0")}.${t}`;
}

export function drawHud(ctx: CanvasRenderingContext2D, hud: HudState) {
  ctx.textBaseline = "middle";

  panel(ctx, 16, 16, 140, 40);
  ctx.fillStyle = "#e8e0ff";
  ctx.font = "bold 22px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`${hud.mph} mph`, 28, 37);

  panel(ctx, WIDTH - 196, 16, 180, 64);
  ctx.fillStyle = "#e8e0ff";
  ctx.font = "bold 22px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${hud.score}`, WIDTH - 28, 37);
  ctx.font = "14px monospace";
  ctx.fillText(`LAP ${hud.lap}/${hud.totalLaps}  ${formatTime(hud.raceTime)}`, WIDTH - 28, 62);

  // nitro charges
  panel(ctx, 16, HEIGHT - 56, 118, 40);
  for (let i = 0; i < NITRO_MAX_CHARGES; i++) {
    ctx.fillStyle = i < hud.nitroCharges ? (hud.nitroActive ? "#fb923c" : "#67e8f9") : "#333048";
    flame(ctx, 44 + i * 32, HEIGHT - 48, 9);
  }
  ctx.fillStyle = "#8b85a8";
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.fillText("SHIFT", 24, HEIGHT - 24);

  // transform timer
  if (hud.transformT > 0) {
    const w = 220;
    panel(ctx, WIDTH / 2 - w / 2, 16, w, 26);
    ctx.fillStyle = "#d946ef";
    ctx.fillRect(WIDTH / 2 - w / 2 + 3, 19, (w - 6) * (hud.transformT / TRANSFORM_DURATION), 20);
    ctx.fillStyle = "#fdf4ff";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    ctx.fillText("TRANSFORMED — SPACE TO FLY", WIDTH / 2, 29);
  }

  if (hud.crashFlash > 0) {
    ctx.fillStyle = `rgba(220, 38, 38, ${Math.min(hud.crashFlash, 0.35)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

export interface Toast {
  text: string;
  color: string;
  t: number; // remaining seconds
}

export function drawToasts(ctx: CanvasRenderingContext2D, toasts: Toast[]) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 20px monospace";
  toasts.forEach((toast, i) => {
    ctx.globalAlpha = Math.min(1, toast.t * 2);
    ctx.fillStyle = toast.color;
    ctx.fillText(toast.text, WIDTH / 2, 130 + i * 28);
  });
  ctx.globalAlpha = 1;
}

export function drawCenterText(ctx: CanvasRenderingContext2D, text: string, size = 64, color = "#e8e0ff") {
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(11, 11, 26, 0.5)";
  ctx.fillRect(0, HEIGHT / 2 - size, WIDTH, size * 2);
  ctx.fillStyle = color;
  ctx.fillText(text, WIDTH / 2, HEIGHT / 2);
}
