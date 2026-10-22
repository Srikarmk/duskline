/**
 * The campaign: THE DUSK LINE. Twelve races and a finale, ordered by the hour
 * in each world's own sky — afternoon heat, then sunset, then night — so the
 * campaign is a drive into the dark, which is what the game is named for.
 *
 * Imports nothing but types, like profileMerge.ts, so `npm run test:campaign`
 * can check the data and the scoring in plain Node.
 *
 * HOW THE GOALS ARE SET. Every goal is judged from the GameResult the race
 * already produces — no engine logic knows a campaign exists. They avoid lap
 * times and scores on purpose: those depend on a track's length and layout
 * and nobody has measured them per world, so a time target would be a guess
 * dressed as a challenge. What is used instead:
 *
 *   place   finishing position — the same rivals and rubber band everywhere
 *   gems    a SHARE of the gems the race put down (result.gemsOffered), so a
 *           goal is the same difficulty on a 2.4 km lap and a 6.5 km one
 *   stunts  tricks landed; worlds were picked for it by their ramp count
 *   lanes   clean-lane bonuses (4 s in one lane above 30% speed), set at
 *           about 1.5 per km of race, from lap lengths measured 2026-10-22
 *   reach   Neon Run distance, for the finale (the engine ends the run there)
 *   time    the finale only: Neon Run has no rivals, so the clock is the rival
 *
 * Every number here is a first pass. Retune freely — the data test only
 * checks that each goal is well-formed and every chapter can be opened.
 */

import type { GameResult, RealmId } from "../game/engine";

export type Goal =
  | { kind: "place"; max: number }
  | { kind: "gems"; share: number }
  | { kind: "stunts"; min: number }
  | { kind: "lanes"; min: number }
  | { kind: "reach"; km: number }
  | { kind: "time"; maxS: number };

export interface CampaignEvent {
  id: string;
  title: string;
  realm: RealmId;
  mode: "classic" | "endless";
  /** laps for a circuit event */
  laps?: number;
  /** Neon Run only: where the run ends */
  targetKm?: number;
  brief: string;
  /** star one, two, three — each earned on its own, on any attempt */
  goals: [Goal, Goal, Goal];
}

export interface Chapter {
  id: string;
  name: string;
  /** the hour on the clock this chapter's skies sit at */
  hour: string;
  /** stars needed (from the whole campaign) to open it */
  needStars: number;
  blurb: string;
  events: CampaignEvent[];
}

const place = (max: number): Goal => ({ kind: "place", max });
const gems = (share: number): Goal => ({ kind: "gems", share });
const stunts = (min: number): Goal => ({ kind: "stunts", min });
const lanes = (min: number): Goal => ({ kind: "lanes", min });

export const CHAPTERS: Chapter[] = [
  {
    id: "golden",
    name: "GOLDEN HOUR",
    hour: "5 PM",
    needStars: 0,
    blurb: "The sun is still up and the tarmac is still warm. Learn the car before the light goes.",
    events: [
      {
        id: "heat-haze", title: "HEAT HAZE", realm: "mirage", mode: "classic", laps: 1,
        brief: "One long lap of new tarmac across the sand. The skyline wobbles; the road does not.",
        goals: [place(5), gems(0.25), place(1)],
      },
      {
        id: "red-rock", title: "RED ROCK", realm: "basin", mode: "classic", laps: 2,
        brief: "Two hundred miles of nothing, cut down to two laps. Hold a lane and let the poles count for you.",
        goals: [place(5), lanes(16), place(1)],
      },
      {
        id: "the-drop", title: "THE DROP", realm: "cape", mode: "classic", laps: 2,
        brief: "Hills on one side, two hundred feet of air on the other. The ramps are there to be used.",
        goals: [place(5), stunts(1), place(1)],
      },
      {
        id: "riviera", title: "RIVIERA", realm: "azur", mode: "classic", laps: 2,
        brief: "Barriers instead of run-off and a harbour full of yachts watching you get it wrong.",
        goals: [place(4), gems(0.3), place(1)],
      },
    ],
  },
  {
    id: "sunset",
    name: "SUNSET",
    hour: "7 PM",
    needStars: 6,
    blurb: "The sky catches fire and the field gets serious. Podiums from here on.",
    events: [
      {
        id: "causeway", title: "CAUSEWAY", realm: "bay", mode: "classic", laps: 2,
        brief: "Ten miles of causeway between a burning sky and a flat calm sea. Nowhere to hide on a straight.",
        goals: [place(3), gems(0.35), place(1)],
      },
      {
        id: "city-lights", title: "CITY LIGHTS", realm: "hills", mode: "classic", laps: 2,
        brief: "Canyon switchbacks above a grid of lights coming on one street at a time.",
        goals: [place(3), lanes(11), place(1)],
      },
      {
        id: "snowline", title: "SNOWLINE", realm: "hokkai", mode: "classic", laps: 2,
        brief: "Plowed walls, black firs and the most ramps of any pass. Land them flat.",
        goals: [place(3), stunts(2), place(1)],
      },
      {
        id: "thin-air", title: "THIN AIR", realm: "peaks", mode: "classic", laps: 3,
        brief: "Steep climbs, tight twists and less grip with every metre you gain.",
        goals: [place(3), gems(0.4), place(1)],
      },
    ],
  },
  {
    id: "night",
    name: "NIGHT",
    hour: "11 PM",
    needStars: 14,
    blurb: "Floodlights, neon and moonlight. Nobody gives you a place any more.",
    events: [
      {
        id: "floodlit", title: "FLOODLIT", realm: "circuit", mode: "classic", laps: 3,
        brief: "A real grand-prix stadium after dark — grandstands, floodlights and flat-out sweepers.",
        goals: [place(3), lanes(12), place(1)],
      },
      {
        id: "midnight", title: "MIDNIGHT", realm: "metro", mode: "classic", laps: 3,
        brief: "A street circuit through the city at midnight: glass towers, wet asphalt, no margin.",
        goals: [place(2), gems(0.45), place(1)],
      },
      {
        id: "moonlit", title: "MOONLIT", realm: "forest", mode: "classic", laps: 3,
        brief: "Moonlit woods and glowing mushrooms. The prettiest track in the game, and the shortest lap.",
        goals: [place(2), stunts(3), place(1)],
      },
      {
        id: "zero-g", title: "ZERO-G", realm: "void", mode: "classic", laps: 2,
        brief: "An anti-gravity glass tube through deep space — huge climbs, huge drops, nothing below.",
        goals: [place(2), gems(0.4), place(1)],
      },
    ],
  },
  {
    id: "finale",
    name: "THE DUSK LINE",
    hour: "3 AM",
    needStars: 24,
    blurb: "No rivals and no finish line — except the one at the end of this run.",
    events: [
      {
        id: "dusk-line", title: "THE DUSK LINE", realm: "neon", mode: "endless", targetKm: 6,
        brief: "Six kilometres of wet highway under a dead city. Get there. Get there quickly.",
        goals: [{ kind: "reach", km: 6 }, gems(0.3), { kind: "time", maxS: 165 }],
      },
    ],
  },
];

