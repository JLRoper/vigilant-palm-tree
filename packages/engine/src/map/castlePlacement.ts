import type { CastleLevel, PlacedCastle } from "@heroes/contracts";
import { CASTLE_COUNT_DEFAULT, CASTLE_COUNT_MAX, CASTLE_COUNT_MIN, defaultCastleSeedFromMapSeed } from "../hydrate";
import { mulberry32 } from "../rng";
import { GameMap } from "./gameMap";
import { isPassable } from "./terrain";

// PlacedCastle lives in @heroes/contracts — re-exported here so consumers of
// the castle-placement module get its full surface from one import path.
export type { PlacedCastle };

export const EDGE_BUFFER = 2;
export const MIN_CASTLE_SPACING = 4;

export interface CastlePlacementOptions {
  castleSeed: number;
  playerCount: number;
  castleCount: number;
}

interface CandidateTile {
  q: number;
  r: number;
}

function listCandidates(map: GameMap): { left: CandidateTile[]; right: CandidateTile[]; any: CandidateTile[] } {
  const any: CandidateTile[] = [];
  const left: CandidateTile[] = [];
  const right: CandidateTile[] = [];
  const midpoint = map.width / 2;
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (q < EDGE_BUFFER || q >= map.width - EDGE_BUFFER) continue;
      if (r < EDGE_BUFFER || r >= map.height - EDGE_BUFFER) continue;
      const t = map.get(q, r);
      if (!t || !isPassable(t)) continue;
      if (map.resourceTileAt(q, r)) continue;
      const tile: CandidateTile = { q, r };
      any.push(tile);
      if (q < midpoint) left.push(tile);
      else right.push(tile);
    }
  }
  return { left, right, any };
}

const CASTLE_BFS_DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function buildReachableMask(map: GameMap, origin: CandidateTile): Uint8Array | null {
  const width = map.width;
  const height = map.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const startIdx = origin.r * width + origin.q;
  visited[startIdx] = 1;
  queue[0] = startIdx;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const cur = queue[head++];
    const cq = cur % width;
    const cr = (cur / width) | 0;
    for (let d = 0; d < 6; d++) {
      const nq = cq + CASTLE_BFS_DIRS[d].q;
      const nr = cr + CASTLE_BFS_DIRS[d].r;
      if (nq < 0 || nq >= width || nr < 0 || nr >= height) continue;
      const nIdx = nr * width + nq;
      if (visited[nIdx]) continue;
      const t = map.get(nq, nr);
      if (!t || !isPassable(t)) continue;
      visited[nIdx] = 1;
      queue[tail++] = nIdx;
    }
  }
  return visited;
}

function findLargestComponentMask(
  map: GameMap,
  candidates: readonly CandidateTile[],
  minRequired = 1,
): Uint8Array | null {
  const width = map.width;
  const height = map.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }
  const seen = new Uint8Array(width * height);
  let bestMask: Uint8Array | null = null;
  let bestCandCount = -1;

  for (const cand of candidates) {
    const idx = cand.r * width + cand.q;
    if (seen[idx]) continue;
    const mask = buildReachableMask(map, cand);
    if (!mask) return null;
    let candCount = 0;
    for (const c of candidates) {
      const cIdx = c.r * width + c.q;
      if (mask[cIdx]) {
        seen[cIdx] = 1;
        candCount++;
      }
    }
    if (candCount > bestCandCount) {
      bestCandCount = candCount;
      bestMask = mask;
    }
  }
  return bestCandCount >= minRequired ? bestMask : null;
}

function findLargestPassableComponentTiles(map: GameMap): CandidateTile[] {
  const allPassable: CandidateTile[] = [];
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const t = map.get(q, r);
      if (t && isPassable(t)) {
        allPassable.push({ q, r });
      }
    }
  }
  if (allPassable.length === 0) return [];
  const mask = findLargestComponentMask(map, allPassable);
  if (!mask) return allPassable;
  return allPassable.filter((c) => mask[c.r * map.width + c.q] === 1);
}

function pickFromCandidates(
  rng: () => number,
  pool: CandidateTile[],
  placed: CandidateTile[],
  minSpacing: number,
  reachableMask: Uint8Array | null,
  mapWidth: number,
): CandidateTile | null {
  if (pool.length === 0) return null;
  if (reachableMask && !pool.some((c) => reachableMask[c.r * mapWidth + c.q] === 1)) {
    return null;
  }
  const effectiveMinSpacing = Math.max(1, minSpacing);
  for (let attempt = 0; attempt < 64; attempt++) {
    const idx = Math.floor(rng() * pool.length);
    const cand = pool[idx];
    if (reachableMask && !reachableMask[cand.r * mapWidth + cand.q]) {
      continue;
    }
    let ok = true;
    for (const p of placed) {
      const dq = Math.abs(p.q - cand.q);
      const dr = Math.abs(p.r - cand.r);
      const ds = Math.abs(p.q + p.r - cand.q - cand.r);
      const dist = (dq + dr + ds) / 2;
      if ((p.q === cand.q && p.r === cand.r) || dist < effectiveMinSpacing) {
        ok = false;
        break;
      }
    }
    if (ok) return cand;
  }
  for (const cand of pool) {
    if (reachableMask && !reachableMask[cand.r * mapWidth + cand.q]) {
      continue;
    }
    let ok = true;
    for (const p of placed) {
      const dq = Math.abs(p.q - cand.q);
      const dr = Math.abs(p.r - cand.r);
      const ds = Math.abs(p.q + p.r - cand.q - cand.r);
      const dist = (dq + dr + ds) / 2;
      if ((p.q === cand.q && p.r === cand.r) || dist < effectiveMinSpacing) {
        ok = false;
        break;
      }
    }
    if (ok) return cand;
  }
  return null;
}

