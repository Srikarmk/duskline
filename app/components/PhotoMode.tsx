"use client";

import { useEffect, useState } from "react";

interface Props {
  /** Render the current frame and hand back a PNG data URL. */
  onShoot: () => string | undefined;
  onExit: () => void;
  /** Nudge the orbit — used by the on-screen buttons and by touch. */
  onNudge: (d: { yaw?: number; pitch?: number; dist?: number; fov?: number }) => void;
  realm: string;
  car: string;
  touch: boolean;
}

/**
 * The photo-mode overlay.
 *
 * Deliberately almost nothing: a hint line and a shutter. Every pixel of chrome
 * here is a pixel of the photograph you cannot see, which is the whole reason
 * this mode exists — the HUD is hidden while it is up.
 *
 * Keyboard steers the orbit directly in the engine's render loop (it already
 * owns the Input instance); the buttons exist for touch, where there is no
 * keyboard to hold.
 */
export default function PhotoMode({ onShoot, onExit, onNudge, realm, car, touch }: Props) {
  const [flash, setFlash] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const shoot = () => {
    const url = onShoot();
    if (!url) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 220);
    // Name it after what is in it, so a folder of these is still legible.
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const a = document.createElement("a");
    a.href = url;
    a.download = `duskline-${realm.toLowerCase().replace(/\s+/g, "-")}-${stamp}.png`;
    a.click();
    setSaved(`${realm} · ${car}`);
    window.setTimeout(() => setSaved(null), 2600);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // SPACE is the shutter and ESC leaves. Both are swallowed so they do not
      // also reach the engine (space is nitro) or the pause toggle.
      // …unless a button has focus: Space is how a keyboard presses DONE, and it
      // used to take a photo instead.
      const onButton = e.target instanceof HTMLElement && e.target.closest("button");
      if (e.key === " " && !onButton) {
        e.preventDefault();
        e.stopPropagation();
        shoot();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onExit();
      }
    };
    // Capture phase: GameCanvas has its own window-level Escape handler for
    // pausing, and photo mode has to win that race.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="photo-ui">
      {flash && <div className="photo-flash" aria-hidden="true" />}

      <div className="photo-bar">
        <span className="photo-tag">PHOTO</span>
        <span className="photo-what">{realm} · {car}</span>
        {!touch && (
          <span className="photo-keys">
            <b>← →</b> orbit · <b>↑ ↓</b> height · <b>Z X</b> dolly · <b>Q E</b> lens ·{" "}
            <b>SPACE</b> shutter · <b>ESC</b> back
          </span>
        )}
        <button type="button" className="photo-exit" onClick={onExit}>DONE</button>
      </div>

      {touch && (
        <div className="photo-pads">
          <button type="button" onClick={() => onNudge({ yaw: -0.25 })} aria-label="Orbit left">◀</button>
          <button type="button" onClick={() => onNudge({ pitch: 0.12 })} aria-label="Raise camera">▲</button>
          <button type="button" onClick={() => onNudge({ pitch: -0.12 })} aria-label="Lower camera">▼</button>
          <button type="button" onClick={() => onNudge({ yaw: 0.25 })} aria-label="Orbit right">▶</button>
          <button type="button" onClick={() => onNudge({ dist: -1.2 })} aria-label="Move closer">＋</button>
          <button type="button" onClick={() => onNudge({ dist: 1.2 })} aria-label="Move further">－</button>
        </div>
      )}

      <button type="button" className="photo-shutter" onClick={shoot} aria-label="Take photo">
        <span />
      </button>

      {saved && <div className="photo-saved" role="status">SAVED — {saved}</div>}
    </div>
  );
}
