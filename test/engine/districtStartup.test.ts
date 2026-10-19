import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, DistrictState, GameState, SettlementState, Terrain, UnitType } from "@heroes/contracts";
import {
  DISTRICT_BUILDING_POOL,
  GameMap,
  applyPlaceBuildings,
  buildInitialGameState,
  buildingUpkeepRequired,
  connectedDistrictKeys,
  disconnectedDistrictKeys,
  districtConnectionReason,
  districtTerrainProblem,
  isForbiddenDistrictTerrain,
  districtKey,
  getOrCreateGameMap,
  isWaterDistrict,
  makeInitialStatePayload,
  mulberry32,
  resolveSavedMapGenVersion,
  seedStartupDistricts,
  settlementProductionRates,
  startupDistrictCount,
  type TileRow,
} from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import { buildEntryStatus, districtTerrainBlock } from "../../src/screens/settlements/cityView/buildEntryStatus";
import { BUILDABLE_KINDS } from "../../src/screens/settlements/cityView/buildListSections";
import { emptyWarehouse, makePlayer, makeSettlement, makeState } from "../charter/_helpers";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";

function makeBuilding(
  kind: BuildingDef["kind"],
  gx: number,
  gy: number,
  level = 1,
  overrides: Partial<BuildingDef> = {},
): BuildingDef {
  return { gx, gy, kind, level, style: "pixel", ...overrides };
}

/** A map of `width` x `height` grass with explicit terrain/resource overrides. */
function makeMap(
  width: number,
  height: number,
  overrides: Array<{ q: number; r: number; terrain?: Terrain; resource?: TileRow["resource"] }> = [],
): GameMap {
  const byKey = new Map(overrides.map((o) => [`${o.q},${o.r}`, o]));
  const rows: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      const o = byKey.get(`${q},${r}`);
      rows.push({ q, r, terrain: o?.terrain ?? "grass", resource: o?.resource ?? null });
    }
  }
  return GameMap.fromTiles(rows);
}

function makeDistrict(q: number, r: number, buildings: BuildingDef[]): DistrictState {
  return { q, r, citySpots: [], buildings };
}

// ── 1. How many districts a tier starts with ─────────────────────────────────

test("startupDistrictCount: none for a settlement, one for a town, two for a castle", () => {
  assert.equal(startupDistrictCount(1), 0);
  assert.equal(startupDistrictCount(2), 1);
  assert.equal(startupDistrictCount(3), 2);
});

// ── 2. Game-start seeding ────────────────────────────────────────────────────

const STARTER_CATALOG: Record<string, UnitType> = {
  peasant: { id: "peasant", name: "peasant", attack: 1, defence: 1, health: 1, speed: 1, description: "", advantageType: "infantry", specialty: "", specialtyPriority: 0, upkeepGold: 1, upkeepFood: 1, tier: 1 } as UnitType,
};

function startGame(opts: { castleSeed?: number; enemyCount?: number } = {}) {
  const seed = opts.castleSeed ?? 424242;
  return buildInitialGameState(new GameMap(seed, "small"), mulberry32(seed), {
    castleSeed: seed,
    enemyCount: opts.enemyCount ?? 0,
    humanSeatCount: 1,
    unitTypes: STARTER_CATALOG,
  });
}

test("game start: tier 1 gets no districts, tier 2 gets one, tier 3 gets two", () => {
  const state = startGame();
  const settlements = Object.values(state.settlements);
  assert.ok(settlements.some((s) => s.level === 1), "fixture has a level-1 settlement");
  assert.ok(settlements.some((s) => s.level === 2), "fixture has a level-2 settlement");
  assert.ok(settlements.some((s) => s.level === 3), "fixture has a level-3 settlement");

  for (const s of settlements) {
    const districts = Object.values(s.districts ?? {});
    assert.equal(
      districts.length,
      startupDistrictCount(s.level),
      `${s.id} (level ${s.level}) seeded the wrong district count`,
    );
    if (s.level === 1) {
      assert.equal("districts" in s, false, "a tier-1 settlement carries no districts key at all");
    }
  }
});

