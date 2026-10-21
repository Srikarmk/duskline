"use client";

import { useEffect, useState } from "react";
import { read, write } from "@/src/ui/storage";

const KEY = "seen-controls";

/**
 * The controls, once, on the first race.
 *
 * Until now the only explanation of how to play was one line of small text on
 * the last step of setup — which you read while thinking about laps, and which
 * is gone by the time you are on the grid. Nothing ever said that drifting
 * charges nitro or that ramps want speed, so two of the three things that make
 * the game fun were discoverable only by accident.
 *
 * Shown once and never again (localStorage), dismissed by literally any input,
 * and it does NOT pause: the countdown is running behind it, so it has to be
 * something you can glance past rather than a modal you must deal with.
 */
export default function FirstRunHint({ touch }: { touch: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = read(KEY) === "1";
    } catch {
      // storage blocked — show it, showing it twice is not a problem
    }
    if (seen) return;
    setShow(true);
    const dismiss = () => {
      setShow(false);
      try {
        write(KEY, "1");
      } catch { /* not worth handling */ }
    };
    // Any input at all closes it, because the race has already started.
    window.addEventListener("keydown", dismiss, { once: true });
    window.addEventListener("pointerdown", dismiss, { once: true });
    const t = window.setTimeout(dismiss, 9000);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("pointerdown", dismiss);
    };
  }, []);

  if (!show) return null;

  const rows: [string, string][] = touch
    ? [
        ["◀ ▶ pads", "steer"],
        ["GO / BRK", "throttle and brakes"],   // what the pads actually say
        ["NOS", "nitro — one charge at a time"],
        ["drift", "hold a slide — you get a boost the moment you straighten"],
        ["ramps", "hit them fast, land flat"],
      ]
    : [
        ["ARROWS / WASD", "drive"],
        ["SPACE", "nitro"],
        ["C", "change camera"],
        ["drift", "hold a slide — you get a boost the moment you straighten"],
        ["ramps", "hit them fast, land flat"],
      ];

  return (
    <div className="first-run" role="note">
      <strong>HOW TO DRIVE</strong>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <em>{touch ? "tap anywhere to dismiss" : "any key to dismiss"}</em>
    </div>
  );
}
