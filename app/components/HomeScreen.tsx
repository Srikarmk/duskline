"use client";

import { useEffect, useState } from "react";
import type { GameMode, GameResult } from "@/src/game/engine";
import { loadScores, loadLastName, type ScoreEntry } from "@/src/ui/leaderboard";

interface Props {
  lastResult: GameResult | null;
  onStart: (name: string, mode: GameMode) => void;
}

function formatTime(ms: number) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function HomeScreen({ lastResult, onStart }: Props) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("classic");
  const [scores, setScores] = useState<ScoreEntry[]>([]);

  useEffect(() => {
    setName(loadLastName());
    setScores(loadScores());
  }, []);

  const canStart = name.trim().length > 0;

  return (
    <div className="home">
      <h1 className="title">FANTASY RACER</h1>
      <p className="subtitle">a pseudo-3D magic kart racer</p>

      {lastResult && (
        <div className="result-banner">
          <strong>RACE COMPLETE!</strong> Score {lastResult.score} · {" "}
          {lastResult.gems} gems · {lastResult.stunts} stunts · {" "}
          {formatTime(lastResult.timeMs)}
        </div>
      )}

      <label className="field">
        <span>RACER NAME</span>
        <input
          value={name}
          maxLength={14}
          placeholder="enter your name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canStart) onStart(name.trim(), mode);
          }}
        />
      </label>

      <div className="modes">
        <button
          className={`mode-card ${mode === "classic" ? "selected" : ""}`}
          onClick={() => setMode("classic")}
        >
          <strong>CLASSIC CIRCUIT</strong>
          <span>3 laps. Gems, stunts, nitro, clean-lane bonuses.</span>
        </button>
        <button
          className={`mode-card ${mode === "transform" ? "selected" : ""}`}
          onClick={() => setMode("transform")}
        >
          <strong>TRANSFORMER RUSH</strong>
          <span>Grab orbs to morph into a mech — smash rocks and fly.</span>
        </button>
      </div>

      <button
        className="start"
        disabled={!canStart}
        onClick={() => onStart(name.trim(), mode)}
      >
        START RACE
      </button>

      <p className="controls-help">
        drive: ARROWS / WASD · nitro: SHIFT · fly (mech): SPACE · spin mid-air
        for stunt points
      </p>

      {scores.length > 0 && (
        <div className="leaderboard">
          <h2>HALL OF LEGENDS</h2>
          <table>
            <tbody>
              {scores.map((s, i) => (
                <tr key={i}>
                  <td>{i + 1}.</td>
                  <td>{s.name}</td>
                  <td>{s.mode === "classic" ? "CIRCUIT" : "RUSH"}</td>
                  <td>{formatTime(s.timeMs)}</td>
                  <td className="score">{s.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
