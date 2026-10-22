/**
 * What a synced profile is, and how two devices' versions of one combine.
 *
 * Split out from sync.ts and importing NOTHING but types, for two reasons.
 * The boundary is real — this is the only part of cross-device sync with a
 * decision in it, while the rest is a fetch and three localStorage writes. And
 * it makes the decision testable: `npm run test:sync` imports this file in
 * plain Node, which it could not do through sync.ts without dragging
 * localStorage and `fetch` along.
 *
 * It matters that this is tested rather than eyeballed, because the failure
 * mode is silent and destructive. A merge that loses a counter does not throw
 * — it just quietly hands the player a smaller career than the one they drove,
 * on whichever machine they happened to open second.
 */

import type { Settings } from "./settings";
import type { Career } from "./progress";
import type { SeasonState } from "./season";

export interface Profile {
  settings: Partial<Settings>;
  career: Career;
  /** null is meaningful: it means "no season in progress", not "unknown". */
  season: SeasonState | null;
  /**
   * Campaign stars: per event, a bitmask of goals met. Optional, because
   * documents written before the campaign existed do not carry it.
   */
  campaign?: Record<string, number>;
  /** epoch ms this document was assembled */
  updated: number;
}

/**
 * Combine what is on the server with what is on this device.
 *
 * WHY NOT LAST-WRITE-WINS ON THE WHOLE DOCUMENT. That is the obvious
 * implementation and it loses things people earned: drive three races on a
 * laptop, then two on a phone that last synced this morning, and whole-
 * document last-write-wins throws one of those sessions away. Career counters
 * are monotonic — races, podiums, wins, metres and best score only ever go up
 * — so they merge element-wise by MAXIMUM. Two devices used in parallel can
 * both contribute and neither can subtract.
 *
 * Settings and the in-progress season are not monotonic and have no sensible
 * element-wise merge, so those take the newer document by timestamp. For a
 * preference that is the right answer anyway: the last one you expressed is
 * the one you meant.
 */
export function mergeProfiles(remote: Profile | null, local: Profile): Profile {
  if (!remote) return local;
  const newer = remote.updated > local.updated ? remote : local;
  return {
    // Preferences: whichever was expressed last, over this device's as a base
    // so a key the older document alone knows about is not dropped.
    settings: { ...local.settings, ...newer.settings },
    career: {
      races: Math.max(remote.career.races, local.career.races),
      podiums: Math.max(remote.career.podiums, local.career.podiums),
      wins: Math.max(remote.career.wins, local.career.wins),
      metres: Math.max(remote.career.metres, local.career.metres),
      bestScore: Math.max(remote.career.bestScore, local.career.bestScore),
      // Seeding is a one-time back-credit for races driven before careers
      // existed. If EITHER side has done it, it must never run again —
      // running it twice would credit the same old scores a second time.
      seeded: Boolean(remote.career.seeded || local.career.seeded),
    },
    // A part-finished championship is one coherent thing: rounds already
    // raced, points already awarded. Half of one device's season merged into
    // the other's is not a season. So take the newer document WHOLE —
    // including a newer null, which is a season the player finished or
    // abandoned. Resurrecting that on the other device would be a bug, not a
    // rescue.
    season: newer.season,
    // A star, once earned, stays earned — so per event, every goal either
    // device has met: bitwise OR over the union of events. Monotonic like the
    // career, so a phone that last synced this morning cannot take a star away.
    campaign: mergeStars(remote.campaign, local.campaign),
    updated: Math.max(remote.updated, local.updated),
  };
}

function mergeStars(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const src of [a ?? {}, b ?? {}]) {
    for (const [id, mask] of Object.entries(src)) {
      if (typeof mask === "number" && Number.isFinite(mask)) out[id] = (out[id] ?? 0) | (mask & 7);
    }
  }
  return out;
}
