import type { Platoon, PlatoonEntry, UnitType } from "../../src/state/units";
import { DEFAULT_MAX_ROUNDS, HERO_RETREAT_PENALTY, PLATOON_RETREAT_LOSS } from "../combatConfig";
import { DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS, DEFAULT_OBSTACLE_COUNT, deploymentPosition, makeBattleGrid } from "./grid";
import { applyCasualties, applyRetreatLoss, computeDamage, totalHealth } from "./damage";
import type {
  BattleGrid,
  BattleLogEntry,
  BattleResult,
  BattleSide,
  BattleSnapshot,
  Combatant,
  CombatantOutcome,
  CombatantResult,
  CombatEffect,
  ResolveBattleOptions,
  RetreatDecision,
  RetreatPolicy,
} from "./types";

export { DEFAULT_MAX_ROUNDS };

function buildCombatants(
  side: BattleSide,
  platoons: Platoon[],
  grid: BattleGrid,
  unitTypes: Record<string, UnitType>,
  sideChoice: BattleSide,
): Combatant[] {
  const out: Combatant[] = [];
  platoons.forEach((p, slotIndex) => {
    const entries = p.entries.filter((e) => e.count > 0).map((e) => ({ ...e }));
    if (entries.length === 0) return;
    out.push({
      side,
      slotIndex,
      position: deploymentPosition(side, slotIndex, grid, sideChoice),
      entries,
      maxHealth: totalHealth(entries, unitTypes),
      hasCounterCharge: true,
      retreated: false,
    });
  });
  return out;
}

function livingCombatants(list: Combatant[]): Combatant[] {
  return list.filter((c) => !c.retreated && c.entries.some((e) => e.count > 0));
}

function pickTarget(enemies: Combatant[], unitTypes: Record<string, UnitType>): Combatant | null {
  const living = livingCombatants(enemies);
  if (living.length === 0) return null;
  living.sort((a, b) => {
    const hpDiff = totalHealth(a.entries, unitTypes) - totalHealth(b.entries, unitTypes);
    if (hpDiff !== 0) return hpDiff;
    return a.slotIndex - b.slotIndex;
  });
  return living[0];
}

function cloneCombatant(c: Combatant): Combatant {
  return { ...c, entries: c.entries.map((e) => ({ ...e })) };
}

// resolveAttack(): the seam a future ability layer (heal/regen/AoE) can
// extend with new CombatEffect kinds without restructuring the turn loop.
function resolveAttack(
  actor: Combatant,
  target: Combatant,
  unitTypes: Record<string, UnitType>,
  modifier: number,
  isCounterattack: boolean,
  round: number,
  log: BattleLogEntry[],
): CombatEffect {
  const { damage, advantageBonus, disadvantagePenalty } = computeDamage(actor.entries, target.entries, unitTypes, modifier);
  const { entries, casualties } = applyCasualties(target.entries, unitTypes, damage);
  target.entries = entries;
  const effect: CombatEffect = {
    kind: "damage",
    side: actor.side,
    attackerSlot: actor.slotIndex,
    targetSlot: target.slotIndex,
    damage,
    advantageBonus,
    disadvantagePenalty,
    casualties,
    isCounterattack,
  };
  log.push({ round, ...effect });
  return effect;
}

