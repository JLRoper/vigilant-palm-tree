import { test } from "node:test";
import assert from "node:assert/strict";
import { recruitUnits, settlementStacks } from "@heroes/engine";
import type { BuildingDef, GameState, Platoon, SettlementState } from "@heroes/contracts";
import { emptyWarehouse, makeSettlement, makeState } from "../charter/_helpers";

const STOCK_WAREHOUSE = emptyWarehouse({ wood: 20, stone: 10, iron: 10, arcane: 10 });

function building(kind: BuildingDef["kind"], gx: number, gy: number, level = 1, overrides: Partial<BuildingDef> = {}): BuildingDef {
  return { gx, gy, kind, level, style: "classic", ...overrides };
}

const BARRACKS = { gx: 2, gy: 3 };

function recruitState(settlementOverrides: Partial<SettlementState> = {}, buildings?: BuildingDef[]): GameState {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 5, 5, {
      gold: 1000,
      warehouse: STOCK_WAREHOUSE,
      buildings: buildings ?? [building("barracks", BARRACKS.gx, BARRACKS.gy)],
    }),
    ...settlementOverrides,
  };
  return makeState({ settlements: [settlement] });
}

function recruit(
  state: GameState,
  unitTypeId: string,
  count: number,
  buildingKind: BuildingDef["kind"] = "barracks",
  gx = BARRACKS.gx,
  gy = BARRACKS.gy,
) {
  return recruitUnits(state, { settlementId: "s0", buildingKind, gx, gy, unitTypeId, count });
}

test("recruitUnits: happy path deducts treasury gold and deposits the garrison stack", () => {
  const result = recruit(recruitState(), "swordsman", 2);
  assert.equal(result.ok, true);
  const after = result.state.settlements.s0;
  assert.equal(after.gold, 1000 - 400, "2 swordsmen at 200g each");
  assert.deepEqual(settlementStacks(after)[0].entries, [{ unitTypeId: "swordsman", count: 2 }]);
  assert.deepEqual(after.warehouse, STOCK_WAREHOUSE, "swordsman has no resourceCost, warehouse untouched");
  assert.equal(result.state.dirty, true);
});

test("recruitUnits: resource costs are deducted from the warehouse per unit recruited", () => {
  const state = recruitState({}, [building("barracks", BARRACKS.gx, BARRACKS.gy), building("archeryRange", 4, 4)]);
  const result = recruit(state, "archer", 2, "archeryRange", 4, 4);
  assert.equal(result.ok, true);
  const after = result.state.settlements.s0;
  assert.equal(after.gold, 1000 - 500, "2 archers at 250g each");
  assert.equal(after.warehouse.wood, 20 - 4, "2 wood per archer");
  assert.deepEqual(settlementStacks(after)[0].entries, [{ unitTypeId: "archer", count: 2 }]);
});

test("recruitUnits: a unit above the building's level is refused until the building is upgraded", () => {
  const refused = recruit(recruitState(), "pikeman", 1);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "building_level_too_low");
  assert.equal(refused.state.settlements.s0.gold, 1000);

  const upgraded = recruitState({ buildings: [building("barracks", BARRACKS.gx, BARRACKS.gy, 2)] });
  const ok = recruit(upgraded, "pikeman", 1);
  assert.equal(ok.ok, true);
  assert.equal(ok.state.settlements.s0.gold, 1000 - 250);
  assert.equal(ok.state.settlements.s0.warehouse.iron, 10 - 3, "pikeman costs 3 iron");
  assert.deepEqual(settlementStacks(ok.state.settlements.s0)[0].entries, [{ unitTypeId: "pikeman", count: 1 }]);
});

test("recruitUnits: a building under construction cannot recruit", () => {
  const state = recruitState({}, [building("barracks", BARRACKS.gx, BARRACKS.gy, 1, { construction: { daysRemaining: 2 } })]);
  const result = recruit(state, "swordsman", 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "building_under_construction");
  assert.equal(result.state.settlements.s0.gold, 1000);
});

