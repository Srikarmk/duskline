"use client";

import { useEffect, useRef } from "react";
import { Game, type GameMode, type GameResult } from "@/src/game/engine";

interface Props {
  mode: GameMode;
  onFinish: (result: GameResult) => void;
}

export default function GameCanvas({ mode, onFinish }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new Game(canvas, {
      mode,
      onFinish: (result) => onFinishRef.current(result),
    });
    game.start();
    return () => game.stop();
  }, [mode]);

  return <canvas ref={canvasRef} width={800} height={600} />;
}
