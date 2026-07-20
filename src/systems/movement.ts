import { Axial, hexDistance } from "../core/hex";
import { findPath } from "../map/pathfinding";
import { GameMap } from "../map/gameMap";
import { TERRAIN_COST } from "../map/terrain";
import type { GameState } from "../state/gameState";
import type { TurnController } from "../state/turnController";
import type { Hero } from "../entities/hero";

export interface OnHeroArrivedOptions {
  state: GameState;
  hero: Hero;
  fromTile: Axial;
  toTile: Axial;
  gameMap: GameMap;
  turnController: TurnController;
}

export function onHeroArrived(opts: OnHeroArrivedOptions): GameState {
  const path = findPath(opts.gameMap, opts.fromTile, opts.toTile);
  const cost = computePathCost(opts.gameMap, path);
  const ok = opts.turnController.requestMove(opts.hero.id, opts.toTile, cost);
  if (!ok) {
    console.warn(`[movement] requestMove rejected for hero ${opts.hero.id} → (${opts.toTile.q},${opts.toTile.r}) cost=${cost}`);
    return opts.state;
  }
  opts.hero.fromTile = { ...opts.fromTile };
  opts.hero.toTile = { ...opts.toTile };
  opts.hero.moveProgress = 0;
  opts.hero.moving = true;
  return opts.turnController.getState();
}

function computePathCost(map: GameMap, path: Axial[]): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const t = map.get(path[i].q, path[i].r);
    if (t) cost += TERRAIN_COST[t];
    else cost += Infinity;
  }
  return Number.isFinite(cost) ? cost : 0;
}

export function pathCost(map: GameMap, from: Axial, to: Axial): number {
  return computePathCost(map, findPath(map, from, to));
}

export { hexDistance };
