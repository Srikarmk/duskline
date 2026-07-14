"use client";

import { useEffect, useRef } from "react";
import { Game } from "@/src/game3d/engine";
import type { GameMode, GameResult } from "@/src/game/engine";

interface Props {
  mode: GameMode;
  onFinish: (result: GameResult) => void;
}

export default function GameCanvas({ mode, onFinish }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const game = new Game(stage, {
      mode,
      onFinish: (result) => onFinishRef.current(result),
    });
    game.start();
    return () => game.stop();
  }, [mode]);

  return <div ref={stageRef} className="game-stage" />;
}
