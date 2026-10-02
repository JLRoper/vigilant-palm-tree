import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, UnitType } from "@heroes/contracts";
import {
  GameMap,
  MAX_PLAYERS,
  applyPlaceBuildings,
  buildInitialGameState,
  buildStarterLayout,
  buildingUpkeepRequired,
  createInitialState,
  demoPlatoonsForPlayer,
  foodRequired,
  foodRequiredForPopulation,
  foodRequiredForPopulations,
  heroFoodPerTurn,
  makeInitialStatePayload,
  mulberry32,
  producerBasePerTurn,
  STARTER_BASE_FARMS,
  STARTER_STONE_PRODUCER,
  STARTER_WOOD_PRODUCER,
  starterCityOnOpen,
  starterFarmsNeeded,
} from "@heroes/engine";
import { makeState } from "../charter/_helpers";

// The real catalog's upkeep columns, from server/migrations/021_upkeep_shortfall.sql:
// upkeep_gold = tier, upkeep_food = clamp(ceil(tier / 2), 1, 3).
function tierUnit(id: string, tier: number): UnitType {
  return {
    id,
    name: id,
    attack: 1,
    defence: 1,
    health: 1,
    speed: 1,
    description: "",
    advantageType: "infantry",
    specialty: "",
    specialtyPriority: 0,
    upkeepGold: tier,
    upkeepFood: Math.min(3, Math.max(1, Math.ceil(tier / 2))),
    tier,
  } as UnitType;
}

const STARTER_CATALOG: Record<string, UnitType> = {
  peasant: tierUnit("peasant", 1),
  swordsman: tierUnit("swordsman", 2),
  archer: tierUnit("archer", 4),
  cavalry: tierUnit("cavalry", 5),
  crossbowman: tierUnit("crossbowman", 4),
  griffin: tierUnit("griffin", 8),
};

function kindsOf(buildings: readonly BuildingDef[]): string[] {
  return buildings.map((b) => b.kind);
}

function build(opts?: Parameters<typeof buildInitialGameState>[2]) {
  return buildInitialGameState(new GameMap(7, "small"), mulberry32(42), opts);
}

function troopSumOf(hero: { stacks: { entries: { count: number }[] }[] } | undefined): number {
  if (!hero) return 0;
  return hero.stacks.reduce(
    (sum, platoon) => sum + platoon.entries.reduce((s, e) => s + e.count, 0),
    0,
  );
}

function settlementsOwnedBy(state: ReturnType<typeof build>, ownerId: number): string[] {
  return Object.values(state.settlements)
    .filter((s) => s.ownerId === ownerId)
    .map((s) => s.id);
}

test("enemyCount 2 + humanSeatCount 1 builds 3 seats with AI factions, names, heroes, and castles", () => {
  const state = build({ enemyCount: 2, humanSeatCount: 1 });
  assert.equal(state.players.length, 3);
  assert.equal(state.players[0].faction, "player");
  assert.equal(state.players[0].name, "Player 1");
  assert.equal(state.players[1].faction, "ai");
  assert.equal(state.players[1].name, "AI 1");
  assert.equal(state.players[2].faction, "ai");
  assert.equal(state.players[2].name, "AI 2");

  const heroIds = state.players.map((p) => p.heroIds).flat();
  assert.equal(heroIds.length, 3);
  assert.deepEqual(heroIds, ["p0-hero", "p1-hero", "p2-hero"]);
  assert.equal(state.heroes["p0-hero"].name, "Commander");
  assert.equal(state.heroes["p1-hero"].name, "Warlord");
  assert.equal(state.heroes["p2-hero"].name, "Warlord");

  assert.equal(state.heroes["p0-hero"].ownerId, 0);
  assert.equal(state.heroes["p1-hero"].ownerId, 1);
  assert.equal(state.heroes["p2-hero"].ownerId, 2);

  assert.equal(settlementsOwnedBy(state, 1).length, 1);
  assert.equal(settlementsOwnedBy(state, 2).length, 1);
  assert.equal(state.settlements[state.players[1].settlementIds[0]].ownerId, 1);
  assert.equal(state.settlements[state.players[2].settlementIds[0]].ownerId, 2);
});

