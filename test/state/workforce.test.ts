import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceSettlementUpgrades,
  assignedWorkersExplicit,
  assignWorkers,
  canAssignWorkers,
  effortFraction,
  hasExplicitStaffing,
  hasLegacyStaffing,
  producerTurnOutput,
  staffingBase,
  upgradeAccelEffort,
  workforcePool,
} from "@heroes/engine";
import type { BuildingDef, GameState, SettlementState } from "@heroes/contracts";
import { settlementDailyRates } from "../../src/screens/settlements/panelRates";
import { emptyWarehouse, makeSettlement, makeState } from "../charter/_helpers";

function building(kind: BuildingDef["kind"], gx: number, gy: number, overrides: Partial<BuildingDef> = {}): BuildingDef {
  return { gx, gy, kind, level: 1, style: "classic", ...overrides };
}

function stateWithSettlement(settlement: SettlementState): GameState {
  return makeState({ settlements: [settlement] });
}

test("workforcePool floors population / 100 and yields 0 below 100", () => {
  assert.equal(workforcePool(makeSettlement("s0", 0, 2, 2, { population: 500 })), 5);
  assert.equal(workforcePool(makeSettlement("s0", 0, 2, 2, { population: 199 })), 1);
  assert.equal(workforcePool(makeSettlement("s0", 0, 2, 2, { population: 99 })), 0);
  assert.equal(workforcePool(makeSettlement("s0", 0, 2, 2, { population: 50 })), 0, "a freshly chartered 50-pop settlement has no first worker");
  assert.equal(workforcePool(makeSettlement("s0", 0, 2, 2)), 0);
});

test("effortFraction: legacy undefined is 1, 0 workers is 0, max is 1, over-max clamps", () => {
  const base = building("farmField", 0, 0);
  assert.equal(effortFraction(base), 1);
  assert.equal(effortFraction({ ...base, workers: 2 }), 1, "farmField max is 2");
  assert.equal(effortFraction({ ...base, workers: 5 }), 1, "over-max clamps at 1");
  assert.equal(effortFraction({ ...base, workers: 1 }), 0.5);
  assert.equal(effortFraction({ ...base, workers: 0 }), 0);
});

test("assignedWorkersExplicit counts explicit main + district workers and only those", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      buildings: [
        building("farmField", 0, 0, { workers: 1 }),
        building("farmhouse", 1, 0, { workers: 1 }),
        building("house", 2, 0),
      ],
    }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [building("farmField", 0, 0, { workers: 2 }), building("house", 1, 0)],
      },
    },
  };
  assert.equal(assignedWorkersExplicit(settlement), 4, "1 + 1 main plus 2 district; undefined staff not counted");
});

test("hasLegacyStaffing: any undefined staffable building in main or districts makes the settlement legacy", () => {
  const main = (buildings: BuildingDef[]): SettlementState => makeSettlement("s0", 0, 2, 2, { buildings });
  assert.equal(hasLegacyStaffing(main([building("farmField", 0, 0), building("house", 1, 0)])), true, "all-undefined is legacy");
  assert.equal(
    hasLegacyStaffing(main([building("farmField", 0, 0, { workers: 0 }), building("house", 1, 0, { workers: 1 })])),
    false,
    "fully explicit is not legacy",
  );
  assert.equal(hasLegacyStaffing(main([building("farmField", 0, 0, { workers: 0 })])), false, "explicit 0 counts as explicit, not legacy");
  assert.equal(
    hasLegacyStaffing(main([building("farmField", 0, 0, { workers: 0 }), building("house", 1, 0)])),
    true,
    "one undefined building keeps the settlement legacy",
  );
  const districtLegacy: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, { buildings: [building("farmField", 0, 0, { workers: 0 })] }),
    districts: {
      "3,2": { q: 3, r: 2, citySpots: [], buildings: [building("farmField", 0, 0)] },
    },
  };
  assert.equal(hasLegacyStaffing(districtLegacy), true, "an undefined building in a district suffices");
  const districtExplicit: SettlementState = {
    ...districtLegacy,
    districts: {
      "3,2": { q: 3, r: 2, citySpots: [], buildings: [building("farmField", 0, 0, { workers: 0 })] },
    },
  };
  assert.equal(hasLegacyStaffing(districtExplicit), false, "explicit districts keep it non-legacy");
  assert.equal(hasLegacyStaffing(makeSettlement("s0", 0, 2, 2)), false, "no buildings at all is not legacy");
});

