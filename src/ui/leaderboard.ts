import type { GameMode, GameResult } from "@/src/game/engine";

export interface ScoreEntry {
  name: string;
  score: number;
  mode: GameMode;
  timeMs: number;
  date: string;
}

const KEY = "fantasy-racer-scores";
const NAME_KEY = "fantasy-racer-name";
const MAX_ENTRIES = 10;

export function loadScores(): ScoreEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScoreEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveScore(name: string, result: GameResult): ScoreEntry[] {
  const entry: ScoreEntry = {
    name,
    score: result.score,
    mode: result.mode,
    timeMs: result.timeMs,
    date: new Date().toISOString().slice(0, 10),
  };
  const scores = [...loadScores(), entry]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(scores));
  } catch {
    // storage full or blocked; leaderboard just won't persist
  }
  return scores;
}

export interface GlobalScores {
  scores: ScoreEntry[];
  global: boolean;
}

export async function fetchGlobalScores(): Promise<GlobalScores | null> {
  try {
    const res = await fetch("/api/scores", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as GlobalScores;
  } catch {
    return null;
  }
}

export async function submitGlobalScore(
  name: string,
  result: GameResult
): Promise<GlobalScores | null> {
  try {
    const res = await fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        score: result.score,
        mode: result.mode,
        timeMs: result.timeMs,
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as GlobalScores;
  } catch {
    return null;
  }
}

export function loadLastName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NAME_KEY) ?? "";
}

export function saveLastName(name: string) {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // ignore
  }
}
