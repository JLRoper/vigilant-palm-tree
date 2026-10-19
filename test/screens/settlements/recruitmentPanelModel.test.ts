import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, DistrictState, SettlementState } from "@heroes/contracts";
import { districtKey, type UnitType } from "@heroes/engine";
import {
  allocateRecruitCounts,
  allocateWorkerSteps,
  recruitmentAffordable,
  recruitmentCanAddWorker,
  recruitmentCanRemoveWorker,
  recruitmentCanStaffAny,
  recruitmentCanUnstaffAny,
  recruitmentIdleWorkers,
  recruitmentMaxCount,
  recruitmentSnapshot,
  recruitmentStaffing,
  recruitmentTreasury,
  recruitmentWorkerBase,
  recruitmentWorkerTarget,
  type RecruitmentFilter,
} from "../../../src/screens/settlements/recruitmentPanelModel";
import { makeSettlement, emptyWarehouse } from "../../charter/_helpers";

// The recruitment panel as data: which offerings appear, what is ready, and
// what the treasury can actually pay for. DOM-free on purpose (the bankRows
// test seam) -- a wrong "ready" or an affordable-looking row is the whole bug
// class this panel can have.

function building(
  kind: BuildingDef["kind"],
  gx: number,
  gy: number,
  level: BuildingDef["level"] = 1,
  draft?: BuildingDef["draft"],
  construction?: BuildingDef["construction"],
): BuildingDef {
  return {
    gx,
    gy,
    kind,
    level,
    style: "classic",
    ...(draft ? { draft } : {}),
    ...(construction ? { construction } : {}),
  };
}

function withDistricts(settlement: SettlementState, districts: DistrictState[]): SettlementState {
  return {
    ...settlement,
    districts: Object.fromEntries(districts.map((d) => [districtKey(d.q, d.r), d])),
  };
}

test("no recruit buildings reports an empty snapshot", () => {
  const model = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, { gold: 5000, buildings: [building("house", 0, 0)] }),
  );
  assert.deepEqual(model.groups, []);
  assert.equal(model.ready, 0);
  assert.equal(model.capacity, 0);
});

test("a building offers only the units its level unlocks", () => {
  const model = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, { gold: 5000, buildings: [building("barracks", 1, 1, 1)] }),
  );
  assert.equal(model.groups.length, 1);
  assert.deepEqual(model.groups[0].units.map((u) => u.unitTypeId), ["swordsman"]);
  assert.equal(model.groups[0].label, "Barracks");
});

test("level 2 barracks adds the level-2 unit and its resource cost", () => {
  const model = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, { gold: 5000, buildings: [building("barracks", 1, 1, 2)] }),
  );
  const units = model.groups[0].units;
  assert.deepEqual(units.map((u) => u.unitTypeId), ["swordsman", "pikeman"]);
  assert.deepEqual(units[1].resources, [{ resource: "iron", amount: 3 }]);
});

test("an unset draft pool reads as a full pool, and a stale one never goes negative", () => {
  const model = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, {
      gold: 5000,
      buildings: [building("barracks", 1, 1, 1), building("archeryRange", 2, 2, 1, { archer: -4 })],
    }),
  );
  assert.equal(model.groups[0].units[0].ready, 3);
  assert.equal(model.groups[0].units[0].draftMax, 3);
  assert.equal(model.groups[1].units[0].ready, 0);
  assert.equal(model.ready, 3);
  assert.equal(model.capacity, 6);
});

test("a building under construction offers nothing", () => {
  const model = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, {
      gold: 5000,
      buildings: [building("barracks", 1, 1, 1, undefined, { daysRemaining: 3 })],
    }),
  );
  assert.deepEqual(model.groups, []);
});

test("district buildings are listed after the main city, with their own coords", () => {
  const main = building("barracks", 1, 1, 1);
  const settlement = withDistricts(
    makeSettlement("s0", 0, 2, 2, { gold: 5000, buildings: [main] }),
    [
      { q: 4, r: -2, citySpots: [], buildings: [building("archeryRange", 0, 0, 1)] },
      { q: 3, r: 1, citySpots: [], buildings: [building("stables", 0, 1, 1)] },
    ],
  );
  const model = recruitmentSnapshot(settlement);
  assert.deepEqual(
    model.groups.map((g) => g.label),
    ["Barracks", "Stables", "Archery Range"],
  );
  assert.equal(model.groups[0].buildings[0].district, null);
  assert.deepEqual(model.groups[1].buildings[0].district, { q: 3, r: 1 });
  assert.deepEqual(model.groups[2].buildings[0].district, { q: 4, r: -2 });
  assert.equal(model.groups[1].units[0].sources[0].district?.q, 3);
});

