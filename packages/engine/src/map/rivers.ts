import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import type { Terrain } from "./terrain";

export type RiverKind = "small" | "wide";

export interface RiverTile {
  q: number;
  r: number;
  kind: RiverKind;
  /** Wide river only: a baked crossing. Small rivers are forded directly. */
  bridge?: boolean;
}

/**
 * Crossing a small river costs a full day: the hero's entire movement budget
 * for the round. With 7 points/round that means a small river can only be
 * entered on a fresh turn with the full tank, exactly the "crossed with a
 * full day turn" rule.
 */
export const RIVER_SMALL_CROSS_COST = MOVEMENT_PER_TURN;

/** Crossing a wide river at a bridge costs a normal step (the bridge negates the river). */
export const RIVER_BRIDGE_CROSS_COST = 1;

/** A wide river gets one bridge roughly every this many cells, plus at least one. */
export const RIVER_BRIDGE_EVERY = 8;

/** Terrains a river may start at or flow into (a "body of water", swamps included). */
export const RIVER_BODY_TERRAINS: ReadonlySet<Terrain> = new Set<Terrain>(["water", "swamp"]);

/** Terrains a river cell never sits on: bodies are endpoints, mountains/thickets are barriers. */
export const RIVER_BLOCKED_TERRAINS: ReadonlySet<Terrain> = new Set<Terrain>([
  "water",
  "mountain",
  "denseForest",
]);

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

/**
 * How many river systems a map gets. 2 on the smallest (24x18), growing with
 * sqrt(area/432) like the terrain blob scaling, capped so titanic maps stay
 * readable rather than a river maze.
 */
export function riverCountForMap(width: number, height: number): number {
  const total = width * height;
  if (!(total > 24 * 18)) return 2;
  return Math.min(10, Math.max(2, Math.round(2 * Math.sqrt(total / (24 * 18)))));
}

/** Minimum river length, in cells, for a map of this size. */
export function minRiverLength(width: number, height: number): number {
  const total = width * height;
  const scaled = Math.round(8 * Math.sqrt(total / (24 * 18)));
  return Math.min(40, Math.max(8, scaled));
}

export function placeRivers(
  rng: () => number,
  tiles: readonly Terrain[],
  width: number,
  height: number,
  scale = true,
): RiverTile[] {
  const count = scale ? riverCountForMap(width, height) : 2;
  if (count <= 0) return [];

  const bodies = findBodies(tiles, width, height);
  if (bodies.cells.length < 2) return [];

  const minLen = minRiverLength(width, height);
  const occupied = new Uint8Array(width * height);
  const placed: RiverTile[] = [];

  for (let i = 0; i < count; i++) {
    const kind: RiverKind = i % 2 === 0 ? "wide" : "small";
    let path: number[] | null = null;
    for (let attempt = 0; attempt < 12 && !path; attempt++) {
      path = traceRiver(rng, tiles, bodies, occupied, width, height, minLen);
    }
    if (!path) {
      // Strict separation already failed; drop that constraint on the last
      // try so later rivers still find a route on crowded maps.
      path = traceRiver(rng, tiles, bodies, occupied, width, height, minLen, false);
    }
    if (!path) continue;
    for (const idx of path) occupied[idx] = 1;
    const riverTiles = path.map((idx) => {
      const q = idx % width;
      const r = (idx / width) | 0;
      return { q, r, kind } satisfies RiverTile;
    });
    if (kind === "wide") bakeBridges(riverTiles, rng);
    placed.push(...riverTiles);
  }

  return placed;
}

interface Bodies {
  /** Union-find root per cell; only meaningful for body cells. */
  root: Int32Array;
  /** Body cells, grouped by body id (parallel to `ids`). */
  cells: number[][];
  /** Body id per body-cell index (parallel to `cells`). */
  ids: number[];
  /** Body id per grid cell, or -1 when the cell is not a body cell. */
  bodyAt: Int32Array;
}

function findBodies(tiles: readonly Terrain[], width: number, height: number): Bodies {
  const total = width * height;
  const parent = new Int32Array(total).fill(-1);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== x) {
      const n = parent[x];
      parent[x] = r;
      x = n;
    }
    return r;
  };
  for (let i = 0; i < total; i++) {
    if (RIVER_BODY_TERRAINS.has(tiles[i])) parent[i] = i;
  }
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      const idx = r * width + q;
      if (parent[idx] !== idx) continue;
      for (const [dq, dr] of DIRS) {
        const nq = q + dq;
        const nr = r + dr;
        if (nq < 0 || nq >= width || nr < 0 || nr >= height) continue;
        const nIdx = nr * width + nq;
        if (parent[nIdx] === -1) continue;
        const a = find(idx);
        const b = find(nIdx);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const groups = new Map<number, number[]>();
  const bodyAt = new Int32Array(total).fill(-1);
  for (let i = 0; i < total; i++) {
    if (parent[i] === -1) continue;
    const root = find(i);
    let g = groups.get(root);
    if (!g) {
      g = [];
      groups.set(root, g);
    }
    g.push(i);
    bodyAt[i] = root;
  }
  const cells: number[][] = [];
  const ids: number[] = [];
  for (const [root, list] of groups) {
    ids.push(root);
    cells.push(list);
  }
  const rootToSlot = new Map<number, number>();
  ids.forEach((root, slot) => rootToSlot.set(root, slot));
  for (let i = 0; i < total; i++) {
    if (bodyAt[i] !== -1) bodyAt[i] = rootToSlot.get(bodyAt[i])!;
  }
  return { root: parent, cells, ids, bodyAt };
}

