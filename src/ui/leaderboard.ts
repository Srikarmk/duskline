import type { GameMode, GameResult, CarId } from "@/src/game/engine";
import { read, write, remove } from "./storage";

export interface ScoreEntry {
  name: string;
  score: number;
  mode: GameMode;
  timeMs: number;
  date: string;
}

const KEY = "scores";
const NAME_KEY = "name";

/**
 * Saved-data version. Bumped when an id in a saved payload stops existing.
 *
 * The car ids were renamed wholesale (comet -> f40 and so on) and the realm
 * list has grown twice. A returning visitor's stored car resolves to
 * CAR_SPECS[undefined], and their saved scores carry dead realm ids that
 * render blank. There is no sensible remap — the cars are different cars — so
 * anything from an older version is dropped rather than shown wrong.
 */
const SCHEMA_KEY = "schema";
// 3: "timetrial" and "nitro" were removed from GameMode, so any saved score
// carrying one of those labels no longer has a mode to render.
const SCHEMA = 3;

function migrateIfStale(): void {
  if (typeof window === "undefined") return;
  try {
    const have = Number(read(SCHEMA_KEY) ?? 0);
    if (have >= SCHEMA) return;
    remove(KEY);
    remove(CAR_KEY);
    write(SCHEMA_KEY, String(SCHEMA));
  } catch {
    // storage unavailable (private mode, blocked) — nothing to migrate
  }
}
const CAR_KEY = "car";
const MAX_ENTRIES = 10;

export function loadScores(): ScoreEntry[] {
  if (typeof window === "undefined") return [];
  try {
    migrateIfStale();
    const raw = read(KEY);
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
    write(KEY, JSON.stringify(scores));
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
  return read(NAME_KEY) ?? "";
}

export function saveLastName(name: string) {
  try {
    write(NAME_KEY, name);
  } catch {
    // ignore
  }
}

export function loadLastCar(): CarId | null {
  if (typeof window === "undefined") return null;
  migrateIfStale();
  return (read(CAR_KEY) as CarId | null) ?? null;
}

export function saveLastCar(car: CarId) {
  try {
    write(CAR_KEY, car);
  } catch {
    // ignore
  }
}
