import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPlaceBuildings,
  buildStarterLayout,
  cityBuildNetCost,
  type BuildingDef,
} from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";
import type { SettlementState } from "@heroes/contracts";

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

test("applyPlaceBuildings: the starter set of an empty settlement commits free", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 300,
    warehouse: { wood: 300, stone: 300, iron: 0, arcane: 0, food: 0 },
    buildings: [],
  });
  const state = makeState({ settlements: [settlement] });
  // The real starter set (engine buildStarterLayout) is free; the shape of the
  // set itself is pinned in starterLayout.test.ts — this case is about the
  // command's free/already-constructed handling of it.
  const layout: BuildingDef[] = buildStarterLayout({ size: 5, style: "classic" });
  const result = applyPlaceBuildings(state, "s0", 0, layout, true);
  assert.equal(result.ok, true);
  assert.equal(result.state.settlements.s0.gold, 300, "starter set is free");
  assert.equal(result.state.settlements.s0.warehouse.wood, 300);
  // 6 now, not 4: the starter set grew a wood and a stone producer alongside the
  // town hall, farm and two houses. The set's shape is pinned in
  // starterLayout.test.ts; what matters here is that ALL of it is free.
  assert.equal(result.state.settlements.s0.buildings.length, layout.length);
  assert.deepEqual(result.state.settlements.s0.buildings, layout, "the whole set lands, uncharged");
  for (const b of result.state.settlements.s0.buildings) {
    assert.equal(
      "construction" in b,
      false,
      `${b.kind}: starter-set buildings are already constructed — no rebuild timers`,
    );
  }
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

test("applyPlaceBuildings: strips forged workers/draft on new placements", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 1000,
    warehouse: { wood: 20, stone: 10, iron: 5, arcane: 2, food: 0 },
    buildings: [],
  });
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(state, "s0", 0, [
    { gx: 0, gy: 0, kind: "house", level: 1, style: "classic", workers: -5, draft: { peasant: 999 } },
  ]);
  assert.equal(result.ok, true);
  const placed = result.state.settlements.s0.buildings[0];
  assert.equal("workers" in placed, false, "new placements start with no assigned workers");
  assert.equal("draft" in placed, false, "new placements start with no recruit pool");
});

test("applyPlaceBuildings: round-trip keeps server-owned workers/draft for existing buildings", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 1000,
    buildings: [
      { gx: 1, gy: 1, kind: "barracks", level: 1, style: "classic", workers: 0, draft: { peasant: 1 } },
    ],
  });
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(state, "s0", 0, [
    { gx: 1, gy: 1, kind: "barracks", level: 1, style: "classic", workers: 9, draft: { peasant: 999 } },
  ]);
  assert.equal(result.ok, true);
  const after = result.state.settlements.s0.buildings[0];
  assert.equal(after.workers, 0, "a spoofed client workers value must not override the server's");
  assert.deepEqual(after.draft, { peasant: 1 });
});

test("applyPlaceBuildings district mode: strips forged workers/draft on new placements", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 1000,
    warehouse: { wood: 20, stone: 10, iron: 5, arcane: 2, food: 0 },
    buildings: [],
  });
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(
    state,
    "s0",
    0,
    [{ gx: 2, gy: 2, kind: "house", level: 1, style: "classic", workers: 7, draft: { knight: 50 } }],
    false,
    { q: 3, r: 2 },
  );
  assert.equal(result.ok, true);
  const placed = result.state.settlements.s0.districts?.["3,2"].buildings[0];
  assert.ok(placed, "district building committed");
  assert.equal("workers" in placed, false);
  assert.equal("draft" in placed, false);
});

test("applyPlaceBuildings: new placements in a normalized settlement start at explicit 0", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 1000,
    warehouse: { wood: 20, stone: 10, iron: 5, arcane: 2, food: 0 },
    buildings: [{ gx: 1, gy: 1, kind: "farmField", level: 1, style: "classic", workers: 2 }],
  });
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(state, "s0", 0, [
    { gx: 1, gy: 1, kind: "farmField", level: 1, style: "classic" },
    { gx: 2, gy: 2, kind: "house", level: 1, style: "classic" },
  ]);
  assert.equal(result.ok, true);
  const after = result.state.settlements.s0.buildings;
  assert.equal(after[0].workers, 2, "round-tripped buildings keep the server's explicit staff");
  assert.equal(after[1].workers, 0, "the new placement starts unstaffed instead of legacy");
});

test("applyPlaceBuildings: legacy settlements keep new placements legacy", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 1000,
    warehouse: { wood: 20, stone: 10, iron: 5, arcane: 2, food: 0 },
    buildings: [{ gx: 1, gy: 1, kind: "farmField", level: 1, style: "classic" }],
  });
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(state, "s0", 0, [
    { gx: 1, gy: 1, kind: "farmField", level: 1, style: "classic" },
    { gx: 2, gy: 2, kind: "goldMine", level: 1, style: "classic" },
  ]);
  assert.equal(result.ok, true);
  const after = result.state.settlements.s0.buildings;
  assert.equal("workers" in after[0], false, "legacy buildings stay legacy through the round-trip");
  assert.equal("workers" in after[1], false, "new placements stay legacy while the settlement is legacy");
});

test("applyPlaceBuildings: a normalized district makes main-path placements start at explicit 0", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      gold: 1000,
      warehouse: { wood: 20, stone: 10, iron: 5, arcane: 2, food: 0 },
    }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [{ gx: 0, gy: 0, kind: "house", level: 1, style: "classic", workers: 0 }],
      },
    },
  };
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(state, "s0", 0, [
    { gx: 2, gy: 2, kind: "house", level: 1, style: "classic" },
  ]);
  assert.equal(result.ok, true);
  assert.equal(
    result.state.settlements.s0.buildings[0].workers,
    0,
    "the settlement counts as normalized through its district",
  );
});

test("applyPlaceBuildings district mode: new placements in a normalized settlement start at explicit 0", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 1000,
    warehouse: { wood: 20, stone: 10, iron: 5, arcane: 2, food: 0 },
    buildings: [{ gx: 1, gy: 1, kind: "house", level: 1, style: "classic", workers: 0 }],
  });
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(
    state,
    "s0",
    0,
    [{ gx: 2, gy: 2, kind: "house", level: 1, style: "classic", workers: 7 }],
    false,
    { q: 3, r: 2 },
  );
  assert.equal(result.ok, true);
  const placed = result.state.settlements.s0.districts?.["3,2"].buildings[0];
  assert.ok(placed, "district building committed");
  assert.equal(placed.workers, 0, "the normalized default replaces the forged value");
});