/**
 * One meander path (as grid indices) from a shore of `source` that ends on a
 * shore of a DIFFERENT body, or null when this attempt fails. The walk is
 * A*-guided: it descends a distance-from-sink field, with a momentum term
 * (U-turns forbidden, soft turns cheap, hard turns pricier), a soft bias for
 * cells that sit on a boundary between two biomes, and a small noise nudge
 * for twist. Disjointness is enforced through `occupied`.
 */
function traceRiver(
  rng: () => number,
  tiles: readonly Terrain[],
  bodies: Bodies,
  occupied: Uint8Array,
  width: number,
  height: number,
  minLen: number,
  strictSeparation = true,
): number[] | null {
  const total = width * height;
  const src = Math.floor(rng() * bodies.cells.length);
  const source = bodies.cells[src];
  if (!source) return null;

  const sinkCandidates = bodies.cells
    .map((cells, i) => ({ cells, i }))
    .filter((b) => b.i !== src);
  if (sinkCandidates.length === 0) return null;
  // Bias toward a sink that is plausibly across the map rather than the
  // nearest puddle, without hard-coding distance.
  const sink = sinkCandidates[Math.floor(rng() * sinkCandidates.length)];
  const sinkId = sink.i;

  // Distance-from-sink over passable, non-body cells (this is the guidance field).
  const costToSink = new Int32Array(total).fill(-1);
  {
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    for (const idx of sink.cells) {
      costToSink[idx] = 0;
      queue[tail++] = idx;
    }
    while (head < tail) {
      const cur = queue[head++];
      const cq = cur % width;
      const cr = (cur / width) | 0;
      const c = costToSink[cur];
      for (let d = 0; d < 6; d++) {
        const nq = cq + DIRS[d][0];
        const nr = cr + DIRS[d][1];
        if (nq < 0 || nq >= width || nr < 0 || nr >= height) continue;
        const nIdx = nr * width + nq;
        if (costToSink[nIdx] !== -1) continue;
        if (bodies.bodyAt[nIdx] !== -1) continue;
        if (RIVER_BLOCKED_TERRAINS.has(tiles[nIdx])) continue;
        costToSink[nIdx] = c + 1;
        queue[tail++] = nIdx;
      }
    }
  }

  const river = bodies.bodyAt;
  const start = pickStart(rng, tiles, bodies, occupied, width, height, source, costToSink);
  if (start === null) return null;

  const path: number[] = [start];
  const visited = new Uint8Array(total);
  visited[start] = 1;
  let lastDir = -1;
  let reachedSink = false;
  const maxSteps = Math.min(total, minLen * 4 + 24);

  const adjacentToSink = (idx: number): boolean => {
    const q = idx % width;
    const r = (idx / width) | 0;
    for (let d = 0; d < 6; d++) {
      const nq = q + DIRS[d][0];
      const nr = r + DIRS[d][1];
      if (nq < 0 || nq >= width || nr < 0 || nr >= height) continue;
      if (river[nr * width + nq] === sinkId) return true;
    }
    return false;
  };

  while (path.length < maxSteps) {
    const cur = path[path.length - 1];

    // Reached the sink: stop on the bank adjacent to it (once long enough).
    if (path.length >= minLen && adjacentToSink(cur)) {
      reachedSink = true;
      break;
    }

    const cq = cur % width;
    const cr = (cur / width) | 0;
    let best = -1;
    let bestScore = Infinity;
    for (let d = 0; d < 6; d++) {
      if (lastDir !== -1 && (d + 3) % 6 === lastDir) continue; // no U-turns
      const nq = cq + DIRS[d][0];
      const nr = cr + DIRS[d][1];
      if (nq < 0 || nq >= width || nr < 0 || nr >= height) continue;
      const nIdx = nr * width + nq;
      if (occupied[nIdx] || visited[nIdx] || river[nIdx] !== -1) continue;
      if (RIVER_BLOCKED_TERRAINS.has(tiles[nIdx])) continue;
      const c = costToSink[nIdx];
      if (c === -1) continue;

      // Never let the river knot onto itself: a candidate that already touches
      // two visited cells would fatten or spiral the line.
      let selfTouch = 0;
      let tooClose = false;
      for (let k = 0; k < 6; k++) {
        const tq = nq + DIRS[k][0];
        const tr = nr + DIRS[k][1];
        if (tq < 0 || tq >= width || tr < 0 || tr >= height) continue;
        const ti = tr * width + tq;
        if (visited[ti]) selfTouch++;
        // Keep later rivers clear of earlier ones: a cell touching another
        // river cell would draw two parallel lines as one blob. The relaxed
        // final attempt skips this so late rivers can still find a route.
        if (strictSeparation && occupied[ti]) tooClose = true;
      }
      if (selfTouch >= 2) continue;
      if (tooClose) continue;

      const turn = lastDir === -1 ? 0 : Math.min((d - lastDir + 6) % 6, (lastDir - d + 6) % 6);
      const turnPenalty = turn === 0 ? -0.4 : turn === 1 ? 0.6 : 3.0;
      const boundary = boundaryBonus(tiles, width, height, nq, nr) ? -0.7 : 0;
      const score = c + turnPenalty + boundary + rng() * 1.6;
      if (score < bestScore) {
        bestScore = score;
        best = d;
      }
    }
    if (best === -1) break; // boxed in
    lastDir = best;
    const nIdx = (cr + DIRS[best][1]) * width + (cq + DIRS[best][0]);
    visited[nIdx] = 1;
    path.push(nIdx);
  }

  return reachedSink && path.length >= minLen ? path : null;
}

