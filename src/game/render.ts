import { COLORS, LANES, WIDTH, HEIGHT, NITRO_MAX_CHARGES, TRANSFORM_DURATION } from "./constants";
import type { Segment, RoadSprite } from "./road";
import { drawSprite, SPRITE_SCALE } from "./sprites";

// --- background ---------------------------------------------------------

const STARS = (() => {
  const stars: { x: number; y: number; r: number; phase: number }[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 110; i++) {
    stars.push({
      x: rand() * WIDTH,
      y: rand() * HEIGHT * 0.42,
      r: rand() * 1.6 + 0.4,
      phase: rand() * Math.PI * 2,
    });
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
  colorTop: string,
  colorBottom: string,
  horizon: number,
  offset: number,
  scale: number
) {
  const span = WIDTH / (peaks.length - 2);
  const shift = ((offset % WIDTH) + WIDTH) % WIDTH;
  const grad = ctx.createLinearGradient(0, horizon - 90 * scale, 0, horizon);
  grad.addColorStop(0, colorTop);
  grad.addColorStop(1, colorBottom);
  ctx.fillStyle = grad;
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

function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tint: string) {
  const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.6);
  halo.addColorStop(0, "rgba(232, 224, 255, 0.35)");
  halo.addColorStop(1, "rgba(232, 224, 255, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
  ctx.fill();

  const face = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.2, x, y, r);
  face.addColorStop(0, "#f5f0ff");
  face.addColorStop(1, tint);
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // craters
  ctx.fillStyle = "rgba(120, 100, 170, 0.25)";
  ctx.beginPath();
  ctx.arc(x + r * 0.3, y + r * 0.2, r * 0.22, 0, Math.PI * 2);
  ctx.arc(x - r * 0.25, y + r * 0.45, r * 0.14, 0, Math.PI * 2);
  ctx.arc(x - r * 0.1, y - r * 0.4, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function drawAurora(ctx: CanvasRenderingContext2D, time: number, horizon: number) {
  const bands: { base: number; amp: number; hue: string; speed: number }[] = [
    { base: horizon - 230, amp: 26, hue: "rgba(94, 234, 212, 0.10)", speed: 0.5 },
    { base: horizon - 190, amp: 34, hue: "rgba(192, 132, 252, 0.10)", speed: 0.36 },
    { base: horizon - 150, amp: 22, hue: "rgba(103, 232, 249, 0.08)", speed: 0.62 },
  ];
  for (const band of bands) {
    ctx.fillStyle = band.hue;
    ctx.beginPath();
    ctx.moveTo(0, band.base);
    for (let x = 0; x <= WIDTH; x += 20) {
      ctx.lineTo(x, band.base + Math.sin(x * 0.012 + time * band.speed) * band.amp);
    }
    for (let x = WIDTH; x >= 0; x -= 20) {
      ctx.lineTo(x, band.base + 60 + Math.sin(x * 0.01 + time * band.speed + 1.5) * band.amp);
    }
    ctx.closePath();
    ctx.fill();
  }
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  bgOffset: number,
  horizonShift: number,
  time: number
) {
  const horizon = HEIGHT / 2 + horizonShift;

  const sky = ctx.createLinearGradient(0, 0, 0, Math.max(horizon, 1));
  sky.addColorStop(0, "#0d0821");
  sky.addColorStop(0.55, COLORS.sky.top);
  sky.addColorStop(1, COLORS.sky.bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawAurora(ctx, time, horizon);

  ctx.fillStyle = "#e8e0ff";
  for (const s of STARS) {
    ctx.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(time * 1.8 + s.phase));
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  drawMoon(ctx, WIDTH * 0.76 - bgOffset * 0.1, horizon - 250, 38, "#c7b8f5");
  drawMoon(ctx, WIDTH * 0.22 - bgOffset * 0.14, horizon - 180, 14, "#9ad5d0");

  drawMountains(ctx, FAR_PEAKS, "#3d2a6e", COLORS.mountainFar, horizon, bgOffset * 0.4, 1.2);
  drawMountains(ctx, NEAR_PEAKS, "#301f56", COLORS.mountainNear, horizon, bgOffset, 0.8);

  const glow = ctx.createLinearGradient(0, horizon - 50, 0, horizon);
  glow.addColorStop(0, "rgba(192, 132, 252, 0)");
  glow.addColorStop(1, "rgba(192, 132, 252, 0.4)");
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

export function drawSegment(
  ctx: CanvasRenderingContext2D,
  segment: Segment,
  fog: number,
  startLine: boolean
) {
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

  if (startLine) {
    // checkered band across the road
    const cols = 8;
    for (let c = 0; c < cols; c++) {
      const t1 = c / cols;
      const t2 = (c + 1) / cols;
      polygon(ctx,
        p1.screen.x - p1.screen.w + p1.screen.w * 2 * t1, p1.screen.y,
        p1.screen.x - p1.screen.w + p1.screen.w * 2 * t2, p1.screen.y,
        p2.screen.x - p2.screen.w + p2.screen.w * 2 * t2, p2.screen.y,
        p2.screen.x - p2.screen.w + p2.screen.w * 2 * t1, p2.screen.y,
        (c + segment.index) % 2 ? "#e8e0ff" : "#1e1b2e");
    }
  } else if (palette === "light") {
    const l1 = p1.screen.w / Math.max(32, 8 * LANES);
    const l2 = p2.screen.w / Math.max(32, 8 * LANES);
    const laneW1 = (p1.screen.w * 2) / LANES;
    const laneW2 = (p2.screen.w * 2) / LANES;
    let laneX1 = p1.screen.x - p1.screen.w + laneW1;
    let laneX2 = p2.screen.x - p2.screen.w + laneW2;
    for (let lane = 1; lane < LANES; lane++) {
      polygon(ctx,
        laneX1 - l1 * 1.6, p1.screen.y,
        laneX1 + l1 * 1.6, p1.screen.y,
        laneX2 + l2 * 1.6, p2.screen.y,
        laneX2 - l2 * 1.6, p2.screen.y,
        "rgba(216, 208, 240, 0.25)");
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
    const flick = 1 + Math.sin(s.time * 40) * 0.25;
    ctx.fillStyle = s.flying ? "#22d3ee" : "#fb923c";
    flame(ctx, -22, 18, 13 * flick);
    flame(ctx, 22, 18, 13 * flick);
    ctx.fillStyle = "#fef3c7";
    flame(ctx, -22, 18, 6 * flick);
    flame(ctx, 22, 18, 6 * flick);
  }

  if (s.transformed) {
    drawMech(ctx, s);
  } else {
    drawKart(ctx, s.steer, s.time);
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

function drawKart(ctx: CanvasRenderingContext2D, steer: number, time: number) {
  const lean = steer * 9;
  ctx.save();
  ctx.rotate(steer * 0.05);

  // hover under-glow
  const pulse = 0.75 + Math.sin(time * 9) * 0.25;
  const glow = ctx.createRadialGradient(0, 24, 3, 0, 24, 42);
  glow.addColorStop(0, `rgba(103, 232, 249, ${0.65 * pulse})`);
  glow.addColorStop(1, "rgba(103, 232, 249, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(0, 24, 44, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // body
  const body = ctx.createLinearGradient(0, -26, 0, 18);
  body.addColorStop(0, "#a855f7");
  body.addColorStop(0.55, "#7c3aed");
  body.addColorStop(1, "#4c1d95");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-42 + lean, 12);
  ctx.quadraticCurveTo(-48 + lean, -4, -30 + lean, -14);
  ctx.lineTo(30 + lean, -14);
  ctx.quadraticCurveTo(48 + lean, -4, 42 + lean, 12);
  ctx.quadraticCurveTo(0, 22, -42 + lean, 12);
  ctx.closePath();
  ctx.fill();

  // gold trim along the bottom edge
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-42 + lean, 12);
  ctx.quadraticCurveTo(0, 22, 42 + lean, 12);
  ctx.stroke();

  // rear thruster pods
  ctx.fillStyle = "#1e1b2e";
  ctx.beginPath();
  ctx.roundRect(-32 + lean, 2, 15, 16, 4);
  ctx.roundRect(17 + lean, 2, 15, 16, 4);
  ctx.fill();
  const podPulse = 0.6 + Math.sin(time * 14) * 0.4;
  ctx.fillStyle = `rgba(103, 232, 249, ${podPulse})`;
  ctx.beginPath();
  ctx.arc(-24.5 + lean, 10, 4, 0, Math.PI * 2);
  ctx.arc(24.5 + lean, 10, 4, 0, Math.PI * 2);
  ctx.fill();

  // glass canopy
  const canopy = ctx.createLinearGradient(0, -26, 0, -8);
  canopy.addColorStop(0, "#e0f2fe");
  canopy.addColorStop(1, "#38bdf8");
  ctx.fillStyle = canopy;
  ctx.beginPath();
  ctx.ellipse(lean * 1.2, -15, 15, 10, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(lean * 1.2 - 5, -19, 5, 2.5, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // tail fin
  ctx.fillStyle = "#6d28d9";
  ctx.beginPath();
  ctx.moveTo(lean - 3, -14);
  ctx.lineTo(lean + steer * 6, -30);
  ctx.lineTo(lean + 5, -14);
  ctx.closePath();
  ctx.fill();

  // glowing rune on the hood
  ctx.fillStyle = `rgba(240, 171, 252, ${0.5 + Math.sin(time * 5) * 0.3})`;
  ctx.beginPath();
  ctx.moveTo(lean, 0);
  ctx.lineTo(lean + 5, 6);
  ctx.lineTo(lean, 12);
  ctx.lineTo(lean - 5, 6);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawMech(ctx: CanvasRenderingContext2D, s: PlayerRenderState) {
  const lean = s.steer * 10;

  if (s.flying) {
    // swept gradient wings
    const wing = ctx.createLinearGradient(0, -12, 0, 12);
    wing.addColorStop(0, "#22d3ee");
    wing.addColorStop(1, "#0e7490");
    ctx.fillStyle = wing;
    ctx.beginPath();
    ctx.moveTo(-16 + lean, -12);
    ctx.lineTo(-74 + lean, 6);
    ctx.lineTo(-64 + lean, 14);
    ctx.lineTo(-20 + lean, 12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(16 + lean, -12);
    ctx.lineTo(74 + lean, 6);
    ctx.lineTo(64 + lean, 14);
    ctx.lineTo(20 + lean, 12);
    ctx.closePath();
    ctx.fill();
    // wingtip lights
    ctx.fillStyle = "#f0abfc";
    ctx.beginPath();
    ctx.arc(-70 + lean, 9, 3, 0, Math.PI * 2);
    ctx.arc(70 + lean, 9, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // legs with feet
  ctx.fillStyle = "#164e63";
  ctx.beginPath();
  ctx.roundRect(-18 + lean / 2, 12, 12, 18, 3);
  ctx.roundRect(6 + lean / 2, 12, 12, 18, 3);
  ctx.fill();
  ctx.fillStyle = "#0c3945";
  ctx.beginPath();
  ctx.roundRect(-21 + lean / 2, 26, 18, 7, 2);
  ctx.roundRect(3 + lean / 2, 26, 18, 7, 2);
  ctx.fill();

  // torso
  const torso = ctx.createLinearGradient(0, -24, 0, 16);
  torso.addColorStop(0, "#22d3ee");
  torso.addColorStop(0.5, "#0891b2");
  torso.addColorStop(1, "#155e75");
  ctx.fillStyle = torso;
  ctx.beginPath();
  ctx.moveTo(-22 + lean, 14);
  ctx.lineTo(-17 + lean, -22);
  ctx.lineTo(17 + lean, -22);
  ctx.lineTo(22 + lean, 14);
  ctx.closePath();
  ctx.fill();

  // shoulder pauldrons
  ctx.fillStyle = "#0e7490";
  ctx.beginPath();
  ctx.roundRect(-36 + lean, -24, 16, 12, 4);
  ctx.roundRect(20 + lean, -24, 16, 12, 4);
  ctx.fill();
  ctx.strokeStyle = "#67e8f9";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-33 + lean, -21, 10, 6);
  ctx.strokeRect(23 + lean, -21, 10, 6);

  // arms
  ctx.fillStyle = "#155e75";
  ctx.beginPath();
  ctx.roundRect(-34 + lean, -12, 10, 24, 3);
  ctx.roundRect(24 + lean, -12, 10, 24, 3);
  ctx.fill();

  // head: helmet + visor + antenna
  ctx.fillStyle = "#164e63";
  ctx.beginPath();
  ctx.roundRect(-10 + lean, -38, 20, 16, 4);
  ctx.fill();
  ctx.fillStyle = `rgba(240, 171, 252, ${0.7 + Math.sin(s.time * 6) * 0.3})`;
  ctx.fillRect(-7 + lean, -33, 14, 4);
  ctx.strokeStyle = "#67e8f9";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(8 + lean, -38);
  ctx.lineTo(12 + lean, -46);
  ctx.stroke();
  ctx.fillStyle = "#f0abfc";
  ctx.beginPath();
  ctx.arc(12 + lean, -47, 2, 0, Math.PI * 2);
  ctx.fill();

  // chest core
  const glow = ctx.createRadialGradient(lean, -5, 1, lean, -5, 11);
  glow.addColorStop(0, "#fdf4ff");
  glow.addColorStop(0.4, "#f0abfc");
  glow.addColorStop(1, "rgba(240,171,252,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(lean, -5, 11, 0, Math.PI * 2);
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
  position?: number;
  totalRacers?: number;
  cameraName?: string;
  soundMuted?: boolean;
  heldItem?: string | null;
  shieldActive?: boolean;
  carName?: string;
}

function panel(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  accent = "#c084fc"
) {
  ctx.fillStyle = "rgba(11, 11, 26, 0.55)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // corner ticks for a HUD-ish feel
  ctx.strokeStyle = "rgba(240, 171, 252, 0.9)";
  ctx.lineWidth = 2;
  const t = 7;
  ctx.beginPath();
  ctx.moveTo(x, y + t); ctx.lineTo(x, y); ctx.lineTo(x + t, y);
  ctx.moveTo(x + w - t, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - t);
  ctx.stroke();
}

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const t = Math.floor((seconds * 10) % 10);
  return `${m}:${String(s).padStart(2, "0")}.${t}`;
}

export function drawHud(
  ctx: CanvasRenderingContext2D, hud: HudState, vw = WIDTH, vh = HEIGHT
) {
  ctx.textBaseline = "middle";

  // --- speed (top-left) ---
  panel(ctx, 16, 16, 168, 66);
  ctx.fillStyle = hud.nitroActive ? "#fb923c" : "#e8e0ff";
  ctx.font = "bold 30px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`${hud.mph}`, 28, 40);
  ctx.fillStyle = "#8b85a8";
  ctx.font = "11px monospace";
  ctx.fillText("MPH", 92, 44);
  if (hud.carName) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#c084fc";
    ctx.font = "bold 12px monospace";
    ctx.fillText(hud.carName, 176, 30);
  }
  // speed bar
  ctx.fillStyle = "#241f3a";
  ctx.fillRect(28, 62, 144, 8);
  const spd = Math.min(hud.mph / 190, 1);
  const grad = ctx.createLinearGradient(28, 0, 172, 0);
  grad.addColorStop(0, "#22d3ee");
  grad.addColorStop(0.7, hud.nitroActive ? "#fb923c" : "#67e8f9");
  grad.addColorStop(1, hud.nitroActive ? "#fbbf24" : "#a855f7");
  ctx.fillStyle = grad;
  ctx.fillRect(28, 62, 144 * spd, 8);

  // --- score + lap/time (top-right) ---
  panel(ctx, vw - 200, 16, 184, 66);
  ctx.fillStyle = "#fbbf24";
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${hud.score}`, vw - 28, 38);
  ctx.fillStyle = "#cfc9e8";
  ctx.font = "14px monospace";
  ctx.fillText(`LAP ${hud.lap}/${hud.totalLaps}   ${formatTime(hud.raceTime)}`, vw - 28, 64);

  // --- race position (below score) ---
  if (hud.position && hud.totalRacers) {
    const ord = ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH", "7TH", "8TH", "9TH"][hud.position - 1] ?? `${hud.position}TH`;
    const lead = hud.position === 1;
    panel(ctx, vw - 200, 90, 184, 46, lead ? "#fbbf24" : "#c084fc");
    ctx.fillStyle = lead ? "#fbbf24" : "#f0abfc";
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "right";
    ctx.fillText(ord, vw - 28, 114);
    ctx.fillStyle = "#8b85a8";
    ctx.font = "12px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`of ${hud.totalRacers}`, vw - 192, 114);
  }

  // --- nitro charges (bottom-left) ---
  panel(ctx, 16, vh - 60, 128, 44);
  for (let i = 0; i < NITRO_MAX_CHARGES; i++) {
    ctx.fillStyle = i < hud.nitroCharges ? (hud.nitroActive ? "#fb923c" : "#67e8f9") : "#333048";
    flame(ctx, 44 + i * 32, vh - 50, 10);
  }
  ctx.fillStyle = "#8b85a8";
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText("[SPACE] NITRO", 24, vh - 24);

  // --- control hints (bottom-left, above nitro) ---
  if (hud.cameraName) {
    ctx.fillStyle = "#6f6a8a";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`[C] ${hud.cameraName}    [M] SOUND ${hud.soundMuted ? "OFF" : "ON"}    [ESC] PAUSE`, 18, vh - 74);
  }

  // --- transform timer (top center) ---
  if (hud.transformT > 0) {
    const w = 240;
    panel(ctx, vw / 2 - w / 2, 16, w, 28, "#d946ef");
    ctx.fillStyle = "#d946ef";
    ctx.fillRect(vw / 2 - w / 2 + 4, 20, (w - 8) * (hud.transformT / TRANSFORM_DURATION), 20);
    ctx.fillStyle = "#fdf4ff";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    ctx.fillText("TRANSFORMED — SHIFT TO FLY", vw / 2, 30);
  }

  // --- held-item slot (top center, below the transform banner) ---
  const iw = 180;
  const iy = hud.transformT > 0 ? 52 : 16;
  panel(ctx, vw / 2 - iw / 2, iy, iw, 34, hud.heldItem ? "#f0abfc" : "#3b3355");
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  if (hud.heldItem) {
    ctx.fillStyle = "#f0abfc";
    ctx.font = "bold 16px monospace";
    ctx.fillText(`◆ ${hud.heldItem}  [E]`, vw / 2, iy + 18);
  } else {
    ctx.fillStyle = "#55506e";
    ctx.font = "12px monospace";
    ctx.fillText("— ITEM SLOT —", vw / 2, iy + 18);
  }

  // shield = cyan border glow
  if (hud.shieldActive) {
    ctx.strokeStyle = "rgba(103, 232, 249, 0.6)";
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, vw - 12, vh - 12);
  }

  if (hud.crashFlash > 0) {
    ctx.fillStyle = `rgba(220, 38, 38, ${Math.min(hud.crashFlash, 0.35)})`;
    ctx.fillRect(0, 0, vw, vh);
  }
}

/** Sense-of-speed overlay: a darkening vignette + radial streaks that build up
 *  with speed and flare during a boost. Drawn under the HUD panels. */
export function drawSpeedFx(
  ctx: CanvasRenderingContext2D,
  vw: number, vh: number, speed01: number, boost: boolean, time: number
) {
  const intensity = Math.max(0, speed01 - 0.35) / 0.65;
  const amt = Math.min(1, intensity * 1.15 + (boost ? 0.5 : 0));
  if (amt <= 0.01) return;
  const cx = vw / 2, cy = vh * 0.52;

  // vignette
  const vg = ctx.createRadialGradient(cx, cy, Math.min(vw, vh) * 0.28, cx, cy, Math.max(vw, vh) * 0.62);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, `rgba(3,2,12,${(0.3 * amt + (boost ? 0.12 : 0)).toFixed(3)})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, vw, vh);

  // radial motion streaks (re-seeded per frame → shimmering rush)
  const n = Math.round(amt * 64);
  let seed = (Math.floor(time * 42) % 4096) + 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rad = Math.max(vw, vh);
  ctx.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = rad * (0.34 + rnd() * 0.16);
    const len = (26 + rnd() * 90) * (0.5 + amt);
    const ca = Math.cos(a), sa = Math.sin(a);
    ctx.strokeStyle = boost
      ? `rgba(251,176,90,${(rnd() * 0.5 * amt).toFixed(3)})`
      : `rgba(206,222,255,${(rnd() * 0.42 * amt).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(cx + ca * r0, cy + sa * r0);
    ctx.lineTo(cx + ca * (r0 + len), cy + sa * (r0 + len));
    ctx.stroke();
  }
}

export interface Toast {
  text: string;
  color: string;
  t: number; // remaining seconds
}

export function drawToasts(ctx: CanvasRenderingContext2D, toasts: Toast[], vw = WIDTH) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 22px monospace";
  toasts.forEach((toast, i) => {
    ctx.globalAlpha = Math.min(1, toast.t * 2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillText(toast.text, vw / 2 + 1, 151 + i * 30);
    ctx.fillStyle = toast.color;
    ctx.fillText(toast.text, vw / 2, 150 + i * 30);
  });
  ctx.globalAlpha = 1;
}

export function drawCenterText(
  ctx: CanvasRenderingContext2D, text: string, size = 64, color = "#e8e0ff",
  vw = WIDTH, vh = HEIGHT
) {
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(11, 11, 26, 0.5)";
  ctx.fillRect(0, vh / 2 - size, vw, size * 2);
  ctx.fillStyle = color;
  ctx.fillText(text, vw / 2, vh / 2);
}