test("recruitUnits: a unit not on the building's own roster is not_recruitable", () => {
  const state = recruitState({}, [building("barracks", BARRACKS.gx, BARRACKS.gy), building("mageGuild", 6, 6)]);
  const result = recruit(state, "mage", 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_recruitable", "mage belongs to the mageGuild roster, not barracks");
});

test("recruitUnits: unknown grid cell and unowned settlement are refused", () => {
  const missing = recruit(recruitState(), "swordsman", 1, "barracks", 9, 9);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "no_building");

  const unowned = recruit(recruitState({ ownerId: null }), "swordsman", 1);
  assert.equal(unowned.ok, false);
  assert.equal(unowned.reason, "unowned_settlement");
});

test("recruitUnits: unaffordable gold or iron is refused and touches nothing", () => {
  const broke = recruit(recruitState({ gold: 100 }), "swordsman", 1);
  assert.equal(broke.ok, false);
  assert.equal(broke.reason, "not_enough_gold");
  assert.equal(broke.state.settlements.s0.gold, 100);

  const noIron = recruit(
    recruitState({ warehouse: emptyWarehouse({ wood: 20, stone: 10, iron: 4, arcane: 10 }) }, [
      building("barracks", BARRACKS.gx, BARRACKS.gy, 3),
    ]),
    "crusader",
    1,
  );
  assert.equal(noIron.ok, false);
  assert.equal(noIron.reason, "not_enough_iron", "crusader costs 5 iron");
  assert.equal(noIron.state.settlements.s0.warehouse.iron, 4);
  assert.equal(noIron.state.settlements.s0.gold, 1000);
});

test("recruitUnits: zero, negative, and non-integer counts are refused", () => {
  for (const count of [0, -1, 1.5]) {
    const result = recruit(recruitState(), "swordsman", count);
    assert.equal(result.ok, false, `count ${count} must be refused`);
    assert.equal(result.reason, "invalid_count");
  }
});

test("recruitUnits: a full garrison (8 platoons x 3 distinct types) refuses a 25th distinct type untouched", () => {
  const fullStacks: Platoon[] = [];
  for (let i = 0; i < 8; i++) {
    fullStacks.push({
      entries: [
        { unitTypeId: `t${i * 3}`, count: 1 },
        { unitTypeId: `t${i * 3 + 1}`, count: 1 },
        { unitTypeId: `t${i * 3 + 2}`, count: 1 },
      ],
    });
  }
  const state = recruitState({ stacks: fullStacks });
  const result = recruit(state, "swordsman", 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "garrison_full");
  assert.equal(result.state.settlements.s0.gold, 1000);
  assert.deepEqual(settlementStacks(result.state.settlements.s0), fullStacks, "garrison untouched by the refusal");
});

test("recruitUnits: recruiting the same type twice merges into one growing entry", () => {
  const first = recruit(recruitState({ gold: 1200 }), "swordsman", 2);
  assert.equal(first.ok, true);
  const second = recruit(first.state, "swordsman", 3);
  assert.equal(second.ok, true);
  const after = second.state.settlements.s0;
  assert.equal(after.gold, 1200 - 400 - 600);
  const entries = settlementStacks(after).flatMap((p) => p.entries);
  assert.deepEqual(entries, [{ unitTypeId: "swordsman", count: 5 }], "one merged entry, no second platoon");
});

test("recruitUnits: a recruit entry without resourceCost (farmhouse peasant) works", () => {
  const state = recruitState({}, [building("barracks", BARRACKS.gx, BARRACKS.gy), building("farmhouse", 0, 0)]);
  const result = recruit(state, "peasant", 3, "farmhouse", 0, 0);
  assert.equal(result.ok, true);
  const after = result.state.settlements.s0;
  assert.equal(after.gold, 1000 - 75, "3 peasants at 25g each");
  assert.deepEqual(after.warehouse, STOCK_WAREHOUSE, "peasant has no resourceCost");
  assert.deepEqual(settlementStacks(after)[0].entries, [{ unitTypeId: "peasant", count: 3 }]);
});
