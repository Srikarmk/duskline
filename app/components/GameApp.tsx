"use client";

import { useState } from "react";
import type { GameMode, RealmId, GameResult } from "@/src/game/engine";
import { saveScore, saveLastName } from "@/src/ui/leaderboard";
import HomeScreen from "./HomeScreen";
import GameCanvas from "./GameCanvas";

export default function GameApp() {
  const [screen, setScreen] = useState<"home" | "race">("home");
  const [mode, setMode] = useState<GameMode>("classic");
  const [realm, setRealm] = useState<RealmId>("forest");
  const [name, setName] = useState("");
  const [lastResult, setLastResult] = useState<GameResult | null>(null);

  if (screen === "race") {
    return (
      <GameCanvas
        mode={mode}
        realm={realm}
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
      onStart={(playerName, playerMode, playerRealm) => {
        setName(playerName);
        saveLastName(playerName);
        setMode(playerMode);
        setRealm(playerRealm);
        setLastResult(null);
        setScreen("race");
      }}
    />
  );
}
