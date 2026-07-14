"use client";

import { useEffect, useRef } from "react";
import { Game } from "@/src/game/engine";

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new Game(canvas);
    game.start();
    return () => game.stop();
  }, []);

  return <canvas ref={canvasRef} width={800} height={600} />;
}
