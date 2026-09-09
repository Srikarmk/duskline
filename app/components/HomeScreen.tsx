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

/** Five-segment stat bar — reads faster than a row of star glyphs. */
function Pips({ n }: { n: number }) {
  return (
    <span className="pips" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`pip ${i < n ? "on" : ""}`} />
      ))}
    </span>
  );
}

const MODES: { id: GameMode; name: string; blurb: string; tags: string[]; accent: string }[] = [
  {
    id: "classic",
    name: "CLASSIC CIRCUIT",
    blurb: "Seven AI rivals, gems, stunts, nitro and power-ups. The full-fat race.",
    tags: ["8 RACERS", "POWER-UPS", "THE CLASSIC"],
    accent: "#c084fc",
  },
  {
    id: "timetrial",
    name: "TIME TRIAL",
    blurb: "Just you and the clock. No traffic, no excuses — hunt a clean lap.",
    tags: ["SOLO", "CLEAN LAPS", "THE CLOCK"],
    accent: "#22d3ee",
  },
  {
    id: "nitro",
    name: "NITRO SPRINT",
    blurb: "One lap. Full nitro from the lights. Blink and it's over.",
    tags: ["1 LAP", "FULL BOOST", "CHAOS"],
    accent: "#fb7185",
  },
  {
    id: "transform",
    name: "TRANSFORMER RUSH",
    blurb: "Morph into a sword-mech mid-race — slash monsters, then take flight.",
    tags: ["MECH", "FLIGHT", "COMBAT"],
    accent: "#fbbf24",
  },
];

const MODE_LABEL: Record<GameMode, string> = {
  classic: "CIRCUIT", timetrial: "TRIAL", nitro: "SPRINT", transform: "RUSH", grandprix: "GP", spacewars: "WARS",
};

