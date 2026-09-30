import { Axial, hexDistance } from "../core/hex";
import { findPath, NEIGHBOR_DIRS } from "../map/pathfinding";
import { GameMap } from "../map/gameMap";
import type { BuildingKind, GameState, HeroState, SettlementState } from "@heroes/contracts";
import {
  depositIntoGarrison,
  eligibleRecruitSources,
  platoonPower,
  platoonTroopTotal,
  settlementStacks,
  unitPower,
  type RecruitSource,
  type UnitType,
} from "@heroes/engine";
import { TERRAIN_COST } from "../map/terrain";

export interface AiMove {
  toTile: Axial;
  cost: number;
}

type TargetKind = "enemy" | "garrisoned_settlement" | "enemy_settlement" | "neutral_settlement" | "resource" | "wander";

interface Target {
  kind: TargetKind;
  tile: Axial;
  priority: number;
}

const ENEMY_REACH = 7;
const SETTLEMENT_REACH = 8;
const RESOURCE_REACH = 8;
const SETTLEMENT_RESOURCE_BUFFER = 2;

// Target priority bands (higher wins; ties break by distance decay). Enemy
// heroes stay the top band; the settlement bands sit between heroes and
// resources so the AI prefers fights it can win over empty expansion, and
// empty expansion over resource pickups. Decay is per hex of straight-line
// distance inside each band.
const GARRISON_ATTACK_RATIO = 1.5;
const GARRISONED_SETTLEMENT_PRIORITY = 700;
const ENEMY_SETTLEMENT_PRIORITY = 650;
const NEUTRAL_SETTLEMENT_PRIORITY = 600;
const SETTLEMENT_PRIORITY_DECAY = 5;

// The AI attacks a non-owned garrisoned settlement (enemy-owned or neutral)
// when its army power is at least this multiple of the garrison's; weaker
// armies treat the garrison as a path obstacle and route around it. Power
// weights each unit by catalog stats (attack + defence, see engine
// unitPower), so quality counts — an unknown unit (no catalog yet) weighs
// like baseline troops, which degrades the ratio exactly to the old
// troop-count comparison.
function attackerBeatsGarrison(attackerPower: number, garrison: SettlementState, unitTypes: Record<string, UnitType>): boolean {
  return attackerPower >= GARRISON_ATTACK_RATIO * platoonPower(settlementStacks(garrison), unitTypes);
}

// After a bounced (lost or drawn) garrison assault the AI leaves the
// settlement alone for this many rounds — recorded round R means rounds R
// and R+1 are excluded, and the hero may re-attack in round R + value. The
// expiry source is GameState.round (advanced by the engine's advanceRound
// on every round wrap); the entries live in an in-memory map on the primary
// client's TurnController.
export const GARRISON_BACKOFF_ROUNDS = 2;

export interface GarrisonRecruitment {
  settlementId: string;
  buildingKind: BuildingKind;
  gx: number;
  gy: number;
  unitTypeId: string;
  count: number;
}

// Enemy heroes within this straight-line reach of a settlement count toward
// its threat level (same reach style as the target bands above; path-cost
// reach is plan item I2).
const GARRISON_THREAT_REACH = 8;
// Target garrison power = ratio x nearby threat power...
const GARRISON_TARGET_RATIO = 1.0;
// ...but never below this floor, so unthreatened towns still grow a
// skeleton garrison (two baseline-strength units).
const GARRISON_POWER_FLOOR = 4;
// Never spend a settlement below this much gold (no AI-consumption
// precedent exists in applyGarrisonUpkeep/economy, so this is a named
// constant floor).
const GARRISON_GOLD_RESERVE = 100;

// B1 (plan/2026-09-29-settlement-battle-followups.md): for every settlement
// the seat owns that has no hero standing on it, size a garrison against the
// total power of enemy heroes in reach and buy the best power-per-gold
// recruitable units the engine's own eligibility gate admits (see
// eligibleRecruitSources — the same building/construction/minLevel gating
// recruitUnits enforces), limited by the gold reserve, warehouse resources,
// and the engine's garrison deposit cap. Pure and deterministic: no clock,
// no randomness, stable tie-breaks.
export function pickGarrisonRecruitment(
  state: GameState,
  seat: number,
  unitTypes: Record<string, UnitType> = {},
): GarrisonRecruitment[] {
  const out: GarrisonRecruitment[] = [];
  for (const [settlementId, settlement] of Object.entries(state.settlements)) {
    if (settlement.ownerId !== seat) continue;
    if (heroStandsOn(state, settlement)) continue;
    const threat = settlementThreat(state, settlement, seat, unitTypes);
    const targetPower = Math.max(GARRISON_POWER_FLOOR, GARRISON_TARGET_RATIO * threat);
    const deficit = targetPower - platoonPower(settlementStacks(settlement), unitTypes);
    if (deficit <= 0) continue;
    out.push(...garrisonPurchases(settlement, settlementId, deficit, unitTypes));
  }
  return out;
}

function heroStandsOn(state: GameState, settlement: SettlementState): boolean {
  for (const hero of Object.values(state.heroes)) {
    if (hero.q === settlement.q && hero.r === settlement.r) return true;
  }
  return false;
}

