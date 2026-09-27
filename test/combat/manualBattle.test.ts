import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeEffectMultiplier,
  attackFromHex,
  attackWithPlatoon,
  castSpell,
  endPlatoonTurn,
  executeAiPlan,
  FATIGUE_DECAY_PER_TURN,
  FATIGUE_PER_ATTACK,
  FATIGUE_PER_MOVE,
  finalizeManualBattle,
  getApproachHexes,
  getCombatant,
  getMovementPath,
  getMovementRange,
  getValidAttackTargets,
  getValidMeleeTargets,
  getValidSpellTargets,
  hasLineOfSight,
  isBattleOver,
  MORALE_GAIN_PER_KILL,
  MORALE_LOSS_PER_ADJACENT_DEATH,
  MORALE_LOSS_PER_CASUALTY,
  movePlatoon,
  pickTarget,
  planAiTurn,
  SPELL_BUFF_DURATION_ROUNDS,
  SPELL_BUFF_MULTIPLIER,
  SPELL_MANA_COST,
  startManualBattle,
  unactedLivingSlots,
  type BattleLogEntry,
  type HeroSpellLoadout,
  type ManualBattleState,
} from "@heroes/engine";
import { estimateWinChance } from "@heroes/engine";
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

// Directional melee targeting: the player picks which of the hexes around an
// enemy their platoon closes in from. These tests place combatants directly
// rather than walking them out of their deployment columns — the geometry
// under test is "the six hexes around a target", which is fiddly to reach
// from the board edge and unrelated to how a platoon got there.
const APPROACH_GRID = { cols: 7, rows: 5 };

function sortHexes(hexes: { hex: { q: number; r: number } }[]): string[] {
  return hexes.map((a) => `${a.hex.q},${a.hex.r}`).sort();
}

