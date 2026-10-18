import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceSettlementUpgrades,
  assignedWorkersExplicit,
  assignWorkers,
  canAssignWorkers,
  effortFraction,
  upgradeAccelEffort,
  workforcePool,
} from "@heroes/engine";
import type { BuildingDef, GameState, SettlementState } from "@heroes/contracts";
import { makeSettlement, makeState } from "../charter/_helpers";

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

test("assignWorkers: first assign normalizes every legacy building in the settlement", () => {
  const state = stateWithSettlement({
    ...makeSettlement("s0", 0, 2, 2, { population: 200 }),
    buildings: [building("farmField", 0, 0), building("farmField", 1, 0), building("house", 2, 0)],
  });
  const r = assignWorkers(state, { settlementId: "s0", gx: 0, gy: 0, workers: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.state.settlements.s0.buildings.map((b) => b.workers),
    [2, 0, 0],
    "the target gets the assignment; every other legacy building is pinned to explicit 0",
  );
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

test("assignWorkers: a district first assign normalizes main and every district", () => {
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
  assert.equal(after.buildings[0].workers, 0, "main buildings normalize");
  assert.equal(after.districts?.["3,2"].buildings[0].workers, 1, "the district target gets the assignment");
  assert.equal(after.districts?.["3,2"].buildings[1].workers, 0, "sibling district buildings normalize");
  assert.equal(after.districts?.["4,2"].buildings[0].workers, 0, "other districts normalize too");
  assert.equal(assignedWorkersExplicit(after), 1);
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