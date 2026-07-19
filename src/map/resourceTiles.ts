import { GameMap } from "./gameMap";

export type ResourceType = "gold" | "wood" | "stone" | "iron" | "arcane";

export const RESOURCES: readonly ResourceType[] = ["gold", "wood", "stone", "iron", "arcane"] as const;

export const RESOURCE_DENSITY: Record<ResourceType, number> = {
  gold: 0.05,
  wood: 0.04,
  stone: 0.03,
  iron: 0.015,
  arcane: 0.005,
};

export const RESOURCE_YIELD: Record<ResourceType, number> = {
  gold: 20,
  wood: 15,
  stone: 12,
  iron: 8,
  arcane: 5,
};

export type ResourceTile = { q: number; r: number; resource: ResourceType };

export function placeResourceTiles(map: GameMap, rng: () => number): ResourceTile[] {
  const out: ResourceTile[] = [];
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (map.get(q, r) === "water") continue;
      const roll = rng();
      let acc = 0;
      for (const res of RESOURCES) {
        acc += RESOURCE_DENSITY[res];
        if (roll < acc) {
          out.push({ q, r, resource: res });
          break;
        }
      }
    }
  }
  return out;
}
