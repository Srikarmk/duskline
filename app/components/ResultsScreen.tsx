"use client";

import type { GameResult } from "@/src/game/engine";

interface Props {
  result: GameResult;
  realmName: string;
  modeLabel: string;
  isNewBest: boolean;
  prevBest: number;
  onRaceAgain: () => void;
  onMenu: () => void;
}

function formatTime(ms: number) {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const tenths = Math.floor((s * 10) % 10);
  return `${m}:${String(sec).padStart(2, "0")}.${tenths}`;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export default function ResultsScreen({
  result, realmName, modeLabel, isNewBest, prevBest, onRaceAgain, onMenu,
}: Props) {
  const solo = !result.totalRacers || result.totalRacers <= 1;
  const pos = result.position ?? 1;
  const total = result.totalRacers ?? 1;
  const win = !solo && pos === 1;
  const podium = !solo && pos <= 3;

  const headline = solo
    ? "RACE COMPLETE"
    : win
      ? "🏆 VICTORY"
      : podium
        ? "PODIUM FINISH"
        : "RACE COMPLETE";

  const subhead = solo
    ? `${modeLabel} · ${realmName}`
    : `${ordinal(pos)} of ${total} · ${modeLabel} · ${realmName}`;

  const rows: { label: string; value: string; accent?: boolean }[] = [
    { label: "TIME", value: formatTime(result.timeMs) },
    { label: "GEMS", value: `${result.gems}` },
    { label: "STUNTS", value: `${result.stunts}` },
    { label: "LANE BONUS", value: `${result.laneBonuses}` },
  ];
  if (result.penalties) rows.push({ label: "PENALTIES", value: `−${result.penalties}` });

  return (
    <div className="home results-screen">
      <div className={`result-hero ${win ? "win" : podium ? "podium" : ""}`}>
        <span className="result-badge">FINISH</span>
        <h1 className="title result-title">{headline}</h1>
        <p className="subtitle">{subhead}</p>
      </div>

      <div className="result-card">
        <div className="result-score">
          <em>FINAL SCORE</em>
          <strong>{result.score.toLocaleString()}</strong>
          {isNewBest ? (
            <span className="result-best new">★ NEW PERSONAL BEST</span>
          ) : (
            <span className="result-best">best {prevBest.toLocaleString()}</span>
          )}
        </div>

        <div className="result-stats">
          {rows.map((r) => (
            <div className="result-stat" key={r.label}>
              <em>{r.label}</em>
              <b>{r.value}</b>
            </div>
          ))}
        </div>

        {result.standings && result.standings.length > 1 && (
          <div className="result-standings">
            <h2>FINISHING ORDER</h2>
            <ol>
              {result.standings
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((s) => (
                  <li key={s.position} className={s.isPlayer ? "you" : ""}>
                    <span className="pos">{s.position}</span>
                    <span className="who">{s.name}</span>
                    {s.isPlayer && <span className="tag">YOU</span>}
                  </li>
                ))}
            </ol>
          </div>
        )}
      </div>

      <div className="result-actions">
        <button className="start" onClick={onRaceAgain}>▸ RACE AGAIN</button>
        <button className="result-menu" onClick={onMenu}>MENU</button>
      </div>
    </div>
  );
}
