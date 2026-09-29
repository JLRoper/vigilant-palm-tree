import { test } from "node:test";
import assert from "node:assert/strict";
import { applySettlementBattleResult, normalizePlatoons, startSettlementBattle, CAPTURE_GOLD_REWARD } from "@heroes/engine";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";

function stack(unitTypeId: string, count: number) {
  return [{ entries: [{ unitTypeId, count }] }];
}

function garrisonedNeutralSettlement() {
  const s = makeSettlement("s2", null, 5, 5);
  s.stacks = stack("swordsman", 3);
  return s;
}

test("startSettlementBattle accepts a NEUTRAL settlement with a live garrison", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 5, 5, { stacks: stack("swordsman", 5) })],
    settlements: [makeSettlement("s0", 0, 0, 0), garrisonedNeutralSettlement()],
  });

  const result = startSettlementBattle(state, "h0", "s2");

  assert.equal(result.ok, true, "a neutral garrisoned settlement must fight like an enemy-owned one");
  assert.equal(result.state.phase.kind, "SETTLEMENT_BATTLE");
  const phase = result.state.phase;
  assert.equal(phase.kind === "SETTLEMENT_BATTLE" ? phase.settlementId : null, "s2");
  assert.equal(result.state.settlements["s2"]?.ownerId, null, "ownership untouched by starting the battle");
});

test("startSettlementBattle still rejects the attacker's own settlement", () => {
  const own = makeSettlement("s0", 0, 5, 5);
  own.stacks = stack("swordsman", 3);
  const state = makeState({
    heroes: [makeHero("h0", 0, 5, 5, { stacks: stack("swordsman", 5) })],
    settlements: [own],
  });

  const result = startSettlementBattle(state, "h0", "s0");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_enemy_settlement");
});

test("startSettlementBattle still rejects an empty garrison", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 5, 5, { stacks: stack("swordsman", 5) })],
    settlements: [makeSettlement("s0", 0, 0, 0), makeSettlement("s2", null, 5, 5)],
  });

  const result = startSettlementBattle(state, "h0", "s2");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "garrison_empty");
});

test("applySettlementBattleResult: attackerWon captures a NEUTRAL settlement (previousOwnerId null)", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 5, 5, { stacks: stack("swordsman", 5), gold: 50 })],
    settlements: [makeSettlement("s0", 0, 0, 0), garrisonedNeutralSettlement()],
  });

  const result = applySettlementBattleResult(state, {
    attackerId: "h0",
    settlementId: "s2",
    outcome: "attackerWon",
    attackerStacks: stack("swordsman", 4),
    defenderStacks: [],
  });

  assert.equal(result.captured, true);
  assert.equal(result.state.settlements["s2"]?.ownerId, 0, "neutral settlement flipped to the attacker");
  assert.deepEqual(result.state.settlements["s2"]?.stacks, normalizePlatoons([]));
  assert.equal(result.state.heroes["h0"]?.gold, 50 + CAPTURE_GOLD_REWARD);
  assert.deepEqual(result.state.players[0]?.settlementIds, ["s0", "s2"], "roster gains the neutral settlement");
  assert.equal(result.state.phase.kind, "PLAYER_TURN", "the battle phase closed");
});

test("applySettlementBattleResult: defenderWon over a neutral garrison keeps the settlement neutral and REMOVES the wiped attacker", () => {
  const attacker = {
    ...makeHero("h0", 0, 5, 5, { stacks: stack("swordsman", 5) }),
    previousQ: 4,
    previousR: 5,
    previousMovementRemaining: 7,
    movementRemaining: 6,
  };
  const state = makeState({
    heroes: [attacker],
    settlements: [makeSettlement("s0", 0, 0, 0), garrisonedNeutralSettlement()],
  });

  const result = applySettlementBattleResult(state, {
    attackerId: "h0",
    settlementId: "s2",
    outcome: "defenderWon",
    attackerStacks: [],
    defenderStacks: stack("swordsman", 1),
  });

  assert.equal(result.captured, false);
  assert.equal(result.state.settlements["s2"]?.ownerId, null, "no capture on a loss");
  assert.equal(result.state.heroes["h0"], undefined, "a wiped attacker is removed, not bounced");
  assert.deepEqual(result.state.players[0]?.heroIds, []);
  assert.equal(result.attackerVerdict, "defeated");
});

function bouncedAttackerState() {
  const attacker = {
    ...makeHero("h0", 0, 5, 5, { stacks: stack("swordsman", 5), gold: 100 }),
    previousQ: 4,
    previousR: 5,
    previousMovementRemaining: 7,
    movementRemaining: 6,
  };
  return makeState({
    heroes: [attacker, makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 0, 0), garrisonedNeutralSettlement()],
  });
}

test("defenderWon REMOVES the wiped attacker: row deleted, owner heroIds pruned, verdict defeated", () => {
  const state = bouncedAttackerState();

  const result = applySettlementBattleResult(state, {
    attackerId: "h0",
    settlementId: "s2",
    outcome: "defenderWon",
    attackerStacks: [],
    defenderStacks: stack("swordsman", 3),
  });

  assert.equal(result.state.heroes["h0"], undefined, "the wiped attacker is gone from the record");
  assert.deepEqual(result.state.players[0]?.heroIds, [], "owner's heroIds pruned");
  assert.equal(result.attackerVerdict, "defeated");
  assert.deepEqual(result.removedHeroIds, ["h0"]);
  assert.equal(result.captured, false);
  assert.equal(result.state.settlements["s2"]?.ownerId, null, "no capture on a loss");
  assert.equal(result.state.phase.kind, "PLAYER_TURN", "the battle phase still closed");
});

