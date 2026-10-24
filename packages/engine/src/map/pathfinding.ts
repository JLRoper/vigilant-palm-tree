import type { Axial } from "@heroes/contracts";
import type { GameMap } from "./gameMap";
import { NEIGHBOR_DIRS } from "./directions";

export { NEIGHBOR_DIRS };

// Moved from src/map/pathfinding.ts (which now re-exports this module) so
// server-side trade-route caravans (docs/wagons-stockpiles-trade-routes-plan.md
// §5.2) can A* on the deterministic rebuilt GameMap -- the engine package
// cannot import from the client tree.

const DQ = [1, 1, 0, -1, -1, 0];
const DR = [0, -1, -1, 0, 1, 1];

let poolCap = 0;
let gScoreBuf = new Float64Array(0);
let fScoreBuf = new Float64Array(0);
let cameFromBuf = new Int32Array(0);
let seenGenBuf = new Uint32Array(0);
let closedGenBuf = new Uint32Array(0);
let blockedGenBuf = new Uint32Array(0);
let pushSeqBuf = new Uint32Array(0);
let heapNodesBuf = new Int32Array(0);
let heapPosBuf = new Int32Array(0);
let searchGen = 0;

function ensureBuffers(size: number): void {
  if (size <= poolCap) return;
  poolCap = size;
  gScoreBuf = new Float64Array(size);
  fScoreBuf = new Float64Array(size);
  cameFromBuf = new Int32Array(size);
  seenGenBuf = new Uint32Array(size);
  closedGenBuf = new Uint32Array(size);
  blockedGenBuf = new Uint32Array(size);
  pushSeqBuf = new Uint32Array(size);
  heapNodesBuf = new Int32Array(size);
  heapPosBuf = new Int32Array(size);
  heapPosBuf.fill(-1);
}

export function hexDistance(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

/**
 * Road-building side action (faction-construction plan, section 7): a paved
 * tile costs this fraction of its normal movement cost for ANY unit (hero,
 * Construction Worker, caravan) crossing it afterward. Backward compatible
 * by construction -- `roadedTiles` is an optional extra parameter that
 * defaults to "no tile is roaded", so every existing findPath caller is
 * byte-identical. The roaded-tile set itself is not persisted anywhere by
 * this engine-only building block (see settlement/workerTransit.ts's header
 * comment for the scope this shipped at).
 */
export const ROAD_COST_MULTIPLIER = 0.5;

function roadedCost(map: GameMap, q: number, r: number, roadedTiles?: ReadonlySet<string>): number {
  const base = map.cost(q, r);
  if (!roadedTiles || roadedTiles.size === 0) return base;
  return roadedTiles.has(`${q},${r}`) ? base * ROAD_COST_MULTIPLIER : base;
}

export function findPath(
  map: GameMap,
  start: Axial,
  goal: Axial,
  blockedHexes?: Set<string>,
  roadedTiles?: ReadonlySet<string>,
): Axial[] {
  if (start.q === goal.q && start.r === goal.r) return [];
  if (!map.isPassable(goal.q, goal.r)) return [];
  if (blockedHexes?.has(`${goal.q},${goal.r}`)) return [];

  const width = map.width;
  const height = map.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return findPathUnbounded(map, start, goal, blockedHexes, roadedTiles);
  }
  if (
    start.q < 0 ||
    start.q >= width ||
    start.r < 0 ||
    start.r >= height ||
    goal.q < 0 ||
    goal.q >= width ||
    goal.r < 0 ||
    goal.r >= height
  ) {
    return [];
  }

  // Precomputed once, outside the hot neighbor-relaxation loop below, so
  // the overwhelmingly common case (no roadedTiles argument at all) adds
  // zero per-edge overhead: `hasRoads && roadedTiles.has(...)` short-circuits
  // without ever building the tile-key string or calling .has().
  const hasRoads = !!roadedTiles && roadedTiles.size > 0;

  ensureBuffers(width * height);
  searchGen = (searchGen + 1) >>> 0;
  if (searchGen === 0) {
    seenGenBuf.fill(0);
    closedGenBuf.fill(0);
    blockedGenBuf.fill(0);
    searchGen = 1;
  }
  const gen = searchGen;

  const startIdx = start.r * width + start.q;
  const goalIdx = goal.r * width + goal.q;

  if (blockedHexes && blockedHexes.size > 0) {
    for (const key of blockedHexes) {
      const comma = key.indexOf(",");
      if (comma <= 0) continue;
      const bq = Number(key.slice(0, comma));
      const br = Number(key.slice(comma + 1));
      if (bq >= 0 && bq < width && br >= 0 && br < height) {
        const bIdx = br * width + bq;
        if (bIdx !== startIdx) blockedGenBuf[bIdx] = gen;
      }
    }
  }

  let heapSize = 0;
  let seq = 0;

  const heapLess = (a: number, b: number): boolean => {
    const fa = fScoreBuf[a];
    const fb = fScoreBuf[b];
    return fa < fb || (fa === fb && pushSeqBuf[a] < pushSeqBuf[b]);
  };

  const heapBubbleUp = (pos: number): void => {
    const node = heapNodesBuf[pos];
    while (pos > 0) {
      const parentPos = (pos - 1) >> 1;
      const parentNode = heapNodesBuf[parentPos];
      if (!heapLess(node, parentNode)) break;
      heapNodesBuf[pos] = parentNode;
      heapPosBuf[parentNode] = pos;
      pos = parentPos;
    }
    heapNodesBuf[pos] = node;
    heapPosBuf[node] = pos;
  };

  const heapSinkDown = (pos: number): void => {
    const node = heapNodesBuf[pos];
    const half = heapSize >> 1;
    while (pos < half) {
      let left = (pos << 1) + 1;
      let bestChild = heapNodesBuf[left];
      const right = left + 1;
      if (right < heapSize) {
        const rightChild = heapNodesBuf[right];
        if (heapLess(rightChild, bestChild)) {
          left = right;
          bestChild = rightChild;
        }
      }
      if (!heapLess(bestChild, node)) break;
      heapNodesBuf[pos] = bestChild;
      heapPosBuf[bestChild] = pos;
      pos = left;
    }
    heapNodesBuf[pos] = node;
    heapPosBuf[node] = pos;
  };

  const heapPush = (node: number): void => {
    const pos = heapSize++;
    heapNodesBuf[pos] = node;
    heapPosBuf[node] = pos;
    heapBubbleUp(pos);
  };

  const heapPop = (): number => {
    const top = heapNodesBuf[0];
    heapPosBuf[top] = -1;
    heapSize--;
    if (heapSize > 0) {
      const last = heapNodesBuf[heapSize];
      heapNodesBuf[0] = last;
      heapPosBuf[last] = 0;
      heapSinkDown(0);
    }
    return top;
  };

  seenGenBuf[startIdx] = gen;
  cameFromBuf[startIdx] = -1;
  gScoreBuf[startIdx] = 0;
  fScoreBuf[startIdx] = hexDistance(start, goal);
  pushSeqBuf[startIdx] = seq++;
  heapPush(startIdx);

  while (heapSize > 0) {
    const currentIdx = heapPop();
    if (currentIdx === goalIdx) {
      const path: Axial[] = [];
      let cur = goalIdx;
      while (cur !== startIdx) {
        path.push({ q: cur % width, r: (cur / width) | 0 });
        cur = cameFromBuf[cur];
        if (cur < 0) return [];
      }
      path.reverse();
      return path;
    }

    closedGenBuf[currentIdx] = gen;
    const cq = currentIdx % width;
    const cr = (currentIdx / width) | 0;
    const cg = gScoreBuf[currentIdx];

    for (let d = 0; d < 6; d++) {
      const nq = cq + DQ[d];
      const nr = cr + DR[d];
      if (nq < 0 || nq >= width || nr < 0 || nr >= height) continue;
      const nIdx = nr * width + nq;
      if (closedGenBuf[nIdx] === gen) continue;
      if (blockedGenBuf[nIdx] === gen) continue;
      if (!map.isPassable(nq, nr)) continue;

      const edgeCost = map.cost(nq, nr);
      const tentative =
        cg + (hasRoads && roadedTiles!.has(`${nq},${nr}`) ? edgeCost * ROAD_COST_MULTIPLIER : edgeCost);
      const isSeen = seenGenBuf[nIdx] === gen;
      if (!isSeen || tentative < gScoreBuf[nIdx]) {
        cameFromBuf[nIdx] = currentIdx;
        gScoreBuf[nIdx] = tentative;
        const dq = nq - goal.q;
        const dr = nr - goal.r;
        const h = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) * 0.5;
        fScoreBuf[nIdx] = tentative + h;
        if (!isSeen) {
          seenGenBuf[nIdx] = gen;
          pushSeqBuf[nIdx] = seq++;
          heapPush(nIdx);
        } else {
          heapBubbleUp(heapPosBuf[nIdx]);
        }
      }
    }
  }

  return [];
}

