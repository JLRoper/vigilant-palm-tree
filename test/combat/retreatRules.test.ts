import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyHeroConcession,
  canRetreat,
  finalizeManualBattle,
  getCombatant,
  HERO_BATTLE_MIN_RETREAT_ROUND,
  isOnStartingEdge,
  resetHeroMovement,
  resolveBattle,
  retreatHero,
  retreatPreview,
  SETTLEMENT_BATTLE_MIN_RETREAT_ROUND,
  startManualBattle,
  type ManualBattleState,
} from "@heroes/engine";
import { MOVEMENT_PER_TURN, type HeroState } from "@heroes/contracts";
import { ARMY_STACK_SLOTS, type Platoon, type UnitType } from "../../src/state/units";
import { makeHero, makeSettlement } from "../charter/_helpers";

// plan/2026-10-21-battle-retreat-rules.md: retreat opens at a battle round,
// saves only the platoons on the side's starting edge column (intact), loses
// everyone else, and stuns the retreating hero through the next day.

const unitTypes = {
  footman: { id: "footman", name: "Footman", attack: 5, defence: 5, health: 20, speed: 3, description: "", advantageType: "infantry", range: 1 },
  bowman: { id: "bowman", name: "Bowman", attack: 5, defence: 2, health: 10, speed: 3, description: "", advantageType: "ranged", range: 6 },
  brute: { id: "brute", name: "Brute", attack: 40, defence: 20, health: 200, speed: 3, description: "", advantageType: "infantry", range: 1 },
} as unknown as Record<string, UnitType>;

function army(...slots: Array<{ unitTypeId: string; count: number } | null>): Platoon[] {
  const out: Platoon[] = slots.map((e) => ({ entries: e ? [e] : [] }));
  while (out.length < ARMY_STACK_SLOTS) out.push({ entries: [] });
  return out;
}

function twoPlatoonBattle(minRetreatRound?: number): ManualBattleState {
  return startManualBattle(
    army({ unitTypeId: "footman", count: 10 }, { unitTypeId: "bowman", count: 6 }),
    army({ unitTypeId: "footman", count: 8 }),
    { unitTypes, fixedObstacles: [], ...(minRetreatRound !== undefined ? { minRetreatRound } : {}) },
  );
}

// Walks a platoon one column in from its starting edge (no engine move rules
// involved -- this only sets up "who is on the edge").
function stepOffEdge(state: ManualBattleState, slotIndex: number): void {
  const c = getCombatant(state, "attacker", slotIndex)!;
  c.position = { q: c.position.q + 1, r: c.position.r };
}

test("retreat is closed in round 1 of a hero battle and refusing it mutates nothing", () => {
  const state = twoPlatoonBattle();
  assert.equal(state.minRetreatRound, HERO_BATTLE_MIN_RETREAT_ROUND);
  assert.equal(canRetreat(state), false);
  const logBefore = state.log.length;
  assert.equal(retreatHero(state, "attacker", { edgeOnly: true }), false);
  assert.equal(state.over, false);
  assert.equal(state.log.length, logBefore);
  assert.equal(getCombatant(state, "attacker", 0)!.retreated, false);
});

test("a settlement assault keeps retreat closed until round 3", () => {
  const state = twoPlatoonBattle(SETTLEMENT_BATTLE_MIN_RETREAT_ROUND);
  state.round = 2;
  assert.equal(canRetreat(state), false);
  state.round = 3;
  assert.equal(canRetreat(state), true);
});

test("edge platoons escape intact; platoons off the edge are left behind and lost", () => {
  const state = twoPlatoonBattle();
  state.round = 2;
  stepOffEdge(state, 0);

  const preview = retreatPreview(state, "attacker");
  assert.deepEqual(preview.escaping.map((c) => c.slotIndex), [1]);
  assert.deepEqual(preview.leftBehind.map((c) => c.slotIndex), [0]);

  assert.equal(retreatHero(state, "attacker", { edgeOnly: true }), true);
  assert.equal(state.over, true);
  const leftBehind = state.log.find((e) => e.kind === "left_behind");
  assert.ok(leftBehind && leftBehind.kind === "left_behind");
  assert.equal(leftBehind.slotIndex, 0);
  assert.deepEqual(leftBehind.casualties, [{ unitTypeId: "footman", count: 10 }]);

  const result = finalizeManualBattle(state);
  assert.equal(result.winner, "defender");
  assert.equal(result.attackerOutcome, "retreated_hero");
  assert.deepEqual(result.attackerPlatoons[0], { entries: [] }, "the abandoned platoon is gone");
  assert.deepEqual(result.attackerPlatoons[1], { entries: [{ unitTypeId: "bowman", count: 6 }] }, "the edge platoon keeps every unit");
  assert.deepEqual(result.attackerResults[0].casualties, [{ unitTypeId: "footman", count: 10 }]);
  assert.deepEqual(result.attackerResults[1].casualties, []);
});

test("isOnStartingEdge follows the battle's sideChoice", () => {
  const state = startManualBattle(army({ unitTypeId: "footman", count: 1 }), army({ unitTypeId: "footman", count: 1 }), {
    unitTypes,
    fixedObstacles: [],
    sideChoice: "defender",
  });
  const attacker = getCombatant(state, "attacker", 0)!;
  const defender = getCombatant(state, "defender", 0)!;
  assert.equal(isOnStartingEdge(attacker.position, "attacker", state.grid, "defender"), true);
  assert.equal(isOnStartingEdge(defender.position, "defender", state.grid, "defender"), true);
  assert.equal(isOnStartingEdge(attacker.position, "defender", state.grid, "defender"), false);
});