// Evaluates one side's retreat policy at the end of a round. Returns true if
// the whole side (hero) retreats; mutates `combatants` in place to apply any
// per-platoon self-retreats.
function applyRetreatPolicy(
  side: BattleSide,
  combatants: Combatant[],
  policy: RetreatPolicy,
  unitTypes: Record<string, UnitType>,
  round: number,
  log: BattleLogEntry[],
  snapshot: BattleSnapshot,
): boolean {
  if (policy.kind === "fight") return false;
  const living = livingCombatants(combatants);
  if (living.length === 0) return false;

  let decisions: RetreatDecision[] = [];
  if (policy.kind === "custom") {
    decisions = policy.decide(snapshot, side);
  } else {
    const totalMax = combatants.reduce((sum, c) => sum + c.maxHealth, 0);
    const totalCurrent = living.reduce((sum, c) => sum + totalHealth(c.entries, unitTypes), 0);
    if (totalMax > 0 && totalCurrent / totalMax <= policy.heroRetreatHpPct) {
      decisions = [{ slotIndex: -1, scope: "hero" }];
    } else {
      for (const c of living) {
        const pct = c.maxHealth > 0 ? totalHealth(c.entries, unitTypes) / c.maxHealth : 0;
        if (pct <= policy.selfRetreatHpPct) decisions.push({ slotIndex: c.slotIndex, scope: "platoon" });
      }
    }
  }

  let heroRetreat = false;
  for (const d of decisions) {
    if (d.scope === "hero") {
      heroRetreat = true;
      log.push({ round, kind: "hero_retreat", side });
      continue;
    }
    const c = combatants.find((x) => x.slotIndex === d.slotIndex && !x.retreated);
    if (!c || c.entries.every((e) => e.count <= 0)) continue;
    const { entries, casualties } = applyRetreatLoss(c.entries, PLATOON_RETREAT_LOSS);
    c.entries = entries;
    c.retreated = true;
    log.push({ round, kind: "self_retreat", side, slotIndex: c.slotIndex, casualties });
  }
  return heroRetreat;
}

function buildResults(
  originalPlatoons: Platoon[],
  combatants: Combatant[],
  sideOutcome: CombatantOutcome,
): CombatantResult[] {
  const bySlot = new Map(combatants.map((c) => [c.slotIndex, c]));
  return originalPlatoons.map((original, slotIndex) => {
    const c = bySlot.get(slotIndex);
    if (!c) {
      return { slotIndex, platoon: { entries: [] }, outcome: "survived" as CombatantOutcome, casualties: [] };
    }
    const originalCounts = new Map(original.entries.map((e) => [e.unitTypeId, e.count]));
    const survivingCounts = new Map(c.entries.map((e) => [e.unitTypeId, e.count]));
    const casualties: PlatoonEntry[] = [];
    for (const [unitTypeId, count] of originalCounts) {
      const lost = count - (survivingCounts.get(unitTypeId) ?? 0);
      if (lost > 0) casualties.push({ unitTypeId, count: lost });
    }
    const stillHasTroops = c.entries.some((e) => e.count > 0);
    const outcome: CombatantOutcome = c.retreated
      ? sideOutcome === "retreated_hero"
        ? "retreated_hero"
        : "retreated_self"
      : stillHasTroops
        ? sideOutcome
        : "lost_all_troops";
    return { slotIndex, platoon: { entries: c.entries.filter((e) => e.count > 0) }, outcome, casualties };
  });
}

