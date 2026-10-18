import { Terrain, TERRAIN_COST } from "./terrain";
import { placeResourceTiles, ResourceTile } from "./resourceTiles";
import type { Axial } from "@heroes/contracts";
import { mulberry32 } from "../rng";
import { NEIGHBOR_DIRS } from "./directions";

export { NEIGHBOR_DIRS };

const HERO_SPAWN: Axial = { q: 2, r: 2 };

export interface CityBackdropSignature {
  center: Terrain;
  /** Six neighbors in NEIGHBOR_DIRS order (E, NE, NW, W, SW, SE). */
  neighbors: Terrain[];
  seed: number;
}

export function sampleCityBackdrop(map: GameMap, q: number, r: number, seed: number): CityBackdropSignature {
  const center = map.get(q, r) ?? "grass";
  const neighbors = NEIGHBOR_DIRS.map((d) => map.get(q + d.q, r + d.r) ?? center);
  const mixed = (Math.imul(q + 1, 0x9e3779b1) ^ Math.imul(r + 1, 0x85ebca6b) ^ (seed >>> 0)) >>> 0;
  return { center, neighbors, seed: mixed };
}

export type TileRow = {
  q: number;
  r: number;
  terrain: Terrain;
  resource: string | null;
};

export type MapSize = "small" | "medium" | "large" | "huge" | "epic";
export type MapGenVersion = 1 | 2 | 3;

export const MAP_SIZES: Record<MapSize, { width: number; height: number; label: string }> = {
  small:  { width: 24, height: 18, label: "Small" },
  medium: { width: 36, height: 27, label: "Medium" },
  large:  { width: 48, height: 36, label: "Large" },
  huge:   { width: 72, height: 54, label: "Huge" },
  epic:   { width: 120, height: 90, label: "Epic" },
};

export class GameMap {
  width = 24;
  height = 18;
  tiles: Terrain[] = [];
  resourceTiles: (ResourceTile | undefined)[] = [];
  placedResourceTiles: readonly ResourceTile[] = [];

  constructor(seed = 1, mapSize?: MapSize, version: MapGenVersion = 3) {
    if (mapSize && MAP_SIZES[mapSize]) {
      this.width = MAP_SIZES[mapSize].width;
      this.height = MAP_SIZES[mapSize].height;
    }
    this.tiles =
      version === 1
        ? generateTerrainLegacy(mulberry32(seed), this.width, this.height)
        : generateTerrain(mulberry32(seed), this.width, this.height, version >= 3);
    if (!this.isPassable(HERO_SPAWN.q, HERO_SPAWN.r)) {
      this.tiles[this.index(HERO_SPAWN.q, HERO_SPAWN.r)] = "grass";
    }
    const resourceRng = mulberry32(((seed ^ 0x72657375) >>> 0));
    const placed = placeResourceTiles(this, resourceRng);
    this.placedResourceTiles = placed;
    this.resourceTiles = new Array<ResourceTile | undefined>(this.width * this.height);
    for (const t of placed) {
      this.resourceTiles[this.index(t.q, t.r)] = t;
    }
  }

  index(q: number, r: number): number {
    return r * this.width + q;
  }

  get(q: number, r: number): Terrain | undefined {
    if (q < 0 || q >= this.width || r < 0 || r >= this.height) return undefined;
    return this.tiles[this.index(q, r)];
  }

  resourceTileAt(q: number, r: number): ResourceTile | undefined {
    if (q < 0 || q >= this.width || r < 0 || r >= this.height) return undefined;
    const idx = this.index(q, r);
    return this.resourceTiles[idx];
  }

  isPassable(q: number, r: number): boolean {
    const t = this.get(q, r);
    if (!t) return false;
    return TERRAIN_COST[t] !== Infinity;
  }

  cost(q: number, r: number): number {
    const t = this.get(q, r);
    if (!t) return Infinity;
    return TERRAIN_COST[t];
  }

  static fromTiles(rows: ReadonlyArray<TileRow>): GameMap {
    let maxQ = 0;
    let maxR = 0;
    for (const row of rows) {
      if (row.q > maxQ) maxQ = row.q;
      if (row.r > maxR) maxR = row.r;
    }
    const width = maxQ + 1;
    const height = maxR + 1;
    const map = Object.create(GameMap.prototype) as GameMap;
    map.width = width;
    map.height = height;
    map.tiles = new Array<Terrain>(width * height);
    map.resourceTiles = new Array<ResourceTile | undefined>(width * height);
    const placed: ResourceTile[] = [];
    for (const row of rows) {
      const idx = map.index(row.q, row.r);
      map.tiles[idx] = row.terrain;
      if (row.resource) {
        const rt: ResourceTile = { q: row.q, r: row.r, resource: row.resource as any };
        map.resourceTiles[idx] = rt;
        placed.push(rt);
      }
    }
    map.placedResourceTiles = placed;
    return map;
  }
}

export const GAME_MAP_CACHE_CAPACITY = 32;
const gameMapCache = new Map<string, GameMap>();

export function resolveMapSize(mapSize?: string | null): MapSize {
  return mapSize && (mapSize as MapSize) in MAP_SIZES ? (mapSize as MapSize) : "small";
}

export function resolveMapGenVersion(version?: number | null): MapGenVersion {
  if (version === 1) return 1;
  if (version === 2) return 2;
  return 3;
}

export function resolveSavedMapGenVersion(version?: number | null): MapGenVersion {
  if (version === 2) return 2;
  if (version === 3) return 3;
  return 1;
}