test("hasExplicitStaffing: any explicit staffable building in main or districts makes the settlement explicit", () => {
  const main = (buildings: BuildingDef[]): SettlementState => makeSettlement("s0", 0, 2, 2, { buildings });
  assert.equal(
    hasExplicitStaffing(main([building("farmField", 0, 0, { workers: 0 }), building("house", 1, 0, { workers: 1 })])),
    true,
    "fully explicit is explicit",
  );
  assert.equal(hasExplicitStaffing(main([building("farmField", 0, 0), building("house", 1, 0)])), false, "all-undefined is not explicit");
  assert.equal(hasExplicitStaffing(main([building("farmField", 0, 0, { workers: 0 })])), true, "an explicit 0 counts as explicit");
  assert.equal(
    hasExplicitStaffing(main([building("farmField", 0, 0), building("house", 1, 0, { workers: 1 })])),
    true,
    "one explicit building suffices",
  );
  const districtExplicit: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2),
    districts: {
      "3,2": { q: 3, r: 2, citySpots: [], buildings: [building("farmField", 0, 0, { workers: 2 })] },
    },
  };
  assert.equal(hasExplicitStaffing(districtExplicit), true, "an explicit district building suffices");
  assert.equal(hasExplicitStaffing(makeSettlement("s0", 0, 2, 2)), false, "no buildings at all is not explicit");
});

test("staffingBase: legacy reads 0, non-legacy resolves undefined to max, explicit passes through unclamped", () => {
  assert.equal(staffingBase(2, 2, true), 0, "legacy ignores the stored workers");
  assert.equal(staffingBase(undefined, 2, true), 0, "legacy undefined still reads 0");
  assert.equal(staffingBase(undefined, 3, false), 3, "non-legacy undefined means auto: max");
  assert.equal(staffingBase(1, 3, false), 1, "explicit value passes through");
  assert.equal(staffingBase(0, 3, false), 0, "explicit 0 passes through");
  assert.equal(staffingBase(5, 2, false), 5, "over-max is not clamped here (callers gate ranges)");
});

test("upgradeAccelEffort: 0 on legacy staff and other kinds; max over staffed townHall/mageGuild", () => {
  const th = building("townHall", 0, 0);
  const mg = building("mageGuild", 1, 0);
  const settle = (buildings: BuildingDef[]): SettlementState => makeSettlement("s0", 0, 2, 2, { buildings });
  assert.equal(upgradeAccelEffort(settle([th, mg])), 0, "undefined staff brings no accel");
  assert.equal(upgradeAccelEffort(settle([{ ...th, workers: 1 }, mg])), 1 / 3);
  assert.equal(upgradeAccelEffort(settle([{ ...th, workers: 1 }, { ...mg, workers: 2 }])), 2 / 3);
  assert.equal(upgradeAccelEffort(settle([{ ...th, workers: 3 }, { ...mg, workers: 1 }])), 1);
  assert.equal(upgradeAccelEffort(settle([building("farmField", 2, 0, { workers: 2 })])), 0, "producers do not accelerate research");
  const withDistrict: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, { buildings: [mg] }),
    districts: {
      "3,2": { q: 3, r: 2, citySpots: [], buildings: [{ ...th, workers: 2 }] },
    },
  };
  assert.equal(upgradeAccelEffort(withDistrict), 2 / 3, "district townHall stars in the max too");
});

