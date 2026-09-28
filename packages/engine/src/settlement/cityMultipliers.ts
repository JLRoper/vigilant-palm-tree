import type { ResourceType } from "@heroes/contracts";

export const CELL_MULTIPLIER_HASH_VERSION = 1;
export const CELL_MULTIPLIER_SIGMA = 0.25;
export const CELL_MULTIPLIER_PEAK = 1.0;
export const SPOT_MULTIPLIER_PEAK = 3.0;

const MULTIPLIER_RESOURCE_CODES: readonly ResourceType[] = [
  "gold",
  "wood",
  "stone",
  "iron",
  "arcane",
  "food",
];

export interface CitySpotRef {
  cell: { x: number; y: number };
  resource: ResourceType;
}

export interface CellMultiplierInput {
  seed: number;
  q: number;
  r: number;
  gx: number;
  gy: number;
  resource: ResourceType;
  spots: readonly CitySpotRef[];
}

function mix(h: number, v: number): number {
  h = Math.imul(h ^ v, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function resourceCode(resource: ResourceType): number {
  const idx = MULTIPLIER_RESOURCE_CODES.indexOf(resource);
  if (idx >= 0) return idx;
  let code = 0;
  for (let i = 0; i < resource.length; i++) code = (code * 31 + resource.charCodeAt(i)) | 0;
  return code;
}

function hashCellMultiplier(input: CellMultiplierInput, salt: number): number {
  let h = Math.imul(CELL_MULTIPLIER_HASH_VERSION, 0x9e3779b1) >>> 0;
  h = mix(h, input.seed | 0);
  h = mix(h, input.q | 0);
  h = mix(h, input.r | 0);
  h = mix(h, input.gx | 0);
  h = mix(h, input.gy | 0);
  h = mix(h, resourceCode(input.resource));
  h = mix(h, salt);
  return h;
}

export function spotResourceAt(
  spots: readonly CitySpotRef[],
  gx: number,
  gy: number,
): ResourceType | null {
  for (const spot of spots) {
    if (spot.cell.x === gx && spot.cell.y === gy) return spot.resource;
  }
  return null;
}

export function cellMultiplier(input: CellMultiplierInput): number {
  const h1 = hashCellMultiplier(input, 0x9e3779b9);
  const h2 = hashCellMultiplier(input, 0x85ebca6b);
  const u1 = (h1 + 1) / 4294967297;
  const u2 = h2 / 4294967296;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const spot = spotResourceAt(input.spots, input.gx, input.gy);
  const peak = spot !== null && spot === input.resource ? SPOT_MULTIPLIER_PEAK : CELL_MULTIPLIER_PEAK;
  const m = peak + CELL_MULTIPLIER_SIGMA * z;
  return Math.round(m * 100) / 100;
}
