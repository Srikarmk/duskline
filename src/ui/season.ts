import type { RealmId } from "../game/engine";
import { read, write, remove } from "./storage";

/**
 * A Grand Prix season, persisted.
 *
 * The championship already existed — three rounds, points per finish, a table
 * at the end — but it lived entirely in React state. Close the tab after round
 * one and the season was gone, which makes a multi-round format something you
 * have to finish in a single sitting or not attempt. That is the whole of
 * audit item 17: "a season with standings is the same code with persistence".
 *
 * Stored rather than derived, because the standings depend on the names and
 * finishing positions of rivals in races that are over — there is nothing left
 * to recompute them from.
 */
export interface SeasonState {
  /** index into the season's realm order; the round about to be raced */
  round: number;
  /** championship points by racer name, the player included */
  champ: Record<string, number>;
  totalScore: number;
  totalTimeMs: number;
  gems: number;
  stunts: number;
  /** the car the season was started in — a season is driven in one car */
  car?: string;
  /**
   * The player's name AT THE TIME the season started.
   *
   * The standings are keyed by racer name, and the player's own key is
   * whatever they were called when each round was scored. Looking their row up
   * by their CURRENT name breaks the moment they sign in, switch from guest to
   * Google, or are simply issued a different guest number — the resume card
   * then reports them last on zero points in a championship they are leading.
   * Found exactly that way, with a planted season and a mismatched name.
   */
  player?: string;
  /** when it was last touched, so a stale season can be recognised */
  updated?: number;
}

const KEY = "season";

/** Seasons older than this are dropped rather than offered. */
const STALE_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

export function loadSeason(): SeasonState | null {
  try {
    const raw = read(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SeasonState;
    if (typeof s?.round !== "number" || !s.champ) return null;
    if (s.updated && Date.now() - s.updated > STALE_MS) { clearSeason(); return null; }
    return s;
  } catch {
    return null;
  }
}

export function saveSeason(s: SeasonState): void {
  try {
    write(KEY, JSON.stringify({ ...s, updated: Date.now() }));
  } catch {
    // storage blocked — the season still works for this sitting
  }
}

export function clearSeason(): void {
  try {
    remove(KEY);
  } catch {
    // nothing to do
  }
}

/** Where the player sits right now, for the resume card. */
export function seasonStanding(s: SeasonState, playerName: string): { place: number; of: number; points: number } {
  const rows = Object.entries(s.champ).sort((a, b) => b[1] - a[1]);
  const key = s.player ?? playerName;
  const i = rows.findIndex(([n]) => n === key);
  return {
    place: i < 0 ? rows.length + 1 : i + 1,
    of: Math.max(rows.length, 1),
    points: i < 0 ? 0 : rows[i][1],
  };
}

/** The realms a season visits, in order. */
export const SEASON_ORDER: RealmId[] = ["forest", "bay", "peaks"];