export function getOrCreateGameMap(
  seed = 1,
  mapSize?: MapSize | string | null,
  version?: MapGenVersion | number | null,
): GameMap {
  const resolvedSize = resolveMapSize(mapSize);
  const resolvedSeed = Number.isFinite(seed) ? Number(seed) : 1;
  const resolvedVersion = resolveMapGenVersion(version);
  const key = `${resolvedSeed}:${resolvedSize}:v${resolvedVersion}`;
  const hit = gameMapCache.get(key);
  if (hit) {
    gameMapCache.delete(key);
    gameMapCache.set(key, hit);
    return hit;
  }
  const created = new GameMap(resolvedSeed, resolvedSize, resolvedVersion);
  if (gameMapCache.size >= GAME_MAP_CACHE_CAPACITY) {
    const oldestKey = gameMapCache.keys().next().value;
    if (oldestKey !== undefined) gameMapCache.delete(oldestKey);
  }
  gameMapCache.set(key, created);
  return created;
}

export function clearGameMapCache(): void {
  gameMapCache.clear();
}

export function getGameMapCacheSize(): number {
  return gameMapCache.size;
}

export function scaledTerrainBlobs(baseBlobs: number, width: number, height: number): number {
  const total = width * height;
  if (!(total > 24 * 18)) return baseBlobs;
  return Math.max(baseBlobs, Math.round(baseBlobs * Math.sqrt(total / (24 * 18))));
}

function generateTerrain(rng: () => number, width: number, height: number, scaleBlobs = true): Terrain[] {
  const total = width * height;
  const tiles = new Array<Terrain>(total).fill("grass");
  const inFrontier = new Uint8Array(total);

  const targets: Array<{ terrain: Terrain; fraction: number; blobs: number }> = [
    { terrain: "mountain", fraction: 0.03, blobs: 2 },
    { terrain: "desert", fraction: 0.05, blobs: 2 },
    { terrain: "swamp", fraction: 0.06, blobs: 3 },
    { terrain: "snow", fraction: 0.06, blobs: 3 },
    { terrain: "water", fraction: 0.10, blobs: 3 },
    { terrain: "forest", fraction: 0.15, blobs: 4 },
    { terrain: "dirt", fraction: 0.18, blobs: 5 },
  ];

  for (const { terrain, fraction, blobs } of targets) {
    const targetCount = Math.floor(total * fraction);
    const blobCount = scaleBlobs ? scaledTerrainBlobs(blobs, width, height) : blobs;
    const frontier: number[] = [];
    inFrontier.fill(0);
    for (let i = 0; i < blobCount; i++) {
      const q = Math.floor(rng() * width);
      const r = Math.floor(rng() * height);
      const cellIdx = r * width + q;
      if (!inFrontier[cellIdx]) {
        inFrontier[cellIdx] = 1;
        frontier.push(cellIdx);
      }
    }
    let placed = 0;
    let guard = 0;
    const maxSteps = targetCount * 20;
    while (placed < targetCount && frontier.length > 0 && guard++ < maxSteps) {
      const idx = Math.floor(rng() * frontier.length);
      const cellIdx = frontier[idx];
      const last = frontier.pop()!;
      if (idx < frontier.length) frontier[idx] = last;
      if (tiles[cellIdx] === "grass") {
        tiles[cellIdx] = terrain;
        placed++;
        const cq = cellIdx % width;
        const cr = (cellIdx / width) | 0;
        for (const d of NEIGHBOR_DIRS) {
          const nq = cq + d.q;
          const nr = cr + d.r;
          if (nq >= 0 && nq < width && nr >= 0 && nr < height) {
            const nIdx = nr * width + nq;
            if (tiles[nIdx] === "grass" && !inFrontier[nIdx]) {
              inFrontier[nIdx] = 1;
              frontier.push(nIdx);
            }
          }
        }
      }
    }
  }

  return tiles;
}

function generateTerrainLegacy(rng: () => number, width: number, height: number): Terrain[] {
  const total = width * height;
  const tiles = new Array<Terrain>(total).fill("grass");

  const targets: Array<{ terrain: Terrain; fraction: number; blobs: number }> = [
    { terrain: "mountain", fraction: 0.03, blobs: 2 },
    { terrain: "desert", fraction: 0.05, blobs: 2 },
    { terrain: "swamp", fraction: 0.06, blobs: 3 },
    { terrain: "snow", fraction: 0.06, blobs: 3 },
    { terrain: "water", fraction: 0.10, blobs: 3 },
    { terrain: "forest", fraction: 0.15, blobs: 4 },
    { terrain: "dirt", fraction: 0.18, blobs: 5 },
  ];

  for (const { terrain, fraction, blobs } of targets) {
    const targetCount = Math.floor(total * fraction);
    const frontier: number[] = [];
    for (let i = 0; i < blobs; i++) {
      const q = Math.floor(rng() * width);
      const r = Math.floor(rng() * height);
      frontier.push(r * width + q);
    }
    let placed = 0;
    let guard = 0;
    const maxSteps = targetCount * 20;
    while (placed < targetCount && frontier.length > 0 && guard++ < maxSteps) {
      const idx = Math.floor(rng() * frontier.length);
      const cellIdx = frontier[idx];
      if (tiles[cellIdx] === "grass") {
        tiles[cellIdx] = terrain;
        placed++;
        const cq = cellIdx % width;
        const cr = (cellIdx / width) | 0;
        for (const d of NEIGHBOR_DIRS) {
          const nq = cq + d.q;
          const nr = cr + d.r;
          if (nq >= 0 && nq < width && nr >= 0 && nr < height) {
            frontier.push(nr * width + nq);
          }
        }
      }
      if (frontier.length > targetCount * 3) frontier.splice(idx, 1);
    }
  }

  return tiles;
}
