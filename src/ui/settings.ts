export interface Settings {
  bloom: boolean;
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  camera: number; // default camera preset index
}

const KEY = "fantasy-racer-settings";
const DEFAULTS: Settings = { bloom: true, musicVolume: 0.7, sfxVolume: 0.9, camera: 0 };

export function loadSettings(): Settings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const merged = { ...loadSettings(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
  return merged;
}

export function loadSetting<K extends keyof Settings>(key: K, fallback: Settings[K]): Settings[K] {
  const s = loadSettings();
  return s[key] ?? fallback;
}