test("enemyCount absent produces the same snapshot as before the option existed", () => {
  const legacy = build();
  const withEmptyOpts = build({});
  assert.deepEqual(withEmptyOpts, legacy);
  assert.equal(legacy.players.length, 3);
  assert.equal(legacy.players[1].faction, "ai");
  assert.equal(legacy.players[2].faction, "ai");
});

test("enemyCount 0 ignores an explicit playerCount and yields only the human seats", () => {
  const state = build({ enemyCount: 0, humanSeatCount: 2, playerCount: 5 });
  assert.equal(state.players.length, 2);
  assert.equal(state.players[0].faction, "player");
  assert.equal(state.players[1].faction, "player");
});

test("enemyCount is clamped so human seats + enemies never exceed MAX_PLAYERS", () => {
  const a = build({ enemyCount: 4, humanSeatCount: 8 });
  assert.equal(a.players.length, MAX_PLAYERS);
  assert.equal(a.players.filter((p) => p.faction === "player").length, 8);
  assert.equal(a.players.filter((p) => p.faction === "ai").length, 2);

  const b = build({ enemyCount: 3, humanSeatCount: 10 });
  assert.equal(b.players.length, MAX_PLAYERS);
  assert.equal(b.players.filter((p) => p.faction === "ai").length, 0);
});

test("castleCount below the derived playerCount still yields at least playerCount castles", () => {
  const state = build({ enemyCount: 2, humanSeatCount: 1, castleCount: 2 });
  assert.equal(state.players.length, 3);
  assert.ok(Object.keys(state.settlements).length >= 3);
  assert.ok(state.castleCount >= 3);
  for (const p of state.players) {
    assert.ok(settlementsOwnedBy(state, p.id).length >= 1, `player ${p.id} has no castle`);
  }
});

test("makeInitialStatePayload derives the same seat split from enemyCount", () => {
  const payload = makeInitialStatePayload(
    new GameMap(7, "small"),
    mulberry32(42),
    { enemyCount: 2, humanSeatCount: 1 },
  );
  assert.equal(payload.players.length, 3);
  assert.equal(payload.players[1].faction, "ai");
  assert.equal(payload.players[1].name, "AI 1");
  assert.equal(payload.players[2].faction, "ai");
  assert.equal(payload.players[2].name, "AI 2");
  assert.equal(Object.keys(payload.heroes).length, 3);
  assert.equal(payload.heroes["p2-hero"].name, "Warlord");
  assert.ok(Object.values(payload.settlements).some((s) => s.ownerId === 2));
});

test("makeInitialStatePayload keeps legacy behavior when enemyCount is absent", () => {
  const legacy = makeInitialStatePayload(new GameMap(7, "small"), mulberry32(42));
  const withEmptyOpts = makeInitialStatePayload(new GameMap(7, "small"), mulberry32(42), {});
  assert.deepEqual(withEmptyOpts, legacy);
  assert.equal(legacy.players.length, 3);
});

test("non-finite enemyCount falls back to legacy behavior", () => {
  const legacy = build();
  const nan = build({ enemyCount: NaN });
  assert.deepEqual(nan, legacy);
});

test("seatFactions assigns per-seat roster factions; uncovered seats carry no key", () => {
  const state = build({ enemyCount: 1, humanSeatCount: 1, seatFactions: ["ashen"] });
  assert.equal(state.players[0].factionId, "ashen");
  assert.equal("factionId" in state.players[1], false, "short array = the seat keeps the human default with no key");
  assert.equal(state.players[1].faction, "ai", "the seat faction (player|ai) is untouched by the roster faction");
});

test("seatFactions absent keeps the snapshot byte-identical: no factionId key anywhere", () => {
  const legacy = build({ enemyCount: 1, humanSeatCount: 1 });
  for (const p of legacy.players) {
    assert.equal("factionId" in p, false, "absent option must not add the key (deepStrictEqual rule)");
  }
});

