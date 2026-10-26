import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildingFootprintFromRegistry,
  startBuildingUpgrade,
} from "@heroes/engine";
import type { BuildingDef, GameState, SettlementState } from "@heroes/contracts";
import { emptyWarehouse, makeSettlement, makeState } from "../charter/_helpers";

/**
 * C-MAJOR-3: the L2/L3 footprint override in `buildingFootprintFromRegistry`
 * grows `woodcutterHut` / `granary` / `bank` / `goldMine` from 1x1 to 1.5x1.5 --
 * a 2x2 block of cells once `coversCell` / the placement path round it up. The
 * upgrade path never checked the cells that growth newly claims, so an upgrade
 * beside a neighbour was accepted, the bigger building swallowed the
 * neighbour's cell, and clicking the neighbour opened the upgrader's own menu
 * (the playthrough's `(2,4)` hut eating the `(3,4)` stone mine).
 */

function building(
  kind: BuildingDef["kind"],
  gx: number,
  gy: number,
  overrides: Partial<BuildingDef> = {},
): BuildingDef {
  return { gx, gy, kind, level: 1, style: "classic", ...overrides };
}

function stateWith(buildings: BuildingDef[], overrides: Partial<SettlementState> = {}): GameState {
  return makeState({
    settlements: [
      makeSettlement("s0", 0, 2, 2, {
        level: 1,
        population: 500,
        gold: 5000,
        warehouse: emptyWarehouse({ gold: 0, wood: 200, stone: 200, iron: 50, arcane: 50 }),
        buildings,
        ...overrides,
      }),
    ],
  });
}

const HUT = { gx: 2, gy: 4, kind: "woodcutterHut" as const };

test("C-MAJOR-3: the L2 footprint override really does claim a 2x2 block of cells", () => {
  assert.deepEqual(buildingFootprintFromRegistry("woodcutterHut", 1), { w: 1, h: 1 }, "L1 is 1x1");
  assert.deepEqual(buildingFootprintFromRegistry("woodcutterHut", 2), { w: 1.5, h: 1.5 }, "L2/L3 use the 1.5 override");
  assert.deepEqual(buildingFootprintFromRegistry("woodcutterHut", 3), { w: 1.5, h: 1.5 });
  // The cells that override covers from (2,4): (2,4) (3,4) (2,5) (3,5) -- so an
  // upgrade swallows the whole row to its right.
  assert.equal(Math.ceil(1.5), 2, "the placement rounding / coversCell treat 1.5 as 2 cells per axis");
});

test("C-MAJOR-3: an upgrade whose extra cells hold a neighbour is refused before anything is charged", () => {
  // The playthrough's layout: the hut at (2,4) with a stone mine at (3,4).
  const state = stateWith([building("woodcutterHut", 2, 4), building("stoneMine", 3, 4)]);
  const before = state.settlements.s0;

  const r = startBuildingUpgrade(state, "s0", [HUT]);
  assert.equal(r.ok, false, "the upgrade must be refused, not silently accepted");
  assert.equal(r.reason, "footprint_blocked");
  assert.equal(r.state, state, "a refused upgrade returns the state untouched");
  const afterRefusal = r.state.settlements.s0;
  assert.equal(afterRefusal.gold, before.gold, "no gold charged");
  assert.deepEqual(afterRefusal.warehouse, before.warehouse, "no resources charged");
  assert.equal(afterRefusal.upgrade, undefined, "no upgrade started");
  assert.equal(afterRefusal.buildings[0].level, 1, "the hut stays at L1");
});

