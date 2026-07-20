import { Axial, hexDistance } from "../core/hex";
import { findPath } from "../map/pathfinding";
import { GameMap } from "../map/gameMap";
import type { GameState, HeroState } from "../state/gameState";
import { TERRAIN_COST } from "../map/terrain";

export interface AiMove {
  toTile: Axial;
  cost: number;
}

type TargetKind = "enemy" | "neutral_settlement" | "resource" | "wander";

interface Target {
  kind: TargetKind;
  tile: Axial;
  priority: number;
}

const ENEMY_REACH = 7;
const SETTLEMENT_REACH = 8;
const RESOURCE_REACH = 8;
const SETTLEMENT_RESOURCE_BUFFER = 2;

export function pickAiMove(
  state: GameState,
  heroId: string,
  map: GameMap,
  rng: () => number,
): AiMove | null {
  const hero = state.heroes[heroId];
  if (!hero) return null;
  if (hero.movementRemaining <= 0) return null;

  const targets: Target[] = [];

  for (const [otherId, otherHero] of Object.entries(state.heroes)) {
    if (otherId === heroId) continue;
    if (otherHero.ownerId === hero.ownerId) continue;
    const dist = hexDistance(hero, otherHero);
    if (dist > ENEMY_REACH) continue;
    targets.push({ kind: "enemy", tile: { q: otherHero.q, r: otherHero.r }, priority: 1000 - dist * 10 });
  }

  for (const s of Object.values(state.settlements)) {
    if (s.ownerId !== null) continue;
    const dist = hexDistance(hero, s);
    if (dist > SETTLEMENT_REACH) continue;
    targets.push({ kind: "neutral_settlement", tile: { q: s.q, r: s.r }, priority: 600 - dist * 5 });
  }

  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (!map.resourceTileAt(q, r)) continue;
      let nearOwnedSettlement = false;
      for (const s of Object.values(state.settlements)) {
        if (s.ownerId === null) continue;
        if (hexDistance(s, { q, r }) <= SETTLEMENT_RESOURCE_BUFFER) {
          nearOwnedSettlement = true;
          break;
        }
      }
      if (nearOwnedSettlement) continue;
      const dist = hexDistance(hero, { q, r });
      if (dist > RESOURCE_REACH) continue;
      targets.push({ kind: "resource", tile: { q, r }, priority: 300 - dist * 3 });
    }
  }

  targets.sort((a, b) => b.priority - a.priority);

  for (const target of targets) {
    const step = stepToward(hero, target.tile, map);
    if (step) return step;
  }

  return pickWanderStep(hero, map, rng);
}

function stepToward(hero: HeroState, dest: Axial, map: GameMap): AiMove | null {
  const path = findPath(map, hero, dest);
  if (path.length < 2) return null;
  const firstStep = path[1];
  const t = map.get(firstStep.q, firstStep.r);
  if (!t) return null;
  const cost = TERRAIN_COST[t];
  if (cost === Infinity || cost <= 0) return null;
  if (cost > hero.movementRemaining) return null;
  return { toTile: firstStep, cost };
}

function pickWanderStep(hero: HeroState, map: GameMap, rng: () => number): AiMove | null {
  let bestStep: AiMove | null = null;
  let bestDist = -1;
  for (let tries = 0; tries < 20; tries++) {
    const q = Math.floor(rng() * map.width);
    const r = Math.floor(rng() * map.height);
    if (!map.isPassable(q, r)) continue;
    if (q === hero.q && r === hero.r) continue;
    const step = stepToward(hero, { q, r }, map);
    if (!step) continue;
    const d = hexDistance(step.toTile, hero);
    if (d > bestDist) {
      bestDist = d;
      bestStep = step;
    }
  }
  return bestStep;
}