test("seatFactions entries beyond the seat count are never read (the clamp)", () => {
  const state = build({ enemyCount: 0, humanSeatCount: 2, seatFactions: ["ironmark", "verdant", "ashen"] });
  assert.equal(state.players.length, 2, "the third entry cannot create a seat");
  assert.equal(state.players[0].factionId, "ironmark");
  assert.equal(state.players[1].factionId, "verdant");
});

test("makeInitialStatePayload threads seatFactions the same way (the POST /games path)", () => {
  const payload = makeInitialStatePayload(new GameMap(7, "small"), mulberry32(42), {
    enemyCount: 1,
    humanSeatCount: 1,
    seatFactions: ["verdant", "human"],
  });
  assert.equal(payload.players[0].factionId, "verdant");
  assert.equal(payload.players[1].factionId, "human");
});

test("every spawned hero across 1 human + 3 AI seats has a non-empty starter army", () => {
  const state = build({ enemyCount: 3, humanSeatCount: 1 });
  assert.equal(state.players.length, 4);
  for (const p of state.players) {
    const hero = state.heroes[p.heroIds[0]];
    assert.ok(hero, `player ${p.id} has a hero`);
    const sum = troopSumOf(hero);
    assert.ok(sum > 0, `player ${p.id} (seat ${p.id}) spawns with troops, got ${sum}`);
    assert.equal(hero.troops, sum, `player ${p.id} troops field matches platoon sum`);
    assert.ok(
      hero.stacks.some((pl) => pl.entries.some((e) => e.count > 0)),
      `player ${p.id} has at least one non-empty platoon`,
    );
  }
});

test("seat 2 (the regression) spawns with the cycled seat-0 composition: 24 troops", () => {
  const state = build({ enemyCount: 2, humanSeatCount: 1 });
  const h2 = state.heroes["p2-hero"];
  assert.ok(h2);
  assert.equal(h2.troops, 24);
  assert.deepEqual(troopSumOf(h2), 24);
  assert.deepEqual(
    h2.stacks.filter((pl) => pl.entries.length > 0).map((pl) => pl.entries.map((e) => e.unitTypeId)),
    [["swordsman"], ["archer"], ["cavalry"]],
  );
});

test("demoPlatoonsForPlayer cycles deterministically for every seat up to MAX_PLAYERS", () => {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const platoons = demoPlatoonsForPlayer(i);
    assert.ok(
      platoons.some((pl) => pl.entries.some((e) => e.count > 0)),
      `seat ${i} gets a non-empty demo army`,
    );
    const expected = demoPlatoonsForPlayer(i % 2);
    assert.deepEqual(
      platoons.map((pl) => pl.entries),
      expected.map((pl) => pl.entries),
      `seat ${i} matches the cycled composition of seat ${i % 2}`,
    );
  }
});

test("legacy default hero fixtures keep their exact starter armies", () => {
  const state = createInitialState();
  assert.equal(state.heroes["h0"].troops, 24);
  assert.equal(state.heroes["h1"].troops, 13);
  assert.equal(troopSumOf(state.heroes["h0"]), 24);
  assert.equal(troopSumOf(state.heroes["h1"]), 13);
});

test("every hero and settlement spawned at game start is content and paid up (weekly upkeep shortfall v1)", () => {
  const state = build({ enemyCount: 3, humanSeatCount: 1 });
  const heroes = Object.values(state.heroes);
  const settlements = Object.values(state.settlements);
  assert.ok(heroes.length > 0 && settlements.length > 0);

  for (const hero of heroes) {
    assert.equal(hero.morale, 100, `${hero.id} starts at full morale`);
    assert.equal(hero.upkeepUnpaidSinceDay, null, `${hero.id} has no unpaid-upkeep streak`);
    assert.equal(hero.upkeepUnpaidTroops, 0, `${hero.id} has no unfed troops`);
    assert.equal(hero.upkeepUnpaidGold, 0, `${hero.id} has no upkeep deficit`);
  }
  for (const settlement of settlements) {
    assert.equal(settlement.garrisonUnpaidSinceDay, null, `${settlement.id} has no unpaid-upkeep streak`);
    assert.equal(settlement.garrisonUnpaidTroops, 0, `${settlement.id} has no unfed garrison`);
    assert.equal(settlement.garrisonUnpaidGold, 0, `${settlement.id} has no upkeep deficit`);
  }
});

