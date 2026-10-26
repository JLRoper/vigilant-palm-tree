import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, BuildingKind, SettlementState } from "@heroes/contracts";
import {
  applyPopulationGrowth,
  buildingSettlementEffects,
  districtPopulationBonus,
  getBuildingEffect,
  POP_BY_LEVEL,
} from "@heroes/engine";
import { emptyWarehouse, makeSettlement } from "../charter/_helpers";

/**
 * The House grants an EXACT population grant per level (300 / 1000 / 1500),
 * pinned by `settlementEffects.populationByLevel` in the registry. It used to
 * declare `populationBonus: 50`, which `buildingSettlementEffects` multiplied
 * by level and so read 50 / 100 / 150.
 *
 * NOTE: this is the HOUSE building kind, not the settlement population cap.
 * `POP_BY_LEVEL` (500 / 1500 / 5000) is a different constant and is asserted
 * unchanged at the bottom of this file.
 */

function house(kind: BuildingKind, gx: number, gy: number, level: number): BuildingDef {
  return { gx, gy, kind, level, style: "classic" };
}

function settlementWithDistrictHousing(houseLevel: number, s: Partial<SettlementState> = {}): SettlementState {
  return {
    ...makeSettlement("s0", 0, 2, 2, {
      level: 1,
      population: 500, // exactly POP_BY_LEVEL[1]
      warehouse: emptyWarehouse({ food: 5000 }),
      ...s,
    }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [house("house", 0, 0, houseLevel)],
      },
    },
  };
}

test("buildingSettlementEffects: the House reads exactly 300 / 1000 / 1500 populationBonus", () => {
  assert.equal(buildingSettlementEffects("house", 1).populationBonus, 300);
  assert.equal(buildingSettlementEffects("house", 2).populationBonus, 1000);
  assert.equal(buildingSettlementEffects("house", 3).populationBonus, 1500);
});

test("the House's registry entry carries the per-level table, not a flat populationBonus", () => {
  const se = getBuildingEffect("house").settlementEffects;
  assert.deepEqual(se.populationByLevel, { 1: 300, 2: 1000, 3: 1500 });
  assert.equal(se.populationBonus, undefined, "the flat field no longer drives the House");
});

test("kinds without a populationByLevel table keep the populationBonus x level convention", () => {
  // Regression pin: only the House switched to an explicit table.
  assert.equal(buildingSettlementEffects("apartment", 1).populationBonus, 100);
  assert.equal(buildingSettlementEffects("apartment", 2).populationBonus, 200);
  assert.equal(buildingSettlementEffects("apartment", 3).populationBonus, 300);
  assert.equal(buildingSettlementEffects("farmhouse", 2).populationBonus, 40);
  assert.equal(buildingSettlementEffects("tower", 3).populationBonus, 0);
});

test("districtPopulationBonus flows the House's exact grant through populationGrowth", () => {
  for (const [level, grant] of [
    [1, 300],
    [2, 1000],
    [3, 1500],
  ] as const) {
    const s = settlementWithDistrictHousing(level);
    assert.equal(districtPopulationBonus(s), grant, `house L${level} contributes ${grant}`);
  }
});

test("applyPopulationGrowth raises the level cap by the House grant and grows toward it", () => {
  // Level-1 settlement at the base cap (500) with a district house L1 (+300):
  // levelMax = 500 + 300 = 800; growth = ceil((500 + 300) * 0.1) = 80 -> 580.
  const s1 = settlementWithDistrictHousing(1);
  const grown1 = applyPopulationGrowth({ s0: s1 }, 0.1).s0;
  assert.equal(grown1.population, 580);

  // House L2 (+1000): levelMax = 1500; growth = ceil((500 + 1000) * 0.1) = 150 -> 650.
  const s2 = settlementWithDistrictHousing(2);
  assert.equal(applyPopulationGrowth({ s0: s2 }, 0.1).s0.population, 650);

  // House L3 (+1500): levelMax = 2000; growth = ceil((500 + 1500) * 0.1) = 200 -> 700.
  const s3 = settlementWithDistrictHousing(3);
  assert.equal(applyPopulationGrowth({ s0: s3 }, 0.1).s0.population, 700);
});

test("applyPopulationGrowth clamps a house-fed settlement at POP_BY_LEVEL + the house grant", () => {
  // 500 base + 1000 (house L2) = 1500 cap; 1490 + ceil(2490 * 0.1) = 1739 clamps to 1500.
  const nearCap = settlementWithDistrictHousing(2, { population: 1490 });
  assert.equal(applyPopulationGrowth({ s0: nearCap }, 0.1).s0.population, 1500);
});

test("POP_BY_LEVEL is untouched: the settlement cap stays 500 / 1500 / 5000", () => {
  assert.deepEqual(POP_BY_LEVEL, { 1: 500, 2: 1500, 3: 5000 });
});
