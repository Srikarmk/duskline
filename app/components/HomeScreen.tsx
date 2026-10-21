"use client";

import { useEffect, useRef, useState } from "react";
import type { GameMode, RealmId, CarId, GameResult } from "@/src/game/engine";
import { REALMS, REALM_LORE } from "@/src/game3d/realms";
import { CAR_SPECS, CAR_IDS, carColorHex, carUIHex } from "@/src/game3d/carData";
import dynamic from "next/dynamic";
import {
  loadScores, loadLastCar, fetchGlobalScores,
  type ScoreEntry,
} from "@/src/ui/leaderboard";
import {
  loadIdentity, saveIdentity, createGuest, signInWithGoogle, googleConfigured,
  type Identity,
} from "@/src/ui/identity";
import { setCredential, syncOnSignIn, hasCredential, type SyncState } from "@/src/ui/sync";
import { warmRaceAssets } from "@/src/ui/warm";
import { loadCareer, seedFromHistory, isUnlocked, CAR_REQUIREMENT, nextUnlock, type Career } from "@/src/ui/progress";
import { loadSeason, seasonStanding, SEASON_ORDER, type SeasonState } from "@/src/ui/season";
import { todaysChallenge, dailyResult, msUntilNext } from "@/src/ui/daily";

// live 3D garage preview — client-only (WebGL), so it must never be SSR'd
const CarShowroom = dynamic(() => import("./CarShowroom"), { ssr: false });

interface Props {
  lastResult: GameResult | null;
  onStart: (name: string, mode: GameMode, realm: RealmId, car: CarId, laps: number) => void;
  /** pick a saved championship back up where it was left */
  onResumeSeason: (name: string) => void;
  onAbandonSeason: () => void;
  /** today's fixed challenge — same realm, car and laps for everyone */
  onStartDaily: (name: string) => void;
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
  classic: "CIRCUIT", transform: "RUSH", grandprix: "GP", spacewars: "WARS",
  endless: "NEON RUN",
};

