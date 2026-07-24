import { test } from "node:test";
import assert from "node:assert/strict";
import { settlementIncome, playerIncome, playerWealth } from "../../src/economy/income";
import { createInitialState, type GameState, type PlayerId, type SettlementState, type HeroState } from "../../src/state/gameState";

function makeSettlement(id: string, ownerId: PlayerId | null, population: number, goldTax: number, gold = 0): SettlementState {
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
    gold,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    citySpots: [],
    cityMines: [],
    morale: 100,
    autoTrade: true,
  };
}

function makeHeroFields(overrides: Partial<HeroState> = {}): Partial<HeroState> {
  return {
    name: "test",
    gold: 0,
    troops: 1,
    stacks: [],
    isChartering: false,
    charterId: null,
    ...overrides,
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
      { id: 0, faction: "player", name: "Human", color: "#fff", heroIds: ["h0"], settlementIds: ["s0", "s1"] },
      { id: 1, faction: "ai", name: "AI", color: "#000", heroIds: ["h1"], settlementIds: ["s2"] },
    ],
    seedHeroes: [
      { id: "h0", ownerId: 0, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }], ...makeHeroFields() },
      { id: "h1", ownerId: 1, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }], ...makeHeroFields() },
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
      { id: 0, faction: "player", name: "P0", color: "#fff", heroIds: ["h0"], settlementIds: ["s0"] },
      { id: 1, faction: "player", name: "P1", color: "#aaa", heroIds: ["h1"], settlementIds: [] },
      { id: 2, faction: "ai", name: "AI", color: "#000", heroIds: ["h2"], settlementIds: [] },
    ],
    seedHeroes: [
      { id: "h0", ownerId: 0, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }], ...makeHeroFields() },
      { id: "h1", ownerId: 1, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }], ...makeHeroFields() },
      { id: "h2", ownerId: 2, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }], ...makeHeroFields() },
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

test("playerWealth sums owned hero gold + owned settlement gold", () => {
  const state: GameState = createInitialState({
    seedPlayers: [
      { id: 0, faction: "player", name: "P0", color: "#fff", heroIds: ["h0a", "h0b"], settlementIds: ["s0", "s1"] },
      { id: 1, faction: "ai", name: "AI", color: "#000", heroIds: ["h1"], settlementIds: ["s2"] },
    ],
    seedHeroes: [
      { id: "h0a", ownerId: 0, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }], gold: 120, ...makeHeroFields({ gold: 120 }) },
      { id: "h0b", ownerId: 0, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }], gold: 30, ...makeHeroFields({ gold: 30 }) },
      { id: "h1", ownerId: 1, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }], gold: 999, ...makeHeroFields({ gold: 999 }) },
    ],
    seedSettlements: [
      makeSettlement("s0", 0, 0, 0, 500),
      makeSettlement("s1", 0, 0, 0, 50),
      makeSettlement("s2", 1, 0, 0, 7),
    ],
  });
  assert.equal(playerWealth(state, 0), 120 + 30 + 500 + 50);
  assert.equal(playerWealth(state, 1), 999 + 7);
});

test("playerWealth ignores unowned (other-player or neutral) entities", () => {
  const state: GameState = createInitialState({
    seedPlayers: [
      { id: 0, faction: "player", name: "P0", color: "#fff", heroIds: ["h0"], settlementIds: [] },
      { id: 1, faction: "ai", name: "AI", color: "#000", heroIds: ["h1"], settlementIds: [] },
    ],
    seedHeroes: [
      { id: "h0", ownerId: 0, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }], gold: 100, ...makeHeroFields({ gold: 100 }) },
      { id: "h1", ownerId: 1, q: 0, r: 0, movementRemaining: 7, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 0, r: 0 }], gold: 200, ...makeHeroFields({ gold: 200 }) },
    ],
    seedSettlements: [
      makeSettlement("s_neutral", null, 0, 0, 9999),
    ],
  });
  assert.equal(playerWealth(state, 0), 100);
  assert.equal(playerWealth(state, 1), 200);
});
