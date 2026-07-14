import type { SpriteType } from "./road";

/** Sprite width relative to the road's half-width on screen. */
export const SPRITE_SCALE: Record<SpriteType, number> = {
  crystal: 0.35,
  tree: 0.4,
  rock: 0.24,
  gem: 0.14,
  airGem: 0.15,
  nitro: 0.16,
  ramp: 0.42,
  orb: 0.2,
};

/** Collision half-width in playerX offset units (road half-width = 1). */
export const COLLIDE_WIDTH: Record<SpriteType, number> = {
  crystal: 0,
  tree: 0,
  rock: 0.28,
  gem: 0.24,
  airGem: 0.28,
  nitro: 0.24,
  ramp: 0.4,
  orb: 0.32,
};

/**
 * Draw a sprite procedurally. (x, baseY) is the bottom-center anchor on the
 * road surface; w is the on-screen width.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  type: SpriteType,
  x: number,
  baseY: number,
  w: number,
  time: number
) {
  if (w < 2) return;
  switch (type) {
    case "crystal": {
      const h = w * 1.7;
      ctx.fillStyle = "#7c3aed";
      tri(ctx, x - w * 0.3, baseY, x - w * 0.05, baseY, x - w * 0.2, baseY - h * 0.6);
      ctx.fillStyle = "#a855f7";
      tri(ctx, x - w * 0.15, baseY, x + w * 0.25, baseY, x + w * 0.05, baseY - h);
      ctx.fillStyle = "#c084fc";
      tri(ctx, x + w * 0.1, baseY, x + w * 0.4, baseY, x + w * 0.28, baseY - h * 0.5);
      break;
    }
    case "tree": {
      const h = w * 2;
      ctx.fillStyle = "#3f2d63";
      ctx.fillRect(x - w * 0.08, baseY - h * 0.5, w * 0.16, h * 0.5);
      const glow = ctx.createRadialGradient(x, baseY - h * 0.65, w * 0.1, x, baseY - h * 0.65, w * 0.55);
      glow.addColorStop(0, "#5eead4");
      glow.addColorStop(1, "#0d9488");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, baseY - h * 0.65, w * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "rock": {
      const h = w * 0.85;
      ctx.fillStyle = "#4c4666";
      ctx.beginPath();
      ctx.moveTo(x - w * 0.5, baseY);
      ctx.lineTo(x - w * 0.35, baseY - h * 0.7);
      ctx.lineTo(x, baseY - h);
      ctx.lineTo(x + w * 0.4, baseY - h * 0.6);
      ctx.lineTo(x + w * 0.5, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#6b6390";
      tri(ctx, x - w * 0.15, baseY - h * 0.4, x + w * 0.2, baseY - h * 0.5, x, baseY - h);
      break;
    }
    case "gem":
    case "airGem": {
      const bob = Math.sin(time * 4 + x * 0.05) * w * 0.15;
      const cy = baseY - w * 0.7 + bob;
      const r = w * 0.5;
      ctx.fillStyle = type === "gem" ? "#22d3ee" : "#fbbf24";
      diamond(ctx, x, cy, r);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      diamond(ctx, x - r * 0.2, cy - r * 0.2, r * 0.3);
      if (type === "airGem") {
        ctx.strokeStyle = "rgba(251,191,36,0.5)";
        ctx.lineWidth = Math.max(1, w * 0.06);
        ctx.beginPath();
        ctx.arc(x, cy, r * 1.4, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case "nitro": {
      const h = w * 1.3;
      ctx.fillStyle = "#0e7490";
      roundRect(ctx, x - w * 0.35, baseY - h, w * 0.7, h, w * 0.15);
      ctx.fillStyle = "#67e8f9";
      tri(ctx, x - w * 0.18, baseY - h * 0.3, x + w * 0.18, baseY - h * 0.3, x, baseY - h * 0.8);
      break;
    }
    case "ramp": {
      const h = w * 0.55;
      ctx.fillStyle = "#b45309";
      ctx.beginPath();
      ctx.moveTo(x - w * 0.5, baseY);
      ctx.lineTo(x + w * 0.5, baseY);
      ctx.lineTo(x + w * 0.38, baseY - h);
      ctx.lineTo(x - w * 0.38, baseY - h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fbbf24";
      for (let i = -1; i <= 1; i++) {
        tri(ctx, x + i * w * 0.28 - w * 0.08, baseY - h * 0.2, x + i * w * 0.28 + w * 0.08, baseY - h * 0.2, x + i * w * 0.28, baseY - h * 0.85);
      }
      break;
    }
    case "orb": {
      const cy = baseY - w * 0.8 + Math.sin(time * 3) * w * 0.2;
      const r = w * 0.55;
      const glow = ctx.createRadialGradient(x, cy, r * 0.1, x, cy, r);
      glow.addColorStop(0, "#f0abfc");
      glow.addColorStop(0.6, "#d946ef");
      glow.addColorStop(1, "rgba(217,70,239,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = Math.max(1, w * 0.05);
      ctx.beginPath();
      ctx.ellipse(x, cy, r * 0.8, r * 0.3, time * 2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
}

function tri(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.fill();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.7, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.7, y);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
