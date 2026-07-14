"use client";

import { useState } from "react";
import type { GameMode, GameResult } from "@/src/game/engine";
import { saveScore, saveLastName } from "@/src/ui/leaderboard";
import HomeScreen from "./HomeScreen";
import GameCanvas from "./GameCanvas";

export default function GameApp() {
  const [screen, setScreen] = useState<"home" | "race">("home");
  const [mode, setMode] = useState<GameMode>("classic");
  const [name, setName] = useState("");
  const [lastResult, setLastResult] = useState<GameResult | null>(null);

  if (screen === "race") {
    return (
      <GameCanvas
        mode={mode}
        onFinish={(result) => {
          saveScore(name, result);
          setLastResult(result);
          setScreen("home");
        }}
      />
    );
  }

  return (
    <HomeScreen
      lastResult={lastResult}
      onStart={(playerName, playerMode) => {
        setName(playerName);
        saveLastName(playerName);
        setMode(playerMode);
        setLastResult(null);
        setScreen("race");
      }}
    />
  );
}
