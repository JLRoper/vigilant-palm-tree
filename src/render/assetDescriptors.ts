import castleL1 from "../resources/castle-l1.png?url";
import castleL2 from "../resources/castle-l2.png?url";
import castleL3 from "../resources/castle-l3.png?url";
import resourceGold from "../resources/resource-gold.png?url";
import resourceWood from "../resources/resource-wood.png?url";
import resourceStone from "../resources/resource-stone.png?url";
import resourceIron from "../resources/resource-iron.png?url";
import resourceArcane from "../resources/resource-arcane.png?url";
import resourceGoldCart from "../resources/resource-gold-cart.png?url";
import resourceWoodCart from "../resources/resource-wood-cart.png?url";
import resourceStoneCart from "../resources/resource-stone-cart.png?url";
import resourceIronCart from "../resources/resource-iron-cart.png?url";
import resourceArcaneCart from "../resources/resource-arcane-cart.png?url";
import resourceGoldIllust from "../resources/resource-gold-illust.png?url";
import resourceWoodIllust from "../resources/resource-wood-illust.png?url";
import resourceStoneIllust from "../resources/resource-stone-illust.png?url";
import resourceIronIllust from "../resources/resource-iron-illust.png?url";
import resourceArcaneIllust from "../resources/resource-arcane-illust.png?url";
import resourceGoldConstellation from "../resources/resource-gold-constellation.png?url";
import resourceWoodConstellation from "../resources/resource-wood-constellation.png?url";
import resourceStoneConstellation from "../resources/resource-stone-constellation.png?url";
import resourceIronConstellation from "../resources/resource-iron-constellation.png?url";
import resourceArcaneConstellation from "../resources/resource-arcane-constellation.png?url";
import resourceGoldCrest from "../resources/resource-gold-crest.png?url";
import resourceWoodCrest from "../resources/resource-wood-crest.png?url";
import resourceStoneCrest from "../resources/resource-stone-crest.png?url";
import resourceIronCrest from "../resources/resource-iron-crest.png?url";
import resourceArcaneCrest from "../resources/resource-arcane-crest.png?url";
import resourceGoldPile from "../resources/resource-gold-pile.png?url";
import resourceWoodPile from "../resources/resource-wood-pile.png?url";
import resourceStonePile from "../resources/resource-stone-pile.png?url";
import resourceIronPile from "../resources/resource-iron-pile.png?url";
import resourceArcanePile from "../resources/resource-arcane-pile.png?url";
import resourceGoldPileSmol from "../resources/resource-gold-pile-smol.png?url";
import resourceWoodPileSmol from "../resources/resource-wood-pile-smol.png?url";
import resourceStonePileSmol from "../resources/resource-stone-pile-smol.png?url";
import resourceIronPileSmol from "../resources/resource-iron-pile-smol.png?url";
import resourceArcanePileSmol from "../resources/resource-arcane-pile-smol.png?url";
import resourceGoldPileBubbly from "../resources/resource-gold-pile-bubbly.png?url";
import resourceWoodPileBubbly from "../resources/resource-wood-pile-bubbly.png?url";
import resourceStonePileBubbly from "../resources/resource-stone-pile-bubbly.png?url";
import resourceIronPileBubbly from "../resources/resource-iron-pile-bubbly.png?url";
import resourceArcanePileBubbly from "../resources/resource-arcane-pile-bubbly.png?url";
import { Faction } from "../entities/hero";
import { CastleLevel } from "../entities/settlement";
import { ResourceType, RESOURCES } from "../map/resourceTiles";
import type { ResourceStyle } from "../state/settings";

export type SpriteKey =
  | `castle.${CastleLevel}`
  | `resource.${ResourceType}`
  | `resource-cart.${ResourceType}`
  | `resource-illust.${ResourceType}`
  | `resource-constellation.${ResourceType}`
  | `resource-crest.${ResourceType}`
  | `resource-pile.${ResourceType}`
  | `resource-pile-smol.${ResourceType}`
  | `resource-pile-bubbly.${ResourceType}`
  | `hero.${Faction}`
  | `building.${string}.${string}.${number}`;

export type Anchor = "bottom" | "center";

export type Sizing =
  | { kind: "abs"; size: number }
  | { kind: "fitHeight"; hexSizeMul: number }
  | { kind: "fitWidth"; hexSizeMul: number };

export interface SpriteDescriptor {
  key: SpriteKey;
  url: string | null;
  anchor: Anchor;
  sizing: Sizing;
  naturalSize?: number;
}

export const CASTLE_SPRITES: Record<CastleLevel, string> = {
  1: castleL1,
  2: castleL2,
  3: castleL3,
};

