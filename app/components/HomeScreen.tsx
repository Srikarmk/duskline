"use client";

import { useCallback, useEffect, useState } from "react";
import type { GameMode, RealmId, CarId, GameResult } from "@/src/game/engine";
import { REALMS } from "@/src/game3d/realms";
import { CAR_SPECS, CAR_IDS, carUIHex } from "@/src/game3d/carData";
import {
  loadScores, loadLastCar, fetchGlobalScores,
  type ScoreEntry,
} from "@/src/ui/leaderboard";
import {
  loadIdentity, saveIdentity, createGuest, signInWithGoogle, googleConfigured,
  type Identity,
} from "@/src/ui/identity";

interface Props {
  lastResult: GameResult | null;
  onStart: (name: string, mode: GameMode, realm: RealmId, car: CarId, laps: number) => void;
}

const LAP_OPTIONS = [1, 2, 3, 5, 7];

const MODES: { id: GameMode; name: string; blurb: string; tags: string[] }[] = [
  { id: "classic",   name: "CIRCUIT",    blurb: "Nine rivals on a standing grid. Gems, ramps, nitro.", tags: ["10 CARS", "LAPS"] },
  { id: "endless",   name: "NEON RUN",   blurb: "No rivals, no laps, no finish. One infinite highway.", tags: ["SOLO", "ENDLESS"] },
  { id: "grandprix", name: "GRAND PRIX", blurb: "Three rounds, points after each. Consistency wins.",   tags: ["3 ROUNDS", "POINTS"] },
  { id: "spacewars", name: "SPACE WARS", blurb: "Anti-grav tube, live ordnance. Press E to fire.",      tags: ["COMBAT", "ZERO-G"] },
];

const STEPS = [
  { n: 1, label: "WORLD" },
  { n: 2, label: "CAR" },
  { n: 3, label: "RACE" },
];

