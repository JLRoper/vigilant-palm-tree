import { test } from "node:test";
import assert from "node:assert/strict";
import { settlementIncome, playerIncome } from "../../src/economy/income";
import { createInitialState, type GameState, type PlayerId, type SettlementState } from "../../src/state/gameState";

function makeSettlement(id: string, ownerId: PlayerId | null, population: number, goldTax: number): SettlementState {
  return {
    id,
    ownerId,
    q: 0,
    r: 0,
    level: 1,
    population,
    goldTax,
    resourceRates: {},
    foundedOnResource: null,
  };
}

test("settlementIncome: level 1 (500 pop × 1 tax) = 500", () => {
  assert.equal(settlementIncome(makeSettlement("s", 0, 500, 1)), 500);
});

test("settlementIncome: level 2 (1500 pop × 2 tax) = 3000", () => {
  assert.equal(settlementIncome(makeSettlement("s", 0, 1500, 2)), 3000);
});

test("settlementIncome: level 3 (5000 pop × 3 tax) = 15000", () => {
  assert.equal(settlementIncome(makeSettlement("s", 0, 5000, 3)), 15000);
});

test("playerIncome sums only settlements owned by the given player", () => {
  const state: GameState = createInitialState({
    seedPlayers: [
      { id: 0, faction: "player", name: "Human", color: "#fff", heroIds: ["h0"], settlementIds: ["s0", "s1"], gold: 0 },
      { id: 1, faction: "ai", name: "AI", color: "#000", heroIds: ["h1"], settlementIds: ["s2"], gold: 0 },
    ],
    seedHeroes: [
      { id: "h0", ownerId: 0, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }] },
      { id: "h1", ownerId: 1, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }] },
    ],
    seedSettlements: [
      makeSettlement("s0", 0, 500, 1),
      makeSettlement("s1", 0, 1500, 2),
      makeSettlement("s2", 1, 5000, 3),
    ],
  });
  assert.equal(playerIncome(state, 0), 500 + 3000);
  assert.equal(playerIncome(state, 1), 15000);
});

test("playerIncome ignores neutral settlements and returns 0 for players who own none", () => {
  const state: GameState = createInitialState({
    seedPlayers: [
      { id: 0, faction: "player", name: "P0", color: "#fff", heroIds: ["h0"], settlementIds: ["s0"], gold: 0 },
      { id: 1, faction: "player", name: "P1", color: "#aaa", heroIds: ["h1"], settlementIds: [], gold: 0 },
      { id: 2, faction: "ai", name: "AI", color: "#000", heroIds: ["h2"], settlementIds: [], gold: 0 },
    ],
    seedHeroes: [
      { id: "h0", ownerId: 0, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }] },
      { id: "h1", ownerId: 1, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }] },
      { id: "h2", ownerId: 2, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }] },
    ],
    seedSettlements: [
      makeSettlement("s0", 0, 500, 1),
      makeSettlement("s1", null, 5000, 3),
    ],
  });
  assert.equal(playerIncome(state, 0), 500);
  assert.equal(playerIncome(state, 1), 0);
  assert.equal(playerIncome(state, 2), 0);
});
