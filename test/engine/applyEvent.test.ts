import { test } from "node:test";
import assert from "node:assert/strict";
import type { EngineEvent } from "@heroes/contracts";
import { applyEngineEvent } from "@heroes/engine";
import { emptyWarehouse, makeHero, makeSettlement, makeState } from "../charter/_helpers";

test("HeroMoved moves the hero, records the previous tile, and extends the trail", () => {
  const state = makeState({ heroes: [makeHero("h1", 1, 5, 5)], settlements: [] });
  const result = applyEngineEvent(state, {
    type: "HeroMoved",
    actor: 1,
    heroId: "h1",
    to: { q: 6, r: 5 },
  });

  assert.equal(result.outcome, "applied");
  const hero = result.state.heroes.h1;
  assert.deepEqual([hero.q, hero.r], [6, 5]);
  assert.deepEqual([hero.previousQ, hero.previousR], [5, 5]);
  assert.deepEqual(hero.trail.at(-1), { q: 6, r: 5 });
  assert.equal(state.heroes.h1.q, 5, "input state is not mutated");
});

test("HeroMoved leaves movementRemaining alone -- the event carries no cost", () => {
  const state = makeState({
    heroes: [makeHero("h1", 1, 5, 5, { movementRemaining: 4 })],
    settlements: [],
  });
  const result = applyEngineEvent(state, {
    type: "HeroMoved",
    actor: 1,
    heroId: "h1",
    to: { q: 6, r: 5 },
  });
  assert.equal(result.state.heroes.h1.movementRemaining, 4);
});

test("HeroMoved to the tile the hero already occupies is a noop; an unknown hero forces a resync", () => {
  const state = makeState({ heroes: [makeHero("h1", 1, 5, 5)], settlements: [] });

  assert.equal(
    applyEngineEvent(state, { type: "HeroMoved", actor: 1, heroId: "h1", to: { q: 5, r: 5 } }).outcome,
    "noop",
  );
  assert.equal(
    applyEngineEvent(state, { type: "HeroMoved", actor: 1, heroId: "ghost", to: { q: 5, r: 5 } }).outcome,
    "resync",
  );
});

test("GoldTransferred moves the whole purse in the event's direction", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 250 })],
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 40 })],
  });
  const result = applyEngineEvent(state, {
    type: "GoldTransferred",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  });

  assert.equal(result.outcome, "applied");
  assert.equal(result.state.heroes.h0.gold, 0);
  assert.equal(result.state.settlements.s0.gold, 290);
});

test("GoldTransferred against an already-emptied purse is a noop, not a resync", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 0 })],
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 40 })],
  });
  const result = applyEngineEvent(state, {
    type: "GoldTransferred",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  });
  assert.equal(result.outcome, "noop");
});

test("GoldTransferred against a hero that isn't where the event says forces a resync", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 9, 9, { gold: 250 })],
    settlements: [makeSettlement("s0", 0, 2, 2)],
  });
  const result = applyEngineEvent(state, {
    type: "GoldTransferred",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  });
  assert.equal(result.outcome, "resync");
  assert.equal(result.state, state);
});

test("ResourcesTraded moves the resource and charges the gold", () => {
  const state = makeState({
    heroes: [],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { gold: 100, warehouse: emptyWarehouse({ wood: 10 }) }),
      makeSettlement("s1", 0, 4, 4, { gold: 0 }),
    ],
  });
  const result = applyEngineEvent(state, {
    type: "ResourcesTraded",
    actor: 0,
    fromSettlementId: "s0",
    toSettlementId: "s1",
    resource: "wood",
    amount: 6,
  });

  assert.equal(result.outcome, "applied");
  assert.equal(result.state.settlements.s0.warehouse.wood, 4);
  assert.equal(result.state.settlements.s1.warehouse.wood, 6);
  assert.equal(result.state.settlements.s0.gold, 94);
});

test("AutoTradeToggled flips the flag; re-applying it is a noop; an unknown settlement resyncs", () => {
  const state = makeState({
    heroes: [],
    settlements: [makeSettlement("s0", 0, 2, 2, { autoTrade: true })],
  });

  const off = applyEngineEvent(state, {
    type: "AutoTradeToggled",
    actor: 0,
    settlementId: "s0",
    autoTrade: false,
  });
  assert.equal(off.outcome, "applied");
  assert.equal(off.state.settlements.s0.autoTrade, false);

  assert.equal(
    applyEngineEvent(off.state, {
      type: "AutoTradeToggled",
      actor: 0,
      settlementId: "s0",
      autoTrade: false,
    }).outcome,
    "noop",
  );
  assert.equal(
    applyEngineEvent(state, {
      type: "AutoTradeToggled",
      actor: 0,
      settlementId: "ghost",
      autoTrade: false,
    }).outcome,
    "resync",
  );
});

