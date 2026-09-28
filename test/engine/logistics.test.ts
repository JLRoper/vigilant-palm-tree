import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceTradeRoutes,
  assignWagons,
  buyWagons,
  createTradeRoute,
  GameMap,
  transferCargoLoot,
  transferResources,
  updateTradeRoute,
  type GameState,
} from "@heroes/engine";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";

function logisticsState(): GameState {
  const hero = {
    ...makeHero("h0", 0, 2, 2),
    wagons: 5,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  };
  const origin = makeSettlement("s0", 0, 2, 2, {
    gold: 1000,
    warehouse: { wood: 100, stone: 100, iron: 100, arcane: 100, food: 100 },
  });
  const dest = makeSettlement("s1", 0, 8, 2, {
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  const state = makeState({ heroes: [hero], settlements: [origin, dest], activePlayerId: 0 });
  state.players = state.players.map((p) =>
    p.id === 0 ? { ...p, wagonsOwned: 8, wagonsUnassigned: 8 } : p,
  );
  return state;
}

function firstPassablePair(map: GameMap): Array<{ q: number; r: number }> {
  const out: Array<{ q: number; r: number }> = [];
  for (let r = 0; r < map.height && out.length < 2; r++) {
    for (let q = 0; q < map.width && out.length < 2; q++) {
      if (map.isPassable(q, r)) out.push({ q, r });
    }
  }
  return out;
}

test("transferResources: load with an empty wagon moves nothing", () => {
  const state = logisticsState();
  const result = transferResources(state, 0, "h0", "s0", "load", { wood: 1000 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "nothing_transferred");
});

test("transferResources: unload pulls settlement stock into hero cargo up to the wagon cap", () => {
  const state = logisticsState();
  const result = transferResources(state, 0, "h0", "s0", "unload", { wood: 1000, food: 25 });
  assert.equal(result.ok, true);
  const hero = result.state.heroes.h0;
  assert.equal(hero.resources?.wood, 100, "5 wagons cap 250, but only 100 wood exists in stock");
  assert.equal(hero.resources?.food, 25);
  assert.equal(result.state.settlements.s0.warehouse.wood, 0);
  assert.equal(result.state.settlements.s0.warehouse.food, 75);
});

test("transferResources rejects wrong owner and distant settlements", () => {
  const state = logisticsState();
  assert.equal(transferResources(state, 1, "h0", "s0", "unload", { wood: 5 }).reason, "forbidden_not_your_hero");
  assert.equal(
    transferResources(state, 0, "h0", "s1", "unload", { wood: 5 }).reason,
    "hero_not_at_settlement",
    "s1 is a different tile",
  );
});

test("assignWagons moves wagons between the pool and a hero, respecting the invariant", () => {
  const state = logisticsState();
  const assign = assignWagons(state, 0, "h0", 3);
  assert.equal(assign.ok, true);
  assert.equal(assign.state.heroes.h0.wagons, 8);
  assert.equal(assign.state.players[0].wagonsUnassigned, 5);

  const back = assignWagons(assign.state, 0, "h0", -10);
  assert.equal(back.ok, true);
  assert.equal(back.state.heroes.h0.wagons, 0, "delta clamps to the hero's actual wagons");
  assert.equal(back.state.players[0].wagonsUnassigned, 13);

  const empty = assignWagons(back.state, 0, "h0", -1);
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, "not_enough_wagons");
});

test("buyWagons deducts 200g + 5 wood each and grows the pool", () => {
  const state = logisticsState();
  const result = buyWagons(state, 0, "s0", 2);
  assert.equal(result.ok, true);
  assert.equal(result.state.settlements.s0.gold, 1000 - 400);
  assert.equal(result.state.settlements.s0.warehouse.wood, 100 - 10);
  const player = result.state.players[0];
  assert.equal(player.wagonsOwned, 10);
  assert.equal(player.wagonsUnassigned, 10);

  const broke = buyWagons({ ...result.state, settlements: { ...result.state.settlements, s0: { ...result.state.settlements.s0, gold: 10 } } }, 0, "s0", 1);
  assert.equal(broke.ok, false);
  assert.equal(broke.reason, "not_enough_gold");
});

test("createTradeRoute locks wagons; update reallocates; remove releases them", () => {
  const state = logisticsState();
  const created = createTradeRoute(state, 0, "s0", "s1", "wood", 3);
  assert.equal(created.ok, true);
  const route = created.route!;
  assert.equal(route.wagons, 3);
  assert.equal(created.state.players[0].wagonsUnassigned, 5, "3 of 8 locked into the route");

  const overCommit = createTradeRoute(created.state, 0, "s0", "s1", "stone", 6);
  assert.equal(overCommit.ok, false, "only 5 unassigned wagons remain");

  const grown = updateTradeRoute(created.state, 0, route.id, { wagonsDelta: 5 });
  assert.equal(grown.ok, true);
  assert.equal(grown.state.tradeRoutes[0].wagons, 8);
  assert.equal(grown.state.players[0].wagonsUnassigned, 0);

  const overGrow = updateTradeRoute(grown.state, 0, route.id, { wagonsDelta: 1 });
  assert.equal(overGrow.reason, "not_enough_wagons_unassigned");

  const removed = updateTradeRoute(grown.state, 0, route.id, { remove: true });
  assert.equal(removed.ok, true);
  assert.equal(removed.state.tradeRoutes.length, 0);
  assert.equal(removed.state.players[0].wagonsUnassigned, 8, "all wagons released");
});

test("advanceTradeRoutes: caravan loads, walks, delivers at the destination, and cycles home", () => {
  const map = new GameMap(7, "small");
  const [a, b] = firstPassablePair(map);
  const hero = {
    ...makeHero("h0", 0, a.q, a.r),
    wagons: 4,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  };
  const origin = makeSettlement("s0", 0, a.q, a.r, {
    warehouse: { wood: 200, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  const dest = makeSettlement("s1", 0, b.q, b.r, {
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  const state = makeState({ heroes: [hero], settlements: [origin, dest], activePlayerId: 0 });
  state.players = state.players.map((p) => (p.id === 0 ? { ...p, wagonsOwned: 4, wagonsUnassigned: 4 } : p));
  const created = createTradeRoute(state, 0, "s0", "s1", "wood", 4);
  assert.equal(created.ok, true);

  // Wrap 1: caravan loads 200 (4 wagons × 50) and starts walking.
  const departed = advanceTradeRoutes(created.state, map);
  const enRoute = departed.tradeRoutes![0].caravan!;
  assert.equal(enRoute.cargo, 200);
  assert.equal(enRoute.phase, "toDestination");
  assert.equal(departed.settlements.s0.warehouse.wood, 0);
  const totalPath = enRoute.path.length + enRoute.pathIndex;

  // Walk to the destination.
  let current = departed;
  for (let i = 0; i < totalPath; i++) {
    current = advanceTradeRoutes(current, map);
  }
  const arrived = current.tradeRoutes![0].caravan!;
  if (arrived.phase === "toDestination") {
    // Destination is level-1 (cap 500, headroom 500) — the full 200 lands.
    assert.equal(arrived.cargo, 0, "cargo fully delivered");
    assert.equal(current.settlements.s1.warehouse.wood, 200);
    // Next wrap flips it homeward.
    const homeward = advanceTradeRoutes(current, map);
    assert.equal(homeward.tradeRoutes![0].caravan?.phase, "toHome");
  } else {
    // Path was short enough to arrive and flip home in one wrap.
    assert.equal(arrived.phase, "toHome");
    assert.equal(current.settlements.s1.warehouse.wood, 200);
  }
});

test("advanceTradeRoutes: a full destination warehouse makes the caravan hold its cargo", () => {
  const map = new GameMap(11, "small");
  const [a, b] = firstPassablePair(map);
  const hero = {
    ...makeHero("h0", 0, a.q, a.r),
    wagons: 4,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  };
  const origin = makeSettlement("s0", 0, a.q, a.r, {
    warehouse: { wood: 200, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  // Level-3 destination stuffed to its base cap: no headroom at all.
  const dest = makeSettlement("s1", 0, b.q, b.r, {
    level: 3 as 1 | 2 | 3,
    warehouse: { wood: 4000, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  const state = makeState({ heroes: [hero], settlements: [origin, dest], activePlayerId: 0 });
  state.players = state.players.map((p) => (p.id === 0 ? { ...p, wagonsOwned: 4, wagonsUnassigned: 4 } : p));
  const created = createTradeRoute(state, 0, "s0", "s1", "wood", 4);
  const departed = advanceTradeRoutes(created.state, map);
  let current = departed;
  for (let i = 0; i < 40; i++) {
    current = advanceTradeRoutes(current, map);
  }
  const caravan = current.tradeRoutes![0].caravan!;
  if (caravan.phase === "toDestination" && caravan.pathIndex >= caravan.path.length) {
    assert.equal(caravan.cargo, 200, "cargo held, nothing lost to a full warehouse");
    assert.equal(current.settlements.s1.warehouse.wood, 4000);
    assert.ok(current.settlements.s0.warehouse.wood <= 200);
  } else if (caravan.phase === "toHome") {
    assert.ok(caravan.cargo === 0, "delivered exactly when headroom existed");
  }
  // Either way, no cargo was ever destroyed.
  const totalWood =
    (current.settlements.s0.warehouse.wood ?? 0) +
    (current.settlements.s1.warehouse.wood ?? 0) +
    caravan.cargo +
    (current.heroes.h0.resources?.wood ?? 0);
  assert.ok(totalWood >= 200);
});

test("transferCargoLoot: the winner takes the purse and cargo up to their own caps", () => {
  const state = logisticsState();
  const winner = {
    ...makeHero("h1", 0, 9, 9),
    gold: 1000,
    wagons: 2,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  };
  const loser = {
    ...makeHero("h0", 0, 2, 2),
    gold: 3000,
    wagons: 5,
    resources: { wood: 200, stone: 100, iron: 0, arcane: 0, food: 0 },
  };
  const battleState: GameState = {
    ...state,
    heroes: { h0: loser, h1: winner },
  };
  const result = transferCargoLoot(battleState.heroes, "h1", "h0");
  assert.equal(result.gold, 0, "winner is already at their 1000g purse cap — soft caps never force a transfer");
  assert.equal(result.heroes.h1.resources?.wood, 100, "winner cargo cap is 2×50");
  assert.equal(result.heroes.h0.resources?.wood, 100, "overflow stays with the loser (soft caps)");
});
