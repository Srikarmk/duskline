import type { Track, XZ } from "./track";

export interface MapDot {
  x: number;
  z: number;
  color: string;
}

/** Top-down minimap of the circuit, drawn onto the 2D HUD canvas. */
export class Minimap {
  private pts: XZ[];
  private minX: number;
  private minZ: number;
  private scale: number;
  private w: number;
  private h: number;

  constructor(track: Track, samples = 160) {
    this.pts = track.sampleXZ(samples);
    const b = track.bounds;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.w = b.maxX - b.minX || 1;
    this.h = b.maxZ - b.minZ || 1;
    this.scale = 1; // set per-draw against the box size
  }

  draw(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    size: number,
    player: MapDot,
    opponents: MapDot[]
  ) {
    const pad = 14;
    const inner = size - pad * 2;
    this.scale = inner / Math.max(this.w, this.h);
    const offX = ox + pad + (inner - this.w * this.scale) / 2;
    const offY = oy + pad + (inner - this.h * this.scale) / 2;
    const px = (x: number) => offX + (x - this.minX) * this.scale;
    const py = (z: number) => offY + (z - this.minZ) * this.scale;

    // panel
    ctx.fillStyle = "rgba(11, 11, 26, 0.65)";
    ctx.fillRect(ox, oy, size, size * (this.h / Math.max(this.w, this.h)) + pad);
    ctx.strokeStyle = "#c084fc";
    ctx.strokeRect(ox, oy, size, size * (this.h / Math.max(this.w, this.h)) + pad);

    // track ribbon
    ctx.strokeStyle = "#5b5378";
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.beginPath();
    this.pts.forEach((p, i) => {
      const X = px(p.x), Y = py(p.z);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = "#a99fd0";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // start line marker
    const s = this.pts[0];
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(px(s.x) - 3, py(s.z) - 3, 6, 6);

    // opponents
    for (const o of opponents) {
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(px(o.x), py(o.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // player
    ctx.fillStyle = "#67e8f9";
    ctx.strokeStyle = "#0b0b1a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px(player.x), py(player.z), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
