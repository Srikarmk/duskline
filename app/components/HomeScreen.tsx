"use client";

import { useEffect, useState } from "react";
import type { GameMode, RealmId, GameResult } from "@/src/game/engine";
import { REALMS } from "@/src/game3d/realms";
import { loadScores, loadLastName, type ScoreEntry } from "@/src/ui/leaderboard";

interface Props {
  lastResult: GameResult | null;
  onStart: (name: string, mode: GameMode, realm: RealmId) => void;
}

const MODES: { id: GameMode; name: string; blurb: string }[] = [
  { id: "classic", name: "CLASSIC CIRCUIT", blurb: "3 laps vs 3 AI racers. Gems, stunts, nitro." },
  { id: "timetrial", name: "TIME TRIAL", blurb: "Solo run. Beat the clock over 3 clean laps." },
  { id: "nitro", name: "NITRO SPRINT", blurb: "1 lap, full nitro, all-out sprint vs the pack." },
  { id: "transform", name: "TRANSFORMER RUSH", blurb: "Grab orbs to morph into a sword-mech — slash monsters and fly." },
];

const MODE_LABEL: Record<GameMode, string> = {
  classic: "CIRCUIT", timetrial: "TRIAL", nitro: "SPRINT", transform: "RUSH",
};

function formatTime(ms: number) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function HomeScreen({ lastResult, onStart }: Props) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("classic");
  const [realm, setRealm] = useState<RealmId>("forest");
  const [scores, setScores] = useState<ScoreEntry[]>([]);

  useEffect(() => {
    setName(loadLastName());
    setScores(loadScores());
  }, []);

  const canStart = name.trim().length > 0;
  const realmIds = Object.keys(REALMS) as RealmId[];

  return (
    <div className="home">
      <h1 className="title">FANTASY RACER</h1>
      <p className="subtitle">a 3D magic kart racer</p>

      {lastResult && (
        <div className="result-banner">
          <strong>RACE COMPLETE!</strong> Score {lastResult.score}
          {lastResult.position && lastResult.totalRacers
            ? ` · P${lastResult.position}/${lastResult.totalRacers}`
            : ""}
          {" · "}
          {lastResult.gems} gems · {lastResult.stunts} stunts · {formatTime(lastResult.timeMs)}
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
            if (e.key === "Enter" && canStart) onStart(name.trim(), mode, realm);
          }}
        />
      </label>

      <div className="section-label">REALM</div>
      <div className="realms">
        {realmIds.map((id) => (
          <button
            key={id}
            className={`mode-card ${realm === id ? "selected" : ""}`}
            onClick={() => setRealm(id)}
          >
            <strong>{REALMS[id].name}</strong>
            <span>{REALMS[id].blurb}</span>
          </button>
        ))}
      </div>

      <div className="section-label">MODE</div>
      <div className="modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`mode-card ${mode === m.id ? "selected" : ""}`}
            onClick={() => setMode(m.id)}
          >
            <strong>{m.name}</strong>
            <span>{m.blurb}</span>
          </button>
        ))}
      </div>

      <button
        className="start"
        disabled={!canStart}
        onClick={() => onStart(name.trim(), mode, realm)}
      >
        START RACE
      </button>

      <p className="controls-help">
        drive: ARROWS / WASD · nitro: SPACE · fly (mech): SHIFT · camera: C ·
        spin mid-air for stunts
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
                  <td>{MODE_LABEL[s.mode] ?? s.mode}</td>
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
