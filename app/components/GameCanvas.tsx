"use client";

import { useEffect, useRef, useState } from "react";
import { Game } from "@/src/game3d/engine";
import type { GameMode, RealmId, CarId, GameResult } from "@/src/game/engine";
import PauseMenu from "./PauseMenu";

interface Props {
  mode: GameMode;
  realm: RealmId;
  car: CarId;
  laps: number;
  onFinish: (result: GameResult) => void;
  onQuit: () => void;
}

export default function GameCanvas({ mode, realm, car, laps, onFinish, onQuit }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const [paused, setPaused] = useState(false);
  const [runId, setRunId] = useState(0);

  // (re)create the game when mode/realm change or on restart
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const game = new Game(mount, {
      mode,
      realm,
      car,
      laps,
      onFinish: (result) => onFinishRef.current(result),
    });
    gameRef.current = game;
    game.start();
    setPaused(false);
    return () => {
      game.stop();
      gameRef.current = null;
    };
  }, [mode, realm, car, laps, runId]);

  // Esc / P toggles pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, []);

  return (
    <div className="game-stage">
      <div ref={mountRef} className="game-mount" />
      {paused && (
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
        />
      )}
    </div>
  );
}