test("game start: every seeded district is legal -- a couple of buildings, no town hall, non-overlapping, in a 5x5 grid", () => {
  const state = startGame();
  let checked = 0;
  for (const s of Object.values(state.settlements)) {
    for (const district of Object.values(s.districts ?? {})) {
      checked++;
      assert.ok(
        district.buildings.length >= 2 && district.buildings.length <= 3,
        `${s.id} district (${district.q},${district.r}) holds ${district.buildings.length} buildings, want 2-3`,
      );
      assert.equal(district.citySpots.length, 3, "a district gets the standard 3-spot set");
      const occupied = new Set<string>();
      for (const b of district.buildings) {
        assert.equal(b.level, 1, "seeded district buildings are level 1");
        assert.notEqual(b.kind, "townHall", "a town hall can only stand in the main settlement");
        assert.ok(
          DISTRICT_BUILDING_POOL.includes(b.kind),
          `${b.kind} is not a district-pool kind`,
        );
        assert.ok(b.gx >= 0 && b.gy >= 0 && b.gx < 5 && b.gy < 5, "inside the 5x5 grid");
        assert.ok(!occupied.has(`${b.gx},${b.gy}`), "no two district buildings share a cell");
        occupied.add(`${b.gx},${b.gy}`);
      }
    }
  }
  assert.ok(checked > 0, "the fixture actually seeded districts to check");
});

test("game start: seeded districts are connected (no floating districts) and never sit on another settlement", () => {
  const state = startGame();
  const centers = new Set(Object.values(state.settlements).map((s) => districtKey(s.q, s.r)));
  for (const s of Object.values(state.settlements)) {
    assert.deepEqual(
      disconnectedDistrictKeys(s),
      [],
      `${s.id} starts with a floating district`,
    );
    for (const key of Object.keys(s.districts ?? {})) {
      assert.ok(!centers.has(key), `${s.id} put a district on a settlement's own hex (${key})`);
    }
  }
});

test("game start: seeding is deterministic per castle seed, and the map's own generation is untouched", () => {
  const a = startGame();
  const b = startGame();
  for (const id of Object.keys(a.settlements)) {
    assert.deepEqual(a.settlements[id].districts, b.settlements[id].districts, `${id}: same seed, same districts`);
    assert.deepEqual(a.settlements[id].citySpots, b.settlements[id].citySpots, `${id}: spots unchanged`);
    assert.deepEqual(a.settlements[id].name, b.settlements[id].name, `${id}: names unchanged`);
    assert.deepEqual(a.settlements[id].castleVariant, b.settlements[id].castleVariant);
  }
  assert.deepEqual(
    Object.values(a.heroes).map((h) => h.horseVariant),
    Object.values(b.heroes).map((h) => h.horseVariant),
    "district seeding draws from its own stream, so hero horse variants do not shift",
  );

  // A different castle seed picks different hexes/buildings: this is generated,
  // not a fixed layout.
  const other = startGame({ castleSeed: 987654 });
  const sig = (s: typeof a) =>
    Object.values(s.settlements)
      .flatMap((x) => Object.values(x.districts ?? {}).map((d) => `${districtKey(d.q, d.r)}:${d.buildings.map((b) => b.kind).join(",")}`))
      .join("|");
  assert.notEqual(sig(a), sig(other));
});

test("makeInitialStatePayload -- the POST /games path -- seeds the same districts", () => {
  const seed = 424242;
  const payload = makeInitialStatePayload(new GameMap(seed, "small"), mulberry32(seed), {
    castleSeed: seed,
    enemyCount: 0,
    humanSeatCount: 1,
    unitTypes: STARTER_CATALOG,
  });
  const state = startGame();
  for (const id of Object.keys(payload.settlements)) {
    assert.deepEqual(
      payload.settlements[id].districts,
      state.settlements[id].districts,
      `${id}: both creation paths seed the same districts`,
    );
  }
});

test("seedStartupDistricts: degrades to no districts when the settlement has no legal neighbour", () => {
  // A settlement ringed by mountains has nowhere to put a district.
  const overrides = [
    { q: 3, r: 2, terrain: "mountain" as Terrain },
    { q: 3, r: 1, terrain: "mountain" as Terrain },
    { q: 2, r: 1, terrain: "mountain" as Terrain },
    { q: 1, r: 2, terrain: "mountain" as Terrain },
    { q: 1, r: 3, terrain: "mountain" as Terrain },
    { q: 2, r: 3, terrain: "mountain" as Terrain },
  ];
  const map = makeMap(6, 6, overrides);
  const districts = seedStartupDistricts(
    map,
    { id: "s0", q: 2, r: 2, level: 3 },
    { castleSeed: 1 },
  );
  assert.equal(districts, undefined, "no legal hex -> no districts, never a crash");
});

// ── 3. The connectivity rule ────────────────────────────────────────────────

