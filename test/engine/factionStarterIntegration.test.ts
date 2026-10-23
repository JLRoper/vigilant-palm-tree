import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, BuildingKind, FactionId } from "@heroes/contracts";
import {
  GameMap,
  type UnitType,
  applyPlaceBuildings,
  buildInitialGameState,
  buildStarterLayout,
  makeInitialStatePayload,
  mulberry32,
  eligibleRecruitSources,
  pickGarrisonRecruitment,
  recruitUnits,
  starterCityOnOpen,
} from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";

const STARTERS: Record<FactionId, BuildingKind> = {
  human: "farmhouse",
  ashen: "crypt",
  ironmark: "delversHall",
  verdant: "seedlingGrove",
  neutral: "farmhouse",
};

for (const factionId of [...Object.keys(STARTERS), undefined] as (FactionId | undefined)[]) {
  test(`starter layout and empty city opening select ${factionId ?? "legacy"} starter`, () => {
    const expected = factionId === undefined ? "farmhouse" : STARTERS[factionId];
    const layout = buildStarterLayout({ size: 5, style: "classic", factionId });
    assert.equal(layout.at(-1)?.kind, expected);
    const opened = starterCityOnOpen({ size: 5, style: "classic", factionId, existing: [] });
    assert.equal(opened.free, true);
    assert.deepEqual(opened.buildings, layout);
  });
}

for (const build of [buildInitialGameState, makeInitialStatePayload]) {
  test(`${build.name} selects every owner's faction starter`, () => {
    const seatFactions: FactionId[] = ["human", "ashen", "ironmark", "verdant"];
    const state = build(new GameMap(7, "small"), mulberry32(42), {
      enemyCount: 3,
      humanSeatCount: 1,
      seatFactions,
    });
    for (const player of state.players) {
      const owned = Object.values(state.settlements).filter((settlement) => settlement.ownerId === player.id);
      assert.ok(owned.length > 0, `seat ${player.id} owns a settlement`);
      for (const settlement of owned) {
        assert.ok(settlement.buildings.some((building) => building.kind === STARTERS[seatFactions[player.id]]));
      }
    }
  });
}

test("opening a saved foreign farmhouse preserves the original buildings", () => {
  const existing: BuildingDef[] = [{ gx: 1, gy: 1, kind: "farmhouse", level: 2, workers: 1, draft: { peasant: 1 } }];
  const opened = starterCityOnOpen({ size: 5, style: "classic", factionId: "ashen", existing });
  assert.equal(opened.free, false);
  assert.equal(opened.buildings, existing);
});

function placementFixture(factionId?: FactionId, buildings: BuildingDef[] = []) {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 10000,
    warehouse: { wood: 100, stone: 100, iron: 100, arcane: 100, food: 100 },
    buildings,
  });
  const state = makeState({ settlements: [settlement] });
  state.players = state.players.map((player) => player.id === 0 ? { ...player, factionId } : player);
  return state;
}

for (const district of [undefined, { q: 3, r: 2, citySpots: [] }]) {
  test(`foreign placements fail in ${district ? "district" : "main city"} while shared kinds succeed`, () => {
    const state = placementFixture("ashen");
    const foreign: BuildingDef = { gx: 2, gy: 2, kind: "farmhouse", level: 1 };
    const rejected = applyPlaceBuildings(state, "s0", 0, [foreign], false, district);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "wrong_faction");
    assert.equal(rejected.state, state);
    const shared = applyPlaceBuildings(state, "s0", 0, [{ ...foreign, kind: "house" }], false, district);
    assert.equal(shared.ok, true);
    const legacy = applyPlaceBuildings(placementFixture(), "s0", 0, [foreign], false, district);
    assert.equal(legacy.ok, true);
  });
}

test("foreign saved buildings can remain when adding a shared building", () => {
  const foreign: BuildingDef = { gx: 0, gy: 0, kind: "farmhouse", level: 1 };
  const state = placementFixture("ashen", [foreign]);
  const placed = applyPlaceBuildings(state, "s0", 0, [foreign, { gx: 2, gy: 2, kind: "house", level: 1 }]);
  assert.equal(placed.ok, true);
  assert.equal(placed.state.settlements.s0.buildings[0].kind, "farmhouse");
});


const starterUnits: Record<Exclude<FactionId, "neutral">, string> = {
  human: "peasant", ashen: "ghoul", ironmark: "tunnel_levy", verdant: "sproutling",
};
const unitTypes: Record<string, UnitType> = Object.fromEntries(
  Object.entries(starterUnits).map(([factionId, id]) => [id, {
    id, name: id, attack: 1, defence: 1, health: 4, speed: 4, description: "",
    advantageType: "infantry", specialty: "militia", specialtyPriority: 1, factionId,
  } as UnitType]),
);

for (const factionId of Object.keys(starterUnits) as (keyof typeof starterUnits)[]) {
  test(`${factionId} can recruit its starter levy and AI plans a legal purchase`, () => {
    const layout = buildStarterLayout({ size: 5, style: "classic", factionId });
    const emptyState = placementFixture(factionId);
    const committed = applyPlaceBuildings(emptyState, "s0", 0, layout, true);
    assert.equal(committed.ok, true);
    assert.equal(committed.state.settlements.s0.gold, emptyState.settlements.s0.gold);
    const state = committed.state;
    state.heroes = {};
    const unitTypeId = starterUnits[factionId];
    const sources = eligibleRecruitSources(state.settlements.s0, { unitTypes, seatFactionId: factionId });
    assert.deepEqual(sources.map((source) => source.entry.unitTypeId), [unitTypeId]);
    const source = sources[0];
    const recruited = recruitUnits(state, {
      settlementId: "s0", buildingKind: source.buildingKind,
      gx: source.gx, gy: source.gy, unitTypeId, count: 1,
    });
    assert.equal(recruited.ok, true);
    const purchases = pickGarrisonRecruitment(state, 0, unitTypes);
    assert.ok(purchases.length > 0);
    assert.equal(purchases[0].unitTypeId, unitTypeId);
  });
}

test("AI excludes a saved foreign farmhouse and still recruits from its faction starter", () => {
  const state = placementFixture("ashen", [
    { gx: 0, gy: 0, kind: "farmhouse", level: 1 },
    { gx: 1, gy: 0, kind: "crypt", level: 1 },
  ]);
  state.heroes = {};
  assert.deepEqual(pickGarrisonRecruitment(state, 0, unitTypes).map((purchase) => purchase.unitTypeId), ["ghoul"]);
});