test("assignWorkers: no settlement and no building are refused untouched", () => {
  const empty = makeState({ settlements: [] });
  const noSettlement = assignWorkers(empty, { settlementId: "nope", gx: 0, gy: 0, workers: 1 });
  assert.equal(noSettlement.ok, false);
  assert.equal(noSettlement.reason, "no_settlement");
  assert.equal(noSettlement.state, empty, "nothing to touch: same state back");

  const state = stateWithSettlement(makeSettlement("s0", 0, 2, 2, { buildings: [building("farmField", 0, 0)] }));
  const missing = assignWorkers(state, { settlementId: "s0", gx: 9, gy: 9, workers: 1 });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "no_building");
});

test("assignWorkers: negative, non-integer, and over-max workers are invalid_workers", () => {
  for (const workers of [-1, 0.5, Number.NaN, 3]) {
    const state = stateWithSettlement(makeSettlement("s0", 0, 2, 2, { buildings: [building("farmField", 0, 0)] }));
    const r = assignWorkers(state, { settlementId: "s0", gx: 0, gy: 0, workers });
    assert.equal(r.ok, false, `workers ${workers} must be refused`);
    assert.equal(r.reason, "invalid_workers");
  }
});

test("assignWorkers: pool_exhausted only when incrementing past the pool", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 250 }),
    buildings: [building("farmField", 0, 0), building("farmField", 1, 0)],
  });
  const a1 = assignWorkers(state, { settlementId: "s0", gx: 0, gy: 0, workers: 1 });
  assert.equal(a1.ok, true);
  const b1 = assignWorkers(a1.state, { settlementId: "s0", gx: 1, gy: 0, workers: 1 });
  assert.equal(b1.ok, true, "explicit total 2 sits at the floor(250/100) = 2 pool");
  const over = assignWorkers(b1.state, { settlementId: "s0", gx: 0, gy: 0, workers: 2 });
  assert.equal(over.ok, false, "incrementing to an explicit total of 3 over the pool of 2");
  assert.equal(over.reason, "pool_exhausted");
  assert.equal(over.state, b1.state, "a refused increment returns the state untouched");
  assert.equal(assignedWorkersExplicit(b1.state.settlements.s0), 2);
});

test("assignWorkers: the first assign writes the addressed building and leaves every other building legacy", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 200 }),
    buildings: [building("farmField", 0, 0), building("farmField", 1, 0), building("house", 2, 0)],
  });
  const r = assignWorkers(state, { settlementId: "s0", gx: 0, gy: 0, workers: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.state.settlements.s0.buildings.map((b) => b.workers),
    [2, undefined, undefined],
    "the addressed building takes the count; nothing else is converted to an explicit crew",
  );
  assert.equal(hasLegacyStaffing(r.state.settlements.s0), true, "the settlement is STILL legacy after the first assignment");
  assert.equal(effortFraction(r.state.settlements.s0.buildings[1]), 1, "the untouched farm keeps legacy full effort");
  assert.equal(assignedWorkersExplicit(r.state.settlements.s0), 2);
  assert.deepEqual(
    state.settlements.s0.buildings.map((b) => b.workers),
    [undefined, undefined, undefined],
    "the input state stays legacy",
  );
});

test("assignWorkers: first assign with an empty pool is refused atomically and persists no normalization", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 99 }),
    buildings: [building("farmField", 0, 0), building("farmField", 1, 0)],
  });
  const r = assignWorkers(state, { settlementId: "s0", gx: 0, gy: 0, workers: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "pool_exhausted");
  assert.equal(r.state, state, "a refused assignment returns the original state");
  assert.deepEqual(
    r.state.settlements.s0.buildings.map((b) => b.workers),
    [undefined, undefined],
    "the settlement is still legacy after the refusal",
  );
});