test("the faction gate hides a unit without dropping the rest of the row", () => {
  const filter: RecruitmentFilter = { isUnitRecruitable: (id) => id !== "swordsman" };
  const model = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, { gold: 5000, buildings: [building("barracks", 1, 1, 2)] }),
    filter,
  );
  assert.deepEqual(model.groups[0].units.map((u) => u.unitTypeId), ["pikeman"]);
});

test("affordability counts gold and every resource, per unit and in bulk", () => {
  const model = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, {
      gold: 1000,
      warehouse: emptyWarehouse({ wood: 3, iron: 4 }),
      buildings: [building("archeryRange", 1, 1, 2)],
    }),
  );
  const [archer, crossbowman] = model.groups[0].units;
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 1000,
    warehouse: emptyWarehouse({ wood: 3, iron: 4 }),
    buildings: [],
  });
  // archer: 250g + 2 wood -> wood allows 1, gold allows 4, pool allows 3.
  assert.equal(recruitmentMaxCount(settlement, archer), 1);
  assert.equal(recruitmentAffordable(settlement, archer, 1), true);
  assert.equal(recruitmentAffordable(settlement, archer, 2), false);
  // crossbowman: 350g + 2 iron -> iron allows 2, gold allows 2.
  assert.equal(recruitmentMaxCount(settlement, crossbowman), 2);
  assert.equal(recruitmentAffordable(settlement, crossbowman, 0), false);
});

test("max count is bounded by the ready pool and never negative", () => {
  const model = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, {
      gold: 0,
      buildings: [building("barracks", 1, 1, 1, { swordsman: 0 })],
    }),
  );
  const settlement = makeSettlement("s0", 0, 2, 2, { gold: 0, buildings: [] });
  assert.equal(recruitmentMaxCount(settlement, model.groups[0].units[0]), 0);
  assert.equal(recruitmentMaxCount(undefined, model.groups[0].units[0]), 0);
});

test("an undefined settlement reads as an empty, unpaid treasury", () => {
  assert.deepEqual(recruitmentTreasury(undefined), {
    gold: 0,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
});

// ---- staffing stepper + refill rate ---------------------------------------

function unitType(id: string, tier: UnitType["tier"]): UnitType {
  return { id, name: id, attack: 1, defence: 1, health: 1, speed: 1, description: "", advantageType: "infantry", specialty: "", specialtyPriority: 0, tier };
}

test("the refill rate is base × staffing × unit tier, shown per week", () => {
  // A legacy (workers undefined) building reads as fully staffed: effort 1, so
  // draftRechargeMultiplier is 2.
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    buildings: [building("barracks", 1, 1, 2, { swordsman: 1 })],
  });
  const legacy = recruitmentSnapshot(settlement, { unitTypes: { swordsman: unitType("swordsman", 2) } });
  const swordsman = legacy.groups[0].units[0];
  // 0.25 base × (1 + 1 effort) × 0.8 (tier 2)
  assert.equal(swordsman.sources[0].perDay, 0.4);
  assert.equal(Math.round(swordsman.perWeek * 10) / 10, 2.8);
  assert.equal(swordsman.ready, 1);
});

test("the tier multiplier is applied when the catalog is supplied, tier 1 otherwise", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    buildings: [building("barracks", 1, 1, 1)],
  });
  const withCatalog = recruitmentSnapshot(settlement, { unitTypes: { swordsman: unitType("swordsman", 7) } });
  assert.equal(withCatalog.groups[0].units[0].sources[0].perDay, 0.25 * 2 * 0.2);
  const withoutCatalog = recruitmentSnapshot(settlement);
  assert.equal(withoutCatalog.groups[0].units[0].sources[0].perDay, 0.25 * 2);
});

