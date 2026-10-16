import { test } from "node:test";
import assert from "node:assert/strict";
import type { EngineEvent, TradeRouteState } from "@heroes/contracts";
import { applyEngineEvent } from "@heroes/engine";
import { emptyWarehouse, makeCharter, makeHero, makePlayer, makeSettlement, makeState, makeTradeRoute } from "../charter/_helpers";

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

test("CharterTravelAdvanced moves the hero and extends the trail, mid-route", () => {
  const state = makeState({
    heroes: [makeHero("h1", 1, 5, 5, { isChartering: true, charterId: "c0", movementRemaining: 4 })],
    activeCharters: [makeCharter({ id: "c0", heroId: "h1", ownerId: 1, targetQ: 10, targetR: 5 })],
  });
  const result = applyEngineEvent(state, {
    type: "CharterTravelAdvanced",
    actor: 1,
    heroId: "h1",
    charterId: "c0",
    to: { q: 6, r: 5 },
  });

  assert.equal(result.outcome, "applied");
  const hero = result.state.heroes.h1;
  assert.deepEqual([hero.q, hero.r], [6, 5]);
  assert.deepEqual([hero.previousQ, hero.previousR], [5, 5]);
  assert.deepEqual(hero.trail.at(-1), { q: 6, r: 5 });
  // Mid-route: the event carries no cost, same as HeroMoved -- movement is
  // left untouched (TurnEnded's resync bounds the drift).
  assert.equal(hero.movementRemaining, 4);
  assert.equal(result.state.activeCharters.find((c) => c.id === "c0")?.phase, "traveling");
});

test("CharterTravelAdvanced flips the charter to constructing and zeroes movement on arrival", () => {
  const state = makeState({
    heroes: [makeHero("h1", 1, 9, 5, { isChartering: true, charterId: "c0", movementRemaining: 3 })],
    activeCharters: [makeCharter({ id: "c0", heroId: "h1", ownerId: 1, targetQ: 10, targetR: 5 })],
  });
  const result = applyEngineEvent(state, {
    type: "CharterTravelAdvanced",
    actor: 1,
    heroId: "h1",
    charterId: "c0",
    to: { q: 10, r: 5 },
  });

  assert.equal(result.outcome, "applied");
  assert.equal(result.state.heroes.h1.movementRemaining, 0);
  assert.equal(result.state.activeCharters.find((c) => c.id === "c0")?.phase, "constructing");
});

