import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, BuildingKind, FactionId, Platoon } from "@heroes/contracts";
import {
  GameMap,
  type UnitType,
  applyPlaceBuildings,
  buildInitialGameState,
  buildStarterLayout,
  constructionWorkerUnitId,
  makeInitialStatePayload,
  mulberry32,
  eligibleRecruitSources,
  pickGarrisonRecruitment,
  recruitUnits,
  starterCityOnOpen,
} from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";

function workerStacks(factionId: FactionId): Platoon[] {
  return [{ entries: [{ unitTypeId: constructionWorkerUnitId(factionId), count: 1 }] }];
}

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

function placementFixture(factionId?: FactionId, buildings: BuildingDef[] = [], stacks?: Platoon[]) {
  const settlement = {
    ...makeSettlement("s0", 0, 2, 2, {
      gold: 10000,
      warehouse: { wood: 100, stone: 100, iron: 100, arcane: 100, food: 100 },
      buildings,
    }),
    ...(stacks ? { stacks } : {}),
  };
  const state = makeState({ settlements: [settlement] });
  state.players = state.players.map((player) => player.id === 0 ? { ...player, factionId } : player);
  return state;
}

// Construction-worker-gated faction-building feature (section 4): the pure
// seat-vs-building-tag check ("wrong_faction") is gone. Placing a NEW
// building tagged faction F now needs an F Construction Worker currently in
// the settlement's garrison -- independent of the settlement OWNER's own
// seat faction. No worker of the right faction present = rejected with
// "missing_construction_worker", for ANY seat (including the settlement's
// own faction, and including the "legacy"/undefined-factionId case that
// used to dormant-pass every check unconditionally). Untagged (shared)
// kinds are still always allowed, worker or not.
for (const district of [undefined, { q: 3, r: 2, citySpots: [] }]) {
  test(`foreign-tagged placements fail without the matching worker in ${district ? "district" : "main city"}, regardless of the owner's own faction`, () => {
    const foreign: BuildingDef = { gx: 2, gy: 2, kind: "farmhouse", level: 1 };
    for (const ownerFactionId of ["ashen", undefined] as const) {
      const state = placementFixture(ownerFactionId);
      const rejected = applyPlaceBuildings(state, "s0", 0, [foreign], false, district);
      assert.equal(rejected.ok, false, `owner faction ${ownerFactionId ?? "legacy"}`);
      assert.equal(rejected.reason, "missing_construction_worker");
      assert.equal(rejected.state, state);
    }
  });

  test(`untagged kinds succeed in ${district ? "district" : "main city"} with no worker present at all`, () => {
    const state = placementFixture("ashen");
    const shared = applyPlaceBuildings(state, "s0", 0, [{ gx: 2, gy: 2, kind: "house", level: 1 }], false, district);
    assert.equal(shared.ok, true);
  });

  test(`a human Construction Worker lets ANY seat place the human-tagged farmhouse in ${district ? "district" : "main city"}`, () => {
    // The gate reads the WORKER's faction, not the seat's -- an ashen-seat
    // settlement that happens to hold a human worker (e.g. walked in by a
    // hero) can build the human-tagged farmhouse too.
    const foreign: BuildingDef = { gx: 2, gy: 2, kind: "farmhouse", level: 1 };
    const state = placementFixture("ashen", [], workerStacks("human"));
    const placed = applyPlaceBuildings(state, "s0", 0, [foreign], false, district);
    assert.equal(placed.ok, true);
  });
}

test("foreign saved buildings can remain when adding a shared building", () => {
  const foreign: BuildingDef = { gx: 0, gy: 0, kind: "farmhouse", level: 1 };
  const state = placementFixture("ashen", [foreign]);
  const placed = applyPlaceBuildings(state, "s0", 0, [foreign, { gx: 2, gy: 2, kind: "house", level: 1 }]);
  assert.equal(placed.ok, true);
  assert.equal(placed.state.settlements.s0.buildings[0].kind, "farmhouse");
});

test("the per-turn construction cap blocks a second PlaceBuildings commit on the same settlement", () => {
  const state = placementFixture("human", [], workerStacks("human"));
  const first = applyPlaceBuildings(state, "s0", 0, [{ gx: 2, gy: 2, kind: "house", level: 1 }]);
  assert.equal(first.ok, true);
  assert.equal(first.state.settlements.s0.constructionActionUsedThisTurn, true);
  const second = applyPlaceBuildings(first.state, "s0", 0, [
    { gx: 2, gy: 2, kind: "house", level: 1 },
    { gx: 3, gy: 2, kind: "house", level: 1 },
  ]);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "construction_action_already_used_this_turn");
});

test("the free starter-layout commit is exempt from both the construction-worker gate and the per-turn cap, and seeds its own worker", () => {
  const state = placementFixture("ashen");
  const layout = buildStarterLayout({ size: 5, style: "classic", factionId: "ashen" });
  const committed = applyPlaceBuildings(state, "s0", 0, layout, true);
  assert.equal(committed.ok, true, "the free commit is not gated by a worker that does not exist yet");
  assert.equal(committed.state.settlements.s0.constructionActionUsedThisTurn, undefined, "free commits do not consume the cap");
  const stacks = committed.state.settlements.s0.stacks ?? [];
  const hasWorker = stacks.some((p) => p.entries.some((e) => e.unitTypeId === "construction_worker_ashen" && e.count > 0));
  assert.ok(hasWorker, "the free commit seeds one Construction Worker of the settlement's own founding faction");
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
    // eligibleRecruitSources takes no faction opts any more (section 2): the
    // starter troop building's level-1 offerings are its starter levy PLUS
    // its own faction's Construction Worker recruit entry (section 3).
    const sources = eligibleRecruitSources(state.settlements.s0);
    assert.deepEqual(
      sources.map((source) => source.entry.unitTypeId).sort(),
      [unitTypeId, constructionWorkerUnitId(factionId)].sort(),
    );
    const source = sources.find((s) => s.entry.unitTypeId === unitTypeId);
    assert.ok(source);
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

test("AI can now also recruit the owned foreign-tagged farmhouse's peasant, in addition to its own crypt's ghoul", () => {
  // Building-ownership-only gating (section 2): the AI planner's own
  // seat-faction plumbing into eligibleRecruitSources is deleted, so an
  // ashen seat that happens to OWN a human-tagged farmhouse (a saved
  // foreign building, same fixture as the placement tests above) can now
  // recruit its peasant too -- not just its own crypt's ghoul.
  const state = placementFixture("ashen", [
    { gx: 0, gy: 0, kind: "farmhouse", level: 1 },
    { gx: 1, gy: 0, kind: "crypt", level: 1 },
  ]);
  state.heroes = {};
  const purchased = pickGarrisonRecruitment(state, 0, unitTypes).map((purchase) => purchase.unitTypeId);
  assert.ok(purchased.length > 0, "the AI still buys something toward its garrison floor");
  for (const id of purchased) {
    assert.ok(
      id === "peasant" || id === "ghoul",
      `${id}: a tiny garrison-floor deficit should be filled by a cheap combat unit, not the 650g Construction Worker`,
    );
  }
});
