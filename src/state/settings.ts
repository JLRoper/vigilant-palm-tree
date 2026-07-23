export type HorseVariant = "hero" | "bubbly";

export interface GameSettings {
  moveDurationMs: number;
  horseVariant: HorseVariant;
}

const STORAGE_KEY = "heroesJs.settings";
const MIN_MOVE_MS = 40;
const MAX_MOVE_MS = 1000;
const DEFAULT_MOVE_MS = 220;
const DEFAULT_HORSE_VARIANT: HorseVariant = "bubbly";

export const DEFAULT_SETTINGS: GameSettings = {
  moveDurationMs: DEFAULT_MOVE_MS,
  horseVariant: DEFAULT_HORSE_VARIANT,
};

let current: GameSettings = loadFromStorage();

const listeners = new Set<(s: GameSettings) => void>();

export function settings(): GameSettings {
  return current;
}

export function clampMoveDurationMs(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_MOVE_MS;
  return Math.max(MIN_MOVE_MS, Math.min(MAX_MOVE_MS, Math.round(ms)));
}

export function updateSettings(patch: Partial<GameSettings>): GameSettings {
  const next: GameSettings = {
    moveDurationMs: clampMoveDurationMs(patch.moveDurationMs ?? current.moveDurationMs),
    horseVariant: patch.horseVariant ?? current.horseVariant,
  };
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn(next);
  return next;
}

export function subscribeSettings(fn: (s: GameSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function settingsBounds(): { min: number; max: number; default: number } {
  return { min: MIN_MOVE_MS, max: MAX_MOVE_MS, default: DEFAULT_MOVE_MS };
}

function loadFromStorage(): GameSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      moveDurationMs: clampMoveDurationMs(parsed.moveDurationMs ?? DEFAULT_MOVE_MS),
      horseVariant: parsed.horseVariant === "hero" || parsed.horseVariant === "bubbly"
        ? parsed.horseVariant
        : DEFAULT_HORSE_VARIANT,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