test("makeInitialStatePayload's heroes and settlements start content and paid up too", () => {
  const payload = makeInitialStatePayload(
    new GameMap(7, "small"),
    mulberry32(42),
    { enemyCount: 2, humanSeatCount: 1 },
  );
  for (const hero of Object.values(payload.heroes)) {
    assert.equal(hero.morale, 100);
    assert.equal(hero.upkeepUnpaidSinceDay, null);
    assert.equal(hero.upkeepUnpaidTroops, 0);
    assert.equal(hero.upkeepUnpaidGold, 0);
  }
  for (const settlement of Object.values(payload.settlements)) {
    assert.equal(settlement.garrisonUnpaidSinceDay, null);
    assert.equal(settlement.garrisonUnpaidTroops, 0);
    assert.equal(settlement.garrisonUnpaidGold, 0);
  }
});

// A 1-player game gives seat 0 TWO settlements: the level-1 keep (population
// 500, 5 food/turn) and a level-2 town (1500, 15 food/turn). Both are created
// with the engine's starter set, town hall included, because a settlement that
// already has buildings skips the city view's free starter commit.
//
// Two bugs this pins, both measured over 60 seeds x 22 turns:
//   - the keep was created EMPTY (starterBuildingsFor returned [] for anything
//     the base set could feed, betting on the free commit), so it produced
//     nothing at all: `l1SeededWithBuildings` 0/60.
//   - the town's farmland was sized against ITS 15/turn alone (4 farms) when
//     the pair eats 20/turn between them: 29/60 net-negative, 11/60 at morale 0.
//
// A third term joined the bill after that: the owner's HEROES eat out of the
// same warehouses (hero/upkeep.ts's applySuppliedHeroUpkeep), which the
// population bill alone left 40 food/week short of. These pass the real
// catalog's starterLayout fixture, so the seeded count is the one the server
// creates with -- 7 fields, not the 6 the catalog-less 1g/1f fallback asks for.

function onePlayerGame(castleSeed = 424242) {
  return buildInitialGameState(new GameMap(castleSeed, "small"), mulberry32(castleSeed), {
    castleSeed,
    enemyCount: 0,
    humanSeatCount: 1,
    unitTypes: STARTER_CATALOG,
  });
}

/** The player's whole food bill per turn: population + heroes, the sizing input. */
function playerBillOf(state: ReturnType<typeof onePlayerGame>): number {
  const mine = Object.values(state.settlements).filter((s) => s.ownerId === 0);
  const heroFood = Object.values(state.heroes)
    .filter((h) => h.ownerId === 0)
    .reduce((t, h) => t + heroFoodPerTurn(h.stacks, STARTER_CATALOG), 0);
  return foodRequiredForPopulations(mine.map((s) => s.population)) + heroFood;
}

/** The player's own level-2 town: the settlement the reported morale collapse was about. */
function townOf(state: ReturnType<typeof onePlayerGame>) {
  const found = Object.values(state.settlements).filter((s) => s.level === 2);
  assert.equal(found.length, 1, `exactly one level-2 settlement, got ${found.map((s) => s.id).join(", ")}`);
  return found[0];
}

/** The player's own level-1 keep: the settlement the player interacts with first. */
function keepOf(state: ReturnType<typeof onePlayerGame>) {
  const found = Object.values(state.settlements).filter((s) => s.ownerId === 0 && s.level === 1);
  assert.equal(found.length, 1, `exactly one level-1 settlement owned by seat 0, got ${found.map((s) => s.id).join(", ")}`);
  return found[0];
}

function farmsOf(s: { buildings: readonly { kind: string }[] }): number {
  return s.buildings.filter((b) => b.kind === "farmField").length;
}

