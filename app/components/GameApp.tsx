"use client";

import { useState } from "react";
import type { GameMode, RealmId, CarId, GameResult, RaceStanding } from "@/src/game/engine";
import { REALMS } from "@/src/game3d/realms";
import { saveScore, saveLastName, saveLastCar, submitGlobalScore, loadScores } from "@/src/ui/leaderboard";
import HomeScreen from "./HomeScreen";
import GameCanvas from "./GameCanvas";
import ResultsScreen from "./ResultsScreen";

type Screen = "home" | "race" | "intermission" | "gpresult" | "result";

const GP_ORDER: RealmId[] = ["forest", "ember", "peaks"];
const CHAMP_PTS = [10, 6, 3, 1];

const MODE_TITLE: Record<GameMode, string> = {
  classic: "Classic Circuit", timetrial: "Time Trial", nitro: "Nitro Sprint",
  transform: "Transformer Rush", grandprix: "Grand Prix", spacewars: "Space Wars",
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
  const [car, setCar] = useState<CarId>("comet");
  const [laps, setLaps] = useState(3);
  const [name, setName] = useState("");
  const [lastResult, setLastResult] = useState<GameResult | null>(null);
  const [gp, setGp] = useState<GpState | null>(null);
  const [gpFinal, setGpFinal] = useState<ChampRow[] | null>(null);
  const [resultBest, setResultBest] = useState({ prev: 0, isNew: false });

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
    const nextRealm = REALMS[GP_ORDER[gp.round]];
    const done = gp.round;
    const totalRounds = GP_ORDER.length;
    return (
      <div className="home gp-screen">
        <div className="result-hero tier-none">
          <span className="result-badge">INTERMISSION</span>
          <h1 className="title result-title">GRAND PRIX</h1>
          <p className="subtitle">round {done} of {totalRounds} complete</p>
          <div className="gp-rounds" aria-label={`Round ${done} of ${totalRounds}`}>
            {GP_ORDER.map((_, i) => (
              <span key={i} className={`gp-dot ${i < done ? "done" : i === done ? "next" : ""}`} />
            ))}
          </div>
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
                  <span className="pts">{r.points} pts</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="realm-lore">
            <em>UP NEXT · {nextRealm.name.toUpperCase()}</em>
            <p>{nextRealm.blurb}</p>
          </div>
        </div>

        <div className="result-actions">
          <button className="start" onClick={() => setScreen("race")}>
            ▸ NEXT RACE
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
    return (
      <div className="home gp-screen results-screen">
        <div className={`result-hero tier-${tier} ${podium ? "podium" : ""}`}>
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
                  <span className="pts">{r.points} pts</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="result-actions">
          <button
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
          setScreen("race");
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
        setScreen("race");
      }}
    />
  );
}
