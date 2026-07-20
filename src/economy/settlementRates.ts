import type { GameMap } from "../map/gameMap";
import { RESOURCE_YIELD, type ResourceType } from "../map/resourceTiles";
import type { CastleLevel } from "../entities/settlement";

const SETTLEMENT_RATE_RADIUS = 3;

const POP_BY_LEVEL: Record<CastleLevel, number> = {
  1: 500,
  2: 1500,
  3: 5000,
};

export const SETTLEMENT_GOLD_TAX: Record<CastleLevel, number> = {
  1: 1,
  2: 2,
  3: 3,
};

const NAME_PREFIXES = [
  "Black", "Iron", "Silver", "Storm", "Frost",
  "Dragon", "Wolf", "Raven", "Stone", "Dawn",
  "Gold", "Ember", "Thorn", "Grim", "High",
];

const NAME_SUFFIXES = [
  "hold", "keep", "watch", "spire", "fall",
  "reach", "gate", "crest", "hollow", "rest",
  "guard", "pass", "mark",
];

const NEUTRAL_PREFIXES = [
  "Old", "Lost", "Forgotten", "Ruined", "Forsaken", "Abandoned", "Shattered",
];

const NEUTRAL_SUFFIXES = [
  "Outpost", "Tower", "Hold", "Watch", "Garrison", "Fortress", "Keep",
];

export function defaultPopulation(level: CastleLevel): number {
  return POP_BY_LEVEL[level];
}

export function generateSettlementName(rng: () => number, ownerId: number | null): string {
  if (ownerId === null) {
    const p = NEUTRAL_PREFIXES[Math.floor(rng() * NEUTRAL_PREFIXES.length)];
    const s = NEUTRAL_SUFFIXES[Math.floor(rng() * NEUTRAL_SUFFIXES.length)];
    return `${p} ${s}`;
  }
  const p = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
  const s = NAME_SUFFIXES[Math.floor(rng() * NAME_SUFFIXES.length)];
  return `${p} ${s}`;
}

export interface ComputedRates {
  rates: Partial<Record<ResourceType, number>>;
  foundedOn: ResourceType | null;
}

export function computeSettlementRates(
  map: GameMap,
  q: number,
  r: number,
  level: CastleLevel
): ComputedRates {
  const rates: Partial<Record<ResourceType, number>> = {};
  let foundedOn: ResourceType | null = null;
  for (let dq = -SETTLEMENT_RATE_RADIUS; dq <= SETTLEMENT_RATE_RADIUS; dq++) {
    for (let dr = -SETTLEMENT_RATE_RADIUS; dr <= SETTLEMENT_RATE_RADIUS; dr++) {
      if (Math.abs(dq + dr) > SETTLEMENT_RATE_RADIUS) continue;
      const rt = map.resourceTileAt(q + dq, r + dr);
      if (!rt) continue;
      rates[rt.resource] = (rates[rt.resource] ?? 0) + RESOURCE_YIELD[rt.resource];
      if (dq === 0 && dr === 0) foundedOn = rt.resource;
    }
  }
  for (const key of Object.keys(rates) as ResourceType[]) {
    rates[key] = (rates[key] ?? 0) * level;
  }
  return { rates, foundedOn };
}

export function fillSettlementDefaults<T extends { rates?: Partial<Record<ResourceType, number>>; foundedOnResource?: ResourceType | null }>(
  partial: T
): T {
  if (!partial.rates) partial.rates = {};
  if (partial.foundedOnResource === undefined) partial.foundedOnResource = null;
  return partial;
}
