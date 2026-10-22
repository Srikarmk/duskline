import type { GameResult } from "../game/engine";
import { read, write } from "./storage";
import { evaluate, eventById, maskOf, type CampaignEvent } from "./campaignData";

export * from "./campaignData";

/**
 * Campaign progress on this device: one bitmask of earned goals per event.
 *
 * Stars are never taken away. A goal met once stays met, so a player can earn
 * the win on one attempt and the gems on another — chasing a third star
 * should not mean redoing the other two in the same race. That is also what
 * makes it safe to sync: two devices' records merge by bitwise OR (see
 * profileMerge.ts), and nothing can go backwards.
 */
const KEY = "campaign";

export function loadCampaign(): Record<string, number> {
  try {
    const raw = read(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { stars?: Record<string, number> };
    return parsed && typeof parsed.stars === "object" && parsed.stars ? parsed.stars : {};
  } catch {
    return {};
  }
}

/** Overwrite the record wholesale — only sync does this, after merging. */
export function writeCampaign(stars: Record<string, number>): void {
  try {
    write(KEY, JSON.stringify({ v: 1, stars }));
  } catch {
    // storage blocked — the stars still show on this results screen
  }
}

export interface CampaignOutcome {
  event: CampaignEvent;
  /** this race, goal by goal */
  met: [boolean, boolean, boolean];
  /** goals earned for the FIRST time by this race */
  fresh: [boolean, boolean, boolean];
  /** the event's record after this race */
  mask: number;
}

/** Fold a finished campaign race into the record. */
export function recordCampaign(eventId: string, r: GameResult): CampaignOutcome | null {
  const event = eventById(eventId);
  if (!event) return null;
  const stars = loadCampaign();
  const before = stars[eventId] ?? 0;
  const met = evaluate(event, r);
  const mask = before | maskOf(met);
  stars[eventId] = mask;
  writeCampaign(stars);
  const fresh = met.map((ok, i) => ok && !(before & (1 << i))) as [boolean, boolean, boolean];
  return { event, met, fresh, mask };
}
