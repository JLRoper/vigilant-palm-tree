import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveBattle,
  buildCombatants,
  computeDamage,
  effectiveSelfRetreatHpPct,
  fatigueMultiplier,
  makeBattleGrid,
  moraleAttackMultiplier,
  FATIGUE_DECAY_PER_TURN,
  FATIGUE_MAX_PENALTY,
  FATIGUE_PER_ATTACK,
  MORALE_LOW_THRESHOLD,
  MORALE_MAX_ATTACK_PENALTY,
  MORALE_RETREAT_THRESHOLD_REDUCTION,
  type BattleLogEntry,
} from "@heroes/engine";
import { ARMY_STACK_SLOTS, type Platoon, type PlatoonEntry, type UnitType } from "../../src/state/units";

const unitTypes: Record<string, UnitType> = {
  // Neutral pair (both "ranged") used for scenarios where the
  // type-advantage multiplier should stay out of the way.
  grunt: { id: "grunt", name: "Grunt", attack: 5, defence: 5, health: 10, speed: 3, description: "", advantageType: "ranged" },
  tank: { id: "tank", name: "Tank", attack: 15, defence: 0, health: 100000, speed: 1, description: "", advantageType: "ranged" },
  // One of each advantage tag, identical base stats, for type-multiplier tests.
  inf: { id: "inf", name: "Infantry", attack: 10, defence: 5, health: 20, speed: 3, description: "", advantageType: "infantry" },
  cav: { id: "cav", name: "Cavalry", attack: 10, defence: 5, health: 20, speed: 3, description: "", advantageType: "cavalry" },
  rng: { id: "rng", name: "Ranged", attack: 10, defence: 5, health: 20, speed: 3, description: "", advantageType: "ranged" },
  mon: { id: "mon", name: "Monster", attack: 10, defence: 5, health: 20, speed: 3, description: "", advantageType: "monster" },
  // Overwhelming attacker for the no-retreat-loss scenario.
  hero: { id: "hero", name: "Hero", attack: 100, defence: 100, health: 100, speed: 5, description: "", advantageType: "infantry" },
  weak: { id: "weak", name: "Weak", attack: 1, defence: 1, health: 5, speed: 1, description: "", advantageType: "cavalry" },
  // Slow siege unit tuned so its first swing lands round(74²/(74+1) × 1.3)
  // = 95 damage vs a weak platoon (defence 1, hp 5) — exactly 19 units; the
  // second (post-recovery, slightly fatigued) lands 92 → 18. The demoralized
  // self-retreat scenario below relies on those counts.
  siege: { id: "siege", name: "Siege", attack: 74, defence: 0, health: 100000, speed: 1, description: "", advantageType: "infantry" },
};

function makePlatoons(list: PlatoonEntry[][]): Platoon[] {
  const out: Platoon[] = list.map((entries) => ({ entries }));
  while (out.length < ARMY_STACK_SLOTS) out.push({ entries: [] });
  return out;
}

test("resolveBattle is fully deterministic (no random swing) for the same inputs", () => {
  const attacker = makePlatoons([[{ unitTypeId: "inf", count: 5 }]]);
  const defender = makePlatoons([[{ unitTypeId: "cav", count: 5 }]]);
  const r1 = resolveBattle(attacker, defender, { unitTypes, obstacleSeed: 42 });
  const r2 = resolveBattle(attacker, defender, { unitTypes, obstacleSeed: 42 });
  assert.deepEqual(r1, r2);
});

test("obstacleSeed changes the obstacle layout but not the combat log", () => {
  const attacker = makePlatoons([[{ unitTypeId: "grunt", count: 5 }]]);
  const defender = makePlatoons([[{ unitTypeId: "grunt", count: 5 }]]);
  const r1 = resolveBattle(attacker, defender, { unitTypes, obstacleSeed: 1 });
  const r2 = resolveBattle(attacker, defender, { unitTypes, obstacleSeed: 2 });
  assert.deepEqual(r1.log, r2.log, "obstacle layout shouldn't affect combat resolution yet");
  assert.notDeepEqual(r1.grid.hexes, r2.grid.hexes);
});

