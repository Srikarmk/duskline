"use client";

import { useState } from "react";
import type { GameMode, RealmId, CarId, GameResult, RaceStanding } from "@/src/game/engine";
import { REALMS } from "@/src/game3d/realms";
import { CAR_SPECS } from "@/src/game3d/carData";
import { saveScore, saveLastName, saveLastCar, submitGlobalScore, loadScores } from "@/src/ui/leaderboard";
import { beginRace } from "@/src/ui/raceToken";
import { recordResult } from "@/src/ui/progress";
import { loadSeason, saveSeason, clearSeason, SEASON_ORDER, type SeasonState } from "@/src/ui/season";
import { todaysChallenge, recordDaily, dayKey } from "@/src/ui/daily";
import { loadIdentity } from "@/src/ui/identity";
import { pushProfileSoon } from "@/src/ui/sync";
import { eventById, loadCampaign, nextEvent, recordCampaign, goalLabel, type CampaignOutcome } from "@/src/ui/campaign";
import HomeScreen from "./HomeScreen";
import CampaignScreen from "./CampaignScreen";
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

type Screen = "home" | "race" | "intermission" | "gpresult" | "result" | "replay" | "campaign";

// Championship rounds only draw from realms that are live in the picker —
// Ember Wastes is archived while its art is rebuilt.
const GP_ORDER: RealmId[] = SEASON_ORDER;
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

