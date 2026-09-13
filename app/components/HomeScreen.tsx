"use client";

import { useEffect, useState } from "react";
import type { GameMode, RealmId, CarId, GameResult } from "@/src/game/engine";
import { REALMS, REALM_LORE } from "@/src/game3d/realms";
import { CAR_SPECS, CAR_IDS, carColorHex, carUIHex } from "@/src/game3d/carData";
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

/**
 * The modes offered on the picker.
 *
 * Time Trial and Nitro Sprint are gone, and Transformer Rush is archived —
 * all three still exist in GameMode and MODE_CONFIG, so a saved score or a
 * direct call still resolves, they just aren't offered. Four strong modes read
 * better on the shelf than seven where three are thin variations.
 */
const MODES: { id: GameMode; name: string; blurb: string; tags: string[]; accent: string }[] = [
  {
    id: "classic",
    name: "CIRCUIT",
    blurb: "Nine rivals on a standing grid. Gems, ramps, nitro — the full race.",
    tags: ["10 CARS", "3 LAPS", "THE MAIN EVENT"],
    accent: "#c084fc",
  },
  {
    id: "endless",
    name: "NEON RUN",
    blurb: "No circuit, no rivals, no finish. One infinite neon highway and the music.",
    tags: ["ENDLESS", "SOLO", "CYBERPUNK"],
    accent: "#22d3ee",
  },
  {
    id: "grandprix",
    name: "GRAND PRIX",
    blurb: "Three rounds, points after each. Consistency wins championships.",
    tags: ["3 ROUNDS", "POINTS", "CHAMPIONSHIP"],
    accent: "#f59e0b",
  },
  {
    id: "spacewars",
    name: "SPACE WARS",
    blurb: "Anti-gravity tube, live ordnance. Missiles, mines, shields — take them out.",
    tags: ["COMBAT", "DEEP SPACE", "ORDNANCE"],
    accent: "#fb7185",
  },
];


const MODE_LABEL: Record<GameMode, string> = {
  classic: "CIRCUIT", timetrial: "TRIAL", nitro: "SPRINT", transform: "RUSH", grandprix: "GP", spacewars: "WARS",
  endless: "NEON RUN",
};

const STEPS: { n: number; label: string; hint: string }[] = [
  { n: 1, label: "WORLD", hint: "Twelve places to drive. Pick one." },
  { n: 2, label: "CAR", hint: "Ten road cars. Speed, grip, launch — pick your weapon." },
  { n: 3, label: "MODE", hint: "A race, an endless cruise, a championship, or a firefight." },
  { n: 4, label: "GO", hint: "Name on the door. Lights out." },
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
  const [car, setCar] = useState<CarId>("f40");
  const [laps, setLaps] = useState(3);
  const [step, setStep] = useState(1);
  // These start TRUE. A world and a car are already selected and shown as
  // selected from the first render, so gating navigation on an explicit click
  // meant NEXT sat disabled with nothing on screen explaining why — the single
  // worst moment in the flow, and one I walked into myself repeatedly.
  const [realmPicked, setRealmPicked] = useState(true);
  const [carPicked, setCarPicked] = useState(true);
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
  // Both of these modes bring their own world and ignore the realm pick, so the
  // summary must not promise the player the realm they chose.
  const isNeon = mode === "endless";
  const ownWorld = isSpace ? "DEEP SPACE" : isNeon ? "NEON RUN" : null;
  const shownScores = board === "global" ? globalScores ?? [] : localScores;
  // A blank name is not a reason to refuse to start a single-player game. It
  // defaults, and the field explains that it is what goes on the board.
  const racerName = name.trim() || "PLAYER";
  const canStart = true;
  const raceLaps = mode === "nitro" ? 1 : laps;

  // Which steps the breadcrumb lets you jump to (mode always has a default).
  // Every step is reachable. There is a valid selection for all of them from
  // the first render, so locking the breadcrumb only ever hid the way forward.
  const reachable = (_n: number) => true;

  const goStep = (n: number) => {
    if (reachable(n)) setStep(n);
  };

  const launch = () => onStart(racerName, mode, realm, car, laps);
  /** Straight into a race on whatever is currently selected. */
  const quickRace = () => onStart(racerName, mode, realm, car, laps);

  const nextDisabled = false;
  const livery = carColorHex(car);
  const liveryUI = carUIHex(car);   // legible even for the black and white cars

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
          <li><b>{CAR_IDS.length}</b> CARS</li>
          <li><b>{MODES.length}</b> MODES</li>
          <li><b>∞</b> BRAGGING RIGHTS</li>
        </ul>
        {/* One click to drive. Four steps is the right amount of choice for
            someone who wants to make choices, and three steps too many for
            someone who just wants to play — so both paths exist, and this one
            is first because it is the one most people want. */}
        <button type="button" className="quick-race" onClick={quickRace}>
          <span className="qr-go">▸ DRIVE NOW</span>
          <span className="qr-sub">
            {ownWorld ?? REALMS[realm].name} · {CAR_SPECS[car].name} · {MODE_LABEL[mode]}
          </span>
        </button>
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
                    <strong style={{ color: liveryUI }}>{CAR_SPECS[car].name}</strong>
                  </div>
                  <p className="showroom-blurb">{CAR_SPECS[car].blurb}</p>
                </div>
              </div>
              <div className="cars">
                {CAR_IDS.map((id) => {
                  const spec = CAR_SPECS[id];
                  const swatch = carUIHex(id);   // the grid swatch has to survive a black livery too
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
                  Space Wars is fought in deep space — your world pick is swapped
                  for one of two battle tubes. You start armed; item boxes and
                  enemy mines are everywhere. Press <b>E</b> to fire.
                </div>
              )}
              {isNeon && (
                <div className="gp-note">
                  Neon Run has its own world — an infinite wet highway under a
                  dead city, so your world pick is set aside. No rivals, no laps,
                  no finish line. Drive until you feel like stopping.
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
                        : isNeon
                          ? { background: realmFallback("neon") }
                          : { backgroundImage: `url(/previews/realm-${realm}.jpg), ${realmFallback(realm)}` }
                    }
                    aria-hidden="true"
                  />
                  <span className="loadout-txt">
                    <em>REALM</em>
                    <b>{ownWorld ?? REALMS[realm].name}</b>
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
                    <b style={{ color: liveryUI }}>{CAR_SPECS[car].name}</b>
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
                <em>{ownWorld ?? REALMS[realm].name.toUpperCase()}</em>
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
                {isSpace
                  ? "▸ START SPACE WARS"
                  : isNeon
                    ? "▸ START NEON RUN"
                    : `▸ START RACE — ${raceLaps} LAP${raceLaps > 1 ? "S" : ""}`}
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