test("districtConnectionReason: a district must touch the settlement or another district", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, { level: 3 }),
    districts: {
      "3,2": makeDistrict(3, 2, [makeBuilding("house", 0, 0)]),
    },
  };
  // Adjacent to the settlement's own hex.
  assert.equal(districtConnectionReason(settlement, 3, 1), null);
  // Adjacent to an existing district (the chain the rule is built on).
  assert.equal(districtConnectionReason(settlement, 4, 2), null);
  assert.equal(districtConnectionReason(settlement, 4, 1), null);
  // Nothing in between: a floating district, even inside the level-3 control range.
  assert.equal(districtConnectionReason(settlement, 4, 3), "district_not_connected");
  assert.equal(districtConnectionReason(settlement, 5, 2), "district_not_connected");

  // An EMPTY district is not a district: it cannot carry a chain.
  const withEmpty: SettlementState = {
    ...settlement,
    districts: { "3,2": makeDistrict(3, 2, []) },
  };
  assert.equal(districtConnectionReason(withEmpty, 4, 2), "district_not_connected");
});

test("connectedDistrictKeys / disconnectedDistrictKeys: chains count, and a water district bridges water", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, { level: 3 }),
    districts: {
      "2,3": makeDistrict(2, 3, [makeBuilding("house", 0, 0)]), // touches the settlement
      "3,3": makeDistrict(3, 3, [makeBuilding("shipyard", 0, 0)]), // the water bridge
      "4,3": makeDistrict(4, 3, [makeBuilding("house", 0, 0)]), // across the water
      "5,5": makeDistrict(5, 5, [makeBuilding("house", 0, 0)]), // floating
    },
  };
  assert.deepEqual([...connectedDistrictKeys(settlement)].sort(), ["2,3", "3,3", "4,3"]);
  assert.deepEqual(disconnectedDistrictKeys(settlement), ["5,5"]);
  assert.equal(isWaterDistrict(settlement.districts?.["3,3"]), true);
  assert.equal(isWaterDistrict(settlement.districts?.["2,3"]), false);

  // The same settlement without the shipyard in the water district: the far
  // district is cut off, because an unbridged strait separates them.
  const noBridge: SettlementState = {
    ...settlement,
    districts: {
      "2,3": makeDistrict(2, 3, [makeBuilding("house", 0, 0)]),
      "3,3": makeDistrict(3, 3, [makeBuilding("house", 0, 0)]),
      "4,3": makeDistrict(4, 3, [makeBuilding("house", 0, 0)]),
    },
  };
  assert.deepEqual(disconnectedDistrictKeys(noBridge), []);
  const brokenChain: SettlementState = {
    ...noBridge,
    districts: {
      "2,3": makeDistrict(2, 3, [makeBuilding("house", 0, 0)]),
      "4,3": makeDistrict(4, 3, [makeBuilding("house", 0, 0)]),
    },
  };
  assert.deepEqual(disconnectedDistrictKeys(brokenChain), ["4,3"]);
});

// ── 4. Terrain rules: water districts and the shipyard ──────────────────────

test("districtTerrainProblem: mountains and dense forest are never a district; water only as a shipyard district; a shipyard only on water", () => {
  const house = [makeBuilding("house", 0, 0)];
  const shipyard = [makeBuilding("shipyard", 0, 0)];
  const both = [...house, ...shipyard];

  assert.equal(districtTerrainProblem("grass", house), null);
  assert.equal(districtTerrainProblem("mountain", house), "impassable_district_terrain");
  assert.equal(districtTerrainProblem("mountain", shipyard), "impassable_district_terrain");
  assert.equal(districtTerrainProblem("denseForest", house), "impassable_district_terrain");
  assert.equal(districtTerrainProblem("denseForest", shipyard), "impassable_district_terrain");
  assert.equal(districtTerrainProblem("denseForest", []), "impassable_district_terrain");
  assert.equal(districtTerrainProblem("forest", house), null, "a normal forest hex stays buildable");

  // The city view's open gate uses this predicate, so it must agree with the
  // reducer's own verdict above.
  assert.equal(isForbiddenDistrictTerrain("denseForest"), true);
  assert.equal(isForbiddenDistrictTerrain("mountain"), true);
  assert.equal(isForbiddenDistrictTerrain("water"), false, "water is a district once it holds a shipyard");
  assert.equal(isForbiddenDistrictTerrain("forest"), false);
  assert.equal(isForbiddenDistrictTerrain(undefined), false);
  assert.equal(districtTerrainProblem("water", house), "impassable_district_terrain");
  assert.equal(districtTerrainProblem("water", []), "impassable_district_terrain");
  assert.equal(districtTerrainProblem("water", shipyard), null);
  assert.equal(districtTerrainProblem("water", both), null);
  assert.equal(districtTerrainProblem("grass", shipyard), "shipyard_requires_water");
  assert.equal(districtTerrainProblem(undefined, shipyard), null, "no map -> no terrain verdict");
});

