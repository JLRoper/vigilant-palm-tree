import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingKind, FactionId } from "@heroes/contracts";
import {
  buildingAllowedForFaction,
  buildingUpgradeCost,
  getBuildingEffect,
} from "@heroes/engine";

const factionBuildings: Record<Exclude<FactionId, "neutral">, BuildingKind[]> = {
  human: ["farmhouse", "barracks", "archeryRange", "mageGuild", "stables", "huntingLodge", "eyrie"],
  ashen: ["crypt", "ossuary", "wraithBarrows", "spireOfAsh", "blackChapel", "dragonBoneyard"],
  ironmark: ["delversHall", "forgeHall", "gunnersRedoubt", "golemFoundry", "deepAnvil", "hearthTemple", "ramPens"],
  verdant: ["seedlingGrove", "groveSanctum", "warrenLodge", "sylvanStables", "worldrootGrove", "druidCircle"],
};

test("each faction has twelve distinct recruits and cannot build another faction's troop buildings", () => {
  for (const [faction, kinds] of Object.entries(factionBuildings)) {
    const recruits = kinds.flatMap((kind) => getBuildingEffect(kind).recruits.map((entry) => entry.unitTypeId));
    assert.equal(new Set(recruits).size, 12, faction);
    assert.equal(recruits.length, 12, faction);
    for (const kind of kinds) {
      assert.equal(getBuildingEffect(kind).faction, faction);
      assert.equal(buildingAllowedForFaction(kind), true);
      for (const candidate of [...Object.keys(factionBuildings), "neutral"] as FactionId[]) {
        assert.equal(buildingAllowedForFaction(kind, candidate), candidate === faction, `${kind}: ${candidate}`);
      }
    }
  }
});

test("shared economy and civic buildings stay available to every faction", () => {
  const shared: BuildingKind[] = ["townHall", "house", "tower", "mine", "stoneMine", "ironMine", "market", "smithy", "apartment", "farmField", "granary", "warehouse", "bank", "treasury", "goldMine", "woodcutterHut", "arcaneFont", "shipyard"];
  for (const kind of shared) {
    assert.equal(getBuildingEffect(kind).faction, undefined);
    for (const faction of [...Object.keys(factionBuildings), "neutral"] as FactionId[]) {
      assert.equal(buildingAllowedForFaction(kind, faction), true);
    }
  }
});

test("faction starters preserve farmhouse food, population, upkeep and draft economy", () => {
  const farmhouse = getBuildingEffect("farmhouse");
  for (const kind of ["crypt", "delversHall", "seedlingGrove"] as const) {
    const starter = getBuildingEffect(kind);
    assert.equal(starter.maxWorkers, farmhouse.maxWorkers);
    assert.equal(starter.buildDays, farmhouse.buildDays);
    assert.equal(starter.draftMax, farmhouse.draftMax);
    assert.equal(starter.draftPerDay, farmhouse.draftPerDay);
    assert.deepEqual(starter.upkeepPerLevel, farmhouse.upkeepPerLevel);
    assert.equal(starter.settlementEffects.foodPerTurn, farmhouse.settlementEffects.foodPerTurn);
    assert.equal(starter.settlementEffects.populationBonus, farmhouse.settlementEffects.populationBonus);
    assert.equal(starter.placementCost.wood, farmhouse.placementCost.wood);
  }
  assert.equal(getBuildingEffect("crypt").placementCost.gold, 150);
  assert.equal(getBuildingEffect("crypt").settlementEffects.defenseBonus, 1);
});

test("level-three recruit sources have an upgrade path and the intended unlocked unit", () => {
  const expected: Partial<Record<BuildingKind, string>> = {
    barracks: "crusader",
    crypt: "grave_hound",
    forgeHall: "axe_thrower",
    groveSanctum: "wildwood_ranger",
    warrenLodge: "ursine_guardian",
  };
  for (const [kind, unit] of Object.entries(expected) as [BuildingKind, string][]) {
    assert.ok(buildingUpgradeCost(kind, 1));
    assert.ok(buildingUpgradeCost(kind, 2));
    assert.equal(buildingUpgradeCost(kind, 3), null);
    assert.equal(getBuildingEffect(kind).recruits.find((entry) => entry.unitTypeId === unit)?.minLevel, 3);
  }
});