function Pips({ n, tone }: { n: number; tone: string }) {
  return (
    <span className="fr-pips" aria-label={`${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= n ? "on" : ""} style={i <= n ? { background: tone } : undefined} />
      ))}
    </span>
  );
}

function realmFallback(id: RealmId): string {
  const sky = REALMS[id].palette.sky;
  return `linear-gradient(160deg, ${sky[0]} 0%, ${sky[1]} 38%, ${sky[2]} 72%, ${sky[3]} 100%)`;
}

/**
 * Stepped setup — WORLD, then CAR, then RACE.
 *
 * Two failed shapes before this one, and both failures were the same mistake
 * in opposite directions. The original was four steps that each ran several
 * viewports deep, so every choice meant scrolling. Then I collapsed the whole
 * thing onto one page, which killed the steps entirely and left most of a wide
 * screen empty.
 *
 * The steps were never the problem — their LENGTH was. So: three steps, each
 * exactly one screen with nothing to scroll, each using the full width via an
 * auto-fitting grid so the content grows with the display instead of huddling
 * in the top-left.
 */
export default function HomeScreen({ lastResult, onStart }: Props) {
  const [ident, setIdent] = useState<Identity | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<GameMode>("classic");
  const [realm, setRealm] = useState<RealmId>("bay");
  const [car, setCar] = useState<CarId>("f40");
  const [laps, setLaps] = useState(3);
  const [showBoard, setShowBoard] = useState(false);

  const [localScores, setLocalScores] = useState<ScoreEntry[]>([]);
  const [globalScores, setGlobalScores] = useState<ScoreEntry[] | null>(null);
  const [isGlobal, setIsGlobal] = useState(false);
  const [board, setBoard] = useState<"global" | "local">("global");

  useEffect(() => {
    setIdent(loadIdentity());
    const savedCar = loadLastCar();
    if (savedCar && CAR_SPECS[savedCar]) setCar(savedCar);
    setLocalScores(loadScores());
    fetchGlobalScores().then((res) => {
      if (res) { setGlobalScores(res.scores); setIsGlobal(res.global); }
    });
  }, []);

  const asGuest = useCallback(async () => {
    setAuthBusy(true); setAuthError(null);
    const id = await createGuest();
    saveIdentity(id); setIdent(id); setAuthBusy(false);
  }, []);

  const asGoogle = useCallback(async () => {
    setAuthBusy(true); setAuthError(null);
    try {
      const id = await signInWithGoogle();
      if (id) { saveIdentity(id); setIdent(id); }
    } catch (e) { setAuthError((e as Error).message); }
    finally { setAuthBusy(false); }
  }, []);

  const realmIds = (Object.keys(REALMS) as RealmId[]).filter((id) => !REALMS[id].hidden);
  const ownWorld = mode === "spacewars" ? "DEEP SPACE" : mode === "endless" ? "NEON RUN" : null;
  const shownScores = board === "global" ? globalScores ?? [] : localScores;
  const tone = carUIHex(car);
  const go = () => onStart(ident?.name ?? "PLAYER", mode, realm, car, laps);

  if (!ident) {
    return (
      <div className="fr-home fr-gate">
        <div className="fr-gate-card">
          <h1 className="title">FANTASY RACER</h1>
          <p className="fr-gate-sub">Ten road cars. Twelve worlds. No install.</p>
          <div className="fr-gate-actions">
            <button type="button" className="fr-btn primary" onClick={asGuest} disabled={authBusy}>
              {authBusy ? "…" : "CONTINUE AS GUEST"}
            </button>
            <button type="button" className="fr-btn google" onClick={asGoogle}
              disabled={authBusy || !googleConfigured}
              title={googleConfigured ? undefined : "Not configured for this deployment"}>
              <span className="fr-g-mark" aria-hidden="true">G</span>
              CONNECT WITH GOOGLE
            </button>
          </div>
          {!googleConfigured && (
            <p className="fr-gate-note">
              Google sign-in needs NEXT_PUBLIC_GOOGLE_CLIENT_ID. Guest works now
              and keeps your scores on this device.
            </p>
          )}
          {authError && <p className="fr-gate-note error">{authError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="fr-home fr-single">
      <header className="fr-bar">
        <div className="fr-bar-left">
          <h1 className="title sm">FANTASY RACER</h1>
          <nav className="fr-steps" aria-label="Setup">
            {STEPS.map((st) => (
              <button type="button" key={st.n}
                className={`fr-step ${step === st.n ? "on" : ""} ${step > st.n ? "done" : ""}`}
                onClick={() => setStep(st.n)}>
                <i>{step > st.n ? "✓" : st.n}</i>{st.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="fr-bar-right">
          {lastResult && (
            <span className="fr-last-run">last · {lastResult.score.toLocaleString()}</span>
          )}
          <button type="button" className={`fr-tab ${showBoard ? "on" : ""}`}
            onClick={() => setShowBoard((v) => !v)}>BOARD</button>
          <span className="fr-who">
            <b>{ident.name}</b>
            <button type="button" className="fr-link" onClick={() => { saveIdentity(null); setIdent(null); }}>switch</button>
          </span>
        </div>
      </header>

      {showBoard && (
        <div className="fr-sheet" role="dialog" aria-label="Leaderboard">
          <div className="fr-sheet-card">
            <div className="fr-board-tabs">
              <button type="button" className={board === "global" ? "on" : ""} onClick={() => setBoard("global")}>GLOBAL</button>
              <button type="button" className={board === "local" ? "on" : ""} onClick={() => setBoard("local")}>THIS DEVICE</button>
              <button type="button" className="fr-close" onClick={() => setShowBoard(false)} aria-label="Close">✕</button>
            </div>
            {board === "global" && !isGlobal && (
              <p className="fr-hint">Shared board activates once a KV store is connected.</p>
            )}
            {shownScores.length === 0 ? (
              <p className="fr-hint">Nothing on the board yet — go plant a flag.</p>
            ) : (
              <ol className="fr-board-list">
                {shownScores.slice(0, 12).map((s, i) => (
                  <li key={`${s.name}-${i}`}>
                    <span className="fr-rk">{i + 1}</span>
                    <span className="fr-nm">{s.name}</span>
                    <span className="fr-sc">{s.score.toLocaleString()}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {/* ---- STEP 1: WORLD ---------------------------------------------- */}
      {step === 1 && (
        <section className="fr-stage">
          <div className="fr-stage-head">
            <h2>PICK A WORLD</h2>
            <p>{ownWorld ? `${MODES.find((m) => m.id === mode)?.name} brings its own world — this pick is set aside.` : REALMS[realm].blurb}</p>
          </div>
          <div className={`fr-grid worlds ${ownWorld ? "dim" : ""}`}>
            {realmIds.map((id) => (
              <button type="button" key={id}
                className={`fr-card world ${realm === id ? "on" : ""}`}
                onClick={() => setRealm(id)}
                style={{ backgroundImage: `url(/previews/realm-${id}.jpg), ${realmFallback(id)}` }}>
                <span className="fr-card-name">{REALMS[id].name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---- STEP 2: CAR ------------------------------------------------- */}
      {step === 2 && (
        <section className="fr-stage">
          <div className="fr-stage-head">
            <h2>PICK A CAR</h2>
            <p>{CAR_SPECS[car].blurb}</p>
          </div>
          <div className="fr-grid cars">
            {CAR_IDS.map((id) => {
              const c = CAR_SPECS[id];
              const t = carUIHex(id);
              return (
                <button type="button" key={id}
                  className={`fr-card car ${car === id ? "on" : ""}`}
                  onClick={() => setCar(id)}
                  style={car === id ? { borderColor: t } : undefined}>
                  <span className="fr-car-name" style={{ color: t }}>{c.name}</span>
                  <span className="fr-car-stats">
                    <span>SPD</span><Pips n={c.stars.speed} tone={t} />
                    <span>ACC</span><Pips n={c.stars.accel} tone={t} />
                    <span>HDL</span><Pips n={c.stars.handling} tone={t} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- STEP 3: RACE ------------------------------------------------ */}
      {step === 3 && (
        <section className="fr-stage">
          <div className="fr-stage-head">
            <h2>HOW DO YOU WANT TO RACE?</h2>
            <p>{MODES.find((m) => m.id === mode)?.blurb}</p>
          </div>
          <div className="fr-grid modes">
            {MODES.map((m) => (
              <button type="button" key={m.id}
                className={`fr-card mode ${mode === m.id ? "on" : ""}`}
                onClick={() => setMode(m.id)}>
                <span className="fr-card-name">{m.name}</span>
                <span className="fr-mode-blurb">{m.blurb}</span>
                <span className="fr-mode-tags">{m.tags.map((t) => <i key={t}>{t}</i>)}</span>
              </button>
            ))}
          </div>
          {mode !== "endless" && mode !== "spacewars" && (
            <div className="fr-laps">
              <span className="fr-lbl">LAPS</span>
              {LAP_OPTIONS.map((n) => (
                <button type="button" key={n} className={`fr-pill tiny ${laps === n ? "on" : ""}`}
                  onClick={() => setLaps(n)}>{n}</button>
              ))}
            </div>
          )}
        </section>
      )}

      <footer className="fr-go-bar">
        <button type="button" className="fr-btn ghost" onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}>◂ BACK</button>
        <span className="fr-summary">
          {ownWorld ?? REALMS[realm].name} · {CAR_SPECS[car].name}
          {mode !== "endless" && mode !== "spacewars" ? ` · ${laps} LAP${laps > 1 ? "S" : ""}` : ""}
        </span>
        {step < 3 ? (
          <span className="fr-go-pair">
            <button type="button" className="fr-btn" onClick={go}>DRIVE NOW</button>
            <button type="button" className="fr-btn primary" onClick={() => setStep((s) => s + 1)}>NEXT ▸</button>
          </span>
        ) : (
          <button type="button" className="fr-btn primary go" onClick={go}>▸ DRIVE</button>
        )}
      </footer>
    </div>
  );
}