test("getApproachHexes: every free neighbour of the target that's within reach", () => {
  // hero has speed 5 — enough to walk around the target to any of its six
  // sides, including the far one that needs a detour past the enemy itself.
  const attacker = makePlatoons([{ unitTypeId: "hero", count: 1 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  const state = startManualBattle(attacker, defender, { unitTypes, grid: APPROACH_GRID, fixedObstacles: [] });
  const actor = getCombatant(state, "attacker", 0)!;
  const enemy = getCombatant(state, "defender", 0)!;
  actor.position = { q: 0, r: 2 };
  enemy.position = { q: 3, r: 2 };

  assert.deepEqual(
    sortHexes(getApproachHexes(state, actor, enemy)),
    ["2,2", "2,3", "3,1", "3,3", "4,1", "4,2"].sort(),
    "all six sides of a mid-board target are reachable at speed 5",
  );
});

test("getApproachHexes: excludes impassable, occupied, and out-of-budget sides", () => {
  const attacker = makePlatoons([{ unitTypeId: "hero", count: 1 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);

  const blocked = startManualBattle(attacker, defender, {
    unitTypes,
    grid: APPROACH_GRID,
    fixedObstacles: [{ q: 3, r: 3, impassable: true }],
  });
  const blockedActor = getCombatant(blocked, "attacker", 0)!;
  const blockedEnemy = getCombatant(blocked, "defender", 0)!;
  blockedActor.position = { q: 0, r: 2 };
  blockedEnemy.position = { q: 3, r: 2 };
  const blockedHexes = sortHexes(getApproachHexes(blocked, blockedActor, blockedEnemy));
  assert.ok(!blockedHexes.includes("3,3"), "an impassable side is not an approach hex");
  assert.equal(blockedHexes.length, 5);

  // A second enemy platoon standing on one of the sides takes that side away.
  const crowdedDefenders = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  crowdedDefenders[1] = { entries: [{ unitTypeId: "weak", count: 1 }] };
  const crowded = startManualBattle(attacker, crowdedDefenders, {
    unitTypes,
    grid: APPROACH_GRID,
    fixedObstacles: [],
  });
  const crowdedActor = getCombatant(crowded, "attacker", 0)!;
  const crowdedEnemy = getCombatant(crowded, "defender", 0)!;
  crowdedActor.position = { q: 0, r: 2 };
  crowdedEnemy.position = { q: 3, r: 2 };
  getCombatant(crowded, "defender", 1)!.position = { q: 2, r: 2 };
  const crowdedHexes = sortHexes(getApproachHexes(crowded, crowdedActor, crowdedEnemy));
  assert.ok(!crowdedHexes.includes("2,2"), "a side occupied by another platoon is not an approach hex");

  // footman has speed 3, so only the near sides are in budget this round.
  const slowAttacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const slow = startManualBattle(slowAttacker, defender, { unitTypes, grid: APPROACH_GRID, fixedObstacles: [] });
  const slowActor = getCombatant(slow, "attacker", 0)!;
  const slowEnemy = getCombatant(slow, "defender", 0)!;
  slowActor.position = { q: 0, r: 2 };
  slowEnemy.position = { q: 3, r: 2 };
  assert.deepEqual(
    sortHexes(getApproachHexes(slow, slowActor, slowEnemy)),
    ["2,2", "2,3", "3,1"].sort(),
    "the three far sides cost 4-5 hexes, beyond a speed-3 platoon's budget",
  );
});

test("getApproachHexes: a platoon already adjacent gets its current hex back at cost 0", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  const state = startManualBattle(attacker, defender, { unitTypes, grid: APPROACH_GRID, fixedObstacles: [] });
  const actor = getCombatant(state, "attacker", 0)!;
  const enemy = getCombatant(state, "defender", 0)!;
  actor.position = { q: 2, r: 2 };
  enemy.position = { q: 3, r: 2 };

  const here = getApproachHexes(state, actor, enemy).find((a) => a.hex.q === 2 && a.hex.r === 2);
  assert.ok(here, "standing beside the target, your own hex is an approach hex");
  assert.equal(here.cost, 0, "attacking from where you already stand costs no movement");
});

test("getApproachHexes: empty for a ranged platoon and for an unreachable target", () => {
  const ranged = makePlatoons([{ unitTypeId: "bowman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  const rangedState = startManualBattle(ranged, defender, { unitTypes, grid: APPROACH_GRID, fixedObstacles: [] });
  const rangedActor = getCombatant(rangedState, "attacker", 0)!;
  const rangedEnemy = getCombatant(rangedState, "defender", 0)!;
  rangedActor.position = { q: 2, r: 2 };
  rangedEnemy.position = { q: 3, r: 2 };
  assert.deepEqual(getApproachHexes(rangedState, rangedActor, rangedEnemy), [], "ranged platoons pick range, not a side");

  // A speed-3 melee platoon parked at the far end of the board can't reach
  // any side of the target this round.
  const melee = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const far = startManualBattle(melee, defender, { unitTypes, grid: APPROACH_GRID, fixedObstacles: [] });
  const farActor = getCombatant(far, "attacker", 0)!;
  const farEnemy = getCombatant(far, "defender", 0)!;
  farActor.position = { q: 0, r: 2 };
  farEnemy.position = { q: 6, r: 2 };
  assert.deepEqual(getApproachHexes(far, farActor, farEnemy), []);
});

test("attackFromHex: moves to the chosen side, attacks, and spends the turn", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 50 }]);
  const state = startManualBattle(attacker, defender, { unitTypes, grid: APPROACH_GRID, fixedObstacles: [] });
  const actor = getCombatant(state, "attacker", 0)!;
  const enemy = getCombatant(state, "defender", 0)!;
  actor.position = { q: 1, r: 2 };
  enemy.position = { q: 3, r: 2 };

  const beforeCount = enemy.entries[0].count;
  // Approach from *below* the target rather than the head-on hex a plain
  // move would have picked.
  assert.equal(attackFromHex(state, "attacker", 0, 0, { q: 2, r: 3 }), true);
  assert.deepEqual(actor.position, { q: 2, r: 3 }, "the platoon ends the action on the side it chose");
  assert.ok(enemy.entries[0].count < beforeCount, "the target took casualties");
  assert.ok(!unactedLivingSlots(state, "attacker").includes(0), "attacking consumes the platoon's turn");
});

test("attackFromHex: attacks in place when the chosen hex is where the platoon already stands", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 50 }]);
  const state = startManualBattle(attacker, defender, { unitTypes, grid: APPROACH_GRID, fixedObstacles: [] });
  const actor = getCombatant(state, "attacker", 0)!;
  const enemy = getCombatant(state, "defender", 0)!;
  actor.position = { q: 2, r: 2 };
  enemy.position = { q: 3, r: 2 };

  const beforeCount = enemy.entries[0].count;
  assert.equal(attackFromHex(state, "attacker", 0, 0, { q: 2, r: 2 }), true);
  assert.deepEqual(actor.position, { q: 2, r: 2 }, "no movement — it was already on the side it wanted");
  assert.ok(enemy.entries[0].count < beforeCount);
});

