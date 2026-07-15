"use client";

import { useEffect, useState } from "react";
import type { GameMode, RealmId, CarId, GameResult } from "@/src/game/engine";
import { REALMS, REALM_LORE } from "@/src/game3d/realms";
import { CAR_SPECS, CAR_IDS, carColorHex } from "@/src/game3d/carData";
import dynamic from "next/dynamic";
import {
  loadScores, loadLastName, loadLastCar, fetchGlobalScores,
  type ScoreEntry,
} from "@/src/ui/leaderboard";

// live 3D garage preview — client-only (WebGL), so it must never be SSR'd
const CarShowroom = dynamic(() => import("./CarShowroom"), { ssr: false });

interface Props {
  lastResult: GameResult | null;
  onStart: (name: string, mode: GameMode, realm: RealmId, car: CarId, laps: number) => void;
}

const LAP_OPTIONS = [1, 2, 3, 5, 7];

function stars(n: number) {
  return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
}

const MODES: { id: GameMode; name: string; blurb: string }[] = [
  { id: "classic", name: "CLASSIC CIRCUIT", blurb: "Race 7 AI rivals. Gems, stunts, nitro, power-ups." },
  { id: "timetrial", name: "TIME TRIAL", blurb: "Solo run — beat the clock over clean laps." },
  { id: "nitro", name: "NITRO SPRINT", blurb: "1 lap, full nitro, all-out sprint vs the pack." },
  { id: "transform", name: "TRANSFORMER RUSH", blurb: "Morph into a sword-mech — slash monsters and fly." },
];

const MODE_LABEL: Record<GameMode, string> = {
  classic: "CIRCUIT", timetrial: "TRIAL", nitro: "SPRINT", transform: "RUSH", grandprix: "GP", spacewars: "WARS",
};

const STEPS: { n: number; label: string; hint: string }[] = [
  { n: 1, label: "REALM", hint: "Choose your world." },
  { n: 2, label: "MACHINE", hint: "Pick your kart." },
  { n: 3, label: "MODE", hint: "How do you want to race?" },
  { n: 4, label: "RACE", hint: "Name in, lights out." },
];

function formatTime(ms: number) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Thematic fallback gradient for a realm preview, from its sky palette. */
function realmFallback(id: RealmId): string {
  const sky = REALMS[id].palette.sky;
  return `linear-gradient(160deg, ${sky[0]} 0%, ${sky[1]} 38%, ${sky[2]} 72%, ${sky[3]} 100%)`;
}