test("fewer workers means a slower refill", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    buildings: [{ ...building("barracks", 1, 1), workers: 1 }, { ...building("house", 0, 0), workers: 4 }],
  });
  const model = recruitmentSnapshot(settlement);
  const group = model.groups[0];
  const barracks = group.buildings[0];
  // effort = 1/4 -> 0.25 × 1.25 × 1
  assert.equal(barracks.workers, 1);
  assert.equal(barracks.maxWorkers, 4);
  assert.equal(group.units[0].sources[0].perDay, 0.3125);
});

test("the stepper reads legacy as Auto/0 and explicit counts otherwise", () => {
  const legacy = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, { gold: 5000, population: 1200, buildings: [building("barracks", 1, 1)] }),
  );
  const legacyBuilding = legacy.groups[0].buildings[0];
  assert.equal(legacy.legacy, true);
  assert.equal(legacyBuilding.workers, undefined);
  assert.equal(legacy.pool, 12);
  assert.equal(legacy.assigned, 0);
  assert.equal(recruitmentWorkerBase(legacyBuilding, legacy), 0);
  assert.equal(recruitmentCanAddWorker(legacyBuilding, legacy), true);
  assert.equal(recruitmentCanRemoveWorker(legacyBuilding, legacy), false);
  assert.equal(recruitmentWorkerTarget(legacyBuilding, legacy, 1), 1);
  assert.equal(recruitmentWorkerTarget(legacyBuilding, legacy, -1), 0);

  const explicit = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, {
      gold: 5000,
      population: 1200,
      buildings: [{ ...building("barracks", 1, 1), workers: 4 }],
    }),
  );
  const explicitBuilding = explicit.groups[0].buildings[0];
  assert.equal(explicit.legacy, false);
  assert.equal(explicit.assigned, 4);
  assert.equal(recruitmentIdleWorkers(explicit), 8);
  assert.equal(recruitmentWorkerBase(explicitBuilding, explicit), 4);
  // Slots are full: no + even with idle workers to spare.
  assert.equal(recruitmentCanAddWorker(explicitBuilding, explicit), false);
  assert.equal(recruitmentWorkerTarget(explicitBuilding, explicit, -1), 3);
});

test("the stepper cannot overspend the idle pool", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    population: 200,
    buildings: [{ ...building("barracks", 1, 1), workers: 1 }, { ...building("house", 0, 0), workers: 1 }],
  });
  const model = recruitmentSnapshot(settlement);
  const building0 = model.groups[0].buildings[0];
  assert.equal(model.pool, 2);
  assert.equal(model.assigned, 2);
  assert.equal(recruitmentIdleWorkers(model), 0);
  assert.equal(recruitmentCanAddWorker(building0, model), false);
});

// ---- grouping + buy-all allocation ----------------------------------------

test("every building of one kind collapses into a single group", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    buildings: [
      building("barracks", 1, 1, 1, { swordsman: 3 }),
      building("barracks", 3, 3, 2, { swordsman: 1, pikeman: 2 }),
      building("archeryRange", 4, 4, 1),
    ],
  });
  const model = recruitmentSnapshot(settlement);
  assert.deepEqual(model.groups.map((g) => g.label), ["Barracks", "Archery Range"]);
  const barracks = model.groups[0];
  assert.equal(barracks.buildings.length, 2);
  assert.deepEqual(barracks.units.map((u) => u.unitTypeId), ["swordsman", "pikeman"]);
  // Level gating is per building: the L1 barracks offers no pikeman.
  assert.equal(barracks.units[1].sources.length, 1);
  assert.equal(barracks.units[1].ready, 2);
  // Aggregates: the swordsman pools add up across both barracks.
  const swordsman = barracks.units[0];
  assert.equal(swordsman.ready, 4);
  assert.equal(swordsman.capacity, 6);
  assert.equal(barracks.ready, 6);
});