export const RESOURCE_SPRITES: Record<ResourceType, string> = {
  gold: resourceGold,
  wood: resourceWood,
  stone: resourceStone,
  iron: resourceIron,
  arcane: resourceArcane,
};

// Cartography-pin variant (parked direction per docs/art-style.md
// "Future directions"). Same silhouette across the set; differentiated
// by woodcut symbol + accent. Wired in alongside the locked rune-stone
// direction; no caller in the codebase uses `resource-cart.*` keys yet.
export const RESOURCE_CART_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldCart,
  wood: resourceWoodCart,
  stone: resourceStoneCart,
  iron: resourceIronCart,
  arcane: resourceArcaneCart,
};

// FLUX-illustrated variant of the cartography pin — generated via
// tools/sprites/flux-gen.mjs. Higher fidelity than the procedural set.
export const RESOURCE_ILLUST_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldIllust,
  wood: resourceWoodIllust,
  stone: resourceStoneIllust,
  iron: resourceIronIllust,
  arcane: resourceArcaneIllust,
};

// Constellation medallions (parked direction per docs/art-style.md).
export const RESOURCE_CONSTELLATION_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldConstellation,
  wood: resourceWoodConstellation,
  stone: resourceStoneConstellation,
  iron: resourceIronConstellation,
  arcane: resourceArcaneConstellation,
};

// Heraldic animal crests (parked direction per docs/art-style.md).
export const RESOURCE_CREST_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldCrest,
  wood: resourceWoodCrest,
  stone: resourceStoneCrest,
  iron: resourceIronCrest,
  arcane: resourceArcaneCrest,
};

// Isometric realistic resource piles — FLUX-generated, viewed from 3/4 angle.
export const RESOURCE_PILE_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldPile,
  wood: resourceWoodPile,
  stone: resourceStonePile,
  iron: resourceIronPile,
  arcane: resourceArcanePile,
};

// Smaller, no-outline variant of the isometric pile — renders at half the
// hex footprint so it reads as a tiny accent rather than the dominant mark.
export const RESOURCE_PILE_SMOL_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldPileSmol,
  wood: resourceWoodPileSmol,
  stone: resourceStonePileSmol,
  iron: resourceIronPileSmol,
  arcane: resourceArcanePileSmol,
};

// Gameified bubbly pixel-art version of the iso piles — simplified rounded
// cartoon shapes, still isometric 3/4 view, ~50% larger than smol (0.475 × 1.5 ≈ 0.71).
export const RESOURCE_PILE_BUBBLY_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldPileBubbly,
  wood: resourceWoodPileBubbly,
  stone: resourceStonePileBubbly,
  iron: resourceIronPileBubbly,
  arcane: resourceArcanePileBubbly,
};

export const CASTLE_DESCRIPTORS: Record<`castle.${CastleLevel}`, SpriteDescriptor> = {
  "castle.1": {
    key: "castle.1",
    url: CASTLE_SPRITES[1],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 1.5 },
  },
  "castle.2": {
    key: "castle.2",
    url: CASTLE_SPRITES[2],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 2.2 },
  },
  "castle.3": {
    key: "castle.3",
    url: CASTLE_SPRITES[3],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 3.0 },
  },
};

