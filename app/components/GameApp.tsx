"use client";

import { useState } from "react";
import type { GameMode, RealmId, CarId, GameResult, RaceStanding } from "@/src/game/engine";
import { REALMS } from "@/src/game3d/realms";
import { saveScore, saveLastName, saveLastCar, submitGlobalScore, loadScores } from "@/src/ui/leaderboard";
import { beginRace } from "@/src/ui/raceToken";
import HomeScreen from "./HomeScreen";
import ResultsScreen from "./ResultsScreen";
import dynamic from "next/dynamic";

/**
 * The engine is loaded ON DEMAND, not with the menu.
 *
 * GameCanvas imports the whole Three.js engine, and a static import put all of
 * it in the first chunk — 405 kB of JavaScript to display a menu that does not
 * render a single triangle. Now the menu loads on its own and the engine
 * arrives while the player is choosing a world, which is time they were
 * spending anyway.
 *
 * ssr:false because it touches WebGL on mount; the loading state matters
 * because on a slow connection this is the gap between pressing DRIVE and the
 * world appearing, and an unexplained blank screen reads as a crash.
 */
const GameCanvas = dynamic(() => import("./GameCanvas"), {
  ssr: false,
  loading: () => (
    <div className="engine-loading">
      <span className="engine-loading-bar" aria-hidden="true" />
      <p>WARMING UP THE ENGINE…</p>
    </div>
  ),
});

type Screen = "home" | "race" | "intermission" | "gpresult" | "result";

// Championship rounds only draw from realms that are live in the picker —
// Ember Wastes is archived while its art is rebuilt.
const GP_ORDER: RealmId[] = ["forest", "bay", "peaks"];
const CHAMP_PTS = [10, 6, 3, 1];

/** Fixed confetti recipe for the champion screen — deterministic (no hydration
 *  risk) and only 10 composited chips, so it stays cheap. */
const GP_CONFETTI: { left: string; x: string; delay: string; color: string }[] = [
  { left: "8%", x: "30px", delay: "0s", color: "#fbbf24" },
  { left: "18%", x: "-26px", delay: "0.4s", color: "#f0abfc" },
  { left: "29%", x: "20px", delay: "0.75s", color: "#22d3ee" },
  { left: "39%", x: "-36px", delay: "0.2s", color: "#a855f7" },
  { left: "50%", x: "28px", delay: "0.6s", color: "#fde68a" },
  { left: "61%", x: "-18px", delay: "0.95s", color: "#67e8f9" },
  { left: "71%", x: "34px", delay: "0.3s", color: "#f472b6" },
  { left: "81%", x: "-30px", delay: "0.7s", color: "#fbbf24" },
  { left: "90%", x: "24px", delay: "0.1s", color: "#c084fc" },
  { left: "96%", x: "-22px", delay: "0.85s", color: "#22d3ee" },
];

const MODE_TITLE: Record<GameMode, string> = {
  classic: "Classic Circuit",
  transform: "Transformer Rush", grandprix: "Grand Prix", spacewars: "Space Wars",
  endless: "Neon Run",
};

interface GpState {
  round: number;
  champ: Record<string, number>;
  totalScore: number;
  totalTimeMs: number;
  gems: number;
  stunts: number;
}

interface ChampRow {
  name: string;
  points: number;
  isPlayer: boolean;
}

function toRows(champ: Record<string, number>, playerName: string): ChampRow[] {
  return Object.entries(champ)
    .map(([name, points]) => ({ name, points, isPlayer: name === playerName }))
    .sort((a, b) => b.points - a.points);
}

