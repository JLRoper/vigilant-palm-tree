import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARTER_GOLD_COST, CHARTER_WAREHOUSE_COST, startCharter } from "@heroes/engine";
import type { StartCharterPayload } from "@heroes/contracts";
import { makeHero, makeSettlement, makeState } from "./_helpers";

function makePayload(overrides: Partial<StartCharterPayload> = {}): StartCharterPayload {
  return {
    heroId: "h0",
    targetQ: 10,
    targetR: 10,
    settlementName: "New Town",
    settlementId: "s-new",
    charterId: "c0",
    resourceRates: { wood: 2 },
    foundedOnResource: null,
    citySpots: [],
    ...overrides,
  };
}

test("CHARTER_GOLD_COST and CHARTER_WAREHOUSE_COST match the documented values", () => {
  assert.equal(CHARTER_GOLD_COST, 2500);
  assert.deepEqual(CHARTER_WAREHOUSE_COST, { wood: 20, stone: 15 });
});

test("startCharter succeeds when hero is at a friendly, well-stocked settlement", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: CHARTER_GOLD_COST }), makeHero("h1", 1, 18, 4)],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 } }),
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  const result = startCharter(s, makePayload());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.heroes.h0.gold, 0);
  assert.equal(result.state.heroes.h0.isChartering, true);
  assert.equal(result.state.heroes.h0.charterId, "c0");
  assert.equal(result.state.settlements.s0.warehouse.wood, 0);
  assert.equal(result.state.settlements.s0.warehouse.stone, 0);
  assert.equal(result.state.activeCharters.length, 1);
  assert.equal(result.state.activeCharters[0].id, "c0");
  assert.equal(result.state.activeCharters[0].phase, "traveling");
  assert.equal(result.state.activeCharters[0].settlementId, "s-new");
  assert.equal(result.state.nextCharterId, 1);
  assert.equal(result.state.nextSettlementId, 101);
  assert.equal(result.state.dirty, true);
});

test("startCharter rejects when phase is not PLAYER_TURN", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: CHARTER_GOLD_COST })],
    settlements: [makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 } })],
    phase: { kind: "AI_TURN", playerId: 0 },
  });
  const result = startCharter(s, makePayload());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_player_turn");
});

test("startCharter rejects when hero does not exist", () => {
  const s = makeState();
  const result = startCharter(s, makePayload({ heroId: "ghost" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "no_hero");
});

test("startCharter rejects when hero is not owned by the active player", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4, { gold: CHARTER_GOLD_COST })],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4, { warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 } })],
  });
  const result = startCharter(s, makePayload({ heroId: "h1" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_owner");
});

test("startCharter rejects when hero is already chartering", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: CHARTER_GOLD_COST, isChartering: true, charterId: "existing" })],
    settlements: [makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 } })],
  });
  const result = startCharter(s, makePayload());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "already_chartering");
});

test("startCharter rejects when hero has insufficient gold", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: CHARTER_GOLD_COST - 1 })],
    settlements: [makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 } })],
  });
  const result = startCharter(s, makePayload());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "insufficient_gold");
});

test("startCharter rejects when hero is not standing on a friendly settlement", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 5, 5, { gold: CHARTER_GOLD_COST })],
    settlements: [makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 } })],
  });
  const result = startCharter(s, makePayload());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "hero_not_at_friendly_settlement");
});

test("startCharter rejects when the provisioning settlement has insufficient wood", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: CHARTER_GOLD_COST })],
    settlements: [makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 5, stone: 15, iron: 0, arcane: 0, food: 0 } })],
  });
  const result = startCharter(s, makePayload());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "insufficient_wood");
});

test("startCharter rejects when the provisioning settlement has insufficient stone", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: CHARTER_GOLD_COST })],
    settlements: [makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 20, stone: 5, iron: 0, arcane: 0, food: 0 } })],
  });
  const result = startCharter(s, makePayload());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "insufficient_stone");
});

test("startCharter rejects when the target hex is occupied by another hero", () => {
  const s = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { gold: CHARTER_GOLD_COST }),
      makeHero("h1", 1, 10, 10),
    ],
    settlements: [makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 } })],
  });
  const result = startCharter(s, makePayload({ targetQ: 10, targetR: 10 }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "occupied");
});

test("startCharter rejects when the target hex already has an active charter", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: CHARTER_GOLD_COST })],
    settlements: [makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 } })],
    activeCharters: [
      {
        id: "other",
        heroId: "h1",
        ownerId: 1,
        targetQ: 10,
        targetR: 10,
        settlementName: "Rival Camp",
        phase: "traveling",
        daysRemaining: 5,
        settlementId: "s-rival",
        resourceRates: {},
        foundedOnResource: null,
        citySpots: [],
      },
    ],
  });
  const result = startCharter(s, makePayload({ targetQ: 10, targetR: 10 }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "hex_already_chartered");
});

test("startCharter rejects when the target hex already has a settlement", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: CHARTER_GOLD_COST })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 } }),
      makeSettlement("s1", 1, 10, 10),
    ],
  });
  const result = startCharter(s, makePayload({ targetQ: 10, targetR: 10 }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "hex_has_settlement");
});