export const RESOURCE_DESCRIPTORS: Record<`resource.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource.${r}`,
      {
        key: `resource.${r}`,
        url: RESOURCE_SPRITES[r],
        anchor: "center",
        sizing: { kind: "fitWidth", hexSizeMul: 0.9 },
      } as SpriteDescriptor,
    ])
  ) as Record<`resource.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_CART_DESCRIPTORS: Record<`resource-cart.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-cart.${r}`,
      {
        key: `resource-cart.${r}`,
        url: RESOURCE_CART_SPRITES[r],
        anchor: "center",
        sizing: { kind: "fitWidth", hexSizeMul: 0.9 },
      } as SpriteDescriptor,
    ])
  ) as Record<`resource-cart.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_ILLUST_DESCRIPTORS: Record<`resource-illust.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-illust.${r}`,
      {
        key: `resource-illust.${r}`,
        url: RESOURCE_ILLUST_SPRITES[r],
        anchor: "center",
        sizing: { kind: "fitWidth", hexSizeMul: 0.9 },
      } as SpriteDescriptor,
    ])
  ) as Record<`resource-illust.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_CONSTELLATION_DESCRIPTORS: Record<`resource-constellation.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-constellation.${r}`,
      {
        key: `resource-constellation.${r}`,
        url: RESOURCE_CONSTELLATION_SPRITES[r],
        anchor: "center",
        sizing: { kind: "fitWidth", hexSizeMul: 0.9 },
      } as SpriteDescriptor,
    ])
  ) as Record<`resource-constellation.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_CREST_DESCRIPTORS: Record<`resource-crest.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-crest.${r}`,
      {
        key: `resource-crest.${r}`,
        url: RESOURCE_CREST_SPRITES[r],
        anchor: "center",
        sizing: { kind: "fitWidth", hexSizeMul: 0.9 },
      } as SpriteDescriptor,
    ])
  ) as Record<`resource-crest.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_PILE_DESCRIPTORS: Record<`resource-pile.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-pile.${r}`,
      {
        key: `resource-pile.${r}`,
        url: RESOURCE_PILE_SPRITES[r],
        anchor: "center",
        sizing: { kind: "fitWidth", hexSizeMul: 0.95 },
      } as SpriteDescriptor,
    ])
  ) as Record<`resource-pile.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_PILE_SMOL_DESCRIPTORS: Record<`resource-pile-smol.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-pile-smol.${r}`,
      {
        key: `resource-pile-smol.${r}`,
        url: RESOURCE_PILE_SMOL_SPRITES[r],
        anchor: "center",
        sizing: { kind: "fitWidth", hexSizeMul: 0.475 }, // half of the 0.95 outline variant
      } as SpriteDescriptor,
    ])
  ) as Record<`resource-pile-smol.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_PILE_BUBBLY_DESCRIPTORS: Record<`resource-pile-bubbly.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-pile-bubbly.${r}`,
      {
        key: `resource-pile-bubbly.${r}`,
        url: RESOURCE_PILE_BUBBLY_SPRITES[r],
        anchor: "center",
        sizing: { kind: "fitWidth", hexSizeMul: 0.71 }, // 50% bigger than smol (0.475 × 1.5)
      } as SpriteDescriptor,
    ])
  ) as Record<`resource-pile-bubbly.${ResourceType}`, SpriteDescriptor>;

export const HERO_DESCRIPTORS: Record<`hero.${Faction}`, SpriteDescriptor> = {
  "hero.player": {
    key: "hero.player",
    url: null,
    anchor: "center",
    sizing: { kind: "abs", size: 18 },
    naturalSize: 18,
  },
  "hero.enemy": {
    key: "hero.enemy",
    url: null,
    anchor: "center",
    sizing: { kind: "abs", size: 18 },
    naturalSize: 18,
  },
};

export const ALL_DESCRIPTORS: readonly SpriteDescriptor[] = [
  ...Object.values(CASTLE_DESCRIPTORS),
  ...Object.values(RESOURCE_DESCRIPTORS),
  ...Object.values(RESOURCE_CART_DESCRIPTORS),
  ...Object.values(RESOURCE_ILLUST_DESCRIPTORS),
  ...Object.values(RESOURCE_CONSTELLATION_DESCRIPTORS),
  ...Object.values(RESOURCE_CREST_DESCRIPTORS),
  ...Object.values(RESOURCE_PILE_DESCRIPTORS),
  ...Object.values(RESOURCE_PILE_SMOL_DESCRIPTORS),
  ...Object.values(RESOURCE_PILE_BUBBLY_DESCRIPTORS),
  ...Object.values(HERO_DESCRIPTORS),
];

export function castleKey(level: CastleLevel): `castle.${CastleLevel}` {
  return `castle.${level}`;
}

export function resourceKey(type: ResourceType): `resource.${ResourceType}` {
  return `resource.${type}`;
}

export function resourceCartKey(type: ResourceType): `resource-cart.${ResourceType}` {
  return `resource-cart.${type}`;
}

export function resourceStyleKey(
  type: ResourceType,
  style: ResourceStyle,
): SpriteKey {
  switch (style) {
    case "cartography-pin":  return `resource-cart.${type}`;
    case "illustrated-pin":  return `resource-illust.${type}`;
    case "constellation":    return `resource-constellation.${type}`;
    case "heraldic-crest":   return `resource-crest.${type}`;
    case "isometric-pile":   return `resource-pile.${type}`;
    case "iso-pile-smol":    return `resource-pile-smol.${type}`;
    case "iso-bubbly":       return `resource-pile-bubbly.${type}`;
    case "rune-stone":
    default:                 return `resource.${type}`;
  }
}

export function heroKey(faction: Faction): `hero.${Faction}` {
  return `hero.${faction}`;
}

export function buildingKey(
  style: string,
  kind: string,
  level: number,
): SpriteKey {
  return `building.${style}.${kind}.${level}`;
}
