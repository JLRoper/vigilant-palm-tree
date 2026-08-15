// Interactive (HoMM3-style) battle engine for the manual-fight arena. Built
// on the same primitives as resolveBattle.ts (damage/casualty math, grid,
// combatant/result building) but replaces the auto-resolved turn loop with
// player/AI-driven per-platoon actions: melee platoons must move to an
// adjacent hex before attacking, ranged platoons need RANGED_ATTACK_RANGE and
// an unobstructed line of sight. The player chooses which of their own live
// platoons acts next each round; the AI does the same for its side via a
// simple heuristic (see runAiTurn). See feature-plans/CombatResolutionEngine.md
// for the underlying damage/type-advantage rules this reuses unchanged.

import { type Axial, axialRound, hexDistance } from "../../src/core/hex";
import type { Platoon, PlatoonEntry, UnitType } from "../../src/state/units";
import { PLATOON_RETREAT_LOSS, RANGED_ATTACK_RANGE } from "../combatConfig";
import { applyRetreatLoss } from "./damage";
import { DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS, DEFAULT_OBSTACLE_COUNT, makeBattleGrid } from "./grid";
import {
  buildCombatants,
  buildResults,
  DEFAULT_MAX_ROUNDS,
  livingCombatants,
  pickTarget,
  resolveAttack,
} from "./resolveBattle";
import type { BattleGrid, BattleLogEntry, BattleResult, BattleSide, Combatant } from "./types";

export { pickTarget } from "./resolveBattle";

// Purely cosmetic for now (drives the arena's banner only) but exported and
// keyed off round number rather than buried in UI code, so a future
// day/night combat bonus (e.g. a UnitType.nightBonus trait) can key off the
// same phase without re-deriving it.
export const TIME_OF_DAY_PHASES = ["Dawn", "Day", "Dusk", "Night"] as const;
export type TimeOfDay = (typeof TIME_OF_DAY_PHASES)[number];
const ROUNDS_PER_TIME_PHASE = 3;

export function timeOfDayForRound(round: number): TimeOfDay {
  const idx = Math.floor((Math.max(1, round) - 1) / ROUNDS_PER_TIME_PHASE) % TIME_OF_DAY_PHASES.length;
  return TIME_OF_DAY_PHASES[idx];
}

const NEIGHBOR_DIRS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export interface ManualBattleOptions {
  unitTypes: Record<string, UnitType>;
  obstacleSeed?: number;
  fixedObstacles?: BattleGrid["hexes"];
  grid?: { cols: number; rows: number; obstacleCount?: number };
  sideChoice?: BattleSide;
  maxRounds?: number;
}

export interface ManualBattleState {
  grid: BattleGrid;
  attacker: Combatant[];
  defender: Combatant[];
  attackerOriginalPlatoons: Platoon[];
  defenderOriginalPlatoons: Platoon[];
  unitTypes: Record<string, UnitType>;
  round: number;
  unactedAttacker: Set<number>;
  unactedDefender: Set<number>;
  // Remaining movement points this round, keyed by slot index. A slot with
  // no entry here still has its full platoon speed available (hasn't moved
  // yet this round). A platoon may move multiple times in a turn — e.g. 3
  // hexes now, 2 more later — but the *total* distance it covers this round
  // is capped at its speed; it never gets a fresh full-speed range just by
  // moving again.
  moveBudgetAttacker: Map<number, number>;
  moveBudgetDefender: Map<number, number>;
  log: BattleLogEntry[];
  maxRounds: number;
  obstacleSeed: number;
  over: boolean;
  // Sides whose hero manually retreated or surrendered (via retreatHero) —
  // finalizeManualBattle reads this to assign the `retreated_hero` outcome
  // instead of `lost_all_troops` when one side has voluntarily conceded.
  sidesRetreated: Set<BattleSide>;
}

function hexKey(a: Axial): string {
  return `${a.q},${a.r}`;
}

function combatantsFor(state: ManualBattleState, side: BattleSide): Combatant[] {
  return side === "attacker" ? state.attacker : state.defender;
}

