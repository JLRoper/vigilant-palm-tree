import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBattle } from "@heroes/engine";
import { computeDamage } from "@heroes/engine";
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