test("resolveBattle: overwhelming attacker wipes the defender (no-retreat loss path)", () => {
  const attacker = makePlatoons([[{ unitTypeId: "hero", count: 10 }]]);
  const defender = makePlatoons([[{ unitTypeId: "weak", count: 1 }]]);
  const result = resolveBattle(attacker, defender, { unitTypes, obstacleSeed: 7 });
  assert.equal(result.winner, "attacker");
  assert.equal(result.attackerOutcome, "won");
  assert.equal(result.defenderOutcome, "lost_all_troops");
  assert.equal(result.defenderPlatoons[0].entries.length, 0);
});

test("resolveBattle: attacking an empty roster wins immediately with zero rounds", () => {
  const attacker = makePlatoons([[{ unitTypeId: "hero", count: 1 }]]);
  const defender = makePlatoons([]);
  const result = resolveBattle(attacker, defender, { unitTypes, obstacleSeed: 3 });
  assert.equal(result.winner, "attacker");
  assert.equal(result.rounds, 0);
  assert.equal(result.attackerPlatoons[0].entries[0].count, 1);
});

test("resolveBattle: auto self-retreat policy peels a weakened platoon off the field with a 15% loss", () => {
  const attacker = makePlatoons([
    [{ unitTypeId: "grunt", count: 20 }],
    [{ unitTypeId: "grunt", count: 20 }],
  ]);
  const defender = makePlatoons([[{ unitTypeId: "tank", count: 1 }]]);
  const result = resolveBattle(attacker, defender, {
    unitTypes,
    obstacleSeed: 11,
    attackerRetreatPolicy: { kind: "auto", selfRetreatHpPct: 0.9, heroRetreatHpPct: 0 },
  });
  const selfRetreats = result.log.filter((e) => e.kind === "self_retreat");
  assert.ok(selfRetreats.length > 0, "expected at least one self-retreat");
  const retreatedResult = result.attackerResults.find((r) => r.outcome === "retreated_self");
  assert.ok(retreatedResult, "expected a platoon result marked retreated_self");
});

test("resolveBattle: auto hero-retreat policy pulls the whole side out and applies the Renown penalty", () => {
  const attacker = makePlatoons([[{ unitTypeId: "grunt", count: 20 }]]);
  const defender = makePlatoons([[{ unitTypeId: "tank", count: 1 }]]);
  const result = resolveBattle(attacker, defender, {
    unitTypes,
    obstacleSeed: 5,
    attackerRetreatPolicy: { kind: "auto", selfRetreatHpPct: 0, heroRetreatHpPct: 0.9 },
  });
  assert.equal(result.attackerOutcome, "retreated_hero");
  assert.equal(result.winner, "defender");
  assert.equal(result.attackerRenownDelta, -0.5);
});

test("resolveBattle: custom retreat policy is consulted per round and can decline to retreat", () => {
  const attacker = makePlatoons([[{ unitTypeId: "hero", count: 1 }]]);
  const defender = makePlatoons([[{ unitTypeId: "weak", count: 200 }]]);
  let calls = 0;
  const result = resolveBattle(attacker, defender, {
    unitTypes,
    obstacleSeed: 9,
    defenderRetreatPolicy: { kind: "custom", decide: () => { calls++; return []; } },
  });
  assert.ok(calls > 0, "expected the custom policy to be consulted at least once");
  assert.equal(result.defenderOutcome, "lost_all_troops");
});

test("resolveBattle: a platoon that survives a hit counters, and a counter can itself be countered once", () => {
  // Symmetric platoons, both sides act once per round (alternating turns).
  // Attacker's turn: it hits defender (primary); defender still has its
  // charge, so it counters; attacker still has its own charge (untouched
  // by throwing the primary attack), so it counters the counter; defender's
  // charge is now spent, so the chain stops there (3 hits). Defender's own
  // turn follows: it hits attacker (primary) — attacker's charge was spent
  // countering-the-counter a moment ago and only refills at the start of
  // its own turn, so this one goes uncountered (1 hit). 4 total.
  const attacker = makePlatoons([[{ unitTypeId: "grunt", count: 20 }]]);
  const defender = makePlatoons([[{ unitTypeId: "grunt", count: 20 }]]);
  const result = resolveBattle(attacker, defender, { unitTypes, obstacleSeed: 1, maxRounds: 1 });
  const round1 = result.log.filter((e) => e.round === 1 && e.kind === "damage") as Array<{ isCounterattack: boolean; side: string }>;
  assert.equal(round1.length, 4);
  assert.deepEqual(round1.map((e) => e.isCounterattack), [false, true, true, false]);
  assert.deepEqual(round1.map((e) => e.side), ["attacker", "defender", "attacker", "defender"]);
});

