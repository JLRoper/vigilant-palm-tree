import { HORSE_VARIANT_REGISTRY, type HorseVariantId, VALID_HORSE_VARIANTS } from "../../shared/horseVariants";

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
  resourceStyle: ResourceStyle;
  territoryBorderWidth: number;
  populationGrowthRate: number;
  upgradePopulationGate: number;
  spriteVariant: number;
  cityBgOffsetX: number;
  cityBgOffsetY: number;
  buildingUpgradeConfirm: boolean;
  parallaxEnabled: boolean;
  parallaxLayerCount: number;
}

const STORAGE_KEY = "heroesJs.settings";
const MIN_MOVE_MS = 40;
const MAX_MOVE_MS = 1000;
const DEFAULT_MOVE_MS = 220;
const MIN_BORDER_WIDTH = 1.5;
const MAX_BORDER_WIDTH = 6;
const DEFAULT_BORDER_WIDTH = 1.5;

const RESOURCE_STYLES: readonly ResourceStyle[] = [
  "rune-stone", "cartography-pin", "illustrated-pin", "constellation",
  "heraldic-crest", "isometric-pile", "iso-pile-smol", "iso-bubbly",
];
const DEFAULT_RESOURCE_STYLE: ResourceStyle = "rune-stone";

const MIN_SPRITE_VARIANT = 1;
const MAX_SPRITE_VARIANT = 5;
const DEFAULT_SPRITE_VARIANT = 1;

const MIN_GROWTH_RATE = 0.01;
const MAX_GROWTH_RATE = 0.50;
const DEFAULT_GROWTH_RATE = 0.10;
const MIN_UPGRADE_GATE = 0.25;
const MAX_UPGRADE_GATE = 1.00;
const DEFAULT_UPGRADE_GATE = 0.85;
const MIN_BG_OFFSET = -500;
const MAX_BG_OFFSET = 500;
const DEFAULT_BG_OFFSET = 0;

const MIN_PARALLAX_LAYERS = 2;
const MAX_PARALLAX_LAYERS = 4;
const DEFAULT_PARALLAX_LAYERS = 4;

export const PARALLAX_SPEEDS: Record<number, number[]> = {
  2: [0.10, 1.00],
  3: [0.10, 0.40, 1.00],
  4: [0.10, 0.30, 0.60, 1.00],
};

export { VALID_HORSE_VARIANTS, HORSE_VARIANT_REGISTRY };

export const DEFAULT_SETTINGS: GameSettings = {
  moveDurationMs: DEFAULT_MOVE_MS,
  resourceStyle: DEFAULT_RESOURCE_STYLE,
  territoryBorderWidth: DEFAULT_BORDER_WIDTH,
  populationGrowthRate: DEFAULT_GROWTH_RATE,
  upgradePopulationGate: DEFAULT_UPGRADE_GATE,
  spriteVariant: DEFAULT_SPRITE_VARIANT,
  cityBgOffsetX: DEFAULT_BG_OFFSET,
  cityBgOffsetY: DEFAULT_BG_OFFSET,
  buildingUpgradeConfirm: true,
  parallaxEnabled: false,
  parallaxLayerCount: DEFAULT_PARALLAX_LAYERS,
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

export function clampSpriteVariant(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(MIN_SPRITE_VARIANT, Math.min(MAX_SPRITE_VARIANT, Math.round(v)));
  }
  return DEFAULT_SPRITE_VARIANT;
}

export function clampBgOffset(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_BG_OFFSET;
  return Math.max(MIN_BG_OFFSET, Math.min(MAX_BG_OFFSET, Math.round(v)));
}

export function clampParallaxLayerCount(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(MIN_PARALLAX_LAYERS, Math.min(MAX_PARALLAX_LAYERS, Math.round(v)));
  }
  return DEFAULT_PARALLAX_LAYERS;
}

export function parallaxLayerCountBounds(): { min: number; max: number; default: number } {
  return { min: MIN_PARALLAX_LAYERS, max: MAX_PARALLAX_LAYERS, default: DEFAULT_PARALLAX_LAYERS };
}

export function bgOffsetBounds(): { min: number; max: number; default: number } {
  return { min: MIN_BG_OFFSET, max: MAX_BG_OFFSET, default: DEFAULT_BG_OFFSET };
}

export function spriteVariantOptions(): readonly number[] {
  return [1, 2, 3, 4, 5];
}

export function updateSettings(patch: Partial<GameSettings>): GameSettings {
  const next: GameSettings = {
    moveDurationMs: clampMoveDurationMs(patch.moveDurationMs ?? current.moveDurationMs),
    resourceStyle: clampResourceStyle(patch.resourceStyle ?? current.resourceStyle),
    territoryBorderWidth: clampBorderWidth(patch.territoryBorderWidth ?? current.territoryBorderWidth),
    populationGrowthRate: clampGrowthRate(patch.populationGrowthRate ?? current.populationGrowthRate),
    upgradePopulationGate: clampUpgradeGate(patch.upgradePopulationGate ?? current.upgradePopulationGate),
    spriteVariant: clampSpriteVariant(patch.spriteVariant ?? current.spriteVariant),
    cityBgOffsetX: clampBgOffset(patch.cityBgOffsetX ?? current.cityBgOffsetX),
    cityBgOffsetY: clampBgOffset(patch.cityBgOffsetY ?? current.cityBgOffsetY),
    buildingUpgradeConfirm: typeof patch.buildingUpgradeConfirm === "boolean"
      ? patch.buildingUpgradeConfirm
      : current.buildingUpgradeConfirm,
    parallaxEnabled: typeof patch.parallaxEnabled === "boolean"
      ? patch.parallaxEnabled
      : current.parallaxEnabled,
    parallaxLayerCount: clampParallaxLayerCount(patch.parallaxLayerCount ?? current.parallaxLayerCount),
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
      resourceStyle: clampResourceStyle(parsed.resourceStyle),
      territoryBorderWidth: clampBorderWidth(parsed.territoryBorderWidth ?? DEFAULT_BORDER_WIDTH),
      populationGrowthRate: clampGrowthRate(parsed.populationGrowthRate ?? DEFAULT_GROWTH_RATE),
      upgradePopulationGate: clampUpgradeGate(parsed.upgradePopulationGate ?? DEFAULT_UPGRADE_GATE),
      spriteVariant: clampSpriteVariant(parsed.spriteVariant),
      cityBgOffsetX: clampBgOffset(parsed.cityBgOffsetX ?? DEFAULT_BG_OFFSET),
      cityBgOffsetY: clampBgOffset(parsed.cityBgOffsetY ?? DEFAULT_BG_OFFSET),
      buildingUpgradeConfirm: typeof parsed.buildingUpgradeConfirm === "boolean"
        ? parsed.buildingUpgradeConfirm
        : true,
      parallaxEnabled: typeof parsed.parallaxEnabled === "boolean"
        ? parsed.parallaxEnabled
        : false,
      parallaxLayerCount: clampParallaxLayerCount(parsed.parallaxLayerCount),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
