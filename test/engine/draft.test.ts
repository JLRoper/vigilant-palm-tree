import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDraftRecharge, recruitUnits, settlementStacks } from "@heroes/engine";
import type { UnitType } from "@heroes/engine";
import type { BuildingDef, SettlementState } from "@heroes/contracts";
import { makeSettlement, makeState } from "../charter/_helpers";

function building(kind: BuildingDef["kind"], gx: number, gy: number, overrides: Partial<BuildingDef> = {}): BuildingDef {
  return { gx, gy, kind, level: 1, style: "classic", ...overrides };
}

function settle(buildings: BuildingDef[], districts?: SettlementState["districts"]): SettlementState {
  return { ...makeSettlement("s0", 0, 2, 2, { buildings }), ...(districts ? { districts } : {}) };
}

function tierUnit(id: string, tier: NonNullable<UnitType["tier"]>): UnitType {
  return {
    id,
    name: id,
    attack: 1,
    defence: 1,
    health: 1,
    speed: 1,
    description: "",
    advantageType: "infantry",
    specialty: "",
    specialtyPriority: 0,
    tier,
  };
}

const TIERED_CATALOG: Record<string, UnitType> = {
  peasant: tierUnit("peasant", 1),
  swordsman: tierUnit("swordsman", 2),
  mage: tierUnit("mage", 6),
};

test("applyDraftRecharge skips legacy buildings that carry no draft record", () => {
  const settlements: Record<string, SettlementState> = { s0: settle([building("barracks", 2, 3)]) };
  const out = applyDraftRecharge(settlements);
  assert.equal(out, settlements, "no recharge bookkeeping for legacy buildings");
  assert.equal("draft" in out.s0.buildings[0], false);
});

test("applyDraftRecharge skips buildings under construction", () => {
  const settlements: Record<string, SettlementState> = {
    s0: settle([building("barracks", 2, 3, { construction: { daysRemaining: 2 }, draft: { swordsman: 1 } })]),
  };
  const out = applyDraftRecharge(settlements);
  assert.equal(out, settlements);
  assert.equal(out.s0.buildings[0].draft?.swordsman, 1);
});

test("applyDraftRecharge recharges at draftPerDay × (1 + effort)", () => {
  const unstaffed = applyDraftRecharge({
    s0: settle([building("barracks", 2, 3, { workers: 0, draft: { swordsman: 0 } })]),
  });
  assert.equal(unstaffed.s0.buildings[0].draft?.swordsman, 0.25, "workers 0 → 1× the 0.25/day base");
  const full = applyDraftRecharge({
    s0: settle([building("barracks", 2, 3, { workers: 4, draft: { swordsman: 0 } })]),
  });
  assert.equal(full.s0.buildings[0].draft?.swordsman, 0.5, "full staff → 2× the base");
});

test("applyDraftRecharge caps each entry at the kind's draftMax", () => {
  const out = applyDraftRecharge({
    s0: settle([building("barracks", 2, 3, { workers: 4, draft: { swordsman: 2.75 } })]),
  });
  assert.equal(out.s0.buildings[0].draft?.swordsman, 3);
  const full = applyDraftRecharge({
    s0: settle([building("barracks", 2, 3, { workers: 4, draft: { swordsman: 3 } })]),
  });
  assert.equal(full.s0.buildings[0].draft?.swordsman, 3, "a full entry stays full");
});

test("applyDraftRecharge includes district buildings", () => {
  const districts: SettlementState["districts"] = {
    "3,2": {
      q: 3,
      r: 2,
      citySpots: [],
      buildings: [building("barracks", 1, 2, { workers: 0, draft: { swordsman: 0 } })],
    },
  };
  const out = applyDraftRecharge({ s0: settle([], districts) });
  assert.equal(out.s0.districts?.["3,2"].buildings[0].draft?.swordsman, 0.25);
});

test("applyDraftRecharge is deterministic", () => {
  const input = (): Record<string, SettlementState> => ({
    s0: settle([building("barracks", 2, 3, { workers: 4, draft: { swordsman: 1.2 } })]),
  });
  const a = applyDraftRecharge(input());
  const b = applyDraftRecharge(input());
  assert.deepEqual(a, b);
});

test("applyDraftRecharge scales the daily rate by the unit's tier", () => {
  const out = applyDraftRecharge(
    {
      s0: settle([
        building("barracks", 2, 3, { workers: 0, draft: { swordsman: 0 } }),
        building("farmhouse", 4, 3, { workers: 0, draft: { peasant: 0 } }),
        building("mageGuild", 6, 3, { workers: 0, draft: { mage: 0 } }),
      ]),
    },
    TIERED_CATALOG,
  );
  assert.equal(out.s0.buildings[0].draft?.swordsman, 0.2, "tier 2 → 0.25 × 0.8");
  assert.equal(out.s0.buildings[1].draft?.peasant, 0.25, "tier 1 keeps the 0.25 base");
  assert.equal(out.s0.buildings[2].draft?.mage, 0.075, "tier 6 → 0.25 × 0.3");
});

test("applyDraftRecharge keeps the effort multiplier on top of the tier multiplier", () => {
  const out = applyDraftRecharge(
    { s0: settle([building("barracks", 2, 3, { workers: 4, draft: { swordsman: 0 } })]) },
    TIERED_CATALOG,
  );
  assert.equal(out.s0.buildings[0].draft?.swordsman, 0.4, "full staff tier 2 → 0.2 × 2");
});

