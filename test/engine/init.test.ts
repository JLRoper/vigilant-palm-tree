import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, SettlementState, UnitType } from "@heroes/contracts";
import {
  GameMap,
  MAX_PLAYERS,
  applyPlaceBuildings,
  buildInitialGameState,
  buildStarterLayout,
  buildingUpkeepRequired,
  createInitialState,
  demoPlatoonsForPlayer,
  foodRequiredForPopulation,
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

test("starting treasury-cart pool: every seat owns 5 carts, all pre-assigned, and every starting hero carries 5 (Phase 1 treasury-wagons split)", () => {
  const state = build({ enemyCount: 2, humanSeatCount: 1 });
  for (const p of state.players) {
    assert.equal(p.treasuryWagonsOwned, 5, `player ${p.id} owns the starting 5 treasury carts`);
    assert.equal(p.treasuryWagonsUnassigned, 0, `player ${p.id} has all 5 carts pre-assigned to its starting hero`);
    const hero = state.heroes[p.heroIds[0]];
    assert.ok(hero, `player ${p.id} has a starting hero`);
    assert.equal(hero.treasuryWagons, 5, `player ${p.id}'s starting hero carries its 5 carts explicitly`);
  }

  const payload = makeInitialStatePayload(new GameMap(7, "small"), mulberry32(42), {
    enemyCount: 2,
    humanSeatCount: 1,
  });
  for (const p of payload.players) {
    assert.equal(p.treasuryWagonsOwned, 5);
    assert.equal(p.treasuryWagonsUnassigned, 0);
    assert.equal(payload.heroes[p.heroIds[0]].treasuryWagons, 5, "the POST /games payload agrees with buildInitialGameState");
  }
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
// Bugs this file pins, all measured over seeded games:
//   - the keep was created EMPTY (starterBuildingsFor returned [] for anything
//     the base set could feed, betting on the free commit), so it produced
//     nothing at all: `l1SeededWithBuildings` 0/60.
//   - farmland was then sized against a whole-OWNER pool (the pair's 20/turn
//     plus the hero's 40/week, 7 farms concentrated in the town) because
//     instant auto-trade moved surplus between a player's own settlements.
//     That teleport is gone for new games (lobby.legacyAutoTrade false,
//     2026-10-02), so sizing is PER SETTLEMENT: each city carries its own
//     bill -- the town 15/turn = 4 farms, the keep 5 + 40/7 = 4 asked but 3
//     placed (a 5x5 grid holds three 2x2 farms beside the town hall), with
//     accumulated surplus covering the keep's clamp. Coverage over 4000 seeds
//     with the real cellMultiplier lives in foodProduction.test.ts; the hero
//     charges these farms feed are pinned in heroFoodSupply.test.ts.
//
// These pass the real catalog's starterLayout fixture, so the seeded counts
// are the ones the server creates with -- not the counts the catalog-less
// 1g/1f fallback would ask for.

function onePlayerGame(castleSeed = 424242) {
  return buildInitialGameState(new GameMap(castleSeed, "small"), mulberry32(castleSeed), {
    castleSeed,
    enemyCount: 0,
    humanSeatCount: 1,
    unitTypes: STARTER_CATALOG,
  });
}

/**
 * The bill a settlement's own farmland is sized against: its population, plus
 * the weekly bill of the starting hero standing on it (starting heroes spawn on
 * their owner's FIRST castle -- the level-1 keep for seat 0), because
 * hero/upkeep.ts's under-hero rule draws that bill out of exactly this
 * settlement's warehouse. Neutrals have no hero and no trade partner, so their
 * bill is their own population alone.
 */
function billOf(s: SettlementState, state: ReturnType<typeof onePlayerGame>): number {
  const hero = Object.values(state.heroes).find((h) => h.ownerId === s.ownerId && h.q === s.q && h.r === s.r);
  return foodRequiredForPopulation(s.population) + (hero ? heroFoodPerTurn(hero.stacks, STARTER_CATALOG) : 0);
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

test("a 1-player game's level-2 town starts with a town hall and farmland sized to ITS OWN bill", () => {
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

  // Per-settlement sizing (2026-10-02): the town has no hero standing on it, so
  // its bill is its own 15 food/turn -- 4 farms, not the 7 the old shared-pool
  // sizing put here.
  const townHall = town.buildings.filter((b) => b.kind === "townHall");
  assert.equal(townHall.length, 1, "the town hall is not optional: a seeded settlement never gets the free commit");
  const bill = billOf(town, state);
  assert.equal(bill, 15, "population 1500 alone: no hero spawns on the town");
  const farms = farmsOf(town);
  assert.equal(farms, starterFarmsNeeded(bill));
  assert.equal(farms, 4, "15 food/turn sizes to 4 farms on the real registry rate");
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
  assert.equal(keep.buildings.filter((b) => b.kind === STARTER_WOOD_PRODUCER).length, 2, "two wood producers (one left the set net wood-negative)");
  assert.equal(keep.buildings.filter((b) => b.kind === STARTER_STONE_PRODUCER).length, 1, "a stone producer");
  assert.deepEqual(keep.buildings, buildStarterLayout({ size: 5, style: "classic", farms: 4 }));

  // A seeded settlement never gets the free commit, so opening its city must
  // hand back exactly what it already has -- no second city, no charge.
  const onOpen = starterCityOnOpen({ size: 5, style: "classic", existing: keep.buildings });
  assert.equal(onOpen.free, false, "no free commit on open -- its buildings are already persisted");
  assert.equal(onOpen.buildings, keep.buildings, "the city shows exactly what the settlement holds");
});

test("the keep is sized against its own bill PLUS the hero standing on it, and 5x5 clamps the count at 3", () => {
  const state = onePlayerGame();
  const keep = keepOf(state);
  const bill = billOf(keep, state);
  assert.equal(bill, 5 + 40 / 7, "keep 5 food/turn plus the starting hero's 40/week over 7 turns");
  assert.equal(starterFarmsNeeded(bill), 4, "the formula asks for 4 farms");
  assert.equal(farmsOf(keep), 3, "farm fields are 2x2 and a 5x5 keep holds at most 3 beside the town hall");
  // The clamp is not a silent shortfall handed to the player: the keep's
  // remaining coverage comes from accumulated surplus (auto-trade is OFF for
  // new games), measured 98.05% over 4000 seeds -- see foodProduction.test.ts.
  assert.deepEqual(keep.buildings, buildStarterLayout({ size: 5, style: "classic", farms: 4 }));
});

test("every settlement the game creates is seeded, and each settlement gets ONE complete set for ITSELF", () => {
  for (const state of [onePlayerGame(424242), onePlayerGame(99991)]) {
    for (const s of Object.values(state.settlements)) {
      const farms = farmsOf(s);
      const size = s.level === 1 ? 5 : s.level === 2 ? 10 : 15;
      assert.ok(s.buildings.length > 0, `${s.id} (owner ${s.ownerId}, level ${s.level}) starts empty`);
      assert.equal(s.buildings.filter((b) => b.kind === "townHall").length, 1, `${s.id} keeps its town hall`);
      assert.equal(s.buildings.filter((b) => b.kind === "house").length, 2, `${s.id} keeps both houses`);
      assert.equal(s.buildings.filter((b) => b.kind === STARTER_WOOD_PRODUCER).length, 2, `${s.id} has both wood producers`);
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

test("REGRESSION: sizing is PER SETTLEMENT -- no shared pool, no host city, every city sized on its own bill", () => {
  const state = onePlayerGame();
  const mine = Object.values(state.settlements).filter((s) => s.ownerId === 0);
  for (const s of mine) {
    // Only the 5x5 keep (level 1) clamps at 3; bigger grids place the full ask.
    const capacity = s.level === 1 ? 3 : Infinity;
    assert.equal(farmsOf(s), Math.min(capacity, starterFarmsNeeded(billOf(s, state))), `${s.id}`);
  }
  const totalFarms = mine.reduce((t, s) => t + farmsOf(s), 0);
  // keep 3 (4 asked, 5x5 holds 3) + town 4 = 7 total. The old pooled sizing put
  // 7 in the town and left the keep with 1; the old per-population sizing asked
  // 1 + 4. Both are gone: every settlement carries its own bill now.
  assert.equal(totalFarms, 7, "3 + 4, each city covering its own mouths");
  assert.equal(mine.filter((s) => farmsOf(s) > STARTER_BASE_FARMS).length, 2, "both player cities are sized past the base set");
});

test("NEUTRALS: each is sized on its own population alone (no hero ever spawns on one)", () => {
  const state = onePlayerGame();
  const neutrals = Object.values(state.settlements).filter((s) => s.ownerId === null);
  assert.ok(neutrals.length > 0, "the fixture has neutral settlements to check");
  for (const s of neutrals) {
    // Their own population, not any player's bill: a neutral is never consumed
    // from and trade refuses unowned_settlement, so it has to feed itself alone.
    assert.equal(billOf(s, state), foodRequiredForPopulation(s.population), `${s.id}: no hero term`);
    assert.equal(farmsOf(s), starterFarmsNeeded(billOf(s, state)), `${s.id}`);
    assert.equal(s.buildings.filter((b) => b.kind === "townHall").length, 1, `${s.id} keeps its town hall`);
  }
  // Two neutrals of equal population get EQUAL farms, which is only true if
  // each is sized independently -- a shared "neutral" pool would give one of
  // them the whole thing and the other the base set.
  const byPop = new Map<number, number[]>();
  for (const s of neutrals) byPop.set(s.population, [...(byPop.get(s.population) ?? []), farmsOf(s)]);
  for (const [pop, counts] of byPop) {
    assert.equal(new Set(counts).size, 1, `neutrals of population ${pop} got different farm counts: ${counts.join(", ")}`);
  }
});

test("REGRESSION: every NEW settlement is born autoTrade:false (the recommender replaces the teleport)", () => {
  const state = onePlayerGame();
  for (const s of Object.values(state.settlements)) {
    assert.equal(s.autoTrade, false, `${s.id}: init.ts does not opt new settlements into auto-trade`);
  }
});

test("wood and stone: the starter set drains only ~3 wood/turn at the median cell -- 33 turns of guaranteed runway", () => {
  const state = onePlayerGame();
  for (const s of Object.values(state.settlements)) {
    const upkeep = buildingUpkeepRequired(s);
    assert.deepEqual(upkeep, { wood: 9, stone: 2 }, `${s.id}: townHall 3+2, 2 houses 1+0, 2 huts 1+0 each, mine 2, farms 0`);
    assert.equal(Math.floor(300 / upkeep.wood), 33, `${s.id}: 33 turns of wood runway from the starting stock`);
    assert.equal(Math.floor(300 / upkeep.stone), 150, `${s.id}: 150 turns of stone runway`);
    // Producers, actually wired as producers (producerBasePerTurn > 0). The
    // wood producer ships TWICE (2026-10-02 balance: one hut left every starter
    // city net wood-negative, median -5/turn).
    const wood = producerBasePerTurn(STARTER_WOOD_PRODUCER, 1, "wood");
    const stone = producerBasePerTurn(STARTER_STONE_PRODUCER, 1, "stone");
    assert.equal(wood, 3, "each woodcutter's hut returns 3 wood/turn at the median cell");
    assert.equal(stone, 3, "the stone mine returns 3 stone/turn at the median cell");
    // Net at the median cell: the three producers return 6 wood + 3 stone
    // against 4 wood of their own upkeep, out-earning themselves by 2 and
    // cutting the set's whole-set wood drain to 9 - 6 = 3/turn (was 5 with one
    // hut). The map's resource tiles cover the rest in practice.
    assert.equal(2 * wood - 2 - 2, 2, "the two huts out-produce the producers' own 4 wood upkeep by 2");
    assert.equal(upkeep.wood - 2 * wood, 3, "the whole set drains just 3 wood/turn at the median cell");
    assert.equal(stone - upkeep.stone + 2, 3, "stone stays pure gain at the median cell");
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
  assert.deepEqual(buildingUpkeepRequired(committed.state.settlements[town.id]), { wood: 9, stone: 2 });
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
