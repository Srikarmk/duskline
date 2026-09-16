/**
 * Quality tier. The individual toggles were never enough on their own — the
 * things that actually cost frames here are the render resolution, the shadow
 * map and the post chain, and none of those were reachable by a player whose
 * machine could not hold 60.
 *
 *  high   — everything on, device pixel ratio up to 2
 *  medium — half-size shadow map, dpr capped at 1.5, no radial blur
 *  low    — shadows off, dpr 1, no post effects at all
 */

import { read, write } from "./storage";
export type Quality = "high" | "medium" | "low";

export interface Settings {
  quality: Quality;
  bloom: boolean;
  ao: boolean; // screen-space ambient occlusion (contact shadows)
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  camera: number; // default camera preset index
  /** show a frame-time readout — the only way to get a real number off a
   *  machine that is not the one this was built on */
  showFps: boolean;
}

const KEY = "settings";
const DEFAULTS: Settings = {
  quality: "high", bloom: true, ao: false,
  musicVolume: 0.7, sfxVolume: 0.9, camera: 0, showFps: false,
};

/** Knobs per tier, read by the engine at build AND on a live settings change. */
export const QUALITY: Record<Quality, {
  dprCap: number; shadow: number | 0; post: boolean; scenery: number;
}> = {
  high:   { dprCap: 2,   shadow: 4096, post: true,  scenery: 1 },
  medium: { dprCap: 1.5, shadow: 2048, post: true,  scenery: 0.6 },
  low:    { dprCap: 1,   shadow: 0,    post: false, scenery: 0.35 },
};

export function loadSettings(): Settings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = read(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const merged = { ...loadSettings(), ...patch };
  try {
    write(KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
  return merged;
}

export function loadSetting<K extends keyof Settings>(key: K, fallback: Settings[K]): Settings[K] {
  const s = loadSettings();
  return s[key] ?? fallback;
}
