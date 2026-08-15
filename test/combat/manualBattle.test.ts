import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attackWithPlatoon,
  executeAiPlan,
  finalizeManualBattle,
  getCombatant,
  getMovementPath,
  getMovementRange,
  getValidAttackTargets,
  getValidMeleeTargets,
  hasLineOfSight,
  isBattleOver,
  movePlatoon,
  pickTarget,
  planAiTurn,
  startManualBattle,
  unactedLivingSlots,
} from "../../shared/combat/manualBattle";
import { estimateWinChance } from "../../shared/combat/damage";
import { ARMY_STACK_SLOTS, type Platoon, type UnitType } from "../../src/state/units";

const unitTypes: Record<string, UnitType> = {
  footman: { id: "footman", name: "Footman", attack: 5, defence: 5, health: 20, speed: 3, description: "", advantageType: "infantry" },
  bowman: { id: "bowman", name: "Bowman", attack: 5, defence: 2, health: 10, speed: 3, description: "", advantageType: "ranged" },
  weak: { id: "weak", name: "Weak", attack: 1, defence: 1, health: 5, speed: 1, description: "", advantageType: "cavalry" },
  hero: { id: "hero", name: "Hero", attack: 200, defence: 0, health: 100, speed: 5, description: "", advantageType: "infantry" },
};

function makePlatoons(entries: { unitTypeId: string; count: number }[]): Platoon[] {
  const out: Platoon[] = [{ entries }];
  while (out.length < ARMY_STACK_SLOTS) out.push({ entries: [] });
  return out;
}

test("getMovementRange: bounded by speed and blocked by obstacles", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);

  const open = startManualBattle(attacker, defender, {
    unitTypes,
    grid: { cols: 7, rows: 1 },
    fixedObstacles: [],
  });
  const openActor = getCombatant(open, "attacker", 0)!;
  const openRange = getMovementRange(open, openActor);
  assert.equal(openRange.length, 3, "footman has speed 3, should reach exactly 3 hexes along the open row");
  assert.ok(openRange.some((h) => h.q === 3 && h.r === 0));
  assert.ok(!openRange.some((h) => h.q === 4 && h.r === 0), "beyond speed range");

  const blocked = startManualBattle(attacker, defender, {
    unitTypes,
    grid: { cols: 7, rows: 1 },
    fixedObstacles: [{ q: 2, r: 0, impassable: true }],
  });
  const blockedActor = getCombatant(blocked, "attacker", 0)!;
  const blockedRange = getMovementRange(blocked, blockedActor);
  assert.ok(!blockedRange.some((h) => h.q === 3 && h.r === 0), "obstacle at q=2 should block the path to q=3");
});

test("getMovementPath: walks the hexes between start and destination, start excluded", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  const state = startManualBattle(attacker, defender, {
    unitTypes,
    grid: { cols: 7, rows: 1 },
    fixedObstacles: [],
  });
  const actor = getCombatant(state, "attacker", 0)!;
  const start = { ...actor.position };

  const path = getMovementPath(state, actor, { q: start.q + 3, r: start.r });
  assert.deepEqual(
    path,
    [
      { q: start.q + 1, r: start.r },
      { q: start.q + 2, r: start.r },
      { q: start.q + 3, r: start.r },
    ],
    "each step is one hex, ending on the destination",
  );

  assert.deepEqual(getMovementPath(state, actor, start), [], "no path to the hex it already occupies");
  assert.deepEqual(
    getMovementPath(state, actor, { q: start.q + 4, r: start.r }),
    [],
    "destination beyond the movement budget is unreachable",
  );
});