test("CharterTravelAdvanced to the hero's current tile is a noop; an unknown hero or charter resyncs", () => {
  const state = makeState({
    heroes: [makeHero("h1", 1, 5, 5, { isChartering: true, charterId: "c0" })],
    activeCharters: [makeCharter({ id: "c0", heroId: "h1", ownerId: 1, targetQ: 10, targetR: 5 })],
  });

  assert.equal(
    applyEngineEvent(state, { type: "CharterTravelAdvanced", actor: 1, heroId: "h1", charterId: "c0", to: { q: 5, r: 5 } })
      .outcome,
    "noop",
  );
  assert.equal(
    applyEngineEvent(state, { type: "CharterTravelAdvanced", actor: 1, heroId: "ghost", charterId: "c0", to: { q: 6, r: 5 } })
      .outcome,
    "resync",
  );
  assert.equal(
    applyEngineEvent(state, { type: "CharterTravelAdvanced", actor: 1, heroId: "h1", charterId: "ghost", to: { q: 6, r: 5 } })
      .outcome,
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

test("the payload-fact-only events all ask for a resync", () => {
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
    { type: "BuildingsPlaced", actor: 0, settlementId: "s0" },
    { type: "ResourcesTransferred", actor: 0, heroId: "h0", settlementId: "s0", direction: "load" },
    { type: "WagonsAssigned", actor: 0, heroId: "h0", delta: 1 },
    // Phase 1 treasury-wagons split: the optional slot discriminator rides
    // both wagon events; carrying it must not change the classification
    // (still not payload-derivable -> resync at the next boundary).
    { type: "WagonsAssigned", actor: 0, heroId: "h0", delta: 1, slot: "treasury" },
    { type: "WagonsAssigned", actor: 0, heroId: "h0", delta: -1, slot: "cargo" },
    { type: "WagonsBought", actor: 0, settlementId: "s0", count: 2 },
    { type: "WagonsBought", actor: 0, settlementId: "s0", count: 2, slot: "treasury" },
    { type: "WagonsBought", actor: 0, settlementId: "s0", count: 1, slot: "cargo" },
    { type: "TradeRouteUpdated", actor: 0, routeId: "r0" },
    { type: "TradeRouteRemoved", actor: 0, routeId: "r0" },
    {
      type: "SettlementBattleResolved",
      actor: 0,
      attackerId: "h0",
      settlementId: "s1",
      winner: "attacker",
      captured: true,
    },
  ];

  for (const event of notDerivable) {
    const result = applyEngineEvent(state, event);
    assert.equal(result.outcome, "resync", `${event.type} should resync`);
    assert.equal(result.state, state, `${event.type} should not touch state`);
  }
});

function garrisonTotal(stacks: { entries: { unitTypeId: string; count: number }[] }[]): number {
  let total = 0;
  for (const p of stacks) {
    for (const e of p.entries) total += e.count;
  }
  return total;
}

test("UnitsRecruited deposits the units into the settlement garrison", () => {
  const state = makeState({
    heroes: [],
    settlements: [{ ...makeSettlement("s1", 1, 8, 8) }],
  });
  const result = applyEngineEvent(state, {
    type: "UnitsRecruited",
    actor: 1,
    settlementId: "s1",
    unitTypeId: "pikeman",
    count: 5,
  });

  assert.equal(result.outcome, "applied");
  const stacks = result.state.settlements.s1.stacks ?? [];
  assert.equal(garrisonTotal(stacks), 5);
  assert.equal(stacks.length, 8, "the garrison is normalized to 8 platoon slots");
  assert.equal(state.settlements.s1.stacks, undefined, "input state is not mutated");
});

test("UnitsRecruited grows an existing entry of the same type in place", () => {
  const state = makeState({
    heroes: [],
    settlements: [
      {
        ...makeSettlement("s1", 1, 8, 8),
        stacks: [{ entries: [{ unitTypeId: "pikeman", count: 3 }] }],
      },
    ],
  });
  const result = applyEngineEvent(state, {
    type: "UnitsRecruited",
    actor: 1,
    settlementId: "s1",
    unitTypeId: "pikeman",
    count: 2,
  });

  assert.equal(result.outcome, "applied");
  const stacks = result.state.settlements.s1.stacks ?? [];
  assert.equal(stacks[0]?.entries[0]?.unitTypeId, "pikeman");
  assert.equal(stacks[0]?.entries[0]?.count, 5);
});

test("UnitsRecruited against a missing settlement or a full garrison resyncs", () => {
  const full = Array.from({ length: 8 }, (_, i) => ({
    entries: [
      { unitTypeId: `a${i}`, count: 1 },
      { unitTypeId: `b${i}`, count: 1 },
      { unitTypeId: `c${i}`, count: 1 },
    ],
  }));
  const ghost = makeState({ heroes: [], settlements: [] });
  const packed = makeState({
    heroes: [],
    settlements: [{ ...makeSettlement("s1", 1, 8, 8), stacks: full }],
  });

  assert.equal(
    applyEngineEvent(ghost, {
      type: "UnitsRecruited",
      actor: 1,
      settlementId: "s1",
      unitTypeId: "pikeman",
      count: 1,
    }).outcome,
    "resync",
  );
  assert.equal(
    applyEngineEvent(packed, {
      type: "UnitsRecruited",
      actor: 1,
      settlementId: "s1",
      unitTypeId: "pikeman",
      count: 1,
    }).outcome,
    "resync",
  );
});

test("UnitsTransferred toHero moves the units from garrison to hero stacks", () => {
  const state = makeState({
    heroes: [makeHero("h1", 1, 8, 8)],
    settlements: [
      {
        ...makeSettlement("s1", 1, 8, 8),
        stacks: [{ entries: [{ unitTypeId: "pikeman", count: 4 }] }],
      },
    ],
  });
  const result = applyEngineEvent(state, {
    type: "UnitsTransferred",
    actor: 1,
    heroId: "h1",
    settlementId: "s1",
    direction: "toHero",
    unitTypeId: "pikeman",
    count: 3,
  });

  assert.equal(result.outcome, "applied");
  assert.equal(garrisonTotal(result.state.heroes.h1.stacks), 3);
  assert.equal(garrisonTotal(result.state.settlements.s1.stacks ?? []), 1);
});

test("UnitsTransferred toGarrison moves the units from hero stacks to the garrison", () => {
  const state = makeState({
    heroes: [makeHero("h1", 1, 8, 8, { stacks: [{ entries: [{ unitTypeId: "pikeman", count: 6 }] }] })],
    settlements: [{ ...makeSettlement("s1", 1, 8, 8) }],
  });
  const result = applyEngineEvent(state, {
    type: "UnitsTransferred",
    actor: 1,
    heroId: "h1",
    settlementId: "s1",
    direction: "toGarrison",
    unitTypeId: "pikeman",
    count: 6,
  });

  assert.equal(result.outcome, "applied");
  assert.equal(garrisonTotal(result.state.heroes.h1.stacks), 0);
  assert.equal(garrisonTotal(result.state.settlements.s1.stacks ?? []), 6);
});

test("UnitsTransferred against drifted positions resyncs untouched", () => {
  const state = makeState({
    heroes: [makeHero("h1", 1, 5, 5)],
    settlements: [
      {
        ...makeSettlement("s1", 1, 8, 8),
        stacks: [{ entries: [{ unitTypeId: "pikeman", count: 4 }] }],
      },
    ],
  });
  const result = applyEngineEvent(state, {
    type: "UnitsTransferred",
    actor: 1,
    heroId: "h1",
    settlementId: "s1",
    direction: "toHero",
    unitTypeId: "pikeman",
    count: 1,
  });

  assert.equal(result.outcome, "resync");
  assert.equal(result.state, state);
});

test("TradeRouteCreated appends the route with the event's id and debits the actor's wagons", () => {
  const state = makeState({
    players: [
      { ...makePlayer(0, "player", ["h0"], ["s0"]), wagonsUnassigned: 5 },
      makePlayer(1, "ai", ["h1"], []),
    ],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 4, 4)],
  });
  const result = applyEngineEvent(state, {
    type: "TradeRouteCreated",
    actor: 0,
    routeId: "route7",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "resource", resource: "wood" },
    wagons: 3,
  });

  assert.equal(result.outcome, "applied");
  const routes = result.state.tradeRoutes ?? [];
  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0], {
    id: "route7",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "resource", resource: "wood" },
    wagons: 3,
    caravan: null,
    ownerId: 0,
  });
  assert.equal(result.state.players.find((p) => p.id === 0)?.wagonsUnassigned, 2);
  assert.equal(result.state.nextTradeRouteId, 8, "the counter bumps monotonically past the event's id");
  assert.equal(result.state.dirty, true);
  assert.deepEqual(state.tradeRoutes, [], "input state is not mutated");
});

