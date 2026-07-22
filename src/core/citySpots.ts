import type { ResourceType } from "../map/resourceTiles";
import type { CityViewSize } from "./cityGrid";

export interface CitySpot {
  cell: { x: number; y: number };
  resource: ResourceType;
  vein: string;
}

export interface CityMine {
  cell: { x: number; y: number };
  resource: ResourceType;
  level: number;
}

export interface CitySpotsResult {
  spots: CitySpot[];
  mines: CityMine[];
}

const RESOURCE_POOL: ResourceType[] = ["gold", "wood", "stone", "iron", "arcane"];

export function generateCitySpots(
  size: CityViewSize,
  rng: () => number,
): CitySpotsResult {
  const spots: CitySpot[] = [];
  const mines: CityMine[] = [];

  const center = Math.floor((size - 1) / 2);
  const maxSpots = size === 5 ? 3 : size === 10 ? 6 : 9;

  const used = new Set<string>();
  used.add(`${center},${center}`);

  for (let i = 0; i < maxSpots; i++) {
    let gx: number;
    let gy: number;
    let attempts = 0;
    do {
      gx = Math.floor(rng() * size);
      gy = Math.floor(rng() * size);
      attempts++;
    } while (used.has(`${gx},${gy}`) && attempts < 100);

    if (used.has(`${gx},${gy}`)) continue;
    used.add(`${gx},${gy}`);

    const resource = RESOURCE_POOL[Math.floor(rng() * RESOURCE_POOL.length)];
    spots.push({ cell: { x: gx, y: gy }, resource, vein: `${resource}_vein_${i}` });
  }

  return { spots, mines };
}