test("C-MAJOR-3: after the refusal the neighbour's cell resolves to the neighbour, not to the hut", () => {
  // The bug's arithmetic: at L2 the hut's 1.5-wide footprint covers (3,4)
  // (`3 < 2 + 1.5`), which is how its menu swallowed the mine's cell. The
  // refusal must leave the hut on its 1x1 L1 footprint, so the cell stays the
  // mine's -- the same `gx < b.gx + w` rule `coversCell` resolves clicks with.
  const state = stateWith([building("woodcutterHut", 2, 4), building("stoneMine", 3, 4)]);
  const r = startBuildingUpgrade(state, "s0", [HUT]);
  assert.equal(r.ok, false);
  const hut = r.state.settlements.s0.buildings[0];
  assert.equal(hut.level, 1);
  const gp = buildingFootprintFromRegistry(hut.kind, hut.level);
  const coversMineCell = 3 >= hut.gx && 3 < hut.gx + gp.w && 4 >= hut.gy && 4 < hut.gy + gp.h;
  assert.equal(coversMineCell, false, "the mine's cell stays the mine's");
  const wouldCoverAtL2 = 3 < hut.gx + buildingFootprintFromRegistry(hut.kind, 2).w;
  assert.equal(wouldCoverAtL2, true, "...and it is exactly the L2 footprint that would have taken it");
});

test("C-MAJOR-3: the same upgrade succeeds when the extra cells are free", () => {
  const state = stateWith([building("woodcutterHut", 2, 4)]);
  const r = startBuildingUpgrade(state, "s0", [HUT]);
  assert.equal(r.ok, true, "an upgrade with room to grow is accepted");
  assert.equal(r.state.settlements.s0.upgrade?.kind, "buildings");
  assert.equal(r.state.settlements.s0.gold, 5000 - 225, "L1->L2 hut cost is charged once");
  assert.equal(r.state.settlements.s0.warehouse.wood, 200 - 8);
});

test("C-MAJOR-3: a neighbour the bigger footprint does not touch does not block the upgrade", () => {
  // (4,4) is outside the hut's new cells (2,4) (3,4) (2,5) (3,5).
  const state = stateWith([building("woodcutterHut", 2, 4), building("stoneMine", 4, 4)]);
  const r = startBuildingUpgrade(state, "s0", [HUT]);
  assert.equal(r.ok, true, "diagonal / non-overlapping neighbours are fine");
});

test("C-MAJOR-3: a neighbour inside the same district grid blocks the upgrade too", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      level: 1,
      population: 500,
      gold: 5000,
      warehouse: emptyWarehouse({ wood: 200, stone: 200, iron: 50, arcane: 50 }),
      buildings: [building("townHall", 2, 2)],
    }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [building("woodcutterHut", 0, 0), building("granary", 1, 0)],
      },
    },
  };
  const state = makeState({ settlements: [settlement] });
  const blocked = startBuildingUpgrade(state, "s0", [{ gx: 0, gy: 0, kind: "woodcutterHut", district: { q: 3, r: 2 } }]);
  assert.equal(blocked.ok, false, "a district neighbour on the extra cell refuses the upgrade");
  assert.equal(blocked.reason, "footprint_blocked");

  // With the neighbour cleared, the same district upgrade is accepted.
  const clear: SettlementState = {
    ...settlement,
    districts: {
      "3,2": { q: 3, r: 2, citySpots: [], buildings: [building("woodcutterHut", 0, 0)] },
    },
  };
  const ok = startBuildingUpgrade(makeState({ settlements: [clear] }), "s0", [
    { gx: 0, gy: 0, kind: "woodcutterHut", district: { q: 3, r: 2 } },
  ]);
  assert.equal(ok.ok, true);
});

test("C-MAJOR-3: two requests in one command cannot claim the same cell between them", () => {
  // Two huts side by side, nothing else: each L2 footprint would claim the
  // other's starting cell, so the batch is refused as a whole.
  const state = stateWith([building("woodcutterHut", 1, 1), building("woodcutterHut", 2, 1)]);
  const r = startBuildingUpgrade(state, "s0", [
    { gx: 1, gy: 1, kind: "woodcutterHut" },
    { gx: 2, gy: 1, kind: "woodcutterHut" },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "footprint_blocked");
});

test("C-MAJOR-3: a 1x1 upgrade path (L1 -> L2 for a 2x2 kind) is unaffected", () => {
  // farmField is 2x2 at every level: its upgrade claims no new cell, so a
  // neighbour touching it must not block the upgrade.
  const state = stateWith([building("farmField", 0, 0), building("house", 2, 0)]);
  const r = startBuildingUpgrade(state, "s0", [{ gx: 0, gy: 0, kind: "farmField" }]);
  assert.equal(r.ok, true, "a footprint that does not grow cannot conflict");
});