test("an exact-tuple TradeRouteCreated duplicate is a noop, not a second route", () => {
  const state = makeState({
    players: [
      { ...makePlayer(0, "player", ["h0"], ["s0"]), wagonsUnassigned: 5 },
      makePlayer(1, "ai", ["h1"], []),
    ],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 4, 4)],
  });
  const event = {
    type: "TradeRouteCreated",
    actor: 0,
    routeId: "route0",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "resource", resource: "wood" },
    wagons: 3,
  } as const;

  const once = applyEngineEvent(state, event);
  assert.equal(once.outcome, "applied");
  assert.equal(
    applyEngineEvent(once.state, event).outcome,
    "noop",
    "the id + endpoint pair + payload + wagons + null-caravan match is what an already-applied event looks like",
  );
  assert.equal((once.state.tradeRoutes ?? []).length, 1);
});

test("TradeRouteCreated resyncs untouched on a missing settlement, player, or insufficient wagons", () => {
  const state = makeState({
    players: [
      { ...makePlayer(0, "player", ["h0"], ["s0"]), wagonsUnassigned: 5 },
      makePlayer(1, "ai", ["h1"], []),
    ],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 4, 4)],
  });

  const ghostSettlement = applyEngineEvent(state, {
    type: "TradeRouteCreated",
    actor: 0,
    routeId: "route0",
    from: { kind: "settlement", id: "ghost" },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "resource", resource: "wood" },
    wagons: 3,
  });
  assert.equal(ghostSettlement.outcome, "resync");
  assert.equal(ghostSettlement.state, state);

  const ghostPlayer = applyEngineEvent(state, {
    type: "TradeRouteCreated",
    actor: 5,
    routeId: "route0",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "resource", resource: "wood" },
    wagons: 3,
  });
  assert.equal(ghostPlayer.outcome, "resync");
  assert.equal(ghostPlayer.state, state);

  const insufficient = applyEngineEvent(state, {
    type: "TradeRouteCreated",
    actor: 0,
    routeId: "route0",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "resource", resource: "wood" },
    wagons: 9,
  });
  assert.equal(insufficient.outcome, "resync", "the route is absent and the player cannot cover the wagons");
  assert.equal(insufficient.state, state);
});

test("TradeRouteCreated with a hero endpoint builds the route against the live hero", () => {
  const state = makeState({
    players: [
      { ...makePlayer(0, "player", ["h0"], ["s0"]), wagonsUnassigned: 5 },
      makePlayer(1, "ai", ["h1"], []),
    ],
    heroes: [makeHero("h0", 0, 2, 2)],
    settlements: [makeSettlement("s0", 0, 2, 2)],
  });
  const result = applyEngineEvent(state, {
    type: "TradeRouteCreated",
    actor: 0,
    routeId: "route2",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "hero", id: "h0" },
    payload: { kind: "gold" },
    wagons: 2,
  });

  assert.equal(result.outcome, "applied");
  assert.deepEqual(result.state.tradeRoutes, [
    {
      id: "route2",
      from: { kind: "settlement", id: "s0" },
      to: { kind: "hero", id: "h0" },
      payload: { kind: "gold" },
      wagons: 2,
      caravan: null,
      ownerId: 0,
    },
  ]);
});