test("a 1-player game's level-2 town starts with a town hall and the owner's whole farm pool", () => {
  const state = onePlayerGame();
  // castleCount is floored at CASTLE_COUNT_MIN, so the game also generates two
  // neutral level-3 towns; the player's own pair is level 1 + level 2.
  const mine = Object.values(state.settlements).filter((s) => s.ownerId === 0);
  assert.equal(mine.length, 2, "player 1 owns exactly two settlements");
  assert.deepEqual(mine.map((s) => s.level).sort(), [1, 2]);

  const keep = keepOf(state);
  const town = townOf(state);
  assert.equal(keep.population, 500);
  assert.equal(town.population, 1500);

  // The pool lives in the larger city: farms are 2x2, and a 5x5 keep can hold
  // at most 3 of them, so the combined pool does not fit in the small half.
  const farms = farmsOf(town);
  assert.equal(
    town.buildings.filter((b) => b.kind === "townHall").length,
    1,
    "the town hall is not optional: a seeded settlement never gets the free commit",
  );
  const bill = playerBillOf(state);
  assert.equal(bill, 20 + 40 / 7, "keep 5 + town 15 food/turn, plus the hero's 40/week over 7 turns");
  assert.equal(farms, starterFarmsNeeded(bill));
  assert.equal(farms, 7, "~25.7 food/turn sizes to 7 farms, not the 5 the population bill alone asked for");
  assert.ok(farms > 1, "one farm yields ~5 food/turn against a ~25.7/turn bill");
  assert.deepEqual(
    town.buildings,
    buildStarterLayout({ size: 10, style: "classic", farms }),
    "the seeded set IS the engine starter layout -- no second placement routine",
  );
  for (const b of town.buildings) {
    assert.equal(b.level, 1, `${b.kind} is level 1: a free level-2 hall would unlock upgrades on turn 0`);
    assert.equal("construction" in b, false, `${b.kind} arrives already built`);
    assert.equal(b.style, "classic");
  }
});

test("REGRESSION: the level-1 keep is created WITH buildings, not empty", () => {
  const state = onePlayerGame();
  const keep = keepOf(state);
  assert.ok(keep.buildings.length > 0, "the keep must not be created empty (was 0/60 seeds)");
  assert.equal(keep.buildings.filter((b) => b.kind === "townHall").length, 1, "town hall");
  assert.ok(farmsOf(keep) >= 1, "at least one farm field");
  assert.equal(keep.buildings.filter((b) => b.kind === "house").length, 2, "both houses");
  assert.equal(keep.buildings.filter((b) => b.kind === STARTER_WOOD_PRODUCER).length, 1, "a wood producer");
  assert.equal(keep.buildings.filter((b) => b.kind === STARTER_STONE_PRODUCER).length, 1, "a stone producer");
  assert.equal(
    farmsOf(keep),
    STARTER_BASE_FARMS,
    "the keep keeps the base set's single farm -- its owner's pool sits in the town",
  );
  assert.deepEqual(keep.buildings, buildStarterLayout({ size: 5, style: "classic" }));

  // A seeded settlement never gets the free commit, so opening its city must
  // hand back exactly what it already has -- no second city, no charge.
  const onOpen = starterCityOnOpen({ size: 5, style: "classic", existing: keep.buildings });
  assert.equal(onOpen.free, false, "no free commit on open -- its buildings are already persisted");
  assert.equal(onOpen.buildings, keep.buildings, "the city shows exactly what the settlement holds");
});