function settlementThreat(
  state: GameState,
  settlement: SettlementState,
  seat: number,
  unitTypes: Record<string, UnitType>,
): number {
  let threat = 0;
  for (const hero of Object.values(state.heroes)) {
    if (hero.ownerId === seat) continue;
    if (hexDistance(hero, settlement) > GARRISON_THREAT_REACH) continue;
    threat += platoonPower(hero.stacks, unitTypes);
  }
  return threat;
}

function garrisonPurchases(
  settlement: SettlementState,
  settlementId: string,
  deficit: number,
  unitTypes: Record<string, UnitType>,
): GarrisonRecruitment[] {
  const candidates = eligibleRecruitSources(settlement)
    .filter((source) => source.entry.goldCost > 0)
    .sort(
      (a, b) =>
        powerPerGold(b, unitTypes) - powerPerGold(a, unitTypes) ||
        b.entry.goldCost - a.entry.goldCost ||
        (a.entry.unitTypeId < b.entry.unitTypeId ? -1 : 1),
    );
  let gold = settlement.gold - GARRISON_GOLD_RESERVE;
  const warehouse = { ...settlement.warehouse };
  let workingStacks = settlementStacks(settlement);
  let remaining = deficit;
  const out: GarrisonRecruitment[] = [];
  for (const source of candidates) {
    if (remaining <= 0) break;
    if (gold < source.entry.goldCost) continue;
    const deposit = depositIntoGarrison(workingStacks, source.entry.unitTypeId, 1);
    if (!deposit.ok) continue;
    const power = unitPower(unitTypes[source.entry.unitTypeId]);
    let count = Math.min(Math.floor(gold / source.entry.goldCost), Math.ceil(remaining / power));
    for (const [res, perUnit] of Object.entries(source.entry.resourceCost ?? {})) {
      const available = warehouse[res as keyof typeof warehouse] ?? 0;
      count = Math.min(count, perUnit > 0 ? Math.floor(available / perUnit) : count);
    }
    if (count < 1) continue;
    out.push({
      settlementId,
      buildingKind: source.buildingKind,
      gx: source.gx,
      gy: source.gy,
      unitTypeId: source.entry.unitTypeId,
      count,
    });
    gold -= source.entry.goldCost * count;
    for (const [res, perUnit] of Object.entries(source.entry.resourceCost ?? {})) {
      const key = res as keyof typeof warehouse;
      warehouse[key] = (warehouse[key] ?? 0) - perUnit * count;
    }
    workingStacks = depositIntoGarrison(workingStacks, source.entry.unitTypeId, count).stacks;
    remaining -= power * count;
  }
  return out;
}

function powerPerGold(source: RecruitSource, unitTypes: Record<string, UnitType>): number {
  return unitPower(unitTypes[source.entry.unitTypeId]) / source.entry.goldCost;
}

export function pickAiMove(
  state: GameState,
  heroId: string,
  map: GameMap,
  rng: () => number,
  unitTypes: Record<string, UnitType> = {},
  excludedSettlementIds: ReadonlySet<string> = new Set<string>(),
): AiMove | null {
  const hero = state.heroes[heroId];
  if (!hero) return null;
  if (hero.movementRemaining <= 0) return null;

  const blocked = new Set<string>();
  const attackerPower = platoonPower(hero.stacks, unitTypes);
  for (const [id, other] of Object.entries(state.heroes)) {
    if (id === heroId) continue;
    blocked.add(`${other.q},${other.r}`);
  }
  for (const [sid, s] of Object.entries(state.settlements)) {
    if (s.ownerId === hero.ownerId) continue;
    // I1 re-attack backoff: an excluded settlement is removed from every
    // target class AND forced back into the path obstacle set — the AI
    // routes around it for the whole backoff window, even a garrison it
    // would otherwise judge beatable.
    if (excludedSettlementIds.has(sid)) {
      blocked.add(`${s.q},${s.r}`);
      continue;
    }
    // Only an unfavourable garrison is a path obstacle: a garrison the AI
    // judges it can beat must stay pathable so the approach can END on the
    // settlement tile (the walk-in gates there turn it into a battle or a
    // capture). Empty garrisons were never blocked.
    if (!attackerBeatsGarrison(attackerPower, s, unitTypes)) {
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

  for (const [sid, s] of Object.entries(state.settlements)) {
    if (s.ownerId === hero.ownerId) continue;
    if (excludedSettlementIds.has(sid)) continue;
    const dist = hexDistance(hero, s);
    if (dist > SETTLEMENT_REACH) continue;
    const tile = { q: s.q, r: s.r };
    if (platoonTroopTotal(settlementStacks(s)) > 0) {
      if (!attackerBeatsGarrison(attackerPower, s, unitTypes)) continue;
      targets.push({ kind: "garrisoned_settlement", tile, priority: GARRISONED_SETTLEMENT_PRIORITY - dist * SETTLEMENT_PRIORITY_DECAY });
    } else if (s.ownerId !== null) {
      targets.push({ kind: "enemy_settlement", tile, priority: ENEMY_SETTLEMENT_PRIORITY - dist * SETTLEMENT_PRIORITY_DECAY });
    } else {
      targets.push({ kind: "neutral_settlement", tile, priority: NEUTRAL_SETTLEMENT_PRIORITY - dist * SETTLEMENT_PRIORITY_DECAY });
    }
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
