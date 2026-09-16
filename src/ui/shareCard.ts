/**
 * Draws a shareable result card.
 *
 * Nothing the game produced was shareable. You finished a race, saw a number,
 * and that was the end of it — which for a browser game is the whole
 * distribution problem: the only way anyone hears about it is if a player has
 * something to show. Photo mode covers "look at this place"; this covers "look
 * what I did".
 *
 * A 2D canvas, not a WebGL grab: by the time the results screen is up the race
 * canvas is gone, and re-rendering a scene just to screenshot it would mean
 * keeping the whole engine alive for a postcard. The realm's own preview art is
 * already on disk and already the picture of that place.
 *
 * 1200x630 is the Open Graph / Twitter card aspect, so the same image works
 * pasted into a chat, attached to a post, or set as a share preview.
 */

export interface ShareCardData {
  realmName: string;
  realmId: string;
  carName: string;
  modeLabel: string;
  score: number;
  timeMs: number;
  position?: number;
  totalRacers?: number;
  isNewBest: boolean;
  racer: string;
}

const W = 1200;
const H = 630;

function formatTime(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(2).padStart(5, "0")}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // fall back to the gradient
    img.src = src;
  });
}

export async function drawShareCard(d: ShareCardData): Promise<string | null> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // --- the place ------------------------------------------------------------
  const art = await loadImage(`/previews/realm-${d.realmId}.webp`);
  if (art) {
    // cover-fit, anchored high: these renders put the horizon in the top third
    const scale = Math.max(W / art.width, H / art.height);
    const w = art.width * scale, h = art.height * scale;
    ctx.drawImage(art, (W - w) / 2, (H - h) * 0.35, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2a1b4d");
    g.addColorStop(1, "#0a0720");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Darken from the bottom so the type has something to sit on without hiding
  // the art — the same trick the realm cards use.
  const shade = ctx.createLinearGradient(0, H * 0.25, 0, H);
  shade.addColorStop(0, "rgba(6,4,20,0)");
  shade.addColorStop(0.55, "rgba(6,4,20,0.72)");
  shade.addColorStop(1, "rgba(6,4,20,0.95)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  // --- the wordmark ---------------------------------------------------------
  ctx.fillStyle = "#f3edff";
  ctx.font = "800 34px Orbitron, Arial Black, sans-serif";
  ctx.letterSpacing = "10px";
  ctx.fillText("DUSKLINE", 56, 84);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = "rgba(243,237,255,0.55)";
  ctx.font = "500 20px Rajdhani, Segoe UI, sans-serif";
  // 40px below the wordmark baseline: at 32 the two lines touched.
  ctx.fillText(`${d.realmName.toUpperCase()}  ·  ${d.carName}  ·  ${d.modeLabel}`, 58, 124);

  // --- the number that matters ---------------------------------------------
  ctx.fillStyle = "#fbbf24";
  ctx.font = "900 132px Orbitron, Arial Black, sans-serif";
  ctx.fillText(d.score.toLocaleString(), 52, H - 120);

  ctx.fillStyle = "rgba(243,237,255,0.6)";
  ctx.font = "700 22px Orbitron, Arial Black, sans-serif";
  ctx.letterSpacing = "6px";
  ctx.fillText("SCORE", 58, H - 78);
  ctx.letterSpacing = "0px";

  // --- the supporting figures, right-aligned -------------------------------
  const stats: [string, string][] = [["TIME", formatTime(d.timeMs)]];
  if (d.position && d.totalRacers) stats.push(["FINISH", `P${d.position} of ${d.totalRacers}`]);
  stats.push(["RACER", d.racer]);

  let y = H - 210;
  ctx.textAlign = "right";
  for (const [label, value] of stats) {
    ctx.fillStyle = "rgba(243,237,255,0.5)";
    ctx.font = "700 16px Orbitron, Arial Black, sans-serif";
    ctx.letterSpacing = "4px";
    ctx.fillText(label, W - 56, y);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = "#f3edff";
    ctx.font = "700 40px Rajdhani, Segoe UI, sans-serif";
    ctx.fillText(value, W - 56, y + 42);
    y += 76;
  }
  ctx.textAlign = "left";

  // --- a personal best is the thing worth shouting about -------------------
  if (d.isNewBest) {
    const label = "PERSONAL BEST";
    ctx.font = "800 20px Orbitron, Arial Black, sans-serif";
    ctx.letterSpacing = "5px";
    const w = ctx.measureText(label).width + 44;
    ctx.fillStyle = "#22d3ee";
    ctx.beginPath();
    ctx.roundRect(52, H - 286, w, 44, 22);
    ctx.fill();
    ctx.fillStyle = "#06121a";
    ctx.fillText(label, 74, H - 256);
    ctx.letterSpacing = "0px";
  }

  // --- where to go and play it ---------------------------------------------
  ctx.fillStyle = "rgba(243,237,255,0.42)";
  ctx.font = "600 19px Rajdhani, Segoe UI, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillText("playduskline.vercel.app", 56, H - 34);
  ctx.letterSpacing = "0px";

  return canvas.toDataURL("image/png");
}

/** Hand the card to the OS share sheet, or fall back to a download. */
export async function shareCard(dataUrl: string, realmName: string): Promise<"shared" | "downloaded"> {
  const name = `duskline-${realmName.toLowerCase().replace(/\s+/g, "-")}.png`;
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], name, { type: "image/png" });

  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "Duskline" });
      return "shared";
    } catch {
      // dismissed, or the OS refused — fall through to the download
    }
  }
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
  return "downloaded";
}