const STEPS: { n: number; label: string; hint: string }[] = [
  { n: 1, label: "WORLD", hint: "Twelve places to drive. Pick one." },
  // Counted from the catalogue, not written down. It said "Ten" for the four
  // races after the JDM cars were added — the header two lines up has always
  // read CAR_IDS.length and was saying fourteen at the same time.
  { n: 2, label: "CAR", hint: `${CAR_IDS.length} road cars. Speed, grip, launch — pick your weapon.` },
  { n: 3, label: "MODE", hint: "A race, an endless cruise, a championship, or a firefight." },
  { n: 4, label: "GO", hint: "Loadout check. Lights out." },
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

/**
 * The four-step setup, kept — shortened.
 *
 * This is the original wizard. Two attempts to "improve" it made it worse:
 * one collapsed every step onto a single page (which threw the steps away),
 * and one rebuilt the steps from scratch with flat cards (which threw the
 * preview art and the 3D garage away). The steps and the art were never the
 * problem. The LENGTH was — each step ran two or three viewports deep, so
 * every choice meant scrolling.
 *
 * So the markup is the original and the only structural changes are the ones
 * that were actually asked for:
 *   - the hero is a single compact band instead of a full screen of its own,
 *   - each step fills exactly what is left of the viewport and never scrolls
 *     (see `.home.fit` in globals.css — the cards flex down to fit the height
 *     rather than a fixed aspect forcing the page taller),
 *   - the leaderboard is a sheet you open, not a slab under step 4,
 *   - the free-text name field is gone: you arrive as a numbered guest or
 *     connect Google.
 */
export default function HomeScreen({ lastResult, onStart, onResumeSeason, onAbandonSeason, onStartDaily }: Props) {
  const [ident, setIdent] = useState<Identity | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [mode, setMode] = useState<GameMode>("classic");
  const [realm, setRealm] = useState<RealmId>("bay");
  const [car, setCar] = useState<CarId>("f40");
  const [laps, setLaps] = useState(3);
  const [step, setStep] = useState(1);
  const [showBoard, setShowBoard] = useState(false);
  const boardRef = useRef<HTMLElement>(null);
  const [localScores, setLocalScores] = useState<ScoreEntry[]>([]);
  const [globalScores, setGlobalScores] = useState<ScoreEntry[] | null>(null);
  const [abandonArmed, setAbandonArmed] = useState(false);
  const [boardFailed, setBoardFailed] = useState(false);
  const [isGlobal, setIsGlobal] = useState(false);
  const [board, setBoard] = useState<"global" | "local">("global");

  // Career progress. Seeded once from the saved scores of anyone who played
  // before this existed — see progress.ts for why that credit is races only.
  const [career, setCareer] = useState<Career>(() => loadCareer());
  /** a championship left part-finished, offered back rather than lost */
  const [season, setSeason] = useState<SeasonState | null>(() => loadSeason());
  /**
   * Whether this device's progress is going anywhere but this device.
   *
   * Held as a state, not a boolean, because "off" and "failed" are different
   * answers and a player who signed in expecting their garage to follow them
   * deserves to be told which one happened.
   */
  const [sync, setSync] = useState<SyncState>({ kind: "off", reason: "not signed in" });
  /** today's fixed challenge, and whether it has been taken */
  const [daily] = useState(() => todaysChallenge());
  const [dailyRun, setDailyRun] = useState(() => dailyResult(daily.day));
  useEffect(() => { setDailyRun(dailyResult(daily.day)); }, [daily.day, lastResult]);
  useEffect(() => {
    setCareer(seedFromHistory(loadScores().length));
  }, []);

  useEffect(() => {
    setIdent(loadIdentity());
    const savedCar = loadLastCar();
    // …but only if it is still theirs. A car saved before progression existed
    // can be one they have not earned; falling back beats starting the player
    // on a locked card they cannot race.
    if (savedCar && CAR_SPECS[savedCar] && isUnlocked(savedCar)) setCar(savedCar);
    setLocalScores(loadScores());
    fetchGlobalScores().then((res) => {
      if (res) {
        setGlobalScores(res.scores);
        setIsGlobal(res.global);
      } else {
        setBoardFailed(true);
      }
    });
  }, []);

  // Pull the race's textures down while the player is choosing. The setup
  // steps are ten to twenty seconds of doing nothing with the network, and
  // without this the first DRIVE of a visit waits on ~900 kB. Re-runs on realm
  // change; the shared sets are only fetched once and most realms share a
  // ground albedo, so switching is usually free.
  useEffect(() => {
    warmRaceAssets(realm);
  }, [realm]);

  /**
   * Make the leaderboard sheet behave like the dialog it claims to be.
   *
   * It already set role="dialog" aria-modal="true", which tells a screen
   * reader the rest of the page is inert — and then did nothing to make that
   * true. Focus stayed on the page behind, Tab walked straight out of it, and
   * Escape did nothing.
   */
  useEffect(() => {
    if (!showBoard) return;
    const opener = document.activeElement as HTMLElement | null;
    const sheet = boardRef.current;
    const focusables = () =>
      Array.from(
        sheet?.querySelectorAll<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])') ?? []
      ).filter((el) => !el.hasAttribute("disabled"));

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowBoard(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at both ends rather than letting focus escape to the page behind.
      if (e.shiftKey && (active === first || !sheet?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [showBoard]);

  const adopt = (who: Identity | null) => {
    if (!who) return;
    saveIdentity(who);
    setIdent(who);
  };

  /**
   * Pull the account's profile, merge it into this device's, push the result.
   *
   * Then re-read career and season from storage: the merge has just written
   * both, and the cards on this screen are showing what was loaded on mount.
   */
  const runSync = async (who: Identity) => {
    setSync({ kind: "syncing" });
    const state = await syncOnSignIn(who);
    setSync(state);
    if (state.kind === "synced") {
      setCareer(loadCareer());
      setSeason(loadSeason());
    }
  };

  const asGuest = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      adopt(await createGuest());
    } finally {
      setAuthBusy(false);
    }
  };

  const asGoogle = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await signInWithGoogle();
      if (!res) return;                       // prompt dismissed
      adopt(res.identity);
      // The credential lives in memory for this session only — see sync.ts.
      setCredential(res.credential);
      await runSync(res.identity);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const switchRacer = () => {
    saveIdentity(null);
    // Drop the credential with the identity. Leaving it behind would let the
    // next racer on this machine push their progress into the last one's
    // account.
    setCredential(null);
    setSync({ kind: "off", reason: "not signed in" });
    setIdent(null);
    setStep(1);
  };

  const realmIds = (Object.keys(REALMS) as RealmId[]).filter((id) => !REALMS[id].hidden);
  const isSpace = mode === "spacewars";
  // Both of these modes bring their own world and ignore the realm pick, so the
  // summary must not promise the player the realm they chose.
  const isNeon = mode === "endless";
  const ownWorld = isSpace ? "DEEP SPACE" : isNeon ? "NEON RUN" : null;
  const shownScores = board === "global" ? globalScores ?? [] : localScores;
  const racerName = ident?.name ?? "PLAYER";
  const raceLaps = laps;

  const goStep = (n: number) => setStep(n);

  const launch = () => onStart(racerName, mode, realm, car, laps);
  /** Straight into a race on whatever is currently selected. */
  const quickRace = () => onStart(racerName, mode, realm, car, laps);

  const livery = carColorHex(car);
  const liveryUI = carUIHex(car);   // legible even for the black and white cars

  // ---- sign-in gate -------------------------------------------------------
  // Nobody should have to authenticate to drive a car in a browser, so the
  // guest route is the loud one and Google is the quiet alternative.
  if (!ident) {
    return (
      <div className="home gate">
        <div className="hero-glow" aria-hidden="true" />
        <h1 className="title" translate="no">DUSKLINE</h1>
        <div className="checker hero-rule" aria-hidden="true" />
        <p className="subtitle">drift · boost · jump · blast</p>
        <div className="gate-card">
          <button type="button" className="gate-btn primary" disabled={authBusy} onClick={asGuest}>
            {authBusy ? "SIGNING IN…" : "CONTINUE AS GUEST"}
            <span>you get the next racer number — nothing to fill in</span>
          </button>
          <button
            type="button"
            className="gate-btn"
            disabled={authBusy || !googleConfigured}
            onClick={asGoogle}
            title={googleConfigured ? undefined : "Google sign-in is not configured for this deployment"}
          >
            CONNECT WITH GOOGLE
            <span>
              {googleConfigured
                ? "your name follows you between devices"
                : "not configured on this deployment"}
            </span>
          </button>
          {authError && <p className="gate-error" role="alert">{authError} Try again, or continue as a guest.</p>}
          <p className="gate-note">
            Your display name is the only thing that ever leaves this device, and only when
            you post a score.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="home fit">
      <header className="hero slim">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-row">
          <div className="hero-id">
            <h1 className="title" translate="no">DUSKLINE</h1>
            <span className="hero-kicker">
              <b>{realmIds.length}</b> WORLDS · <b>{CAR_IDS.length}</b> CARS · <b>{MODES.length}</b> MODES
            </span>
          </div>

          <div className="hero-side">
            <button type="button" className="who" onClick={switchRacer} title="Switch racer">
              {ident.picture && <img src={ident.picture} alt="" width={20} height={20} />}
              <span className="who-name">{ident.name}</span>
              <span className="who-swap">SWITCH</span>
            </button>
            {/* Where this player's progress actually lives. A guest is told
                plainly that it is this device only — the alternative is a
                player assuming a browser game syncs, wiping the profile, and
                finding out it did not. */}
            {ident.kind === "google" ? (
              <p className={`sync-line ${sync.kind}`} role="status">
                {sync.kind === "syncing" && "SYNCING…"}
                {sync.kind === "synced" && "✓ SYNCED TO YOUR GOOGLE ACCOUNT"}
                {sync.kind === "failed" && `SYNC FAILED — ${sync.reason}`}
                {sync.kind === "off" &&
                  (hasCredential() ? `NOT SYNCING — ${sync.reason}` : "SAVED ON THIS DEVICE")}
                {!hasCredential() && sync.kind !== "syncing" && (
                  <button type="button" className="sync-now" disabled={authBusy} onClick={asGoogle}>
                    SYNC NOW
                  </button>
                )}
              </p>
            ) : (
              <p className="sync-line guest">SAVED ON THIS DEVICE ONLY</p>
            )}
            <button type="button" className="board-open" onClick={() => setShowBoard(true)}>
              HALL OF LEGENDS
            </button>
            {/* One click to drive. Four steps is the right amount of choice for
                someone who wants to make choices, and three steps too many for
                someone who just wants to play — so both paths exist. */}
            <button type="button" className="quick-race" onClick={quickRace}>
              <span className="qr-go">▸ DRIVE NOW</span>
              <span className="qr-sub">
                {ownWorld ?? REALMS[realm].name} · {CAR_SPECS[car].name} · {MODE_LABEL[mode]}
              </span>
            </button>
            {(() => {
              const hrs = Math.floor(msUntilNext() / 3_600_000);
              return (
                <div className={`daily-card ${dailyRun ? "done" : ""}`}>
                  <div className="daily-copy">
                    <strong>DAILY CHALLENGE</strong>
                    <span>
                      {REALMS[daily.realm].name} · {CAR_SPECS[daily.car].name} · {daily.laps} laps
                      {dailyRun ? ` — you scored ${dailyRun.score.toLocaleString()}` : ""}
                    </span>
                  </div>
                  {dailyRun ? (
                    <span className="daily-wait">NEW IN {hrs}H</span>
                  ) : (
                    <button type="button" className="daily-go" onClick={() => onStartDaily(racerName)}>
                      TAKE IT
                    </button>
                  )}
                </div>
              );
            })()}
            {season && season.round > 0 && (() => {
              const st = seasonStanding(season, racerName);
              const ord = ["1ST", "2ND", "3RD"][st.place - 1] ?? `${st.place}TH`;
              return (
                <div className="season-resume">
                  <div className="season-copy">
                    <strong>CHAMPIONSHIP IN PROGRESS</strong>
                    <span>
                      Round {season.round + 1} of {SEASON_ORDER.length} ·{" "}
                      {REALMS[SEASON_ORDER[season.round]].name} · you are {ord} on {st.points} pts
                    </span>
                  </div>
                  <div className="season-acts">
                    <button type="button" className="season-go" onClick={() => onResumeSeason(racerName)}>
                      RESUME
                    </button>
                    <button
                      type="button"
                      className={`season-drop ${abandonArmed ? "armed" : ""}`}
                      onClick={() => {
                        // a whole championship goes with one click, so it asks once
                        if (!abandonArmed) { setAbandonArmed(true); return; }
                        onAbandonSeason(); setSeason(null); setAbandonArmed(false);
                      }}
                      onBlur={() => setAbandonArmed(false)}
                    >
                      {abandonArmed ? "PRESS AGAIN TO ABANDON" : "ABANDON"}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
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
          <span>{lastResult.gems} gem{lastResult.gems === 1 ? "" : "s"}</span>
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
              return (
                <li key={s.n} className="wiz-step-wrap">
                  <button
                    type="button"
                    className={`wiz-step ${state} reachable`}
                    onClick={() => goStep(s.n)}
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
                const isSel = realm === id;
                return (
                  <button
                    type="button"
                    key={id}
                    className={`realm-card ${isSel ? "selected" : ""}`}
                    style={{ ["--accent" as string]: realmAccent(id) }}
                    aria-pressed={isSel}
                    onClick={() => setRealm(id)}
                  >
                    <span className="realm-media" style={{ background: realmFallback(id) }}>
                      {/* An <img> rather than a CSS background so it decodes
                          off the main thread, and WebP so the twelve of them
                          cost 333 kB instead of 660 kB. The realm's own sky
                          gradient sits behind as the fallback, so a missing
                          file degrades to something thematic.

                          Deliberately NOT loading="lazy". Every card is on
                          screen by design — the step does not scroll — so
                          there is nothing to defer, and lazy loading was
                          observed leaving all twelve cards as bare gradients
                          with zero requests made. Blank cards are exactly the
                          failure this art exists to prevent, and the byte
                          saving came from WebP, not from laziness. */}
                      <img
                        className="realm-preview"
                        src={`/previews/realm-${id}.webp`}
                        alt=""
                        decoding="async"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
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
                  {(() => {
                    // The nearest locked car, so the garage always shows one
                    // thing worth driving toward rather than a wall of
                    // padlocks with no order to them.
                    const next = nextUnlock(career);
                    return next ? (
                      <p className="showroom-next">
                        NEXT: <b>{CAR_SPECS[next.id].name}</b> — {next.req.label}
                      </p>
                    ) : (
                      <p className="showroom-next">Every car unlocked.</p>
                    );
                  })()}
                </div>
              </div>
              <div className="cars">
                {CAR_IDS.map((id) => {
                  const spec = CAR_SPECS[id];
                  const swatch = carUIHex(id);   // the grid swatch has to survive a black livery too
                  const isSel = car === id;
                  const open = isUnlocked(id, career);
                  const req = CAR_REQUIREMENT[id];
                  const pct = open ? 1 : req.progress(career);
                  return (
                    <button
                      type="button"
                      key={id}
                      className={`car-card ${isSel ? "selected" : ""} ${open ? "" : "locked"}`}
                      aria-pressed={isSel}
                      aria-disabled={!open || undefined}
                      aria-label={open
                        ? `${spec.name} — speed ${spec.stars.speed} of 5, acceleration ${spec.stars.accel} of 5, handling ${spec.stars.handling} of 5`
                        : `${spec.name} — locked. ${req.label}.`}
                      onClick={() => open && setCar(id)}
                      style={{ ["--accent" as string]: swatch, ["--earned" as string]: `${Math.round(pct * 100)}%` }}
                    >
                      <span className="pick-flag" aria-hidden="true">PICKED</span>
                      <span className="car-head">
                        <span className="car-chip" style={{ background: swatch, color: swatch }} />
                        <strong>{spec.name}</strong>
                      </span>
                      {!open && (
                        <span className="car-lock">
                          <em>{req.label}</em>
                          <span className="car-lock-bar"><i style={{ width: `${Math.round(pct * 100)}%` }} /></span>
                        </span>
                      )}
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
                {MODES.map((m) => {
                  const isSel = mode === m.id;
                  // Each mode shows the world it actually races in, so the
                  // card is a picture of what you are choosing — it used to be
                  // two lines of text over 70% empty card and a ghost "01".
                  const art: RealmId[] =
                    m.id === "grandprix" ? [...SEASON_ORDER]
                      : m.id === "spacewars" ? ["void"]
                        : m.id === "endless" ? ["neon"]
                          : [realm];
                  return (
                    <button
                      type="button"
                      key={m.id}
                      className={`mode-card ${isSel ? "selected" : ""}`}
                      style={{ ["--accent" as string]: m.accent }}
                      aria-pressed={isSel}
                      onClick={() => setMode(m.id)}
                    >
                      <span className="mode-art" aria-hidden="true" style={{ background: realmFallback(art[0]) }}>
                        {art.map((id) => (
                          <img
                            key={id}
                            src={`/previews/realm-${id}.webp`}
                            alt=""
                            width={480}
                            height={270}
                            decoding="async"
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                          />
                        ))}
                      </span>
                      <span className="pick-flag" aria-hidden="true">PICKED</span>
                      <span className="mode-copy">
                        <strong>{m.name}</strong>
                        <span className="mode-blurb">{m.blurb}</span>
                        <span className="mode-tags">
                          {m.tags.map((t) => <i key={t}>{t}</i>)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {isSpace && (
                <div className="gp-note">
                  Space Wars is fought in deep space — your world pick is swapped for one of two
                  battle tubes. You start armed. Press <b>E</b> to fire.
                </div>
              )}
              {isNeon && (
                <div className="gp-note">
                  Neon Run has its own world — an infinite wet highway under a dead city, so your
                  world pick is set aside. No rivals, no laps, no finish line.
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
                          ? { backgroundImage: `url(/previews/realm-neon.jpg), ${realmFallback("neon")}` }
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
                    {isNeon ? "∞" : `${raceLaps}L`}
                  </span>
                  <span className="loadout-txt">
                    <em>MODE</em>
                    <b>{MODE_LABEL[mode]}</b>
                  </span>
                  <span className="swap" aria-hidden="true">SWAP</span>
                </button>
              </div>

              <div
                className="realm-lore"
                style={{
                  ["--art" as string]: `url(/previews/realm-${isSpace ? "void" : isNeon ? "neon" : realm}.webp)`,
                  background: realmFallback(isNeon ? "neon" : isSpace ? "void" : realm),
                }}
              >
                <em>{ownWorld ?? REALMS[realm].name.toUpperCase()}</em>
                <p>{isSpace ? REALM_LORE.void : isNeon ? REALM_LORE.neon : REALM_LORE[realm]}</p>
              </div>

              {/* Neon Run has no finish line, so a lap count is a number that
                  means nothing there. */}
              {!isNeon && (
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

              <button type="button" className="start" onClick={launch}>
                {isSpace
                  ? "▸ START SPACE WARS"
                  : isNeon
                    ? "▸ START NEON RUN"
                    : `▸ START RACE — ${raceLaps} LAP${raceLaps > 1 ? "S" : ""}`}
              </button>

              <p className="controls-help">
                <b>ARROWS / WASD</b> drive · <b>SPACE</b> nitro · drift for boost · ram rivals to take
                them down · <b>C</b> camera
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
            >
              {step === 1 ? "NEXT — MACHINE ▸" : step === 2 ? "NEXT — MODE ▸" : "NEXT — RACE ▸"}
            </button>
          ) : (
            <span className="wiz-nav-note hot">engines hot</span>
          )}
        </div>
      </section>

      {showBoard && (
        <div className="board-sheet" role="dialog" aria-modal="true" aria-label="Leaderboard">
          <div className="board-scrim" aria-hidden="true" onClick={() => setShowBoard(false)} />
          <section className="leaderboard" ref={boardRef}>
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
              <button type="button" className="board-close" onClick={() => setShowBoard(false)}>
                CLOSE ✕
              </button>
            </div>
            {board === "global" && globalScores !== null && !isGlobal && (
              <p className="board-hint">The shared board isn&rsquo;t switched on for this server yet, so these are this server&rsquo;s scores only.</p>
            )}
            {board === "global" && globalScores === null ? (
              <p className="board-hint" role="status">
                {boardFailed
                  ? "Couldn’t reach the shared board. Your own times are under This device."
                  : "Loading the board…"}
              </p>
            ) : shownScores.length === 0 ? (
              <p className="board-hint">No scores on the board yet. Go plant a flag.</p>
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
                    const isYou = s.name === racerName;
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
        </div>
      )}
    </div>
  );
}
