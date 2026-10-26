import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import type { BuildingDef, CastleVariant, DistrictState, GameState, SettlementState } from "@heroes/contracts";
import {
  BANK_WITHDRAWAL_DAYS,
  accrueBankInterest,
  advanceBuildingConstructions,
  advanceSettlementUpgrades,
  applyBuildingUpgrade,
  applyEngineEvent,
  applyPlaceBuildings,
  applyPopulationGrowth,
  applySettlementConsumption,
  bankGoldOf,
  bankPendingOut,
  buildingUpkeepRequired,
  computePlayerBonuses,
  controlRange,
  DENSE_FOREST_BONUS_SPOT,
  depositIntoBank,
  districtKey,
  districtPopulationBonus,
  effectiveSettlementIncome,
  eligibleRecruitSources,
  generateDistrictSpots,
  getOrCreateGameMap,
  hydrateGameState,
  matureBankWithdrawals,
  pickGarrisonRecruitment,
  produceSettlementResources,
  producerTurnOutput,
  recruitUnits,
  requestBankWithdrawal,
  resolveControllingSettlement,
  settlementIncome,
  settlementProductionRates,
  settlementResourceCap,
  settlementStacks,
  settlementTreasuryCap,
  startBuildingUpgrade,
} from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import { parseCommand } from "../../server/http/routes/commands";
import { Hero } from "../../src/entities/hero";
import { Castle } from "../../src/entities/settlement";
import { GameMap, type TileRow } from "../../src/map/gameMap";
import {
  buildAdventureScene,
  settlementFullnessForCount,
} from "../../src/render/scene/sceneBuilder/adventureScene";
import { buildCityScene } from "../../src/render/scene/sceneBuilder/cityScene";
import type { CastleNode, CityBuildingNode, CityLabelNode, DistrictNode } from "../../src/render/scene/types";
import { describeTile } from "../../src/screens/adventure/tileInfo";
import {
  buildEntryStatus,
  type BuildEntryAffordability,
} from "../../src/screens/settlements/cityView/buildEntryStatus";
import { emptyWarehouse, makeHero, makePlayer, makeSettlement, makeState } from "../charter/_helpers";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";
import { makeGrassMap, makeRenderOptions } from "../render/_helpers";

function makeBuilding(
  kind: BuildingDef["kind"],
  gx: number,
  gy: number,
  level = 1,
  overrides: Partial<BuildingDef> = {},
): BuildingDef {
  return { gx, gy, kind, level, style: "pixel", ...overrides };
}

// ── 1. districtKey and resolveControllingSettlement ──────────────────────────

test("districtKey and resolveControllingSettlement: bounds, controlRange(level) ignoring Town Hall bonus, existing district preference, and tie-breaking", () => {
  assert.equal(districtKey(3, 7), "3,7");

  // Level 1 settlement with a Level 3 Town Hall: controlRange(level, buildings) is 4,
  // but territory/district control uses controlRange(level) = 1.
  const sWithTownHall: SettlementState = {
    ...makeSettlement("s0", 0, 5, 5, {
      level: 1,
      buildings: [makeBuilding("townHall", 2, 2, 3)],
    }),
  };
  assert.equal(controlRange(sWithTownHall.level, sWithTownHall.buildings), 4);
  assert.equal(controlRange(sWithTownHall.level), 1);

  // Out of bounds returns undefined
  assert.equal(resolveControllingSettlement([sWithTownHall], -1, 5, 12, 12), undefined);
  assert.equal(resolveControllingSettlement([sWithTownHall], 5, -1, 12, 12), undefined);
  assert.equal(resolveControllingSettlement([sWithTownHall], 12, 5, 12, 12), undefined);
  assert.equal(resolveControllingSettlement([sWithTownHall], 5, 12, 12, 12), undefined);

  // Hex (6, 5) at distance 1 is controlled; hex (7, 5) at distance 2 is outside controlRange(1)
  assert.equal(resolveControllingSettlement([sWithTownHall], 6, 5, 12, 12)?.id, "s0");
  assert.equal(resolveControllingSettlement([sWithTownHall], 7, 5, 12, 12), undefined);

  // Neutral settlements (ownerId === null) never control territory, and their center hex cannot be claimed by an adjacent owned settlement
  const neutral = makeSettlement("sNeutral", null, 5, 5, { level: 3 });
  assert.equal(resolveControllingSettlement([neutral], 5, 5, 12, 12), undefined);
  const ownedAdjacent = makeSettlement("sOwnedAdj", 0, 6, 5, { level: 3 });
  assert.equal(
    resolveControllingSettlement([neutral, ownedAdjacent], 5, 5, 12, 12),
    undefined,
    "adjacent owned settlement cannot claim a neutral settlement's center hex",
  );
  assert.equal(
    resolveControllingSettlement([neutral, ownedAdjacent], 6, 5, 12, 12)?.id,
    "sOwnedAdj",
    "owned settlement center hex is always controlled by that settlement",
  );

  // Prefers a settlement that already has districts["q,r"] within its range even if farther
  const sNear = makeSettlement("sNear", 0, 4, 4, { level: 1 }); // dist 1 to (5, 4)
  const sFarWithDistrict: SettlementState = {
    ...makeSettlement("sFar", 0, 7, 4, { level: 2 }), // dist 2 to (5, 4)
    districts: {
      "5,4": { q: 5, r: 4, citySpots: [], buildings: [makeBuilding("house", 0, 0)] },
    },
  };
  assert.equal(
    resolveControllingSettlement([sNear, sFarWithDistrict], 5, 4, 12, 12)?.id,
    "sFar",
    "existing district owner within range takes precedence over closer settlement",
  );

  // Without existing district, nearest by hexDistance wins
  const sFarNoDistrict = makeSettlement("sFar", 0, 7, 4, { level: 2 });
  assert.equal(
    resolveControllingSettlement({ sNear, sFarNoDistrict }, 5, 4, 12, 12)?.id,
    "sNear",
  );

  // Equal hexDistance breaks ties by ownerId first, then settlement ID (localeCompare)
  const sB = makeSettlement("sB", 0, 4, 4, { level: 2 }); // dist 1 to (5, 4)
  const sA = makeSettlement("sA", 1, 6, 4, { level: 2 }); // dist 1 to (5, 4)
  assert.equal(
    resolveControllingSettlement([sA, sB], 5, 4, 12, 12)?.id,
    "sB",
    "tie at equal hexDistance across different owners breaks by ownerId first",
  );
  const sA0 = makeSettlement("sA", 0, 6, 4, { level: 2 });
  assert.equal(
    resolveControllingSettlement([sB, sA0], 5, 4, 12, 12)?.id,
    "sA",
    "tie at equal hexDistance for same owner breaks by settlement ID",
  );
});

// ── 2. generateDistrictSpots ─────────────────────────────────────────────────

test("generateDistrictSpots: 3 deterministic spots in 0..4x0..4, (2,2) eligible, and mapResource guarantees spots[0]", () => {
  const spotsA = generateDistrictSpots(3, 4, 42, "grass");
  const spotsB = generateDistrictSpots(3, 4, 42, "grass");
  assert.equal(spotsA.length, 3);
  assert.deepEqual(spotsA, spotsB, "deterministic for identical inputs");

  const seenCells = new Set<string>();
  for (const spot of spotsA) {
    assert.ok(spot.cell.x >= 0 && spot.cell.x < 5, "x in 0..4");
    assert.ok(spot.cell.y >= 0 && spot.cell.y < 5, "y in 0..4");
    assert.equal(spot.vein, "rich");
    seenCells.add(`${spot.cell.x},${spot.cell.y}`);
  }
  assert.equal(seenCells.size, 3, "all 3 spots occupy distinct cells");

  // Center (2, 2) is not reserved in districts and is eligible across seeds
  let hitCenter = false;
  for (let seed = 1; seed <= 200; seed++) {
    const spots = generateDistrictSpots(2, 3, seed, "grass");
    if (spots.some((s) => s.cell.x === 2 && s.cell.y === 2)) {
      hitCenter = true;
      break;
    }
  }
  assert.equal(hitCenter, true, "center (2, 2) is eligible for district spots");

  // When mapResource is provided, spots[0] is guaranteed to have resource === mapResource and vein === "rich"
  const ironSpots = generateDistrictSpots(4, 1, 99, "mountain", "iron");
  assert.equal(ironSpots[0].resource, "iron");
  assert.equal(ironSpots[0].vein, "rich");

  const goldSpots = generateDistrictSpots(4, 1, 99, "desert", "gold");
  assert.equal(goldSpots[0].resource, "gold");
  assert.equal(goldSpots[0].vein, "rich");
});

