import { test } from "node:test";
import assert from "node:assert/strict";
import type { HeroState } from "@heroes/contracts";
import {
  CHARTER_GOLD_COST,
  DEFAULT_HERO_WAGONS,
  DEFAULT_TREASURY_WAGONS,
  GameMap,
  WAGON_GOLD_CAPACITY,
  WAGON_RESOURCE_CAPACITY,
  buildInitialGameState,
  heroCargo,
  heroGoldCap,
  heroResourceCap,
  heroTreasuryWagons,
  heroWagons,
  makeInitialStatePayload,
  mulberry32,
  playerTreasuryWagonsOwned,
  playerTreasuryWagonsUnassigned,
  playerWagonsOwned,
  playerWagonsUnassigned,
} from "@heroes/engine";
import { makeHero, makePlayer, makeState } from "../charter/_helpers";

test("a 5-wagon hero carries the 2,500g purse cap and the 250-per-resource cargo cap", () => {
  const hero = makeHero("h0", 0, 2, 2);
  assert.equal(hero.wagons, 5, "the fixture hero emits its wagon count explicitly");
  assert.equal(hero.treasuryWagons, 5, "and its treasury-cart count explicitly (Phase 1 split)");
  assert.deepEqual(hero.resources, { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 }, "and its empty cargo");
  assert.equal(heroGoldCap(hero), 2500);
  assert.deepEqual(heroResourceCap(hero), {
    wood: 250,
    stone: 250,
    iron: 250,
    arcane: 250,
    food: 250,
  });
});

test("hero resource caps scale linearly with assigned army wagons for 0..10 wagons (gold decoupled by the Phase 1 split)", () => {
  for (let wagons = 0; wagons <= 10; wagons++) {
    const hero = makeHero("h0", 0, 2, 2, { wagons });
    assert.equal(heroWagons(hero), wagons);
    // Phase 1 split: army wagons govern RESOURCES only. The purse cap rides
    // the separate treasury-cart slot, which this fixture leaves at its
    // default 5 -- pre-split this asserted wagons * WAGON_GOLD_CAPACITY.
    assert.equal(heroGoldCap(hero), DEFAULT_TREASURY_WAGONS * WAGON_GOLD_CAPACITY);
    assert.deepEqual(heroResourceCap(hero), {
      wood: wagons * WAGON_RESOURCE_CAPACITY,
      stone: wagons * WAGON_RESOURCE_CAPACITY,
      iron: wagons * WAGON_RESOURCE_CAPACITY,
      arcane: wagons * WAGON_RESOURCE_CAPACITY,
      food: wagons * WAGON_RESOURCE_CAPACITY,
    });
  }
});

test("treasury pins mirror the cargo pins: purse cap scales with treasury carts, resource cap with army wagons", () => {
  assert.equal(DEFAULT_TREASURY_WAGONS, 5);
  for (let carts = 0; carts <= 10; carts++) {
    const hero = makeHero("h0", 0, 2, 2, { treasuryWagons: carts });
    assert.equal(heroTreasuryWagons(hero), carts);
    assert.equal(heroGoldCap(hero), carts * WAGON_GOLD_CAPACITY);
  }
});

test("the split is real: treasury carts never move the resource cap, army wagons never move the purse cap", () => {
  const split = makeHero("h0", 0, 2, 2, { wagons: 2, treasuryWagons: 7 });
  assert.equal(heroGoldCap(split), 7 * WAGON_GOLD_CAPACITY, "gold rides treasury carts only");
  assert.deepEqual(heroResourceCap(split), {
    wood: 2 * WAGON_RESOURCE_CAPACITY,
    stone: 2 * WAGON_RESOURCE_CAPACITY,
    iron: 2 * WAGON_RESOURCE_CAPACITY,
    arcane: 2 * WAGON_RESOURCE_CAPACITY,
    food: 2 * WAGON_RESOURCE_CAPACITY,
  }, "resources ride army wagons only");
});

test("an explicit 0 treasury carts is a 0g purse cap; an ABSENT field soft-defaults to 2,500g (the legacy pin)", () => {
  const stripped: HeroState = { ...makeHero("h0", 0, 2, 2, { treasuryWagons: 0 }) };
  assert.equal(heroTreasuryWagons(stripped), 0);
  assert.equal(heroGoldCap(stripped), 0, "zero carts = zero gold capacity, a real value");

  const legacy: HeroState = { ...makeHero("h0", 0, 2, 2) };
  delete legacy.treasuryWagons;
  assert.equal(heroTreasuryWagons(legacy), DEFAULT_TREASURY_WAGONS);
  assert.equal(heroGoldCap(legacy), 2500, "absent field keeps the pre-split purse cap with zero churn");
});