test("the shipyard is a real registered building, buildable from the palette", () => {
  assert.ok(BUILDABLE_KINDS.includes("shipyard"), "the build palette offers the shipyard");
});

test("buildEntryStatus / districtTerrainBlock: a water district takes only a shipyard, and a shipyard only water", () => {
  assert.equal(districtTerrainBlock("water", "shipyard"), null);
  assert.equal(districtTerrainBlock("water", "house"), "Only a shipyard can be built on water");
  assert.equal(districtTerrainBlock("grass", "shipyard"), "Shipyard must be built on water");
  assert.equal(districtTerrainBlock("grass", "house"), null);
  assert.equal(districtTerrainBlock(null, "shipyard"), null, "the main settlement has no district terrain");

  const full = { gold: 5000, warehouse: { wood: 100, stone: 100, iron: 50, arcane: 50 } };
  const shipyardOnLand = buildEntryStatus({ kind: "shipyard", affordability: full, isDistrict: true, districtTerrain: "grass" });
  assert.equal(shipyardOnLand.disabled, true);
  assert.ok(shipyardOnLand.reasons.includes("Shipyard must be built on water"));

  const shipyardOnWater = buildEntryStatus({ kind: "shipyard", affordability: full, isDistrict: true, districtTerrain: "water" });
  assert.equal(shipyardOnWater.disabled, false);

  const houseOnWater = buildEntryStatus({ kind: "house", affordability: full, isDistrict: true, districtTerrain: "water" });
  assert.equal(houseOnWater.disabled, true);
  assert.ok(houseOnWater.reasons.includes("Only a shipyard can be built on water"));
});

// ── 5. The reducer refuses floating districts ───────────────────────────────

test("applyPlaceBuildings: a floating district is refused, and stranding an existing district is refused too", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      level: 3,
      gold: 5000,
      warehouse: emptyWarehouse({ wood: 200, stone: 200, iron: 100, arcane: 100 }),
    }),
    districts: {
      "2,3": makeDistrict(2, 3, [makeBuilding("house", 0, 0)]),
      "3,3": makeDistrict(3, 3, [makeBuilding("shipyard", 0, 0)]),
      "4,3": makeDistrict(4, 3, [makeBuilding("house", 0, 0)]),
    },
  };
  const state = makeState({ settlements: [settlement] });
  const spots = [{ cell: { x: 0, y: 0 }, resource: "gold" as const, vein: "rich" }];

  // (5, 4) touches neither the centre nor any district -> refused.
  const floating = applyPlaceBuildings(state, "s0", 0, [makeBuilding("house", 1, 1)], false, { q: 5, r: 4, citySpots: spots });
  assert.equal(floating.ok, false);
  assert.equal(floating.reason, "district_not_connected");

  // (3, 2) touches the settlement itself -> allowed.
  const touching = applyPlaceBuildings(state, "s0", 0, [makeBuilding("house", 1, 1)], false, { q: 3, r: 2, citySpots: spots });
  assert.equal(touching.ok, true);

  // Clearing the water district's shipyard would cut (4, 3) off -> refused.
  const stranded = applyPlaceBuildings(touching.state, "s0", 0, [], false, { q: 3, r: 3 });
  assert.equal(stranded.ok, false);
  assert.equal(stranded.reason, "district_not_connected");

  // ...but replacing it with nothing while ALSO clearing the far district is
  // fine: nothing is left floating.
  const both = applyPlaceBuildings(touching.state, "s0", 0, [], false, { q: 4, r: 3 });
  assert.equal(both.ok, true);
  const cleared = applyPlaceBuildings(both.state, "s0", 0, [], false, { q: 3, r: 3 });
  assert.equal(cleared.ok, true, "removing a bridge is fine once the far side is gone");
});

// ── 6. Server-side validation ───────────────────────────────────────────────