test("generateDistrictSpots: a normal forest hex touching a dense forest gets one extra wood spot", () => {
  const plain = generateDistrictSpots(3, 4, 42, "forest");
  assert.equal(plain.length, 3, "a forest hex with no dense-forest neighbour keeps its 3 spots");
  assert.deepEqual(
    generateDistrictSpots(3, 4, 42, "forest", null, { touchesDenseForest: false }),
    plain,
    "an explicit false is the same as omitting the option",
  );

  const boosted = generateDistrictSpots(3, 4, 42, "forest", null, { touchesDenseForest: true });
  assert.equal(boosted.length, 4, "the dense-forest neighbour adds exactly one spot");
  assert.deepEqual(boosted.slice(0, 3), plain, "the hex keeps every spot it already had");
  assert.equal(boosted[3].resource, DENSE_FOREST_BONUS_SPOT);
  assert.equal(boosted[3].resource, "wood", "the extra resource is a woodcutting spot");
  assert.equal(boosted[3].vein, "dense");
  assert.equal(
    new Set(boosted.map((s) => `${s.cell.x},${s.cell.y}`)).size,
    4,
    "the bonus spot takes a free cell",
  );
  assert.deepEqual(
    generateDistrictSpots(3, 4, 42, "forest", null, { touchesDenseForest: true }),
    boosted,
    "the bonus spot is deterministic",
  );

  // It is a FOREST rule: a dense-forest neighbour grants nothing to other biomes.
  for (const terrain of ["grass", "dirt", "swamp", "snow", "desert"]) {
    assert.equal(
      generateDistrictSpots(3, 4, 42, terrain, null, { touchesDenseForest: true }).length,
      3,
      `${terrain} gains no bonus spot`,
    );
  }
});

// ── 3. applyPlaceBuildings in district mode ──────────────────────────────────

test("applyPlaceBuildings in district mode: allows (2,2), forbids townHall, validates 5x5 & overlaps, charges full cost, and cleans up empty districts", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 2000,
    warehouse: emptyWarehouse({ wood: 50, stone: 50, iron: 20, arcane: 20 }),
    buildings: [],
  });
  const state = makeState({ settlements: [settlement] });
  // citySpots are REQUIRED for a new district: only the callers holding the
  // GameMap can derive the map-deposit guarantee (D2), so the reducer refuses to
  // invent them. An existing district reuses its own persisted set.
  const districtSpots = generateDistrictSpots(3, 2, 4242, "grass", null);
  const target = { q: 3, r: 2, citySpots: districtSpots };

  // A NEW district with no citySpots is refused rather than given fabricated spots
  const noSpots = applyPlaceBuildings(state, "s0", 0, [makeBuilding("house", 2, 2, 1)], false, { q: 3, r: 2 });
  assert.equal(noSpots.ok, false);
  assert.equal(noSpots.reason, "district_spots_required");

  // Allows placing a building at (2, 2) and charges full cost even when initialLayout = true
  const placeCenter = applyPlaceBuildings(
    state,
    "s0",
    0,
    [makeBuilding("house", 2, 2, 1)],
    true,
    target,
  );
  assert.equal(placeCenter.ok, true);
  const afterPlace = placeCenter.state.settlements.s0;
  assert.equal(afterPlace.gold, 2000 - 100, "house costs 100g (never freeInitialLayout in district)");
  assert.equal(afterPlace.warehouse.wood, 50 - 5, "house costs 5 wood");
  const distState = afterPlace.districts?.["3,2"];
  assert.ok(distState, "district entry created");
  assert.equal(distState.buildings.length, 1);
  assert.equal(distState.buildings[0].gx, 2);
  assert.equal(distState.buildings[0].gy, 2);
  assert.ok((distState.buildings[0].construction?.daysRemaining ?? 0) > 0, "construction timer stamped");

  // Rejects townHall placement with reason: "town_hall_forbidden_in_district"
  const placeTh = applyPlaceBuildings(
    state,
    "s0",
    0,
    [makeBuilding("townHall", 1, 1, 1)],
    false,
    target,
  );
  assert.equal(placeTh.ok, false);
  assert.equal(placeTh.reason, "town_hall_forbidden_in_district");

  // Rejects out-of-bounds (gx >= 5 or gy >= 5 or 2x2 overflowing 5x5)
  for (const bad of [
    [makeBuilding("house", 5, 0, 1)],
    [makeBuilding("house", 0, 5, 1)],
    [makeBuilding("house", -1, 0, 1)],
    [makeBuilding("farmField", 4, 0, 1)], // 2x2 at gx=4 extends to gx=5
    [makeBuilding("warehouse", 0, 4, 1)], // 2x2 at gy=4 extends to gy=5
  ]) {
    const res = applyPlaceBuildings(state, "s0", 0, bad, false, target);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_district_placement");
  }

  // Rejects overlapping footprints with reason: "invalid_district_placement"
  const overlap1x1 = applyPlaceBuildings(
    state,
    "s0",
    0,
    [makeBuilding("house", 1, 1, 1), makeBuilding("goldMine", 1, 1, 1)],
    false,
    target,
  );
  assert.equal(overlap1x1.ok, false);
  assert.equal(overlap1x1.reason, "invalid_district_placement");

  const overlap2x2 = applyPlaceBuildings(
    state,
    "s0",
    0,
    [makeBuilding("farmField", 1, 1, 1), makeBuilding("house", 2, 2, 1)],
    false,
    target,
  );
  assert.equal(overlap2x2.ok, false);
  assert.equal(overlap2x2.reason, "invalid_district_placement");

  // Removing all buildings from a district deletes districts["q,r"] and omits settlement.districts
  const cleared = applyPlaceBuildings(placeCenter.state, "s0", 0, [], false, target);
  assert.equal(cleared.ok, true);
  const updatedSettlement = cleared.state.settlements.s0;
  assert.equal(updatedSettlement.districts, undefined);
  assert.equal("districts" in updatedSettlement, false, "settlement.districts key omitted when empty");
});

// ── 4. Economy pooling & enemy-hero occupation blocking ──────────────────────

