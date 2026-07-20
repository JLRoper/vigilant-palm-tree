import { Axial, hexDistance } from "../core/hex";
import { findPath } from "../map/pathfinding";
import { GameMap } from "../map/gameMap";
import type { GameState, HeroState } from "../state/gameState";
import { TERRAIN_COST } from "../map/terrain";

export function pickAiWanderTarget(
  state: GameState,
  heroId: string,
  map: GameMap,
  rng: () => number
): { toTile: Axial; cost: number } | null {
  const hero: HeroState | undefined = state.heroes[heroId];
  if (!hero) return null;
  const candidates: Axial[] = [];
  for (let tries = 0; tries < 30; tries++) {
    const q = Math.floor(rng() * map.width);
    const r = Math.floor(rng() * map.height);
    if (!map.isPassable(q, r)) continue;
    if (q === hero.q && r === hero.r) continue;
    candidates.push({ q, r });
    if (candidates.length >= 8) break;
  }
  if (candidates.length === 0) return null;
  let best: Axial | null = null;
  let bestD = -Infinity;
  for (const c of candidates) {
    const d = hexDistance(c, hero);
    if (d >= 3 && d <= 6 && d > bestD) {
      bestD = d;
      best = c;
    }
  }
  if (!best) best = candidates[0];
  const path = findPath(map, hero, best);
  if (path.length === 0) return null;
  const stepCost = (path.length - 1) >= 1 ? (path.length - 1) : 1;
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const t = map.get(path[i].q, path[i].r);
    if (t) cost += TERRAIN_COST[t];
    else cost += stepCost;
  }
  if (cost > hero.movementRemaining) return null;
  return { toTile: best, cost };
}