test("a draw that wipes the attacker removes them; a draw with survivors bounces unchanged (verdict stood)", () => {
  const wiped = applySettlementBattleResult(bouncedAttackerState(), {
    attackerId: "h0",
    settlementId: "s2",
    outcome: "draw",
    attackerStacks: [],
    defenderStacks: stack("swordsman", 3),
  });
  assert.equal(wiped.state.heroes["h0"], undefined, "a draw that wipes the attacker is a defeat");
  assert.equal(wiped.attackerVerdict, "defeated");

  const stalemate = applySettlementBattleResult(bouncedAttackerState(), {
    attackerId: "h0",
    settlementId: "s2",
    outcome: "draw",
    attackerStacks: stack("swordsman", 2),
    defenderStacks: stack("swordsman", 2),
  });
  const hero = stalemate.state.heroes["h0"];
  assert.ok(hero, "a stalemate with survivors leaves the attacker standing");
  assert.equal(hero.q, 4, "stalemate still bounces to the pre-move hex");
  assert.deepEqual(hero.stacks, normalizePlatoons(stack("swordsman", 2)));
  assert.equal(stalemate.attackerVerdict, "stood");
  assert.deepEqual(stalemate.removedHeroIds, []);
});

test("retreat zeroes the stacks and relocates to the nearest OWNED settlement", () => {
  const result = applySettlementBattleResult(bouncedAttackerState(), {
    attackerId: "h0",
    settlementId: "s2",
    outcome: "retreat",
    attackerStacks: stack("swordsman", 3),
    defenderStacks: stack("swordsman", 3),
  });

  const hero = result.state.heroes["h0"];
  assert.ok(hero, "a retreat never removes the attacker");
  assert.equal(result.attackerVerdict, "retreated");
  assert.deepEqual(result.removedHeroIds, []);
  assert.equal(hero.q, 0, "relocated to the owner's nearest settlement (s0)");
  assert.equal(hero.r, 0);
  assert.equal(hero.movementRemaining, MOVEMENT_PER_TURN, "fresh-turn movement at the relocation hex");
  assert.deepEqual(hero.trail, [{ q: 0, r: 0 }], "trail reseeded at the settlement");
  assert.deepEqual(hero.stacks, normalizePlatoons([]), "retreat loses ALL troops");
  assert.equal(hero.troops, 0, "the denormalized troops counter zeroes with the stacks");
  assert.equal(result.state.settlements["s2"]?.ownerId, null, "the garrison keeps the settlement");
});

test("retreat with no owned settlement stays at the post-cancel position (D1) with stacks zeroed", () => {
  const state = bouncedAttackerState();
  state.settlements["s0"] = makeSettlement("s0", null, 0, 0);

  const result = applySettlementBattleResult(state, {
    attackerId: "h0",
    settlementId: "s2",
    outcome: "retreat",
    attackerStacks: stack("swordsman", 3),
    defenderStacks: stack("swordsman", 3),
  });

  const hero = result.state.heroes["h0"];
  assert.ok(hero, "D1 keeps the hero in the record");
  assert.equal(result.attackerVerdict, "retreated");
  assert.equal(hero.q, 4, "stays at the cancelled pre-move hex");
  assert.equal(hero.r, 5);
  assert.equal(hero.movementRemaining, 7, "cancelMove's movement restoration stands");
  assert.deepEqual(hero.stacks, normalizePlatoons([]), "troops are still lost");
});

test("surrender relocates to the nearest OWNED settlement keeping stacks, after the gold debit", () => {
  const result = applySettlementBattleResult(bouncedAttackerState(), {
    attackerId: "h0",
    settlementId: "s2",
    outcome: "surrender",
    attackerStacks: stack("swordsman", 5),
    defenderStacks: stack("swordsman", 3),
    surrenderedGold: 40,
  });

  const hero = result.state.heroes["h0"];
  assert.ok(hero, "a surrender never removes the attacker");
  assert.equal(result.attackerVerdict, "surrendered");
  assert.equal(hero.q, 0, "relocated to the owner's nearest settlement");
  assert.equal(hero.r, 0);
  assert.deepEqual(hero.trail, [{ q: 0, r: 0 }]);
  assert.equal(hero.gold, 60, "the surrender price was debited before relocation");
  assert.deepEqual(hero.stacks, normalizePlatoons(stack("swordsman", 5)), "surrender keeps the army");
});

test("attackerWon reports a stood verdict and removes nobody", () => {
  const result = applySettlementBattleResult(bouncedAttackerState(), {
    attackerId: "h0",
    settlementId: "s2",
    outcome: "attackerWon",
    attackerStacks: stack("swordsman", 4),
    defenderStacks: [],
  });

  assert.equal(result.captured, true);
  assert.equal(result.attackerVerdict, "stood");
  assert.deepEqual(result.removedHeroIds, []);
  assert.ok(result.state.heroes["h0"], "the winner stays in the record");
});
