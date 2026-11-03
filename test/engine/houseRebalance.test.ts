import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingKind, SettlementState } from "@heroes/contracts";
import {
  buildingPlacementCost,
  buildingSettlementEffects,
  buildingUpkeep,
  buildingUpgradeCost,
  districtPopulationBonus,
  getBuildingEffect,
  settlementPopulationCap,
  SETTLEMENT_GOLD_TAX,
  POP_BY_LEVEL,
} from "@heroes/engine";
import { emptyWarehouse, makeSettlement } from "../charter/_helpers";

/**
 * CITY P6 — the House is rebalanced. Re-measured on github/main 9b4f17f (0.47.0)
 * by running this engine, the House at L3 pays 4,500 gold/turn (1,500 pop x the
 * L3 tax of 3) for a 100g + 5w placement and 3 wood/turn of upkeep: 112x the
 * gold/turn per 100g of placement cost of the strongest non-House gold building
 * (the neutral gold mine, 120/turn from a 300g placement), and 37x against a
 * mine standing on a gold spot (x3 cell multiplier).
 *
 * The rebalance is a PRICE curve, not a new mechanic and not a change to the
 * grant. The House's grant scales x5 with level while it used to cost a flat
 * 100g to place at ANY level (550g to reach L3), which no other building in the
 * registry does. The grant itself is deliberately LEFT ALONE: the late city's
 * workforce calibration (P2, `workforce.ts`) is measured against the 80,000
 * population a house-filled L3 castle's housing grants, so flattening the grant
 * halves that cap and takes the pool from 97% of demand to 48%.
 *
 * So: the placement price scales (300g, was 100g -- its full path to L3 now
 * costs 300 + 450 + 900 = 1,650g, the same as a gold mine's) and the House pays
 * for the gold in the resource that is actually scarce, wood at 2 per level
 * (2 / 4 / 6, was 1). The apartment rises to 150 per level so 2x2 housing is no
 * longer strictly worse than four single-cell houses.
 *
 * These pins are the engine's own arithmetic; the multipliers in the report are
 * derived from them.
 */

function b(kind: BuildingKind, gx: number, gy: number, level: number) {
  return { gx, gy, kind, level, style: "classic" as const };
}

function houseDistrict(houseLevel: number, level: 1 | 2 | 3 = 3): SettlementState {
  return {
    ...makeSettlement("s0", 0, 2, 2, {
      level,
      population: POP_BY_LEVEL[level],
      goldTax: SETTLEMENT_GOLD_TAX[level],
      warehouse: emptyWarehouse({ food: 100000 }),
    }),
    districts: {
      "3,2": { q: 3, r: 2, citySpots: [], buildings: [b("house", 0, 0, houseLevel)] },
    },
  };
}

/** What one district House adds to a settlement's per-turn gold: its grant x the level's tax. */
function houseGold(level: 1 | 2 | 3): number {
  return districtPopulationBonus(houseDistrict(level, level)) * SETTLEMENT_GOLD_TAX[level];
}

test("the House's grant is left at the level curve the workforce calibration reads", () => {
  // NOT flattened: the 80,000-population house-filled L3 castle that P2's
  // caveat measured against (50 district houses) is built out of this table.
  const se = getBuildingEffect("house").settlementEffects;
  assert.deepEqual(se.populationByLevel, { 1: 300, 2: 1000, 3: 1500 });
  assert.equal(buildingSettlementEffects("house", 1).populationBonus, 300);
  assert.equal(buildingSettlementEffects("house", 2).populationBonus, 1000);
  assert.equal(buildingSettlementEffects("house", 3).populationBonus, 1500);
});

test("the House's wood upkeep doubles to 2 per level -- 2 / 4 / 6 wood per turn", () => {
  assert.deepEqual(buildingUpkeep("house", 1), { wood: 2, stone: 0 });
  assert.deepEqual(buildingUpkeep("house", 2), { wood: 4, stone: 0 });
  assert.deepEqual(buildingUpkeep("house", 3), { wood: 6, stone: 0 });
});

test("the apartment's grant rises to 150 per level so 2x2 housing is no longer a trap", () => {
  assert.equal(buildingSettlementEffects("apartment", 1).populationBonus, 150);
  assert.equal(buildingSettlementEffects("apartment", 2).populationBonus, 300);
  assert.equal(buildingSettlementEffects("apartment", 3).populationBonus, 450);
});

test("the House's placement price scales its path to L3 to exactly a gold mine's 1,650g", () => {
  assert.equal(buildingPlacementCost("house").gold, 300, "was 100");
  assert.equal(buildingPlacementCost("house").wood, 5, "the wood price is unchanged");
  const l2 = buildingUpgradeCost("house", 1);
  const l3 = buildingUpgradeCost("house", 2);
  assert.equal(l2?.gold, 450);
  assert.equal(l3?.gold, 900);
  const houseTotal = 300 + (l2?.gold ?? 0) + (l3?.gold ?? 0);
  const mineTotal =
    (buildingPlacementCost("goldMine").gold ?? 0) +
    (buildingUpgradeCost("goldMine", 1)?.gold ?? 0) +
    (buildingUpgradeCost("goldMine", 2)?.gold ?? 0);
  assert.equal(houseTotal, 1650);
  assert.equal(houseTotal, mineTotal, "the House's full path now costs what a gold mine's does");
});

test("the House's gold per 100g of placement cost falls from 112x the gold mine to 37.5x", () => {
  const housePer100 = (houseGold(3) / (buildingPlacementCost("house").gold ?? 1)) * 100;
  const minePer100 =
    (buildingSettlementEffects("goldMine", 3).goldPerTurn / (buildingPlacementCost("goldMine").gold ?? 1)) * 100;
  assert.equal(housePer100, 1500, "4,500 gold/turn from a 300g placement");
  assert.equal(minePer100, 40, "120 gold/turn from a 300g placement");
  assert.equal(housePer100 / minePer100, 37.5, "was 112.5 on the flat 100g price");
  // On a gold spot the mine's x3 cell multiplier takes the ratio to 12.5x (was 37.5x).
  assert.equal(housePer100 / (minePer100 * 3), 12.5);
});

test("the late House's exchange rate halves: 1,500 gold per wood -> 750", () => {
  // Before: 4,500 gold/turn for 3 wood/turn of upkeep = 1,500 gold per wood.
  // After:  4,500 gold/turn for 6 wood/turn of upkeep =   750 gold per wood.
  assert.equal(houseGold(3) / buildingUpkeep("house", 3).wood, 750);
  assert.equal(1500 / 750, 2, "the collateral against the scarce resource doubled");
});

test("POP_BY_LEVEL and the district population cap are untouched", () => {
  assert.deepEqual(POP_BY_LEVEL, { 1: 500, 2: 1500, 3: 5000 });
  const s = houseDistrict(3, 3);
  assert.equal(districtPopulationBonus(s), 1500);
  assert.equal(settlementPopulationCap(s), 6500);
});