test("district economy: producers, market income, enemy vs friendly hero occupation, and upkeep", () => {
  const seed = 777;
  const dSpots = generateDistrictSpots(3, 2, seed, "grass", "gold");
  const woodcutter = makeBuilding("woodcutterHut", 0, 0, 1);
  const farm = makeBuilding("farmField", 1, 1, 1);
  const goldMine = makeBuilding("goldMine", 3, 0, 1);
  const market = makeBuilding("market", 4, 4, 1);

  const district: DistrictState = {
    q: 3,
    r: 2,
    citySpots: dSpots,
    buildings: [woodcutter, farm, goldMine, market],
  };

  const baseSettlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      level: 1,
      population: 200,
      goldTax: 1,
      morale: 100,
      gold: 100,
      warehouse: emptyWarehouse({ wood: 20, stone: 20, food: 20 }),
      buildings: [makeBuilding("house", 0, 0, 1)],
    }),
    districts: { "3,2": district },
  };

  const dCtx = { q: district.q, r: district.r, citySpots: district.citySpots };
  const expectedWood = producerTurnOutput(woodcutter, dCtx, seed)?.amount ?? 0;
  const expectedFood = producerTurnOutput(farm, dCtx, seed)?.amount ?? 0;
  const expectedGoldProd = producerTurnOutput(goldMine, dCtx, seed)?.amount ?? 0;
  assert.ok(expectedWood > 0 && expectedFood > 0 && expectedGoldProd > 0);

  // Unblocked: district producers + market (40g/turn at L1) contribute to settlementProductionRates and produceSettlementResources
  const unblockedRates = settlementProductionRates(baseSettlement, seed, []);
  assert.deepEqual(unblockedRates.rates, [
    { resource: "wood", perTurn: expectedWood },
    { resource: "food", perTurn: expectedFood },
  ]);
  assert.equal(unblockedRates.goldPerTurn, Math.round((expectedGoldProd + 40) * 100) / 100);

  const producedUnblocked = produceSettlementResources({ s0: baseSettlement }, seed, []).s0;
  assert.equal(producedUnblocked.warehouse.wood, Math.round(20 + expectedWood));
  assert.equal(producedUnblocked.warehouse.food, Math.round(20 + expectedFood));
  assert.equal(producedUnblocked.gold, Math.round(100 + expectedGoldProd + 40));

  // Unblocked market (goldPerTurn: 75 at L1) adds to settlementIncome and effectiveSettlementIncome
  const baseOnlySettlement: SettlementState = { ...baseSettlement, districts: undefined };
  const baseInc = settlementIncome(baseOnlySettlement, []);
  const baseEffInc = effectiveSettlementIncome(baseOnlySettlement, []);
  const withDistrictInc = settlementIncome(baseSettlement, []);
  const withDistrictEffInc = effectiveSettlementIncome(baseSettlement, []);
  assert.ok(withDistrictInc > baseInc, "district buildings add to settlementIncome");
  assert.ok(withDistrictEffInc > baseEffInc, "district buildings add to effectiveSettlementIncome");

  // Friendly hero on (3, 2) does NOT block district production or income
  const friendlyHero = makeHero("hFriendly", 0, 3, 2);
  assert.deepEqual(
    settlementProductionRates(baseSettlement, seed, [friendlyHero]),
    unblockedRates,
    "friendly hero on district hex does not block production rates",
  );
  assert.equal(
    settlementIncome(baseSettlement, [friendlyHero]),
    withDistrictInc,
    "friendly hero on district hex does not block settlementIncome",
  );
  assert.equal(
    effectiveSettlementIncome(baseSettlement, [friendlyHero]),
    withDistrictEffInc,
    "friendly hero on district hex does not block effectiveSettlementIncome",
  );

  // Enemy hero on (3, 2) zeroes that district's contribution to production and income
  const enemyHero = makeHero("hEnemy", 1, 3, 2);
  const blockedRates = settlementProductionRates(baseSettlement, seed, [enemyHero]);
  assert.deepEqual(blockedRates, { rates: [], goldPerTurn: 0 });

  const producedBlocked = produceSettlementResources({ s0: baseSettlement }, seed, [enemyHero]).s0;
  assert.equal(producedBlocked.warehouse.wood, 20);
  assert.equal(producedBlocked.warehouse.food, 20);
  assert.equal(producedBlocked.gold, 100);

  assert.equal(settlementIncome(baseSettlement, [enemyHero]), baseInc);
  assert.equal(effectiveSettlementIncome(baseSettlement, [enemyHero]), baseEffInc);

  // buildingUpkeepRequired still includes district buildings even when occupied by an enemy hero
  const baseUpkeep = buildingUpkeepRequired(baseOnlySettlement);
  const totalUpkeep = buildingUpkeepRequired(baseSettlement);
  assert.ok(
    totalUpkeep.wood > baseUpkeep.wood || totalUpkeep.stone > baseUpkeep.stone,
    "district buildings add to buildingUpkeepRequired regardless of occupation",
  );
  const consumed = applySettlementConsumption(baseSettlement);
  assert.equal(consumed.warehouse.wood, 20 - totalUpkeep.wood);
  assert.equal(consumed.warehouse.stone, 20 - totalUpkeep.stone);
});

test("district storage caps, banking, construction, upgrades, recruitment, and hydration", () => {
  const baseSettlement = makeSettlement("s0", 0, 2, 2, {
    level: 1,
    gold: 5000,
    warehouse: emptyWarehouse({ wood: 100, stone: 100, iron: 50, arcane: 50, food: 100 }),
    buildings: [makeBuilding("townHall", 2, 2, 1)],
  });
  const baseResCap = settlementResourceCap(baseSettlement);
  const baseTreasCap = settlementTreasuryCap(baseSettlement);

  const withCaps: SettlementState = {
    ...baseSettlement,
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [
          makeBuilding("warehouse", 0, 0, 1), // +600 all resources, +500 treasury
          makeBuilding("granary", 2, 0, 1), // +600 food
          makeBuilding("treasury", 3, 0, 1), // +2000 treasury
          makeBuilding("bank", 4, 0, 1), // +2000 treasury
          makeBuilding("barracks", 0, 3, 1, { construction: { daysRemaining: 1 } }),
        ],
      },
    },
  };

  // Caps pool warehouse, granary, treasury, and bank bonuses from districts
  const pooledResCap = settlementResourceCap(withCaps);
  assert.equal(pooledResCap.wood, baseResCap.wood + 600);
  assert.equal(pooledResCap.food, baseResCap.food + 600 + 600);
  const pooledTreasCap = settlementTreasuryCap(withCaps);
  assert.equal(pooledTreasCap, baseTreasCap + 500 + 2000 + 2000);

  // Banking in district: depositIntoBank, accrueBankInterest, requestBankWithdrawal, matureBankWithdrawals
  let state = makeState({ day: 10, settlements: [withCaps] });
  const dep = depositIntoBank(state, "s0", 4, 0, 1000, { q: 3, r: 2 });
  assert.equal(dep.ok, true);
  state = dep.state;
  const distBankAfterDep = state.settlements.s0.districts?.["3,2"].buildings.find(
    (b) => b.gx === 4 && b.gy === 0,
  );
  assert.ok(distBankAfterDep);
  assert.equal(bankGoldOf(distBankAfterDep), 1000);
  assert.equal(state.settlements.s0.gold, 4000);

  state = accrueBankInterest(state);
  const distBankAfterInterest = state.settlements.s0.districts?.["3,2"].buildings.find(
    (b) => b.gx === 4 && b.gy === 0,
  );
  assert.ok(distBankAfterInterest);
  assert.equal(bankGoldOf(distBankAfterInterest), 1050, "5% weekly interest accrued on district bank");

  const wd = requestBankWithdrawal(state, "s0", 4, 0, 350, { q: 3, r: 2 });
  assert.equal(wd.ok, true);
  state = wd.state;
  const distBankAfterWd = state.settlements.s0.districts?.["3,2"].buildings.find(
    (b) => b.gx === 4 && b.gy === 0,
  );
  assert.ok(distBankAfterWd);
  assert.equal(bankGoldOf(distBankAfterWd), 700);
  assert.deepEqual(bankPendingOut(distBankAfterWd), [{ gold: 350, maturesOnDay: 10 + BANK_WITHDRAWAL_DAYS }]);

  state = matureBankWithdrawals({ ...state, day: 10 + BANK_WITHDRAWAL_DAYS });
  assert.equal(state.settlements.s0.gold, 4350, "matured district bank withdrawal paid to settlement treasury");
  const distBankAfterMature = state.settlements.s0.districts?.["3,2"].buildings.find(
    (b) => b.gx === 4 && b.gy === 0,
  );
  assert.ok(distBankAfterMature);
  assert.deepEqual(bankPendingOut(distBankAfterMature), []);

  // applyEngineEvent replays BankGoldMoved on a district bank
  const replay = applyEngineEvent(state, {
    type: "BankGoldMoved",
    actor: 0,
    settlementId: "s0",
    gx: 4,
    gy: 0,
    amount: 200,
    direction: "deposit",
    district: { q: 3, r: 2 },
  });
  assert.equal(replay.outcome, "applied");
  const distBankAfterReplay = replay.state.settlements.s0.districts?.["3,2"].buildings.find(
    (b) => b.gx === 4 && b.gy === 0,
  );
  assert.ok(distBankAfterReplay);
  assert.equal(bankGoldOf(distBankAfterReplay), 900);

  // advanceBuildingConstructions completes the district barracks
  assert.equal(
    eligibleRecruitSources(state.settlements.s0).some((r) => r.buildingKind === "barracks"),
    false,
    "under-construction district barracks is not yet eligible",
  );
  state = advanceBuildingConstructions(state);
  const barracks = state.settlements.s0.districts?.["3,2"].buildings.find((b) => b.kind === "barracks");
  assert.ok(barracks);
  assert.equal(barracks.construction, undefined, "construction timer cleared on completion");

  // eligibleRecruitSources and recruitUnits work for district buildings
  const sources = eligibleRecruitSources(state.settlements.s0);
  const swordsmanSource = sources.find((r) => r.entry.unitTypeId === "swordsman");
  assert.ok(swordsmanSource);
  assert.deepEqual(swordsmanSource.district, { q: 3, r: 2 });

  const recruited = recruitUnits(state, {
    settlementId: "s0",
    buildingKind: "barracks",
    gx: 0,
    gy: 3,
    unitTypeId: "swordsman",
    count: 2,
    district: { q: 3, r: 2 },
  });
  assert.equal(recruited.ok, true);
  state = recruited.state;
  assert.deepEqual(settlementStacks(state.settlements.s0)[0].entries, [
    { unitTypeId: "swordsman", count: 2 },
  ]);

  // startBuildingUpgrade and advanceSettlementUpgrades work for district buildings
  const upg = startBuildingUpgrade(
    state,
    "s0",
    [{ gx: 0, gy: 3, kind: "barracks" }],
    { q: 3, r: 2 },
  );
  assert.equal(upg.ok, true);
  state = upg.state;
  assert.equal(state.settlements.s0.upgrade?.kind, "buildings");
  assert.deepEqual(state.settlements.s0.upgrade?.buildingRefs, [
    { gx: 0, gy: 3, kind: "barracks", district: { q: 3, r: 2 } },
  ]);

  while (state.settlements.s0.upgrade) {
    state = advanceSettlementUpgrades(state);
  }
  const upgradedBarracks = state.settlements.s0.districts?.["3,2"].buildings.find(
    (b) => b.kind === "barracks",
  );
  assert.equal(upgradedBarracks?.level, 2, "district barracks upgraded to level 2");

  // hydrateGameState preserves non-empty districts and omits empty districts
  const hydrated = hydrateGameState({
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: state.players,
    heroes: state.heroes,
    settlements: {
      sWithDist: state.settlements.s0,
      sEmptyDist: { ...baseSettlement, id: "sEmptyDist", districts: {} },
    },
  });
  assert.ok(hydrated.settlements.sWithDist.districts?.["3,2"], "non-empty districts preserved");
  assert.equal(hydrated.settlements.sEmptyDist.districts, undefined);
  assert.equal("districts" in hydrated.settlements.sEmptyDist, false, "empty districts omitted");
});

