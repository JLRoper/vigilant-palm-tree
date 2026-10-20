// Dependency types for the Canvas2D painter. The painter module
// (src/render/scene/paint2d/) deliberately never imports assetDescriptors.ts,
// assets.ts, sprites.ts, cityRenderer.ts, cityBuildingDraw.ts (barrel), or the
// state/settings.ts singleton value -- all of those are Vite-?url-coupled or
// have a cleanup lifecycle the painter shouldn't drive. The default-deps
// builder at src/render/paint2dDefaults.ts and the skybox module at
// src/render/skybox.ts are the only files in the painter project that touch
// those modules; they live outside paint2d/.
//
// This is the same general pitfall plan/2026-08-17-consolidated-phase-1-5-track-map.md
// revision note 4 (and §7.2's "Notable side-fix") calls out: anything that
// transitively imports assetDescriptors.ts / cityRenderer.ts / the
// cityBuildingDraw.ts barrel crashes under plain node:test because Node has no
// loader for .png / ?url specifiers outside Vite's bundler. The dependency-cruiser
// rule paint2d-cannot-import-asset-descriptors enforces this at lint time.

import type { ResourceType } from "../../../map/resourceTiles";
import type { BuildingKind, CastleLevel, CastleVariant, CharterPhase } from "@heroes/contracts";
import type { BattleSide } from "@heroes/engine";
import type { Faction, HeroDirection } from "../../../entities/hero";
import type { HorseVariant, ResourceStyle } from "../../../state/settings";
import type { Terrain } from "../../../map/terrain";

// String-branded alias for the upstream SpriteKey template-literal type
// (declared in src/render/assetDescriptors.ts). We can't import the upstream
// type directly because that file is Vite-?url-coupled, and a string is
// structurally compatible for the painter's needs (the four per-kind helpers
// below wrap the *Key constructors, which *do* come from assetDescriptors.ts
// via the default-deps builder). The lint seam is real: the painter never
// names a key string in source.
export type SpriteKey = string;

// Biome background provider for battle arena. A function that draws a single
// biome-styled hex at the given center point with the given radius.
// The seed and variant allow for per-hex variation within the same biome.
export type BiomeBackgroundProvider = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  variant: number
) => void;

// Structural mirror of assetDescriptors.ts's SpriteDescriptor. Mirrored
// rather than imported for the same ?url reason as SpriteKey above; the
// default-deps builder passes the live descriptor's fields straight through,
// so anchor/sizing must be part of the shape -- drawWithDescriptor() in
// index.ts reads them on every sprite draw.
export type ResolvedSpriteAnchor = "bottom" | "center";

export type ResolvedSpriteSizing =
  | { kind: "abs"; size: number }
  | { kind: "fitHeight"; hexSizeMul: number }
  | { kind: "fitWidth"; hexSizeMul: number };

export interface ResolvedSpriteDescriptor {
  key: string;
  url: string | null;
  anchor: ResolvedSpriteAnchor;
  sizing: ResolvedSpriteSizing;
  naturalSize?: number;
  anchorOffsetY?: number;
}

export interface ResolvedSprite {
  drawable: HTMLImageElement | HTMLCanvasElement;
  descriptor: ResolvedSpriteDescriptor;
  ready: boolean;
}

// Sprite / image resolution. The painter never names a key string directly
// (that's the Vite pitfall we're buying seam against). Instead the five
// per-kind helpers below wrap the *Key constructors from assetDescriptors.ts,
// with the constructors living in src/render/paint2dDefaults.ts.
//
// resolveSpriteForHero's optional `frame` is the run-cycle pose (0|1) derived
// by the scene builder; 1 asks for the variant's optional frame-2 sprite, and
// the deps builder falls back to the base sprite when it doesn't exist.
//
// resolveSpriteForUnit is the battle-arena unit art (plan/
// 2026-09-29-arena-unit-sprites.md): `unit.<unitTypeId>.<pose>` over the
// registry-driven UNIT_ARENA_DESCRIPTORS. `unitTypeId` is a catalog id string
// (the painter never names one; the scene builder derives it from the
// combatant's dominant platoon entry). Resolvers return undefined for
// missing/not-yet-loaded art so painters keep their fallback rendering.
export type UnitArenaPose = "idle" | "attack" | "move";

