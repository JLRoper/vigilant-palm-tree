import castleL1 from "../resources/castle-l1.png?url";
import castleL2 from "../resources/castle-l2.png?url";
import castleL3 from "../resources/castle-l3.png?url";
import resourceGold from "../resources/resource-gold.png?url";
import resourceWood from "../resources/resource-wood.png?url";
import resourceStone from "../resources/resource-stone.png?url";
import resourceIron from "../resources/resource-iron.png?url";
import resourceArcane from "../resources/resource-arcane.png?url";
import heroPlayerN from "../resources/units/hero-player-n.png?url";
import heroPlayerNE from "../resources/units/hero-player-ne.png?url";
import heroPlayerE from "../resources/units/hero-player-e.png?url";
import heroPlayerSE from "../resources/units/hero-player-se.png?url";
import heroPlayerS from "../resources/units/hero-player-s.png?url";
import heroPlayerSW from "../resources/units/hero-player-sw.png?url";
import heroPlayerW from "../resources/units/hero-player-w.png?url";
import heroPlayerNW from "../resources/units/hero-player-nw.png?url";
import { Faction, HeroDirection } from "../entities/hero";
import { CastleLevel } from "../entities/settlement";
import { ResourceType, RESOURCES } from "../map/resourceTiles";

export type SpriteKey =
  | `castle.${CastleLevel}`
  | `resource.${ResourceType}`
  | `hero.${Faction}`
  | `hero.player.${HeroDirection}`
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

const HERO_PLAYER_IMAGES: Record<HeroDirection, string> = {
  n: heroPlayerN,
  ne: heroPlayerNE,
  e: heroPlayerE,
  se: heroPlayerSE,
  s: heroPlayerS,
  sw: heroPlayerSW,
  w: heroPlayerW,
  nw: heroPlayerNW,
};

export const HERO_DESCRIPTORS: Record<`hero.player.${HeroDirection}`, SpriteDescriptor> = {
  "hero.player.n": {
    key: "hero.player.n",
    url: HERO_PLAYER_IMAGES["n"],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 1.8 },
    naturalSize: 512,
  },
  "hero.player.ne": {
    key: "hero.player.ne",
    url: HERO_PLAYER_IMAGES["ne"],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 1.8 },
    naturalSize: 512,
  },
  "hero.player.e": {
    key: "hero.player.e",
    url: HERO_PLAYER_IMAGES["e"],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 1.8 },
    naturalSize: 512,
  },
  "hero.player.se": {
    key: "hero.player.se",
    url: HERO_PLAYER_IMAGES["se"],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 1.8 },
    naturalSize: 512,
  },
  "hero.player.s": {
    key: "hero.player.s",
    url: HERO_PLAYER_IMAGES["s"],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 1.8 },
    naturalSize: 512,
  },
  "hero.player.sw": {
    key: "hero.player.sw",
    url: HERO_PLAYER_IMAGES["sw"],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 1.8 },
    naturalSize: 512,
  },
  "hero.player.w": {
    key: "hero.player.w",
    url: HERO_PLAYER_IMAGES["w"],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 1.8 },
    naturalSize: 512,
  },
  "hero.player.nw": {
    key: "hero.player.nw",
    url: HERO_PLAYER_IMAGES["nw"],
    anchor: "bottom",
    sizing: { kind: "fitHeight", hexSizeMul: 1.8 },
    naturalSize: 512,
  },
};

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

export function heroDirectionKey(_faction: "player", direction: HeroDirection): `hero.player.${HeroDirection}` {
  return `hero.player.${direction}`;
}

export function buildingKey(
  style: string,
  kind: string,
  level: number,
): SpriteKey {
  return `building.${style}.${kind}.${level}`;
}
