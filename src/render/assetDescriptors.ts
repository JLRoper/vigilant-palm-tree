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
import { Faction, Direction } from "../entities/hero";
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
  | `hero.player.${Direction}`
  | `horse.${string}.${Direction}`
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
  anchorOffsetY?: number;
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

export const RESOURCE_CART_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldCart,
  wood: resourceWoodCart,
  stone: resourceStoneCart,
  iron: resourceIronCart,
  arcane: resourceArcaneCart,
};

export const RESOURCE_ILLUST_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldIllust,
  wood: resourceWoodIllust,
  stone: resourceStoneIllust,
  iron: resourceIronIllust,
  arcane: resourceArcaneIllust,
};

export const RESOURCE_CONSTELLATION_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldConstellation,
  wood: resourceWoodConstellation,
  stone: resourceStoneConstellation,
  iron: resourceIronConstellation,
  arcane: resourceArcaneConstellation,
};

export const RESOURCE_CREST_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldCrest,
  wood: resourceWoodCrest,
  stone: resourceStoneCrest,
  iron: resourceIronCrest,
  arcane: resourceArcaneCrest,
};

export const RESOURCE_PILE_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldPile,
  wood: resourceWoodPile,
  stone: resourceStonePile,
  iron: resourceIronPile,
  arcane: resourceArcanePile,
};

export const RESOURCE_PILE_SMOL_SPRITES: Record<ResourceType, string> = {
  gold: resourceGoldPileSmol,
  wood: resourceWoodPileSmol,
  stone: resourceStonePileSmol,
  iron: resourceIronPileSmol,
  arcane: resourceArcanePileSmol,
};

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
    anchorOffsetY: 8,
  },
  "castle.3": {
    key: "castle.3",
    url: CASTLE_SPRITES[3],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 3.0 },
    anchorOffsetY: 16,
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

// Generic helper to load directional sprites from a glob
function loadDirectionalSprites(
  glob: Record<string, { default: string }>,
  pattern: RegExp,
  fallbacks: Partial<Record<Direction, Direction>> = {}
): Record<Direction, string | null> {
  const images: Record<Direction, string | null> = {
    n: null, ne: null, e: null, se: null, s: null, sw: null, w: null, nw: null,
  };

  for (const [key, mod] of Object.entries(glob)) {
    const match = key.match(pattern);
    if (match && mod.default) {
      const dir = match[1] as Direction;
      if (dir in images) {
        images[dir] = mod.default;
      }
    }
  }

  for (const [missing, fallback] of Object.entries(fallbacks)) {
    if (!images[missing as Direction] && images[fallback]) {
      images[missing as Direction] = images[fallback]!;
    }
  }

  return images;
}

function createDirectionalDescriptors(
  prefix: string,
  images: Record<Direction, string | null>,
  anchor: Anchor = "bottom",
  sizing: Sizing = { kind: "fitHeight", hexSizeMul: 1.0 },
  naturalSize?: number
): Record<string, SpriteDescriptor> {
  const descriptors: Record<string, SpriteDescriptor> = {};

  for (const [dir, url] of Object.entries(images)) {
    if (!url) continue;
    const key = `${prefix}.${dir}` as SpriteKey;
    descriptors[key] = { key, url, anchor, sizing, naturalSize };
  }
  return descriptors;
}

// Load hero player sprites from horse/commander-1/ directory
const HERO_PLAYER_GLOB = import.meta.glob(
  "../resources/units/horse/commander-1/*.png",
  { eager: true }
) as Record<string, { default: string }>;

const HERO_PLAYER_IMAGES = loadDirectionalSprites(
  HERO_PLAYER_GLOB,
  /hero-player-(n|ne|e|se|s|sw|w|nw)\.png$/
);

export const HERO_PLAYER_DESCRIPTORS: Record<`hero.player.${Direction}`, SpriteDescriptor> =
  createDirectionalDescriptors(
    "hero.player",
    HERO_PLAYER_IMAGES,
    "bottom",
    { kind: "fitHeight", hexSizeMul: 1.8 },
    512
  ) as Record<`hero.player.${Direction}`, SpriteDescriptor>;

// Load bubbly horse sprites from horse/commander-2/ directory
const HORSE_BUBBLY_GLOB = import.meta.glob(
  "../resources/units/horse/commander-2/*.png",
  { eager: true }
) as Record<string, { default: string }>;