test("computeDamage: infantry attacking cavalry gets the advantage multiplier", () => {
  const neutral = computeDamage([{ unitTypeId: "rng", count: 1 }], [{ unitTypeId: "rng", count: 1 }], unitTypes, 1);
  const advantaged = computeDamage([{ unitTypeId: "inf", count: 1 }], [{ unitTypeId: "cav", count: 1 }], unitTypes, 1);
  const disadvantaged = computeDamage([{ unitTypeId: "cav", count: 1 }], [{ unitTypeId: "inf", count: 1 }], unitTypes, 1);
  assert.equal(neutral.advantageBonus, false);
  assert.equal(advantaged.advantageBonus, true);
  assert.equal(disadvantaged.disadvantagePenalty, true);
  assert.ok(advantaged.damage > neutral.damage);
  assert.ok(disadvantaged.damage < neutral.damage);
});

test("computeDamage: monster is always advantaged attacking and never disadvantaged", () => {
  const monsterAttacks = computeDamage([{ unitTypeId: "mon", count: 1 }], [{ unitTypeId: "inf", count: 1 }], unitTypes, 1);
  const attacksMonster = computeDamage([{ unitTypeId: "inf", count: 1 }], [{ unitTypeId: "mon", count: 1 }], unitTypes, 1);
  assert.equal(monsterAttacks.advantageBonus, true);
  assert.equal(attacksMonster.advantageBonus, false);
  assert.equal(attacksMonster.disadvantagePenalty, false);
});

// ---- Morale & fatigue (docs/morale-fatigue-plan.md) ------------------------

type MoraleChangeEntry = Extract<BattleLogEntry, { kind: "morale_change" }>;

function isMoraleChange(e: BattleLogEntry): e is MoraleChangeEntry {
  return e.kind === "morale_change";
}

test("fatigue/morale multiplier curve: fresh = 1, bounded degradation at the extremes", () => {
  assert.equal(fatigueMultiplier(0), 1);
  assert.equal(fatigueMultiplier(100), 1 - FATIGUE_MAX_PENALTY);
  assert.equal(fatigueMultiplier(1000), 1 - FATIGUE_MAX_PENALTY, "clamped at the 0-100 scale");
  assert.equal(moraleAttackMultiplier(100), 1);
  assert.equal(moraleAttackMultiplier(0), 1 - MORALE_MAX_ATTACK_PENALTY);
  assert.equal(moraleAttackMultiplier(-5), 1 - MORALE_MAX_ATTACK_PENALTY, "clamped at the 0-100 scale");

  const atk = [{ unitTypeId: "grunt", count: 5 }];
  const def = [{ unitTypeId: "grunt", count: 5 }];
  const fresh = computeDamage(atk, def, unitTypes, 1).damage;
  const exhausted = computeDamage(atk, def, unitTypes, 1, { morale: 100, fatigue: 100 }).damage;
  const wavering = computeDamage(atk, def, unitTypes, 1, { morale: 0, fatigue: 0 }).damage;
  const againstTiredDefender = computeDamage(atk, def, unitTypes, 1, undefined, { morale: 100, fatigue: 100 }).damage;
  assert.ok(exhausted < fresh, "full fatigue reduces the attack (effAttack scaled)");
  assert.ok(wavering < fresh, "zero morale reduces the attack (effAttack scaled)");
  assert.ok(againstTiredDefender > fresh, "a fatigued defender absorbs more damage (effDefense scaled)");
});

test("buildCombatants initializes morale at 100 and fatigue at 0", () => {
  const grid = makeBattleGrid(5, 3, 0, 1);
  const combatants = buildCombatants("attacker", [{ entries: [{ unitTypeId: "grunt", count: 5 }] }], grid, unitTypes, "attacker");
  assert.equal(combatants.length, 1);
  assert.equal(combatants[0].morale, 100);
  assert.equal(combatants[0].fatigue, 0);
});

