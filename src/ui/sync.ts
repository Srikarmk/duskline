/**
 * Settings, career and season, carried between devices by a Google account.
 * AUDIT item 21.
 *
 * This module is the plumbing: who is signed in, what goes over the wire, and
 * when. The one decision in the whole feature — how two devices' versions of a
 * profile combine — lives in profileMerge.ts, on its own and under test.
 */

import { loadSettings, saveSettings } from "./settings";
import { loadCareer, writeCareer } from "./progress";
import { loadSeason, saveSeason, clearSeason } from "./season";
import { loadCampaign, writeCampaign } from "./campaign";
import { mergeProfiles, type Profile } from "./profileMerge";
import type { Identity } from "./identity";

export { mergeProfiles };
export type { Profile };

export type SyncState =
  | { kind: "off"; reason: string }
  | { kind: "syncing" }
  | { kind: "synced"; at: number }
  | { kind: "failed"; reason: string };

/**
 * The Google credential for THIS SESSION, held in memory only.
 *
 * Deliberately not persisted. It is a bearer token for `/api/profile`, it
 * expires in about an hour anyway, and writing it to localStorage would leave
 * a credential sitting on disk to buy nothing — a reload can ask Google for a
 * fresh one, which is a button, not a security trade.
 */
let credential: string | null = null;

export function setCredential(token: string | null): void {
  credential = token;
}

export function hasCredential(): boolean {
  return credential !== null;
}

/** Only a signed-in Google player has anything to sync. See the route. */
export function syncable(id: Identity | null): boolean {
  return Boolean(id && id.kind === "google" && credential);
}

/** Everything worth carrying, as it stands on this device right now. */
export function localProfile(): Profile {
  return {
    settings: loadSettings(),
    career: loadCareer(),
    season: loadSeason(),
    campaign: loadCampaign(),
    updated: Date.now(),
  };
}

/** Write a merged profile over the local one. */
export function applyProfile(p: Profile): void {
  saveSettings(p.settings);
  writeCareer(p.career);
  if (p.season) saveSeason(p.season);
  else clearSeason();
  if (p.campaign) writeCampaign(p.campaign);
}

interface ProfileResponse {
  synced: boolean;
  reason?: string;
  profile?: Profile | null;
}

async function call(profile?: Profile): Promise<ProfileResponse> {
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile === undefined ? { credential } : { credential, profile }),
  });
  // A 401/413 still carries a reason worth showing; only a dead response is a
  // blank failure.
  try {
    return (await res.json()) as ProfileResponse;
  } catch {
    return { synced: false, reason: `http ${res.status}` };
  }
}

/**
 * Pull, merge, apply, push. Run once at sign-in.
 *
 * The push is not optional: after a merge this device holds something neither
 * side had, and leaving it unsent would mean the other device never learns
 * about the races driven here.
 */
export async function syncOnSignIn(id: Identity | null): Promise<SyncState> {
  if (!syncable(id)) return { kind: "off", reason: "not signed in" };
  try {
    const pulled = await call();
    if (!pulled.synced) return { kind: "off", reason: pulled.reason ?? "unavailable" };
    const merged = mergeProfiles(pulled.profile ?? null, localProfile());
    applyProfile(merged);
    const pushed = await call(merged);
    if (!pushed.synced) return { kind: "failed", reason: pushed.reason ?? "unavailable" };
    return { kind: "synced", at: Date.now() };
  } catch {
    return { kind: "failed", reason: "offline" };
  }
}

/**
 * Send the current state up. Called after a race and after a settings change.
 *
 * Coalesced, because finishing a Grand Prix round writes career, season and
 * settings in the same tick and three uploads of the same document is two too
 * many.
 */
let pushTimer = 0;
export function pushProfileSoon(id: Identity | null, onState?: (s: SyncState) => void): void {
  if (!syncable(id)) return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    onState?.({ kind: "syncing" });
    void call(localProfile())
      .then((r) => onState?.(r.synced
        ? { kind: "synced", at: Date.now() }
        : { kind: "failed", reason: r.reason ?? "unavailable" }))
      .catch(() => onState?.({ kind: "failed", reason: "offline" }));
  }, 1200);
}
