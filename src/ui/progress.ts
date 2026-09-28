import type { CarId, GameResult } from "../game/engine";
import { CAR_IDS } from "../game3d/carData";
import { read, write } from "./storage";

/**
 * Career progress: what the player has done, and what that has unlocked.
 *
 * The garage used to hand you all fourteen cars on the first visit, which
 * makes the roster a menu rather than something you get to. Every car is now
 * behind a requirement you can see, and the requirements are written so there
 * is always exactly one that is close.
 *
 * NOBODY LOSES A CAR. A returning player has saved scores but no record of
 * where they FINISHED — placings were never stored — so podiums and wins
 * cannot be reconstructed. Rather than pretend, `seedFromHistory` credits one
 * race per saved score and leaves the rest at zero: a head start that is
 * honest about what it knows, instead of either wiping the garage or silently
 * unlocking everything.
 */
export interface Career {
  /** races actually finished (the results screen was reached) */
  races: number;
  /** finishes in the top three */
  podiums: number;
  /** outright wins */
  wins: number;
  /** total distance driven, metres */
  metres: number;
  /** best score, any mode */
  bestScore: number;
  /** set once seedFromHistory has run, so it never runs twice */
  seeded?: boolean;
}

const KEY = "career";

const EMPTY: Career = { races: 0, podiums: 0, wins: 0, metres: 0, bestScore: 0 };

export function loadCareer(): Career {
  try {
    const raw = read(KEY);
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<Career>) };
  } catch {
    return { ...EMPTY };
  }
}

function save(c: Career): void {
  try {
    write(KEY, JSON.stringify(c));
  } catch {
    // storage blocked — progression is a nice-to-have, not a blocker
  }
}

/** One-time credit for races played before any of this existed. */
export function seedFromHistory(savedScoreCount: number): Career {
  const c = loadCareer();
  if (c.seeded) return c;
  c.seeded = true;
  c.races = Math.max(c.races, savedScoreCount);
  save(c);
  return c;
}

/** Fold a finished race into the career record. Returns the cars it unlocked. */
export function recordResult(r: GameResult): { career: Career; unlocked: CarId[] } {
  const before = new Set(unlockedCars(loadCareer()));
  const c = loadCareer();
  c.races += 1;
  if (r.position === 1) c.wins += 1;
  if (r.position !== undefined && r.position <= 3) c.podiums += 1;
  c.metres += Math.max(0, Math.round(r.distanceM ?? 0));
  c.bestScore = Math.max(c.bestScore, r.score);
  save(c);
  const unlocked = unlockedCars(c).filter((id) => !before.has(id));
  return { career: c, unlocked };
}

export interface Requirement {
  /** what has to be true, as a predicate on the career record */
  met: (c: Career) => boolean;
  /** how far along, 0..1, for the progress bar on a locked card */
  progress: (c: Career) => number;
  /**
   * Roughly how much racing is still needed, in comparable units.
   *
   * Ranking the "next" car by `progress` alone is wrong and it showed the
   * moment a fresh career was tested: every fraction is 0, nothing compares
   * greater than anything else, and the pick falls through to whichever car
   * happens to come first in the list — which was MERIDIAN, at six wins, the
   * single hardest thing in the game presented to someone who has not
   * finished a race. Effort ranks a podium above a win above twenty races
   * even when all three sit at zero.
   */
  effort: (c: Career) => number;
  /** shown on the locked card */
  label: string;
}

/** What one of each counts as, relative to finishing a race. */
const WEIGHT: Partial<Record<keyof Career, number>> = { races: 1, podiums: 3.2, wins: 6.5 };

const always: Requirement = { met: () => true, progress: () => 1, effort: () => 0, label: "" };
const after = (n: number, what: keyof Career, label: string): Requirement => ({
  met: (c) => (c[what] as number) >= n,
  progress: (c) => Math.min(1, (c[what] as number) / n),
  effort: (c) => Math.max(0, n - (c[what] as number)) * (WEIGHT[what] ?? 1),
  label,
});

/**
 * What each car costs.
 *
 * Four are free, one of each character, so the first visit still offers a
 * real choice rather than one car and thirteen padlocks. After that the
 * thresholds interleave races, podiums and wins so the next unlock is never
 * more than a few races away and never the same task twice running.
 */
export const CAR_REQUIREMENT: Record<CarId, Requirement> = {
  f40: always,
  imprez: always,
  fairlady: always,
  fc3s: always,

  zanza: after(3, "races", "Finish 3 races"),
  iroc: after(6, "races", "Finish 6 races"),
  a90: after(1, "podiums", "Finish on the podium"),
  r34: after(3, "podiums", "3 podium finishes"),
  firehawk: after(12, "races", "Finish 12 races"),
  p930: after(1, "wins", "Win a race"),
  testa: after(6, "podiums", "6 podium finishes"),
  tauro: after(3, "wins", "Win 3 races"),
  veloce: after(20, "races", "Finish 20 races"),
  meridian: after(6, "wins", "Win 6 races"),
};

export function isUnlocked(id: CarId, c: Career = loadCareer()): boolean {
  return (CAR_REQUIREMENT[id] ?? always).met(c);
}

export function unlockedCars(c: Career = loadCareer()): CarId[] {
  return CAR_IDS.filter((id) => isUnlocked(id, c));
}

/** The next car to aim at: the locked one needing the least racing from here. */
export function nextUnlock(c: Career = loadCareer()): { id: CarId; req: Requirement } | null {
  const locked = CAR_IDS.filter((id) => !isUnlocked(id, c));
  if (!locked.length) return null;
  let best = locked[0];
  for (const id of locked) {
    if (CAR_REQUIREMENT[id].effort(c) < CAR_REQUIREMENT[best].effort(c)) best = id;
  }
  return { id: best, req: CAR_REQUIREMENT[best] };
}
