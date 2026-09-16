"use client";

import { useEffect, useRef, useState } from "react";
import { drawShareCard, shareCard } from "@/src/ui/shareCard";
import type { GameResult } from "@/src/game/engine";

interface Props {
  result: GameResult;
  realmName: string;
  /** For the share card's art — the preview file is keyed by realm id. */
  realmId: string;
  carName: string;
  racer: string;
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

/** Fixed confetti recipe — deterministic so it never trips hydration, and
 *  small enough (12 composited chips, transform/opacity only) to stay cheap. */
const CONFETTI: { left: string; x: string; delay: string; color: string }[] = [
  { left: "6%", x: "34px", delay: "0s", color: "#fbbf24" },
  { left: "14%", x: "-28px", delay: "0.35s", color: "#f0abfc" },
  { left: "23%", x: "18px", delay: "0.7s", color: "#22d3ee" },
  { left: "31%", x: "-40px", delay: "0.15s", color: "#a855f7" },
  { left: "40%", x: "26px", delay: "0.55s", color: "#fde68a" },
  { left: "48%", x: "-16px", delay: "0.9s", color: "#67e8f9" },
  { left: "57%", x: "38px", delay: "0.25s", color: "#f472b6" },
  { left: "65%", x: "-32px", delay: "0.65s", color: "#fbbf24" },
  { left: "74%", x: "22px", delay: "0.05s", color: "#c084fc" },
  { left: "82%", x: "-24px", delay: "0.8s", color: "#22d3ee" },
  { left: "90%", x: "30px", delay: "0.45s", color: "#fde68a" },
  { left: "96%", x: "-36px", delay: "1s", color: "#f0abfc" },
];

/** Playful, position-aware one-liner under the hero number. */
function taunt(solo: boolean, pos: number, total: number) {
  if (solo) return "clean run — now go beat it";
  if (pos === 1) return "nobody else even saw the finish line";
  if (pos === 2) return "so close you could taste the exhaust";
  if (pos === 3) return "champagne is champagne";
  if (pos === total) return "at least you finished. that counts. mostly.";
  return "solid drive — there's more in it";
}

export default function ResultsScreen({
  result, realmName, realmId, carName, racer, modeLabel, isNewBest, prevBest, onRaceAgain, onMenu,
}: Props) {
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const onShare = async () => {
    setSharing(true);
    try {
      const url = await drawShareCard({
        realmName, realmId, carName, racer, modeLabel,
        score: result.score,
        timeMs: result.timeMs,
        position: result.position,
        totalRacers: result.totalRacers,
        isNewBest,
      });
      if (!url) throw new Error("no canvas");
      const how = await shareCard(url, realmName);
      setShareMsg(how === "shared" ? "SHARED" : "SAVED");
    } catch {
      setShareMsg("COULDN'T SAVE");
    } finally {
      setSharing(false);
      window.setTimeout(() => setShareMsg(null), 2600);
    }
  };

  const solo = !result.totalRacers || result.totalRacers <= 1;
  const pos = result.position ?? 1;
  const total = result.totalRacers ?? 1;
  const win = !solo && pos === 1;
  const podium = !solo && pos <= 3;
  const tier = win ? "gold" : pos === 2 ? "silver" : pos === 3 ? "bronze" : "none";
  const suffix = ordinal(pos).slice(String(pos).length);

  const label = solo
    ? "RACE COMPLETE"
    : win
      ? "VICTORY"
      : podium
        ? "PODIUM FINISH"
        : "RACE COMPLETE";

  const subhead = solo
    ? `${modeLabel} · ${realmName}`
    : `${ordinal(pos)} of ${total} · ${modeLabel} · ${realmName}`;

  // Race again is the primary action — focus it and wire Enter / Esc.
  const againRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    againRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onRaceAgain();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRaceAgain, onMenu]);

  const rows: { label: string; value: string }[] = [
    { label: "TIME", value: formatTime(result.timeMs) },
    { label: "GEMS", value: `${result.gems}` },
    { label: "STUNTS", value: `${result.stunts}` },
    { label: "LANE BONUS", value: `${result.laneBonuses}` },
  ];
  if (result.penalties) rows.push({ label: "PENALTIES", value: `−${result.penalties}` });

  return (
    <div className="home results-screen">
      <div className={`result-hero tier-${tier} ${podium ? "podium" : ""} ${solo ? "solo" : ""}`}>
        {podium && (
          <div className="confetti" aria-hidden="true">
            {CONFETTI.map((c, i) => (
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

        <span className="result-badge">FINISH LINE</span>

        <div className="place-hero">
          {solo ? (
            <div className="place-time" aria-label={`Finish time ${formatTime(result.timeMs)}`}>
              {formatTime(result.timeMs)}
            </div>
          ) : (
            <div className="place-ordinal" aria-label={`${ordinal(pos)} place`}>
              <span className="place-num" aria-hidden="true">{pos}</span>
              <span className="place-suffix" aria-hidden="true">{suffix}</span>
            </div>
          )}
          <div className="place-label">{label}</div>
        </div>

        <p className="subtitle result-subhead">{subhead}</p>
        <p className="result-taunt">{taunt(solo, pos, total)}</p>
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
                    <span className={`pos rank-${s.position <= 3 ? s.position : "n"}`}>{s.position}</span>
                    <span className="who">{s.name}</span>
                    {s.isPlayer && <span className="tag">YOU</span>}
                  </li>
                ))}
            </ol>
          </div>
        )}
      </div>

      <div className="result-actions">
        <button type="button" ref={againRef} className="start" onClick={onRaceAgain}>
          ▸ RACE AGAIN <kbd>Enter</kbd>
        </button>
        {/* Nothing this game produced was shareable, which for a browser game
            is the whole distribution problem — the only way anyone hears about
            it is if a player has something to show. */}
        <button type="button" className="result-menu" disabled={sharing} onClick={onShare}>
          {shareMsg ?? (sharing ? "…" : "SHARE RESULT")}
        </button>
        <button type="button" className="result-menu" onClick={onMenu}>
          MENU <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}