test("assignWorkers: a legacy first assign is billed against the whole target", () => {
  const legacyTownHall = (): SettlementState => ({
    ...makeSettlement("s0", 0, 2, 2, { population: 200 }),
    buildings: [building("townHall", 0, 0)],
  });
  const ok = assignWorkers(stateWithSettlement(legacyTownHall()), { settlementId: "s0", gx: 0, gy: 0, workers: 2 });
  assert.equal(ok.ok, true, "2 workers fit the pool of 2");
  assert.equal(ok.state.settlements.s0.buildings[0].workers, 2);

  const rejected = assignWorkers(stateWithSettlement(legacyTownHall()), { settlementId: "s0", gx: 0, gy: 0, workers: 3 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "pool_exhausted");
  assert.equal(rejected.state.settlements.s0.buildings[0].workers, undefined, "the refusal keeps the settlement legacy");
});

test("assignWorkers: after the first touch increments are gated while decrements stay free", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 200 }),
    buildings: [building("farmField", 0, 0), building("farmField", 1, 0)],
  });
  const first = assignWorkers(state, { settlementId: "s0", gx: 0, gy: 0, workers: 2 });
  assert.equal(first.ok, true);
  const blocked = assignWorkers(first.state, { settlementId: "s0", gx: 1, gy: 0, workers: 1 });
  assert.equal(blocked.ok, false, "a second assign reads explicit 0 and cannot refill the spent pool");
  assert.equal(blocked.reason, "pool_exhausted");
  assert.equal(blocked.state, first.state, "nothing persisted");
  const down = assignWorkers(first.state, { settlementId: "s0", gx: 0, gy: 0, workers: 1 });
  assert.equal(down.ok, true, "decrements are always allowed");
  assert.equal(assignedWorkersExplicit(down.state.settlements.s0), 1);
  const refill = assignWorkers(down.state, { settlementId: "s0", gx: 0, gy: 0, workers: 2 });
  assert.equal(refill.ok, true, "refilling back to the pool ceiling fits");
  assert.equal(assignedWorkersExplicit(refill.state.settlements.s0), 2);
  const reblocked = assignWorkers(refill.state, { settlementId: "s0", gx: 1, gy: 0, workers: 1 });
  assert.equal(reblocked.ok, false, "increments stay gated against the full final total");
  assert.equal(reblocked.reason, "pool_exhausted");
});

test("assignWorkers: decrements stay allowed while explicit staffing oversubscribes the pool", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 100 }),
    buildings: [building("farmField", 0, 0, { workers: 2 }), building("farmField", 1, 0, { workers: 2 })],
  });
  const down = assignWorkers(state, { settlementId: "s0", gx: 0, gy: 0, workers: 1 });
  assert.equal(down.ok, true, "4 explicit workers over a pool of 1 still shrink");
  assert.equal(assignedWorkersExplicit(down.state.settlements.s0), 3);
  const upAgain = assignWorkers(down.state, { settlementId: "s0", gx: 0, gy: 0, workers: 2 });
  assert.equal(upAgain.ok, false);
  assert.equal(upAgain.reason, "pool_exhausted", "re-incrementing while oversubscribed stays refused");
  assert.equal(upAgain.state, down.state, "a refused increment returns the state untouched");
});

test("assignWorkers: a district first assign writes the district target and leaves main and the other districts alone", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, { population: 300 }),
    buildings: [building("farmField", 0, 0)],
    districts: {
      "3,2": { q: 3, r: 2, citySpots: [], buildings: [building("farmField", 0, 0), building("house", 1, 0)] },
      "4,2": { q: 4, r: 2, citySpots: [], buildings: [building("farmField", 0, 0)] },
    },
  };
  const r = assignWorkers(stateWithSettlement(settlement), {
    settlementId: "s0",
    gx: 0,
    gy: 0,
    workers: 1,
    district: { q: 3, r: 2 },
  });
  assert.equal(r.ok, true);
  const after = r.state.settlements.s0;
  assert.equal(after.buildings[0].workers, undefined, "the main city keeps its legacy auto-staffing");
  assert.equal(after.districts?.["3,2"].buildings[0].workers, 1, "the district target gets the assignment");
  assert.equal(after.districts?.["3,2"].buildings[1].workers, undefined, "the district's other building is untouched");
  assert.equal(after.districts?.["4,2"].buildings[0].workers, undefined, "other districts are not auto-crewed");
  assert.equal(assignedWorkersExplicit(after), 1, "exactly one worker is explicit");
  assert.equal(hasLegacyStaffing(after), true);
});