function unactedSetFor(state: ManualBattleState, side: BattleSide): Set<number> {
  return side === "attacker" ? state.unactedAttacker : state.unactedDefender;
}

function moveBudgetSetFor(state: ManualBattleState, side: BattleSide): Map<number, number> {
  return side === "attacker" ? state.moveBudgetAttacker : state.moveBudgetDefender;
}

// A slot absent from the budget map hasn't moved yet this round, so its full
// platoon speed is available.
function remainingMovement(state: ManualBattleState, combatant: Combatant): number {
  const budget = moveBudgetSetFor(state, combatant.side);
  const stored = budget.get(combatant.slotIndex);
  return stored !== undefined ? stored : platoonSpeed(combatant, state.unitTypes);
}

function enemySideOf(side: BattleSide): BattleSide {
  return side === "attacker" ? "defender" : "attacker";
}

export function startManualBattle(
  attackerPlatoons: Platoon[],
  defenderPlatoons: Platoon[],
  options: ManualBattleOptions,
): ManualBattleState {
  const unitTypes = options.unitTypes;
  const obstacleSeed = options.obstacleSeed ?? 1;
  const grid = makeBattleGrid(
    options.grid?.cols ?? DEFAULT_GRID_COLS,
    options.grid?.rows ?? DEFAULT_GRID_ROWS,
    options.grid?.obstacleCount ?? DEFAULT_OBSTACLE_COUNT,
    obstacleSeed,
    options.fixedObstacles,
  );
  const sideChoice = options.sideChoice ?? "attacker";
  const attacker = buildCombatants("attacker", attackerPlatoons, grid, unitTypes, sideChoice);
  const defender = buildCombatants("defender", defenderPlatoons, grid, unitTypes, sideChoice);

  return {
    grid,
    attacker,
    defender,
    attackerOriginalPlatoons: attackerPlatoons,
    defenderOriginalPlatoons: defenderPlatoons,
    unitTypes,
    round: 1,
    unactedAttacker: new Set(livingCombatants(attacker).map((c) => c.slotIndex)),
    unactedDefender: new Set(livingCombatants(defender).map((c) => c.slotIndex)),
    moveBudgetAttacker: new Map(),
    moveBudgetDefender: new Map(),
    log: [],
    maxRounds: options.maxRounds ?? DEFAULT_MAX_ROUNDS,
    obstacleSeed,
    over: false,
    sidesRetreated: new Set(),
  };
}

export function getCombatant(state: ManualBattleState, side: BattleSide, slotIndex: number): Combatant | undefined {
  return combatantsFor(state, side).find((c) => c.slotIndex === slotIndex);
}

// Slots on `side` that are still alive and haven't acted this round — the
// pool the player (or AI) picks their next platoon from.
export function unactedLivingSlots(state: ManualBattleState, side: BattleSide): number[] {
  const living = new Set(livingCombatants(combatantsFor(state, side)).map((c) => c.slotIndex));
  return Array.from(unactedSetFor(state, side)).filter((slot) => living.has(slot));
}

export function platoonSpeed(combatant: Combatant, unitTypes: Record<string, UnitType>): number {
  let min = Infinity;
  for (const e of combatant.entries) {
    const speed = unitTypes[e.unitTypeId]?.speed ?? 0;
    if (speed < min) min = speed;
  }
  return Number.isFinite(min) ? min : 0;
}

function occupiedHexes(state: ManualBattleState, excludeSide: BattleSide, excludeSlotIndex: number): Set<string> {
  const set = new Set<string>();
  for (const side of ["attacker", "defender"] as const) {
    for (const c of combatantsFor(state, side)) {
      if (side === excludeSide && c.slotIndex === excludeSlotIndex) continue;
      if (c.retreated || !c.entries.some((e) => e.count > 0)) continue;
      set.add(hexKey(c.position));
    }
  }
  return set;
}