type GpState = SeasonState;

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
  // A season survives the tab closing — see season.ts. Restored on mount, and
  // written back on every change below, so "round 2 of 3" is a thing you can
  // come back to rather than something you had to finish in one sitting.
  const [gp, setGp] = useState<GpState | null>(() => loadSeason());
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

  /** cars earned by the race just finished, shown once on the results screen */
  const [unlocked, setUnlocked] = useState<CarId[]>([]);
  /** the UTC day whose challenge is being raced, or null for an ordinary race */
  const [dailyDay, setDailyDay] = useState<string | null>(null);
  /**
   * The lap the last race recorded, held so WATCH LAP can build a fresh engine
   * around it. Kept in its own state rather than read off `lastResult` at the
   * click, because a Grand Prix replaces the result with an aggregate that was
   * never driven and so has no lap on it.
   */
  const [lastLap, setLastLap] = useState<number[] | null>(null);
  /** the campaign event being raced, or null for anything else */
  const [campaignEvent, setCampaignEvent] = useState<string | null>(null);
  const [campaignOutcome, setCampaignOutcome] = useState<CampaignOutcome | null>(null);
  const [campaignStars, setCampaignStars] = useState<Record<string, number>>({});

  const openCampaign = () => {
    setCampaignStars(loadCampaign());
    setCampaignEvent(null);
    setCampaignOutcome(null);
    setLastResult(null);
    setScreen("campaign");
  };

  /** Race one campaign event, in the car the player has picked. */
  const playCampaignEvent = (id: string) => {
    const ev = eventById(id);
    if (!ev) return;
    setMode(ev.mode);
    setRealm(ev.realm);
    setLaps(ev.laps ?? 3);
    setGp(null);
    setDailyDay(null);
    setLastResult(null);
    setUnlocked([]);
    setCampaignOutcome(null);
    setCampaignEvent(id);
    startRace();
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
    // Career progress, before anything branches. Every finished race counts —
    // including each Grand Prix ROUND, which is a race you drove. The GP's
    // aggregate is deliberately not counted as a fifteenth one.
    const gained = recordResult(result).unlocked;
    if (gained.length) setUnlocked(gained);
    // Every finished race, including each GP round, leaves a lap behind.
    setLastLap(result.replay ?? null);
    // Send the new career (and season, and settings, and campaign stars) up
    // if this player is signed in with a credential from this session.
    // No-ops otherwise, which is every guest and every reloaded tab — see
    // sync.ts. Deferred a tick so the campaign record above is on disk first.
    queueMicrotask(() => pushProfileSoon(loadIdentity()));

    // A daily run is logged against the day it was FOR, not the day it
    // finished — a race started at 23:59 UTC would otherwise be filed under
    // tomorrow and hand the player a second attempt.
    if (dailyDay) {
      recordDaily({ day: dailyDay, score: result.score, timeMs: result.timeMs, position: result.position });
      setDailyDay(null);
    }

    // A campaign race is judged against its event's three goals before it
    // is filed as an ordinary score, so the results screen can say which
    // stars this run earned. The stars are written before the profile push
    // below picks them up.
    if (campaignEvent) {
      setCampaignOutcome(recordCampaign(campaignEvent, result));
    }

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
        const carried = { ...totals, round: nextRound, car, player: gp.player ?? name };
        setGp(carried);
        saveSeason(carried);
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
        clearSeason();
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
        targetDistanceM={campaignEvent ? (eventById(campaignEvent)?.targetKm ?? 0) * 1000 || undefined : undefined}
        onFinish={handleFinish}
        onQuit={() => {
          // Out of a campaign race, back to the campaign — that is where the
          // player came from and what they will want to pick from next.
          if (campaignEvent) { openCampaign(); return; }
          // Leave the SAVED season alone. Quitting out of round two should put
          // you back on the menu with a season to resume, not throw the
          // championship away — that is the point of persisting it. Only the
          // in-memory copy is dropped, so the home screen re-reads storage and
          // offers it back.
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

  if (screen === "campaign") {
    return (
      <CampaignScreen
        stars={campaignStars}
        carName={CAR_SPECS[car]?.name ?? car}
        onPlay={playCampaignEvent}
        onBack={() => setScreen("home")}
      />
    );
  }

  if (screen === "result" && lastResult) {
    const co = campaignOutcome;
    const following = co ? nextEvent(loadCampaign(), co.event.id) : null;
    return (
      <ResultsScreen
        result={lastResult}
        modeLabel={MODE_TITLE[lastResult.mode] ?? lastResult.mode}
        realmName={mode === "spacewars" ? "Deep Space" : REALMS[realm].name}
        realmId={mode === "spacewars" ? "void" : mode === "endless" ? "neon" : realm}
        carName={CAR_SPECS[car]?.name ?? car}
        racer={name}
        isNewBest={resultBest.isNew}
        prevBest={resultBest.prev}
        unlocked={unlocked.map((id) => CAR_SPECS[id].name)}
        campaign={co ? {
          title: co.event.title,
          goals: co.event.goals.map((g, i) => ({ label: goalLabel(g), met: co.met[i], fresh: co.fresh[i] })),
          onNext: following ? () => playCampaignEvent(following.id) : undefined,
          nextTitle: following?.title,
          onCampaign: openCampaign,
        } : undefined}
        // Only offered when there IS a lap. A retirement on lap one, or an
        // endless run that never crossed a line, has nothing to show, and a
        // button that loads a world to display an empty road is worse than no
        // button.
        onWatchLap={lastLap ? () => setScreen("replay") : undefined}
        onRaceAgain={() => {
          setLastResult(null);
          setUnlocked([]);
          setCampaignOutcome(null);
          startRace();
        }}
        onMenu={() => {
          setLastResult(null);
          setUnlocked([]);
          setLastLap(null);
          setCampaignEvent(null);
          setCampaignOutcome(null);
          setScreen("home");
        }}
      />
    );
  }

  if (screen === "replay" && lastLap) {
    return (
      <GameCanvas
        mode={mode}
        realm={realm}
        car={car}
        laps={laps}
        replay={lastLap}
        // A replay cannot finish a race. onFinish is required by the prop
        // contract and unreachable here — update() hands over to replayStep
        // before any of the lap or finish logic runs.
        onFinish={() => {}}
        onQuit={() => setScreen("result")}
      />
    );
  }

  return (
    <HomeScreen
      lastResult={lastResult}
      onOpenCampaign={(playerName, playerCar) => {
        setName(playerName);
        saveLastName(playerName);
        setCar(playerCar);
        saveLastCar(playerCar);
        openCampaign();
      }}
      onResumeSeason={(playerName) => {
        const saved = loadSeason();
        if (!saved) return;
        // Race on under the name the standings are keyed by, so resuming does
        // not silently open a second row in the player's own championship.
        const who = saved.player ?? playerName;
        setName(who);
        saveLastName(who);
        setGp(saved);
        setMode("grandprix");
        setRealm(GP_ORDER[Math.min(saved.round, GP_ORDER.length - 1)]);
        if (saved.car && CAR_SPECS[saved.car as CarId]) setCar(saved.car as CarId);
        setLastResult(null);
        setScreen("intermission");
      }}
      onAbandonSeason={() => { clearSeason(); setGp(null); }}
      onStartDaily={(playerName) => {
        const ch = todaysChallenge();
        setName(playerName);
        saveLastName(playerName);
        setMode("classic");
        setRealm(ch.realm);
        setCar(ch.car);            // deliberately NOT saveLastCar — the daily
        setLaps(ch.laps);          // assigns a car, it does not buy you one
        setGp(null);
        setLastResult(null);
        setCampaignEvent(null);
        setDailyDay(dayKey());
        startRace();
      }}
      onStart={(playerName, playerMode, playerRealm, playerCar, playerLaps) => {
        setName(playerName);
        saveLastName(playerName);
        setCar(playerCar);
        saveLastCar(playerCar);
        setLaps(playerLaps);
        setMode(playerMode);
        setLastResult(null);
        setDailyDay(null);
        setCampaignEvent(null);
        if (playerMode === "grandprix") {
          const fresh: GpState = {
            round: 0, champ: {}, totalScore: 0, totalTimeMs: 0, gems: 0, stunts: 0,
            car: playerCar, player: playerName,
          };
          setGp(fresh);
          saveSeason(fresh);
          setRealm(GP_ORDER[0]);
        } else {
          setRealm(playerRealm);
        }
        startRace();
      }}
    />
  );
}
