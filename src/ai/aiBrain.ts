import { Axial, hexDistance } from "../core/hex";
import { findPath, NEIGHBOR_DIRS } from "../map/pathfinding";
import { GameMap } from "../map/gameMap";
import type { GameState, HeroState } from "@heroes/contracts";
import { platoonTroopTotal, platoonsHaveTroops, settlementStacks } from "@heroes/engine";
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

  const blocked = new Set<string>();
  for (const [id, other] of Object.entries(state.heroes)) {
    if (id === heroId) continue;
    blocked.add(`${other.q},${other.r}`);
  }
  for (const s of Object.values(state.settlements)) {
    if (s.ownerId !== hero.ownerId && platoonsHaveTroops(settlementStacks(s))) {
      blocked.add(`${s.q},${s.r}`);
    }
  }

  const targets: Target[] = [];

  for (const [otherId, otherHero] of Object.entries(state.heroes)) {
    if (otherId === heroId) continue;
    if (otherHero.ownerId === hero.ownerId) continue;
    if (platoonTroopTotal(otherHero.stacks) === 0) continue;
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
    const step =
      target.kind === "enemy"
        ? stepTowardEnemy(hero, target.tile, map, blocked)
        : stepToward(hero, target.tile, map, blocked);
    if (step) return step;
  }

  return pickWanderStep(hero, map, rng, blocked);
}

function firstStepCost(hero: HeroState, map: GameMap, firstStep: Axial): AiMove | null {
  const t = map.get(firstStep.q, firstStep.r);
  if (!t) return null;
  const cost = TERRAIN_COST[t];
  if (cost === Infinity || cost <= 0) return null;
  if (cost > hero.movementRemaining) return null;
  return { toTile: firstStep, cost };
}

function stepToward(hero: HeroState, dest: Axial, map: GameMap, blocked?: Set<string>): AiMove | null {
  // findPath() omits the start node: path[0] is the FIRST hex step, the
  // destination is last.
  const path = findPath(map, hero, dest, blocked);
  if (path.length === 0) return null;
  return firstStepCost(hero, map, path[0]);
}

// The engine forbids moving onto any hero, and a battle only ever starts
// from the post-move detectAdjacentEnemy() check (same as the human attack
// flow). So an enemy target must resolve to a step that ends BESIDE the
// enemy: while approaching, that is the natural first path step; from an
// already-adjacent hex the hero repositions to another free tile beside the
// enemy so the move succeeds and the adjacency check fires, instead of the
// move being rejected as "occupied". The enemy's own tile must stay a legal
// A* goal, so it is un-blocked for the approach path only.
function stepTowardEnemy(hero: HeroState, dest: Axial, map: GameMap, blocked: Set<string>): AiMove | null {
  const approachBlocked = new Set(blocked);
  approachBlocked.delete(`${dest.q},${dest.r}`);
  const path = findPath(map, hero, dest, approachBlocked);
  if (path.length === 0) return null;
  const firstStep = path[0];
  if (firstStep.q === dest.q && firstStep.r === dest.r) {
    for (const dir of NEIGHBOR_DIRS) {
      const nq = dest.q + dir.q;
      const nr = dest.r + dir.r;
      if (nq === hero.q && nr === hero.r) continue;
      if (blocked.has(`${nq},${nr}`)) continue;
      const step = stepToward(hero, { q: nq, r: nr }, map, blocked);
      if (step) return step;
    }
    return null;
  }
  return firstStepCost(hero, map, firstStep);
}

function pickWanderStep(
  hero: HeroState,
  map: GameMap,
  rng: () => number,
  blocked: Set<string>,
): AiMove | null {
  let bestStep: AiMove | null = null;
  let bestDist = -1;
  for (let tries = 0; tries < 20; tries++) {
    const q = Math.floor(rng() * map.width);
    const r = Math.floor(rng() * map.height);
    if (!map.isPassable(q, r)) continue;
    if (q === hero.q && r === hero.r) continue;
    const step = stepToward(hero, { q, r }, map, blocked);
    if (!step) continue;
    const d = hexDistance(step.toTile, hero);
    if (d > bestDist) {
      bestDist = d;
      bestStep = step;
    }
  }
  return bestStep;
}