function levelForIndex(idx: number): CastleLevel {
  if (idx === 0) return 1;
  if (idx === 1) return 2;
  return 3;
}

const HUMAN_CASTLE_COUNT = 2;

function ownerForIndex(idx: number, playerCount: number): number | null {
  if (idx < HUMAN_CASTLE_COUNT) return 0;
  const remainingIdx = idx - HUMAN_CASTLE_COUNT;
  if (remainingIdx < playerCount - 1) return remainingIdx + 1;
  return null;
}

export function maxCastleCountForMap(width: number, height: number): number {
  const total = width * height;
  if (!(total > 24 * 18)) return CASTLE_COUNT_MAX;
  return Math.max(CASTLE_COUNT_MAX, Math.round(CASTLE_COUNT_MAX * Math.sqrt(total / (24 * 18))));
}

export function defaultCastleCountForMap(
  playerCount: number,
  width: number,
  height: number,
): number {
  const base = Math.max(CASTLE_COUNT_MIN, 2 * playerCount);
  const total = width * height;
  if (!(total > 24 * 18)) return base;
  const scaled = Math.round(CASTLE_COUNT_DEFAULT * Math.sqrt(total / (24 * 18)));
  return Math.min(maxCastleCountForMap(width, height), Math.max(base, scaled));
}

export function clampCastleCount(n: number, maxCount = CASTLE_COUNT_MAX): number {
  if (!Number.isFinite(n)) return CASTLE_COUNT_DEFAULT;
  const i = Math.floor(n);
  if (i < CASTLE_COUNT_MIN) return CASTLE_COUNT_MIN;
  if (i > maxCount) return maxCount;
  return i;
}

export function generateCastles(
  map: GameMap,
  opts: CastlePlacementOptions,
): PlacedCastle[] {
  const count = clampCastleCount(opts.castleCount, maxCastleCountForMap(map.width, map.height));
  const seed = opts.castleSeed >>> 0;
  const rng = mulberry32(seed || 1);

  const cands = listCandidates(map);

  for (let spacing = MIN_CASTLE_SPACING; spacing >= 0; spacing--) {
    const placed: CandidateTile[] = [];
    const order: ("left" | "right" | "any")[] = ["left", "right", "any", "any", "any"];
    let reachableMask: Uint8Array | null = null;

    for (let i = 0; i < count; i++) {
      const which = order[i] ?? "any";
      const preferredPool = which === "left" ? cands.left : which === "right" ? cands.right : cands.any;
      const pool =
        reachableMask &&
        preferredPool !== cands.any &&
        !preferredPool.some((c) => reachableMask![c.r * map.width + c.q] === 1)
          ? cands.any
          : preferredPool;
      const picked = pickFromCandidates(rng, pool, placed, spacing, reachableMask, map.width);
      if (!picked) break;
      placed.push(picked);
      if (placed.length === 1) {
        reachableMask = buildReachableMask(map, picked);
        if (reachableMask) {
          let reachableCands = 0;
          for (const c of cands.any) {
            if (reachableMask[c.r * map.width + c.q]) reachableCands++;
          }
          if (reachableCands < count) {
            const largestMask = findLargestComponentMask(map, cands.any, count);
            if (!largestMask) break;
            reachableMask = largestMask;
            if (!reachableMask[picked.r * map.width + picked.q]) {
              const repicked =
                pickFromCandidates(rng, preferredPool, [], spacing, reachableMask, map.width) ??
                pickFromCandidates(rng, cands.any, [], spacing, reachableMask, map.width);
              if (!repicked) break;
              placed[0] = repicked;
            }
          }
        }
      }
    }

    if (placed.length === count) {
      const castles: PlacedCastle[] = [];
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i];
        const level = levelForIndex(i);
        const ownerId = ownerForIndex(i, opts.playerCount);
        const id = `castle-${level}-${p.q}-${p.r}`;
        castles.push({ id, tile: { q: p.q, r: p.r }, level, ownerId });
      }
      return castles;
    }
  }

  const connectedTiles = findLargestPassableComponentTiles(map);
  if (connectedTiles.length < count) {
    throw new Error(
      `Insufficient connected passable tiles (${connectedTiles.length}) to place ${count} castles`,
    );
  }
  const fallback: PlacedCastle[] = [];
  for (let i = 0; i < count; i++) {
    const level = levelForIndex(i);
    const ownerId = ownerForIndex(i, opts.playerCount);
    const tile = connectedTiles[i];
    const id = `castle-${level}-${tile.q}-${tile.r}`;
    fallback.push({ id, tile: { q: tile.q, r: tile.r }, level, ownerId });
  }
  return fallback;
}

export function deriveCastleSeed(mapSeed: number, override?: number | null): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return override >>> 0;
  }
  return defaultCastleSeedFromMapSeed(mapSeed);
}

export function playerCastle(castles: readonly PlacedCastle[]): PlacedCastle | undefined {
  return castles.find((c) => c.ownerId === 0);
}

export function aiCastle(castles: readonly PlacedCastle[]): PlacedCastle | undefined {
  return castles.find((c) => c.ownerId === 1);
}