const HORSE_BUBBLY_IMAGES = loadDirectionalSprites(
  HORSE_BUBBLY_GLOB,
  /bubbly-(n|ne|e|se|s|sw|w|nw)\.png$/,
  { n: "nw", s: "se" }
);

export const HORSE_BUBBLY_DESCRIPTORS: Record<`horse.bubbly.${Direction}`, SpriteDescriptor> =
  createDirectionalDescriptors(
    "horse.bubbly",
    HORSE_BUBBLY_IMAGES,
    "bottom",
    { kind: "fitHeight", hexSizeMul: 1.8 },
    64
  ) as Record<`horse.bubbly.${Direction}`, SpriteDescriptor>;

// Load shadow knight sprites from horse/commander-3/ directory (cardinal directions + diagonal fallbacks)
const HORSE_SHADOW_GLOB = import.meta.glob(
  "../resources/units/horse/commander-3/*.png",
  { eager: true }
) as Record<string, { default: string }>;

const HORSE_SHADOW_IMAGES = loadDirectionalSprites(
  HORSE_SHADOW_GLOB,
  /shadow-(n|e|s|w)\.png$/,
  { ne: "n", nw: "n", se: "s", sw: "s" }
);

export const HORSE_SHADOW_DESCRIPTORS: Record<`horse.shadow.${Direction}`, SpriteDescriptor> =
  createDirectionalDescriptors(
    "horse.shadow",
    HORSE_SHADOW_IMAGES,
    "bottom",
    { kind: "fitHeight", hexSizeMul: 1.8 },
    512
  ) as Record<`horse.shadow.${Direction}`, SpriteDescriptor>;

// Load paladin sprites from horse/commander-4/ directory (cardinal directions + diagonal fallbacks)
const HORSE_PALADIN_GLOB = import.meta.glob(
  "../resources/units/horse/commander-4/*.png",
  { eager: true }
) as Record<string, { default: string }>;

const HORSE_PALADIN_IMAGES = loadDirectionalSprites(
  HORSE_PALADIN_GLOB,
  /paladin-(n|e|s|w)\.png$/,
  { ne: "n", nw: "n", se: "s", sw: "s" }
);

export const HORSE_PALADIN_DESCRIPTORS: Record<`horse.paladin.${Direction}`, SpriteDescriptor> =
  createDirectionalDescriptors(
    "horse.paladin",
    HORSE_PALADIN_IMAGES,
    "bottom",
    { kind: "fitHeight", hexSizeMul: 1.8 },
    512
  ) as Record<`horse.paladin.${Direction}`, SpriteDescriptor>;

// Load ranger sprites from horse/commander-5/ directory (cardinal directions + diagonal fallbacks)
const HORSE_RANGER_GLOB = import.meta.glob(
  "../resources/units/horse/commander-5/*.png",
  { eager: true }
) as Record<string, { default: string }>;

const HORSE_RANGER_IMAGES = loadDirectionalSprites(
  HORSE_RANGER_GLOB,
  /ranger-(n|e|s|w)\.png$/,
  { ne: "n", nw: "n", se: "s", sw: "s" }
);

export const HORSE_RANGER_DESCRIPTORS: Record<`horse.ranger.${Direction}`, SpriteDescriptor> =
  createDirectionalDescriptors(
    "horse.ranger",
    HORSE_RANGER_IMAGES,
    "bottom",
    { kind: "fitHeight", hexSizeMul: 1.8 },
    512
  ) as Record<`horse.ranger.${Direction}`, SpriteDescriptor>;

// Load arcane spellrider sprites from horse/commander-6/ directory (cardinal directions + diagonal fallbacks)
const HORSE_ARCANE_GLOB = import.meta.glob(
  "../resources/units/horse/commander-6/*.png",
  { eager: true }
) as Record<string, { default: string }>;

const HORSE_ARCANE_IMAGES = loadDirectionalSprites(
  HORSE_ARCANE_GLOB,
  /arcane-(n|e|s|w)\.png$/,
  { ne: "n", nw: "n", se: "s", sw: "s" }
);

export const HORSE_ARCANE_DESCRIPTORS: Record<`horse.arcane.${Direction}`, SpriteDescriptor> =
  createDirectionalDescriptors(
    "horse.arcane",
    HORSE_ARCANE_IMAGES,
    "bottom",
    { kind: "fitHeight", hexSizeMul: 1.8 },
    512
  ) as Record<`horse.arcane.${Direction}`, SpriteDescriptor>;