// ── 5. Server parseCommand & handleCommand district validation ───────────────

test("parseCommand: accepts valid district on PlaceBuildings, UpgradeBuilding, BankGold, RecruitUnits and rejects non-integer district", () => {
  const validDistrict = { q: 3, r: 2 };

  const placeCmd = parseCommand(
    {
      kind: "PlaceBuildings",
      actor: 0,
      settlementId: "s0",
      buildings: [{ gx: 2, gy: 2, kind: "house", level: 1 }],
      district: validDistrict,
    },
    "g1",
  );
  assert.ok(placeCmd && placeCmd.kind === "PlaceBuildings");
  assert.deepEqual(placeCmd.district, validDistrict);

  const upgCmd = parseCommand(
    {
      kind: "UpgradeBuilding",
      actor: 0,
      settlementId: "s0",
      requests: [{ gx: 0, gy: 3, kind: "barracks", district: validDistrict }],
      district: validDistrict,
    },
    "g1",
  );
  assert.ok(upgCmd && upgCmd.kind === "UpgradeBuilding");
  assert.deepEqual(upgCmd.district, validDistrict);
  assert.deepEqual(upgCmd.requests[0].district, validDistrict);

  const bankCmd = parseCommand(
    {
      kind: "BankGold",
      actor: 0,
      settlementId: "s0",
      gx: 4,
      gy: 0,
      amount: 100,
      direction: "deposit",
      district: validDistrict,
    },
    "g1",
  );
  assert.ok(bankCmd && bankCmd.kind === "BankGold");
  assert.deepEqual(bankCmd.district, validDistrict);

  const recruitCmd = parseCommand(
    {
      kind: "RecruitUnits",
      actor: 0,
      settlementId: "s0",
      buildingKind: "barracks",
      gx: 0,
      gy: 3,
      unitTypeId: "swordsman",
      count: 1,
      district: validDistrict,
    },
    "g1",
  );
  assert.ok(recruitCmd && recruitCmd.kind === "RecruitUnits");
  assert.deepEqual(recruitCmd.district, validDistrict);

  // Rejects non-integer or malformed district payloads
  for (const badDistrict of [
    { q: 1.5, r: 2 },
    { q: 1, r: -2.2 },
    { q: "1", r: 2 },
    { q: 1 },
    null,
    [1, 2],
    "3,2",
  ]) {
    assert.equal(
      parseCommand(
        {
          kind: "PlaceBuildings",
          actor: 0,
          settlementId: "s0",
          buildings: [],
          district: badDistrict,
        },
        "g1",
      ),
      null,
      `PlaceBuildings must reject district=${JSON.stringify(badDistrict)}`,
    );
    assert.equal(
      parseCommand(
        {
          kind: "UpgradeBuilding",
          actor: 0,
          settlementId: "s0",
          requests: [{ gx: 0, gy: 0, kind: "house" }],
          district: badDistrict,
        },
        "g1",
      ),
      null,
      `UpgradeBuilding must reject district=${JSON.stringify(badDistrict)}`,
    );
    assert.equal(
      parseCommand(
        {
          kind: "BankGold",
          actor: 0,
          settlementId: "s0",
          gx: 0,
          gy: 0,
          amount: 50,
          direction: "deposit",
          district: badDistrict,
        },
        "g1",
      ),
      null,
      `BankGold must reject district=${JSON.stringify(badDistrict)}`,
    );
    assert.equal(
      parseCommand(
        {
          kind: "RecruitUnits",
          actor: 0,
          settlementId: "s0",
          buildingKind: "barracks",
          gx: 0,
          gy: 0,
          unitTypeId: "swordsman",
          count: 1,
          district: badDistrict,
        },
        "g1",
      ),
      null,
      `RecruitUnits must reject district=${JSON.stringify(badDistrict)}`,
    );
  }
});