function pickStart(
  rng: () => number,
  tiles: readonly Terrain[],
  bodies: Bodies,
  occupied: Uint8Array,
  width: number,
  height: number,
  source: number[],
  costToSink: Int32Array,
): number | null {
  const starts: number[] = [];
  const seen = new Set<number>();
  for (const idx of source) {
    const q = idx % width;
    const r = (idx / width) | 0;
    for (const [dq, dr] of DIRS) {
      const nq = q + dq;
      const nr = r + dr;
      if (nq < 0 || nq >= width || nr < 0 || nr >= height) continue;
      const nIdx = nr * width + nq;
      if (seen.has(nIdx)) continue;
      seen.add(nIdx);
      if (bodies.bodyAt[nIdx] !== -1) continue;
      if (occupied[nIdx]) continue;
      if (RIVER_BLOCKED_TERRAINS.has(tiles[nIdx])) continue;
      if (costToSink[nIdx] === -1) continue;
      starts.push(nIdx);
    }
  }
  if (starts.length === 0) return null;
  return starts[Math.floor(rng() * starts.length)];
}

/** Slight preference for cells that lie on a seam between two or more biomes. */
function boundaryBonus(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  q: number,
  r: number,
): boolean {
  const seen = new Set<Terrain>();
  for (const [dq, dr] of DIRS) {
    const nq = q + dq;
    const nr = r + dr;
    if (nq < 0 || nq >= width || nr < 0 || nr >= height) continue;
    seen.add(tiles[nr * width + nq]);
  }
  return seen.size >= 3;
}

/**
 * Bakes bridges onto a wide river: roughly one every RIVER_BRIDGE_EVERY cells,
 * preferring straight segments (where the river passes straight through) so a
 * bridge reads as an actual crossing. Always places at least one.
 */
function bakeBridges(riverTiles: RiverTile[], rng: () => number): void {
  if (riverTiles.length === 0) return;
  // Keep at least two cells of plain water at each end so a bridge never
  // sits where the river pours into its lake.
  const first = 2;
  const last = riverTiles.length - 3;
  const straight: number[] = [];
  for (let i = first; i <= last; i++) {
    const prev = riverTiles[i - 1];
    const next = riverTiles[i + 1];
    if (prev.q === next.q || prev.r === next.r) straight.push(i);
  }
  const want = Math.max(1, Math.floor(riverTiles.length / RIVER_BRIDGE_EVERY));
  let placedCount = 0;
  const choose = (pool: number[]): void => {
    if (pool.length === 0) return;
    const step = Math.max(1, Math.floor(pool.length / want));
    for (let k = 0; k < pool.length && placedCount < want; k += step) {
      const i = pool[Math.min(pool.length - 1, k + Math.floor(rng() * step))];
      if (riverTiles[i].bridge) continue;
      riverTiles[i] = { ...riverTiles[i], bridge: true };
      placedCount++;
    }
  };
  choose(straight);
  if (placedCount < want) {
    const middle = riverTiles
      .map((_, i) => i)
      .filter((i) => i >= first && i <= last && !riverTiles[i].bridge);
    choose(middle);
  }
}