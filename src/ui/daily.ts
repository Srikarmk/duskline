import type { CarId, RealmId } from "../game/engine";
import { CAR_IDS } from "../game3d/carData";
import { REALMS } from "../game3d/realms";
import { read, write } from "./storage";

/**
 * The daily challenge: the same realm, car and lap count for everyone, once a
 * day.
 *
 * NO SERVER IS INVOLVED IN THE PICK, and that is the point. The audit filed
 * this behind the KV store, but only the shared leaderboard needs one — "the
 * same for everyone" is a property of deriving the pick from the DATE, which
 * every client already agrees on. A hash of the UTC day indexes the tables,
 * so two people on opposite sides of the world get the same challenge without
 * exchanging a byte.
 *
 * UTC, not local time, for exactly that reason: a local-date seed would give
 * Auckland and Los Angeles different challenges for most of the day and make
 * any future shared board meaningless.
 *
 * THE CAR IS ASSIGNED, including cars the player has not unlocked. A fixed
 * challenge has to be the same challenge, so it cannot depend on a garage;
 * and being handed something you have not earned yet is a reason to come back
 * rather than a hole in the progression.
 */

/** Today, as YYYY-MM-DD in UTC. */
export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Deterministic 32-bit hash — the same string always gives the same number. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Realms the daily can choose: the ones on the picker, not the mode-only ones. */
const DAILY_REALMS: RealmId[] = (Object.keys(REALMS) as RealmId[]).filter((id) => !REALMS[id].hidden);

const LAP_CHOICES = [2, 3, 3, 4];

export interface DailyChallenge {
  day: string;
  realm: RealmId;
  car: CarId;
  laps: number;
}

export function todaysChallenge(now: Date = new Date()): DailyChallenge {
  const day = dayKey(now);
  // Three independent draws from one seed. Salting each keeps the realm from
  // marching in lockstep with the car as the date increments, which is what a
  // single counter would do.
  const r = hash(`${day}:realm`);
  const c = hash(`${day}:car`);
  const l = hash(`${day}:laps`);
  return {
    day,
    realm: DAILY_REALMS[r % DAILY_REALMS.length],
    car: CAR_IDS[c % CAR_IDS.length],
    laps: LAP_CHOICES[l % LAP_CHOICES.length],
  };
}

interface DailyRecord {
  day: string;
  score: number;
  timeMs: number;
  position?: number;
}

const KEY = "daily";

/** The player's run for a given day, if they have taken it. */
export function dailyResult(day: string = dayKey()): DailyRecord | null {
  try {
    const raw = read(KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as DailyRecord;
    return rec && rec.day === day ? rec : null;
  } catch {
    return null;
  }
}

export function dailyTaken(day: string = dayKey()): boolean {
  return dailyResult(day) !== null;
}

export function recordDaily(rec: DailyRecord): void {
  try {
    write(KEY, JSON.stringify(rec));
  } catch {
    // storage blocked — the run still counted for this sitting
  }
}

/** Milliseconds until the next challenge, for the "back in 6h" line. */
export function msUntilNext(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, next - now.getTime());
}