test("getMovementPath: every step is adjacent and avoids obstacles", () => {
  const attacker = makePlatoons([{ unitTypeId: "hero", count: 1 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  const state = startManualBattle(attacker, defender, {
    unitTypes,
    grid: { cols: 7, rows: 3 },
    fixedObstacles: [{ q: 1, r: 1, impassable: true }],
  });
  const actor = getCombatant(state, "attacker", 0)!;
  actor.position = { q: 0, r: 1 };

  const path = getMovementPath(state, actor, { q: 2, r: 1 });
  assert.ok(path.length > 0, "a route around the obstacle exists within speed 5");
  assert.deepEqual(path[path.length - 1], { q: 2, r: 1 });
  assert.ok(!path.some((h) => h.q === 1 && h.r === 1), "never routes through the impassable hex");

  const steps = [{ q: 0, r: 1 }, ...path];
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1];
    const b = steps[i];
    const dist = (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
    assert.equal(dist, 1, `step ${i} must be to an adjacent hex`);
  }
});

test("planAiTurn: decides without mutating, and executeAiPlan applies the same result", () => {
  const attacker = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  const defender = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const state = startManualBattle(attacker, defender, {
    unitTypes,
    grid: { cols: 7, rows: 1 },
    fixedObstacles: [],
  });

  const actor = getCombatant(state, "defender", 0)!;
  const before = { ...actor.position };
  const targetHealthBefore = getCombatant(state, "attacker", 0)!.entries[0].count;

  const plan = planAiTurn(state, "defender");
  assert.ok(plan, "the AI has a platoon to act with");
  assert.equal(plan!.slotIndex, 0);
  assert.deepEqual(actor.position, before, "planning alone must not move anything");
  assert.equal(getCombatant(state, "attacker", 0)!.entries[0].count, targetHealthBefore, "planning alone must not deal damage");
  assert.ok(unactedLivingSlots(state, "defender").includes(0), "planning alone must not consume the turn");

  executeAiPlan(state, "defender", plan!);
  assert.ok(!unactedLivingSlots(state, "defender").includes(0), "executing always consumes the platoon's turn");
});

test("executeAiPlan: consumes the turn even when the attack is not legal", () => {
  const attacker = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  const defender = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const state = startManualBattle(attacker, defender, {
    unitTypes,
    grid: { cols: 7, rows: 1 },
    fixedObstacles: [],
  });

  // A melee attack against an enemy that is nowhere near adjacent — the
  // engine refuses it, and the platoon must still not be left owed a turn.
  executeAiPlan(state, "defender", { slotIndex: 0, moveTo: null, attackTargetSlot: 0 });
  assert.deepEqual(unactedLivingSlots(state, "defender"), [], "slot cleared despite the refused attack");
});

test("hasLineOfSight: blocked by an obstacle directly between shooter and target", () => {
  const attacker = makePlatoons([{ unitTypeId: "bowman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);

  const clear = startManualBattle(attacker, defender, { unitTypes, grid: { cols: 7, rows: 1 }, fixedObstacles: [] });
  assert.equal(hasLineOfSight(clear.grid, { q: 0, r: 0 }, { q: 6, r: 0 }), true);

  const blocked = startManualBattle(attacker, defender, {
    unitTypes,
    grid: { cols: 7, rows: 1 },
    fixedObstacles: [{ q: 3, r: 0, impassable: true }],
  });
  assert.equal(hasLineOfSight(blocked.grid, { q: 0, r: 0 }, { q: 6, r: 0 }), false);
});

test("attackWithPlatoon: melee rejected when not adjacent, ranged rejected beyond RANGED_ATTACK_RANGE", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  // Default 15x11 grid deploys the two sides on opposite outer columns —
  // far apart, well outside both melee adjacency and ranged range.
  const state = startManualBattle(attacker, defender, { unitTypes, fixedObstacles: [] });
  const actor = getCombatant(state, "attacker", 0)!;
  assert.equal(getValidAttackTargets(state, actor).length, 0);
  assert.equal(attackWithPlatoon(state, "attacker", 0, 0), false);

  const rangedAttacker = makePlatoons([{ unitTypeId: "bowman", count: 5 }]);
  const rangedState = startManualBattle(rangedAttacker, defender, {
    unitTypes,
    grid: { cols: 7, rows: 1 },
    fixedObstacles: [],
  });
  // Distance here is exactly 6 (== RANGED_ATTACK_RANGE), so this should succeed.
  const rangedActor = getCombatant(rangedState, "attacker", 0)!;
  assert.equal(getValidAttackTargets(rangedState, rangedActor).length, 1);
  assert.equal(attackWithPlatoon(rangedState, "attacker", 0, 0), true);
});

test("isBattleOver / finalizeManualBattle: detects a wipeout and reports the winner", () => {
  const attacker = makePlatoons([{ unitTypeId: "hero", count: 1 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  const state = startManualBattle(attacker, defender, { unitTypes, grid: { cols: 2, rows: 1 }, fixedObstacles: [] });

  assert.equal(isBattleOver(state), false);
  const success = attackWithPlatoon(state, "attacker", 0, 0);
  assert.equal(success, true);
  assert.equal(isBattleOver(state), true);

  const result = finalizeManualBattle(state);
  assert.equal(result.winner, "attacker");
  assert.equal(result.defenderOutcome, "lost_all_troops");
});

test("movePlatoon: total distance per turn is capped at speed, even spread across multiple moves", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]); // speed 3
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  const state = startManualBattle(attacker, defender, { unitTypes, grid: { cols: 12, rows: 1 }, fixedObstacles: [] });
  const actor = getCombatant(state, "attacker", 0)!;

  const firstRange = getMovementRange(state, actor);
  assert.equal(firstRange.length, 3, "footman (speed 3) should reach exactly 3 hexes on the open row");

  // Using the platoon's full speed in one move still leaves it capped —
  // this is the bug the user originally reported: re-selecting after a move
  // re-calculated a fresh full-speed range from the new position, letting a
  // platoon "walk" indefinitely per turn.
  assert.equal(movePlatoon(state, "attacker", 0, { q: 3, r: 0 }), true);
  assert.equal(actor.position.q, 3);
  assert.deepEqual(getMovementRange(state, actor), []);
  assert.equal(movePlatoon(state, "attacker", 0, { q: 4, r: 0 }), false);
  assert.equal(actor.position.q, 3, "position must be unchanged after the rejected move");
});

test("movePlatoon: unspent movement carries over across multiple moves within the same turn", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]); // speed 3
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  const state = startManualBattle(attacker, defender, { unitTypes, grid: { cols: 12, rows: 1 }, fixedObstacles: [] });
  const actor = getCombatant(state, "attacker", 0)!;

  // Take just 1 of the 3 available steps.
  assert.equal(movePlatoon(state, "attacker", 0, { q: 1, r: 0 }), true);

  // The platoon should still be offered its remaining 2 steps of movement
  // (reachable in either direction along the row: q=0 behind, q=2/q=3
  // ahead), not treated as having already used its one move for the turn.
  const rangeAfterFirstStep = getMovementRange(state, actor);
  assert.equal(rangeAfterFirstStep.length, 3, "2 remaining steps reach q=0, q=2, and q=3 from q=1");
  assert.ok(rangeAfterFirstStep.some((h) => h.q === 3 && h.r === 0), "2 more steps should reach q=3");
  assert.ok(!rangeAfterFirstStep.some((h) => h.q === 4 && h.r === 0), "beyond the remaining budget");

  // Use up the remaining budget exactly.
  assert.equal(movePlatoon(state, "attacker", 0, { q: 3, r: 0 }), true);
  assert.equal(actor.position.q, 3);
  assert.deepEqual(getMovementRange(state, actor), [], "budget fully spent — no further movement this turn");
  assert.equal(movePlatoon(state, "attacker", 0, { q: 4, r: 0 }), false);
});

test("moving into an adjacent hex puts the enemy in getValidMeleeTargets, and attacking causes casualties", () => {
  // Mirrors the manual-fight arena's "bump into contact" behavior: the
  // player moves a platoon, the engine reports it's now touching an enemy
  // hex, and resolving that attack costs the defender units based on stats.
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]); // speed 3
  const defender = makePlatoons([{ unitTypeId: "weak", count: 50 }]);
  const state = startManualBattle(attacker, defender, { unitTypes, grid: { cols: 4, rows: 1 }, fixedObstacles: [] });
  const actor = getCombatant(state, "attacker", 0)!;
  const enemy = getCombatant(state, "defender", 0)!;

  // Attacker deploys at q=0, defender at q=3 (cols-1) — not adjacent yet.
  assert.equal(getValidMeleeTargets(state, actor).length, 0);

  assert.equal(movePlatoon(state, "attacker", 0, { q: 2, r: 0 }), true);
  const adjacent = getValidMeleeTargets(state, actor);
  assert.equal(adjacent.length, 1, "after moving next to it, the enemy platoon is now a valid melee target");
  assert.equal(adjacent[0].slotIndex, enemy.slotIndex);

  const target = pickTarget(adjacent, unitTypes)!;
  const beforeCount = enemy.entries[0].count;
  assert.equal(attackWithPlatoon(state, "attacker", 0, target.slotIndex), true);
  const afterCount = enemy.entries[0]?.count ?? 0;
  assert.ok(afterCount < beforeCount, "the defending platoon should have taken casualties from the bump attack");
});

test("estimateWinChance: symmetric for identical platoons, skewed toward the stronger one", () => {
  const even = [{ unitTypeId: "footman", count: 10 }];
  assert.equal(estimateWinChance(even, even, unitTypes), 50);

  const strong = [{ unitTypeId: "hero", count: 1 }];
  const weak = [{ unitTypeId: "weak", count: 1 }];
  const strongChance = estimateWinChance(strong, weak, unitTypes);
  const weakChance = estimateWinChance(weak, strong, unitTypes);
  assert.ok(strongChance > 90, `expected the hero to be heavily favored, got ${strongChance}%`);
  assert.equal(strongChance + weakChance, 100);
});
