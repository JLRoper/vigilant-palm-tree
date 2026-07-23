import { mulberry32 } from "../core/rng";
import { Castle, CastleLevel } from "../entities/settlement";
import { GameMap } from "./gameMap";
import { isPassable } from "./terrain";

export const CASTLE_COUNT_MIN = 4;
export const CASTLE_COUNT_MAX = 7;
export const CASTLE_COUNT_DEFAULT = 4;

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

function pickFromCandidates(
  rng: () => number,
  pool: CandidateTile[],
  placed: CandidateTile[],
  minSpacing: number,
): CandidateTile | null {
  for (let attempt = 0; attempt < 64; attempt++) {
    if (pool.length === 0) return null;
    const idx = Math.floor(rng() * pool.length);
    const cand = pool[idx];
    let ok = true;
    for (const p of placed) {
      const dq = Math.abs(p.q - cand.q);
      const dr = Math.abs(p.r - cand.r);
      const ds = Math.abs(p.q + p.r - cand.q - cand.r);
      const dist = (dq + dr + ds) / 2;
      if (dist < minSpacing) {
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

export function clampCastleCount(n: number): number {
  if (!Number.isFinite(n)) return CASTLE_COUNT_DEFAULT;
  const i = Math.floor(n);
  if (i < CASTLE_COUNT_MIN) return CASTLE_COUNT_MIN;
  if (i > CASTLE_COUNT_MAX) return CASTLE_COUNT_MAX;
  return i;
}

export function defaultCastleSeedFromMapSeed(mapSeed: number): number {
  return ((mapSeed ^ 0x63617374) >>> 0) || 1;
}

export function generateCastles(
  map: GameMap,
  opts: CastlePlacementOptions,
): Castle[] {
  const count = clampCastleCount(opts.castleCount);
  const seed = opts.castleSeed >>> 0;
  const rng = mulberry32(seed || 1);

  const cands = listCandidates(map);

  for (let spacing = MIN_CASTLE_SPACING; spacing >= 0; spacing--) {
    const placed: CandidateTile[] = [];
    const order: ("left" | "right" | "any")[] = ["left", "right", "any", "any", "any"];

    for (let i = 0; i < count; i++) {
      const which = order[i] ?? "any";
      const pool = which === "left" ? cands.left : which === "right" ? cands.right : cands.any;
      const picked = pickFromCandidates(rng, pool, placed, spacing);
      if (!picked) break;
      placed.push(picked);
    }

    if (placed.length === count) {
      const castles: Castle[] = [];
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i];
        const level = levelForIndex(i);
        const ownerId = ownerForIndex(i, opts.playerCount);
        const id = `castle-${level}-${p.q}-${p.r}`;
        castles.push(
          new Castle(id, { q: p.q, r: p.r }, level, ownerId, id, 0, 0, {}, null),
        );
      }
      return castles;
    }
  }

  const fallback: Castle[] = [];
  for (let i = 0; i < count; i++) {
    const level = levelForIndex(i);
    const ownerId = ownerForIndex(i, opts.playerCount);
    const q = i % map.width;
    const r = Math.floor(i / map.width);
    const id = `castle-${level}-${q}-${r}`;
    fallback.push(new Castle(id, { q, r }, level, ownerId, id, 0, 0, {}, null));
  }
  return fallback;
}

export function deriveCastleSeed(mapSeed: number, override?: number | null): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return override >>> 0;
  }
  return defaultCastleSeedFromMapSeed(mapSeed);
}

export function playerCastle(castles: readonly Castle[]): Castle | undefined {
  return castles.find((c) => c.ownerId === 0);
}

export function aiCastle(castles: readonly Castle[]): Castle | undefined {
  return castles.find((c) => c.ownerId === 1);
}
