import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GameMap,
  RESOURCE_AMOUNT_MAX,
  RESOURCE_AMOUNT_MIN,
  heroCargo,
  heroGoldCap,
  heroResourceCap,
  pickupResource,
  previewResourcePickup,
  resourceAmountFor,
  resourceRemainingOn,
  WAGON_RESOURCE_CAPACITY,
  type ResourceType,
} from "@heroes/engine";
import { makeHero, makeState } from "../charter/_helpers";

// Heroes picking the resources off the tiles they stand on (M-MAJOR-1: the
// verb that did not exist). Four rules this file pins, all of them the
// reader's: the tile's amount is 5-500 and derived from the seed; a hero must
// STAND on the tile; what moves is min(remaining, cargo room) with the
// remainder left on the floor; and a pickup never touches the tile's resource
// type, so the city view's deposit (type, workedBy, yield) reads the same
// before and after.

/**
 * A one-hex-tall grass strip with a single resource tile, so a test's fixture
 * is exactly its point. Seed 11 puts a large pile at (3,0) (see the partial
 * pickup test, which asserts the premise rather than trusting the seed).
 */
function stripWith(resource: ResourceType, q = 3, seed = 11): GameMap {
  const width = 6;
  const rows = [];
  for (let i = 0; i < width; i++) {
    rows.push({ q: i, r: 0, terrain: "grass" as const, resource: i === q ? resource : null });
  }
  return GameMap.fromTiles(rows, seed);
}

function amountAt(map: GameMap, q: number, r: number): number {
  const tile = map.resourceTileAt(q, r);
  assert.ok(tile, `expected a resource tile at ${q},${r}`);
  return tile!.amount;
}

test("a resource tile's amount is derived from the seed and the tile, inside 5-500", () => {
  const seed = 1234;
  // The whole generated world, checked against the derivation: every tile's
  // amount is exactly resourceAmountFor(seed, q, r, resource) -- never a draw
  // from the map's own RNG stream, which is what keeps terrain byte-identical
  // for this seed (see the terrain-identity test below).
  const map = new GameMap(seed, "small", 5);
  assert.ok(map.placedResourceTiles.length > 20, "the fixture seed places resource tiles");
  for (const tile of map.placedResourceTiles) {
    assert.equal(
      tile.amount,
      resourceAmountFor(seed, tile.q, tile.r, tile.resource),
      `tile ${tile.q},${tile.r} (${tile.resource}) carries its derived amount`,
    );
    assert.ok(
      tile.amount >= RESOURCE_AMOUNT_MIN && tile.amount <= RESOURCE_AMOUNT_MAX,
      `amount ${tile.amount} is inside ${RESOURCE_AMOUNT_MIN}-${RESOURCE_AMOUNT_MAX}`,
    );
  }
  // The same tile computed twice from the same seed, printed: the query's
  // "identical on both sides with no new wire field" claim, literally.
  const first = map.placedResourceTiles[0];
  const once = resourceAmountFor(seed, first.q, first.r, first.resource);
  const twice = resourceAmountFor(seed, first.q, first.r, first.resource);
  console.log(
    `[amount] seed=${seed} tile=(${first.q},${first.r}) ${first.resource}: ${once} === ${twice}`,
  );
  assert.equal(once, twice);

  // ...and a different seed moves it, so the number really is the seed's.
  const other = resourceAmountFor(seed + 1, first.q, first.r, first.resource);
  assert.notEqual(other, once);

  // The range is reachable, not merely bounded: a wide sweep must produce
  // values near both ends.
  let sawLow = false;
  let sawHigh = false;
  for (let i = 0; i < 4000; i++) {
    const v = resourceAmountFor(7, i % 200, (i / 200) | 0, "gold");
    if (v < RESOURCE_AMOUNT_MIN + 20) sawLow = true;
    if (v > RESOURCE_AMOUNT_MAX - 20) sawHigh = true;
  }
  assert.ok(sawLow && sawHigh, "the sweep reaches both ends of 5-500");
});

