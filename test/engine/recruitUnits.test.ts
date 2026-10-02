import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleRecruitSources, recruitUnits, settlementStacks, type UnitType } from "@heroes/engine";
import type { BuildingDef, FactionId, GameState, Platoon, SettlementState } from "@heroes/contracts";
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

// ── Faction gate seam (faction-registry foundation, D5) ──

function catalogUnit(id: string, factionId: FactionId): UnitType {
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
    factionId,
  };
}

function sourcesOf(state: GameState, opts?: Parameters<typeof eligibleRecruitSources>[1]) {
  return eligibleRecruitSources(state.settlements.s0, opts)
    .map((s) => s.entry.unitTypeId)
    .sort();
}

test("eligibleRecruitSources without opts lists today's roster (the dormant gate)", () => {
  const state = recruitState({}, [building("barracks", BARRACKS.gx, BARRACKS.gy, 3), building("archeryRange", 4, 4, 2)]);
  assert.deepEqual(sourcesOf(state), ["archer", "crossbowman", "crusader", "pikeman", "swordsman"]);
});

test("eligibleRecruitSources with a human gate lists the same roster (byte-identical today)", () => {
  const state = recruitState({}, [building("barracks", BARRACKS.gx, BARRACKS.gy, 3), building("archeryRange", 4, 4, 2)]);
  const catalog = {
    swordsman: catalogUnit("swordsman", "human"),
    pikeman: catalogUnit("pikeman", "human"),
    crusader: catalogUnit("crusader", "human"),
    archer: catalogUnit("archer", "human"),
    crossbowman: catalogUnit("crossbowman", "human"),
  };
  assert.deepEqual(sourcesOf(state, { unitTypes: catalog, seatFactionId: "human" }), [
    "archer",
    "crossbowman",
    "crusader",
    "pikeman",
    "swordsman",
  ]);
});

test("eligibleRecruitSources filters entries outside the seat's faction", () => {
  const state = recruitState({}, [building("barracks", BARRACKS.gx, BARRACKS.gy, 3), building("archeryRange", 4, 4, 2)]);
  const catalog = {
    swordsman: catalogUnit("swordsman", "ashen"),
    pikeman: catalogUnit("pikeman", "human"),
    crusader: catalogUnit("crusader", "human"),
    archer: catalogUnit("archer", "neutral"),
    crossbowman: catalogUnit("crossbowman", "human"),
  };
  assert.deepEqual(sourcesOf(state, { unitTypes: catalog, seatFactionId: "human" }), [
    "crossbowman",
    "crusader",
    "pikeman",
  ], "ashen swordsman and neutral archer are gated out for a human seat");
  assert.deepEqual(sourcesOf(state, { unitTypes: catalog, seatFactionId: "ashen" }), [
    "swordsman",
  ], "an ashen seat sees only the ashen-tagged entry");
  assert.deepEqual(
    sourcesOf(state, { unitTypes: catalog, seatFactionId: "neutral" }),
    ["archer"],
    "the symmetric rule: a neutral-tagged entry matches only a neutral seat",
  );
});

test("eligibleRecruitSources with unknown catalog ids keeps the human default per entry", () => {
  const state = recruitState({}, [building("barracks", BARRACKS.gx, BARRACKS.gy, 3)]);
  assert.deepEqual(
    sourcesOf(state, { unitTypes: {}, seatFactionId: "human" }),
    ["crusader", "pikeman", "swordsman"],
    "catalog misses default human, so a human seat keeps the full roster",
  );
  assert.deepEqual(
    sourcesOf(state, { unitTypes: {}, seatFactionId: "ashen" }),
    [],
    "an ashen seat gets nothing from the default-human fallback",
  );
});

// ── Ironmark Holds roster gating (025_ironmark_holds) ──

const IRONMARK_CATALOG: Record<string, UnitType> = {
  dwarf_axeman: catalogUnit("dwarf_axeman", "ironmark"),
  shield_bearer: catalogUnit("shield_bearer", "ironmark"),
  hand_gunner: catalogUnit("hand_gunner", "ironmark"),
  ironsworn: catalogUnit("ironsworn", "ironmark"),
  iron_golem: catalogUnit("iron_golem", "ironmark"),
  runesmith: catalogUnit("runesmith", "ironmark"),
  forge_lord: catalogUnit("forge_lord", "ironmark"),
};

function ironmarkHoldState(): GameState {
  return recruitState(
    {},
    [
      building("forgeHall", 1, 1, 2),
      building("gunnersRedoubt", 2, 2),
      building("golemFoundry", 3, 3, 2),
      building("deepAnvil", 4, 4, 2),
    ],
  );
}

test("an ironmark seat recruits the Holds' roster from the four new buildings", () => {
  assert.deepEqual(
    sourcesOf(ironmarkHoldState(), { unitTypes: IRONMARK_CATALOG, seatFactionId: "ironmark" }),
    ["dwarf_axeman", "forge_lord", "hand_gunner", "iron_golem", "ironsworn", "runesmith", "shield_bearer"],
  );
});

test("a human seat cannot recruit dwarf_axeman; an ironmark seat can", () => {
  const state = recruitState({}, [building("forgeHall", 1, 1)]);
  assert.deepEqual(
    sourcesOf(state, { unitTypes: IRONMARK_CATALOG, seatFactionId: "human" }),
    [],
    "the forgeHall recruits are ironmark-tagged, so a human seat sees none of them",
  );
  assert.deepEqual(
    sourcesOf(state, { unitTypes: IRONMARK_CATALOG, seatFactionId: "ironmark" }),
    ["dwarf_axeman"],
  );
});

test("iron_golem (monster-advantage, faction-rostered) is recruitable only by ironmark", () => {
  const state = recruitState({}, [building("golemFoundry", 3, 3, 2)]);
  assert.deepEqual(
    sourcesOf(state, { unitTypes: IRONMARK_CATALOG, seatFactionId: "ironmark" }),
    ["iron_golem", "ironsworn"],
  );
  for (const seat of ["human", "ashen", "verdant", "neutral"] as const) {
    assert.deepEqual(
      sourcesOf(state, { unitTypes: IRONMARK_CATALOG, seatFactionId: seat }),
      [],
      `a ${seat} seat must not recruit the ironmark-tagged iron_golem`,
    );
  }
});
