"use client";

import { useEffect, useRef, useState } from "react";
import { Game } from "@/src/game3d/engine";
import type { GameMode, RealmId, CarId, GameResult } from "@/src/game/engine";
import { checkCapability } from "@/src/game3d/capability";
import { loadSettings, saveSettings } from "@/src/ui/settings";
import { reportError } from "@/src/ui/report";
import { read } from "@/src/ui/storage";
import { REALMS } from "@/src/game3d/realms";
import { CAR_SPECS } from "@/src/game3d/carData";
import PauseMenu from "./PauseMenu";
import GameErrorBoundary from "./GameErrorBoundary";
import TouchControls from "./TouchControls";
import FirstRunHint from "./FirstRunHint";
import PhotoMode from "./PhotoMode";

interface Props {
  mode: GameMode;
  realm: RealmId;
  car: CarId;
  laps: number;
  /** watch a recorded lap instead of driving one */
  replay?: number[];
  onFinish: (result: GameResult) => void;
  onQuit: () => void;
}

export default function GameCanvas({ mode, realm, car, laps, replay, onFinish, onQuit }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  // Latest-callback ref, so the engine can be built once and still call the
  // current onFinish. Assigned in an EFFECT, not in the render body: writing a
  // ref during render is a real violation rather than a style point — render
  // has to be pure for React to be free to re-run or discard it, and Next 16's
  // lint config is the first thing here to say so. The engine only reads this
  // when a race ends, which is always long after commit, so being one commit
  // behind during render cannot matter.
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);
  const [paused, setPaused] = useState(false);
  const [runId, setRunId] = useState(0);
  // Checked once, before anything is built. See capability.ts — without this a
  // machine that cannot run the engine just gets a black canvas.
  const [cap] = useState(() => checkCapability());
  const [fatal, setFatal] = useState<string | null>(null);
  // Coarse pointer = no hover and a finger-sized hit target, i.e. a phone or a
  // tablet. Feature detection rather than a user-agent string, so a touchscreen
  // laptop gets the pads too and a desktop never does.
  const [touch, setTouch] = useState(false);
  /** Audio was blocked by the browser's autoplay policy; offer a tap. */
  const [muted, setMuted] = useState(false);
  /** Free camera up, HUD hidden. See PhotoMode. */
  const [photo, setPhoto] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    setTouch(coarse);
    // FIRST RUN ONLY: pick a starting quality from what the hardware looks
    // like. capability.lowPower flags software renderers and old integrated
    // parts; a phone gets medium because the whole post chain is per-pixel and
    // a phone has a lot of pixels for its GPU. After this the player's own
    // choice is respected — it is only ever a default, never an override.
    try {
      if (!read("settings")) {
        const tier = cap.lowPower ? "low" : coarse ? "medium" : "high";
        saveSettings({ quality: tier });
      }
    } catch { /* storage blocked — high is a fine default */ }
    void loadSettings;
  }, [cap.lowPower]);

  // Errors thrown inside requestAnimationFrame never reach a React error
  // boundary, and the render loop is where this engine spends its life — so
  // the window handler is the one that actually catches an engine crash.
  useEffect(() => {
    const onErr = (e: ErrorEvent) => {
      if (fatal) return;
      // NOT every window error is ours. Browser extensions, injected scripts
      // and anything else on the page report here too, and killing the race
      // with "The race stopped." because an extension threw is a bug that
      // looks exactly like our own crash. Our code is always served from this
      // origin; a cross-origin script gives an empty filename and the opaque
      // "Script error." — neither is something we should claim.
      const ours = Boolean(e.filename) && e.filename.startsWith(window.location.origin);
      if (!ours) return;
      reportError(e.error ?? e.message, {
        source: "raf",
        tags: { mode, realm, car, quality: loadSettings().quality },
        extra: { file: e.filename, line: e.lineno, renderer: cap.renderer },
      });
      setFatal(e.message || "Unknown rendering error");
      gameRef.current?.stop();
    };
    window.addEventListener("error", onErr);
    return () => window.removeEventListener("error", onErr);
  }, [fatal, mode, realm, car, cap.renderer]);

  // (re)create the game when mode/realm change or on restart
  useEffect(() => {
    if (!cap.ok || fatal) return;
    const mount = mountRef.current;
    if (!mount) return;
    const game = new Game(mount, {
      mode,
      realm,
      car,
      laps,
      replay,
      onFinish: (result) => onFinishRef.current(result),
      // The async world build is the likeliest thing to fail on someone
      // else's machine, and a rejected promise reaches neither the React
      // boundary nor the window listener above. Without this it is a frozen
      // loading screen with no way out.
      onError: (err) => {
        reportError(err, {
          source: "init",
          tags: { mode, realm, car, quality: loadSettings().quality },
          extra: { renderer: cap.renderer },
        });
        setFatal(err instanceof Error ? err.message : String(err));
      },
    });
    gameRef.current = game;
    game.start();
    setPaused(false);
    return () => {
      game.stop();
      gameRef.current = null;
    };
  }, [mode, realm, car, laps, replay, runId, cap.ok, fatal, cap.renderer]);

  // AUDIO AUTOPLAY. The race starts from a click, so the AudioContext is
  // normally allowed — but iOS Safari only honours a resume() made INSIDE the
  // gesture's own call stack, and `Game.start()` runs a tick later from an
  // effect. When that happens the whole race is silent with no explanation and
  // no way back. So: check once the engine is up, and if audio is still
  // blocked, offer a real tap. Any pointer on the stage also does it, which is
  // what actually resolves it for most people.
  useEffect(() => {
    if (!cap.ok || fatal) return;
    const t = window.setTimeout(() => {
      if (gameRef.current?.audioBlocked()) setMuted(true);
    }, 600);
    const wake = () => {
      gameRef.current?.unlockAudio();
      if (!gameRef.current?.audioBlocked()) setMuted(false);
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [cap.ok, fatal, runId]);

  // Esc / P toggles pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Photo mode owns Escape while it is up — it has its own handler that
      // returns you to the pause menu rather than un-pausing the race.
      if (photo) return;
      // A REPLAY has no race to pause. Pausing one would offer Restart and
      // Quit for a lap that is already in the past, so Escape just leaves.
      if (replay) {
        if (e.key === "Escape") {
          e.preventDefault();
          onQuit();
        }
        return;
      }
      if (e.key === "Escape" || e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaused((p) => {
          const next = !p;
          if (next) gameRef.current?.pause();
          else gameRef.current?.resume();
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photo, replay, onQuit]);

  if (!cap.ok) {
    return (
      <div className="fatal">
        <h2>This device can&apos;t run the game.</h2>
        <p>{cap.reason}</p>
        <div className="fatal-actions">
          <button type="button" className="ghost" onClick={onQuit}>◂ BACK TO MENU</button>
        </div>
      </div>
    );
  }

  if (fatal) {
    return (
      <div className="fatal">
        <h2>The race stopped.</h2>
        <p>
          Something in the 3D engine failed. If it happened as the world was
          loading, a retry often works — the assets come over the network. This
          is a bug, not something you did.
        </p>
        <pre className="fatal-detail">{fatal}</pre>
        <div className="fatal-actions">
          <button type="button" onClick={() => { setFatal(null); setRunId((r) => r + 1); }}>
            ▸ TRY AGAIN
          </button>
          <button type="button" className="ghost" onClick={onQuit}>◂ BACK TO MENU</button>
        </div>
      </div>
    );
  }

  return (
    <GameErrorBoundary onQuit={onQuit} context={{ mode, realm, car }}>
    <div className="game-stage">
      <div ref={mountRef} className="game-mount" />
      {muted && (
        <button
          type="button"
          className="audio-unblock"
          onClick={() => { gameRef.current?.unlockAudio(); setMuted(false); }}
        >
          🔊 TAP FOR SOUND
        </button>
      )}
      {replay && (
        <button type="button" className="replay-exit" onClick={onQuit}>
          ◂ BACK TO RESULTS
        </button>
      )}
      {!replay && !paused && !photo && <FirstRunHint touch={touch} />}
      {!replay && touch && !paused && !photo && <TouchControls onPause={() => { gameRef.current?.pause(); setPaused(true); }} />}
      {photo && (
        <PhotoMode
          // Display names, not ids: the caption is part of the photograph's
          // frame, and "bay · imprez" is a database row, not a place and a car.
          realm={REALMS[realm]?.name ?? realm}
          car={CAR_SPECS[car]?.name ?? car}
          touch={touch}
          onShoot={() => gameRef.current?.capturePhoto()}
          onNudge={(d) => gameRef.current?.photoNudge(d)}
          onExit={() => {
            gameRef.current?.exitPhotoMode();
            setPhoto(false);
          }}
        />
      )}
      {paused && !photo && (
        <PauseMenu
          onResume={() => {
            gameRef.current?.resume();
            setPaused(false);
          }}
          onRestart={() => {
            setPaused(false);
            setRunId((r) => r + 1);
          }}
          onQuit={onQuit}
          onApply={(s) => gameRef.current?.applySettings(s)}
          onPhoto={() => {
            gameRef.current?.enterPhotoMode();
            setPhoto(true);
          }}
        />
      )}
    </div>
    </GameErrorBoundary>
  );
}