test("a pickup takes what fits and leaves the rest on the tile (partial pickup is a success)", () => {
  const map = stripWith("wood");
  const pristine = amountAt(map, 3, 0);
  // Two wagons = 100 per-resource cap, so a 400ish tile cannot fit in one trip
  // whatever the hash gave us.
  const hero = makeHero("h0", 0, 3, 0, { wagons: 2 });
  const state = makeState({ heroes: [hero] });
  const room = heroResourceCap(hero).wood;
  assert.equal(room, 2 * WAGON_RESOURCE_CAPACITY);
  assert.ok(pristine > room, `the fixture tile (${pristine}) exceeds the hold (${room})`);

  const result = pickupResource(state, map, { heroId: "h0", q: 3, r: 0 });
  assert.equal(result.ok, true, "a partial pickup is a success, not a refusal");
  assert.equal(result.reason, "");
  assert.equal(result.taken, room, "it takes exactly the room it has");
  assert.equal(result.remaining, pristine - room, "the remainder stays on the floor");
  assert.equal(result.resource, "wood");
  assert.equal(heroCargo(result.state.heroes.h0).wood, room, "the cargo rose by the take");
  assert.equal(
    resourceRemainingOn(result.state, 3, 0, pristine),
    pristine - room,
    "the state records the reduced amount",
  );
  console.log(
    `[partial] tile pristine=${pristine} room=${room} taken=${result.taken} remaining=${result.remaining}`,
  );

  // The same hold cannot take a second load -- it is at its cap, which is the
  // refusal the test above pins. Emptying the tile therefore takes more
  // carriers, one holdful each (the reader's "left on the floor" rule, walked
  // to its end): five 2-wagon heroes take 100 + 100 + 100 + 100 + 62.
  let state2 = result.state;
  let carried = heroCargo(state2.heroes.h0).wood;
  const carriers = ["h1", "h2", "h3", "h4", "h5"];
  for (const id of carriers) {
    // The carrying heroes stand on the tile; each brings its own empty hold.
    const next = pickupResource(
      { ...state2, heroes: { ...state2.heroes, [id]: makeHero(id, 0, 3, 0, { wagons: 2 }) } },
      map,
      { heroId: id, q: 3, r: 0 },
    );
    if (!next.ok) {
      assert.equal(next.reason, "deposit_depleted", "the only way a pickup stops working is an empty tile");
      break;
    }
    state2 = next.state;
    carried += next.taken;
  }
  assert.equal(carried, pristine, "every last unit came off the floor");
  assert.equal(resourceRemainingOn(state2, 3, 0, pristine), 0, "the tile is empty");
  // Empty is a REFUSAL with a named reason -- and only once the amount is 0.
  const drained = pickupResource(state2, map, { heroId: "h0", q: 3, r: 0 });
  assert.equal(drained.ok, false);
  assert.equal(drained.reason, "deposit_depleted");
  assert.equal(drained.state, state2, "a refusal returns the state untouched");
  assert.equal(previewResourcePickup(state2, map, { heroId: "h0", q: 3, r: 0 })?.ok, false);
});