function findPathUnbounded(
  map: GameMap,
  start: Axial,
  goal: Axial,
  blockedHexes?: Set<string>,
  roadedTiles?: ReadonlySet<string>,
): Axial[] {
  const key = (a: Axial) => `${a.q},${a.r}`;
  const open: Axial[] = [start];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  gScore.set(key(start), 0);
  fScore.set(key(start), hexDistance(start, goal));

  while (open.length > 0) {
    let bestIdx = 0;
    let bestF = Infinity;
    for (let i = 0; i < open.length; i++) {
      const f = fScore.get(key(open[i])) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        bestIdx = i;
      }
    }
    const current = open.splice(bestIdx, 1)[0];
    if (current.q === goal.q && current.r === goal.r) {
      return reconstruct(cameFrom, current);
    }

    for (const dir of NEIGHBOR_DIRS) {
      const nq = current.q + dir.q;
      const nr = current.r + dir.r;
      if (!map.isPassable(nq, nr)) continue;
      const nKey = `${nq},${nr}`;
      if (blockedHexes?.has(nKey)) continue;
      const tentative = (gScore.get(key(current)) ?? Infinity) + roadedCost(map, nq, nr, roadedTiles);
      if (tentative < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, key(current));
        gScore.set(nKey, tentative);
        fScore.set(nKey, tentative + hexDistance({ q: nq, r: nr }, goal));
        if (!open.some((o) => o.q === nq && o.r === nr)) {
          open.push({ q: nq, r: nr });
        }
      }
    }
  }

  return [];
}

export function computePathCost(map: GameMap, path: readonly Axial[], roadedTiles?: ReadonlySet<string>): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const c = roadedCost(map, path[i].q, path[i].r, roadedTiles);
    cost += Number.isFinite(c) ? c : Infinity;
  }
  return Number.isFinite(cost) ? cost : 0;
}

function reconstruct(cameFrom: Map<string, string>, end: Axial): Axial[] {
  const path: Axial[] = [end];
  let cur = `${end.q},${end.r}`;
  while (cameFrom.has(cur)) {
    const prev = cameFrom.get(cur)!;
    const [q, r] = prev.split(",").map(Number);
    path.unshift({ q, r });
    cur = prev;
  }
  return path.slice(1);
}
