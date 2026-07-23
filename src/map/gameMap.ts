import { Terrain, TERRAIN_COST } from "./terrain";
import { placeResourceTiles, ResourceTile, ResourceType } from "./resourceTiles";
import { Axial } from "../core/hex";
import { mulberry32 } from "../core/rng";

const HERO_SPAWN: Axial = { q: 2, r: 2 };

const NEIGHBOR_DIRS: Axial[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export type TileRow = {
  q: number;
  r: number;
  terrain: Terrain;
  resource: ResourceType | null;
};

export type MapSize = "small" | "medium" | "large";

export const MAP_SIZES: Record<MapSize, { width: number; height: number; label: string }> = {
  small:  { width: 24, height: 18, label: "Small" },
  medium: { width: 36, height: 27, label: "Medium" },
  large:  { width: 48, height: 36, label: "Large" },
};

export class GameMap {
  width = 24;
  height = 18;
  tiles: Terrain[] = [];
  resourceTiles: (ResourceTile | undefined)[] = [];

  constructor(seed = 1, mapSize?: MapSize) {
    if (mapSize && MAP_SIZES[mapSize]) {
      this.width = MAP_SIZES[mapSize].width;
      this.height = MAP_SIZES[mapSize].height;
    }
    this.tiles = generateTerrain(mulberry32(seed), this.width, this.height);
    if (!this.isPassable(HERO_SPAWN.q, HERO_SPAWN.r)) {
      this.tiles[this.index(HERO_SPAWN.q, HERO_SPAWN.r)] = "grass";
    }
    const resourceRng = mulberry32(((seed ^ 0x72657375) >>> 0));
    const placed = placeResourceTiles(this, resourceRng);
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
    for (const row of rows) {
      const idx = map.index(row.q, row.r);
      map.tiles[idx] = row.terrain;
      if (row.resource) {
        map.resourceTiles[idx] = { q: row.q, r: row.r, resource: row.resource };
      }
    }
    return map;
  }
}

function generateTerrain(rng: () => number, width: number, height: number): Terrain[] {
  const total = width * height;
  const tiles = new Array<Terrain>(total).fill("grass");

  const targets: Array<{ terrain: Terrain; fraction: number; blobs: number }> = [
    { terrain: "mountain", fraction: 0.03, blobs: 2 },
    { terrain: "desert", fraction: 0.05, blobs: 2 },
    { terrain: "water", fraction: 0.10, blobs: 3 },
    { terrain: "forest", fraction: 0.15, blobs: 4 },
    { terrain: "dirt", fraction: 0.18, blobs: 5 },
  ];

  for (const { terrain, fraction, blobs } of targets) {
    const targetCount = Math.floor(total * fraction);
    const frontier: Axial[] = [];
    for (let i = 0; i < blobs; i++) {
      const q = Math.floor(rng() * width);
      const r = Math.floor(rng() * height);
      frontier.push({ q, r });
    }
    let placed = 0;
    let guard = 0;
    const maxSteps = targetCount * 20;
    while (placed < targetCount && frontier.length > 0 && guard++ < maxSteps) {
      const idx = Math.floor(rng() * frontier.length);
      const cur = frontier[idx];
      const i = cur.r * width + cur.q;
      if (tiles[i] === "grass") {
        tiles[i] = terrain;
        placed++;
        for (const d of NEIGHBOR_DIRS) {
          const nq = cur.q + d.q;
          const nr = cur.r + d.r;
          if (nq >= 0 && nq < width && nr >= 0 && nr < height) {
            frontier.push({ q: nq, r: nr });
          }
        }
      }
      if (frontier.length > targetCount * 3) frontier.splice(idx, 1);
    }
  }

  return tiles;
}