test("attackFromHex: every rejection leaves the battle exactly as it was", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]); // speed 3
  const defender = makePlatoons([{ unitTypeId: "weak", count: 50 }]);

  function fresh() {
    const state = startManualBattle(attacker, defender, { unitTypes, grid: APPROACH_GRID, fixedObstacles: [] });
    const actor = getCombatant(state, "attacker", 0)!;
    const enemy = getCombatant(state, "defender", 0)!;
    actor.position = { q: 1, r: 2 };
    enemy.position = { q: 3, r: 2 };
    return { state, actor, enemy };
  }

  function assertUntouched(label: string, ctx: ReturnType<typeof fresh>, expectedRange: number): void {
    assert.deepEqual(ctx.actor.position, { q: 1, r: 2 }, `${label}: platoon must not have moved`);
    assert.equal(ctx.state.log.length, 0, `${label}: nothing may be written to the combat log`);
    assert.equal(ctx.enemy.entries[0].count, 50, `${label}: the target must be unharmed`);
    assert.equal(getMovementRange(ctx.state, ctx.actor).length, expectedRange, `${label}: movement budget must be intact`);
  }

  const untouchedRange = getMovementRange(fresh().state, fresh().actor).length;

  // Not a side of the target at all — two hexes away from it.
  const notAdjacent = fresh();
  assert.equal(attackFromHex(notAdjacent.state, "attacker", 0, 0, { q: 1, r: 2 }), false);
  assertUntouched("non-adjacent fromHex", notAdjacent, untouchedRange);

  // A genuine side of the target, but 4 hexes away — beyond speed 3.
  const outOfBudget = fresh();
  assert.equal(attackFromHex(outOfBudget.state, "attacker", 0, 0, { q: 4, r: 2 }), false);
  assertUntouched("out-of-budget fromHex", outOfBudget, untouchedRange);

  // A legal side, but the platoon has already acted this round.
  const spent = fresh();
  endPlatoonTurn(spent.state, "attacker", 0);
  assert.equal(attackFromHex(spent.state, "attacker", 0, 0, { q: 2, r: 2 }), false);
  assert.deepEqual(spent.actor.position, { q: 1, r: 2 }, "already-acted platoon must not have moved");
  assert.equal(spent.enemy.entries[0].count, 50, "already-acted platoon must not have attacked");
});