test("a unit's sources are ordered most-stocked first, main city before districts", () => {
  const settlement = withDistricts(
    makeSettlement("s0", 0, 2, 2, {
      gold: 5000,
      buildings: [building("barracks", 1, 1, 1, { swordsman: 1 })],
    }),
    [
      {
        q: 3,
        r: -2,
        citySpots: [],
        buildings: [building("barracks", 0, 0, 1, { swordsman: 3 })],
      },
    ],
  );
  const model = recruitmentSnapshot(settlement);
  const barracks = model.groups[0];
  assert.equal(barracks.units[0].sources.length, 2);
  assert.deepEqual(barracks.units[0].sources.map((s) => s.ready), [3, 1]);
  assert.deepEqual(barracks.units[0].sources[0].district, { q: 3, r: -2 });
  // Equal pools fall back to main-city-first.
  assert.equal(barracks.units[0].sources[1].district, null);
});

test("buy-all draws the most-stocked building first, then round-robins", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    buildings: [
      building("barracks", 1, 1, 1, { swordsman: 3 }),
      building("barracks", 3, 3, 1, { swordsman: 1 }),
    ],
  });
  const row = recruitmentSnapshot(settlement).groups[0].units[0];
  assert.deepEqual(allocateRecruitCounts(row, 4), [
    { gx: 1, gy: 1, district: null, count: 3 },
    { gx: 3, gy: 3, district: null, count: 1 },
  ]);
  // A partial buy still takes from the most-stocked pool.
  assert.deepEqual(allocateRecruitCounts(row, 2), [{ gx: 1, gy: 1, district: null, count: 2 }]);
});

test("level pools split evenly, and nothing exceeds what is ready", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    buildings: [
      building("barracks", 1, 1, 1, { swordsman: 2 }),
      building("barracks", 3, 3, 1, { swordsman: 2 }),
    ],
  });
  const row = recruitmentSnapshot(settlement).groups[0].units[0];
  assert.deepEqual(allocateRecruitCounts(row, 4), [
    { gx: 1, gy: 1, district: null, count: 2 },
    { gx: 3, gy: 3, district: null, count: 2 },
  ]);
  // 99 asked, 4 available -> 4 allocated, never more.
  const capped = allocateRecruitCounts(row, 99);
  assert.equal(capped.reduce((sum, s) => sum + s.count, 0), 4);
  assert.deepEqual(allocateRecruitCounts(row, 0), []);
});

test("an empty pool allocates nothing", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    buildings: [building("barracks", 1, 1, 1, { swordsman: 0 })],
  });
  const row = recruitmentSnapshot(settlement).groups[0].units[0];
  assert.equal(row.ready, 0);
  assert.deepEqual(allocateRecruitCounts(row, 3), []);
});

test("max count aggregates the pools and stops at what the treasury affords", () => {
  const model = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, {
      gold: 450,
      buildings: [
        building("barracks", 1, 1, 1, { swordsman: 3 }),
        building("barracks", 3, 3, 1, { swordsman: 3 }),
      ],
    }),
  );
  const row = model.groups[0].units[0];
  const settlement = makeSettlement("s0", 0, 2, 2, { gold: 450, buildings: [] });
  // 200g each: 450 gold buys 2 of the 6 ready. Both pools are level, so the
  // draw round-robins one from each rather than draining one building.
  assert.equal(recruitmentMaxCount(settlement, row), 2);
  const rich = makeSettlement("s0", 0, 2, 2, { gold: 5000, buildings: [] });
  assert.equal(recruitmentMaxCount(rich, row), 6);
  assert.deepEqual(allocateRecruitCounts(row, 2), [
    { gx: 1, gy: 1, district: null, count: 1 },
    { gx: 3, gy: 3, district: null, count: 1 },
  ]);
});

// ---- the unit row as parent: bulk staffing across its buildings ------------

test("a unit row carries its sources' own staffing and the parent summary adds it up", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    population: 800,
    buildings: [
      { ...building("barracks", 1, 1), workers: 1 },
      { ...building("barracks", 3, 3), workers: 3 },
    ],
  });
  const model = recruitmentSnapshot(settlement);
  const row = model.groups[0].units[0];
  assert.deepEqual(
    row.sources.map((s) => [s.gx, s.workers, s.maxWorkers]),
    [[1, 1, 4], [3, 3, 4]],
  );
  const summary = recruitmentStaffing(row.sources, model);
  assert.equal(summary.auto, false);
  assert.equal(summary.workers, 4);
  assert.equal(summary.maxWorkers, 8);
  assert.equal(summary.idle, 4);
});

