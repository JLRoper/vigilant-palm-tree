import { HORSE_VARIANT_REGISTRY, type HorseVariantId, VALID_HORSE_VARIANTS } from "../render/horseVariants";

export type HorseVariant = HorseVariantId;

export type ResourceStyle =
  | "rune-stone"
  | "cartography-pin"
  | "illustrated-pin"
  | "constellation"
  | "heraldic-crest"
  | "isometric-pile"
  | "iso-pile-smol"
  | "iso-bubbly";

export interface GameSettings {
  moveDurationMs: number;
  horseVariant: HorseVariant;
  resourceStyle: ResourceStyle;
  territoryBorderWidth: number;
  populationGrowthRate: number;
  upgradePopulationGate: number;
}

const STORAGE_KEY = "heroesJs.settings";
const MIN_MOVE_MS = 40;
const MAX_MOVE_MS = 1000;
const DEFAULT_MOVE_MS = 220;
const MIN_BORDER_WIDTH = 1.5;
const MAX_BORDER_WIDTH = 6;
const DEFAULT_BORDER_WIDTH = 1.5;
const DEFAULT_HORSE_VARIANT: HorseVariant = "bubbly";

const RESOURCE_STYLES: readonly ResourceStyle[] = [
  "rune-stone", "cartography-pin", "illustrated-pin", "constellation",
  "heraldic-crest", "isometric-pile", "iso-pile-smol", "iso-bubbly",
];
const DEFAULT_RESOURCE_STYLE: ResourceStyle = "rune-stone";

const MIN_GROWTH_RATE = 0.01;
const MAX_GROWTH_RATE = 0.50;
const DEFAULT_GROWTH_RATE = 0.10;
const MIN_UPGRADE_GATE = 0.25;
const MAX_UPGRADE_GATE = 1.00;
const DEFAULT_UPGRADE_GATE = 0.85;

export { VALID_HORSE_VARIANTS, HORSE_VARIANT_REGISTRY };

export const DEFAULT_SETTINGS: GameSettings = {
  moveDurationMs: DEFAULT_MOVE_MS,
  horseVariant: DEFAULT_HORSE_VARIANT,
  resourceStyle: DEFAULT_RESOURCE_STYLE,
  territoryBorderWidth: DEFAULT_BORDER_WIDTH,
  populationGrowthRate: DEFAULT_GROWTH_RATE,
  upgradePopulationGate: DEFAULT_UPGRADE_GATE,
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

export function clampBorderWidth(w: number): number {
  if (!Number.isFinite(w)) return DEFAULT_BORDER_WIDTH;
  return Math.max(MIN_BORDER_WIDTH, Math.min(MAX_BORDER_WIDTH, Math.round(w * 10) / 10));
}

export function clampResourceStyle(style: unknown): ResourceStyle {
  return RESOURCE_STYLES.includes(style as ResourceStyle)
    ? (style as ResourceStyle)
    : DEFAULT_RESOURCE_STYLE;
}

export function clampGrowthRate(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_GROWTH_RATE;
  const clamped = Math.max(MIN_GROWTH_RATE, Math.min(MAX_GROWTH_RATE, r));
  return Math.round(clamped * 100) / 100;
}

export function clampUpgradeGate(g: number): number {
  if (!Number.isFinite(g)) return DEFAULT_UPGRADE_GATE;
  const clamped = Math.max(MIN_UPGRADE_GATE, Math.min(MAX_UPGRADE_GATE, g));
  return Math.round(clamped * 100) / 100;
}

export function updateSettings(patch: Partial<GameSettings>): GameSettings {
  const next: GameSettings = {
    moveDurationMs: clampMoveDurationMs(patch.moveDurationMs ?? current.moveDurationMs),
    horseVariant: (patch.horseVariant && (VALID_HORSE_VARIANTS as readonly string[]).includes(patch.horseVariant)
    ? patch.horseVariant
    : current.horseVariant) as HorseVariant,
    resourceStyle: clampResourceStyle(patch.resourceStyle ?? current.resourceStyle),
    territoryBorderWidth: clampBorderWidth(patch.territoryBorderWidth ?? current.territoryBorderWidth),
    populationGrowthRate: clampGrowthRate(patch.populationGrowthRate ?? current.populationGrowthRate),
    upgradePopulationGate: clampUpgradeGate(patch.upgradePopulationGate ?? current.upgradePopulationGate),
  };
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
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

export function borderWidthBounds(): { min: number; max: number; default: number } {
  return { min: MIN_BORDER_WIDTH, max: MAX_BORDER_WIDTH, default: DEFAULT_BORDER_WIDTH };
}

export function resourceStyleOptions(): readonly ResourceStyle[] {
  return RESOURCE_STYLES;
}

export function growthRateBounds(): { min: number; max: number; default: number } {
  return { min: MIN_GROWTH_RATE, max: MAX_GROWTH_RATE, default: DEFAULT_GROWTH_RATE };
}

export function upgradeGateBounds(): { min: number; max: number; default: number } {
  return { min: MIN_UPGRADE_GATE, max: MAX_UPGRADE_GATE, default: DEFAULT_UPGRADE_GATE };
}

function loadFromStorage(): GameSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      moveDurationMs: clampMoveDurationMs(parsed.moveDurationMs ?? DEFAULT_MOVE_MS),
      horseVariant: (VALID_HORSE_VARIANTS as readonly string[]).includes(parsed.horseVariant as string)
        ? (parsed.horseVariant as HorseVariant)
        : DEFAULT_HORSE_VARIANT,
      resourceStyle: clampResourceStyle(parsed.resourceStyle),
      territoryBorderWidth: clampBorderWidth(parsed.territoryBorderWidth ?? DEFAULT_BORDER_WIDTH),
      populationGrowthRate: clampGrowthRate(parsed.populationGrowthRate ?? DEFAULT_GROWTH_RATE),
      upgradePopulationGate: clampUpgradeGate(parsed.upgradePopulationGate ?? DEFAULT_UPGRADE_GATE),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