test("every settlement the game creates is seeded, and each settlement of an owner gets ONE complete set", () => {
  for (const state of [onePlayerGame(424242), onePlayerGame(99991)]) {
    for (const s of Object.values(state.settlements)) {
      const farms = farmsOf(s);
      const size = s.level === 1 ? 5 : s.level === 2 ? 10 : 15;
      assert.ok(s.buildings.length > 0, `${s.id} (owner ${s.ownerId}, level ${s.level}) starts empty`);
      assert.equal(s.buildings.filter((b) => b.kind === "townHall").length, 1, `${s.id} keeps its town hall`);
      assert.equal(s.buildings.filter((b) => b.kind === "house").length, 2, `${s.id} keeps both houses`);
      assert.equal(s.buildings.filter((b) => b.kind === STARTER_WOOD_PRODUCER).length, 1, `${s.id} has a wood producer`);
      assert.equal(s.buildings.filter((b) => b.kind === STARTER_STONE_PRODUCER).length, 1, `${s.id} has a stone producer`);
      assert.ok(farms >= STARTER_BASE_FARMS, `${s.id} has at least the base farm`);
      assert.deepEqual(
        s.buildings,
        buildStarterLayout({ size, style: "classic", farms }),
        `${s.id} is the engine starter layout, nothing bespoke`,
      );
    }
  }
});

test("the farm pool is sized against the WHOLE owner's bill, and exactly one settlement hosts it", () => {
  const state = onePlayerGame();
  const mine = Object.values(state.settlements).filter((s) => s.ownerId === 0);
  const populationBill = foodRequiredForPopulations(mine.map((s) => s.population));
  assert.equal(populationBill, 20, "keep 5 + town 15 = 20 food/turn out of ONE pool");
  const bill = playerBillOf(state);
  const totalFarms = mine.reduce((t, s) => t + farmsOf(s), 0);
  assert.equal(totalFarms, starterFarmsNeeded(bill) + STARTER_BASE_FARMS, "pool 7 in the town + the keep's base farm");
  assert.equal(mine.filter((s) => farmsOf(s) > STARTER_BASE_FARMS).length, 1, "exactly one pool host per owner");
  // The two bugs this replaces: sizing each city on its own population gave
  // 1 + 4, and pricing only the population gave 1 + 5.
  assert.equal(totalFarms, 8, "not 6 (per-settlement 15/turn bill) and not 7 (population bill alone)");
});

test("NEUTRALS: each is its own pool, sized on its own population, and is nobody's food bill", () => {
  const state = onePlayerGame();
  const neutrals = Object.values(state.settlements).filter((s) => s.ownerId === null);
  assert.ok(neutrals.length > 0, "the fixture has neutral settlements to check");
  for (const s of neutrals) {
    // Their own population, not the player's bill and not a shared neutral pool:
    // a neutral is never consumed from and trade refuses unowned_settlement, so
    // it has to feed itself alone.
    assert.equal(farmsOf(s), starterFarmsNeeded(foodRequiredForPopulation(s.population)), `${s.id}`);
    assert.equal(s.buildings.filter((b) => b.kind === "townHall").length, 1, `${s.id} keeps its town hall`);
  }
  // Two neutrals of equal population get EQUAL farms, which is only true if they
  // are separate pools -- a shared "neutral" pool would give one of them the
  // whole thing and the other the base set.
  const byPop = new Map<number, number[]>();
  for (const s of neutrals) byPop.set(s.population, [...(byPop.get(s.population) ?? []), farmsOf(s)]);
  for (const [pop, counts] of byPop) {
    assert.equal(new Set(counts).size, 1, `neutrals of population ${pop} got different farm counts: ${counts.join(", ")}`);
  }
  // And they never appear in a player's bill: summing the player's food
  // requirement over its OWN settlements is what the pool is sized against.
  const mine = Object.values(state.settlements).filter((s) => s.ownerId === 0);
  assert.equal(
    foodRequiredForPopulations(mine.map((s) => s.population)),
    mine.reduce((t, s) => t + foodRequired(s), 0),
  );
});