test("handleCommand: PlaceBuildings, BankGold, UpgradeBuilding, and RecruitUnits validate and persist district state", async () => {
  const seed = 1;
  const map = getOrCreateGameMap(seed, "small", 1);
  // Find a settlement center on passable terrain with at least one adjacent passable hex
  let centerQ = 2;
  let centerR = 2;
  let adjQ = 3;
  let adjR = 2;
  let found = false;
  for (let r = 2; r < map.height - 2 && !found; r++) {
    for (let q = 2; q < map.width - 2 && !found; q++) {
      const t = map.get(q, r);
      if (t !== "grass") continue;
      const n = map.get(q + 1, r);
      if (n === "grass" || n === "forest" || n === "dirt") {
        centerQ = q;
        centerR = r;
        adjQ = q + 1;
        adjR = r;
        found = true;
      }
    }
  }
  assert.equal(found, true, "found passable center and adjacent hex on small map");

  const s0 = makeSettlement("s0", 0, centerQ, centerR, {
    level: 1,
    gold: 5000,
    warehouse: emptyWarehouse({ wood: 100, stone: 100, iron: 50, arcane: 50 }),
    buildings: [makeBuilding("townHall", 2, 2, 1)],
  });
  const h0 = makeHero("h0", 0, centerQ, centerR);
  const row = {
    name: "test-districts",
    seed,
    map_size: "small",
    round: 1,
    day: 1,
    active_player_id: 0,
    players: [makePlayer(0, "player", ["h0"], ["s0"])],
    heroes: { h0 },
    settlements: { s0 },
  };
  const gameRepo = createMockGameRepo({ "test-districts": row });
  const eventRepo = createMockEventRepo();
  const heroRepo = createMockHeroRepo({ "test-districts": row.heroes });
  const settlementRepo = createMockSettlementRepo({ "test-districts": row.settlements });
  const charterRepo = createMockCharterRepo();
  const deps = {
    gameRepo,
    eventRepo,
    heroRepo,
    settlementRepo,
    charterRepo,
    ctx: {
      rng: () => 0.5,
      catalog: {
        unitTypes: [
          {
            id: "peasant",
            name: "Peasant",
            attack: 1,
            defence: 1,
            health: 1,
            speed: 1,
            description: "",
            advantageType: "infantry" as const,
            specialty: "",
            specialtyPriority: 0,
            factionId: "human" as const,
          },
        ],
      },
    },
  };

  // Rejects out-of-bounds district hex
  const outOfBounds = await handleCommand(
    {
      kind: "PlaceBuildings",
      gameName: "test-districts",
      actor: 0,
      settlementId: "s0",
      buildings: [makeBuilding("house", 0, 0, 1)],
      district: { q: -1, r: 0 },
    },
    deps,
  );
  assert.equal(outOfBounds.ok, false);
  assert.equal(outOfBounds.reason, "invalid_district_hex");

  // Rejects district on settlement center
  const onCenter = await handleCommand(
    {
      kind: "PlaceBuildings",
      gameName: "test-districts",
      actor: 0,
      settlementId: "s0",
      buildings: [makeBuilding("house", 0, 0, 1)],
      district: { q: centerQ, r: centerR },
    },
    deps,
  );
  assert.equal(onCenter.ok, false);
  assert.equal(onCenter.reason, "district_on_settlement_center");

  // Rejects impassable terrain hex
  let impassableHex: { q: number; r: number } | null = null;
  for (let r = 0; r < map.height && !impassableHex; r++) {
    for (let q = 0; q < map.width && !impassableHex; q++) {
      const t = map.get(q, r);
      if ((t === "water" || t === "mountain") && (q !== centerQ || r !== centerR)) {
        impassableHex = { q, r };
      }
    }
  }
  if (impassableHex) {
    const impassable = await handleCommand(
      {
        kind: "PlaceBuildings",
        gameName: "test-districts",
        actor: 0,
        settlementId: "s0",
        buildings: [makeBuilding("house", 0, 0, 1)],
        district: impassableHex,
      },
      deps,
    );
    assert.equal(impassable.ok, false);
    assert.equal(impassable.reason, "impassable_district_terrain");
  }

  // Rejects out-of-territory passable hex
  let farPassable: { q: number; r: number } = { q: map.width - 1, r: map.height - 1 };
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const t = map.get(q, r);
      if (t !== "water" && t !== "mountain" && Math.abs(q - centerQ) + Math.abs(r - centerR) > 4) {
        farPassable = { q, r };
        break;
      }
    }
  }
  const outOfRange = await handleCommand(
    {
      kind: "PlaceBuildings",
      gameName: "test-districts",
      actor: 0,
      settlementId: "s0",
      buildings: [makeBuilding("house", 0, 0, 1)],
      district: farPassable,
    },
    deps,
  );
  assert.equal(outOfRange.ok, false);
  assert.equal(outOfRange.reason, "not_in_settlement_territory");

  // Succeeds on adjacent passable hex in territory
  const placed = await handleCommand(
    {
      kind: "PlaceBuildings",
      gameName: "test-districts",
      actor: 0,
      settlementId: "s0",
      buildings: [makeBuilding("bank", 1, 1, 1), makeBuilding("farmhouse", 2, 2, 1)],
      district: { q: adjQ, r: adjR },
    },
    deps,
  );
  assert.equal(placed.ok, true);
  assert.equal(placed.events[0]?.type, "BuildingsPlaced");
  if (placed.events[0]?.type === "BuildingsPlaced") {
    assert.deepEqual(placed.events[0].district, { q: adjQ, r: adjR });
  }
  const dKey = districtKey(adjQ, adjR);
  assert.equal(placed.settlement?.districts?.[dKey]?.buildings.length, 2);

  // BankGold on the district bank works through handleCommand
  const banked = await handleCommand(
    {
      kind: "BankGold",
      gameName: "test-districts",
      actor: 0,
      settlementId: "s0",
      gx: 1,
      gy: 1,
      amount: 300,
      direction: "deposit",
      district: { q: adjQ, r: adjR },
    },
    deps,
  );
  assert.equal(banked.ok, true);
  assert.equal(banked.events[0]?.type, "BankGoldMoved");
  if (banked.events[0]?.type === "BankGoldMoved") {
    assert.deepEqual(banked.events[0].district, { q: adjQ, r: adjR });
  }

  // UpgradeBuilding on the district building works through handleCommand
  const upgraded = await handleCommand(
    {
      kind: "UpgradeBuilding",
      gameName: "test-districts",
      actor: 0,
      settlementId: "s0",
      requests: [{ gx: 1, gy: 1, kind: "bank" }],
      district: { q: adjQ, r: adjR },
    },
    deps,
  );
  assert.equal(upgraded.ok, true);
  assert.equal(upgraded.events[0]?.type, "BuildingUpgradeStarted");
  if (upgraded.events[0]?.type === "BuildingUpgradeStarted") {
    assert.deepEqual(upgraded.events[0].district, { q: adjQ, r: adjR });
  }

  // Mark district farmhouse finished and test RecruitUnits with district through handleCommand
  const savedS0 = settlementRepo.rows["test-districts"].s0;
  const finishedDistBuildings = savedS0.districts![dKey].buildings.map((b) => {
    const { construction: _c, ...rest } = b;
    return rest;
  });
  const readyS0: SettlementState = {
    ...savedS0,
    districts: {
      ...savedS0.districts,
      [dKey]: { ...savedS0.districts![dKey], buildings: finishedDistBuildings },
    },
  };
  settlementRepo.rows["test-districts"] = { s0: readyS0 };
  gameRepo.rows["test-districts"].settlements = { s0: readyS0 };

  const recruitedViaHandler = await handleCommand(
    {
      kind: "RecruitUnits",
      gameName: "test-districts",
      actor: 0,
      settlementId: "s0",
      buildingKind: "farmhouse",
      gx: 2,
      gy: 2,
      unitTypeId: "peasant",
      count: 2,
      district: { q: adjQ, r: adjR },
    },
    deps,
  );
  assert.equal(recruitedViaHandler.ok, true);
  assert.equal(recruitedViaHandler.events[0]?.type, "UnitsRecruited");
  if (recruitedViaHandler.events[0]?.type === "UnitsRecruited") {
    assert.deepEqual(recruitedViaHandler.events[0].district, { q: adjQ, r: adjR });
  }
});

// ── 6. Scene & UI helpers ────────────────────────────────────────────────────

test("buildAdventureScene: DistrictNode variant (standard vs farm), tier (1/2/3), blocked flag, and empty omission", () => {
  const map = makeGrassMap(6, 6);
  const castle = Castle.fromGameState({
    ...makeSettlement("s0", 0, 2, 2, { level: 2, population: 500, goldTax: 1 }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [makeBuilding("house", 0, 0), makeBuilding("goldMine", 1, 0)], // 2 buildings -> tier 1, standard
      },
      "2,3": {
        q: 2,
        r: 3,
        citySpots: [],
        buildings: [
          makeBuilding("farmField", 0, 0),
          makeBuilding("house", 2, 0),
          makeBuilding("house", 3, 0),
          makeBuilding("house", 4, 0),
        ], // 4 buildings -> tier 2, farm
      },
      "1,2": {
        q: 1,
        r: 2,
        citySpots: [],
        buildings: Array.from({ length: 9 }, (_, i) => makeBuilding("house", i % 5, Math.floor(i / 5))), // 9 -> tier 3
      },
      "1,3": {
        q: 1,
        r: 3,
        citySpots: [],
        buildings: [], // empty -> no DistrictNode
      },
    },
  });

  const enemyHero = new Hero("hEnemy", "Enemy", 3, 2, "enemy", 1);
  const friendlyHero = new Hero("hOwn", "Own", 2, 3, "player", 0);

  const nodes = buildAdventureScene({
    map,
    heroes: [enemyHero, friendlyHero],
    castles: [castle],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });

  const districtNodes = nodes.filter((n): n is DistrictNode => n.kind === "district");
  assert.equal(districtNodes.length, 3, "empty district emits no DistrictNode");

  const d32 = districtNodes.find((d) => d.q === 3 && d.r === 2);
  assert.ok(d32);
  assert.equal(d32.variant, "standard");
  assert.equal(d32.tier, 1);
  assert.equal(d32.blocked, true, "enemy hero on (3,2) marks DistrictNode blocked");

  const d23 = districtNodes.find((d) => d.q === 2 && d.r === 3);
  assert.ok(d23);
  assert.equal(d23.variant, "farm");
  assert.equal(d23.tier, 2);
  assert.equal(d23.blocked, undefined, "friendly hero on (2,3) does not block");

  const d12 = districtNodes.find((d) => d.q === 1 && d.r === 2);
  assert.ok(d12);
  assert.equal(d12.variant, "standard");
  assert.equal(d12.tier, 3);
  assert.equal(d12.blocked, undefined);
});

test("buildEntryStatus: isDistrict disables townHall with 'Town Hall can only be built in the main settlement'", () => {
  const full: BuildEntryAffordability = {
    gold: 5000,
    warehouse: { wood: 100, stone: 100, iron: 50, arcane: 50 },
  };
  const status = buildEntryStatus({
    kind: "townHall",
    affordability: full,
    hasTownHall: false,
    isDistrict: true,
  });
  assert.equal(status.disabled, true);
  assert.ok(status.reasons.includes("Town Hall can only be built in the main settlement"));

  const houseInDistrict = buildEntryStatus({
    kind: "house",
    affordability: full,
    isDistrict: true,
  });
  assert.equal(houseInDistrict.disabled, false);
});