test("resolveBattle: casualties knock morale down, attacks accrue fatigue, and snapshots carry live values", () => {
  const attacker = makePlatoons([[{ unitTypeId: "grunt", count: 20 }]]);
  const defender = makePlatoons([[{ unitTypeId: "grunt", count: 20 }]]);
  const moraleSeen: number[] = [];
  const fatigueSeen: number[] = [];
  const result = resolveBattle(attacker, defender, {
    unitTypes,
    obstacleSeed: 1,
    defenderRetreatPolicy: {
      kind: "custom",
      decide: (snap) => {
        moraleSeen.push(snap.defender[0].morale);
        fatigueSeen.push(snap.defender[0].fatigue);
        return [];
      },
    },
  });

  const casualtyEntries = result.log.filter(isMoraleChange).filter((e) => e.reason === "casualties");
  assert.ok(casualtyEntries.length > 0, "casualties are logged as morale_change entries");
  assert.ok(casualtyEntries.every((e) => e.moraleDelta < 0), "taking casualties only ever lowers morale");
  for (const e of result.log.filter(isMoraleChange)) {
    assert.ok(e.morale >= 0 && e.morale <= 100 && e.fatigue >= 0 && e.fatigue <= 100, "logged values stay on the 0-100 scale");
  }
  assert.ok(
    result.log.filter(isMoraleChange).some((e) => e.reason === "turn_start"),
    "own-turn fatigue recovery is logged",
  );

  // Round 1, defender: it counters while already demoralized by its own
  // casualties (morale 82 dulls the counter to 48 damage / 4 attacker
  // losses), then swings again at morale 68 — net 16 of its own units lost
  // → morale 100 - 16×2 = 68. Fatigue: counter +15, own-turn recovery -5,
  // primary +15 → 25.
  assert.equal(moraleSeen[0], 64 + 4);
  assert.equal(fatigueSeen[0], FATIGUE_PER_ATTACK * 2 - FATIGUE_DECAY_PER_TURN);
});

test("effectiveSelfRetreatHpPct: low morale raises the auto self-retreat threshold, never above one", () => {
  assert.equal(effectiveSelfRetreatHpPct(0.5, 100), 0.5);
  assert.equal(effectiveSelfRetreatHpPct(0.5, MORALE_LOW_THRESHOLD), 0.5, "at the threshold morale, base applies");
  assert.equal(
    effectiveSelfRetreatHpPct(0.5, MORALE_LOW_THRESHOLD - 1),
    0.5 + MORALE_RETREAT_THRESHOLD_REDUCTION,
  );
  assert.equal(effectiveSelfRetreatHpPct(0.95, 0), 1, "clamped at one");
});

test("resolveBattle: a demoralized platoon at 40% HP IS self-retreated at a 50% threshold", () => {
  // 60 weak (hp 5) = 300 HP. The siege counter + its own primary hit land
  // 95 then 92 damage → 19 + 18 = 37 units lost. End of round 1: 115/300 HP
  // ≈ 38% (inside the 50% base threshold) and morale 100 - 37×2 = 26 <
  // MORALE_LOW_THRESHOLD, so the effective threshold is 0.65 and the
  // platoon withdraws. Without the morale effect this exact board would
  // have fought on.
  const attacker = makePlatoons([[{ unitTypeId: "weak", count: 60 }]]);
  const defender = makePlatoons([[{ unitTypeId: "siege", count: 1 }]]);
  const result = resolveBattle(attacker, defender, {
    unitTypes,
    obstacleSeed: 7,
    maxRounds: 1,
    attackerRetreatPolicy: { kind: "auto", selfRetreatHpPct: 0.5, heroRetreatHpPct: 0 },
  });
  const lost = result.attackerResults[0].casualties.reduce((sum, c) => sum + c.count, 0);
  assert.equal(
    lost,
    41,
    "two siege hits of 19 and 18 (37 combat casualties) + the 15% self-retreat loss on the 23 survivors",
  );
  const lastMorale = result.log.filter(isMoraleChange).filter((e) => e.reason === "casualties").pop();
  assert.ok(lastMorale, "the casualties were morale-logged");
  assert.equal(lastMorale!.morale, 26, "morale ended below MORALE_LOW_THRESHOLD");
  const retreats = result.log.filter((e) => e.kind === "self_retreat");
  assert.equal(retreats.length, 1, "≈38% HP < the raised 65% threshold, so the platoon routs despite the 50% base");
});
