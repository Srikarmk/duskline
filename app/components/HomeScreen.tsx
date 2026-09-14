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

/**
 * Modes. Time Trial, Nitro Sprint and Transformer Rush still exist in
 * GameMode and MODE_CONFIG so old saves resolve — they are simply not offered.
 */
const MODES: { id: GameMode; name: string; blurb: string }[] = [
  { id: "classic", name: "CIRCUIT", blurb: "Nine rivals, standing grid, three laps." },
  { id: "endless", name: "NEON RUN", blurb: "No rivals, no laps. One infinite highway." },
  { id: "grandprix", name: "GRAND PRIX", blurb: "Three rounds, points after each." },
  { id: "spacewars", name: "SPACE WARS", blurb: "Anti-grav tube, live ordnance." },
];

/** Five-segment stat bar — reads faster than counting stars. */
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
 * The home screen, as ONE screen.
 *
 * It used to be a four-step wizard running several viewports deep, so choosing
 * a car meant scrolling past a world grid and choosing a mode meant scrolling
 * past both. For a game whose whole pitch is "no install, no account, just
 * drive", making someone scroll three times before they can start is the wrong
 * first impression.
 *
 * Everything now sits in one non-scrolling frame: identity top right, worlds
 * as a rail that scrolls WITHIN ITSELF, car and mode in the middle, GO pinned
 * at the bottom. Nothing is more than one click from the start button.
 */
export default function HomeScreen({ lastResult, onStart }: Props) {
  const [ident, setIdent] = useState<Identity | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [mode, setMode] = useState<GameMode>("classic");
  const [realm, setRealm] = useState<RealmId>("bay");
  const [car, setCar] = useState<CarId>("f40");
  const [laps, setLaps] = useState(3);
  const [panel, setPanel] = useState<"race" | "board">("race");

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
    } catch (e) {
      setAuthError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const signOut = useCallback(() => { saveIdentity(null); setIdent(null); }, []);

  const realmIds = (Object.keys(REALMS) as RealmId[]).filter((id) => !REALMS[id].hidden);
  const ownWorld = mode === "spacewars" ? "DEEP SPACE" : mode === "endless" ? "NEON RUN" : null;
  const shownScores = board === "global" ? globalScores ?? [] : localScores;
  const tone = carUIHex(car);
  const go = () => onStart(ident?.name ?? "PLAYER", mode, realm, car, laps);

  // Identity is the only gate, and one click clears it. Everything else has a
  // valid default from the first render.
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
            <button
              type="button"
              className="fr-btn google"
              onClick={asGoogle}
              disabled={authBusy || !googleConfigured}
              title={googleConfigured ? undefined : "Not configured for this deployment"}
            >
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
          {lastResult && (
            <span className="fr-last-run">
              last run · {lastResult.score.toLocaleString()}
              {lastResult.position ? ` · P${lastResult.position}` : ""}
            </span>
          )}
        </div>
        <div className="fr-bar-right">
          <button type="button" className={`fr-tab ${panel === "race" ? "on" : ""}`} onClick={() => setPanel("race")}>RACE</button>
          <button type="button" className={`fr-tab ${panel === "board" ? "on" : ""}`} onClick={() => setPanel("board")}>BOARD</button>
          <span className="fr-who">
            <b>{ident.name}</b>
            <button type="button" className="fr-link" onClick={signOut}>switch</button>
          </span>
        </div>
      </header>

      {panel === "board" ? (
        <section className="fr-panel fr-board-panel">
          <div className="fr-board-tabs">
            <button type="button" className={board === "global" ? "on" : ""} onClick={() => setBoard("global")}>GLOBAL</button>
            <button type="button" className={board === "local" ? "on" : ""} onClick={() => setBoard("local")}>THIS DEVICE</button>
          </div>
          {board === "global" && !isGlobal && (
            <p className="fr-hint">Shared board activates once a KV store is connected.</p>
          )}
          {shownScores.length === 0 ? (
            <p className="fr-hint">Nothing on the board yet — go plant a flag.</p>
          ) : (
            <ol className="fr-board-list">
              {shownScores.slice(0, 10).map((s, i) => (
                <li key={`${s.name}-${i}`}>
                  <span className="rk">{i + 1}</span>
                  <span className="nm">{s.name}</span>
                  <span className="sc">{s.score.toLocaleString()}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : (
        <section className="fr-panel fr-race-panel">
          {/* WORLDS — the only scrolling region, and it scrolls inside itself
              so the page never grows past the viewport. */}
          <div className="fr-rail" role="listbox" aria-label="World">
            {realmIds.map((id) => (
              <button
                type="button"
                key={id}
                role="option"
                aria-selected={realm === id}
                className={`fr-rail-item ${realm === id ? "on" : ""} ${ownWorld ? "muted" : ""}`}
                onClick={() => setRealm(id)}
                style={{ backgroundImage: `url(/previews/realm-${id}.jpg), ${realmFallback(id)}` }}
              >
                <span>{REALMS[id].name}</span>
              </button>
            ))}
          </div>

          <div className="fr-choices">
            <div className="fr-row">
              <span className="fr-lbl">MODE</span>
              <div className="fr-pills">
                {MODES.map((m) => (
                  <button type="button" key={m.id} className={`fr-pill ${mode === m.id ? "on" : ""}`}
                    onClick={() => setMode(m.id)} title={m.blurb}>{m.name}</button>
                ))}
              </div>
            </div>

            <div className="fr-row">
              <span className="fr-lbl">CAR</span>
              <div className="fr-pills cars">
                {CAR_IDS.map((id) => (
                  <button type="button" key={id} className={`fr-pill ${car === id ? "on" : ""}`}
                    onClick={() => setCar(id)}
                    style={car === id ? { borderColor: carUIHex(id), color: carUIHex(id) } : undefined}
                  >{CAR_SPECS[id].name}</button>
                ))}
              </div>
            </div>

            <div className="fr-row stats">
              <span className="fr-lbl">&nbsp;</span>
              <div className="fr-statgrid">
                <span>SPD</span><Pips n={CAR_SPECS[car].stars.speed} tone={tone} />
                <span>ACC</span><Pips n={CAR_SPECS[car].stars.accel} tone={tone} />
                <span>HDL</span><Pips n={CAR_SPECS[car].stars.handling} tone={tone} />
              </div>
              <p className="fr-blurb">{CAR_SPECS[car].blurb}</p>
            </div>

            {mode !== "endless" && mode !== "spacewars" && (
              <div className="fr-row">
                <span className="fr-lbl">LAPS</span>
                <div className="fr-pills">
                  {LAP_OPTIONS.map((n) => (
                    <button type="button" key={n} className={`fr-pill tiny ${laps === n ? "on" : ""}`}
                      onClick={() => setLaps(n)}>{n}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <footer className="fr-go-bar">
            <span className="fr-summary">
              {ownWorld ?? REALMS[realm].name} · {CAR_SPECS[car].name}
              {mode !== "endless" && mode !== "spacewars" ? ` · ${laps} LAP${laps > 1 ? "S" : ""}` : ""}
            </span>
            <button type="button" className="fr-btn primary go" onClick={go}>▸ DRIVE</button>
          </footer>
        </section>
      )}
    </div>
  );
}