// BFS over the grid bounded by a movement budget, blocked by impassable
// hexes and any other live combatant's hex. Returns every reachable hex
// (including the start hex, at cost 0) mapped to its hex-step distance, so
// callers can both enumerate reachable destinations and look up the cost of
// a specific one.
function movementCosts(state: ManualBattleState, combatant: Combatant, budget: number): Map<string, number> {
  const blocked = occupiedHexes(state, combatant.side, combatant.slotIndex);
  const hexByKey = new Map(state.grid.hexes.map((h) => [hexKey(h), h]));
  const visited = new Map<string, number>([[hexKey(combatant.position), 0]]);
  const queue: Axial[] = [combatant.position];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const dist = visited.get(hexKey(current))!;
    if (dist >= budget) continue;
    for (const dir of NEIGHBOR_DIRS) {
      const next = { q: current.q + dir.q, r: current.r + dir.r };
      const key = hexKey(next);
      if (visited.has(key)) continue;
      const hex = hexByKey.get(key);
      if (!hex || hex.impassable || blocked.has(key)) continue;
      visited.set(key, dist + 1);
      queue.push(next);
    }
  }
  return visited;
}

// Hexes reachable with whatever movement budget the platoon has left this
// round (its full speed, minus any hexes it's already covered via earlier
// moves this same round). Returns empty once that budget is exhausted.
export function getMovementRange(state: ManualBattleState, combatant: Combatant): Axial[] {
  const budget = remainingMovement(state, combatant);
  if (budget <= 0) return [];
  const visited = movementCosts(state, combatant, budget);
  const result: Axial[] = [];
  for (const [key, dist] of visited) {
    if (dist === 0) continue;
    const [q, r] = key.split(",").map(Number);
    result.push({ q, r });
  }
  return result;
}

export function canMeleeAttack(a: Combatant, b: Combatant): boolean {
  return hexDistance(a.position, b.position) === 1;
}

// Hex-line interpolation between two axial coords; blocked if any
// intermediate hex (excluding the endpoints) is impassable.
export function hasLineOfSight(grid: BattleGrid, from: Axial, to: Axial): boolean {
  const dist = hexDistance(from, to);
  if (dist <= 1) return true;
  const hexByKey = new Map(grid.hexes.map((h) => [hexKey(h), h]));
  for (let i = 1; i < dist; i++) {
    const t = i / dist;
    const lerpQ = from.q + (to.q - from.q) * t;
    const lerpR = from.r + (to.r - from.r) * t;
    const rounded = axialRound(lerpQ, lerpR);
    const hex = hexByKey.get(hexKey(rounded));
    if (hex?.impassable) return false;
  }
  return true;
}

export function isRangedPlatoon(combatant: Combatant, unitTypes: Record<string, UnitType>): boolean {
  return combatant.entries.length > 0 && combatant.entries.every((e) => unitTypes[e.unitTypeId]?.advantageType === "ranged");
}

export function getValidMeleeTargets(state: ManualBattleState, combatant: Combatant): Combatant[] {
  const enemies = livingCombatants(combatantsFor(state, enemySideOf(combatant.side)));
  return enemies.filter((e) => canMeleeAttack(combatant, e));
}

export function getValidRangedTargets(state: ManualBattleState, combatant: Combatant): Combatant[] {
  const enemies = livingCombatants(combatantsFor(state, enemySideOf(combatant.side)));
  return enemies.filter(
    (e) => hexDistance(combatant.position, e.position) <= RANGED_ATTACK_RANGE && hasLineOfSight(state.grid, combatant.position, e.position),
  );
}

export function getValidAttackTargets(state: ManualBattleState, combatant: Combatant): Combatant[] {
  return isRangedPlatoon(combatant, state.unitTypes)
    ? getValidRangedTargets(state, combatant)
    : getValidMeleeTargets(state, combatant);
}

function pruneDead(state: ManualBattleState): void {
  const aliveAttacker = new Set(livingCombatants(state.attacker).map((c) => c.slotIndex));
  const aliveDefender = new Set(livingCombatants(state.defender).map((c) => c.slotIndex));
  for (const slot of Array.from(state.unactedAttacker)) if (!aliveAttacker.has(slot)) state.unactedAttacker.delete(slot);
  for (const slot of Array.from(state.unactedDefender)) if (!aliveDefender.has(slot)) state.unactedDefender.delete(slot);
  for (const slot of Array.from(state.moveBudgetAttacker.keys())) if (!aliveAttacker.has(slot)) state.moveBudgetAttacker.delete(slot);
  for (const slot of Array.from(state.moveBudgetDefender.keys())) if (!aliveDefender.has(slot)) state.moveBudgetDefender.delete(slot);
}

