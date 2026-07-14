import type { SpriteType } from "./road";

/** Sprite width relative to the road's half-width on screen. */
export const SPRITE_SCALE: Record<SpriteType, number> = {
  crystal: 0.35,
  tree: 0.4,
  mushroom: 0.3,
  pillar: 0.28,
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
  mushroom: 0,
  pillar: 0,
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
      // soft glow behind the cluster
      const halo = ctx.createRadialGradient(x, baseY - h * 0.4, w * 0.1, x, baseY - h * 0.4, w * 0.9);
      halo.addColorStop(0, "rgba(192, 132, 252, 0.25)");
      halo.addColorStop(1, "rgba(192, 132, 252, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, baseY - h * 0.4, w * 0.9, 0, Math.PI * 2);
      ctx.fill();

      shard(ctx, x - w * 0.22, baseY, w * 0.28, h * 0.62, "#7c3aed", "#a855f7");
      shard(ctx, x + w * 0.05, baseY, w * 0.34, h, "#a855f7", "#d8b4fe");
      shard(ctx, x + w * 0.3, baseY, w * 0.24, h * 0.48, "#c084fc", "#e9d5ff");
      break;
    }
    case "tree": {
      const h = w * 2;
      const trunk = ctx.createLinearGradient(x, baseY - h * 0.55, x, baseY);
      trunk.addColorStop(0, "#4b3a72");
      trunk.addColorStop(1, "#2e2350");
      ctx.fillStyle = trunk;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.1, baseY);
      ctx.quadraticCurveTo(x - w * 0.03, baseY - h * 0.3, x - w * 0.05, baseY - h * 0.55);
      ctx.lineTo(x + w * 0.05, baseY - h * 0.55);
      ctx.quadraticCurveTo(x + w * 0.03, baseY - h * 0.3, x + w * 0.1, baseY);
      ctx.closePath();
      ctx.fill();

      const cy = baseY - h * 0.66;
      const glow = ctx.createRadialGradient(x - w * 0.15, cy - w * 0.15, w * 0.08, x, cy, w * 0.55);
      glow.addColorStop(0, "#99f6e4");
      glow.addColorStop(0.6, "#2dd4bf");
      glow.addColorStop(1, "#0f766e");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, cy, w * 0.5, 0, Math.PI * 2);
      ctx.fill();
      // fireflies in the canopy
      ctx.fillStyle = `rgba(254, 240, 138, ${0.5 + Math.sin(time * 3 + x) * 0.4})`;
      ctx.beginPath();
      ctx.arc(x + w * 0.2, cy - w * 0.1, w * 0.05, 0, Math.PI * 2);
      ctx.arc(x - w * 0.25, cy + w * 0.15, w * 0.04, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "mushroom": {
      const h = w * 1.4;
      // stem
      const stem = ctx.createLinearGradient(x, baseY - h * 0.7, x, baseY);
      stem.addColorStop(0, "#f5f0ff");
      stem.addColorStop(1, "#b8aed6");
      ctx.fillStyle = stem;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.14, baseY);
      ctx.quadraticCurveTo(x - w * 0.08, baseY - h * 0.4, x - w * 0.1, baseY - h * 0.6);
      ctx.lineTo(x + w * 0.1, baseY - h * 0.6);
      ctx.quadraticCurveTo(x + w * 0.08, baseY - h * 0.4, x + w * 0.14, baseY);
      ctx.closePath();
      ctx.fill();
      // cap with under-glow
      const cap = ctx.createLinearGradient(x, baseY - h, x, baseY - h * 0.5);
      cap.addColorStop(0, "#f472b6");
      cap.addColorStop(1, "#be185d");
      ctx.fillStyle = cap;
      ctx.beginPath();
      ctx.ellipse(x, baseY - h * 0.58, w * 0.5, h * 0.42, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(251, 207, 232, ${0.5 + Math.sin(time * 2.5 + x) * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(x, baseY - h * 0.58, w * 0.44, h * 0.06, 0, 0, Math.PI);
      ctx.fill();
      // spots
      ctx.fillStyle = "#fdf2f8";
      ctx.beginPath();
      ctx.arc(x - w * 0.2, baseY - h * 0.78, w * 0.06, 0, Math.PI * 2);
      ctx.arc(x + w * 0.15, baseY - h * 0.88, w * 0.05, 0, Math.PI * 2);
      ctx.arc(x + w * 0.3, baseY - h * 0.68, w * 0.04, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "pillar": {
      const h = w * 2.4;
      const col = ctx.createLinearGradient(x - w * 0.3, 0, x + w * 0.3, 0);
      col.addColorStop(0, "#3f3a5c");
      col.addColorStop(0.5, "#5d5680");
      col.addColorStop(1, "#332e4e");
      ctx.fillStyle = col;
      ctx.fillRect(x - w * 0.22, baseY - h * 0.9, w * 0.44, h * 0.9);
      // capital + base
      ctx.fillStyle = "#4a4468";
      ctx.fillRect(x - w * 0.32, baseY - h, w * 0.64, h * 0.12);
      ctx.fillRect(x - w * 0.32, baseY - h * 0.08, w * 0.64, h * 0.08);
      // glowing rune band
      ctx.fillStyle = `rgba(94, 234, 212, ${0.55 + Math.sin(time * 2 + x * 0.1) * 0.35})`;
      ctx.fillRect(x - w * 0.22, baseY - h * 0.62, w * 0.44, h * 0.07);
      ctx.fillRect(x - w * 0.12, baseY - h * 0.45, w * 0.24, h * 0.05);
      break;
    }
    case "rock": {
      const h = w * 0.85;
      const grad = ctx.createLinearGradient(x, baseY - h, x, baseY);
      grad.addColorStop(0, "#6b6390");
      grad.addColorStop(1, "#403a5c");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.5, baseY);
      ctx.lineTo(x - w * 0.35, baseY - h * 0.7);
      ctx.lineTo(x, baseY - h);
      ctx.lineTo(x + w * 0.4, baseY - h * 0.6);
      ctx.lineTo(x + w * 0.5, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(232, 224, 255, 0.18)";
      tri(ctx, x - w * 0.15, baseY - h * 0.4, x + w * 0.2, baseY - h * 0.5, x, baseY - h);
      break;
    }
    case "gem":
    case "airGem": {
      const bob = Math.sin(time * 4 + x * 0.05) * w * 0.15;
      const cy = baseY - w * 0.7 + bob;
      const r = w * 0.5;
      const sparkle = ctx.createRadialGradient(x, cy, r * 0.1, x, cy, r * 1.6);
      sparkle.addColorStop(0, type === "gem" ? "rgba(103,232,249,0.5)" : "rgba(253,224,71,0.5)");
      sparkle.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sparkle;
      ctx.beginPath();
      ctx.arc(x, cy, r * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = type === "gem" ? "#22d3ee" : "#fbbf24";
      diamond(ctx, x, cy, r);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      diamond(ctx, x - r * 0.2, cy - r * 0.2, r * 0.3);
      if (type === "airGem") {
        ctx.strokeStyle = "rgba(251,191,36,0.55)";
        ctx.lineWidth = Math.max(1, w * 0.06);
        ctx.beginPath();
        ctx.arc(x, cy, r * 1.4, time * 2, time * 2 + Math.PI * 1.5);
        ctx.stroke();
      }
      break;
    }
    case "nitro": {
      const h = w * 1.3;
      const can = ctx.createLinearGradient(x - w * 0.35, 0, x + w * 0.35, 0);
      can.addColorStop(0, "#155e75");
      can.addColorStop(0.5, "#0ea5e9");
      can.addColorStop(1, "#0e7490");
      ctx.fillStyle = can;
      ctx.beginPath();
      ctx.roundRect(x - w * 0.35, baseY - h, w * 0.7, h, w * 0.15);
      ctx.fill();
      ctx.fillStyle = "#67e8f9";
      tri(ctx, x - w * 0.18, baseY - h * 0.3, x + w * 0.18, baseY - h * 0.3, x, baseY - h * 0.8);
      break;
    }
    case "ramp": {
      const h = w * 0.55;
      const face = ctx.createLinearGradient(x, baseY - h, x, baseY);
      face.addColorStop(0, "#d97706");
      face.addColorStop(1, "#92400e");
      ctx.fillStyle = face;
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

function shard(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  w: number,
  h: number,
  dark: string,
  light: string
) {
  const grad = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  grad.addColorStop(0, dark);
  grad.addColorStop(1, light);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, baseY);
  ctx.lineTo(x, baseY - h);
  ctx.lineTo(x + w / 2, baseY);
  ctx.closePath();
  ctx.fill();
  // facet line
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(0.5, w * 0.06);
  ctx.beginPath();
  ctx.moveTo(x, baseY - h);
  ctx.lineTo(x - w * 0.15, baseY);
  ctx.stroke();
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
