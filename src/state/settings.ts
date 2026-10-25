import { HORSE_VARIANT_REGISTRY, type HorseVariantId, VALID_HORSE_VARIANTS } from "@heroes/engine";
import { DEFAULT_GAME_MODE, resolveGameMode, type GameMode } from "@heroes/contracts";
import { clampToolbarStyle, DEFAULT_TOOLBAR_STYLE, type ToolbarStyle } from "./toolbarThemes";

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

export type CityBackdropMode = "diorama" | "skybox";

export interface GameSettings {
  moveDurationMs: number;
  enemyMoveDurationMs: number;
  // Manual battle arena: per-hex walk-animation pace for BOTH sides' platoons
  // (the AI's beats and the player's own glide share one dial). 0 = instant.
  arenaMoveMsPerHex: number;
  resourceStyle: ResourceStyle;
  territoryBorderWidth: number;
  populationGrowthRate: number;
  spriteVariant: number;
  cityBackdrop: CityBackdropMode;
  cityGridLines: boolean;
  cityBgOffsetX: number;
  cityBgOffsetY: number;
  buildingUpgradeConfirm: boolean;
  parallaxEnabled: boolean;
  parallaxLayerCount: number;
  // Log Message Panel (plan/2026-09-28-sse-event-push.md, use case 1):
  // reveal + fill the game-log panel with every streamed game_events row.
  showLogPanel: boolean;
  toolbarStyle: ToolbarStyle;
  maxZoomOutHexesWide: number;
  // New-game default mode (SETTLERS-PLAN.md §1/§4 W4): what the New Game form
  // pre-selects. A stored preference, NOT the mode of any existing game --
  // a game's own mode is stored per game (games.lobby.gameMode) and this key
  // never changes it.
  gameMode: GameMode;
}

const STORAGE_KEY = "heroesJs.settings";
const MIN_MOVE_MS = 40;
const MAX_MOVE_MS = 1000;
const DEFAULT_MOVE_MS = 220;
const MIN_ENEMY_MOVE_MS = 40;
const MAX_ENEMY_MOVE_MS = 1000;
const DEFAULT_ENEMY_MOVE_MS = 220;
const MIN_ARENA_MOVE_MS_PER_HEX = 0;
const MAX_ARENA_MOVE_MS_PER_HEX = 500;
// Matches the arena AI's historical 90 ms/hex walk pace, so the default
// behavior is byte-identical to before the setting existed.
const DEFAULT_ARENA_MOVE_MS_PER_HEX = 90;
const MIN_BORDER_WIDTH = 1.5;
const MAX_BORDER_WIDTH = 6;
const DEFAULT_BORDER_WIDTH = 1.5;

const RESOURCE_STYLES: readonly ResourceStyle[] = [
  "rune-stone", "cartography-pin", "illustrated-pin", "constellation",
  "heraldic-crest", "isometric-pile", "iso-pile-smol", "iso-bubbly",
];
export const DEFAULT_RESOURCE_STYLE: ResourceStyle = "isometric-pile";

const MIN_SPRITE_VARIANT = 1;
const MAX_SPRITE_VARIANT = 5;
const DEFAULT_SPRITE_VARIANT = 1;

export const DEFAULT_CITY_BACKDROP: CityBackdropMode = "diorama";

const MIN_GROWTH_RATE = 0.01;
const MAX_GROWTH_RATE = 0.50;
const DEFAULT_GROWTH_RATE = 0.10;
const MIN_BG_OFFSET = -500;
const MAX_BG_OFFSET = 500;
const DEFAULT_BG_OFFSET = 0;

const MIN_PARALLAX_LAYERS = 2;
const MAX_PARALLAX_LAYERS = 4;
const DEFAULT_PARALLAX_LAYERS = 4;

const MIN_MAX_ZOOM_OUT_HEXES_WIDE = 20;
const MAX_MAX_ZOOM_OUT_HEXES_WIDE = 34;
const DEFAULT_MAX_ZOOM_OUT_HEXES_WIDE = 20;

