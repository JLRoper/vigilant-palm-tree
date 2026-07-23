import { Axial, hexDistance } from "../core/hex";
import { GameMap } from "./gameMap";
import { TERRAIN_COST } from "./terrain";

export const NEIGHBOR_DIRS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function findPath(map: GameMap, start: Axial, goal: Axial, blockedHexes?: Set<string>): Axial[] {
  if (!map.isPassable(goal.q, goal.r)) return [];
  if (start.q === goal.q && start.r === goal.r) return [];

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
      const tentative = (gScore.get(key(current)) ?? Infinity) + map.cost(nq, nr);
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

export function computePathCost(map: GameMap, path: readonly Axial[]): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const t = map.get(path[i].q, path[i].r);
    if (t) cost += TERRAIN_COST[t];
    else cost += Infinity;
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
