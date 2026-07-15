"use client";

import { useEffect, useState } from "react";
import type { GameMode, RealmId, CarId, GameResult } from "@/src/game/engine";
import { REALMS } from "@/src/game3d/realms";
import { CAR_SPECS, CAR_IDS, carColorHex } from "@/src/game3d/carData";
import {
  loadScores, loadLastName, loadLastCar, fetchGlobalScores,
  type ScoreEntry,
} from "@/src/ui/leaderboard";

interface Props {
  lastResult: GameResult | null;
  onStart: (name: string, mode: GameMode, realm: RealmId, car: CarId, laps: number) => void;
}

const LAP_OPTIONS = [1, 2, 3, 5, 7];

function stars(n: number) {
  return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
}

const MODES: { id: GameMode; name: string; blurb: string }[] = [
  { id: "classic", name: "CLASSIC CIRCUIT", blurb: "Race 8 AI rivals. Gems, stunts, nitro, power-ups." },
  { id: "timetrial", name: "TIME TRIAL", blurb: "Solo run — beat the clock over clean laps." },
  { id: "nitro", name: "NITRO SPRINT", blurb: "1 lap, full nitro, all-out sprint vs the pack." },
  { id: "transform", name: "TRANSFORMER RUSH", blurb: "Morph into a sword-mech — slash monsters and fly." },
  { id: "grandprix", name: "GRAND PRIX", blurb: "All 3 realms back-to-back for the championship." },
];

const MODE_LABEL: Record<GameMode, string> = {
  classic: "CIRCUIT", timetrial: "TRIAL", nitro: "SPRINT", transform: "RUSH", grandprix: "GP",
};

function formatTime(ms: number) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function HomeScreen({ lastResult, onStart }: Props) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("classic");
  const [realm, setRealm] = useState<RealmId>("forest");
  const [car, setCar] = useState<CarId>("comet");
  const [laps, setLaps] = useState(3);
  const [localScores, setLocalScores] = useState<ScoreEntry[]>([]);
  const [globalScores, setGlobalScores] = useState<ScoreEntry[] | null>(null);
  const [isGlobal, setIsGlobal] = useState(false);
  const [board, setBoard] = useState<"global" | "local">("global");

  useEffect(() => {
    setName(loadLastName());
    const savedCar = loadLastCar();
    if (savedCar && CAR_SPECS[savedCar]) setCar(savedCar);
    setLocalScores(loadScores());
    fetchGlobalScores().then((res) => {
      if (res) {
        setGlobalScores(res.scores);
        setIsGlobal(res.global);
      }
    });
  }, []);

  const canStart = name.trim().length > 0;
  const realmIds = Object.keys(REALMS) as RealmId[];
  const isGP = mode === "grandprix";
  const shownScores = board === "global" ? globalScores ?? [] : localScores;

  return (
    <div className="home">
      <div className="hero">
        <div className="hero-glow" />
        <h1 className="title">FANTASY RACER</h1>
        <p className="subtitle">drift · boost · jump · transform — a 3D magic kart racer</p>
        <div className="hero-tags">
          <span>4 REALMS</span><span>4 KARTS</span><span>9-RACER GRID</span>
          <span>POWER-UPS</span><span>GRAND PRIX</span>
        </div>
      </div>

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
            if (e.key === "Enter" && canStart) onStart(name.trim(), mode, realm, car, isGP ? 3 : laps);
          }}
        />
      </label>

      {!isGP ? (
        <>
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
        </>
      ) : (
        <div className="gp-note">
          Grand Prix runs all three realms in order:
          {" "}Enchanted Forest → Ember Wastes → Crystal Peaks. Championship
          points each round.
        </div>
      )}

      <div className="section-label">MACHINE</div>
      <div className="cars">
        {CAR_IDS.map((id) => {
          const spec = CAR_SPECS[id];
          const swatch = carColorHex(id);
          return (
            <button
              key={id}
              className={`car-card ${car === id ? "selected" : ""}`}
              onClick={() => setCar(id)}
              style={car === id ? { borderColor: swatch, boxShadow: `0 0 14px ${swatch}66` } : undefined}
            >
              <div className="car-head">
                <span className="car-chip" style={{ background: swatch }} />
                <strong>{spec.name}</strong>
              </div>
              <span className="car-blurb">{spec.blurb}</span>
              <div className="car-stats">
                <span>SPD <b style={{ color: swatch }}>{stars(spec.stars.speed)}</b></span>
                <span>ACC <b style={{ color: swatch }}>{stars(spec.stars.accel)}</b></span>
                <span>HDL <b style={{ color: swatch }}>{stars(spec.stars.handling)}</b></span>
              </div>
            </button>
          );
        })}
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

      {!isGP && mode !== "nitro" && (
        <>
          <div className="section-label">LAPS</div>
          <div className="laps">
            {LAP_OPTIONS.map((n) => (
              <button
                key={n}
                className={`lap-pill ${laps === n ? "selected" : ""}`}
                onClick={() => setLaps(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}

      <button
        className="start"
        disabled={!canStart}
        onClick={() => onStart(name.trim(), mode, realm, car, isGP ? 3 : laps)}
      >
        {canStart
          ? (isGP ? "▸ START GRAND PRIX" : `▸ START RACE — ${mode === "nitro" ? 1 : laps} LAP${(mode === "nitro" ? 1 : laps) > 1 ? "S" : ""}`)
          : "ENTER A RACER NAME"}
      </button>

      <p className="controls-help">
        drive: ARROWS / WASD · nitro: SPACE · use item: E · fly (mech): SHIFT ·
        camera: C · sound: M · pause: ESC · spin mid-air for stunts
      </p>

      <div className="leaderboard">
        <div className="board-head">
          <h2>HALL OF LEGENDS</h2>
          <div className="board-tabs">
            <button
              className={board === "global" ? "active" : ""}
              onClick={() => setBoard("global")}
            >
              GLOBAL
            </button>
            <button
              className={board === "local" ? "active" : ""}
              onClick={() => setBoard("local")}
            >
              THIS DEVICE
            </button>
          </div>
        </div>
        {board === "global" && !isGlobal && (
          <p className="board-hint">shared board activates once a KV store is connected</p>
        )}
        {shownScores.length === 0 ? (
          <p className="board-hint">no scores yet — be the first!</p>
        ) : (
          <table>
            <tbody>
              {shownScores.map((s, i) => (
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
        )}
      </div>
    </div>
  );
}