test("assignWorkers: untouched buildings keep full legacy effort, construction sites included", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 400 }),
    buildings: [
      building("farmField", 0, 0),
      building("farmField", 1, 0, { construction: { daysRemaining: 2 } }),
      building("house", 2, 0),
    ],
  });
  const r = assignWorkers(state, { settlementId: "s0", gx: 0, gy: 0, workers: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.settlements.s0.buildings.map((b) => b.workers), [1, undefined, undefined]);
  assert.equal(effortFraction(r.state.settlements.s0.buildings[2]), 1, "the house still works at full legacy effort");
  assert.equal(assignedWorkersExplicit(r.state.settlements.s0), 1, "no surplus is auto-employed anywhere");
});

test("assignWorkers: an explicit count elsewhere in a legacy settlement is preserved, not overwritten", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 400 }),
    buildings: [
      building("farmField", 0, 0, { workers: 1 }),
      building("farmField", 1, 0),
      building("house", 2, 0),
    ],
  });
  const r = assignWorkers(state, { settlementId: "s0", gx: 1, gy: 0, workers: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.settlements.s0.buildings.map((b) => b.workers), [1, 1, undefined]);
});

test("assignWorkers: an explicit 0 is kept and shuts output down", () => {
  const state = stateWithSettlement(makeSettlement("s0", 0, 2, 2, { buildings: [building("farmField", 0, 0)] }));
  const r = assignWorkers(state, { settlementId: "s0", gx: 0, gy: 0, workers: 0 });
  assert.equal(r.ok, true);
  const b = r.state.settlements.s0.buildings[0];
  assert.equal(b.workers, 0, "explicit 0 stored, not erased back to legacy undefined");
  assert.equal(effortFraction(b), 0);
});

test("assignWorkers: district assignment round-trips and leaves the original state untouched", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, { population: 500 }),
    districts: {
      "3,2": { q: 3, r: 2, citySpots: [], buildings: [building("farmField", 0, 0)] },
    },
  };
  const state = stateWithSettlement(settlement);
  const original = structuredClone(state);
  const r = assignWorkers(state, { settlementId: "s0", gx: 0, gy: 0, workers: 1, district: { q: 3, r: 2 } });
  assert.equal(r.ok, true);
  assert.deepEqual(state, original, "the input state is unchanged");
  assert.notEqual(r.state, state);
  assert.equal(r.state.settlements.s0.districts?.["3,2"].buildings[0].workers, 1);
  assert.equal(r.state.settlements.s0.buildings.length, 0, "the main settlement list gains nothing");
  assert.equal(assignedWorkersExplicit(r.state.settlements.s0), 1);
});

test("assignWorkers source transfer: explicit source loses one, destination gains one, one command", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 300 }),
    buildings: [
      { ...building("market", 0, 0), w: 2, h: 1, workers: 2 },
      building("market", 3, 0, { workers: 0 }),
    ],
  });
  const original = structuredClone(state);
  const r = assignWorkers(state, {
    settlementId: "s0",
    gx: 3,
    gy: 0,
    workers: 1,
    source: { gx: 0, gy: 0 },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(state, original, "the input state is unchanged");
  const after = r.state.settlements.s0;
  assert.deepEqual(
    after.buildings.map((b) => b.workers),
    [1, 1],
    "source 2->1 and destination 0->1 in one atomic write",
  );
  assert.equal(assignedWorkersExplicit(after), 2, "total assigned is conserved");
});