test("applyDraftRecharge still caps tier-scaled entries at draftMax", () => {
  const out = applyDraftRecharge(
    { s0: settle([building("barracks", 2, 3, { workers: 4, draft: { swordsman: 2.75 } })]) },
    TIERED_CATALOG,
  );
  assert.equal(out.s0.buildings[0].draft?.swordsman, 3, "2.75 + 0.4 is clamped to 3");
});

test("applyDraftRecharge falls back to the base rate for units missing from the catalog", () => {
  const input = (): Record<string, SettlementState> => ({
    s0: settle([building("barracks", 2, 3, { workers: 0, draft: { swordsman: 0 } })]),
  });
  const empty = applyDraftRecharge(input(), {});
  assert.equal(empty.s0.buildings[0].draft?.swordsman, 0.25, "empty catalog → multiplier 1");
  const partial = applyDraftRecharge(input(), { mage: tierUnit("mage", 6) });
  assert.equal(partial.s0.buildings[0].draft?.swordsman, 0.25, "missing entry → multiplier 1");
});

test("applyDraftRecharge drains a tier-7 pool at 0.05/day", () => {
  const out = applyDraftRecharge(
    { s0: settle([building("barracks", 2, 3, { workers: 0, draft: { swordsman: 0 } })]) },
    { swordsman: tierUnit("swordsman", 7) },
  );
  assert.equal(out.s0.buildings[0].draft?.swordsman, 0.05, "tier 7 → 0.25 × 0.2");
});

test("applyDraftRecharge applies tier multipliers to district buildings", () => {
  const districts: SettlementState["districts"] = {
    "3,2": {
      q: 3,
      r: 2,
      citySpots: [],
      buildings: [building("barracks", 1, 2, { workers: 0, draft: { swordsman: 0 } })],
    },
  };
  const out = applyDraftRecharge({ s0: settle([], districts) }, TIERED_CATALOG);
  assert.equal(out.s0.districts?.["3,2"].buildings[0].draft?.swordsman, 0.2);
});

test("tier-scaled applyDraftRecharge is deterministic", () => {
  const input = (): Record<string, SettlementState> => ({
    s0: settle([
      building("barracks", 2, 3, { workers: 4, draft: { swordsman: 1.1 } }),
      building("mageGuild", 6, 3, { workers: 0, draft: { mage: 0.4 } }),
    ]),
  });
  const a = applyDraftRecharge(input(), TIERED_CATALOG);
  const b = applyDraftRecharge(input(), TIERED_CATALOG);
  assert.deepEqual(a, b);
});

test("recruitUnits consumes the building draft pool and still charges the full cost", () => {
  const state = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 5, 5, { gold: 1000, buildings: [building("barracks", 2, 3)] }) },
    ],
  });
  const r = recruitUnits(state, {
    settlementId: "s0",
    buildingKind: "barracks",
    gx: 2,
    gy: 3,
    unitTypeId: "swordsman",
    count: 2,
  });
  assert.equal(r.ok, true);
  assert.equal(r.state.settlements.s0.gold, 600, "2 swordsmen still cost 400g");
  assert.equal(r.state.settlements.s0.buildings[0].draft?.swordsman, 1, "draftMax 3 − 2 recruits");
  assert.deepEqual(settlementStacks(r.state.settlements.s0)[0].entries, [{ unitTypeId: "swordsman", count: 2 }]);
});

test("recruitUnits refuses counts past floor(pool) with draft_pool_empty + available", () => {
  const state = makeState({
    settlements: [
      {
        ...makeSettlement("s0", 0, 5, 5, {
          gold: 1000,
          buildings: [building("barracks", 2, 3, { draft: { swordsman: 2 } })],
        }),
      },
    ],
  });
  const r = recruitUnits(state, {
    settlementId: "s0",
    buildingKind: "barracks",
    gx: 2,
    gy: 3,
    unitTypeId: "swordsman",
    count: 3,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "draft_pool_empty");
  assert.equal(r.available, 2);
  assert.equal(r.state, state, "a refused recruit touches nothing");
  assert.equal(r.state.settlements.s0.gold, 1000);
});

test("legacy undefined draft initializes on first recruit and limits the second", () => {
  const state = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 5, 5, { gold: 1000, buildings: [building("farmhouse", 0, 0)] }) },
    ],
  });
  const first = recruitUnits(state, {
    settlementId: "s0",
    buildingKind: "farmhouse",
    gx: 0,
    gy: 0,
    unitTypeId: "peasant",
    count: 1,
  });
  assert.equal(first.ok, true);
  assert.equal(first.state.settlements.s0.buildings[0].draft?.peasant, 2, "draftMax 3 − 1 written explicitly");
  const second = recruitUnits(first.state, {
    settlementId: "s0",
    buildingKind: "farmhouse",
    gx: 0,
    gy: 0,
    unitTypeId: "peasant",
    count: 3,
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "draft_pool_empty");
  assert.equal(second.available, 2, "the reduced pool is reported");
  const within = recruitUnits(first.state, {
    settlementId: "s0",
    buildingKind: "farmhouse",
    gx: 0,
    gy: 0,
    unitTypeId: "peasant",
    count: 2,
  });
  assert.equal(within.ok, true, "the remaining pool is still recruit-ready");
  assert.equal(within.state.settlements.s0.buildings[0].draft?.peasant, 0);
});