test("a legacy settlement's parent row reads Auto and offers one explicit step", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    population: 800,
    buildings: [building("barracks", 1, 1), building("barracks", 3, 3)],
  });
  const model = recruitmentSnapshot(settlement);
  const row = model.groups[0].units[0];
  const summary = recruitmentStaffing(row.sources, model);
  assert.equal(summary.auto, true);
  assert.equal(summary.workers, 0);
  assert.equal(summary.maxWorkers, 8);
  assert.equal(recruitmentCanStaffAny(row.sources, model), true);
  assert.equal(recruitmentCanUnstaffAny(row.sources, model), false);
  // ONE step, not one per building: the first explicit count normalizes the
  // settlement and the engine auto-crews the rest from the remaining pool, so a
  // batch of absolute counts would double-spend that auto-crew.
  assert.deepEqual(allocateWorkerSteps(row.sources, model, 1), [
    { gx: 1, gy: 1, district: null, workers: 1 },
  ]);
  assert.deepEqual(allocateWorkerSteps(row.sources, model, -1), []);
});

test("the parent + puts one worker on every building that trains the unit, emptiest first", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    population: 1000,
    buildings: [
      { ...building("barracks", 1, 1), workers: 3 },
      { ...building("barracks", 3, 3), workers: 0 },
    ],
  });
  const model = recruitmentSnapshot(settlement);
  const row = model.groups[0].units[0];
  // 10 in the pool, 3 assigned -> 7 idle, both buildings have room.
  assert.deepEqual(allocateWorkerSteps(row.sources, model, 1), [
    { gx: 3, gy: 3, district: null, workers: 1 },
    { gx: 1, gy: 1, district: null, workers: 4 },
  ]);
});

test("the parent + stops at the idle pool and skips full buildings", () => {
  const tight = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, {
      gold: 5000,
      population: 400,
      buildings: [
        { ...building("barracks", 1, 1), workers: 3 },
        { ...building("barracks", 3, 3), workers: 0 },
      ],
    }),
  );
  // pool 4, assigned 3 -> one idle worker: only the emptiest building gets it.
  assert.deepEqual(allocateWorkerSteps(tight.groups[0].units[0].sources, tight, 1), [
    { gx: 3, gy: 3, district: null, workers: 1 },
  ]);

  const full = recruitmentSnapshot(
    makeSettlement("s0", 0, 2, 2, {
      gold: 5000,
      population: 2000,
      buildings: [
        { ...building("barracks", 1, 1), workers: 4 },
        { ...building("barracks", 3, 3), workers: 1 },
      ],
    }),
  );
  const row = full.groups[0].units[0];
  assert.equal(recruitmentCanStaffAny(row.sources, full), true);
  assert.deepEqual(allocateWorkerSteps(row.sources, full, 1), [
    { gx: 3, gy: 3, district: null, workers: 2 },
  ]);
});

test("the parent − takes one worker off every staffed building, fullest first", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    population: 1000,
    buildings: [
      { ...building("barracks", 1, 1), workers: 1 },
      { ...building("barracks", 3, 3), workers: 4 },
    ],
  });
  const model = recruitmentSnapshot(settlement);
  const row = model.groups[0].units[0];
  assert.deepEqual(allocateWorkerSteps(row.sources, model, -1), [
    { gx: 3, gy: 3, district: null, workers: 3 },
    { gx: 1, gy: 1, district: null, workers: 0 },
  ]);
  // Nothing left to take off once every building is empty.
  assert.deepEqual(
    allocateWorkerSteps(row.sources.map((s) => ({ ...s, workers: 0 })), model, -1),
    [],
  );
});

test("the parent stepper detects a row with no room and no workers", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 5000,
    population: 200,
    buildings: [
      { ...building("barracks", 1, 1), workers: 2 },
      { ...building("barracks", 3, 3), workers: 2 },
    ],
  });
  const model = recruitmentSnapshot(settlement);
  const row = model.groups[0].units[0];
  // pool 2 and both slots full: nothing to add, but workers to take off.
  assert.equal(recruitmentCanStaffAny(row.sources, model), false);
  assert.equal(recruitmentCanUnstaffAny(row.sources, model), true);
  assert.equal(recruitmentStaffing(row.sources, model).idle, 0);
});

