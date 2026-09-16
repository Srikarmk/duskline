/**
 * Namespaced localStorage, with a fallback to the pre-rename keys.
 *
 * The game was called Fantasy Racer and everything it saved was prefixed
 * `fantasy-racer-`. Renaming to Duskline without handling that would silently
 * wipe every returning player's car, scores, settings and identity — they
 * would come back to a fresh install and no explanation.
 *
 * The migration is LAZY rather than a one-shot pass at startup: a read misses
 * the new key, finds the old one, adopts it and deletes the old. That means
 * there is no ordering problem (no "did the migration run before this module
 * loaded?"), it is idempotent, and a player who never returns costs nothing.
 *
 * Every localStorage access in the app goes through here.
 */

const NS = "duskline";
const LEGACY_NS = "fantasy-racer";

export function key(suffix: string): string {
  return `${NS}-${suffix}`;
}

/** Read a namespaced value, adopting the pre-rename key if that is all there is. */
export function read(suffix: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const current = window.localStorage.getItem(key(suffix));
    if (current !== null) return current;
    const legacy = window.localStorage.getItem(`${LEGACY_NS}-${suffix}`);
    if (legacy === null) return null;
    // Adopt it under the new name, then drop the old one so this only ever
    // happens once per key per device.
    window.localStorage.setItem(key(suffix), legacy);
    window.localStorage.removeItem(`${LEGACY_NS}-${suffix}`);
    return legacy;
  } catch {
    return null;   // private mode, or storage blocked
  }
}

export function write(suffix: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(suffix), value);
  } catch {
    // Storage blocked. The session still works, it just will not persist.
  }
}

export function remove(suffix: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(suffix));
    window.localStorage.removeItem(`${LEGACY_NS}-${suffix}`);
  } catch {
    // nothing to do
  }
}