test("describeTile: territory aligns to controlRange(c.level) and reports info.district including blocked", () => {
  const rows: TileRow[] = [];
  for (let r = 0; r < 6; r++) {
    for (let q = 0; q < 6; q++) {
      rows.push({ q, r, terrain: "grass", resource: null });
    }
  }
  const map = GameMap.fromTiles(rows);

  const settlementState: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      level: 1,
      buildings: [makeBuilding("townHall", 2, 2, 3)], // L3 townHall has controlRangeBonus=1, but territory uses controlRange(level)=1
    }),
    name: "Oakkeep",
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [makeBuilding("farmhouse", 0, 0, 1), makeBuilding("house", 1, 0, 1)],
      },
    },
  };
  const castle = Castle.fromGameState(settlementState);
  const state = makeState({ settlements: [settlementState] });
  const ownHero = new Hero("h0", "Hero", 2, 2, "player", 0);
  const enemyHero = new Hero("h1", "Raider", 3, 2, "enemy", 1);

  // Hex (3, 2) at distance 1 is in territory and reports district info (including blocked: true)
  const districtHexInfo = describeTile({
    map,
    state,
    heroes: [ownHero, enemyHero],
    castles: [castle],
    viewPlayerId: 0,
    tile: { q: 3, r: 2 },
  });
  assert.ok(districtHexInfo);
  assert.deepEqual(districtHexInfo.territory, {
    settlementName: "Oakkeep",
    ownerName: "Player 1",
  });
  assert.deepEqual(districtHexInfo.district, {
    settlementName: "Oakkeep",
    ownerName: "Player 1",
    buildingCount: 2,
    variant: "farm",
    blocked: true,
  });

  // Without enemy hero, blocked is false
  const unblockedHexInfo = describeTile({
    map,
    state,
    heroes: [ownHero],
    castles: [castle],
    viewPlayerId: 0,
    tile: { q: 3, r: 2 },
  });
  assert.equal(unblockedHexInfo?.district?.blocked, false);

  // Hex (4, 2) at distance 2 is outside controlRange(1), even though L3 Town Hall gives vision range 2
  const dist2Info = describeTile({
    map,
    state,
    heroes: [ownHero],
    castles: [castle],
    viewPlayerId: 0,
    tile: { q: 4, r: 2 },
  });
  assert.ok(dist2Info);
  assert.equal(dist2Info.fogged, false);
  assert.equal(dist2Info.territory, null, "describeTile territory aligns to controlRange(c.level)");
});

test("settlementFullnessForCount, castleKey fullness variants, and buildAdventureScene CastleNode fullness", async () => {
  for (const count of [0, 1, 2, 3]) {
    assert.equal(settlementFullnessForCount(count), 1, `count=${count} -> fullness 1`);
  }
  for (const count of [4, 5, 6]) {
    assert.equal(settlementFullnessForCount(count), 2, `count=${count} -> fullness 2`);
  }
  for (const count of [7, 8, 9]) {
    assert.equal(settlementFullnessForCount(count), 3, `count=${count} -> fullness 3`);
  }
  for (const count of [10, 11, 12]) {
    assert.equal(settlementFullnessForCount(count), 4, `count=${count} -> fullness 4`);
  }
  for (const count of [13, 14, 20, 25]) {
    assert.equal(settlementFullnessForCount(count), 5, `count=${count} -> fullness 5`);
  }

  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith(".png?url")) {
        return {
          url: `data:text/javascript,export default ${JSON.stringify(specifier)};`,
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      const res = nextLoad(url, context);
      if (url.endsWith("/src/render/assetDescriptors.ts") && typeof res.source === "string") {
        const globStub =
          'import.meta.glob ??= (p) => p.includes("building-pixel-") ? Object.fromEntries(Object.values(BUILDING_SPRITE_FILES).map((f) => ["../resources/buildings/" + f, { default: f }])) : {};\n';
        return { ...res, source: globStub + res.source };
      }
      return res;
    },
  });

  try {
    const { castleKey, SETTLEMENT_L1_FULLNESS_DESCRIPTORS, type: _t } = await import(
      "../../src/render/assetDescriptors"
    ) as typeof import("../../src/render/assetDescriptors") & { type?: never };
    void _t;

    const variants: readonly CastleVariant[] = [0, 1, 2, 3];
    const fullnesses = [1, 2, 3, 4, 5] as const;
    for (const v of variants) {
      for (const f of fullnesses) {
        assert.equal(castleKey(1, v, f), `castle.1.v${v}.f${f}`);
      }
    }
    assert.equal(castleKey(1, undefined, 3), "castle.1.v0.f3");
    assert.equal(castleKey(1, 0), "castle.1");
    assert.equal(castleKey(1, 1), "castle-alt.1");
    assert.equal(castleKey(1, 2), "castle-alt2.1");
    assert.equal(castleKey(1, 3), "castle-alt3.1");
    assert.equal(castleKey(2, 0, 4), "castle.2");
    assert.equal(castleKey(3, 1, 5), "castle-alt.3");
    assert.equal(SETTLEMENT_L1_FULLNESS_DESCRIPTORS.length, 20);
  } finally {
    hooks.deregister();
  }

  const map = makeGrassMap(6, 6);
  const cEmpty = Castle.fromGameState(
    makeSettlement("sEmpty", 0, 1, 1, { level: 1, buildings: [] }),
  );
  const cL1Populated = Castle.fromGameState({
    ...makeSettlement("sL1", 0, 2, 2, {
      level: 1,
      buildings: Array.from({ length: 7 }, (_, i) => makeBuilding("house", i % 5, Math.floor(i / 5))),
    }),
    castleVariant: 2,
  });
  const cL2Populated = Castle.fromGameState(
    makeSettlement("sL2", 0, 4, 4, {
      level: 2,
      buildings: Array.from({ length: 10 }, (_, i) => makeBuilding("house", i % 5, Math.floor(i / 5))),
    }),
  );

  const nodes = buildAdventureScene({
    map,
    heroes: [],
    castles: [cEmpty, cL1Populated, cL2Populated],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });

  const castleNodes = nodes.filter((n): n is CastleNode => n.kind === "castle");
  const byId = new Map(castleNodes.map((n) => [n.settlementId, n]));

  const emptyNode = byId.get("sEmpty");
  assert.ok(emptyNode);
  assert.equal("fullness" in emptyNode, false, "empty L1 settlement omits fullness");

  const l1Node = byId.get("sL1");
  assert.ok(l1Node);
  assert.equal(l1Node.variant, 2);
  assert.equal(l1Node.fullness, 3, "L1 settlement with 7 buildings emits fullness 3");

  const l2Node = byId.get("sL2");
  assert.ok(l2Node);
  assert.equal("fullness" in l2Node, false, "L2 settlement omits fullness");
});

// ── 7. PR #218 Copilot & branch review regression coverage ──────────────────

test("applyPlaceBuildings: strips forged level > 1 and bank on new placements, preserves prev.level and prev.bank, and enforces 2x2 footprint for 1.5x1.5 L2 buildings", () => {
  const existingBank: BuildingDef = {
    gx: 0,
    gy: 0,
    kind: "bank",
    level: 2,
    style: "pixel",
    bank: { gold: 750, pendingOut: [{ gold: 200, maturesOnDay: 14 }] },
  };
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      gold: 5000,
      warehouse: emptyWarehouse({ wood: 200, stone: 200, iron: 100, arcane: 100 }),
      buildings: [],
    }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [existingBank],
      },
    },
  };
  const state = makeState({ settlements: [settlement] });

  // Forged new placement with level 3 and pre-funded bank pot + tampered existing bank level/pot
  const res = applyPlaceBuildings(
    state,
    "s0",
    0,
    [
      {
        gx: 0,
        gy: 0,
        kind: "bank",
        level: 3,
        style: "pixel",
        bank: { gold: 999999, pendingOut: [] },
      },
      {
        gx: 2,
        gy: 2,
        kind: "bank",
        level: 3,
        w: 5,
        h: 5,
        style: "pixel",
        bank: { gold: 50000, pendingOut: [{ gold: 10000, maturesOnDay: 1 }] },
      },
    ],
    false,
    { q: 3, r: 2 },
  );
  assert.equal(res.ok, true);
  const distBuildings = res.state.settlements.s0.districts?.["3,2"].buildings ?? [];
  assert.equal(distBuildings.length, 2);

  const preserved = distBuildings.find((b) => b.gx === 0 && b.gy === 0)!;
  assert.equal(preserved.level, 2, "existing building preserves server prev.level");
  assert.deepEqual(preserved.bank, {
    gold: 750,
    pendingOut: [{ gold: 200, maturesOnDay: 14 }],
  });

  const placed = distBuildings.find((b) => b.gx === 2 && b.gy === 2)!;
  assert.equal(placed.level, 1, "new placement forces level = 1");
  assert.equal("w" in placed === false && "h" in placed === false, true, "new placement strips forged w/h");
  assert.equal(placed.bank, undefined, "new placement strips forged bank state");
  assert.equal("bank" in placed, false);

  // Existing L2 bank at (0, 0) has 1.5x1.5 registry footprint -> reserves 2x2 cells (0..1, 0..1),
  // so placing a 1x1 house at (1, 1) must be rejected as overlapping!
  const overlapL2 = applyPlaceBuildings(
    state,
    "s0",
    0,
    [existingBank, makeBuilding("house", 1, 1, 1)],
    false,
    { q: 3, r: 2 },
  );
  assert.equal(overlapL2.ok, false);
  assert.equal(overlapL2.reason, "invalid_district_placement");
});