test("attackFromHex: rejected for a ranged platoon", () => {
  const ranged = makePlatoons([{ unitTypeId: "bowman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 50 }]);
  const state = startManualBattle(ranged, defender, { unitTypes, grid: APPROACH_GRID, fixedObstacles: [] });
  const actor = getCombatant(state, "attacker", 0)!;
  const enemy = getCombatant(state, "defender", 0)!;
  actor.position = { q: 1, r: 2 };
  enemy.position = { q: 3, r: 2 };

  assert.equal(attackFromHex(state, "attacker", 0, 0, { q: 2, r: 2 }), false);
  assert.deepEqual(actor.position, { q: 1, r: 2 });
  // The existing shoot-from-where-you-stand path is unaffected.
  assert.equal(attackWithPlatoon(state, "attacker", 0, 0), true);
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

// ---- Morale & fatigue (docs/morale-fatigue-plan.md) ------------------------

type MoraleChangeEntry = Extract<BattleLogEntry, { kind: "morale_change" }>;

function isMoraleChange(e: BattleLogEntry): e is MoraleChangeEntry {
  return e.kind === "morale_change";
}

function firstDamageOf(state: ManualBattleState): number {
  for (const e of state.log) {
    if (e.kind === "damage") return e.damage;
  }
  return -1;
}

function stackPlatoons(list: { unitTypeId: string; count: number }[][]): Platoon[] {
  const out: Platoon[] = list.map((entries) => ({ entries }));
  while (out.length < ARMY_STACK_SLOTS) out.push({ entries: [] });
  return out;
}

test("fatigue accrues per move and per attack, decays at the round boundary, and every change is logged", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 50 }]);
  const state = startManualBattle(attacker, defender, { unitTypes, grid: { cols: 4, rows: 1 }, fixedObstacles: [] });
  const actor = getCombatant(state, "attacker", 0)!;
  const enemy = getCombatant(state, "defender", 0)!;

  assert.equal(movePlatoon(state, "attacker", 0, { q: 2, r: 0 }), true);
  assert.equal(actor.fatigue, FATIGUE_PER_MOVE, "one move action accrues exactly FATIGUE_PER_MOVE");

  assert.equal(attackWithPlatoon(state, "attacker", 0, enemy.slotIndex), true);
  assert.equal(actor.fatigue, FATIGUE_PER_MOVE + FATIGUE_PER_ATTACK, "the attack stacks fatigue on the move's");

  assert.equal(endPlatoonTurn(state, "defender", 0), true);
  assert.equal(state.round, 2, "both sides having acted advances the round");
  assert.equal(
    actor.fatigue,
    FATIGUE_PER_MOVE + FATIGUE_PER_ATTACK - FATIGUE_DECAY_PER_TURN,
    "the round boundary is every living platoon's turn start, so fatigue partially recovers",
  );
  assert.equal(getCombatant(state, "defender", 0)!.fatigue, 0, "decay never pushes fatigue below zero");

  const reasons = state.log.filter(isMoraleChange).map((e) => e.reason);
  assert.ok(reasons.includes("move"), "move fatigue is a logged morale_change entry");
  assert.ok(reasons.includes("attack"), "attack fatigue is a logged morale_change entry");
  assert.ok(reasons.includes("turn_start"), "turn-start decay is a logged morale_change entry");
  const moveEntry = state.log.filter(isMoraleChange).find((e) => e.reason === "move")!;
  assert.deepEqual(
    { moraleDelta: moveEntry.moraleDelta, fatigueDelta: moveEntry.fatigueDelta, morale: moveEntry.morale, fatigue: moveEntry.fatigue },
    { moraleDelta: 0, fatigueDelta: FATIGUE_PER_MOVE, morale: 100, fatigue: FATIGUE_PER_MOVE },
    "the log entry carries the applied deltas and the resulting values",
  );
});

test("morale drops on casualties taken, wavers next to a destroyed ally, and rises on a kill", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 50 }]);
  const state = startManualBattle(attacker, defender, { unitTypes, grid: { cols: 4, rows: 1 }, fixedObstacles: [] });
  const actor = getCombatant(state, "attacker", 0)!;
  const enemy = getCombatant(state, "defender", 0)!;

  // Close to melee first (deployments start 3 hexes apart), then attack.
  // footman×5 (with move fatigue + the infantry-beats-cavalry ×1.3) deals
  // exactly 31 damage to weak (hp 5): 6 units lost, -12 morale.
  assert.equal(movePlatoon(state, "attacker", 0, { q: 2, r: 0 }), true);
  assert.equal(attackWithPlatoon(state, "attacker", 0, enemy.slotIndex), true);
  assert.equal(enemy.entries[0].count, 44, "6 weak units lost to the attack");
  assert.equal(enemy.morale, 100 - 6 * MORALE_LOSS_PER_CASUALTY, "each unit lost costs the platoon its own morale");
  const casualtyEntry = state.log.filter(isMoraleChange).find((e) => e.reason === "casualties")!;
  assert.equal(casualtyEntry.slotIndex, enemy.slotIndex);
  assert.equal(casualtyEntry.moraleDelta, -6 * MORALE_LOSS_PER_CASUALTY);

  // Now the kill case: hero (atk 200) wipes a 1-unit platoon; allies next to
  // the loss waver, an ally 3 hexes away does not, and the killer recovers
  // morale (pre-dropped below the clamp so the gain is observable).
  const defenders = stackPlatoons([
    [{ unitTypeId: "weak", count: 1 }],
    [{ unitTypeId: "weak", count: 1 }],
    [{ unitTypeId: "weak", count: 1 }],
  ]);
  const killState = startManualBattle(makePlatoons([{ unitTypeId: "hero", count: 1 }]), defenders, {
    unitTypes,
    grid: { cols: 7, rows: 5 },
    fixedObstacles: [],
  });
  const hero = getCombatant(killState, "attacker", 0)!;
  const doomed = getCombatant(killState, "defender", 0)!;
  const adjacentAlly = getCombatant(killState, "defender", 1)!;
  const farAlly = getCombatant(killState, "defender", 2)!;
  doomed.position = { q: 3, r: 2 };
  adjacentAlly.position = { q: 4, r: 2 };
  farAlly.position = { q: 6, r: 2 };
  hero.position = { q: 2, r: 2 };
  hero.morale = 50;

  assert.equal(attackWithPlatoon(killState, "attacker", 0, doomed.slotIndex), true);
  assert.ok(!doomed.entries.some((e) => e.count > 0), "hero wipes the 1-unit platoon");
  assert.equal(hero.morale, 50 + MORALE_GAIN_PER_KILL, "destroying an enemy platoon restores morale");
  assert.equal(adjacentAlly.morale, 100 - MORALE_LOSS_PER_ADJACENT_DEATH, "an ally next to the loss wavers");
  assert.equal(farAlly.morale, 100, "an ally 3 hexes from the loss is unaffected");
  const reasons = killState.log.filter(isMoraleChange).map((e) => e.reason);
  assert.ok(reasons.includes("kill"));
  assert.ok(reasons.includes("ally_destroyed"));
});

