import { Terrain, TERRAIN_COST } from "./terrain";

export class GameMap {
  width = 24;
  height = 18;
  tiles: Terrain[] = [];

  constructor(seed = 1) {
    const rng = mulberry32(seed);
    for (let r = 0; r < this.height; r++) {
      for (let q = 0; q < this.width; q++) {
        const t = pickTerrain(rng, q, r);
        this.tiles.push(t);
      }
    }
  }

  index(q: number, r: number): number {
    return r * this.width + q;
  }

  get(q: number, r: number): Terrain | undefined {
    if (q < 0 || q >= this.width || r < 0 || r >= this.height) return undefined;
    return this.tiles[this.index(q, r)];
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
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickTerrain(_rng: () => number, q: number, r: number): Terrain {
  const noise = Math.sin(q * 12.9898 + r * 78.233) * 43758.5453;
  const n = noise - Math.floor(noise);
  if (n < 0.12) return "water";
  if (n < 0.2) return "forest";
  if (n < 0.35) return "dirt";
  return "grass";
}