export default function GameApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [mode, setMode] = useState<GameMode>("classic");
  const [realm, setRealm] = useState<RealmId>("forest");
  const [car, setCar] = useState<CarId>("f40");
  const [laps, setLaps] = useState(3);
  const [name, setName] = useState("");
  const [lastResult, setLastResult] = useState<GameResult | null>(null);
  const [gp, setGp] = useState<GpState | null>(null);
  const [gpFinal, setGpFinal] = useState<ChampRow[] | null>(null);
  const [resultBest, setResultBest] = useState({ prev: 0, isNew: false });

  /**
   * The only way into a race.
   *
   * Every entry point goes through here so none of them can forget to ask for
   * a race ticket — the server timestamps it at the start and checks the
   * claimed duration against it, so a ticket requested at submission time
   * would prove nothing. See src/server/raceToken.ts.
   */
  const startRace = () => {
    beginRace();
    setScreen("race");
  };

  const applyStandings = (champ: Record<string, number>, standings: RaceStanding[]) => {
    const next = { ...champ };
    for (const s of standings) {
      const key = s.isPlayer ? name : s.name;
      next[key] = (next[key] ?? 0) + (CHAMP_PTS[s.position - 1] ?? 0);
    }
    return next;
  };

  const handleFinish = (result: GameResult) => {
    if (mode === "grandprix" && gp) {
      const champ = applyStandings(gp.champ, result.standings ?? []);
      const totals: GpState = {
        round: gp.round,
        champ,
        totalScore: gp.totalScore + result.score,
        totalTimeMs: gp.totalTimeMs + result.timeMs,
        gems: gp.gems + result.gems,
        stunts: gp.stunts + result.stunts,
      };

      if (gp.round < GP_ORDER.length - 1) {
        const nextRound = gp.round + 1;
        setGp({ ...totals, round: nextRound });
        setRealm(GP_ORDER[nextRound]);
        setScreen("intermission");
      } else {
        const rows = toRows(champ, name);
        const rank = rows.findIndex((r) => r.isPlayer) + 1;
        const aggregate: GameResult = {
          mode: "grandprix",
          score: totals.totalScore,
          gems: totals.gems,
          stunts: totals.stunts,
          laneBonuses: 0,
          penalties: 0,
          timeMs: totals.totalTimeMs,
          position: rank || 1,
          totalRacers: rows.length,
        };
        saveScore(name, aggregate);
        void submitGlobalScore(name, aggregate);
        setLastResult(aggregate);
        setGpFinal(rows);
        setGp(null);
        setScreen("gpresult");
      }
      return;
    }

    // single race modes — show a results screen (was: dump straight to home)
    const prevBest = loadScores().reduce((m, s) => Math.max(m, s.score), 0);
    saveScore(name, result);
    void submitGlobalScore(name, result);
    setResultBest({ prev: prevBest, isNew: result.score > prevBest });
    setLastResult(result);
    setScreen("result");
  };

  if (screen === "race") {
    return (
      <GameCanvas
        mode={mode}
        realm={realm}
        car={car}
        laps={laps}
        onFinish={handleFinish}
        onQuit={() => {
          setGp(null);
          setScreen("home");
        }}
      />
    );
  }

  if (screen === "intermission" && gp) {
    const rows = toRows(gp.champ, name);
    const nextRealmId = GP_ORDER[gp.round];
    const nextRealm = REALMS[nextRealmId];
    const done = gp.round;
    const totalRounds = GP_ORDER.length;
    const lead = rows[0]?.points ?? 0;
    const you = rows.findIndex((r) => r.isPlayer) + 1;
    return (
      <div className="home gp-screen">
        <div className="result-hero tier-none">
          <span className="result-badge">INTERMISSION</span>
          <h1 className="title result-title">GRAND PRIX</h1>
          <div className="checker hero-rule" aria-hidden="true" />
          <p className="subtitle">round {done} of {totalRounds} in the books</p>
          <div className="gp-rounds" aria-label={`Round ${done} of ${totalRounds}`}>
            {GP_ORDER.map((_, i) => (
              <span key={i} className={`gp-dot ${i < done ? "done" : i === done ? "next" : ""}`} />
            ))}
          </div>
          {you > 0 && (
            <p className="result-taunt">
              {you === 1 ? "you're leading the championship — hold it" : `P${you} in the championship — ${lead - (rows[you - 1]?.points ?? 0)} pts off the lead`}
            </p>
          )}
        </div>

        <div className="result-card">
          <div className="result-standings championship">
            <h2>CHAMPIONSHIP</h2>
            <ol>
              {rows.map((r, i) => (
                <li key={r.name} className={r.isPlayer ? "you" : ""}>
                  <span className={`pos rank-${i + 1 <= 3 ? i + 1 : "n"}`}>{i + 1}</span>
                  <span className="who">{r.name}</span>
                  {r.isPlayer && <span className="tag">YOU</span>}
                  <span className="pts-track" aria-hidden="true">
                    <span
                      className="pts-bar"
                      style={{ width: `${lead > 0 ? (r.points / lead) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="pts">{r.points} pts</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="next-realm">
            <span
              className="next-realm-art"
              style={{ backgroundImage: `url(/previews/realm-${nextRealmId}.jpg)` }}
              aria-hidden="true"
            />
            <span className="next-realm-txt">
              <em>UP NEXT · ROUND {done + 1}</em>
              <strong>{nextRealm.name}</strong>
              <span>{nextRealm.blurb}</span>
            </span>
          </div>
        </div>

        <div className="result-actions">
          <button type="button" className="start" onClick={startRace}>
            ▸ TO THE GRID
          </button>
        </div>
      </div>
    );
  }

  if (screen === "gpresult" && gpFinal) {
    const win = gpFinal[0]?.isPlayer;
    const rank = gpFinal.findIndex((r) => r.isPlayer) + 1 || 1;
    const podium = rank <= 3;
    const tier = win ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "none";
    const lead = gpFinal[0]?.points ?? 0;
    return (
      <div className="home gp-screen results-screen">
        <div className={`result-hero tier-${tier} ${podium ? "podium" : ""}`}>
          {podium && (
            <div className="confetti" aria-hidden="true">
              {GP_CONFETTI.map((c, i) => (
                <i
                  key={i}
                  style={{
                    left: c.left,
                    ["--x" as string]: c.x,
                    ["--d" as string]: c.delay,
                    ["--c" as string]: c.color,
                  }}
                />
              ))}
            </div>
          )}
          <span className="result-badge">GRAND PRIX</span>
          <div className="place-hero">
            <div className="place-ordinal" aria-label={`${rank} place overall`}>
              <span className="place-num" aria-hidden="true">{rank}</span>
              <span className="place-suffix" aria-hidden="true">
                {["th", "st", "nd", "rd"][rank] ?? "th"}
              </span>
            </div>
            <div className="place-label">{win ? "CHAMPION" : podium ? "ON THE PODIUM" : "SEASON COMPLETE"}</div>
          </div>
          <p className="subtitle result-subhead">final championship standings</p>
          <p className="result-taunt">
            {win
              ? "three realms, one winner. that trophy is yours."
              : podium
                ? "a season on the podium — the trophy is one push away"
                : "the season is done. the rematch starts whenever you're ready."}
          </p>
        </div>

        <div className="result-card">
          <div className="result-standings championship">
            <h2>FINAL STANDINGS</h2>
            <ol>
              {gpFinal.map((r, i) => (
                <li key={r.name} className={r.isPlayer ? "you" : ""}>
                  <span className={`pos rank-${i + 1 <= 3 ? i + 1 : "n"}`}>{i + 1}</span>
                  <span className="who">{r.name}</span>
                  {r.isPlayer && <span className="tag">YOU</span>}
                  <span className="pts-track" aria-hidden="true">
                    <span
                      className="pts-bar"
                      style={{ width: `${lead > 0 ? (r.points / lead) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="pts">{r.points} pts</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="result-actions">
          <button
            type="button"
            className="start"
            onClick={() => {
              setGpFinal(null);
              setScreen("home");
            }}
          >
            ▸ BACK TO MENU
          </button>
        </div>
      </div>
    );
  }

  if (screen === "result" && lastResult) {
    return (
      <ResultsScreen
        result={lastResult}
        modeLabel={MODE_TITLE[lastResult.mode] ?? lastResult.mode}
        realmName={mode === "spacewars" ? "Deep Space" : REALMS[realm].name}
        isNewBest={resultBest.isNew}
        prevBest={resultBest.prev}
        onRaceAgain={() => {
          setLastResult(null);
          startRace();
        }}
        onMenu={() => {
          setLastResult(null);
          setScreen("home");
        }}
      />
    );
  }

  return (
    <HomeScreen
      lastResult={lastResult}
      onStart={(playerName, playerMode, playerRealm, playerCar, playerLaps) => {
        setName(playerName);
        saveLastName(playerName);
        setCar(playerCar);
        saveLastCar(playerCar);
        setLaps(playerLaps);
        setMode(playerMode);
        setLastResult(null);
        if (playerMode === "grandprix") {
          setGp({ round: 0, champ: {}, totalScore: 0, totalTimeMs: 0, gems: 0, stunts: 0 });
          setRealm(GP_ORDER[0]);
        } else {
          setRealm(playerRealm);
        }
        startRace();
      }}
    />
  );
}