test("fatigue and morale measurably dull the attack through the real engine path", () => {
  function freshBattle() {
    const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
    const defender = makePlatoons([{ unitTypeId: "weak", count: 50 }]);
    const state = startManualBattle(attacker, defender, { unitTypes, grid: { cols: 4, rows: 1 }, fixedObstacles: [] });
    return { state, actor: getCombatant(state, "attacker", 0)! };
  }

  const fresh = freshBattle();
  assert.equal(movePlatoon(fresh.state, "attacker", 0, { q: 2, r: 0 }), true);
  assert.equal(attackWithPlatoon(fresh.state, "attacker", 0, 0), true);
  const freshDamage = firstDamageOf(fresh.state);

  const tired = freshBattle();
  assert.equal(movePlatoon(tired.state, "attacker", 0, { q: 2, r: 0 }), true);
  tired.actor.fatigue = 100;
  tired.actor.morale = 0;
  assert.equal(attackWithPlatoon(tired.state, "attacker", 0, 0), true);
  const tiredDamage = firstDamageOf(tired.state);

  // Both runs make the same approach move first; fresh: effAttack
  // 25 × 0.979 (move fatigue) → 24 damage. Fully fatigued and demoralized:
  // effAttack 25 × 0.65 × 0.7 → 10.
  assert.ok(tiredDamage < freshDamage, `expected a worn-out platoon to hit softer (${tiredDamage} vs ${freshDamage})`);
});

