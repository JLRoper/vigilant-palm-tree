import type { ResourceType } from "@heroes/contracts";

export type CityViewSize = 5 | 10 | 15;

export function cityViewSizeFor(level: 1 | 2 | 3): CityViewSize {
  if (level === 1) return 5;
  if (level === 2) return 10;
  return 15;
}

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

const RESOURCE_POOL: ResourceType[] = ["gold", "wood", "stone", "iron", "arcane", "food"];
const NON_FOOD_RESOURCE_POOL: ResourceType[] = RESOURCE_POOL.filter((res) => res !== "food");

// Food has NO map-tile source by designer decision (RESOURCE_DENSITY.food is 0
// on every terrain). It exists only inside a city: a farm building placed on a
// food spot earns the ~3x spot multiplier, and that placement is the player's
// decision. Terrain biases how often a spot rolls food at all (see
// foodBiasForTerrain), so green plains get rich farmland and barrens barely any.
export const DEFAULT_FOOD_BIAS = 0.35;

export interface GenerateCitySpotsOptions {
  /** 0..1 weight for a spot being food. Defaults to DEFAULT_FOOD_BIAS. */
  foodBias?: number;
}

const FOOD_BIAS_BY_TERRAIN: Record<string, number> = {
  grass: 0.55,
  forest: 0.32,
  dirt: 0.22,
  desert: 0.05,
  mountain: 0,
  water: 0,
};

/** Chance weight a city's food spots roll from, given the terrain it sits on. */
export function foodBiasForTerrain(terrain: string): number {
  return FOOD_BIAS_BY_TERRAIN[terrain] ?? 0;
}

function clampFoodBias(bias: number): number {
  if (!(bias > 0)) return 0;
  return bias > 1 ? 1 : bias;
}

/**
 * One rng draw decides both halves of the pick: below `foodBias` it is food,
 * otherwise the same value is rescaled across the non-food pool so a single
 * draw still yields a uniform resource (and `foodBias: 0` reproduces the
 * pre-food uniform pick exactly).
 */
function pickSpotResource(roll: number, foodBias: number): ResourceType {
  if (roll < foodBias) return "food";
  const span = 1 - foodBias;
  if (span <= 0) return NON_FOOD_RESOURCE_POOL[0];
  const idx = Math.floor(((roll - foodBias) / span) * NON_FOOD_RESOURCE_POOL.length);
  return NON_FOOD_RESOURCE_POOL[Math.min(idx, NON_FOOD_RESOURCE_POOL.length - 1)];
}

export function generateCitySpots(
  size: CityViewSize,
  rng: () => number,
  opts?: GenerateCitySpotsOptions,
): CitySpotsResult {
  const spots: CitySpot[] = [];
  const mines: CityMine[] = [];

  const center = Math.floor((size - 1) / 2);
  const maxSpots = size === 5 ? 3 : size === 10 ? 6 : 9;

  const foodBias = clampFoodBias(opts?.foodBias ?? DEFAULT_FOOD_BIAS);

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

    const resource = pickSpotResource(rng(), foodBias);
    spots.push({ cell: { x: gx, y: gy }, resource, vein: `${resource}_vein_${i}` });
  }

  return { spots, mines };
}