test("TradeRouteCreated with a dead hero endpoint resyncs, never noops -- even against a matching existing route", () => {
  const routeless = makeState({
    players: [
      { ...makePlayer(0, "player", ["h0"], ["s0"]), wagonsUnassigned: 5 },
      makePlayer(1, "ai", ["h1"], []),
    ],
    heroes: [],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 4, 4)],
  });
  const result = applyEngineEvent(routeless, {
    type: "TradeRouteCreated",
    actor: 0,
    routeId: "route0",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "hero", id: "h5" },
    payload: { kind: "gold" },
    wagons: 1,
  });
  assert.equal(result.outcome, "resync", "the to-endpoint hero is dead in this state");
  assert.equal(result.state, routeless);

  // Even a same-id, same-tuple existing route must not turn the dead-endpoint
  // replay into a noop -- the state has drifted (or the route outlived its
  // endpoint); either way the sync layer needs the resync.
  const existing = makeTradeRoute({
    id: "route0",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "hero", id: "h5" },
    payload: { kind: "gold" },
    wagons: 1,
  });
  const withRoute = makeState({
    players: [
      { ...makePlayer(0, "player", ["h0"], ["s0"]), wagonsUnassigned: 5 },
      makePlayer(1, "ai", ["h1"], []),
    ],
    heroes: [],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 4, 4)],
    tradeRoutes: [existing],
  });
  assert.equal(applyEngineEvent(withRoute, {
    type: "TradeRouteCreated",
    actor: 0,
    routeId: "route0",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "hero", id: "h5" },
    payload: { kind: "gold" },
    wagons: 1,
  }).outcome, "resync", "the tuple match must not swallow a dead hero endpoint");
});

test("a legacy TradeRouteCreated event row (flat fields) normalizes and applies", () => {
  const state = makeState({
    players: [
      { ...makePlayer(0, "player", ["h0"], ["s0"]), wagonsUnassigned: 5 },
      makePlayer(1, "ai", ["h1"], []),
    ],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 4, 4)],
  });
  // Rows persisted before the endpoint/payload model carry the legacy flat
  // fields -- the applier normalizes both generations.
  const legacyRow = {
    type: "TradeRouteCreated",
    actor: 0,
    routeId: "route4",
    fromSettlementId: "s0",
    toSettlementId: "s1",
    resource: "stone",
    wagons: 1,
  } as unknown as EngineEvent;
  const result = applyEngineEvent(state, legacyRow);
  assert.equal(result.outcome, "applied");
  assert.deepEqual(result.state.tradeRoutes, [
    {
      id: "route4",
      from: { kind: "settlement", id: "s0" },
      to: { kind: "settlement", id: "s1" },
      payload: { kind: "resource", resource: "stone" },
      wagons: 1,
      caravan: null,
      ownerId: 0,
    },
  ]);
});

test("a same-id TradeRouteCreated with a different payload replaces the route instead of duplicating the id", () => {
  const state = makeState({
    players: [
      { ...makePlayer(0, "player", ["h0"], ["s0"]), wagonsUnassigned: 5 },
      makePlayer(1, "ai", ["h1"], []),
    ],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 4, 4)],
    tradeRoutes: [
      makeTradeRoute({
        id: "route0",
        from: { kind: "settlement", id: "s0" },
        to: { kind: "settlement", id: "s1" },
        payload: { kind: "resource", resource: "wood" },
        wagons: 3,
      }),
    ],
  });
  const result = applyEngineEvent(state, {
    type: "TradeRouteCreated",
    actor: 0,
    routeId: "route0",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "gold" },
    wagons: 2,
  });
  assert.equal(result.outcome, "applied");
  const routes = (result.state.tradeRoutes ?? []) as TradeRouteState[];
  assert.equal(routes.length, 1, "one route per id -- the mismatched event replaced, not appended");
  assert.deepEqual(routes[0].payload, { kind: "gold" });
  assert.equal(routes[0].wagons, 2);
});

test("SettlementBattleResolved still asks for a resync -- stacks/gold are not in its payload", () => {
  const state = makeState();
  const result = applyEngineEvent(state, {
    type: "SettlementBattleResolved",
    actor: 0,
    attackerId: "h0",
    settlementId: "s1",
    winner: "attacker",
    captured: true,
  });

  assert.equal(result.outcome, "resync");
  assert.equal(result.state, state);
});