const STEPS: { n: number; label: string; hint: string }[] = [
  { n: 1, label: "REALM", hint: "Eight worlds, eight completely different rides. Pick your playground." },
  { n: 2, label: "MACHINE", hint: "Ten karts on the floor. Speed, grip, launch — choose your weapon." },
  { n: 3, label: "MODE", hint: "Clean laps, full contact, or a sword-mech. How do you want to win?" },
  { n: 4, label: "RACE", hint: "Name on the door, laps on the board. Lights out." },
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

/** A vivid per-realm accent, borrowed from the track's kerb colour. Falls back
 *  to the inner kerb when the outer one is near-white (Apex Speedway). */
function realmAccent(id: RealmId): string {
  const p = REALMS[id].palette;
  const hex = p.rumbleB.replace("#", "");
  const light =
    parseInt(hex.slice(0, 2), 16) > 220 &&
    parseInt(hex.slice(2, 4), 16) > 220 &&
    parseInt(hex.slice(4, 6), 16) > 220;
  return light ? p.rumbleA : p.rumbleB;
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
  const raceLaps = mode === "nitro" ? 1 : laps;

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
  const livery = carColorHex(car);

  return (
    <div className="home">
      <header className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <span className="hero-kicker">INSERT COIN · <b>PRESS START</b></span>
        <h1 className="title">FANTASY RACER</h1>
        <div className="checker hero-rule" aria-hidden="true" />
        <p className="subtitle">drift · boost · jump · blast</p>
        <ul className="hero-tags">
          <li><b>{realmIds.length}</b> WORLDS</li>
          <li><b>{CAR_IDS.length}</b> KARTS</li>
          <li><b>{MODES.length}</b> MODES</li>
          <li><b>∞</b> BRAGGING RIGHTS</li>
        </ul>
      </header>

      {lastResult && (
        <div className="result-banner" role="status">
          <strong>RACE COMPLETE!</strong>
          <span>Score {lastResult.score.toLocaleString()}</span>
          {lastResult.position && lastResult.totalRacers ? (
            <>
              <span className="rb-sep">/</span>
              <span>P{lastResult.position} of {lastResult.totalRacers}</span>
            </>
          ) : null}
          <span className="rb-sep">/</span>
          <span>{lastResult.gems} gems</span>
          <span className="rb-sep">/</span>
          <span>{lastResult.stunts} stunts</span>
          <span className="rb-sep">/</span>
          <span>{formatTime(lastResult.timeMs)}</span>
        </div>
      )}

      <section className="wizard" aria-label="Race setup">
        {/* Step indicator / breadcrumb */}
        <nav aria-label="Setup steps">
          <ol className="wiz-steps">
            {STEPS.map((s, i) => {
              const state = s.n === step ? "active" : s.n < step ? "done" : "";
              const canGo = reachable(s.n);
              return (
                <li key={s.n} className="wiz-step-wrap">
                  <button
                    type="button"
                    className={`wiz-step ${state} ${canGo ? "reachable" : ""}`}
                    onClick={() => goStep(s.n)}
                    disabled={!canGo}
                    aria-current={s.n === step ? "step" : undefined}
                    aria-label={`Step ${s.n}: ${s.label}`}
                  >
                    <span className="wiz-step-num" aria-hidden="true">
                      {s.n < step ? "✓" : s.n}
                    </span>
                    <span className="wiz-step-label">{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && <span className="wiz-step-sep" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
        </nav>
        <div
          className="wiz-progress"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step}
        >
          <div
            className="wiz-progress-bar"
            style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }}
          />
        </div>

        {/* Animated per-step panel */}
        <div className="step-panel" key={step}>
          <div className="step-head">
            <span className="step-eyebrow">STEP {step} / {STEPS.length}</span>
            <h2 className="step-title">{STEPS[step - 1].label}</h2>
            <p className="step-hint">{STEPS[step - 1].hint}</p>
          </div>

          {step === 1 && (
            <div className="realms">
              {realmIds.map((id, i) => {
                const isSel = realmPicked && realm === id;
                return (
                  <button
                    type="button"
                    key={id}
                    className={`realm-card ${isSel ? "selected" : ""}`}
                    style={{ ["--accent" as string]: realmAccent(id) }}
                    aria-pressed={isSel}
                    onClick={() => { setRealm(id); setRealmPicked(true); }}
                  >
                    <span className="realm-media">
                      <span
                        className="realm-preview"
                        style={{ backgroundImage: `url(/previews/realm-${id}.jpg), ${realmFallback(id)}` }}
                      />
                      <span className="realm-index" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                      <span className="pick-flag" aria-hidden="true">PICKED</span>
                    </span>
                    <span className="realm-body">
                      <strong>{REALMS[id].name}</strong>
                      <span className="realm-blurb">{REALMS[id].blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div className="garage">
              <div className="showroom" style={{ ["--livery" as string]: livery }}>
                <CarShowroom car={car} color={CAR_SPECS[car].color} />
                <div className="showroom-info">
                  <span className="showroom-tag">YOUR MACHINE</span>
                  <div className="showroom-name">
                    <span className="car-chip" style={{ background: livery, color: livery }} />
                    <strong style={{ color: livery }}>{CAR_SPECS[car].name}</strong>
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
                      type="button"
                      key={id}
                      className={`car-card ${isSel ? "selected" : ""}`}
                      aria-pressed={isSel}
                      aria-label={`${spec.name} — speed ${spec.stars.speed} of 5, acceleration ${spec.stars.accel} of 5, handling ${spec.stars.handling} of 5`}
                      onClick={() => { setCar(id); setCarPicked(true); }}
                      style={{ ["--accent" as string]: swatch }}
                    >
                      <span className="pick-flag" aria-hidden="true">PICKED</span>
                      <span className="car-head">
                        <span className="car-chip" style={{ background: swatch, color: swatch }} />
                        <strong>{spec.name}</strong>
                      </span>
                      <span className="car-stats">
                        <span className="stat-row">
                          <em>SPD</em><Pips n={spec.stars.speed} />
                        </span>
                        <span className="stat-row">
                          <em>ACC</em><Pips n={spec.stars.accel} />
                        </span>
                        <span className="stat-row">
                          <em>HDL</em><Pips n={spec.stars.handling} />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="modes-step">
              <div className="modes">
                {MODES.map((m, i) => {
                  const isSel = mode === m.id;
                  return (
                    <button
                      type="button"
                      key={m.id}
                      className={`mode-card ${isSel ? "selected" : ""}`}
                      style={{ ["--accent" as string]: m.accent }}
                      aria-pressed={isSel}
                      onClick={() => setMode(m.id)}
                    >
                      <span className="mode-index" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                      <span className="pick-flag" aria-hidden="true">PICKED</span>
                      <strong>{m.name}</strong>
                      <span className="mode-blurb">{m.blurb}</span>
                      <span className="mode-tags">
                        {m.tags.map((t) => <i key={t}>{t}</i>)}
                      </span>
                    </button>
                  );
                })}
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
                <button type="button" className="loadout-chip" onClick={() => goStep(1)}>
                  <span
                    className="loadout-thumb"
                    style={
                      isSpace
                        ? { background: realmFallback("void") }
                        : { backgroundImage: `url(/previews/realm-${realm}.jpg), ${realmFallback(realm)}` }
                    }
                    aria-hidden="true"
                  />
                  <span className="loadout-txt">
                    <em>REALM</em>
                    <b>{isSpace ? "DEEP SPACE" : REALMS[realm].name}</b>
                  </span>
                  <span className="swap" aria-hidden="true">SWAP</span>
                </button>
                <button type="button" className="loadout-chip" onClick={() => goStep(2)}>
                  <span
                    className="loadout-thumb glyph"
                    style={{ background: livery }}
                    aria-hidden="true"
                  >
                    {CAR_SPECS[car].name.slice(0, 2)}
                  </span>
                  <span className="loadout-txt">
                    <em>MACHINE</em>
                    <b style={{ color: livery }}>{CAR_SPECS[car].name}</b>
                  </span>
                  <span className="swap" aria-hidden="true">SWAP</span>
                </button>
                <button type="button" className="loadout-chip" onClick={() => goStep(3)}>
                  <span
                    className="loadout-thumb glyph"
                    style={{ background: "linear-gradient(140deg, #67e8f9, #a855f7)" }}
                    aria-hidden="true"
                  >
                    {raceLaps}L
                  </span>
                  <span className="loadout-txt">
                    <em>MODE</em>
                    <b>{MODE_LABEL[mode]}</b>
                  </span>
                  <span className="swap" aria-hidden="true">SWAP</span>
                </button>
              </div>

              <div className="realm-lore">
                <em>{isSpace ? "DEEP SPACE" : REALMS[realm].name.toUpperCase()}</em>
                <p>{isSpace ? REALM_LORE.void : REALM_LORE[realm]}</p>
              </div>

              <div className="grid-row">
                <label className="field">
                  <span>RACER NAME</span>
                  <input
                    value={name}
                    maxLength={14}
                    placeholder="type your legend"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") launch();
                    }}
                  />
                </label>

                {mode !== "nitro" && (
                  <div className="field" role="group" aria-label="Lap count">
                    <span className="section-label">LAPS</span>
                    <div className="laps">
                      {LAP_OPTIONS.map((n) => (
                        <button
                          type="button"
                          key={n}
                          className={`lap-pill ${laps === n ? "selected" : ""}`}
                          aria-pressed={laps === n}
                          aria-label={`${n} lap${n > 1 ? "s" : ""}`}
                          onClick={() => setLaps(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button type="button" className="start" disabled={!canStart} onClick={launch}>
                {canStart
                  ? (isSpace ? "▸ START SPACE WARS" : `▸ START RACE — ${raceLaps} LAP${raceLaps > 1 ? "S" : ""}`)
                  : "ENTER A RACER NAME"}
              </button>

              <p className="controls-help">
                <b>ARROWS / WASD</b> drive · <b>SPACE</b> nitro · drift for boost · ram rivals to take them down · <b>C</b> camera
              </p>
            </div>
          )}
        </div>

        {/* Wizard navigation */}
        <div className="wiz-nav">
          <button
            type="button"
            className="wiz-btn ghost"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
          >
            ◂ BACK
          </button>
          {step < 4 ? (
            <button
              type="button"
              className="wiz-btn next"
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              disabled={nextDisabled}
            >
              {step === 1 ? "NEXT — MACHINE ▸" : step === 2 ? "NEXT — MODE ▸" : "NEXT — RACE ▸"}
            </button>
          ) : (
            <span className={`wiz-nav-note ${canStart ? "hot" : ""}`}>
              {canStart ? "engines hot" : "name your racer to launch"}
            </span>
          )}
        </div>
      </section>

      {step === 4 && (
        <section className="leaderboard" aria-label="Leaderboard">
          <div className="board-head">
            <h2>HALL OF LEGENDS</h2>
            <div className="board-tabs" role="group" aria-label="Leaderboard source">
              <button
                type="button"
                className={board === "global" ? "active" : ""}
                aria-pressed={board === "global"}
                onClick={() => setBoard("global")}
              >
                GLOBAL
              </button>
              <button
                type="button"
                className={board === "local" ? "active" : ""}
                aria-pressed={board === "local"}
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
            <p className="board-hint">no scores on the board yet — go plant a flag</p>
          ) : (
            <table className="board-table">
              <thead>
                <tr>
                  <th className="rank-col">#</th>
                  <th>RACER</th>
                  <th className="mode-col">MODE</th>
                  <th>TIME</th>
                  <th className="score">SCORE</th>
                </tr>
              </thead>
              <tbody>
                {shownScores.map((s, i) => {
                  const rankClass = i + 1 <= 3 ? `rank-${i + 1}` : "rank-n";
                  const isYou = name.trim().length > 0 && s.name === name.trim();
                  return (
                    <tr key={i} className={isYou ? "you" : ""}>
                      <td>
                        <span className={`board-rank ${rankClass}`}>{i + 1}</span>
                      </td>
                      <td className="board-name">
                        {s.name}
                        {isYou && <span className="board-you">YOU</span>}
                      </td>
                      <td className="mode-col">
                        <span className="board-mode">{MODE_LABEL[s.mode] ?? s.mode}</span>
                      </td>
                      <td>{formatTime(s.timeMs)}</td>
                      <td className="score">{s.score.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