test("handleCommand: PlaceBuildings accepts a shipyard water district, rejects water without one, a land shipyard, and a floating hex", async () => {
  const seed = 1;
  // The handler rebuilds the map from the saved row, so scan THAT map: a plain
  // `new GameMap(seed, "small")` is a different generation than
  // getOrCreateGameMap's and its water is not where the server's water is.
  const map = getOrCreateGameMap(seed, "small", resolveSavedMapGenVersion(undefined));

  // A passable settlement hex with a water neighbour (the future harbour) and a
  // passable neighbour of its own (the land-shipyard probe).
  const dirs = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];
  let center: { q: number; r: number } | null = null;
  let waterNeighbour: { q: number; r: number } | null = null;
  let landNeighbour: { q: number; r: number } | null = null;
  for (let r = 3; r < map.height - 3 && !center; r++) {
    for (let q = 3; q < map.width - 3 && !center; q++) {
      if (map.get(q, r) !== "grass") continue;
      const neighbours = dirs.map((d) => ({ q: q + d.q, r: r + d.r }));
      const water = neighbours.find((n) => map.get(n.q, n.r) === "water");
      const land = neighbours.find((n) => {
        const t = map.get(n.q, n.r);
        return t !== undefined && t !== "water" && t !== "mountain";
      });
      if (!water || !land) continue;
      center = { q, r };
      waterNeighbour = water;
      landNeighbour = land;
    }
  }
  assert.ok(center && waterNeighbour && landNeighbour, "the small map has a coastal passable hex");

  const s0 = makeSettlement("s0", 0, center.q, center.r, {
    level: 3,
    gold: 9000,
    warehouse: emptyWarehouse({ wood: 200, stone: 200, iron: 100, arcane: 100 }),
    buildings: [makeBuilding("townHall", 2, 2, 1)],
  });
  const row = {
    name: "test-district-startup",
    seed,
    map_size: "small",
    round: 1,
    day: 1,
    active_player_id: 0,
    players: [makePlayer(0, "player", ["h0"], ["s0"])],
    heroes: {},
    settlements: { s0 },
  };
  const gameRepo = createMockGameRepo({ "test-district-startup": row });
  const deps = {
    gameRepo,
    eventRepo: createMockEventRepo(),
    heroRepo: createMockHeroRepo({ "test-district-startup": {} }),
    settlementRepo: createMockSettlementRepo({ "test-district-startup": { s0 } }),
    charterRepo: createMockCharterRepo(),
    ctx: { rng: () => 0.5, catalog: { unitTypes: [] } },
  };

  const place = (q: number, r: number, buildings: BuildingDef[]) =>
    handleCommand(
      { kind: "PlaceBuildings", gameName: "test-district-startup", actor: 0, settlementId: "s0", buildings, district: { q, r } },
      deps as Parameters<typeof handleCommand>[1],
    );

  // Water with no shipyard: still impassable.
  const waterHouse = await place(waterNeighbour.q, waterNeighbour.r, [makeBuilding("house", 0, 0)]);
  assert.equal(waterHouse.ok, false);
  assert.equal(waterHouse.reason, "impassable_district_terrain");

  // A shipyard on a land hex: refused.
  const landShipyard = await place(landNeighbour.q, landNeighbour.r, [makeBuilding("shipyard", 0, 0)]);
  assert.equal(landShipyard.ok, false);
  assert.equal(landShipyard.reason, "shipyard_requires_water");

  // A shipyard on the water hex: a real water district, and it is connected.
  const waterShipyard = await place(waterNeighbour.q, waterNeighbour.r, [makeBuilding("shipyard", 0, 0)]);
  assert.equal(waterShipyard.ok, true, waterShipyard.ok ? "" : `unexpected refusal: ${waterShipyard.reason}`);
  const saved = deps.settlementRepo.rows["test-district-startup"].s0;
  const waterKey = districtKey(waterNeighbour.q, waterNeighbour.r);
  assert.equal(saved.districts?.[waterKey]?.buildings[0].kind, "shipyard");

  // A hex that touches nothing: refused as floating.
  const far = { q: center.q + 3, r: center.r };
  const floating = await place(far.q, far.r, [makeBuilding("house", 0, 0)]);
  assert.ok(
    floating.ok === false && ["district_not_connected", "not_in_settlement_territory"].includes(floating.reason),
    `a hex three out is refused as unreachable (got ${floating.reason})`,
  );
});

test("a water district's shipyard participates in the settlement's pooled economy like any other district building", () => {
  const base = makeSettlement("s0", 0, 2, 2, { level: 2, gold: 100, buildings: [] });
  const withHarbour: SettlementState = {
    ...base,
    districts: { "3,2": makeDistrict(3, 2, [makeBuilding("shipyard", 0, 0)]) },
  };
  const state: GameState = makeState({ settlements: [withHarbour] });
  assert.deepEqual(disconnectedDistrictKeys(state.settlements.s0), []);
  // The shipyard's own settlement effect (goldPerTurn) reaches the settlement.
  assert.equal(settlementProductionRates(withHarbour, 1, []).goldPerTurn, 12);
  assert.deepEqual(buildingUpkeepRequired(withHarbour), { wood: 1, stone: 1 });
});