// ---- Spellcasting v1 (docs/spellcasting-plan.md) ---------------------------

function arrowLoadout(overrides: Partial<HeroSpellLoadout> = {}): HeroSpellLoadout {
  return { spell: "magic_arrow", mana: 20, maxMana: 20, power: 10, ...overrides };
}

type SpellCastEntry = Extract<BattleLogEntry, { kind: "spell_cast" }>;

function spellCastsOf(state: ManualBattleState): SpellCastEntry[] {
  return state.log.filter((e): e is SpellCastEntry => e.kind === "spell_cast");
}

test("spellcasting: no loadout means no casting (backward-compatible default)", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 50 }]);
  const state = startManualBattle(attacker, defender, { unitTypes, grid: { cols: 4, rows: 1 }, fixedObstacles: [] });

  assert.deepEqual(getValidSpellTargets(state, "attacker"), [], "no loadout -> no legal targets");
  assert.equal(castSpell(state, "attacker", 0), null, "cast is refused without a loadout");
  assert.equal(state.log.length, 0, "a refused cast writes nothing to the log");
  assert.ok(unactedLivingSlots(state, "attacker").includes(0), "the turn loop is untouched");
  assert.equal(state.round, 1);
});

test("Magic Arrow: flat damage via applyCasualties, mana deducted, spell_cast logged, turn loop untouched", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 50 }]);
  const state = startManualBattle(attacker, defender, {
    unitTypes,
    grid: { cols: 4, rows: 1 },
    fixedObstacles: [],
    heroSpells: { attacker: arrowLoadout() },
  });
  const enemy = getCombatant(state, "defender", 0)!;
  const unactedBefore = new Set(state.unactedAttacker);

  // weak has 5 hp; power 10 flat damage floors out at exactly 2 units lost —
  // the applyCasualties semantics, with no atk/def ratio or type multiplier
  // in the way (footman is infantry, weak is cavalry: a swing would have had
  // the ×1.3 advantage; the arrow must not).
  const cast = castSpell(state, "attacker", 0);
  assert.ok(cast, "the cast applies");
  assert.deepEqual(
    { spell: cast!.spell, side: cast!.side, targetSlot: cast!.targetSlot, damage: cast!.damage, manaSpent: cast!.manaSpent },
    { spell: "magic_arrow", side: "attacker", targetSlot: 0, damage: 10, manaSpent: SPELL_MANA_COST },
    "the spell_cast entry carries the full audit context",
  );
  assert.deepEqual(cast!.casualties, [{ unitTypeId: "weak", count: 2 }]);
  assert.equal(enemy.entries[0].count, 48);
  assert.equal(enemy.morale, 100 - 2 * MORALE_LOSS_PER_CASUALTY, "spell casualties dent morale like swing casualties");

  const loadout = state.heroSpells.attacker!;
  assert.equal(loadout.mana, 20 - SPELL_MANA_COST, "casting spends the spell's mana cost");

  // The Spy-precedent non-interference: casting is the hero's action, not a
  // platoon's — no unacted slot consumed, no round advanced.
  assert.deepEqual(state.unactedAttacker, unactedBefore, "the caster's platoons keep their turns");
  assert.ok(unactedLivingSlots(state, "defender").includes(0), "the target's side keeps its turns");
  assert.equal(state.round, 1, "casting alone never advances the round");

  // Mana is the only limiter: a second cast works, a third is refused.
  assert.equal(castSpell(state, "attacker", 0) !== null, true);
  assert.equal(loadout.mana, 0);
  const logLength = state.log.length;
  assert.equal(castSpell(state, "attacker", 0), null, "out of mana, the cast is refused");
  assert.equal(state.log.length, logLength, "the refused cast logs nothing");
});

