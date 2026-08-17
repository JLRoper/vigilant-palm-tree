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
import type { BuildingKind, CastleLevel, CastleVariant, CharterPhase, GenerationStyle } from "@heroes/contracts";
import type { BattleSide } from "@heroes/engine";
import type { Faction, HeroDirection } from "../../../entities/hero";
import type { HorseVariant, ResourceStyle } from "../../../state/settings";

// String-branded alias for the upstream SpriteKey template-literal type
// (declared in src/render/assetDescriptors.ts). We can't import the upstream
// type directly because that file is Vite-?url-coupled, and a string is
// structurally compatible for the painter's needs (the four per-kind helpers
// below wrap the *Key constructors, which *do* come from assetDescriptors.ts
// via the default-deps builder). The lint seam is real: the painter never
// names a key string in source.
export type SpriteKey = string;

export interface ResolvedSprite {
  drawable: HTMLImageElement | HTMLCanvasElement;
  descriptor: { key: string; url: string | null; naturalSize?: number };
  ready: boolean;
}

// Sprite / image resolution. The painter never names a key string directly
// (that's the Vite pitfall we're buying seam against). Instead the four
// per-kind helpers below wrap the *Key constructors from assetDescriptors.ts,
// with the constructors living in src/render/paint2dDefaults.ts.
export interface Paint2DSpriteResolver {
  resolveSpriteForResource(resource: ResourceType): ResolvedSprite | undefined;
  resolveSpriteForHero(faction: Faction, dir: HeroDirection, variant: HorseVariant): ResolvedSprite | undefined;
  resolveSpriteForBuilding(style: GenerationStyle, kind: BuildingKind, level: number): ResolvedSprite | undefined;
  resolveSpriteForCastle(level: CastleLevel, variant: CastleVariant): ResolvedSprite | undefined;
  // Escape hatch for tests/fixtures that already have a key in hand. Production
  // painters should prefer the four per-kind helpers above.
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

  // Font family used for city labels. Rendered as `ctx.font` strings. Hard-coded
  // to "system-ui, sans-serif" in the live code; injected so a future test can
  // pass a fixed name without fighting JSDOM font defaults.
  readonly fontFamily: string;

  readonly charterStyle: (phase: CharterPhase) => CharterStyle;
  readonly validCharterStyle: CharterStyle;
}
