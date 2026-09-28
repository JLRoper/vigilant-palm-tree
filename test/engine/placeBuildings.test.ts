import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPlaceBuildings,
  cityBuildNetCost,
  type BuildingDef,
} from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";

test("cityBuildNetCost: placements charge full cost, removals refund ceil(50%)", () => {
  const previous = [
    { gx: 1, gy: 1, kind: "house" as const, level: 1, style: "classic" as const },
  ];
  const next = [
    { gx: 2, gy: 2, kind: "goldMine" as const, level: 1, style: "classic" as const },
  ];
  const net = cityBuildNetCost(previous, next);
  assert.equal(net.gold, 300 - 50, "goldMine costs 300; house refunds ceil(100/2)=50");
  assert.equal(net.wood, 6 - 3, "goldMine costs 6 wood; house refunds ceil(5/2)=3");
  assert.equal(net.stone, 4);
  assert.equal(net.iron ?? 0, 0);
  assert.equal(net.arcane ?? 0, 0);
});

test("applyPlaceBuildings: happy path deducts, applies, and stamps the build timer server-side", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 1000,
    warehouse: { wood: 20, stone: 10, iron: 5, arcane: 2, food: 0 },
    buildings: [{ gx: 1, gy: 1, kind: "house", level: 1, style: "classic" }],
  });
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(state, "s0", 0, [
    { gx: 2, gy: 2, kind: "goldMine", level: 1, style: "classic" },
  ]);
  assert.equal(result.ok, true);
  const after = result.state.settlements.s0;
  assert.equal(after.buildings.length, 1);
  assert.equal(after.buildings[0].kind, "goldMine");
  assert.equal(after.buildings[0].construction?.daysRemaining, 4, "goldMine buildDays, not client-supplied");
  assert.equal(after.gold, 1000 - (300 - 50));
  assert.equal(after.warehouse.wood, 20 - (6 - 3));
  assert.equal(after.warehouse.stone, 10 - 4);
  assert.equal(result.state.dirty, true);
});

test("applyPlaceBuildings: preserves the server's own construction state for existing buildings", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 1000,
    buildings: [
      { gx: 1, gy: 1, kind: "goldMine", level: 1, style: "classic", construction: { daysRemaining: 2 } },
    ],
  });
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(state, "s0", 0, [
    { gx: 1, gy: 1, kind: "goldMine", level: 1, style: "classic", construction: { daysRemaining: 0 } },
  ]);
  assert.equal(result.ok, true);
  assert.equal(
    result.state.settlements.s0.buildings[0].construction?.daysRemaining,
    2,
    "a spoofed 0-day client value must not override the server's timer",
  );
});

test("applyPlaceBuildings rejects wrong-owner and unaffordable commits", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 100,
    buildings: [],
  });
  const state = makeState({ settlements: [settlement] });

  const wrongOwner = applyPlaceBuildings(state, "s0", 1, [
    { gx: 0, gy: 0, kind: "house", level: 1, style: "classic" },
  ]);
  assert.equal(wrongOwner.ok, false);
  assert.equal(wrongOwner.reason, "forbidden_not_your_settlement");

  const broke = applyPlaceBuildings(state, "s0", 0, [
    { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic" },
  ]);
  assert.equal(broke.ok, false);
  assert.equal(broke.reason, "not_enough_gold");
  assert.equal(broke.state.settlements.s0.buildings.length, 0, "rejected commit leaves buildings untouched");
});

test("applyPlaceBuildings: the initial starter layout of an empty settlement commits free", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 300,
    warehouse: { wood: 20, stone: 10, iron: 0, arcane: 0, food: 0 },
    buildings: [],
  });
  const state = makeState({ settlements: [settlement] });
  // A full generated-style layout would cost far more than the settlement
  // holds; with initialLayout the whole commit is free.
  const layout: BuildingDef[] = [
    { gx: 2, gy: 2, kind: "townHall", level: 1, style: "classic" },
    { gx: 0, gy: 0, kind: "house", level: 1, style: "classic" },
    { gx: 1, gy: 3, kind: "market", level: 1, style: "classic" },
  ];
  const result = applyPlaceBuildings(state, "s0", 0, layout, true);
  assert.equal(result.ok, true);
  assert.equal(result.state.settlements.s0.gold, 300, "starter layout is free");
  assert.equal(result.state.settlements.s0.warehouse.wood, 20);
  assert.equal(result.state.settlements.s0.buildings.length, 3);
  assert.equal(
    "construction" in result.state.settlements.s0.buildings[1],
    false,
    "starter-layout buildings are already constructed — no rebuild timers",
  );
  assert.equal(
    "construction" in result.state.settlements.s0.buildings[0],
    false,
  );
});

test("applyPlaceBuildings: initialLayout is ignored for a settlement that already has buildings", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 300,
    buildings: [{ gx: 2, gy: 2, kind: "townHall", level: 1, style: "classic" }],
  });
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(state, "s0", 0, [
    { gx: 2, gy: 2, kind: "townHall", level: 1, style: "classic" },
    { gx: 0, gy: 0, kind: "house", level: 1, style: "classic" },
  ], true);
  assert.equal(result.ok, false);
  assert.ok(
    result.reason.startsWith("not_enough_"),
    "spoofing initialLayout cannot skip charges",
  );
  assert.equal(result.state.settlements.s0.buildings.length, 1);
});