test("assignWorkers source transfer: net-zero succeeds with a fully assigned pool", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 200 }),
    buildings: [
      { ...building("market", 0, 0), w: 2, h: 1, workers: 2 },
      building("market", 3, 0, { workers: 0 }),
    ],
  });
  const r = assignWorkers(state, {
    settlementId: "s0",
    gx: 3,
    gy: 0,
    workers: 1,
    source: { gx: 0, gy: 0 },
  });
  assert.equal(r.ok, true, "a conserved transfer needs no free pool");
  assert.deepEqual(r.state.settlements.s0.buildings.map((b) => b.workers), [1, 1]);
});

test("assignWorkers source transfer: refusals are atomic and named", () => {
  const buildings = (): BuildingDef[] => [
    { ...building("market", 0, 0), w: 2, h: 1, workers: 0 },
    building("market", 3, 0, { workers: 0 }),
  ];
  const emptySource = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 300 }),
    buildings: buildings(),
  });
  const noStaff = assignWorkers(emptySource, {
    settlementId: "s0",
    gx: 3,
    gy: 0,
    workers: 1,
    source: { gx: 0, gy: 0 },
  });
  assert.equal(noStaff.ok, false);
  assert.equal(noStaff.reason, "invalid_workers");
  assert.equal(noStaff.state, emptySource, "a refused transfer returns the original state");
  assert.deepEqual(emptySource.settlements.s0.buildings.map((b) => b.workers), [0, 0]);

  const sameBuilding = assignWorkers(emptySource, {
    settlementId: "s0",
    gx: 0,
    gy: 0,
    workers: 0,
    source: { gx: 0, gy: 0 },
  });
  assert.equal(sameBuilding.ok, false);
  assert.equal(sameBuilding.reason, "invalid_source", "source == destination is refused");
});

test("assignWorkers source transfer: a legacy source gives one from its own cap and the destination lands at 1", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 300 }),
    buildings: [
      { ...building("market", 0, 0), w: 2, h: 1 },
      building("market", 3, 0),
    ],
  });
  const r = assignWorkers(state, {
    settlementId: "s0",
    gx: 3,
    gy: 0,
    workers: 1,
    source: { gx: 0, gy: 0 },
  });
  assert.equal(r.ok, true, "legacy pickup: source (max 3) gives one, target lands at 1");
  const after = r.state.settlements.s0;
  assert.deepEqual(after.buildings.map((b) => b.workers), [2, 1]);
  assert.equal(assignedWorkersExplicit(after), 3);
});

test("assignWorkers source transfer: the untouched remainder is NOT auto-crewed by the transfer", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 500 }),
    buildings: [
      { ...building("market", 0, 0), w: 2, h: 1 },
      building("market", 3, 0),
      building("farmField", 5, 0),
    ],
  });
  const r = assignWorkers(state, {
    settlementId: "s0",
    gx: 3,
    gy: 0,
    workers: 1,
    source: { gx: 0, gy: 0 },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.state.settlements.s0.buildings.map((b) => b.workers),
    [2, 1, undefined],
    "source keeps max-1 (2), dest 1, and the untouched farm stays legacy (full effort) -- no pool is spent on it",
  );
  assert.equal(assignedWorkersExplicit(r.state.settlements.s0), 3);
  assert.equal(hasLegacyStaffing(r.state.settlements.s0), true);
  assert.equal(effortFraction(r.state.settlements.s0.buildings[2]), 1, "the untouched farm still works at full effort");
});

test("assignWorkers source transfer: full destination is refused", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 300 }),
    buildings: [
      { ...building("market", 0, 0), w: 2, h: 1, workers: 2 },
      building("farmhouse", 3, 0, { workers: 2 }),
    ],
  });
  const r = assignWorkers(state, {
    settlementId: "s0",
    gx: 3,
    gy: 0,
    workers: 3,
    source: { gx: 0, gy: 0 },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid_workers", "farmhouse max is 2; 2+1 does not fit");
  assert.equal(r.state, state, "refusal is atomic");
});