export const RESOURCE_CART_DESCRIPTORS: Record<`resource-cart.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-cart.${r}`,
      { key: `resource-cart.${r}`, url: RESOURCE_CART_SPRITES[r], anchor: "center", sizing: { kind: "fitWidth", hexSizeMul: 0.9 } } as SpriteDescriptor,
    ])
  ) as Record<`resource-cart.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_ILLUST_DESCRIPTORS: Record<`resource-illust.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-illust.${r}`,
      { key: `resource-illust.${r}`, url: RESOURCE_ILLUST_SPRITES[r], anchor: "center", sizing: { kind: "fitWidth", hexSizeMul: 0.9 } } as SpriteDescriptor,
    ])
  ) as Record<`resource-illust.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_CONSTELLATION_DESCRIPTORS: Record<`resource-constellation.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-constellation.${r}`,
      { key: `resource-constellation.${r}`, url: RESOURCE_CONSTELLATION_SPRITES[r], anchor: "center", sizing: { kind: "fitWidth", hexSizeMul: 0.9 } } as SpriteDescriptor,
    ])
  ) as Record<`resource-constellation.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_CREST_DESCRIPTORS: Record<`resource-crest.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-crest.${r}`,
      { key: `resource-crest.${r}`, url: RESOURCE_CREST_SPRITES[r], anchor: "center", sizing: { kind: "fitWidth", hexSizeMul: 0.9 } } as SpriteDescriptor,
    ])
  ) as Record<`resource-crest.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_PILE_DESCRIPTORS: Record<`resource-pile.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-pile.${r}`,
      { key: `resource-pile.${r}`, url: RESOURCE_PILE_SPRITES[r], anchor: "center", sizing: { kind: "fitWidth", hexSizeMul: 0.95 } } as SpriteDescriptor,
    ])
  ) as Record<`resource-pile.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_PILE_SMOL_DESCRIPTORS: Record<`resource-pile-smol.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-pile-smol.${r}`,
      { key: `resource-pile-smol.${r}`, url: RESOURCE_PILE_SMOL_SPRITES[r], anchor: "center", sizing: { kind: "fitWidth", hexSizeMul: 0.475 } } as SpriteDescriptor,
    ])
  ) as Record<`resource-pile-smol.${ResourceType}`, SpriteDescriptor>;

export const RESOURCE_PILE_BUBBLY_DESCRIPTORS: Record<`resource-pile-bubbly.${ResourceType}`, SpriteDescriptor> =
  Object.fromEntries(
    RESOURCES.map((r) => [
      `resource-pile-bubbly.${r}`,
      { key: `resource-pile-bubbly.${r}`, url: RESOURCE_PILE_BUBBLY_SPRITES[r], anchor: "center", sizing: { kind: "fitWidth", hexSizeMul: 0.71 } } as SpriteDescriptor,
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
  ...Object.values(HERO_PLAYER_DESCRIPTORS),
  ...Object.values(HERO_DESCRIPTORS),
  ...Object.values(HORSE_BUBBLY_DESCRIPTORS),
  ...Object.values(HORSE_SHADOW_DESCRIPTORS),
  ...Object.values(HORSE_PALADIN_DESCRIPTORS),
  ...Object.values(HORSE_RANGER_DESCRIPTORS),
  ...Object.values(HORSE_ARCANE_DESCRIPTORS),
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

export function resourceStyleKey(type: ResourceType, style: ResourceStyle): SpriteKey {
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

export function heroDirectionKey(_faction: "player", direction: Direction): `hero.player.${Direction}` {
  return `hero.player.${direction}`;
}

export function horseBubblyKey(direction: Direction): `horse.bubbly.${Direction}` {
  return `horse.bubbly.${direction}`;
}

export function horseShadowKey(direction: Direction): `horse.shadow.${Direction}` {
  return `horse.shadow.${direction}`;
}

export function horsePaladinKey(direction: Direction): `horse.paladin.${Direction}` {
  return `horse.paladin.${direction}`;
}

export function horseRangerKey(direction: Direction): `horse.ranger.${Direction}` {
  return `horse.ranger.${direction}`;
}

export function horseArcaneKey(direction: Direction): `horse.arcane.${Direction}` {
  return `horse.arcane.${direction}`;
}

export function buildingKey(style: string, kind: string, level: number): SpriteKey {
  return `building.${style}.${kind}.${level}`;
}