export const PARALLAX_SPEEDS: Record<number, number[]> = {
  2: [0.10, 1.00],
  3: [0.10, 0.40, 1.00],
  4: [0.10, 0.30, 0.60, 1.00],
};

export { VALID_HORSE_VARIANTS, HORSE_VARIANT_REGISTRY };

export const DEFAULT_SETTINGS: GameSettings = {
  moveDurationMs: DEFAULT_MOVE_MS,
  enemyMoveDurationMs: DEFAULT_ENEMY_MOVE_MS,
  arenaMoveMsPerHex: DEFAULT_ARENA_MOVE_MS_PER_HEX,
  resourceStyle: DEFAULT_RESOURCE_STYLE,
  territoryBorderWidth: DEFAULT_BORDER_WIDTH,
  populationGrowthRate: DEFAULT_GROWTH_RATE,
  spriteVariant: DEFAULT_SPRITE_VARIANT,
  cityBackdrop: DEFAULT_CITY_BACKDROP,
  cityGridLines: true,
  cityBgOffsetX: DEFAULT_BG_OFFSET,
  cityBgOffsetY: DEFAULT_BG_OFFSET,
  buildingUpgradeConfirm: true,
  parallaxEnabled: false,
  parallaxLayerCount: DEFAULT_PARALLAX_LAYERS,
  showLogPanel: false,
  toolbarStyle: DEFAULT_TOOLBAR_STYLE,
  maxZoomOutHexesWide: DEFAULT_MAX_ZOOM_OUT_HEXES_WIDE,
  gameMode: DEFAULT_GAME_MODE,
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

export function clampEnemyMoveDurationMs(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_ENEMY_MOVE_MS;
  return Math.max(MIN_ENEMY_MOVE_MS, Math.min(MAX_ENEMY_MOVE_MS, Math.round(ms)));
}

export function clampArenaMoveMsPerHex(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_ARENA_MOVE_MS_PER_HEX;
  return Math.max(MIN_ARENA_MOVE_MS_PER_HEX, Math.min(MAX_ARENA_MOVE_MS_PER_HEX, Math.round(ms)));
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

export function clampSpriteVariant(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(MIN_SPRITE_VARIANT, Math.min(MAX_SPRITE_VARIANT, Math.round(v)));
  }
  return DEFAULT_SPRITE_VARIANT;
}

export function clampCityBackdrop(v: unknown): CityBackdropMode {
  return v === "skybox" ? "skybox" : "diorama";
}

// The one normalizer for the stored mode key. Delegates to the contracts
// vocabulary (isGameMode/resolveGameMode) so the store, the wire and the
// engine share ONE list of modes -- an unknown value reads as the default
// instead of silently persisting a typo'd mode the server would reject.
export function clampGameMode(v: unknown): GameMode {
  return resolveGameMode(typeof v === "string" ? v : null);
}

export function gameModeOptions(): readonly { value: GameMode; label: string }[] {
  return [
    { value: "classic", label: "Classic (charter founding)" },
    { value: "settlers", label: "Settlers (wagon founding)" },
  ];
}

/**
 * The one-line explanation of a mode, used as a chip's tooltip on both
 * new-game surfaces (the panel own its prose; verbs live in `title`, not in
 * the form). Keyed by the mode union so a new mode is a compile error here
 * rather than a silently missing hint.
 */
const GAME_MODE_HINTS: Record<GameMode, string> = {
  classic: "Start with a castle, a commander and a town; expand by chartering new settlements",
  settlers: "Start with one covered wagon in the wilderness; plant your settlement where it stands, once per wagon",
};

export function gameModeHint(mode: GameMode): string {
  return GAME_MODE_HINTS[resolveGameMode(mode)];
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

export function clampMaxZoomOutHexesWide(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(
      MIN_MAX_ZOOM_OUT_HEXES_WIDE,
      Math.min(MAX_MAX_ZOOM_OUT_HEXES_WIDE, Math.round(v)),
    );
  }
  return DEFAULT_MAX_ZOOM_OUT_HEXES_WIDE;
}

export function maxZoomOutHexesWideBounds(): { min: number; max: number; default: number } {
  return {
    min: MIN_MAX_ZOOM_OUT_HEXES_WIDE,
    max: MAX_MAX_ZOOM_OUT_HEXES_WIDE,
    default: DEFAULT_MAX_ZOOM_OUT_HEXES_WIDE,
  };
}

export function bgOffsetBounds(): { min: number; max: number; default: number } {
  return { min: MIN_BG_OFFSET, max: MAX_BG_OFFSET, default: DEFAULT_BG_OFFSET };
}

export function spriteVariantOptions(): readonly number[] {
  return [1, 2, 3, 4, 5];
}

export function cityBackdropOptions(): readonly { value: CityBackdropMode; label: string }[] {
  return [
    { value: "diorama", label: "Settlement diorama (biome)" },
    { value: "skybox", label: "Watercolor skybox (static variants)" },
  ];
}

export function updateSettings(patch: Partial<GameSettings>): GameSettings {
  const next: GameSettings = {
    moveDurationMs: clampMoveDurationMs(patch.moveDurationMs ?? current.moveDurationMs),
    enemyMoveDurationMs: clampEnemyMoveDurationMs(patch.enemyMoveDurationMs ?? current.enemyMoveDurationMs),
    arenaMoveMsPerHex: clampArenaMoveMsPerHex(patch.arenaMoveMsPerHex ?? current.arenaMoveMsPerHex),
    resourceStyle: clampResourceStyle(patch.resourceStyle ?? current.resourceStyle),
    territoryBorderWidth: clampBorderWidth(patch.territoryBorderWidth ?? current.territoryBorderWidth),
    populationGrowthRate: clampGrowthRate(patch.populationGrowthRate ?? current.populationGrowthRate),
    spriteVariant: clampSpriteVariant(patch.spriteVariant ?? current.spriteVariant),
    cityBackdrop: clampCityBackdrop(patch.cityBackdrop ?? current.cityBackdrop),
    cityGridLines: typeof patch.cityGridLines === "boolean" ? patch.cityGridLines : current.cityGridLines,
    cityBgOffsetX: clampBgOffset(patch.cityBgOffsetX ?? current.cityBgOffsetX),
    cityBgOffsetY: clampBgOffset(patch.cityBgOffsetY ?? current.cityBgOffsetY),
    buildingUpgradeConfirm: typeof patch.buildingUpgradeConfirm === "boolean"
      ? patch.buildingUpgradeConfirm
      : current.buildingUpgradeConfirm,
    parallaxEnabled: typeof patch.parallaxEnabled === "boolean"
      ? patch.parallaxEnabled
      : current.parallaxEnabled,
    parallaxLayerCount: clampParallaxLayerCount(patch.parallaxLayerCount ?? current.parallaxLayerCount),
    showLogPanel: typeof patch.showLogPanel === "boolean"
      ? patch.showLogPanel
      : current.showLogPanel,
    toolbarStyle: clampToolbarStyle(patch.toolbarStyle ?? current.toolbarStyle),
    maxZoomOutHexesWide: clampMaxZoomOutHexesWide(patch.maxZoomOutHexesWide ?? current.maxZoomOutHexesWide),
    gameMode: clampGameMode(patch.gameMode ?? current.gameMode),
  };
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, schemaVersion: SETTINGS_SCHEMA_VERSION }));
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