test("StackReordered swaps the two slots; an out-of-range index resyncs", () => {
  const stacks = [
    { entries: [{ unitTypeId: "spearman", count: 3 }] },
    { entries: [{ unitTypeId: "archer", count: 5 }] },
  ];
  const state = makeState({ heroes: [makeHero("h1", 1, 5, 5, { stacks })], settlements: [] });

  const result = applyEngineEvent(state, {
    type: "StackReordered",
    actor: 1,
    heroId: "h1",
    fromIdx: 0,
    toIdx: 1,
  });
  assert.equal(result.outcome, "applied");
  assert.deepEqual(
    result.state.heroes.h1.stacks.map((s) => s.entries[0]?.unitTypeId),
    ["archer", "spearman"],
  );

  assert.equal(
    applyEngineEvent(state, { type: "StackReordered", actor: 1, heroId: "h1", fromIdx: 0, toIdx: 7 })
      .outcome,
    "resync",
  );
});

test("SettlementCaptured reassigns ownership and the players' settlement lists", () => {
  const state = makeState({
    heroes: [makeHero("h1", 1, 2, 2)],
    settlements: [makeSettlement("s0", 0, 2, 2)],
  });
  const result = applyEngineEvent(state, {
    type: "SettlementCaptured",
    actor: 1,
    heroId: "h1",
    settlementId: "s0",
    previousOwnerId: 0,
  });

  assert.equal(result.outcome, "applied");
  assert.equal(result.state.settlements.s0.ownerId, 1);
  assert.deepEqual(result.state.players.find((p) => p.id === 1)?.settlementIds, ["s1", "s0"]);
  assert.deepEqual(result.state.players.find((p) => p.id === 0)?.settlementIds, []);
});

test("SettlementCaptured is a noop once the actor already owns it, and resyncs on a missing entity", () => {
  const state = makeState({
    heroes: [makeHero("h1", 1, 2, 2)],
    settlements: [makeSettlement("s0", 1, 2, 2)],
  });

  assert.equal(
    applyEngineEvent(state, {
      type: "SettlementCaptured",
      actor: 1,
      heroId: "h1",
      settlementId: "s0",
      previousOwnerId: 0,
    }).outcome,
    "noop",
  );
  assert.equal(
    applyEngineEvent(state, {
      type: "SettlementCaptured",
      actor: 1,
      heroId: "ghost",
      settlementId: "s0",
      previousOwnerId: 0,
    }).outcome,
    "resync",
  );
});

test("TownHallUpgradeStarted deducts the cost and starts the upgrade; an in-flight upgrade is a noop", () => {
  const buildings = [{ kind: "townHall" as const, level: 1, gx: 0, gy: 0, style: "classic" as const }];
  const state = makeState({
    heroes: [],
    settlements: [
      makeSettlement("s0", 0, 2, 2, {
        gold: 2000,
        warehouse: emptyWarehouse({ wood: 20, stone: 20 }),
        buildings,
      }),
    ],
  });

  const result = applyEngineEvent(state, {
    type: "TownHallUpgradeStarted",
    actor: 0,
    settlementId: "s0",
    targetLevel: 2,
  });
  assert.equal(result.outcome, "applied");
  assert.equal(result.state.settlements.s0.upgrade?.kind, "townHall");
  assert.equal(result.state.settlements.s0.gold, 500);

  assert.equal(
    applyEngineEvent(result.state, {
      type: "TownHallUpgradeStarted",
      actor: 0,
      settlementId: "s0",
      targetLevel: 2,
    }).outcome,
    "noop",
  );
});

test("the six events whose effect isn't in their payload all ask for a resync", () => {
  const state = makeState();
  const notDerivable: EngineEvent[] = [
    { type: "TurnEnded", actor: 0, round: 2, day: 2, activePlayerId: 1, wrapped: false },
    {
      type: "BattleResolved",
      actor: 0,
      attackerId: "h0",
      defenderId: "h1",
      winner: "attacker",
      attackerOutcome: "won",
      defenderOutcome: "lost_all_troops",
      rewardGold: 100,
      rounds: 3,
      obstacleSeed: 7,
    },
    { type: "HeroRecruited", actor: 0, heroId: "h9", name: "New", settlementId: "s0", horseVariant: "bubbly" },
    {
      type: "CharterStarted",
      actor: 0,
      heroId: "h0",
      charterId: "c0",
      settlementId: "s9",
      targetQ: 10,
      targetR: 10,
    },
    { type: "BuildingUpgradeStarted", actor: 0, settlementId: "s0" },
    { type: "SettlementUpgradeStarted", actor: 0, settlementId: "s0", targetLevel: 2 },
  ];

  for (const event of notDerivable) {
    const result = applyEngineEvent(state, event);
    assert.equal(result.outcome, "resync", `${event.type} should resync`);
    assert.equal(result.state, state, `${event.type} should not touch state`);
  }
});
