"use client";

import { useEffect, useRef, useState } from "react";
import { loadSettings, saveSettings, type Settings } from "@/src/ui/settings";
import { loadIdentity } from "@/src/ui/identity";
import { pushProfileSoon } from "@/src/ui/sync";

interface Props {
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onApply: (s: Settings) => void;
  /** Hide the HUD and hand the camera over — see PhotoMode. */
  onPhoto: () => void;
}

export default function PauseMenu({ onResume, onRestart, onQuit, onApply, onPhoto }: Props) {
  const [view, setView] = useState<"menu" | "settings">("menu");
  const [s, setS] = useState<Settings>(() => loadSettings());
  // RESTART and QUIT throw the race away, so each asks once: the first press
  // arms it, a second confirms, anything else disarms.
  const [armed, setArmed] = useState<"restart" | "quit" | null>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (view === "menu") resumeRef.current?.focus();
  }, [view]);

  const update = (patch: Partial<Settings>) => {
    const next = saveSettings(patch);
    setS(next);
    onApply(next);
    // Settings are the half of a profile a player notices missing on a second
    // machine. Debounced, so dragging a volume slider is one upload.
    pushProfileSoon(loadIdentity());
  };

  return (
    <div className="pause-overlay">
      <div className="pause-panel" role="dialog" aria-modal="true" aria-label={view === "menu" ? "Paused" : "Settings"}>
        {view === "menu" ? (
          <>
            <h2>PAUSED</h2>
            <button type="button" ref={resumeRef} className="start" onClick={onResume}>RESUME</button>
            <button type="button" className="pause-btn" onClick={() => { setArmed(null); onPhoto(); }}>PHOTO MODE</button>
            <button type="button" className="pause-btn" onClick={() => { setArmed(null); setView("settings"); }}>SETTINGS</button>
            <button
              type="button"
              className={`pause-btn ${armed === "restart" ? "armed" : ""}`}
              onClick={() => (armed === "restart" ? onRestart() : setArmed("restart"))}
              onBlur={() => armed === "restart" && setArmed(null)}
            >
              {armed === "restart" ? "PRESS AGAIN TO RESTART" : "RESTART"}
            </button>
            <button
              type="button"
              className={`pause-btn ${armed === "quit" ? "armed" : ""}`}
              onClick={() => (armed === "quit" ? onQuit() : setArmed("quit"))}
              onBlur={() => armed === "quit" && setArmed(null)}
            >
              {armed === "quit" ? "PRESS AGAIN TO QUIT" : "QUIT TO MENU"}
            </button>
          </>
        ) : (
          <>
            <h2>SETTINGS</h2>
            <label className="set-row">
              <span>MUSIC</span>
              <input type="range" min={0} max={1} step={0.05} value={s.musicVolume}
                aria-valuetext={`${Math.round(s.musicVolume * 100)}%`}
                onChange={(e) => update({ musicVolume: +e.target.value })} />
            </label>
            <label className="set-row">
              <span>SFX</span>
              <input type="range" min={0} max={1} step={0.05} value={s.sfxVolume}
                aria-valuetext={`${Math.round(s.sfxVolume * 100)}%`}
                onChange={(e) => update({ sfxVolume: +e.target.value })} />
            </label>
            {/* The tier is the control that actually matters on slow hardware:
                it moves render resolution, the shadow map and the whole post
                chain at once. The individual toggles below only nibble. */}
            <div className="set-row">
              <span>QUALITY</span>
              <span className="seg" role="group" aria-label="Quality">
                {(["low", "medium", "high"] as const).map((q) => (
                  <button
                    type="button"
                    key={q}
                    className={s.quality === q ? "on" : ""}
                    aria-pressed={s.quality === q}
                    onClick={() => update({ quality: q })}
                  >{q.toUpperCase()}</button>
                ))}
              </span>
            </div>
            <p className="set-note">
              Resolution and effects change now. Shadows and scenery density
              apply on the next race.
            </p>
            <label className="set-row">
              <span>SHOW FPS</span>
              <input type="checkbox" checked={s.showFps}
                onChange={(e) => update({ showFps: e.target.checked })} />
            </label>
            <label className="set-row">
              <span>GLOW (BLOOM)</span>
              <input type="checkbox" checked={s.bloom}
                onChange={(e) => update({ bloom: e.target.checked })} />
            </label>
            <label className="set-row">
              <span>EXTRA AO (COSTLY)</span>
              <input type="checkbox" checked={s.ao}
                onChange={(e) => update({ ao: e.target.checked })} />
            </label>
            <label className="set-row">
              <span>CAMERA</span>
              <select value={s.camera} onChange={(e) => update({ camera: +e.target.value })}>
                <option value={0}>Chase</option>
                <option value={1}>Cinematic</option>
                <option value={2}>Hood</option>
              </select>
            </label>
            {/* A real reference, not a one-line mnemonic. This is the only
                place in the game that explains drift charging or what a ramp
                wants, and the pause menu is where someone goes looking. */}
            <dl className="controls-ref">
              <div><dt>ARROWS / WASD</dt><dd>drive</dd></div>
              <div><dt>SPACE</dt><dd>nitro — one charge per press, three max</dd></div>
              <div><dt>drift</dt><dd>hold a slide for a boost as you straighten</dd></div>
              <div><dt>nitro cans</dt><dd>refill a charge; they also come back on their own</dd></div>
              <div><dt>ramps</dt><dd>hit them fast, land flat for a stunt bonus</dd></div>
              <div><dt>style chain</dt><dd>drifts, near misses and overtakes stack a pot at up to x6 — it banks when the fuse runs out, and you lose it all if you hit anything</dd></div>
              <div><dt>slipstream</dt><dd>tuck in close behind a rival for a tow, then pull out to pass</dd></div>
              <div><dt>weather</dt><dd>rain, snow and sand cost you grip in the corners — the readout top-left tells you how much</dd></div>
              <div><dt>E</dt><dd>fire (Space Wars)</dd></div>
              <div><dt>SHIFT</dt><dd>fly (mech)</dd></div>
              <div><dt>C</dt><dd>change camera</dd></div>
              <div><dt>M</dt><dd>mute</dd></div>
              <div><dt>ESC / P</dt><dd>pause</dd></div>
            </dl>
            <button type="button" className="start" onClick={() => setView("menu")}>BACK</button>
          </>
        )}
      </div>
    </div>
  );
}