export function isBattleOver(state: ManualBattleState): boolean {
  return livingCombatants(state.attacker).length === 0 || livingCombatants(state.defender).length === 0;
}

function checkRoundAdvance(state: ManualBattleState): void {
  pruneDead(state);
  if (isBattleOver(state)) {
    state.over = true;
    return;
  }
  if (state.unactedAttacker.size === 0 && state.unactedDefender.size === 0) {
    state.round++;
    if (state.round > state.maxRounds) {
      state.over = true;
      state.log.push({ round: state.round, kind: "stalemate", detail: `battle exceeded ${state.maxRounds} rounds` });
      return;
    }
    state.unactedAttacker = new Set(livingCombatants(state.attacker).map((c) => c.slotIndex));
    state.unactedDefender = new Set(livingCombatants(state.defender).map((c) => c.slotIndex));
    state.moveBudgetAttacker = new Map();
    state.moveBudgetDefender = new Map();
  }
}

// Moves a not-yet-acted platoon toward a hex within its remaining movement
// budget for this round. A platoon may call this more than once per turn —
// e.g. 3 hexes now, 2 more later — but the total distance covered across
// all its moves this round is capped at its speed. Moving does not by
// itself consume the platoon's turn — it may still attack afterward (or
// call endPlatoonTurn to skip attacking, or stop moving, this round).
export function movePlatoon(state: ManualBattleState, side: BattleSide, slotIndex: number, destination: Axial): boolean {
  if (!unactedSetFor(state, side).has(slotIndex)) return false;
  const combatant = getCombatant(state, side, slotIndex);
  if (!combatant) return false;
  const budget = remainingMovement(state, combatant);
  if (budget <= 0) return false;
  const costs = movementCosts(state, combatant, budget);
  const cost = costs.get(hexKey(destination));
  if (cost === undefined || cost === 0) return false;
  combatant.position = destination;
  moveBudgetSetFor(state, side).set(slotIndex, budget - cost);
  return true;
}

// Attacks with a not-yet-acted platoon; validates the target is currently a
// legal target (adjacency for melee, range+LOS for ranged) from wherever the
// platoon currently stands. Consumes the platoon's turn for this round.
export function attackWithPlatoon(state: ManualBattleState, side: BattleSide, slotIndex: number, targetSlotIndex: number): boolean {
  const unacted = unactedSetFor(state, side);
  if (!unacted.has(slotIndex)) return false;
  const actor = getCombatant(state, side, slotIndex);
  if (!actor) return false;
  const target = getValidAttackTargets(state, actor).find((t) => t.slotIndex === targetSlotIndex);
  if (!target) return false;
  resolveAttack(actor, target, state.unitTypes, 1, false, state.round, state.log);
  unacted.delete(slotIndex);
  checkRoundAdvance(state);
  return true;
}

