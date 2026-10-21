/**
 * Fetch the race's assets while the player is still choosing.
 *
 * Pressing DRIVE starts a ~900 kB download of textures the service worker has
 * never seen, and the world cannot build until they arrive — so the first race
 * of a visit opens on a loading screen. But a player spends ten or twenty
 * seconds on the setup steps doing nothing that touches the network. This uses
 * that time.
 *
 * It is only a warm-up: nothing here is awaited and nothing depends on it. The
 * requests go through the service worker's stale-while-revalidate path, so a
 * successful warm means the race reads them out of cache instead of the wire,
 * and a failed one costs nothing.
 *
 * Restraint matters more than speed here:
 *   - `saveData` and 2g/3g connections are skipped outright. Spending a
 *     megabyte of someone's data plan on a race they have not started yet is
 *     not a trade we get to make for them.
 *   - It waits for the browser to be idle, so it never competes with the menu
 *     for bandwidth or main thread.
 *   - Each URL is fetched once per session.
 */

// From realms.ts, NOT textures.ts: textures.ts imports three.js, and this file
// is reached statically from the home screen.
import { SHARED_SETS, groundTextureFor } from "@/src/game3d/realms";

const MAPS = ["diff", "nor", "arm"] as const;
const done = new Set<string>();

type Conn = { saveData?: boolean; effectiveType?: string };

function shouldWarm(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (navigator as Navigator & { connection?: Conn }).connection;
  if (!c) return true;                       // no information: assume it is fine
  if (c.saveData) return false;              // they asked us not to
  if (c.effectiveType && /^(slow-)?2g$|^3g$/.test(c.effectiveType)) return false;
  return true;
}

function warmUrl(url: string): void {
  if (done.has(url)) return;
  done.add(url);
  // `low` priority so this never competes with anything the player can see.
  void fetch(url, { priority: "low" } as RequestInit).catch(() => {
    done.delete(url);   // let a later attempt retry a transient failure
  });
}

const idle = (fn: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 4000 });
  else window.setTimeout(fn, 1200);
};

/**
 * Warm the sets every race needs, plus the ground for this realm.
 *
 * Safe to call on every realm change — already-fetched URLs are skipped, and
 * most realms share a ground albedo, so switching between them is usually free.
 */
export function warmRaceAssets(realmId: string): void {
  if (typeof window === "undefined" || !shouldWarm()) return;
  idle(() => {
    for (const set of [...SHARED_SETS, groundTextureFor(realmId)]) {
      for (const map of MAPS) warmUrl(`/textures/${set}_${map}.webp`);
    }
  });
}
