"use client";

import { useEffect, useRef } from "react";

/**
 * On-screen driving controls for touch devices.
 *
 * The engine reads the keyboard through `Input`, which listens for real
 * keydown/keyup on `window`. Rather than teach it a second input path, these
 * pads synthesise those same events — so steering, throttle, brake and nitro
 * arrive through exactly the code that has already been tuned, and there is no
 * second set of driving behaviour to keep in step with the first.
 *
 * Laid out for thumbs: steering left, pedals right, nothing in the middle of
 * the screen where the road is.
 */
interface Props { onPause: () => void }

const KEY: Record<string, string> = {
  left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", nitro: " ",
};

export default function TouchControls({ onPause }: Props) {
  const held = useRef<Set<string>>(new Set());

  const press = (which: keyof typeof KEY, on: boolean) => {
    const key = KEY[which];
    if (on) {
      if (held.current.has(key)) return;
      held.current.add(key);
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    } else {
      if (!held.current.has(key)) return;
      held.current.delete(key);
      window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    }
  };

  // A finger can leave the element without firing touchend on it — lifting off
  // the edge of a pad would otherwise leave the car turning forever.
  useEffect(() => {
    const release = () => { for (const k of [...held.current]) {
      held.current.delete(k);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }));
    } };
    window.addEventListener("touchcancel", release);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", release);
    return () => {
      release();
      window.removeEventListener("touchcancel", release);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", release);
    };
  }, []);

  // `label` is what the pad shows; `name` is what a screen reader says —
  // "◀" and "BRK" are glyphs, not names.
  const pad = (which: keyof typeof KEY, label: string, cls: string, name: string) => (
    <button
      type="button"
      className={`tpad ${cls}`}
      aria-label={name}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); press(which, true); }}
      onPointerUp={(e) => { e.preventDefault(); press(which, false); }}
      onPointerCancel={() => press(which, false)}
      onPointerLeave={() => press(which, false)}
      onContextMenu={(e) => e.preventDefault()}
    >{label}</button>
  );

  return (
    <div className="touch">
      <div className="touch-left">
        {pad("left", "◀", "steer", "Steer left")}
        {pad("right", "▶", "steer", "Steer right")}
      </div>
      <div className="touch-right">
        {pad("nitro", "NOS", "nos", "Nitro")}
        {pad("down", "BRK", "brake", "Brake")}
        {pad("up", "GO", "gas", "Accelerate")}
      </div>
      <button type="button" className="touch-pause" onClick={onPause} aria-label="Pause">II</button>
    </div>
  );
}