test("auto-resolver 'outmatched' policy: the losing side retreats once open, melee-engaged platoons are lost", () => {
  const result = resolveBattle(
    army({ unitTypeId: "footman", count: 4 }, { unitTypeId: "bowman", count: 3 }),
    army({ unitTypeId: "footman", count: 10 }),
    {
      unitTypes,
      fixedObstacles: [],
      attackerRetreatPolicy: { kind: "outmatched", strengthRatio: 0.4, minRetreatRound: HERO_BATTLE_MIN_RETREAT_ROUND },
    },
  );
  assert.equal(result.attackerOutcome, "retreated_hero");
  assert.equal(result.winner, "defender");
  const retreatEntry = result.log.find((e) => e.kind === "hero_retreat");
  assert.ok(retreatEntry, "the hero retreat is logged");
  // Decided at the end of round 1, i.e. before round 2 -- the first round
  // retreat is open in a hero battle.
  assert.equal(retreatEntry.round, HERO_BATTLE_MIN_RETREAT_ROUND - 1);
  assert.ok(
    result.log.some((e) => e.kind === "left_behind" && e.slotIndex === 0),
    "the melee-engaged footman is left behind",
  );
  assert.deepEqual(result.attackerPlatoons[0], { entries: [] });
});

test("auto-resolver 'outmatched' policy waits for a later retreat round (settlement assault)", () => {
  const result = resolveBattle(
    army({ unitTypeId: "footman", count: 4 }, { unitTypeId: "bowman", count: 3 }),
    army({ unitTypeId: "footman", count: 10 }),
    {
      unitTypes,
      fixedObstacles: [],
      attackerRetreatPolicy: { kind: "outmatched", strengthRatio: 0.4, minRetreatRound: SETTLEMENT_BATTLE_MIN_RETREAT_ROUND },
    },
  );
  const retreatEntry = result.log.find((e) => e.kind === "hero_retreat");
  if (retreatEntry) assert.ok(retreatEntry.round >= SETTLEMENT_BATTLE_MIN_RETREAT_ROUND - 1);
});

test("auto-resolver 'fight' (the default) never retreats", () => {
  const result = resolveBattle(
    army({ unitTypeId: "footman", count: 4 }),
    army({ unitTypeId: "brute", count: 6 }),
    { unitTypes, fixedObstacles: [] },
  );
  assert.notEqual(result.attackerOutcome, "retreated_hero");
  assert.equal(result.log.some((e) => e.kind === "hero_retreat"), false);
});

function heroAt(overrides: Partial<HeroState> = {}): HeroState {
  return { ...makeHero("h0", 0, 5, 5, { stacks: army({ unitTypeId: "footman", count: 3 }) }), ...overrides };
}

test("resetHeroMovement: a stunned hero gets no movement through the locked day, then the stun clears", () => {
  const heroes = { h0: heroAt({ movementLockedThroughDay: 3, movementRemaining: 0 }) };

  const day3 = resetHeroMovement(heroes, undefined, 3);
  assert.equal(day3.h0.movementRemaining, 0);
  assert.equal(day3.h0.movementLockedThroughDay, 3, "still locked on day 3");

  const day4 = resetHeroMovement(day3, undefined, 4);
  assert.equal(day4.h0.movementRemaining, MOVEMENT_PER_TURN);
  assert.equal("movementLockedThroughDay" in day4.h0, false, "the stun is dropped once it has passed");

  const unscoped = resetHeroMovement(heroes);
  assert.equal(unscoped.h0.movementRemaining, MOVEMENT_PER_TURN, "no day given: no stun applied");
  assert.equal(unscoped.h0.movementLockedThroughDay, 3, "but the stun is not lost either");
});

test("applyHeroConcession: retreat relocates with no movement and stuns through the next day", () => {
  const settlements = { s0: makeSettlement("s0", 0, 1, 1), s1: makeSettlement("s1", 1, 5, 6) };
  const retreated = applyHeroConcession(heroAt({ troops: 99 }), "retreated", { settlements }, 4);
  assert.equal(retreated.q, 1);
  assert.equal(retreated.r, 1);
  assert.equal(retreated.movementRemaining, 0);
  assert.equal(retreated.movementLockedThroughDay, 5);
  assert.equal(retreated.troops, 3, "troops recounted from the surviving stacks");

  const surrendered = applyHeroConcession(heroAt(), "surrendered", { settlements }, 4);
  assert.equal(surrendered.movementRemaining, 0, "a surrender ends the day too");
  assert.equal(surrendered.movementLockedThroughDay, undefined, "but never stuns");

  const stood = heroAt();
  assert.equal(applyHeroConcession(stood, "stood", { settlements }, 4), stood);
});

test("applyHeroConcession never falls back into a settlement the enemy hero is standing on", () => {
  const settlements = { near: makeSettlement("near", 0, 5, 6), far: makeSettlement("far", 0, 1, 1) };
  const retreated = applyHeroConcession(heroAt(), "retreated", { settlements }, 4, [{ q: 5, r: 6 }]);
  assert.equal(retreated.q, 1, "skips the enemy-occupied (about to be captured) settlement");
  assert.equal(retreated.r, 1);
});