export default function HomeScreen({ lastResult, onStart }: Props) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("classic");
  const [realm, setRealm] = useState<RealmId>("forest");
  const [car, setCar] = useState<CarId>("comet");
  const [laps, setLaps] = useState(3);
  const [step, setStep] = useState(1);
  const [realmPicked, setRealmPicked] = useState(false);
  const [carPicked, setCarPicked] = useState(false);
  const [localScores, setLocalScores] = useState<ScoreEntry[]>([]);
  const [globalScores, setGlobalScores] = useState<ScoreEntry[] | null>(null);
  const [isGlobal, setIsGlobal] = useState(false);
  const [board, setBoard] = useState<"global" | "local">("global");

  useEffect(() => {
    setName(loadLastName());
    const savedCar = loadLastCar();
    if (savedCar && CAR_SPECS[savedCar]) {
      setCar(savedCar);
      setCarPicked(true);
    }
    setLocalScores(loadScores());
    fetchGlobalScores().then((res) => {
      if (res) {
        setGlobalScores(res.scores);
        setIsGlobal(res.global);
      }
    });
  }, []);

  const realmIds = (Object.keys(REALMS) as RealmId[]).filter((id) => !REALMS[id].hidden);
  const isSpace = mode === "spacewars";
  const shownScores = board === "global" ? globalScores ?? [] : localScores;
  const canStart = name.trim().length > 0 && realmPicked && carPicked;

  // Which steps the breadcrumb lets you jump to (mode always has a default).
  const reachable = (n: number) =>
    n === 1 ||
    (n === 2 && realmPicked) ||
    (n >= 3 && realmPicked && carPicked);

  const goStep = (n: number) => {
    if (reachable(n)) setStep(n);
  };

  const launch = () => {
    if (canStart) onStart(name.trim(), mode, realm, car, laps);
  };

  const nextDisabled = (step === 1 && !realmPicked) || (step === 2 && !carPicked);

  return (
    <div className="home">
      <div className="hero hero-compact">
        <div className="hero-glow" />
        <h1 className="title">FANTASY RACER</h1>
        <p className="subtitle">drift · boost · jump · blast</p>
        <div className="hero-tags">
          <span>8 WORLDS</span><span>8 KARTS</span><span>4 MODES</span>
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

      <div className="wizard">
        {/* Step indicator / breadcrumb */}
        <div className="wiz-steps" role="tablist" aria-label="Setup steps">
          {STEPS.map((s, i) => {
            const state =
              s.n === step ? "active" : s.n < step ? "done" : "";
            const canGo = reachable(s.n);
            return (
              <div key={s.n} className="wiz-step-wrap">
                <button
                  className={`wiz-step ${state} ${canGo ? "reachable" : ""}`}
                  onClick={() => goStep(s.n)}
                  disabled={!canGo}
                  aria-current={s.n === step ? "step" : undefined}
                >
                  <span className="wiz-step-num">
                    {s.n < step ? "✓" : s.n}
                  </span>
                  <span className="wiz-step-label">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && <span className="wiz-step-sep" />}
              </div>
            );
          })}
        </div>
        <div className="wiz-progress" aria-hidden="true">
          <div
            className="wiz-progress-bar"
            style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }}
          />
        </div>

        {/* Animated per-step panel */}
        <div className="step-panel" key={step}>
          <div className="step-head">
            <div className="step-eyebrow">STEP {step} OF {STEPS.length}</div>
            <h2 className="step-title">{STEPS[step - 1].label}</h2>
            <p className="step-hint">{STEPS[step - 1].hint}</p>
          </div>

          {step === 1 && (
            <div className="realms">
              {realmIds.map((id, i) => (
                <button
                  key={id}
                  className={`realm-card ${realmPicked && realm === id ? "selected" : ""}`}
                  onClick={() => { setRealm(id); setRealmPicked(true); }}
                >
                  <div className="realm-media">
                    <div
                      className="realm-preview"
                      style={{ backgroundImage: `url(/previews/realm-${id}.jpg), ${realmFallback(id)}` }}
                    />
                    <span className="realm-badge">REALM 0{i + 1}</span>
                    <span className="realm-check">✓</span>
                  </div>
                  <div className="realm-body">
                    <strong>{REALMS[id].name}</strong>
                    <span>{REALMS[id].blurb}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="garage">
              <div className="showroom" style={{ ["--livery" as string]: carColorHex(car) }}>
                <CarShowroom car={car} color={CAR_SPECS[car].color} />
                <div className="showroom-info">
                  <div className="showroom-name">
                    <span className="car-chip" style={{ background: carColorHex(car), color: carColorHex(car) }} />
                    <strong style={{ color: carColorHex(car) }}>{CAR_SPECS[car].name}</strong>
                  </div>
                  <p className="showroom-blurb">{CAR_SPECS[car].blurb}</p>
                </div>
              </div>
              <div className="cars">
                {CAR_IDS.map((id) => {
                  const spec = CAR_SPECS[id];
                  const swatch = carColorHex(id);
                  const isSel = car === id;
                  return (
                    <button
                      key={id}
                      className={`car-card ${isSel ? "selected" : ""}`}
                      onClick={() => { setCar(id); setCarPicked(true); }}
                      style={isSel ? { borderColor: swatch, boxShadow: `0 0 16px ${swatch}55` } : undefined}
                    >
                      <span className="car-check" style={{ background: swatch }}>✓</span>
                      <div className="car-head">
                        <span className="car-chip" style={{ background: swatch, color: swatch }} />
                        <strong>{spec.name}</strong>
                      </div>
                      <div className="car-stats">
                        <span>SPD <b style={{ color: swatch }}>{stars(spec.stars.speed)}</b></span>
                        <span>ACC <b style={{ color: swatch }}>{stars(spec.stars.accel)}</b></span>
                        <span>HDL <b style={{ color: swatch }}>{stars(spec.stars.handling)}</b></span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="modes-step">
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

              {isSpace && (
                <div className="gp-note">
                  Space Wars is fought in deep space — your realm pick is swapped
                  for one of two battle tubes. You start armed; item boxes and
                  enemy mines are everywhere. Press <b>E</b> to fire.
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="race-step">
              <div className="loadout">
                <button className="loadout-chip" onClick={() => goStep(1)}>
                  <em>REALM</em>
                  <b>{isSpace ? "DEEP SPACE" : REALMS[realm].name}</b>
                </button>
                <button className="loadout-chip" onClick={() => goStep(2)}>
                  <em>MACHINE</em>
                  <b style={{ color: carColorHex(car) }}>{CAR_SPECS[car].name}</b>
                </button>
                <button className="loadout-chip" onClick={() => goStep(3)}>
                  <em>MODE</em>
                  <b>{MODE_LABEL[mode]}</b>
                </button>
              </div>

              <div className="realm-lore">
                <em>{isSpace ? "DEEP SPACE" : REALMS[realm].name}</em>
                <p>{isSpace ? REALM_LORE.void : REALM_LORE[realm]}</p>
              </div>

              <label className="field">
                <span>RACER NAME</span>
                <input
                  value={name}
                  maxLength={14}
                  placeholder="enter your name"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") launch();
                  }}
                />
              </label>

              {mode !== "nitro" && (
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

              <button className="start" disabled={!canStart} onClick={launch}>
                {canStart
                  ? (isSpace ? "▸ START SPACE WARS" : `▸ START RACE — ${mode === "nitro" ? 1 : laps} LAP${(mode === "nitro" ? 1 : laps) > 1 ? "S" : ""}`)
                  : "ENTER A RACER NAME"}
              </button>

              <p className="controls-help">
                arrows / WASD · SPACE nitro · E item · SHIFT fly · C camera
              </p>
            </div>
          )}
        </div>

        {/* Wizard navigation */}
        <div className="wiz-nav">
          <button
            className="wiz-btn ghost"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
          >
            ◂ BACK
          </button>
          {step < 4 ? (
            <button
              className="wiz-btn next"
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              disabled={nextDisabled}
            >
              {step === 1 ? "NEXT — MACHINE ▸" : step === 2 ? "NEXT — MODE ▸" : "NEXT — RACE ▸"}
            </button>
          ) : (
            <span className="wiz-nav-note">
              {canStart ? "ready to launch" : "name your racer to launch"}
            </span>
          )}
        </div>
      </div>

      {step === 4 && (
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
      )}
    </div>
  );
}
