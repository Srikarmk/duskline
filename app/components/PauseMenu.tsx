"use client";

import { useState } from "react";
import { loadSettings, saveSettings, type Settings } from "@/src/ui/settings";

interface Props {
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onApply: (s: Settings) => void;
}

export default function PauseMenu({ onResume, onRestart, onQuit, onApply }: Props) {
  const [view, setView] = useState<"menu" | "settings">("menu");
  const [s, setS] = useState<Settings>(() => loadSettings());

  const update = (patch: Partial<Settings>) => {
    const next = saveSettings(patch);
    setS(next);
    onApply(next);
  };

  return (
    <div className="pause-overlay">
      <div className="pause-panel">
        {view === "menu" ? (
          <>
            <h2>PAUSED</h2>
            <button className="start" onClick={onResume}>RESUME</button>
            <button className="pause-btn" onClick={() => setView("settings")}>SETTINGS</button>
            <button className="pause-btn" onClick={onRestart}>RESTART</button>
            <button className="pause-btn" onClick={onQuit}>QUIT TO MENU</button>
          </>
        ) : (
          <>
            <h2>SETTINGS</h2>
            <label className="set-row">
              <span>MUSIC</span>
              <input type="range" min={0} max={1} step={0.05} value={s.musicVolume}
                onChange={(e) => update({ musicVolume: +e.target.value })} />
            </label>
            <label className="set-row">
              <span>SFX</span>
              <input type="range" min={0} max={1} step={0.05} value={s.sfxVolume}
                onChange={(e) => update({ sfxVolume: +e.target.value })} />
            </label>
            {/* The tier is the control that actually matters on slow hardware:
                it moves render resolution, the shadow map and the whole post
                chain at once. The individual toggles below only nibble. */}
            <div className="set-row">
              <span>QUALITY</span>
              <span className="seg">
                {(["low", "medium", "high"] as const).map((q) => (
                  <button
                    type="button"
                    key={q}
                    className={s.quality === q ? "on" : ""}
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
            <p className="controls-help">
              arrows/WASD · nitro SPACE · item E · fly SHIFT · camera C · sound M · pause ESC
            </p>
            <button className="start" onClick={() => setView("menu")}>BACK</button>
          </>
        )}
      </div>
    </div>
  );
}
