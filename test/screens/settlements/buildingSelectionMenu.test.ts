// Regression coverage for the stale-construction city-view menus: clicking a
// building resolved it from the placement cart, which froze
// `construction: { daysRemaining }` at placement time, so a building whose
// construction had completed on a server day tick still showed
// "Under construction — N days remaining" (and hid the recruit rows). The
// view now resolves via syncedBuildings(); the selection menu additionally
// must not offer the upgrade action while any selected entry is still
// constructing — upgradeBuilding in @heroes/engine has no construction guard,
// so this menu check is the only gate the player sees.
//
// jsdom is intentionally not added; the row-suppression decision is exported
// as a pure helper and asserted directly (see menuAnchor.test.ts for the
// established node:test pattern). The click path itself is DOM+canvas and has
// no headless seam.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef } from "../../../src/render/cityBuildingDraw";
import {
  hasConstructingEntry,
  type SelectedBuildingEntry,
} from "../../../src/screens/settlements/cityView/buildingSelectionMenu";

function entry(key: string, construction?: { daysRemaining: number }): SelectedBuildingEntry {
  const building: BuildingDef = { gx: 1, gy: 1, kind: "barracks", level: 1, style: "classic" };
  if (construction) building.construction = construction;
  return { key, building };
}

test("a selection of completed buildings keeps the upgrade row", () => {
  assert.equal(hasConstructingEntry([entry("1,1,barracks"), entry("2,2,barracks")]), false);
});

test("a selection containing a constructing building suppresses the upgrade row", () => {
  assert.equal(hasConstructingEntry([entry("1,1,barracks", { daysRemaining: 3 })]), true);
});

test("a mixed selection suppresses the upgrade row too", () => {
  assert.equal(
    hasConstructingEntry([entry("1,1,barracks"), entry("2,2,house", { daysRemaining: 1 })]),
    true,
  );
});
