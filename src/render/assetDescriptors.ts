import castleL1 from "../resources/castle-l1.png?url";
import castleL2 from "../resources/castle-l2.png?url";
import castleL3 from "../resources/castle-l3.png?url";
import resourceGold from "../resources/resource-gold.png?url";
import resourceWood from "../resources/resource-wood.png?url";
import resourceStone from "../resources/resource-stone.png?url";
import resourceIron from "../resources/resource-iron.png?url";
import resourceArcane from "../resources/resource-arcane.png?url";
import { Faction, Direction } from "../entities/hero";
import { CastleLevel } from "../entities/settlement";
import { ResourceType, RESOURCES } from "../map/resourceTiles";

export type SpriteKey =
  | `castle.${CastleLevel}`
  | `resource.${ResourceType}`
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

// Generic helper to load directional sprites from a glob
// Returns a Record<Direction, string> mapping direction to URL
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

  // Apply fallbacks for missing directions
  for (const [missing, fallback] of Object.entries(fallbacks)) {
    if (!images[missing as Direction] && images[fallback]) {
      images[missing as Direction] = images[fallback]!;
    }
  }

  return images;
}

// Generic helper to create descriptors for directional sprites
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
    descriptors[key] = {
      key,
      url,
      anchor,
      sizing,
      naturalSize,
    };
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

export const HERO_DESCRIPTORS: Record<`hero.player.${Direction}`, SpriteDescriptor> =
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
  { n: "nw", s: "se" }  // Fallbacks
);

export const HORSE_BUBBLY_DESCRIPTORS: Record<`horse.bubbly.${Direction}`, SpriteDescriptor> = 
  createDirectionalDescriptors(
    "horse.bubbly",
    HORSE_BUBBLY_IMAGES,
    "bottom",
    { kind: "fitHeight", hexSizeMul: 1.8 },
    64
  ) as Record<`horse.bubbly.${Direction}`, SpriteDescriptor>;

export const HERO_FALLBACK_DESCRIPTORS: Record<`hero.enemy`, SpriteDescriptor> = {
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
  ...Object.values(HERO_DESCRIPTORS),
  ...Object.values(HERO_FALLBACK_DESCRIPTORS),
  ...Object.values(HORSE_BUBBLY_DESCRIPTORS),
];

export function castleKey(level: CastleLevel): `castle.${CastleLevel}` {
  return `castle.${level}`;
}

export function resourceKey(type: ResourceType): `resource.${ResourceType}` {
  return `resource.${type}`;
}

export function heroKey(_faction: Faction): `hero.${Faction}` {
  return `hero.${_faction}`;
}

export function heroDirectionKey(_faction: "player", direction: Direction): `hero.player.${Direction}` {
  return `hero.player.${direction}`;
}

export function horseBubblyKey(direction: Direction): `horse.bubbly.${Direction}` {
  return `horse.bubbly.${direction}`;
}

export function buildingKey(
  style: string,
  kind: string,
  level: number,
): SpriteKey {
  return `building.${style}.${kind}.${level}`;
}
