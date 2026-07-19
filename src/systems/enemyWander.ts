import { Axial, hexDistance } from "../core/hex";
import { findPath } from "../map/pathfinding";
import { GameMap } from "../map/gameMap";
import { Hero } from "../entities/hero";

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

export function tickEnemyWander(
  map: GameMap,
  enemies: Hero[],
  rng: () => number,
  dtMs: number,
  state: { timer: number; cooldownMs: number }
): void {
  state.timer += dtMs;
  if (state.timer < state.cooldownMs) return;
  state.timer = 0;
  for (const enemy of enemies) {
    if (enemy.moving) continue;
    const target = pickWanderTarget(map, enemy, rng);
    const newPath = findPath(map, enemy.tile, target);
    if (newPath.length >= 2) {
      enemy.startMoveTo(newPath[Math.min(1, newPath.length - 1)]);
    }
  }
}