test("Magic Arrow: a killing blow ends the battle", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = makePlatoons([{ unitTypeId: "weak", count: 1 }]);
  const state = startManualBattle(attacker, defender, {
    unitTypes,
    grid: { cols: 4, rows: 1 },
    fixedObstacles: [],
    heroSpells: { attacker: arrowLoadout() },
  });
  assert.equal(isBattleOver(state), false);
  assert.ok(castSpell(state, "attacker", 0));
  assert.equal(isBattleOver(state), true, "the arrow wiped the last enemy platoon");
});

test("getValidSpellTargets: living enemies for a damage spell, own living platoons for a buff, none without a loadout", () => {
  const attacker = [{ entries: [{ unitTypeId: "footman", count: 5 }] }, { entries: [{ unitTypeId: "weak", count: 1 }] }];
  const defender = [{ entries: [{ unitTypeId: "weak", count: 50 }] }];
  const base = { unitTypes, grid: { cols: 4, rows: 1 }, fixedObstacles: [] };

  const arrow = startManualBattle(attacker, defender, { ...base, heroSpells: { attacker: arrowLoadout() } });
  assert.deepEqual(
    getValidSpellTargets(arrow, "attacker").map((t) => `${t.side}:${t.slotIndex}`),
    ["defender:0"],
    "Magic Arrow targets the enemy side only",
  );
  getCombatant(arrow, "defender", 0)!.retreated = true;
  assert.deepEqual(getValidSpellTargets(arrow, "attacker"), [], "retreated platoons are not targets");

  const bless = startManualBattle(attacker, defender, {
    ...base,
    heroSpells: { attacker: arrowLoadout({ spell: "bless" }) },
  });
  assert.deepEqual(
    getValidSpellTargets(bless, "attacker").map((t) => `${t.side}:${t.slotIndex}`),
    ["attacker:0", "attacker:1"],
    "Bless targets the caster's own living platoons",
  );
});

test("castSpell: illegal targets leave the battle untouched", () => {
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  // Two enemy platoons so slot 1 is a live, castable target slot.
  const defender = [{ entries: [{ unitTypeId: "weak", count: 25 }] }, { entries: [{ unitTypeId: "weak", count: 25 }] }];
  const state = startManualBattle(attacker, defender, {
    unitTypes,
    grid: { cols: 4, rows: 1 },
    fixedObstacles: [],
    heroSpells: { attacker: arrowLoadout() },
  });
  assert.equal(castSpell(state, "attacker", 7), null, "an unknown slot is refused");
  const enemy = getCombatant(state, "defender", 0)!;
  const manaBefore = state.heroSpells.attacker!.mana;
  enemy.retreated = true;
  assert.equal(castSpell(state, "attacker", 0), null, "a retreated platoon is refused");
  assert.equal(getCombatant(state, "defender", 0)!.entries[0].count, 25, "no casualties from refused casts");
  assert.equal(manaBefore, state.heroSpells.attacker!.mana, "no mana spent on refused casts");
  assert.equal(state.log.length, 0);
});