// Pure derivation — given a platoon's current entries, returns the dominant
// specialty tag. Recomputed live from entries (no cached state) so the
// specialty naturally shifts when casualties flip the dominant unit type:
// e.g. a mixed archer/swordsman platoon whose archers all die will switch
// from "archery" to "sword" without any explicit notification.
//
// Returns null when the platoon has no entries.
//
// Rule: group entries by UnitType.specialty, sum
// (count * specialtyPriority) per group, then pick the group with the
// highest weighted total. Ties broken by absolute unit count, then by the
// unit type that appears first in entries order. Thresholds ("at least
// 40% of the platoon must be that specialty") live in the UI layer — the
// engine just answers "which specialty, if any, is dominant right now".
export function computeSpecialty(entries: PlatoonEntry[], unitTypes: Record<string, UnitType>): string | null {
  if (entries.length === 0) return null;
  type Bucket = { weight: number; count: number; firstIndex: number };
  const buckets = new Map<string, Bucket>();
  entries.forEach((e, idx) => {
    if (e.count <= 0) return;
    const unitType = unitTypes[e.unitTypeId];
    if (!unitType || !unitType.specialty) return;
    const tag = unitType.specialty;
    const priority = Number.isFinite(unitType.specialtyPriority) ? unitType.specialtyPriority : 1.0;
    const weight = e.count * priority;
    const prev = buckets.get(tag);
    if (prev) {
      prev.weight += weight;
      prev.count += e.count;
    } else {
      buckets.set(tag, { weight, count: e.count, firstIndex: idx });
    }
  });
  if (buckets.size === 0) return null;
  let best: { tag: string; bucket: Bucket } | null = null;
  for (const [tag, bucket] of buckets) {
    if (!best || bucket.weight > best.bucket.weight ||
        (bucket.weight === best.bucket.weight && bucket.count > best.bucket.count) ||
        (bucket.weight === best.bucket.weight && bucket.count === best.bucket.count && bucket.firstIndex < best.bucket.firstIndex)) {
      best = { tag, bucket };
    }
  }
  return best ? best.tag : null;
}

// Convenience: total unit count across entries that have count > 0.
// Used by the UI to apply the 40% threshold on top of computeSpecialty().
export function totalUnits(entries: PlatoonEntry[]): number {
  let total = 0;
  for (const e of entries) if (e.count > 0) total += e.count;
  return total;
}

// Consumes a not-yet-acted platoon's turn without attacking (e.g. it moved
// but has no legal target, or the player chooses not to attack).
export function endPlatoonTurn(state: ManualBattleState, side: BattleSide, slotIndex: number): boolean {
  const unacted = unactedSetFor(state, side);
  if (!unacted.has(slotIndex)) return false;
  unacted.delete(slotIndex);
  checkRoundAdvance(state);
  return true;
}

