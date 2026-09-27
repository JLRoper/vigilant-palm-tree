import { hexDistance } from "@heroes/contracts";
import type { Platoon, PlatoonEntry, UnitType } from "../units";
import {
  DEFAULT_MAX_ROUNDS,
  FATIGUE_DECAY_PER_TURN,
  FATIGUE_PER_ATTACK,
  FATIGUE_PER_MOVE,
  HERO_RETREAT_PENALTY,
  MORALE_GAIN_PER_KILL,
  MORALE_LOSS_PER_ADJACENT_DEATH,
  MORALE_LOSS_PER_CASUALTY,
  MORALE_LOW_THRESHOLD,
  MORALE_RETREAT_THRESHOLD_REDUCTION,
  PLATOON_RETREAT_LOSS,
} from "../combatConfig";
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
  MoraleFatigueReason,
  ResolveBattleOptions,
  RetreatDecision,
  RetreatPolicy,
} from "./types";

export { DEFAULT_MAX_ROUNDS };

export function buildCombatants(
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
      morale: 100,
      fatigue: 0,
      retreated: false,
    });
  });
  return out;
}

export function livingCombatants(list: Combatant[]): Combatant[] {
  return list.filter((c) => !c.retreated && c.entries.some((e) => e.count > 0));
}

export function pickTarget(enemies: Combatant[], unitTypes: Record<string, UnitType>): Combatant | null {
  const living = livingCombatants(enemies);
  if (living.length === 0) return null;
  living.sort((a, b) => {
    const hpDiff = totalHealth(a.entries, unitTypes) - totalHealth(b.entries, unitTypes);
    if (hpDiff !== 0) return hpDiff;
    return a.slotIndex - b.slotIndex;
  });
  return living[0];
}

export function cloneCombatant(c: Combatant): Combatant {
  return { ...c, entries: c.entries.map((e) => ({ ...e })) };
}

// ── Morale & fatigue (docs/morale-fatigue-plan.md) ──────────────────────────

function clampStat(value: number): number {
  return Math.min(100, Math.max(0, value));
}

// Single seam every morale/fatigue mutation goes through: clamps to 0-100 and
// mirrors the change into the log as a morale_change entry carrying the
// actually-applied deltas plus the resulting values, so the battle log alone
// re-derives both stats for the future legality-check consumer. A change
// fully absorbed by the clamp (e.g. decay at fatigue 0) writes nothing.
function applyStatChange(
  target: Combatant,
  moraleDelta: number,
  fatigueDelta: number,
  reason: MoraleFatigueReason,
  round: number,
  log: BattleLogEntry[],
): void {
  const moraleBefore = target.morale;
  const fatigueBefore = target.fatigue;
  target.morale = clampStat(moraleBefore + moraleDelta);
  target.fatigue = clampStat(fatigueBefore + fatigueDelta);
  const appliedMorale = target.morale - moraleBefore;
  const appliedFatigue = target.fatigue - fatigueBefore;
  if (appliedMorale === 0 && appliedFatigue === 0) return;
  log.push({
    round,
    kind: "morale_change",
    side: target.side,
    slotIndex: target.slotIndex,
    moraleDelta: appliedMorale,
    fatigueDelta: appliedFatigue,
    morale: target.morale,
    fatigue: target.fatigue,
    reason,
  });
}

// Fatigue from one applied move action in the manual battle — may fire more
// than once per round for a platoon that splits its movement.
export function applyMoveFatigue(target: Combatant, round: number, log: BattleLogEntry[]): void {
  applyStatChange(target, 0, FATIGUE_PER_MOVE, "move", round, log);
}

// Fatigue from one applied attack swing. resolveAttack calls this so BOTH
// engines accrue identically and counterattacks count as exertion too.
export function applyAttackFatigue(target: Combatant, round: number, log: BattleLogEntry[]): void {
  applyStatChange(target, 0, FATIGUE_PER_ATTACK, "attack", round, log);
}

// Start of the platoon's own turn: fatigue partially recovers. resolveBattle
// calls this right where hasCounterCharge refills; the manual battle
// batch-applies it at the round boundary (its "turn start" for every living
// platoon at once).
export function applyTurnStartRecovery(target: Combatant, round: number, log: BattleLogEntry[]): void {
  applyStatChange(target, 0, -FATIGUE_DECAY_PER_TURN, "turn_start", round, log);
}

// A platoon was destroyed: same-side platoons adjacent to the loss waver.
// `allies` is the dead platoon's full side roster (including it).
export function applyAllyDeathMorale(dead: Combatant, allies: Combatant[], round: number, log: BattleLogEntry[]): void {
  for (const ally of allies) {
    if (ally === dead || ally.retreated || !ally.entries.some((e) => e.count > 0)) continue;
    if (hexDistance(ally.position, dead.position) !== 1) continue;
    applyStatChange(ally, -MORALE_LOSS_PER_ADJACENT_DEATH, 0, "ally_destroyed", round, log);
  }
}

// The "auto" retreat policy's self-retreat HP threshold for a platoon with
// the given morale: at or above MORALE_LOW_THRESHOLD the caller's threshold
// applies unchanged; below it the threshold rises (never above 1), so a
// demoralized platoon withdraws EARLIER — low morale makes troops rout
// before they are ground down. (Owner decision 2026-09-27, overriding the
// plan's literal "lowers the threshold" wording.)
export function effectiveSelfRetreatHpPct(basePct: number, morale: number): number {
  if (morale >= MORALE_LOW_THRESHOLD) return basePct;
  return Math.min(1, basePct + MORALE_RETREAT_THRESHOLD_REDUCTION);
}

// resolveAttack(): the seam a future ability layer (heal/regen/AoE) can
// extend with new CombatEffect kinds without restructuring the turn loop.
// Also the single morale/fatigue seam shared by both engines: the attacker's
// fatigue/morale and the target's fatigue scale the damage, casualties dent
// the target's morale, destroying the target lifts the attacker's, and the
// swing itself tires the attacker (counterattacks included).
export function resolveAttack(
  actor: Combatant,
  target: Combatant,
  unitTypes: Record<string, UnitType>,
  modifier: number,
  isCounterattack: boolean,
  round: number,
  log: BattleLogEntry[],
): CombatEffect {
  const { damage, advantageBonus, disadvantagePenalty } = computeDamage(actor.entries, target.entries, unitTypes, modifier, actor, target);
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
  const unitsLost = casualties.reduce((sum, c) => sum + c.count, 0);
  if (unitsLost > 0) applyStatChange(target, -unitsLost * MORALE_LOSS_PER_CASUALTY, 0, "casualties", round, log);
  if (!target.entries.some((e) => e.count > 0)) applyStatChange(actor, MORALE_GAIN_PER_KILL, 0, "kill", round, log);
  applyAttackFatigue(actor, round, log);
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
        if (pct <= effectiveSelfRetreatHpPct(policy.selfRetreatHpPct, c.morale)) decisions.push({ slotIndex: c.slotIndex, scope: "platoon" });
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

export function buildResults(
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
      applyTurnStartRecovery(actor, round, log);
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
        if (!opponentSurvived) {
          applyAllyDeathMorale(opponent, opponent.side === "attacker" ? attacker : defender, round, log);
          break;
        }
        if (!opponent.hasCounterCharge) break;
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
