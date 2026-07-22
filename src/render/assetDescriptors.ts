import castleL1 from "../resources/castle-l1.png?url";
import castleL2 from "../resources/castle-l2.png?url";
import castleL3 from "../resources/castle-l3.png?url";
import resourceGold from "../resources/resource-gold.png?url";
import resourceWood from "../resources/resource-wood.png?url";
import resourceStone from "../resources/resource-stone.png?url";
import resourceIron from "../resources/resource-iron.png?url";
import resourceArcane from "../resources/resource-arcane.png?url";
import { Faction } from "../entities/hero";
import { CastleLevel } from "../entities/settlement";
import { ResourceType, RESOURCES } from "../map/resourceTiles";

export type SpriteKey =
  | `castle.${CastleLevel}`
  | `resource.${ResourceType}`
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
  ...Object.values(HERO_DESCRIPTORS),
];

export function castleKey(level: CastleLevel): `castle.${CastleLevel}` {
  return `castle.${level}`;
}

export function resourceKey(type: ResourceType): `resource.${ResourceType}` {
  return `resource.${type}`;
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
