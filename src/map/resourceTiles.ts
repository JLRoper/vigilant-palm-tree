import { GameMap } from "./gameMap";
import { Terrain } from "./terrain";

export type ResourceType = "gold" | "wood" | "stone" | "iron" | "arcane" | "food";

export const RESOURCES: readonly ResourceType[] = ["gold", "wood", "stone", "iron", "arcane", "food"] as const;

export const RESOURCE_DENSITY: Record<Terrain, Record<ResourceType, number>> = {
  grass: { gold: 0.06, wood: 0.02, stone: 0.02, iron: 0.005, arcane: 0, food: 0 },
  dirt: { gold: 0.05, wood: 0.01, stone: 0.06, iron: 0.03, arcane: 0.02, food: 0 },
  forest: { gold: 0.01, wood: 0.18, stone: 0.01, iron: 0, arcane: 0, food: 0 },
  desert: { gold: 0.01, wood: 0.005, stone: 0.01, iron: 0, arcane: 0.08, food: 0 },
  mountain: { gold: 0, wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  water: { gold: 0, wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
};

const MOUNTAIN_BORDER_BOOST = 0.5;
const STONE_BORDER_CAP = 0.2;
const IRON_BORDER_CAP = 0.15;

export const RESOURCE_YIELD: Record<ResourceType, number> = {
  gold: 20,
  wood: 15,
  stone: 12,
  iron: 8,
  arcane: 5,
  food: 10,
};

export type ResourceTile = { q: number; r: number; resource: ResourceType };

const AXIAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

function isAdjacentToMountain(map: GameMap, q: number, r: number): boolean {
  for (const [dq, dr] of AXIAL_DIRS) {
    if (map.get(q + dq, r + dr) === "mountain") return true;
  }
  return false;
}

export function placeResourceTiles(map: GameMap, rng: () => number): ResourceTile[] {
  const out: ResourceTile[] = [];
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const terrain = map.get(q, r);
      if (!terrain || terrain === "water" || terrain === "mountain") continue;
      const densities: Record<ResourceType, number> = { ...RESOURCE_DENSITY[terrain] };
      if (isAdjacentToMountain(map, q, r)) {
        densities.stone = Math.min(STONE_BORDER_CAP, densities.stone * (1 + MOUNTAIN_BORDER_BOOST));
        densities.iron = Math.min(IRON_BORDER_CAP, densities.iron * (1 + MOUNTAIN_BORDER_BOOST));
      }
      const roll = rng();
      let acc = 0;
      for (const res of RESOURCES) {
        acc += densities[res];
        if (roll < acc) {
          out.push({ q, r, resource: res });
          break;
        }
      }
    }
  }
  return out;
}
