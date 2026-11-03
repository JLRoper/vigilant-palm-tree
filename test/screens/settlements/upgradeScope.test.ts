import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, DistrictState } from "@heroes/contracts";
import { buildingUpkeep } from "@heroes/engine";
import { townHallUpgradeScope, townHallUpgradeScopeLine, upkeepAmountText } from "../../../src/screens/settlements/cityView/upgradeScope";

// E3 (playthrough round 2b): a town-hall upgrade levels the whole city, and the
// offer stated only its own one-off cost. The fixtures below are the starter
// city the card measured (town hall 3 wood + 2 stone a day, four 1-wood
// buildings, a 2-wood stone mine), plus one district building, whose upkeep the
// upgrade also raises (advance.ts maps the level-up over districts).

function building(kind: BuildingDef["kind"], level = 1, gx = 0, gy = 0): BuildingDef {
  return { gx, gy, kind, level, style: "classic" };
}

const CITY: BuildingDef[] = [
  building("townHall", 1, 2, 2),
  building("house", 1, 0, 0),
  building("house", 1, 1, 0),
  building("woodcutterHut", 1, 3, 0),
  building("woodcutterHut", 1, 4, 0),
  building("stoneMine", 1, 0, 4),
  building("farmhouse", 1, 1, 4),
];
const DISTRICT: Record<string, DistrictState> = {
  "20,12": { q: 20, r: 12, buildings: [building("farmField", 1, 0, 0), building("house", 1, 2, 0)], citySpots: [] } as unknown as DistrictState,
};

test("the scope counts every building the click raises, districts included", () => {
  const scope = townHallUpgradeScope({ buildings: CITY, districts: DISTRICT }, 2);
  assert.equal(scope.buildings, 9, "7 in the city + 2 in the district");
});

test("the scope's bill is the engine's own upkeep, before and after the upgrade", () => {
  const scope = townHallUpgradeScope({ buildings: CITY, districts: DISTRICT }, 2);

  // Hand-checked against buildingUpkeep at both levels (the fixture's premise).
  assert.deepEqual(buildingUpkeep("townHall", 1), { wood: 3, stone: 2 });
  assert.deepEqual(buildingUpkeep("townHall", 2), { wood: 6, stone: 4 });
  assert.deepEqual(buildingUpkeep("house", 2), { wood: 2, stone: 0 });
  // city: town hall 3 + 2 houses 1 + 2 huts 1 + stone mine 2 + farmhouse 1;
  // district: 1 house. Stone: the town hall's 2.
  assert.deepEqual(scope.upkeepNow, { wood: 11, stone: 2 });
  // every building at L2: town hall 6/4, 3 houses 2, 2 huts 2, stone mine 4,
  // farmhouse 2 (the 2 farm fields pay nothing at any level).
  assert.deepEqual(scope.upkeepAfter, { wood: 22, stone: 4 }, "the card's own measured 10 -> 22 wood");
});

test("a building already past the target level is never billed DOWN by the statement", () => {
  // advance.ts uses Math.max(building.level, targetLevel), and the sentence has
  // to describe that rule rather than a level reset.
  const mixed = { buildings: [building("townHall", 1, 2, 2), building("granary", 3, 0, 0)], districts: undefined };
  const scope = townHallUpgradeScope(mixed, 2);
  assert.deepEqual(scope.upkeepAfter, { wood: 9, stone: 4 }, "townHall 6/4 at L2 + the L3 granary's own 3 wood");
});

test("the line names the level, the count, and both bills", () => {
  const scope = townHallUpgradeScope({ buildings: CITY, districts: DISTRICT }, 2);
  assert.equal(
    townHallUpgradeScopeLine(scope, 2),
    "Levels the WHOLE city to L2 \u2014 all 9 buildings, districts included \u2014 and the city's daily upkeep rises from 11 wood + 2 stone to 22 wood + 4 stone.",
  );
});

test("an upgrade that costs no upkeep says so instead of pretending it rises", () => {
  const farmsOnly = { buildings: [building("farmField", 1, 0, 0), building("farmField", 1, 2, 0)], districts: undefined };
  const scope = townHallUpgradeScope(farmsOnly, 2);
  assert.equal(scope.upkeepNow.wood + scope.upkeepAfter.wood, 0);
  assert.match(townHallUpgradeScopeLine(scope, 2), /the city's daily upkeep stays at nothing\.$/);
  assert.equal(upkeepAmountText({ wood: 0, stone: 4 }), "4 stone");
  assert.equal(upkeepAmountText({ wood: 10, stone: 2 }), "10 wood + 2 stone");
  assert.equal(upkeepAmountText({ wood: 0, stone: 0 }), "nothing");
});