test("applyPopulationGrowth and computePlayerBonuses: include completed district housing and district player bonuses", () => {
  const sWithHousing: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      level: 1,
      population: 500, // At base POP_BY_LEVEL[1] = 500
      warehouse: emptyWarehouse({ food: 500 }),
    }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [
          makeBuilding("house", 0, 0, 1), // +300
          makeBuilding("apartment", 1, 0, 1), // +100
          makeBuilding("farmhouse", 3, 0, 2), // +40 (20 * 2)
          makeBuilding("apartment", 0, 2, 3, { construction: { daysRemaining: 2 } }), // in-construction: ignored
          makeBuilding("tower", 4, 0, 2), // visionRangeBonus: 4
          makeBuilding("archeryRange", 4, 1, 1), // heroAttackBonus: 1
        ],
      },
    },
  };

  const bonus = districtPopulationBonus(sWithHousing);
  assert.equal(bonus, 300 + 100 + 40, "completed district housing adds 440 populationBonus (house L1 300 + apartment 100 + farmhouse L2 40)");

  const grown = applyPopulationGrowth({ s0: sWithHousing }, 0.1).s0;
  // levelMax = 500 + 440 = 940; growth = ceil((500 + 440) * 0.1) = 94 -> 594
  assert.equal(grown.population, 594);

  // Clamps to levelMax (940): 900 + ceil((900 + 440) * 0.1) = 1034 -> 940
  const nearCap: SettlementState = { ...sWithHousing, population: 900 };
  const clamped = applyPopulationGrowth({ s0: nearCap }, 0.1).s0;
  assert.equal(clamped.population, 940);

  const playerBonuses = computePlayerBonuses([sWithHousing]);
  assert.equal(playerBonuses.visionRangeBonus, 4);
  assert.equal(playerBonuses.heroAttackBonus, 1);
});

test("startBuildingUpgrade rejects duplicate_building_ref and applyBuildingUpgrade / advanceSettlementUpgrades never double-increment", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      gold: 5000,
      warehouse: emptyWarehouse({ wood: 200, stone: 200 }),
      buildings: [makeBuilding("house", 0, 0, 1)],
    }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [makeBuilding("house", 1, 1, 1)],
      },
    },
  };
  const state = makeState({ settlements: [settlement] });

  const dupMain = startBuildingUpgrade(state, "s0", [
    { gx: 0, gy: 0, kind: "house" },
    { gx: 0, gy: 0, kind: "house" },
  ]);
  assert.equal(dupMain.ok, false);
  if (!dupMain.ok) assert.equal(dupMain.reason, "duplicate_building_ref");

  const dupDist = startBuildingUpgrade(
    state,
    "s0",
    [
      { gx: 1, gy: 1, kind: "house" },
      { gx: 1, gy: 1, kind: "house", district: { q: 3, r: 2 } },
    ],
    { q: 3, r: 2 },
  );
  assert.equal(dupDist.ok, false);
  if (!dupDist.ok) assert.equal(dupDist.reason, "duplicate_building_ref");

  // Even if duplicate refs reach applyBuildingUpgrade or advanceSettlementUpgrades, level increments by at most 1
  const appliedOnce = applyBuildingUpgrade(
    state,
    "s0",
    [
      { gx: 1, gy: 1, kind: "house", district: { q: 3, r: 2 } },
      { gx: 1, gy: 1, kind: "house", district: { q: 3, r: 2 } },
    ],
  );
  assert.equal(
    appliedOnce.settlements.s0.districts?.["3,2"].buildings[0].level,
    2,
    "applyBuildingUpgrade increments district building only once",
  );

  const stateWithDupUpgrade: GameState = {
    ...state,
    settlements: {
      s0: {
        ...settlement,
        upgrade: {
          kind: "buildings",
          targetLevel: 3,
          daysRemaining: 1,
          buildingRefs: [
            { gx: 1, gy: 1, kind: "house", district: { q: 3, r: 2 } },
            { gx: 1, gy: 1, kind: "house", district: { q: 3, r: 2 } },
          ],
          district: { q: 3, r: 2 },
        },
      },
    },
  };
  const advanced = advanceSettlementUpgrades(stateWithDupUpgrade);
  assert.equal(
    advanced.settlements.s0.districts?.["3,2"].buildings[0].level,
    2,
    "advanceSettlementUpgrades increments district building only once",
  );
});

test("produceSettlementResources and settlementProductionRates credit completed, unblocked market goldPerTurn (+40 * level)", () => {
  const sMarket: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      gold: 100,
      buildings: [
        makeBuilding("market", 0, 0, 2), // +80 gold/turn
        makeBuilding("market", 1, 0, 1, { construction: { daysRemaining: 1 } }), // in construction -> 0
      ],
    }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [
          makeBuilding("market", 0, 0, 3), // +120 gold/turn when unblocked
          makeBuilding("market", 1, 0, 2, { construction: { daysRemaining: 2 } }), // in construction -> 0
        ],
      },
    },
  };

  const unblockedRates = settlementProductionRates(sMarket, 1, []);
  assert.equal(unblockedRates.goldPerTurn, 80 + 120);
  const unblockedProduced = produceSettlementResources({ s0: sMarket }, 1, []).s0;
  assert.equal(unblockedProduced.gold, 100 + 80 + 120);

  const enemyHero = makeHero("hEnemy", 1, 3, 2);
  const blockedRates = settlementProductionRates(sMarket, 1, [enemyHero]);
  assert.equal(blockedRates.goldPerTurn, 80, "enemy hero on district hex blocks district market goldPerTurn");
  const blockedProduced = produceSettlementResources({ s0: sMarket }, 1, [enemyHero]).s0;
  assert.equal(blockedProduced.gold, 100 + 80);
});

test("pickGarrisonRecruitment preserves district on GarrisonRecruitment sources from districts", () => {
  const sDistrictBarracks: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      gold: 1000,
      buildings: [], // no recruit buildings in main settlement
    }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [makeBuilding("barracks", 1, 2, 1)],
      },
    },
  };
  const state = makeState({ heroes: [], settlements: [sDistrictBarracks] });
  const items = pickGarrisonRecruitment(state, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].settlementId, "s0");
  assert.equal(items[0].buildingKind, "barracks");
  assert.equal(items[0].gx, 1);
  assert.equal(items[0].gy, 2);
  assert.deepEqual(items[0].district, { q: 3, r: 2 });
});