test("a hero with no room is refused with not_enough_cargo_space and the tile is byte-for-byte unchanged", () => {
  const map = stripWith("stone");
  const pristine = amountAt(map, 3, 0);
  // A wagon-less hero is a real 0 cap (capacity.ts's own rule), which is what
  // makes "left on the floor" the natural outcome rather than a special case.
  const hero = makeHero("h0", 0, 3, 0, { wagons: 0, resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } });
  assert.equal(heroResourceCap(hero).stone, 0);
  const state = makeState({ heroes: [hero] });
  const before = JSON.stringify(state);
  const tileBefore = JSON.stringify(map.resourceTileAt(3, 0));

  const result = pickupResource(state, map, { heroId: "h0", q: 3, r: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_enough_cargo_space");
  assert.equal(result.taken, 0);
  assert.equal(result.remaining, pristine, "the tile still holds what it held");
  assert.equal(JSON.stringify(result.state), before, "the state came back byte-for-byte identical");
  assert.equal(JSON.stringify(map.resourceTileAt(3, 0)), tileBefore, "the map tile is untouched");
  // The preview the panel renders agrees with the refusal -- the button cannot
  // offer an amount the command would reject.
  const preview = previewResourcePickup(state, map, { heroId: "h0", q: 3, r: 0 });
  assert.equal(preview?.ok, false);
  assert.equal(preview?.reason, "not_enough_cargo_space");
  assert.equal(preview?.amount, 0);
  assert.equal(preview?.room, 0);
  assert.equal(preview?.remaining, pristine);
});

test("a full-but-not-empty hold still refuses, and a gold tile rides the purse cap", () => {
  const map = stripWith("iron");
  const hero = makeHero("h0", 0, 3, 0, {
    wagons: 1,
    resources: { wood: 0, stone: 0, iron: WAGON_RESOURCE_CAPACITY, arcane: 0, food: 0 },
  });
  const state = makeState({ heroes: [hero] });
  const full = pickupResource(state, map, { heroId: "h0", q: 3, r: 0 });
  assert.equal(full.ok, false);
  assert.equal(full.reason, "not_enough_cargo_space", "a hold at exactly its cap has no room");

  // Gold is a resource tile type too, and its room is the purse (treasury
  // carts), not the wagons -- the same split tradeHeroes makes.
  const goldMap = stripWith("gold");
  const goldPristine = amountAt(goldMap, 3, 0);
  const poor = makeHero("h1", 0, 3, 0, { wagons: 5, treasuryWagons: 0, gold: 0 });
  assert.equal(heroGoldCap(poor), 0);
  const goldResult = pickupResource(makeState({ heroes: [poor] }), goldMap, { heroId: "h1", q: 3, r: 0 });
  assert.equal(goldResult.ok, false);
  assert.equal(goldResult.reason, "not_enough_gold_space", "a cart-less hero has no purse to fill");

  const rich = makeHero("h2", 0, 3, 0, { wagons: 0, treasuryWagons: 5, gold: 0 });
  const richResult = pickupResource(makeState({ heroes: [rich] }), goldMap, { heroId: "h2", q: 3, r: 0 });
  assert.equal(richResult.ok, true, "wagons are irrelevant to a gold pile");
  assert.equal(richResult.taken, Math.min(goldPristine, heroGoldCap(rich)));
  assert.equal(richResult.state.heroes.h2.gold, richResult.taken);
});

test("the hero must STAND on the tile (RESOURCE_PICKUP_RANGE is 0)", () => {
  const map = stripWith("arcane", 3);
  const state = makeState({ heroes: [makeHero("h0", 0, 2, 0)] });
  const refused = pickupResource(state, map, { heroId: "h0", q: 3, r: 0 });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "not_on_resource_tile");
  assert.equal(refused.state, state, "nothing is written for an off-tile pickup");

  const onTile = pickupResource(makeState({ heroes: [makeHero("h0", 0, 3, 0)] }), map, {
    heroId: "h0",
    q: 3,
    r: 0,
  });
  assert.equal(onTile.ok, true);
});

test("an unknown hero and a hex with no deposit are named refusals, not crashes", () => {
  const map = stripWith("wood", 3);
  const state = makeState({ heroes: [makeHero("h0", 0, 3, 0)] });
  assert.equal(pickupResource(state, map, { heroId: "nope", q: 3, r: 0 }).reason, "no_hero");
  assert.equal(pickupResource(state, map, { heroId: "h0", q: 5, r: 0 }).reason, "no_resource_tile");
  assert.equal(previewResourcePickup(state, map, { heroId: "nope", q: 3, r: 0 }), null);
  assert.equal(previewResourcePickup(state, map, { heroId: "h0", q: 5, r: 0 }), null);
});

test("a pickup leaves the tile's resource type alone -- and its derived amount is stable", () => {
  const map = stripWith("wood", 3, 99);
  const tileBefore = { ...map.resourceTileAt(3, 0)! };
  const state = makeState({ heroes: [makeHero("h0", 0, 3, 0, { wagons: 5 })] });
  const result = pickupResource(state, map, { heroId: "h0", q: 3, r: 0 });
  assert.equal(result.ok, true);
  const tileAfter = map.resourceTileAt(3, 0)!;
  assert.deepEqual(tileAfter, tileBefore, "the map's tile object is never mutated by a pickup");
  // The pristine amount the settlement / city-view half reads is unchanged, so
  // the only thing a pickup moves is the remaining quantity in the state.
  assert.equal(resourceAmountFor(99, 3, 0, "wood"), tileBefore.amount);
  assert.ok(result.remaining < tileBefore.amount);
});