export const EVENTS: CampaignEvent[] = CHAPTERS.flatMap((c) => c.events);
export const TOTAL_STARS = EVENTS.length * 3;

export function eventById(id: string): CampaignEvent | undefined {
  return EVENTS.find((e) => e.id === id);
}

export function chapterOf(id: string): Chapter | undefined {
  return CHAPTERS.find((c) => c.events.some((e) => e.id === id));
}

/** What a goal asks, in the words the event card and the results screen use. */
export function goalLabel(g: Goal): string {
  switch (g.kind) {
    case "place":
      return g.max === 1 ? "Win" : g.max === 3 ? "Finish on the podium" : `Finish ${ordinal(g.max)} or better`;
    case "gems": return `Collect ${Math.round(g.share * 100)}% of the gems`;
    case "stunts": return g.min === 1 ? "Land a trick" : `Land ${g.min} tricks`;
    case "lanes": return `Hold ${g.min} clean lanes`;
    case "reach": return `Reach ${g.km} km`;
    case "time": return `Do it in under ${Math.floor(g.maxS / 60)}:${String(g.maxS % 60).padStart(2, "0")}`;
  }
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}

/** Which of an event's three goals this result met. */
export function evaluate(ev: CampaignEvent, r: GameResult): [boolean, boolean, boolean] {
  const met = (g: Goal): boolean => {
    switch (g.kind) {
      case "place": return r.position !== undefined && r.position <= g.max;
      case "gems": return (r.gemsOffered ?? 0) > 0 && r.gems / (r.gemsOffered ?? 1) >= g.share;
      case "stunts": return r.stunts >= g.min;
      case "lanes": return r.laneBonuses >= g.min;
      case "reach": return (r.distanceM ?? 0) >= g.km * 1000 - 1;
      // the clock only counts if the run actually got there
      case "time": return (r.distanceM ?? 0) >= (ev.targetKm ?? 0) * 1000 - 1 && r.timeMs <= g.maxS * 1000;
    }
  };
  return [met(ev.goals[0]), met(ev.goals[1]), met(ev.goals[2])];
}

/** A per-event record is a bitmask: bit i = goal i has been met, ever. */
export function maskOf(met: readonly boolean[]): number {
  return met.reduce((m, ok, i) => (ok ? m | (1 << i) : m), 0);
}

export function starsIn(mask: number): number {
  return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
}

export function totalStars(stars: Record<string, number>): number {
  return EVENTS.reduce((n, e) => n + starsIn(stars[e.id] ?? 0), 0);
}

export function chapterOpen(ch: Chapter, stars: Record<string, number>): boolean {
  return totalStars(stars) >= ch.needStars;
}

/** The next event worth playing: the first open one that still has a star in it. */
export function nextEvent(stars: Record<string, number>, after?: string): CampaignEvent | null {
  const open = CHAPTERS.filter((c) => chapterOpen(c, stars)).flatMap((c) => c.events);
  const start = after ? open.findIndex((e) => e.id === after) + 1 : 0;
  const rest = [...open.slice(start), ...open.slice(0, start)];
  return rest.find((e) => e.id !== after && starsIn(stars[e.id] ?? 0) < 3) ?? null;
}