test("buildCityScene scopes upgrade scaffolding constructionStages to the active district or main city", () => {
  const citySettings = {
    spriteVariant: "pixel" as const,
    parallaxEnabled: false,
    parallaxLayerCount: 3 as const,
    cityBgOffsetX: 0,
    cityBgOffsetY: 0,
  };
  const sharedBuildings = [makeBuilding("house", 0, 0, 1), makeBuilding("townHall", 2, 2, 1)];
  const distUpgrade: GameState["settlements"][string]["upgrade"] = {
    kind: "buildings",
    targetLevel: 2,
    daysRemaining: 2,
    buildingRefs: [{ gx: 0, gy: 0, kind: "house", district: { q: 3, r: 2 } }],
    district: { q: 3, r: 2 },
  };

  // Main city view (district: null) does NOT show constructionStage for a district upgrade at (0, 0)
  const mainNodes = buildCityScene({
    viewportW: 800,
    viewportH: 600,
    settlementName: "Oakkeep",
    size: 5,
    hover: null,
    citySpots: [],
    cityMines: [],
    buildings: sharedBuildings,
    upgrades: distUpgrade,
    district: null,
    citySettings,
  });
  const mainHouse = mainNodes.find(
    (n): n is CityBuildingNode => n.kind === "cityBuilding" && n.buildingKind === "house",
  );
  assert.ok(mainHouse);
  assert.equal(mainHouse.constructionStage, undefined, "district upgrade does not bleed onto main city building");

  // Matching district (3, 2) DOES show constructionStage
  const distNodes = buildCityScene({
    viewportW: 800,
    viewportH: 600,
    settlementName: "Oakkeep — District (3, 2)",
    size: 5,
    hover: null,
    citySpots: [],
    cityMines: [],
    buildings: [makeBuilding("house", 0, 0, 1)],
    upgrades: distUpgrade,
    district: { q: 3, r: 2 },
    citySettings,
  });
  const distHouse = distNodes.find(
    (n): n is CityBuildingNode => n.kind === "cityBuilding" && n.buildingKind === "house",
  );
  assert.ok(distHouse);
  assert.ok(distHouse.constructionStage !== undefined, "matching district shows upgrade constructionStage");

  // Different district (4, 2) does NOT show constructionStage
  const otherDistNodes = buildCityScene({
    viewportW: 800,
    viewportH: 600,
    settlementName: "Oakkeep — District (4, 2)",
    size: 5,
    hover: null,
    citySpots: [],
    cityMines: [],
    buildings: [makeBuilding("house", 0, 0, 1)],
    upgrades: distUpgrade,
    district: { q: 4, r: 2 },
    citySettings,
  });
  const otherDistHouse = otherDistNodes.find(
    (n): n is CityBuildingNode => n.kind === "cityBuilding" && n.buildingKind === "house",
  );
  assert.ok(otherDistHouse);
  assert.equal(otherDistHouse.constructionStage, undefined, "other district does not show upgrade constructionStage");
});

// ── Regression guards for the post-merge review findings ─────────────────────

test("advanceSettlementUpgrades: a townHall upgrade levels DISTRICT buildings with the main city's", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, { level: 1, population: 500, goldTax: 1 }),
    buildings: [makeBuilding("townHall", 2, 2, 1), makeBuilding("house", 4, 0, 1)],
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [makeBuilding("woodcutterHut", 0, 0, 1), makeBuilding("house", 1, 1, 2)],
      },
    },
    upgrade: { kind: "townHall", targetLevel: 3, daysRemaining: 1 },
  };

  const next = advanceSettlementUpgrades(makeState({ settlements: [settlement] }));
  const s = next.settlements.s0;
  assert.equal(s.upgrade, undefined, "townHall upgrade clears on completion");
  assert.equal(s.buildings.find((b) => b.kind === "townHall")!.level, 3);
  assert.equal(s.buildings.find((b) => b.kind === "house")!.level, 3);

  const district = s.districts?.["3,2"];
  assert.ok(district, "district survives the town hall upgrade");
  assert.equal(
    district.buildings.find((b) => b.kind === "woodcutterHut")!.level,
    3,
    "district building levels up with the town hall (finding: it used to stay at L1)",
  );
  assert.equal(district.buildings.find((b) => b.kind === "house")!.level, 3);
  assert.deepEqual(
    district.citySpots,
    [],
    "levelling district buildings must not disturb the district's own spot set",
  );
});

test("settlementIncome / effectiveSettlementIncome skip under-construction buildings, matching the End Turn payment", () => {
  const bare = makeSettlement("s0", 0, 2, 2, { population: 0, goldTax: 0 });
  const completedMarket: SettlementState = { ...bare, buildings: [makeBuilding("market", 1, 1, 1)] };
  const buildingMarket: SettlementState = {
    ...bare,
    buildings: [makeBuilding("market", 1, 1, 1, { construction: { daysRemaining: 2 } })],
  };

  assert.equal(settlementIncome(completedMarket), 40, "completed market projects 40g");
  assert.equal(
    settlementIncome(buildingMarket),
    0,
    "an under-construction market must not be advertised in the HUD projection",
  );
  assert.equal(effectiveSettlementIncome(completedMarket), 40);
  assert.equal(effectiveSettlementIncome(buildingMarket), 0);

  // ...and the projection is exactly what End Turn pays.
  const paidCompleted = produceSettlementResources({ s0: completedMarket }, 777).s0.gold - completedMarket.gold;
  const paidBuilding = produceSettlementResources({ s0: buildingMarket }, 777).s0.gold - buildingMarket.gold;
  assert.equal(paidCompleted, 40, "projection and payment agree for a completed market");
  assert.equal(paidBuilding, 0, "projection and payment agree for a building market");
});

test("buildAdventureScene: a fog-hidden enemy hero does not flip a district's blocked flag", () => {
  const map = makeGrassMap(6, 6);
  const castle = Castle.fromGameState({
    ...makeSettlement("s0", 0, 2, 2, { level: 2, population: 500, goldTax: 1 }),
    districts: {
      "3,2": { q: 3, r: 2, citySpots: [], buildings: [makeBuilding("house", 0, 0)] },
    },
  });
  const enemyHero = new Hero("hEnemy", "Enemy", 3, 2, "enemy", 1);

  // The hex is NOT in the visibility set, but the district still renders because
  // the view owns the castle -- an enemy standing there is invisible and must
  // not be revealed through the marker.
  const hidden = buildAdventureScene({
    map,
    heroes: [enemyHero],
    castles: [castle],
    path: [],
    hover: null,
    visible: new Set<string>(),
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });
  const hiddenDistrict = hidden.find((n): n is DistrictNode => n.kind === "district");
  assert.ok(hiddenDistrict, "an own-castle district renders even when its hex is not in the visibility set");
  assert.equal(hiddenDistrict.blocked, undefined, "a fog-hidden enemy must not flip the blocked flag");

  // Once the hex is genuinely visible, the same hero DOES report the block.
  const seen = buildAdventureScene({
    map,
    heroes: [enemyHero],
    castles: [castle],
    path: [],
    hover: null,
    visible: new Set(["3,2"]),
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });
  const seenDistrict = seen.find((n): n is DistrictNode => n.kind === "district");
  assert.equal(seenDistrict?.blocked, true, "a visible enemy on the district hex reports blocked");
});

test("describeTile: territory is gated on the VIEWER's seat, not state.activePlayerId", () => {
  const rows: TileRow[] = [];
  for (let r = 0; r < 6; r++) {
    for (let q = 0; q < 6; q++) rows.push({ q, r, terrain: "grass", resource: null });
  }
  const map = GameMap.fromTiles(rows);

  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, { level: 1, population: 500, goldTax: 1 }),
    name: "Oakkeep",
  };
  const castle = Castle.fromGameState(settlement);
  // Seat 0 holds the turn; the viewer is seat 1. No heroes, so the only
  // visibility in play is the owned-castle ring.
  const state = makeState({ settlements: [settlement], heroes: [], activePlayerId: 0 });

  const opponentView = describeTile({
    map, state, heroes: [], castles: [castle], viewPlayerId: 1, tile: { q: 3, r: 2 },
  });
  assert.ok(opponentView);
  assert.equal(opponentView.fogged, true, "seat 1 cannot see seat 0's territory");
  assert.equal(
    opponentView.territory,
    null,
    "a fogged hex owned by the ACTIVE player must not be labelled to a different viewer",
  );

  // The owner sees the same hex (castle vision ring) and DOES get the label.
  const ownerView = describeTile({
    map, state, heroes: [], castles: [castle], viewPlayerId: 0, tile: { q: 3, r: 2 },
  });
  assert.ok(ownerView);
  assert.equal(ownerView.fogged, false);
  assert.deepEqual(ownerView.territory, { settlementName: "Oakkeep", ownerName: "Player 1" });
});

test("buildCityScene: a district city view is labelled as a district, not a settlement tier", () => {
  const citySettings = {
    spriteVariant: "pixel" as const,
    parallaxEnabled: false,
    parallaxLayerCount: 3 as const,
    cityBgOffsetX: 0,
    cityBgOffsetY: 0,
  };
  const labelFor = (district: { q: number; r: number } | null): string | undefined => {
    const nodes = buildCityScene({
      viewportW: 800,
      viewportH: 600,
      settlementName: district ? "Oakkeep — District (3, 2)" : "Oakkeep",
      size: 5,
      hover: null,
      citySpots: [],
      cityMines: [],
      buildings: [makeBuilding("house", 0, 0, 1)],
      district,
      citySettings,
    });
    return nodes.find((n): n is CityLabelNode => n.kind === "cityLabel" && n.fontPx === 11)?.text;
  };

  assert.equal(labelFor(null), "5×5 Settlement", "the main settlement keeps its tier label");
  assert.equal(
    labelFor({ q: 3, r: 2 }),
    "District (5×5 grid)",
    "a district must not be presented as a settlement tier",
  );
});