export function enemyMoveDurationBounds(): { min: number; max: number; default: number } {
  return { min: MIN_ENEMY_MOVE_MS, max: MAX_ENEMY_MOVE_MS, default: DEFAULT_ENEMY_MOVE_MS };
}

export function arenaMoveMsPerHexBounds(): { min: number; max: number; default: number } {
  return { min: MIN_ARENA_MOVE_MS_PER_HEX, max: MAX_ARENA_MOVE_MS_PER_HEX, default: DEFAULT_ARENA_MOVE_MS_PER_HEX };
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

/**
 * Bumped when a stored setting's meaning changes. v2 moved the default map
 * resource sprite from the rune stone to the iso pile, so a store written by v1
 * still holds the old default (not a deliberate choice) and follows along once.
 *
 * v3 added the new-game default mode key (gameMode). A store written before it
 * existed has no deliberate choice in it, so it follows along to the classic
 * default ONCE, at load -- and only once: from v3 on, whatever the store holds
 * (including a player's own pick of "settlers") is read back verbatim, so the
 * migration can never overwrite a choice a later session made.
 */
const SETTINGS_SCHEMA_VERSION = 3;

/**
 * A stored blob -> a GameSettings, with the schema migrations applied exactly
 * once (the version gate below). Pure and exported so the migrations are
 * testable: the store's `current` is initialized at import time, so a test
 * cannot re-run loadFromStorage without re-importing the module.
 */
export function readStoredSettings(raw: string | null): GameSettings {
  try {
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings> & { schemaVersion?: number };
    const schemaVersion = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1;
    const storedStyle = clampResourceStyle(parsed.resourceStyle);
    const resourceStyle =
      schemaVersion < 2 && storedStyle === "rune-stone" ? DEFAULT_RESOURCE_STYLE : storedStyle;
    // v3's one-time follow-along: a store written before the mode key existed
    // gets the default mode once. From v3 on the stored value wins, so a
    // player's own pick is never overwritten by this migration.
    const gameMode = schemaVersion < 3 ? DEFAULT_GAME_MODE : clampGameMode(parsed.gameMode);
    return {
      moveDurationMs: clampMoveDurationMs(parsed.moveDurationMs ?? DEFAULT_MOVE_MS),
      enemyMoveDurationMs: clampEnemyMoveDurationMs(parsed.enemyMoveDurationMs ?? DEFAULT_ENEMY_MOVE_MS),
      arenaMoveMsPerHex: clampArenaMoveMsPerHex(parsed.arenaMoveMsPerHex ?? DEFAULT_ARENA_MOVE_MS_PER_HEX),
      resourceStyle,
      territoryBorderWidth: clampBorderWidth(parsed.territoryBorderWidth ?? DEFAULT_BORDER_WIDTH),
      populationGrowthRate: clampGrowthRate(parsed.populationGrowthRate ?? DEFAULT_GROWTH_RATE),
      spriteVariant: clampSpriteVariant(parsed.spriteVariant),
      cityBackdrop: clampCityBackdrop(parsed.cityBackdrop),
      cityGridLines: typeof parsed.cityGridLines === "boolean" ? parsed.cityGridLines : true,
      cityBgOffsetX: clampBgOffset(parsed.cityBgOffsetX ?? DEFAULT_BG_OFFSET),
      cityBgOffsetY: clampBgOffset(parsed.cityBgOffsetY ?? DEFAULT_BG_OFFSET),
      buildingUpgradeConfirm: typeof parsed.buildingUpgradeConfirm === "boolean"
        ? parsed.buildingUpgradeConfirm
        : true,
      parallaxEnabled: typeof parsed.parallaxEnabled === "boolean"
        ? parsed.parallaxEnabled
        : false,
      parallaxLayerCount: clampParallaxLayerCount(parsed.parallaxLayerCount),
      showLogPanel: typeof parsed.showLogPanel === "boolean"
        ? parsed.showLogPanel
        : false,
      toolbarStyle: clampToolbarStyle(parsed.toolbarStyle),
      maxZoomOutHexesWide: clampMaxZoomOutHexesWide(parsed.maxZoomOutHexesWide),
      gameMode,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function loadFromStorage(): GameSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    return readStoredSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