test("Bless: the buff multiplies the blessed platoon's attacks, then expires by round", () => {
  function freshBattle(blessed: boolean) {
    const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
    const defender = makePlatoons([{ unitTypeId: "weak", count: 50 }]);
    const state = startManualBattle(attacker, defender, {
      unitTypes,
      grid: { cols: 4, rows: 1 },
      fixedObstacles: [],
      heroSpells: blessed ? { attacker: arrowLoadout({ spell: "bless" }) } : undefined,
    });
    // Deterministic geometry: attacker at (2,0), defender at (3,0) — already
    // adjacent, so the attack needs no move and no fatigue accrues.
    getCombatant(state, "attacker", 0)!.position = { q: 2, r: 0 };
    getCombatant(state, "defender", 0)!.position = { q: 3, r: 0 };
    return { state, actor: getCombatant(state, "attacker", 0)! };
  }

  const blessed = freshBattle(true);
  const cast = castSpell(blessed.state, "attacker", 0);
  assert.ok(cast, "Bless applies to a friendly platoon");
  assert.deepEqual(
    { multiplier: cast!.multiplier, expiresRound: cast!.expiresRound, damage: cast!.damage },
    { multiplier: SPELL_BUFF_MULTIPLIER, expiresRound: 1 + SPELL_BUFF_DURATION_ROUNDS - 1, damage: undefined },
    "the spell_buff entry records the multiplier and its expiry round",
  );
  assert.equal(blessed.actor.activeEffects.length, 1, "the buff rides the platoon's activeEffects");
  assert.ok(activeEffectMultiplier(blessed.actor, 1) > 1, "the buff is live in the round it was cast");

  assert.equal(attackWithPlatoon(blessed.state, "attacker", 0, 0), true);
  const blessedDamage = firstDamageOf(blessed.state);

  const plain = freshBattle(false);
  assert.equal(attackWithPlatoon(plain.state, "attacker", 0, 0), true);
  const plainDamage = firstDamageOf(plain.state);

  assert.ok(blessedDamage > plainDamage, `blessed swing (${blessedDamage}) must outdamage the plain swing (${plainDamage})`);

  // Advance to the first round past the buff's window: ending both sides'
  // turns advances the round; checkRoundAdvance prunes expired buffs. (The
  // attackers already spent their round-1 turns on the swings above, so the
  // first pass's attacker endPlatoonTurn is a no-op — the defender's is what
  // trips the boundary; later passes consume the refilled slots.)
  while (plain.state.round <= cast!.expiresRound!) {
    endPlatoonTurn(plain.state, "attacker", 0);
    endPlatoonTurn(plain.state, "defender", 0);
    endPlatoonTurn(blessed.state, "attacker", 0);
    endPlatoonTurn(blessed.state, "defender", 0);
  }
  assert.ok(plain.state.round > cast!.expiresRound!, "sanity: we crossed the expiry round");
  assert.equal(blessed.actor.activeEffects.length, 0, "the expired buff is pruned at the round boundary");
  assert.equal(activeEffectMultiplier(blessed.actor, plain.state.round), 1, "no multiplier survives expiry");

  // A fresh blessed platoon attacking after expiry hits like an unblessed one
  // (both sides' slots refilled at the latest round boundary).
  assert.equal(attackWithPlatoon(blessed.state, "attacker", 0, 0), true);
  const afterExpiryDamage = blessed.state.log.filter((e) => e.kind === "damage").at(-1)!.damage;
  assert.equal(afterExpiryDamage, plainDamage, "post-expiry damage matches the unblessed baseline");
});

test("Bless: cannot reach an enemy platoon", () => {
  // The attacker fields ONE platoon (slot 0) while the defender fields two —
  // so defender slot 1 exists but has no attacker-side counterpart. A bless
  // cast at slot 1 must refuse rather than reach across the board.
  const attacker = makePlatoons([{ unitTypeId: "footman", count: 5 }]);
  const defender = [
    { entries: [{ unitTypeId: "weak", count: 25 }] },
    { entries: [{ unitTypeId: "weak", count: 25 }] },
  ];
  const state = startManualBattle(attacker, defender, {
    unitTypes,
    grid: { cols: 4, rows: 1 },
    fixedObstacles: [],
    heroSpells: { attacker: arrowLoadout({ spell: "bless" }) },
  });
  const enemyBefore = getCombatant(state, "defender", 1)!.entries[0].count;
  assert.deepEqual(
    getValidSpellTargets(state, "attacker").map((t) => t.side),
    ["attacker"],
    "the legal pool is the caster's own side only",
  );
  assert.equal(castSpell(state, "attacker", 1), null, "defender slot 1 is unreachable for a friendly buff");
  assert.equal(getCombatant(state, "defender", 1)!.entries[0].count, enemyBefore);
  assert.equal(state.log.length, 0);
  assert.equal(state.heroSpells.attacker!.mana, 20, "no mana spent");
});
