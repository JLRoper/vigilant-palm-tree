// Default-deps builder for the Canvas2D painter. The ONLY file in the painter
// project allowed to touch `assetDescriptors.ts` / `assets.ts` / `sprites.ts`
// (the Vite-`?url`-coupled modules) and to value-import `state/settings.ts`
// (the singleton with a cleanup lifecycle). Lives at `src/render/` (NOT
// inside `src/render/scene/paint2d/`) so the painter itself stays
// pure-importable from node:test.
//
// The painter's `Paint2DDep` interface (`paint2d/deps.ts`) exposes four
// per-kind sprite-resolver helpers (`resolveSpriteForResource/Hero/Building/
// Castle`) that wrap the `*Key` constructors from `assetDescriptors.ts`. The
// painter never names a key string in source; the constructor lookup happens
// here, at the builder boundary.
//
// See plan/2026-08-17-consolidated-phase-1-5-track-map.md §7.2 and
// src/render/scene/paint2d/README.md for the full boundary contract.

import {
  BATTLE_COMBATANT_ATTACKER,
  BATTLE_COMBATANT_ATTACKER_SELECTED,
  BATTLE_COMBATANT_DEFENDER,
  BATTLE_COMBATANT_DEFENDER_SELECTED,
  DEFAULT_CHARTER_CONSTRUCTING,
  DEFAULT_CHARTER_TRAVELING,
  VALID_CHARTER_HEX,
} from "./scene/paint2d/colors";
import type {
  CharterStyle,
  Paint2DDep,
  Paint2DSpriteResolver,
  ResolvedSprite,
  SkyboxProvider,
} from "./scene/paint2d/deps";
import type { BuildingKind, CastleLevel, CastleVariant, CharterPhase } from "@heroes/contracts";
import type { ResourceType } from "../map/resourceTiles";
import type { Faction, HeroDirection } from "../entities/hero";
import type { HorseVariant } from "../state/settings";
import { settings } from "../state/settings";
import {
  buildingKey,
  castleKey,
  heroDirectionKey,
  heroKey,
  horseVariantKey,
  resourceStyleKey,
  type SpriteKey,
} from "./assetDescriptors";
import { SpriteProvider } from "./assets";
import type { ResolvedSprite as LiveResolvedSprite } from "./assets";

// `createSkyboxProvider` is dynamically imported only when the caller does not
// supply a `skybox` option. This keeps `paint2dDefaults.ts` importable under
// node:test without dragging the four `?url` PNG imports (Node has no loader
// for `.png` / `?url` specifiers outside Vite).
async function loadCreateSkyboxProvider(): Promise<() => SkyboxProvider> {
  const mod = await import("./skybox");
  return mod.createSkyboxProvider;
}

export interface DefaultPaint2DDepOptions {
  readonly spriteProvider: SpriteProvider;
  readonly skybox?: SkyboxProvider | null;
  readonly colorForOwner: (ownerId: number | null) => string;
  readonly fontFamily?: string;
  readonly charterStyle?: (phase: CharterPhase) => CharterStyle;
  readonly validCharterStyle?: CharterStyle;
  readonly battleAccent?: (side: "attacker" | "defender", role: "ring" | "select") => string;
}

function defaultBattleAccent(side: "attacker" | "defender", role: "ring" | "select"): string {
  if (side === "attacker") {
    return role === "ring" ? BATTLE_COMBATANT_ATTACKER : BATTLE_COMBATANT_ATTACKER_SELECTED;
  }
  return role === "ring" ? BATTLE_COMBATANT_DEFENDER : BATTLE_COMBATANT_DEFENDER_SELECTED;
}

function defaultCharterStyle(phase: CharterPhase): CharterStyle {
  switch (phase) {
    case "traveling":
      return DEFAULT_CHARTER_TRAVELING;
    case "constructing":
      return DEFAULT_CHARTER_CONSTRUCTING;
    default: {
      const _exhaustive: never = phase;
      void _exhaustive;
      return DEFAULT_CHARTER_TRAVELING;
    }
  }
}

// SpriteDescriptor is structurally assignable to ResolvedSpriteDescriptor
// (same anchor/sizing/naturalSize/anchorOffsetY fields, SpriteKey widening to
// string), so the descriptor passes through untouched. It must: the painter's
// drawWithDescriptor() reads anchor and sizing on every sprite draw, and an
// earlier version of this function dropped both.
function narrowResolvedSprite(resolved: LiveResolvedSprite | undefined): ResolvedSprite | undefined {
  if (!resolved) return undefined;
  return {
    drawable: resolved.drawable,
    descriptor: resolved.descriptor,
    ready: resolved.ready,
  };
}