test("wood and stone: the starter set is solvent from 300/300 for 37 turns, and produces both", () => {
  const state = onePlayerGame();
  for (const s of Object.values(state.settlements)) {
    const upkeep = buildingUpkeepRequired(s);
    assert.deepEqual(upkeep, { wood: 8, stone: 2 }, `${s.id}: townHall 3+2, 2 houses 1+0, hut 1, mine 2, farms 0`);
    assert.equal(Math.floor(300 / upkeep.wood), 37, `${s.id}: 37 turns of wood runway from the starting stock`);
    assert.equal(Math.floor(300 / upkeep.stone), 150, `${s.id}: 150 turns of stone runway`);
    // Producers, actually wired as producers (producerBasePerTurn > 0).
    const wood = producerBasePerTurn(STARTER_WOOD_PRODUCER, 1, "wood");
    const stone = producerBasePerTurn(STARTER_STONE_PRODUCER, 1, "stone");
    assert.equal(wood, 3, "the woodcutter's hut returns 3 wood/turn at the median cell");
    assert.equal(stone, 3, "the stone mine returns 3 stone/turn at the median cell");
    // Net at the median cell: wood +3 - 1 (hut) - 2 (mine upkeep) = 0; stone
    // +3 - 0 = +3. The map is no longer the only reason a settlement can pay.
    assert.equal(wood - 1 - 2, 0, "wood is a wash at the median cell");
    assert.equal(stone, 3, "stone is pure gain, so the set stops draining it");
  }
});

test("the seeded level-2 town keeps its farm: opening its city is not a second commit", () => {
  const state = onePlayerGame();
  const town = townOf(state);
  const onOpen = starterCityOnOpen({ size: 10, style: "classic", existing: town.buildings });
  assert.equal(onOpen.free, false, "no free commit on open -- its buildings are already persisted");
  assert.equal(onOpen.buildings, town.buildings, "the city shows exactly what the settlement holds");
  assert.ok(
    onOpen.buildings.some((b) => b.kind === "farmField"),
    "so it does not lose its farmland by opening its own city view",
  );
});

test("re-committing a seeded city's cart is a zero-cost no-op, not a charge and not a refund", () => {
  const town = townOf(onePlayerGame());
  assert.equal(town.gold, 300, "game-start gold, not spent");
  assert.deepEqual(town.warehouse, { wood: 300, stone: 300, iron: 300, arcane: 300, food: 0 });
  const state = makeState({ settlements: [town] });
  const committed = applyPlaceBuildings(state, town.id, 0, town.buildings, true);
  assert.equal(committed.ok, true);
  assert.deepEqual(committed.state.settlements[town.id].buildings, town.buildings, "same set, not doubled");
  // The city view re-commits its cart whenever the player touches anything; a
  // seeded settlement's cart is already its live set, so the delta is zero. The
  // free flag grants nothing either -- applyPlaceBuildings ignores initialLayout
  // for a settlement that already has buildings (placeBuildings.test.ts pins
  // that anti-spoof guard).
  assert.equal(committed.state.settlements[town.id].gold, 300, "no charge");
  assert.deepEqual(committed.state.settlements[town.id].warehouse, town.warehouse, "no refund, no charge");
  assert.deepEqual(buildingUpkeepRequired(committed.state.settlements[town.id]), { wood: 8, stone: 2 });
});

test("makeInitialStatePayload -- the POST /games path -- carries the same seeded pair", () => {
  // POST /games persists this payload into games.settlements JSONB, and
  // hydration reads JSONB until the granular tables are first written, so this
  // is what the browser actually starts the game with.
  const payload = makeInitialStatePayload(new GameMap(424242, "small"), mulberry32(424242), {
    castleSeed: 424242,
    enemyCount: 0,
    humanSeatCount: 1,
    // POST /games reads unit_types and passes the catalog in (server/routes.ts),
    // which is what puts the hero's food bill into the seeded farm count.
    unitTypes: STARTER_CATALOG,
  });
  const settlements = Object.values(payload.settlements);
  const town = settlements.find((s) => s.level === 2);
  assert.ok(town);
  assert.deepEqual(town.buildings, townOf(onePlayerGame()).buildings);
  assert.ok(town.buildings.some((b) => b.kind === "farmField"));
  const keep = settlements.find((s) => s.ownerId === 0 && s.level === 1);
  assert.ok(keep, "the keep is in the payload too");
  assert.deepEqual(keep.buildings, keepOf(onePlayerGame()).buildings, "and it is seeded, not empty");
  assert.ok(keep.buildings.length > 0);
});