export interface Paint2DSpriteResolver {
  resolveSpriteForResource(resource: ResourceType): ResolvedSprite | undefined;
  resolveSpriteForHero(faction: Faction, dir: HeroDirection, variant: HorseVariant, frame?: 0 | 1): ResolvedSprite | undefined;
  resolveSpriteForBuilding(kind: BuildingKind, level: number): ResolvedSprite | undefined;
  resolveSpriteForCastle(level: CastleLevel, variant: CastleVariant, fullness?: 1 | 2 | 3 | 4 | 5): ResolvedSprite | undefined;
  resolveSpriteForUnit(unitTypeId: string, pose: UnitArenaPose): ResolvedSprite | undefined;
  resolveSpriteForCaravan?(payloadKind?: "resource" | "gold", direction?: HeroDirection): ResolvedSprite | undefined;
  resolveSpriteForDistrict?(variant: "standard" | "farm", tier: 1 | 2 | 3): ResolvedSprite | undefined;
  /** River overlay tiles (map-gen v5): the water band for a given size and mask shape, rotated at draw time. Optional so test fixtures keep compiling; the painter falls back to a procedural band. */
  resolveRiverSprite?(size: "small" | "wide", mask: "end" | "straight" | "curveC" | "curveCC" | "curve120C" | "curve120CC" | "bridge"): ResolvedSprite | undefined;
  /** City-view worker person: the peasant idle unit sprite, loaded on demand from the main provider (not the arena-only one). Optional so test fixtures without the wiring keep compiling; painters fall back to resolveSpriteForUnit. */
  resolveSpriteForCityPerson?(): ResolvedSprite | undefined;
  // Escape hatch for tests/fixtures that already have a key in hand. Production
  // painters should prefer the five per-kind helpers above.
  resolveSprite(key: SpriteKey): ResolvedSprite | undefined;
}

export interface SkyboxProvider {
  ensureLoaded(variant: number): void;
  getImage(variant: number): HTMLImageElement | null;
  getLayers(variant: number, layerCount: number): HTMLCanvasElement[] | null;
}

// Charter style constants. Today these are hard-coded inside src/render/renderer.ts
// (charter rgba strings + validCharter hex rgba). Injected so a future theme can
// override without touching paint2d/.
export interface CharterStyle {
  stroke: string;
  fill: string;
  lineDash: number[];
  lineWidth: number;
}

export interface Paint2DDep {
  readonly sprite: Paint2DSpriteResolver;
  readonly skybox: SkyboxProvider | null;

  // Decision-time getters. The painter never reads settings() directly, because
  // settings is a singleton with a subscribe cleanup lifecycle and paint2d/
  // shouldn't hold a reference to it.
  readonly getResourceStyle: () => ResourceStyle;
  readonly getSpriteVariant: () => number;
  readonly getParallaxEnabled: () => boolean;
  readonly getParallaxLayerCount: () => number;
  readonly getBgOffsetX: () => number;
  readonly getBgOffsetY: () => number;
  readonly getTerritoryBorderWidth: () => number;

  // Color function for territory/battle accents. Passed in rather than reached
  // for from a singleton.
  readonly colorForOwner: (ownerId: number | null) => string;

  // Battle side accent colors. manualBattleArena.ts's draw() doesn't currently
  // read side accents (revision note 5) -- the seam is exposed for a future
  // battle redesign that might.
  readonly battleAccent: (side: BattleSide, role: "ring" | "select") => string;

  // Biome background provider for battle arena. Returns a canvas pattern or
  // drawing function for the given biome. Optional -- if absent, falls back
  // to the legacy flat background.
  readonly getBiomeBackground?: (biome: Terrain) => BiomeBackgroundProvider | null;

  // Font family used for city labels. Rendered as `ctx.font` strings. Hard-coded
  // to "system-ui, sans-serif" in the live code; injected so a future test can
  // pass a fixed name without fighting JSDOM font defaults.
  readonly fontFamily: string;

  readonly charterStyle: (phase: CharterPhase) => CharterStyle;
  readonly validCharterStyle: CharterStyle;
}