function closestHexTo(candidates: Axial[], target: Axial, current: Axial): Axial | null {
  let best: Axial | null = null;
  let bestDist = hexDistance(current, target);
  for (const h of candidates) {
    const d = hexDistance(h, target);
    if (d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  return best;
}

// Simple AI heuristic for one of the AI's platoons: target the weakest
// living enemy (reusing the same pickTarget used by the auto-resolver),
// then move into position and attack if possible. Ranged platoons that
// can't reach range+LOS this turn just close distance; melee platoons that
// can't reach adjacency just move as close as their speed allows. Neither
// case attempts multi-turn kiting/pathing around obstacles beyond a single
// greedy step — an intentional simplification for this arena.
export function runAiTurn(state: ManualBattleState, side: BattleSide): void {
  const slots = unactedLivingSlots(state, side);
  if (slots.length === 0) return;
  const slotIndex = slots[0];
  const actor = getCombatant(state, side, slotIndex);
  if (!actor) return;

  const enemies = livingCombatants(combatantsFor(state, enemySideOf(side)));
  const target = pickTarget(enemies, state.unitTypes);
  if (!target) {
    endPlatoonTurn(state, side, slotIndex);
    return;
  }

  const range = getMovementRange(state, actor);

  if (isRangedPlatoon(actor, state.unitTypes)) {
    if (hexDistance(actor.position, target.position) <= RANGED_ATTACK_RANGE && hasLineOfSight(state.grid, actor.position, target.position)) {
      attackWithPlatoon(state, side, slotIndex, target.slotIndex);
      return;
    }
    const reposition = range.find(
      (h) => hexDistance(h, target.position) <= RANGED_ATTACK_RANGE && hasLineOfSight(state.grid, h, target.position),
    );
    if (reposition) {
      movePlatoon(state, side, slotIndex, reposition);
      attackWithPlatoon(state, side, slotIndex, target.slotIndex);
      return;
    }
    const closer = closestHexTo(range, target.position, actor.position);
    if (closer) movePlatoon(state, side, slotIndex, closer);
    endPlatoonTurn(state, side, slotIndex);
    return;
  }

  if (canMeleeAttack(actor, target)) {
    attackWithPlatoon(state, side, slotIndex, target.slotIndex);
    return;
  }
  const adjacentHex = range.find((h) => hexDistance(h, target.position) === 1);
  if (adjacentHex) {
    movePlatoon(state, side, slotIndex, adjacentHex);
    attackWithPlatoon(state, side, slotIndex, target.slotIndex);
    return;
  }
  const closer = closestHexTo(range, target.position, actor.position);
  if (closer) movePlatoon(state, side, slotIndex, closer);
  endPlatoonTurn(state, side, slotIndex);
}

// Voluntary side concession triggered by the player (Retreat / Surrender
// footer buttons in the manual-fight arena). Retreat applies the standard
// PLATOON_RETREAT_LOSS to every still-living platoon on the side before
// pulling them off the field; surrender skips the loss and just yields
// immediately. Either way the side ends up in `sidesRetreated` so
// finalizeManualBattle can tag the outcome as `retreated_hero` rather than
// the misleading `lost_all_troops`.
export interface RetreatHeroOptions {
  applyLoss?: boolean;
}

export function retreatHero(state: ManualBattleState, side: BattleSide, options: RetreatHeroOptions = {}): void {
  const applyLoss = options.applyLoss ?? true;
  const round = state.round;
  const combatants = side === "attacker" ? state.attacker : state.defender;
  for (const c of combatants) {
    if (c.retreated || c.entries.every((e) => e.count <= 0)) continue;
    if (applyLoss) {
      const { entries, casualties } = applyRetreatLoss(c.entries, PLATOON_RETREAT_LOSS);
      c.entries = entries;
      state.log.push({ round, kind: "self_retreat", side, slotIndex: c.slotIndex, casualties });
    }
    c.retreated = true;
  }
  state.log.push({ round, kind: "hero_retreat", side });
  state.sidesRetreated.add(side);
  if (side === "attacker") state.unactedAttacker.clear();
  else state.unactedDefender.clear();
  state.over = true;
}

export function finalizeManualBattle(state: ManualBattleState): BattleResult {
  const attackerAlive = livingCombatants(state.attacker).length > 0;
  const defenderAlive = livingCombatants(state.defender).length > 0;
  const attackerRetreated = state.sidesRetreated.has("attacker");
  const defenderRetreated = state.sidesRetreated.has("defender");

  let winner: BattleSide | "draw";
  let attackerOutcome: Parameters<typeof buildResults>[2];
  let defenderOutcome: Parameters<typeof buildResults>[2];

  if (attackerRetreated && !defenderRetreated) {
    winner = "defender";
    attackerOutcome = "retreated_hero";
    defenderOutcome = defenderAlive ? "won" : "lost_all_troops";
  } else if (defenderRetreated && !attackerRetreated) {
    winner = "attacker";
    defenderOutcome = "retreated_hero";
    attackerOutcome = attackerAlive ? "won" : "lost_all_troops";
  } else if (attackerAlive && !defenderAlive) {
    winner = "attacker";
    attackerOutcome = "won";
    defenderOutcome = "lost_all_troops";
  } else if (defenderAlive && !attackerAlive) {
    winner = "defender";
    defenderOutcome = "won";
    attackerOutcome = "lost_all_troops";
  } else if (!attackerAlive && !defenderAlive) {
    winner = "draw";
    attackerOutcome = "lost_all_troops";
    defenderOutcome = "lost_all_troops";
  } else {
    winner = "draw";
    attackerOutcome = "survived";
    defenderOutcome = "survived";
  }

  const attackerResults = buildResults(state.attackerOriginalPlatoons, state.attacker, attackerOutcome);
  const defenderResults = buildResults(state.defenderOriginalPlatoons, state.defender, defenderOutcome);

  return {
    winner,
    attackerOutcome,
    defenderOutcome,
    attackerPlatoons: attackerResults.map((r) => r.platoon),
    defenderPlatoons: defenderResults.map((r) => r.platoon),
    attackerResults,
    defenderResults,
    attackerRenownDelta: 0,
    defenderRenownDelta: 0,
    rounds: state.round,
    log: state.log,
    grid: state.grid,
    obstacleSeed: state.obstacleSeed,
  };
}