function buildSpriteResolver(provider: SpriteProvider): Paint2DSpriteResolver {
  return {
    resolveSpriteForResource(resource: ResourceType): ResolvedSprite | undefined {
      const key = resourceStyleKey(resource, settings().resourceStyle) as SpriteKey;
      return narrowResolvedSprite(provider.resolve(key));
    },
    resolveSpriteForHero(
      faction: Faction,
      direction: HeroDirection,
      variant: HorseVariant,
    ): ResolvedSprite | undefined {
      // Mirrors drawHeroSprite()/drawHorseSprite() in sprites.ts exactly: the
      // player hero has per-direction sprites, the enemy hero does not.
      const key =
        variant !== "hero"
          ? (horseVariantKey(variant, direction) as SpriteKey)
          : faction === "player"
            ? (heroDirectionKey("player", direction) as SpriteKey)
            : (heroKey(faction) as SpriteKey);
      return narrowResolvedSprite(provider.resolve(key));
    },
    resolveSpriteForBuilding(
      style: string,
      kind: BuildingKind,
      level: number,
    ): ResolvedSprite | undefined {
      const key = buildingKey(style, kind, level) as SpriteKey;
      return narrowResolvedSprite(provider.resolve(key));
    },
    resolveSpriteForCastle(
      level: CastleLevel,
      variant: CastleVariant,
    ): ResolvedSprite | undefined {
      const key = castleKey(level, variant) as SpriteKey;
      return narrowResolvedSprite(provider.resolve(key));
    },
    resolveSprite(key: SpriteKey): ResolvedSprite | undefined {
      return narrowResolvedSprite(provider.resolve(key));
    },
  };
}

/**
 * Build a `Paint2DDep` from the live `SpriteProvider` + a `SkyboxProvider`
 * (defaults to one created by `createSkyboxProvider()`) + the ambient
 * `settings()` singleton. The optional overrides let callers pin
 * `colorForOwner`, `fontFamily`, charter styles, and `battleAccent` without
 * fighting the painter's default palette.
 *
 * The defaults baked in here are byte-identical with the values used
 * in-module today — see `src/render/scene/paint2d/colors.ts` for the
 * provenance of each literal.
 *
 * Returns a `Promise` because the optional `skybox` default lazily loads
 * `createSkyboxProvider()` (which pulls in Vite `?url` PNG imports). Pass
 * `skybox: null` (or any explicit value) to skip the dynamic import.
 */
export async function createDefaultPaint2DDep(
  options: DefaultPaint2DDepOptions,
): Promise<Paint2DDep> {
  const skybox =
    options.skybox === undefined
      ? (await loadCreateSkyboxProvider())()
      : options.skybox;
  return createPaint2DDep({ ...options, skybox });
}

/**
 * Synchronous sibling of `createDefaultPaint2DDep` for callers that already
 * hold a `SkyboxProvider` (or don't need one, e.g. the adventure map). The
 * async variant exists only to lazily resolve the default skybox provider,
 * which drags in the four Vite `?url` PNG imports; supply `skybox` yourself
 * and there is nothing to await.
 *
 * Per-frame draw paths must build the dep once and reuse it -- the skybox
 * provider owns the image + layer-canvas caches, so a fresh dep per frame
 * would re-decode the skybox on every draw.
 */
export function createPaint2DDep(
  options: DefaultPaint2DDepOptions & { readonly skybox: SkyboxProvider | null },
): Paint2DDep {
  const sprite = buildSpriteResolver(options.spriteProvider);

  return {
    sprite,
    skybox: options.skybox,
    getResourceStyle: () => settings().resourceStyle,
    getSpriteVariant: () => settings().spriteVariant,
    getParallaxEnabled: () => settings().parallaxEnabled,
    getParallaxLayerCount: () => settings().parallaxLayerCount,
    getBgOffsetX: () => settings().cityBgOffsetX,
    getBgOffsetY: () => settings().cityBgOffsetY,
    getTerritoryBorderWidth: () => settings().territoryBorderWidth,
    colorForOwner: options.colorForOwner,
    battleAccent: options.battleAccent ?? defaultBattleAccent,
    fontFamily: options.fontFamily ?? "system-ui, sans-serif",
    charterStyle: options.charterStyle ?? defaultCharterStyle,
    validCharterStyle: options.validCharterStyle ?? VALID_CHARTER_HEX,
  };
}
