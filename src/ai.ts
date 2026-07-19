import { Axial, hexDistance } from "./hex";
import { findPath } from "./pathfinding";
import { GameMap } from "./renderer";
import { Hero } from "./hero";

export function planEnemyMove(
  map: GameMap,
  enemy: Hero,
  target: Axial
): Axial[] {
  return findPath(map, enemy.tile, target);
}

export function pickWanderTarget(map: GameMap, enemy: Hero, rng: () => number): Axial {
  const candidates: Axial[] = [];
  for (let tries = 0; tries < 30; tries++) {
    const q = Math.floor(rng() * map.width);
    const r = Math.floor(rng() * map.height);
    if (!map.isPassable(q, r)) continue;
    if (q === enemy.tile.q && r === enemy.tile.r) continue;
    candidates.push({ q, r });
    if (candidates.length >= 8) break;
  }
  if (candidates.length === 0) return enemy.tile;
  let best = candidates[0];
  let bestD = -Infinity;
  for (const c of candidates) {
    const d = hexDistance(c, enemy.tile);
    if (d > bestD && d >= 3 && d <= 6) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
