import type { Track, XZ } from "./track";

export interface MapDot {
  x: number;
  z: number;
  color: string;
  /** Radians, same convention as freeDrive.heading: forward = (sin h, cos h). */
  heading?: number;
}

/** Top-down minimap of the circuit, drawn onto the 2D HUD canvas. */
export class Minimap {
  private pts: XZ[];
  private minX: number;
  private minZ: number;
  private scale: number;
  private w: number;
  private h: number;

  /** Alternate routes, as polylines in world XZ — drawn dashed beside the lap
   *  so a fork is something you can see coming rather than something you find
   *  by accident. */
  private routes: XZ[][] = [];

  setRoutes(routes: XZ[][]) {
    this.routes = routes;
  }

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
    ctx.strokeStyle = "#6a6290";
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

    // alternate routes: same weight as the lap, dashed and in the fork sign's
    // amber so the eye reads "this is a choice", not "this is the track"
    if (this.routes.length) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 3;
      for (const r of this.routes) {
        if (r.length < 2) continue;
        ctx.beginPath();
        r.forEach((p, i) => {
          const X = px(p.x), Y = py(p.z);
          if (i === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        });
        ctx.stroke();
      }
      ctx.restore();
    }

    // start line marker
    const s = this.pts[0];
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(px(s.x) - 3, py(s.z) - 3, 6, 6);

    // opponents — a dark rim so a pale livery still reads on the pale ribbon
    ctx.strokeStyle = "#0b0b1a";
    ctx.lineWidth = 1.5;
    for (const o of opponents) {
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(px(o.x), py(o.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // player: an arrow, not a dot. As a cyan dot it was the same shape as the
    // nine rivals and close in colour to the teal one, and it could not say
    // which way you were going — which is the question a glance at the map is for.
    const X = px(player.x), Y = py(player.z);
    ctx.save();
    ctx.translate(X, Y);
    if (player.heading !== undefined) ctx.rotate(Math.atan2(Math.cos(player.heading), Math.sin(player.heading)));
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, 5.5);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-5, -5.5);
    ctx.closePath();
    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  }
}