test("canAssignWorkers: increments are pool-gated, decreases allowed, range enforced", () => {
  assert.equal(canAssignWorkers(0, 2, 1, 1, 0), true, "0→1 fits a pool of 1");
  assert.equal(canAssignWorkers(0, 2, 1, 0, 0), false, "explicit 0→1 with the pool exhausted is refused");
  assert.equal(canAssignWorkers(2, 2, -1, 0, 2), true, "decrements are always allowed, no pool cost");
  assert.equal(canAssignWorkers(0, 2, -1, 0, 0), false, "cannot go below 0");
  assert.equal(canAssignWorkers(1, 2, 2, 5, 0), false, "past max is refused");
});

test("canAssignWorkers: undefined current behaves as max; pool cost is the whole delta", () => {
  assert.equal(canAssignWorkers(undefined, 2, 1, 10, 0), false, "auto buildings sit at max already");
  assert.equal(canAssignWorkers(undefined, 2, -1, 0, 0), true, "dropping an auto building below max is allowed, cost 0");
  assert.equal(canAssignWorkers(0, 3, 2, 1, 0), false, "a +2 delta costs 2, not 1");
  assert.equal(canAssignWorkers(0, 3, 2, 2, 0), true, "a +2 delta fits a pool of 2");
  assert.equal(canAssignWorkers(1, 4, 2, 3, 2), false, "assigned 2 + delta 2 exceeds pool 3");
});

// --- C-MAJOR-2: the first assignment must not collapse the settlement's output -

/**
 * The playthrough's Silver crest: a level-1 city of 13 buildings -- town hall,
 * 3 woodcutter huts, 3 stone mines, 3 farm fields, 2 houses and a farmhouse --
 * at population 500, i.e. a worker pool of 5. It starts legacy (every building
 * auto-staffed at full effort), which is how every game begins.
 */
const C_MAJOR_2_SEED = 515690;
const C_MAJOR_2_HUT_INDEX = 6;

