"use client";

import { useEffect, useRef } from "react";
import { Game } from "@/src/game3d/engine";
import type { GameMode, RealmId, GameResult } from "@/src/game/engine";

interface Props {
  mode: GameMode;
  realm: RealmId;
  onFinish: (result: GameResult) => void;
}

export default function GameCanvas({ mode, realm, onFinish }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const game = new Game(stage, {
      mode,
      realm,
      onFinish: (result) => onFinishRef.current(result),
    });
    game.start();
    return () => game.stop();
  }, [mode, realm]);

  return <div ref={stageRef} className="game-stage" />;
}