test("a fresh hero's purse cap exactly equals the charter cost (the 5-cart <-> 2,500g pairing)", () => {
  assert.equal(DEFAULT_HERO_WAGONS, 5);
  assert.equal(DEFAULT_TREASURY_WAGONS, 5);
  assert.equal(WAGON_GOLD_CAPACITY, 500);
  assert.equal(CHARTER_GOLD_COST, 2500);
  const state = buildInitialGameState(new GameMap(7, "small"), mulberry32(42), {
    enemyCount: 2,
    humanSeatCount: 1,
  });
  const startingHero = state.heroes["p0-hero"];
  assert.ok(startingHero);
  assert.equal(heroGoldCap(startingHero), CHARTER_GOLD_COST);
  assert.equal(heroGoldCap(makeHero("h0", 0, 2, 2)), CHARTER_GOLD_COST, "the fixture hero agrees with the engine's starting hero");
});

test("buildInitialGameState starts every seat with a 5-wagon pool, all assigned to its starting hero", () => {
  const state = buildInitialGameState(new GameMap(7, "small"), mulberry32(42), {
    enemyCount: 2,
    humanSeatCount: 1,
  });
  assert.ok(state.players.length >= 2);
  for (const player of state.players) {
    assert.equal(player.wagonsOwned, 5, `player ${player.id} owns the starting 5 wagons explicitly`);
    assert.equal(player.wagonsUnassigned, 0, "and all 5 are pre-assigned to the starting hero");
    assert.equal(playerWagonsOwned(player), 5);
    assert.equal(playerWagonsUnassigned(player), 0);
    const hero = state.heroes[player.heroIds[0]];
    assert.ok(hero, `player ${player.id} has a starting hero`);
    assert.equal(hero.wagons, 5);
    assert.equal(hero.gold, 300);
    assert.deepEqual(heroCargo(hero), { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 });
  }
});

test("buildInitialGameState also starts every seat with the independent 5-cart treasury pool, all pre-assigned (Phase 1 mirror of the cargo pin)", () => {
  const state = buildInitialGameState(new GameMap(7, "small"), mulberry32(42), {
    enemyCount: 2,
    humanSeatCount: 1,
  });
  for (const player of state.players) {
    assert.equal(player.treasuryWagonsOwned, 5, `player ${player.id} owns the starting 5 treasury carts explicitly`);
    assert.equal(player.treasuryWagonsUnassigned, 0, "and all 5 are pre-assigned to the starting hero");
    assert.equal(playerTreasuryWagonsOwned(player), 5);
    assert.equal(playerTreasuryWagonsUnassigned(player), 0);
    const hero = state.heroes[player.heroIds[0]];
    assert.ok(hero);
    assert.equal(hero.treasuryWagons, 5, "the starting hero carries its 5 carts explicitly");
    assert.equal(heroTreasuryWagons(hero), 5);
  }
});

test("makeInitialStatePayload (the POST /games path) carries the same starting pool, purse, and cargo", () => {
  const payload = makeInitialStatePayload(new GameMap(7, "small"), mulberry32(42), {
    enemyCount: 2,
    humanSeatCount: 1,
  });
  for (const player of payload.players) {
    assert.equal(player.wagonsOwned, 5);
    assert.equal(player.wagonsUnassigned, 0);
    assert.equal(player.treasuryWagonsOwned, 5);
    assert.equal(player.treasuryWagonsUnassigned, 0);
    const hero = payload.heroes[player.heroIds[0]];
    assert.ok(hero);
    assert.equal(hero.wagons, 5);
    assert.equal(hero.treasuryWagons, 5);
    assert.equal(hero.gold, 300);
    assert.deepEqual(heroCargo(hero), { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 });
  }
});

test("heroWagons defaults a legacy hero with no wagons/resources keys to the engine defaults", () => {
  const legacy: HeroState = { ...makeHero("h0", 0, 2, 2) };
  delete legacy.wagons;
  delete legacy.resources;
  assert.equal(heroWagons(legacy), DEFAULT_HERO_WAGONS);
  assert.equal(heroGoldCap(legacy), 2500);
  assert.deepEqual(heroCargo(legacy), { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 });
});

test("the fixtures emit the wagon and trade-route model explicitly, not via engine defaults", () => {
  const hero = makeHero("h0", 0, 2, 2);
  assert.equal(hero.wagons, DEFAULT_HERO_WAGONS);
  assert.equal(hero.treasuryWagons, DEFAULT_TREASURY_WAGONS);
  assert.deepEqual(hero.resources, { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 });

  const player = makePlayer(0, "player", ["h0"], ["s0"]);
  assert.equal(player.wagonsOwned, 0);
  assert.equal(player.wagonsUnassigned, 0);
  assert.equal(player.treasuryWagonsOwned, 5, "the fixture treasury pool matches init's starting 5");
  assert.equal(player.treasuryWagonsUnassigned, 0);

  const state = makeState({});
  assert.deepEqual(state.tradeRoutes, []);
  assert.equal(state.nextTradeRouteId, 0);
});