// Pure hex battle resolver. Takes two 8-slot platoon rosters and plays out
// stat-comparison combat with type advantages, counterattacks, self/hero
// retreat, and a no-retreat loss path. Turns alternate between sides (not
// speed-based); damage is a deterministic ratio formula (no random swing) —
// only the obstacle layout is seed-driven. See
// feature-plans/CombatResolutionEngine.md for the design this implements.
export function resolveBattle(
  attackerPlatoons: Platoon[],
  defenderPlatoons: Platoon[],
  options: ResolveBattleOptions,
): BattleResult {
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
  const attackerPolicy: RetreatPolicy = options.attackerRetreatPolicy ?? { kind: "fight" };
  const defenderPolicy: RetreatPolicy = options.defenderRetreatPolicy ?? { kind: "fight" };
  const attackerMod = options.attackerModifiers?.damageMultiplier ?? 1;
  const defenderMod = options.defenderModifiers?.damageMultiplier ?? 1;
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;

  const log: BattleLogEntry[] = [];
  let attackerHeroRetreated = false;
  let defenderHeroRetreated = false;
  let round = 0;

  while (round < maxRounds) {
    if (livingCombatants(attacker).length === 0 || livingCombatants(defender).length === 0) break;
    round++;

    // Alternate turns between sides, slot-index order within each side.
    const attackerOrder = livingCombatants(attacker);
    const defenderOrder = livingCombatants(defender);
    const turnQueue: Combatant[] = [];
    const maxLen = Math.max(attackerOrder.length, defenderOrder.length);
    for (let i = 0; i < maxLen; i++) {
      if (attackerOrder[i]) turnQueue.push(attackerOrder[i]);
      if (defenderOrder[i]) turnQueue.push(defenderOrder[i]);
    }

    for (const actor of turnQueue) {
      if (actor.retreated || !actor.entries.some((e) => e.count > 0)) continue;
      actor.hasCounterCharge = true; // refills at the start of its own turn
      const enemies = actor.side === "attacker" ? defender : attacker;
      const target = pickTarget(enemies, unitTypes);
      if (!target) break;

      // A hit that's survived can itself be countered (by whoever has a
      // charge left), so this isn't a single retaliation — it's a chain
      // that self-terminates once both sides' charges are spent (at most
      // one extra counter each). See "Counterattacks (resolved)".
      let current = actor;
      let opponent = target;
      let isCounter = false;
      for (;;) {
        const modifier = current.side === "attacker" ? attackerMod : defenderMod;
        resolveAttack(current, opponent, unitTypes, modifier, isCounter, round, log);
        if (livingCombatants(attacker).length === 0 || livingCombatants(defender).length === 0) break;
        const opponentSurvived = opponent.entries.some((e) => e.count > 0);
        if (!opponentSurvived || !opponent.hasCounterCharge) break;
        opponent.hasCounterCharge = false;
        [current, opponent] = [opponent, current];
        isCounter = true;
      }
    }

    const snapshot: BattleSnapshot = {
      round,
      attacker: attacker.map(cloneCombatant),
      defender: defender.map(cloneCombatant),
    };
    if (applyRetreatPolicy("attacker", attacker, attackerPolicy, unitTypes, round, log, snapshot)) {
      attackerHeroRetreated = true;
      attacker.forEach((c) => (c.retreated = true));
    }
    if (applyRetreatPolicy("defender", defender, defenderPolicy, unitTypes, round, log, snapshot)) {
      defenderHeroRetreated = true;
      defender.forEach((c) => (c.retreated = true));
    }
    if (attackerHeroRetreated || defenderHeroRetreated) break;
  }

  const attackerAlive = livingCombatants(attacker).length > 0;
  const defenderAlive = livingCombatants(defender).length > 0;

  let winner: BattleSide | "draw";
  let attackerOutcome: CombatantOutcome;
  let defenderOutcome: CombatantOutcome;

  if (attackerHeroRetreated) {
    winner = "defender";
    attackerOutcome = "retreated_hero";
    defenderOutcome = defenderAlive ? "won" : "survived";
  } else if (defenderHeroRetreated) {
    winner = "attacker";
    defenderOutcome = "retreated_hero";
    attackerOutcome = attackerAlive ? "won" : "survived";
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
    log.push({ round, kind: "stalemate", detail: `battle exceeded ${maxRounds} rounds` });
  }

  const attackerResults = buildResults(attackerPlatoons, attacker, attackerOutcome);
  const defenderResults = buildResults(defenderPlatoons, defender, defenderOutcome);

  return {
    winner,
    attackerOutcome,
    defenderOutcome,
    attackerPlatoons: attackerResults.map((r) => r.platoon),
    defenderPlatoons: defenderResults.map((r) => r.platoon),
    attackerResults,
    defenderResults,
    attackerRenownDelta: attackerHeroRetreated ? -HERO_RETREAT_PENALTY : 0,
    defenderRenownDelta: defenderHeroRetreated ? -HERO_RETREAT_PENALTY : 0,
    rounds: round,
    log,
    grid,
    obstacleSeed,
  };
}