function cMajor2City(): SettlementState {
  return makeSettlement("s0", 0, 10, 10, {
    level: 1,
    population: 500,
    resourceRates: { wood: 10, stone: 2, food: 1 },
    warehouse: emptyWarehouse({ wood: 40, stone: 40, food: 400 }),
    buildings: [
      building("townHall", 2, 2),
      building("farmField", 0, 0),
      building("farmField", 0, 3),
      building("farmField", 3, 0),
      building("house", 0, 2),
      building("house", 1, 2),
      building("woodcutterHut", 4, 2),
      building("stoneMine", 4, 3),
      building("woodcutterHut", 4, 1),
      building("farmhouse", 1, 0),
      building("woodcutterHut", 4, 0),
      building("stoneMine", 4, 4),
      building("stoneMine", 3, 4),
    ],
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The settlement panel's own per-day numbers for the three resources the
 * finding names, read through `panelRates.settlementDailyRates` -- the same
 * arithmetic the panel renders. */
function dailyNets(s: SettlementState): { wood: number; stone: number; food: number } {
  const rows = settlementDailyRates(s, C_MAJOR_2_SEED).rows;
  const net = (r: string): number => rows.find((row) => row.resource === r)?.net ?? 0;
  return { wood: net("wood"), stone: net("stone"), food: net("food") };
}

test("C-MAJOR-2: the first assignment leaves the settlement legacy and does not drive wood/stone/food negative", () => {
  const state = stateWithSettlement(cMajor2City());
  const before = state.settlements.s0;
  assert.equal(workforcePool(before), 5);
  assert.equal(hasLegacyStaffing(before), true, "the city starts legacy");

  // Before: a legacy city running at full effort.
  assert.deepEqual(
    dailyNets(before),
    { wood: 4.3, stone: 9.36, food: 13.03 },
    "pinned before-rates: tile rates + 3 huts / 3 mines / 3 fields at full effort, minus upkeep and food",
  );

  // The report's exact click: +1 on the first woodcutter's hut.
  const r = assignWorkers(state, { settlementId: "s0", gx: 4, gy: 2, workers: 1 });
  assert.equal(r.ok, true);
  const after = r.state.settlements.s0;

  // 1. It must not flip the settlement to explicit crews.
  assert.equal(hasLegacyStaffing(after), true, "the settlement did NOT convert to explicit crews");
  assert.equal(
    after.buildings.filter((b) => b.workers !== undefined).length,
    1,
    "exactly one building was written; 12 keep their legacy auto-staffing",
  );
  assert.equal(after.buildings[C_MAJOR_2_HUT_INDEX].workers, 1, "the addressed hut took the count");
  for (const [i, b] of after.buildings.entries()) {
    if (i === C_MAJOR_2_HUT_INDEX) continue;
    assert.equal(b.workers, undefined, `${b.kind} at (${b.gx},${b.gy}) is untouched`);
    assert.equal(effortFraction(b), 1, `${b.kind} at (${b.gx},${b.gy}) keeps full effort`);
  }

  // 2. It must not drive any of the three rates negative. Pre-fix, on this
  // identical fixture, the same click left wood -3.05 / stone 1.3 / food -0.94
  // and eight buildings (five of them producers) at 0 workers.
  const afterNets = dailyNets(after);
  assert.deepEqual(afterNets, { wood: 2.7, stone: 9.36, food: 13.03 }, "pinned after-rates");
  assert.ok(afterNets.wood > 0, "wood stays positive");
  assert.ok(afterNets.stone > 0, "stone stays positive");
  assert.ok(afterNets.food > 0, "food stays positive");

  // 3. And the whole cost of the click is the clicked building's own effort
  // step: 8 producers are no longer zeroed behind the player's back.
  const hutBefore = producerTurnOutput(before.buildings[C_MAJOR_2_HUT_INDEX], before, C_MAJOR_2_SEED);
  const hutAfter = producerTurnOutput(after.buildings[C_MAJOR_2_HUT_INDEX], after, C_MAJOR_2_SEED);
  assert.ok(hutBefore && hutAfter);
  assert.equal(hutBefore.effort, 1, "legacy effort is 1");
  assert.equal(hutAfter.effort, 1 / 3, "1 of its 3 worker slots");
  assert.equal(
    round2(4.3 - afterNets.wood),
    round2(hutBefore.amount - hutAfter.amount),
    "wood loses exactly the clicked hut's own step and nothing else",
  );
  assert.equal(afterNets.stone, 9.36, "the stone mines were never touched");
  assert.equal(afterNets.food, 13.03, "the farm fields were never touched");
});

test("advanceSettlementUpgrades: 1/day by default, accel adds more, staffed townHall doubles", () => {
  const withUpgrade = (buildings: BuildingDef[], days = 10): GameState =>
    makeState({
      settlements: [
        {
          ...makeSettlement("s0", 0, 2, 2, { buildings }),
          upgrade: { kind: "settlement", targetLevel: 2, daysRemaining: days },
        },
      ],
    });
  assert.equal(advanceSettlementUpgrades(withUpgrade([])).settlements.s0.upgrade?.daysRemaining, 9);
  assert.equal(
    advanceSettlementUpgrades(withUpgrade([]), { accel: () => 1 }).settlements.s0.upgrade?.daysRemaining,
    8,
    "accel 1 ticks 2/day",
  );
  const staffed = advanceSettlementUpgrades(withUpgrade([building("townHall", 0, 0, { workers: 3 })]), {
    accel: upgradeAccelEffort,
  });
  assert.equal(staffed.settlements.s0.upgrade?.daysRemaining, 8, "a fully staffed townHall adds 1 day of accel");
  const legacy = advanceSettlementUpgrades(withUpgrade([building("townHall", 0, 0)]), { accel: upgradeAccelEffort });
  assert.equal(legacy.settlements.s0.upgrade?.daysRemaining, 9, "legacy unstaffed townHall adds no accel");
});
